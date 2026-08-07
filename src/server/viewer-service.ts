import { EventEmitter } from 'node:events';
import { basename, extname } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type {
  LogRecord,
  MultilineFlushReason,
  ParserConfig,
  ServerEvent,
  ViewerSnapshot,
  ViewerStatus,
} from '../shared/contracts.js';
import type { SourceDefinition } from './cli.js';
import { FileTailer, type LineBatch } from './tailer.js';
import { GrokParserService } from './grok-parser-service.js';
import { errorMessage, loadConfig } from './config.js';
import {
  type AssembledEvent,
  MultilineAssembler,
  singleLineEvents,
} from './multiline-assembler.js';
import { RingBuffer } from './ring-buffer.js';

const PARSE_BATCH_SIZE = 500;

export interface ViewerServiceOptions {
  sources?: SourceDefinition[];
  logPath?: string;
  configPath?: string | null;
  initialLines: number;
  maxRecords: number;
  usePolling: boolean;
}

interface SingleViewerServiceOptions {
  source: SourceDefinition;
  initialLines: number;
  maxRecords: number;
  usePolling: boolean;
}

interface ViewerServiceEvents {
  event: [ServerEvent];
}

interface BufferedRecord extends LogRecord {
  sourceLines: string[];
}

class SingleViewerService extends EventEmitter<ViewerServiceEvents> {
  private readonly records: RingBuffer<BufferedRecord>;
  private readonly tailer: FileTailer;
  private readonly parser = new GrokParserService();
  private assembler: MultilineAssembler | null = null;
  private multilineFlushTimer: NodeJS.Timeout | null = null;
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
  private activeConfig: ParserConfig | null = null;

  constructor(public readonly options: SingleViewerServiceOptions) {
    super();
    this.records = new RingBuffer(options.maxRecords);
    this.tailer = new FileTailer(options.source.logPath, {
      initialLines: options.initialLines,
      usePolling: options.usePolling,
    });
  }

  async start(): Promise<void> {
    if (this.options.source.configPath) {
      this.activeConfig = await loadConfig(this.options.source.configPath);
      await this.parser.configure(this.activeConfig);
      this.assembler = createAssembler(this.activeConfig);
    }

    this.tailer.on('lines', (batch) => {
      if (this.initializing) {
        this.deferredBatches.push(batch);
      } else {
        this.enqueue(() => this.processPhysicalBatch(batch, true));
      }
    });
    this.tailer.on('rotation', ({ generation, reason }) => {
      this.enqueue(async () => {
        this.clearMultilineTimer();
        await this.flushAssembler('rotation', true);
        const labels = {
          truncated: 'File was truncated',
          recreated: 'File was recreated',
          replaced: 'File was replaced',
        };
        this.stateMessage = `${labels[reason]}; kontynuacja jako generation ${generation}.`;
        this.emitStatus();
      });
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
    await this.processPhysicalBatch(initial, false);
    while (this.deferredBatches.length > 0) {
      const deferred = this.deferredBatches.splice(0);
      for (const batch of deferred) {
        await this.processPhysicalBatch(batch, false);
      }
    }
    await this.flushAssembler('initial', false);
    this.initializing = false;

    if (this.options.source.configPath) {
      this.watchConfig(this.options.source.configPath);
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
    this.clearMultilineTimer();
    await this.configWatcher?.close();
    this.configWatcher = null;
    await this.tailer.stop();
    await this.processing.catch(() => undefined);
    await this.flushAssembler('shutdown', false);
    await this.parser.stop();
  }

  snapshot(): ViewerSnapshot {
    const buffered = this.records.toArray();
    const records = buffered.map(toPublicRecord);
    return {
      status: this.buildStatus(buffered),
      fields: collectFields(buffered),
      records,
    };
  }

  private async processPhysicalBatch(batch: LineBatch, notify: boolean): Promise<void> {
    if (batch.lines.length === 0) {
      return;
    }

    let events: AssembledEvent[];
    if (this.assembler) {
      const matches = await this.parser.classifyMultiline(batch.lines);
      events = this.assembler.push(batch.generation, batch.lines, matches);
    } else {
      events = singleLineEvents(batch.generation, batch.lines);
    }

    await this.commitEvents(events, notify);
    if (notify && events.length === 0) {
      this.emitStatus();
    }
    if (notify) {
      this.scheduleMultilineFlush();
    }
  }

  private async commitEvents(events: AssembledEvent[], notify: boolean): Promise<void> {
    if (events.length === 0) {
      return;
    }
    const output = await this.createRecords(events, this.activeConfig !== null);
    this.records.push(...output);

    if (notify) {
      this.publish({
        type: 'append',
        data: {
          records: output.map(toPublicRecord),
          fields: collectFields(this.records.toArray()),
        },
      });
      this.emitStatus();
    }
  }

  private async createRecords(
    events: AssembledEvent[],
    parseWithGrok: boolean,
  ): Promise<BufferedRecord[]> {
    const output: BufferedRecord[] = [];
    for (let offset = 0; offset < events.length; offset += PARSE_BATCH_SIZE) {
      const batch = events.slice(offset, offset + PARSE_BATCH_SIZE);
      const parsed = parseWithGrok
        ? await this.parser.parse(batch.map((event) => event.raw))
        : batch.map(() => null);

      for (let index = 0; index < batch.length; index += 1) {
        const event = batch[index];
        const fields = parsed[index];
        const sequence = ++this.sequence;
        output.push({
          id: `${this.options.source.id}:${event.generation}:${sequence}`,
          sourceId: this.options.source.id,
          sourceName: this.options.source.name,
          generation: event.generation,
          sequence,
          raw: event.raw,
          parseStatus: parseWithGrok ? (fields ? 'matched' : 'unmatched') : 'raw',
          fields: fields ?? {},
          lineCount: event.lineCount,
          multiline: event.lineCount > 1,
          limitReached: event.limitReached,
          flushReason: event.flushReason,
          sourceLines: [...event.lines],
        });
      }
    }
    return output;
  }

  private async flushAssembler(
    reason: MultilineFlushReason,
    notify: boolean,
  ): Promise<void> {
    if (!this.assembler) {
      return;
    }
    await this.commitEvents(this.assembler.flush(reason), notify);
  }

  private scheduleMultilineFlush(): void {
    this.clearMultilineTimer();
    if (!this.assembler || this.assembler.pendingLineCount() === 0 || !this.activeConfig?.multiline) {
      return;
    }
    const delay = Math.max(50, this.activeConfig.multiline.autoFlushInterval * 1000);
    this.multilineFlushTimer = setTimeout(() => {
      this.multilineFlushTimer = null;
      this.enqueue(() => this.flushAssembler('timeout', true));
    }, delay);
  }

  private clearMultilineTimer(): void {
    if (this.multilineFlushTimer) {
      clearTimeout(this.multilineFlushTimer);
      this.multilineFlushTimer = null;
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
        this.parserError = 'The configuration file was removed; the last valid configuration remains active.';
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
    if (!this.options.source.configPath) {
      return;
    }

    const previousConfig = this.activeConfig;
    try {
      const sourceBatches = this.collectSourceBatches();
      const candidate = await loadConfig(this.options.source.configPath);
      await this.parser.configure(candidate);
      const candidateAssembler = createAssembler(candidate);
      const assembled: AssembledEvent[] = [];

      for (const batch of sourceBatches) {
        if (candidateAssembler) {
          const matches = await this.parser.classifyMultiline(batch.lines);
          assembled.push(...candidateAssembler.push(batch.generation, batch.lines, matches));
        } else {
          assembled.push(...singleLineEvents(batch.generation, batch.lines));
        }
      }
      if (candidateAssembler) {
        assembled.push(...candidateAssembler.flush('configuration'));
      }

      const rebuilt = await this.createRecords(assembled, true);
      this.clearMultilineTimer();
      this.records.replace(rebuilt);
      this.assembler = candidateAssembler;
      this.activeConfig = candidate;
      this.parserError = null;
      this.revision += 1;
      this.stateMessage = 'Parser configuration reloaded.';
      this.publish({ type: 'snapshot', data: this.snapshot() });
    } catch (error) {
      if (previousConfig) {
        try {
          await this.parser.configure(previousConfig);
        } catch (rollbackError) {
          this.state = 'error';
          this.stateMessage = `Failed to restore parser: ${errorMessage(rollbackError)}`;
        }
      }
      this.parserError = errorMessage(error);
      if (this.state !== 'error') {
        this.stateMessage = 'The new configuration is invalid; the last valid one remains active.';
      }
      this.emitStatus();
    }
  }

  private collectSourceBatches(): LineBatch[] {
    const output: LineBatch[] = [];
    const append = (generation: number, lines: string[]) => {
      const last = output.at(-1);
      if (last?.generation === generation) {
        last.lines.push(...lines);
      } else {
        output.push({ generation, lines: [...lines] });
      }
    };

    for (const record of this.records.toArray()) {
      append(record.generation, record.sourceLines);
    }
    const pending = this.assembler?.pendingSnapshot();
    if (pending) {
      append(pending.generation, pending.lines);
    }
    return output;
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

  private buildStatus(records: BufferedRecord[]): ViewerStatus {
    let matched = 0;
    let unmatched = 0;
    let physicalLines = 0;
    for (const record of records) {
      physicalLines += record.lineCount;
      if (record.parseStatus === 'matched') {
        matched += 1;
      } else if (record.parseStatus === 'unmatched') {
        unmatched += 1;
      }
    }
    return {
      state: this.state,
      message: this.stateMessage,
      logPath: this.options.source.logPath,
      configPath: this.options.source.configPath,
      parserMode: this.activeConfig ? 'grok' : 'raw',
      parserError: this.parserError,
      generation: this.tailer.generation,
      revision: this.revision,
      initialLines: this.options.initialLines,
      maxRecords: this.options.maxRecords,
      matched,
      unmatched,
      buffered: records.length,
      physicalLines,
      pendingMultilineLines: this.assembler?.pendingLineCount() ?? 0,
      sources: [{
        id: this.options.source.id,
        name: this.options.source.name,
        logPath: this.options.source.logPath,
        configPath: this.options.source.configPath,
        state: this.state,
        message: this.stateMessage,
        parserMode: this.activeConfig ? 'grok' : 'raw',
        parserError: this.parserError,
        generation: this.tailer.generation,
        revision: this.revision,
        matched,
        unmatched,
        buffered: records.length,
        physicalLines,
        pendingMultilineLines: this.assembler?.pendingLineCount() ?? 0,
      }],
    };
  }
}

export class ViewerService extends EventEmitter<ViewerServiceEvents> {
  private readonly records: RingBuffer<LogRecord>;
  private readonly sources: SourceDefinition[];
  private readonly children: SingleViewerService[] = [];
  private readonly sourceStatuses = new Map<string, ViewerStatus['sources'][number]>();
  private sequence = 0;
  private initializing = true;

  constructor(public readonly options: ViewerServiceOptions) {
    super();
    this.sources = normalizeSources(options);
    this.records = new RingBuffer(options.maxRecords);
  }

  async start(): Promise<void> {
    for (const source of this.sources) {
      const child = new SingleViewerService({
        source,
        initialLines: this.options.initialLines,
        maxRecords: this.options.maxRecords,
        usePolling: this.options.usePolling,
      });
      this.children.push(child);
      child.on('event', (event) => this.handleChildEvent(event));
      try {
        await child.start();
      } catch (error) {
        this.sourceStatuses.set(source.id, errorStatus(source, error));
      }
    }
    this.initializing = false;
    this.publish({ type: 'snapshot', data: this.snapshot() });
  }

  async stop(): Promise<void> {
    await Promise.all(this.children.map((child) => child.stop()));
  }

  snapshot(): ViewerSnapshot {
    const records = this.records.toArray();
    return {
      status: this.buildStatus(records),
      fields: collectFields(records),
      records,
    };
  }

  private handleChildEvent(event: ServerEvent): void {
    if (event.type === 'snapshot') {
      this.replaceSource(event.data.status.sources[0], event.data.records);
    } else if (event.type === 'append') {
      const records = event.data.records.map((record) => this.toGlobalRecord(record));
      this.records.push(...records);
      this.updateSourceStatus(records[0]?.sourceId);
      if (!this.initializing) {
        this.publish({
          type: 'append',
          data: { records, fields: collectFields(this.records.toArray()) },
        });
        this.emitStatus();
      }
      return;
    } else {
      this.sourceStatuses.set(event.data.sources[0].id, event.data.sources[0]);
      if (!this.initializing) {
        this.emitStatus();
      }
      return;
    }

    if (!this.initializing) {
      this.publish({ type: 'snapshot', data: this.snapshot() });
    }
  }

  private replaceSource(
    status: ViewerStatus['sources'][number],
    records: LogRecord[],
  ): void {
    this.sourceStatuses.set(status.id, status);
    const remaining = this.records.toArray().filter((record) => record.sourceId !== status.id);
    const replacement = records.map((record) => this.toGlobalRecord(record));
    this.records.replace([...remaining, ...replacement].sort((left, right) => left.sequence - right.sequence));
  }

  private toGlobalRecord(record: LogRecord): LogRecord {
    const sequence = ++this.sequence;
    return { ...record, id: `${record.sourceId}:${sequence}`, sequence };
  }

  private updateSourceStatus(sourceId: string | undefined): void {
    if (!sourceId) return;
    const child = this.children.find((candidate) => candidate.snapshot().status.sources[0]?.id === sourceId);
    const status = child?.snapshot().status.sources[0];
    if (status) this.sourceStatuses.set(sourceId, status);
  }

  private emitStatus(): void {
    this.publish({ type: 'status', data: this.buildStatus(this.records.toArray()) });
  }

  private publish(event: ServerEvent): boolean {
    return super.emit('event', event);
  }

  private buildStatus(records: LogRecord[]): ViewerStatus {
    const sources = this.sources.map((source) => {
      const status = this.sourceStatuses.get(source.id) ?? startingStatus(source);
      const sourceRecords = records.filter((record) => record.sourceId === source.id);
      return {
        ...status,
        matched: sourceRecords.filter((record) => record.parseStatus === 'matched').length,
        unmatched: sourceRecords.filter((record) => record.parseStatus === 'unmatched').length,
        buffered: sourceRecords.length,
        physicalLines: sourceRecords.reduce((sum, record) => sum + record.lineCount, 0),
      };
    });
    let matched = 0;
    let unmatched = 0;
    let physicalLines = 0;
    for (const record of records) {
      physicalLines += record.lineCount;
      if (record.parseStatus === 'matched') matched += 1;
      if (record.parseStatus === 'unmatched') unmatched += 1;
    }
    const live = sources.some((source) => source.state === 'live');
    const waiting = sources.some((source) => source.state === 'waiting');
    return {
      state: live ? 'live' : waiting ? 'waiting' : sources.some((source) => source.state === 'error') ? 'error' : 'starting',
      message: `${sources.filter((source) => source.state === 'live').length}/${sources.length} sources are live.`,
      parserMode: sources.every((source) => source.parserMode === 'raw') ? 'raw' : 'grok',
      parserError: sources.find((source) => source.parserError)?.parserError ?? null,
      generation: Math.max(0, ...sources.map((source) => source.generation)),
      revision: Math.max(1, ...sources.map((source) => source.revision)),
      initialLines: this.options.initialLines,
      maxRecords: this.options.maxRecords,
      matched,
      unmatched,
      buffered: records.length,
      physicalLines,
      pendingMultilineLines: sources.reduce((sum, source) => sum + source.pendingMultilineLines, 0),
      sources,
    };
  }
}

function normalizeSources(options: ViewerServiceOptions): SourceDefinition[] {
  if (options.sources?.length) return options.sources;
  if (!options.logPath) throw new Error('No log sources.');
  const name = basename(options.configPath ?? options.logPath, extname(options.configPath ?? options.logPath));
  return [{
    id: name,
    name,
    logPath: options.logPath,
    configPath: options.configPath ?? null,
  }];
}

function startingStatus(source: SourceDefinition): ViewerStatus['sources'][number] {
  return {
    id: source.id,
    name: source.name,
    logPath: source.logPath,
    configPath: source.configPath,
    state: 'starting',
    message: 'Starting viewer…',
    parserMode: source.configPath ? 'grok' : 'raw',
    parserError: null,
    generation: 0,
    revision: 1,
    matched: 0,
    unmatched: 0,
    buffered: 0,
    physicalLines: 0,
    pendingMultilineLines: 0,
  };
}

function errorStatus(source: SourceDefinition, error: unknown): ViewerStatus['sources'][number] {
  return { ...startingStatus(source), state: 'error', message: errorMessage(error), parserError: errorMessage(error) };
}

function createAssembler(config: ParserConfig): MultilineAssembler | null {
  return config.multiline ? new MultilineAssembler(config.multiline) : null;
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

function toPublicRecord(record: BufferedRecord): LogRecord {
  const { sourceLines: _sourceLines, ...publicRecord } = record;
  return publicRecord;
}
