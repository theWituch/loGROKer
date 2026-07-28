import { Worker } from 'node:worker_threads';
import type { ParserConfig } from '../shared/contracts.js';

interface WorkerSuccess {
  id: number;
  ok: true;
  result: unknown;
}

interface WorkerFailure {
  id: number;
  ok: false;
  error: string;
}

type WorkerResponse = WorkerSuccess | WorkerFailure;

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class GrokParserService {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  async start(): Promise<void> {
    if (this.worker) {
      return;
    }

    const runningTypescript = import.meta.url.endsWith('.ts');
    const workerUrl = new URL(runningTypescript ? './grok-worker.ts' : './grok-worker.js', import.meta.url);
    this.worker = new Worker(workerUrl, {
      execArgv: runningTypescript ? ['--import', 'tsx'] : [],
    });
    this.worker.on('message', (message: WorkerResponse) => this.handleMessage(message));
    this.worker.on('error', (error) => this.failAll(error));
    this.worker.on('exit', (code) => {
      if (code !== 0) {
        this.failAll(new Error(`The GROK worker exited with code ${code}.`));
      }
      this.worker = null;
    });
  }

  async configure(config: ParserConfig): Promise<void> {
    await this.start();
    await this.request('configure', { config });
  }

  async parse(lines: string[]): Promise<Array<Record<string, string> | null>> {
    if (lines.length === 0) {
      return [];
    }
    await this.start();
    return await this.request('parse', { lines }) as Array<Record<string, string> | null>;
  }

  async classifyMultiline(lines: string[]): Promise<boolean[]> {
    if (lines.length === 0) {
      return [];
    }
    await this.start();
    return await this.request('classify', { lines }) as boolean[];
  }

  async stop(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      await worker.terminate();
    }
    this.failAll(new Error('The GROK parser was stopped.'));
  }

  private request(type: 'configure' | 'parse' | 'classify', payload: object): Promise<unknown> {
    if (!this.worker) {
      return Promise.reject(new Error('The GROK worker is unavailable.'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker?.postMessage({ id, type, ...payload });
    });
  }

  private handleMessage(message: WorkerResponse): void {
    const request = this.pending.get(message.id);
    if (!request) {
      return;
    }
    this.pending.delete(message.id);
    if (message.ok) {
      request.resolve(message.result);
    } else {
      request.reject(new Error(message.error));
    }
  }

  private failAll(error: Error): void {
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  }
}
