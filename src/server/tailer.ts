import { EventEmitter } from 'node:events';
import { open, stat } from 'node:fs/promises';
import { createReadStream, type Stats } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import chokidar, { type FSWatcher } from 'chokidar';

const READ_CHUNK_SIZE = 64 * 1024;

export interface TailerOptions {
  initialLines: number;
  usePolling?: boolean;
}

export interface LineBatch {
  generation: number;
  lines: string[];
}

export interface RotationEvent {
  generation: number;
  reason: 'truncated' | 'recreated' | 'replaced';
}

interface TailerEvents {
  lines: [LineBatch];
  rotation: [RotationEvent];
  waiting: [string];
  live: [];
  error: [Error];
}

export class FileTailer extends EventEmitter<TailerEvents> {
  private watcher: FSWatcher | null = null;
  private offset = 0;
  private remainder = '';
  private decoder = new StringDecoder('utf8');
  private fileIdentity = '';
  private missing = false;
  private started = false;
  private drainChain: Promise<void> = Promise.resolve();

  public generation = 0;

  constructor(
    public readonly path: string,
    private readonly options: TailerOptions,
  ) {
    super();
  }

  async start(): Promise<LineBatch> {
    if (this.started) {
      throw new Error('Tailer is already running.');
    }
    const initialStat = await stat(this.path);
    if (!initialStat.isFile()) {
      throw new Error(`The log path does not point to a regular file: ${this.path}`);
    }

    const initial = await readLastCompleteLines(
      this.path,
      this.options.initialLines,
      initialStat.size,
    );
    this.offset = initialStat.size;
    this.remainder = initial.remainder;
    this.fileIdentity = identityOf(initialStat);
    this.started = true;

    this.watcher = chokidar.watch(this.path, {
      persistent: true,
      ignoreInitial: true,
      atomic: true,
      alwaysStat: true,
      usePolling: this.options.usePolling ?? false,
      interval: 100,
    });

    this.watcher
      .on('change', (_path, nextStat) => this.scheduleDrain(nextStat))
      .on('unlink', () => {
        this.missing = true;
        this.emit('waiting', 'The log file disappeared. Waiting for it to be recreated.');
      })
      .on('add', (_path, nextStat) => {
        if (this.missing) {
          this.missing = false;
          this.beginNewGeneration('recreated');
        }
        this.scheduleDrain(nextStat);
      })
      .on('error', (error) => this.emit('error', asError(error)));

    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = (error: unknown) => {
        cleanup();
        reject(asError(error));
      };
      const cleanup = () => {
        this.watcher?.off('ready', onReady);
        this.watcher?.off('error', onError);
      };
      this.watcher?.once('ready', onReady);
      this.watcher?.once('error', onError);
    });

    await this.drain();
    this.emit('live');
    return { generation: this.generation, lines: initial.lines };
  }

  async stop(): Promise<void> {
    this.started = false;
    await this.watcher?.close();
    this.watcher = null;
    await this.drainChain.catch(() => undefined);
  }

  private scheduleDrain(nextStat?: Stats): void {
    this.drainChain = this.drainChain
      .then(() => this.drain(nextStat))
      .catch((error) => {
        this.emit('error', asError(error));
      });
  }

  private async drain(providedStat?: Stats): Promise<void> {
    if (!this.started || this.missing) {
      return;
    }

    let nextStat: Stats;
    try {
      nextStat = providedStat ?? await stat(this.path);
    } catch (error) {
      const candidate = asError(error) as NodeJS.ErrnoException;
      if (candidate.code === 'ENOENT') {
        this.missing = true;
        this.emit('waiting', 'The log file is temporarily unavailable.');
        return;
      }
      throw candidate;
    }

    const identity = identityOf(nextStat);
    if (this.fileIdentity && identity !== this.fileIdentity) {
      this.beginNewGeneration('replaced');
    } else if (nextStat.size < this.offset) {
      this.beginNewGeneration('truncated');
    }
    this.fileIdentity = identity;

    if (nextStat.size <= this.offset) {
      this.emit('live');
      return;
    }

    const start = this.offset;
    const end = nextStat.size - 1;
    const lines: string[] = [];
    const stream = createReadStream(this.path, { start, end });

    for await (const chunk of stream) {
      const text = this.remainder + this.decoder.write(chunk as Buffer);
      const parts = text.split('\n');
      this.remainder = parts.pop() ?? '';
      for (const part of parts) {
        lines.push(part.endsWith('\r') ? part.slice(0, -1) : part);
      }
    }

    this.offset = nextStat.size;
    if (lines.length > 0) {
      this.emit('lines', { generation: this.generation, lines });
    }
    this.emit('live');
  }

  private beginNewGeneration(reason: RotationEvent['reason']): void {
    this.generation += 1;
    this.offset = 0;
    this.remainder = '';
    this.decoder = new StringDecoder('utf8');
    this.fileIdentity = '';
    this.emit('rotation', { generation: this.generation, reason });
  }
}

export async function readLastCompleteLines(
  path: string,
  count: number,
  endOffset?: number,
): Promise<{ lines: string[]; remainder: string }> {
  if (count < 0 || !Number.isInteger(count)) {
    throw new Error('The initial line count must be a non-negative integer.');
  }

  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    const end = Math.min(endOffset ?? info.size, info.size);
    if (end === 0) {
      return { lines: [], remainder: '' };
    }

    let position = end;
    let lineFeeds = 0;
    const chunks: Buffer[] = [];
    while (position > 0 && lineFeeds <= count) {
      const length = Math.min(READ_CHUNK_SIZE, position);
      position -= length;
      const chunk = Buffer.allocUnsafe(length);
      const { bytesRead } = await file.read(chunk, 0, length, position);
      const value = chunk.subarray(0, bytesRead);
      for (const byte of value) {
        if (byte === 0x0a) {
          lineFeeds += 1;
        }
      }
      chunks.unshift(value);
    }

    const text = Buffer.concat(chunks).toString('utf8');
    const endsWithNewline = text.endsWith('\n');
    const parts = text.split('\n');
    const remainderPart = endsWithNewline ? '' : (parts.pop() ?? '');
    if (endsWithNewline) {
      parts.pop();
    }
    const complete = count === 0
      ? []
      : parts
        .map((line) => line.endsWith('\r') ? line.slice(0, -1) : line)
        .slice(-count);
    const remainder = remainderPart.endsWith('\r')
      ? remainderPart.slice(0, -1)
      : remainderPart;
    return { lines: complete, remainder };
  } finally {
    await file.close();
  }
}

function identityOf(value: Stats): string {
  return `${value.dev}:${value.ino}`;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
