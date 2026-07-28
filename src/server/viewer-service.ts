import { EventEmitter } from 'node:events';
import chokidar, { type FSWatcher } from 'chokidar';
import type {
  GrokConfig,
  LogRecord,
  ServerEvent,
  ViewerSnapshot,
  ViewerStatus,
} from '../shared/contracts.js';
import { FileTailer, type LineBatch } from './tailer.js';
import { GrokParserService } from './grok-parser-service.js';
import { errorMessage, loadGrokConfig } from './grok-config.js';
import { RingBuffer } from './ring-buffer.js';

const PARSE_BATCH_SIZE = 500;

export interface ViewerServiceOptions {
  logPath: string;
  grokPath: string | null;
  initialLines: number;
  maxRecords: number;
  usePolling: boolean;
}

interface ViewerServiceEvents {
  event: [ServerEvent];
}

export class ViewerService extends EventEmitter<ViewerServiceEvents> {
  private readonly records: RingBuffer<LogRecord>;
  private readonly tailer: FileTailer;
  private readonly parser = new GrokParserService();
  private configWatcher: FSWatcher | null = null;
  private configReloadTimer: NodeJS.Timeout | null = null;
  private processing: Promise<void> = Promise.resolve();
  private deferredBatches: LineBatch[] = [];
  private initializing = true;
  private sequence = 0;
  private revision = 1;
  private parserError: string | null = null;
  private state: ViewerStatus['state'] = 'starting';
  private stateMessage = 'Starting viewer…';
  private activeConfig: GrokConfig | null = null;

  constructor(public readonly options: ViewerServiceOptions) {
    super();
    this.records = new RingBuffer(options.maxRecords);
    this.tailer = new FileTailer(options.logPath, {
      initialLines: options.initialLines,
      usePolling: options.usePolling,
    });
  }

  async start(): Promise<void> {
    if (this.options.grokPath) {
      this.activeConfig = await loadGrokConfig(this.options.grokPath);
      await this.parser.configure(this.activeConfig);
    }

    this.tailer.on('lines', (batch) => {
      if (this.initializing) {
        this.deferredBatches.push(batch);
      } else {
        this.enqueue(() => this.processBatch(batch, true));
      }
    });
    this.tailer.on('rotation', ({ generation, reason }) => {
      const labels = {
        truncated: 'File was truncated',
        recreated: 'File was recreated',
        replaced: 'File was replaced',
      };
      this.stateMessage = `${labels[reason]}; kontynuacja jako generation ${generation}.`;
      this.emitStatus();
    });
    this.tailer.on('waiting', (message) => {
      this.state = 'waiting';
      this.stateMessage = message;
      this.emitStatus();
    });
    this.tailer.on('live', () => {
      this.state = 'live';
      this.stateMessage = 'Viewer is live.';
      this.emitStatus();
    });
    this.tailer.on('error', (error) => {
      this.state = 'error';
      this.stateMessage = `Error odczytu logu: ${error.message}`;
      this.emitStatus();
    });

    const initial = await this.tailer.start();
    await this.processBatch(initial, false);
    this.initializing = false;
    for (const batch of this.deferredBatches.splice(0)) {
      await this.processBatch(batch, false);
    }

    if (this.options.grokPath) {
      this.watchConfig(this.options.grokPath);
    }

    this.state = 'live';
    this.stateMessage = 'Viewer is live.';
    this.publish({ type: 'snapshot', data: this.snapshot() });
  }

  async stop(): Promise<void> {
    if (this.configReloadTimer) {
      clearTimeout(this.configReloadTimer);
      this.configReloadTimer = null;
    }
    await this.configWatcher?.close();
    this.configWatcher = null;
    await this.tailer.stop();
    await this.processing.catch(() => undefined);
    await this.parser.stop();
  }

  snapshot(): ViewerSnapshot {
    const records = this.records.toArray();
    return {
      status: this.buildStatus(records),
      fields: collectFields(records),
      records,
    };
  }

  private async processBatch(batch: LineBatch, notify: boolean): Promise<void> {
    if (batch.lines.length === 0) {
      return;
    }

    const output: LogRecord[] = [];
    for (let offset = 0; offset < batch.lines.length; offset += PARSE_BATCH_SIZE) {
      const lines = batch.lines.slice(offset, offset + PARSE_BATCH_SIZE);
      const parsed = this.activeConfig ? await this.parser.parse(lines) : lines.map(() => null);
      for (let index = 0; index < lines.length; index += 1) {
        const fields = parsed[index];
        const sequence = ++this.sequence;
        output.push({
          id: `${batch.generation}:${sequence}`,
          generation: batch.generation,
          sequence,
          raw: lines[index],
          parseStatus: this.activeConfig ? (fields ? 'matched' : 'unmatched') : 'raw',
          fields: fields ?? {},
        });
      }
    }
    this.records.push(...output);

    if (notify) {
      this.publish({
        type: 'append',
        data: {
          records: output,
          fields: collectFields(this.records.toArray()),
        },
      });
      this.emitStatus();
    }
  }

  private watchConfig(path: string): void {
    this.configWatcher = chokidar.watch(path, {
      persistent: true,
      ignoreInitial: true,
      atomic: true,
      usePolling: this.options.usePolling,
      interval: 100,
    });
    this.configWatcher
      .on('change', () => this.scheduleConfigReload())
      .on('add', () => this.scheduleConfigReload())
      .on('unlink', () => {
        this.parserError = 'The GROK configuration file was removed; the last valid pattern remains active.';
        this.emitStatus();
      })
      .on('error', (error) => {
        this.parserError = `Error obserwacji konfiguracji: ${errorMessage(error)}`;
        this.emitStatus();
      });
  }

  private scheduleConfigReload(): void {
    if (this.configReloadTimer) {
      clearTimeout(this.configReloadTimer);
    }
    this.configReloadTimer = setTimeout(() => {
      this.configReloadTimer = null;
      this.enqueue(() => this.reloadConfig());
    }, 120);
  }

  private async reloadConfig(): Promise<void> {
    if (!this.options.grokPath) {
      return;
    }
    try {
      const candidate = await loadGrokConfig(this.options.grokPath);
      await this.parser.configure(candidate);
      this.activeConfig = candidate;
      this.parserError = null;

      const current = this.records.toArray();
      const reparsed: LogRecord[] = [];
      for (let offset = 0; offset < current.length; offset += PARSE_BATCH_SIZE) {
        const batch = current.slice(offset, offset + PARSE_BATCH_SIZE);
        const parsed = await this.parser.parse(batch.map((record) => record.raw));
        for (let index = 0; index < batch.length; index += 1) {
          reparsed.push({
            ...batch[index],
            parseStatus: parsed[index] ? 'matched' : 'unmatched',
            fields: parsed[index] ?? {},
          });
        }
      }
      this.records.replace(reparsed);
      this.revision += 1;
      this.stateMessage = 'GROK configuration reloaded.';
      this.publish({ type: 'snapshot', data: this.snapshot() });
    } catch (error) {
      this.parserError = errorMessage(error);
      this.stateMessage = 'The new GROK configuration is invalid; the last valid one remains active.';
      this.emitStatus();
    }
  }

  private enqueue(task: () => Promise<void>): void {
    this.processing = this.processing
      .then(task)
      .catch((error) => {
        this.state = 'error';
        this.stateMessage = `Error przetwarzania: ${errorMessage(error)}`;
        this.emitStatus();
      });
  }

  private emitStatus(): void {
    this.publish({ type: 'status', data: this.buildStatus(this.records.toArray()) });
  }

  private publish(event: ServerEvent): boolean {
    return super.emit('event', event);
  }

  private buildStatus(records: LogRecord[]): ViewerStatus {
    let matched = 0;
    let unmatched = 0;
    for (const record of records) {
      if (record.parseStatus === 'matched') {
        matched += 1;
      } else if (record.parseStatus === 'unmatched') {
        unmatched += 1;
      }
    }
    return {
      state: this.state,
      message: this.stateMessage,
      logPath: this.options.logPath,
      grokPath: this.options.grokPath,
      parserMode: this.activeConfig ? 'grok' : 'raw',
      parserError: this.parserError,
      generation: this.tailer.generation,
      revision: this.revision,
      initialLines: this.options.initialLines,
      maxRecords: this.options.maxRecords,
      matched,
      unmatched,
      buffered: records.length,
    };
  }
}

function collectFields(records: LogRecord[]): string[] {
  const fields = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record.fields)) {
      fields.add(key);
    }
  }
  return [...fields];
}
