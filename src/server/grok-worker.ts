import { parentPort } from 'node:worker_threads';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import grok from '@okuryu/grok-js';
import type { ParserConfig } from '../shared/contracts.js';

type WorkerRequest =
  | { id: number; type: 'configure'; config: ParserConfig }
  | { id: number; type: 'parse'; lines: string[] }
  | { id: number; type: 'classify'; lines: string[] };

type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

if (!parentPort) {
  throw new Error('The GROK worker must run as a Worker Thread.');
}

await grok.init();

let activePattern: ReturnType<ReturnType<typeof grok.loadDefaultSync>['createPattern']> | null = null;
let activeMultilinePattern: ReturnType<ReturnType<typeof grok.loadDefaultSync>['createPattern']> | null = null;

parentPort.on('message', async (message: WorkerRequest) => {
  try {
    if (message.type === 'configure') {
      const compiled = await compile(message.config);
      activePattern = compiled.pattern;
      activeMultilinePattern = compiled.multilinePattern;
      respond({ id: message.id, ok: true, result: true });
      return;
    }

    if (message.type === 'classify') {
      if (!activeMultilinePattern) {
        throw new Error('The multiline pattern was not configured.');
      }
      const boundary = activeMultilinePattern;
      respond({
        id: message.id,
        ok: true,
        result: message.lines.map((line) => boundary.parseSync(line) !== null),
      });
      return;
    }

    if (!activePattern) {
      throw new Error('The GROK parser was not configured.');
    }
    const pattern = activePattern;
    const parsed = message.lines.map((line) => normalizeResult(pattern.parseSync(line)));
    respond({ id: message.id, ok: true, result: parsed });
  } catch (error) {
    respond({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

async function compile(config: ParserConfig) {
  const collection = grok.loadDefaultSync();
  const entries = Object.entries(config.patterns);

  if (entries.length > 0) {
    const directory = await mkdtemp(join(tmpdir(), 'logroker-grok-'));
    const customPath = join(directory, 'custom.patterns');
    try {
      const source = entries.map(([name, expression]) => `${name} ${expression}`).join('\n');
      await writeFile(customPath, `${source}\n`, 'utf8');
      collection.loadSync(customPath);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  return {
    pattern: collection.createPattern(config.match),
    multilinePattern: config.multiline
      ? collection.createPattern(config.multiline.pattern)
      : null,
  };
}

function normalizeResult(value: Record<string, unknown> | null): Record<string, string> | null {
  if (!value) {
    return null;
  }
  const result: Record<string, string> = {};
  for (const [key, field] of Object.entries(value)) {
    if (field !== undefined && field !== null) {
      result[key] = String(field);
    }
  }
  return result;
}

function respond(message: WorkerResponse): void {
  parentPort?.postMessage(message);
}
