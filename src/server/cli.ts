import { resolve } from 'node:path';

export interface CliOptions {
  logPath: string;
  grokPath: string | null;
  port: number;
  initialLines: number;
  maxRecords: number;
  usePolling: boolean;
}

export function parseCli(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  let usePolling = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--poll') {
      usePolling = true;
      continue;
    }
    if (!argument.startsWith('--')) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for argument ${argument}.`);
    }
    values.set(argument, value);
    index += 1;
  }

  const log = values.get('--log');
  if (!log) {
    throw new Error('Argument --log <path> jest wymagany.');
  }

  const port = integerOption(values, '--port', 3000, 1, 65_535);
  const initialLines = integerOption(values, '--tail', 1000, 0, 1_000_000);
  const maxRecords = integerOption(values, '--max-records', 10_000, 1, 1_000_000);
  if (initialLines > maxRecords) {
    throw new Error('--tail cannot be greater than --max-records.');
  }

  const known = new Set(['--log', '--grok', '--port', '--tail', '--max-records']);
  for (const key of values.keys()) {
    if (!known.has(key)) {
      throw new Error(`Unknown argument: ${key}`);
    }
  }

  return {
    logPath: resolve(log),
    grokPath: values.has('--grok') ? resolve(values.get('--grok') as string) : null,
    port,
    initialLines,
    maxRecords,
    usePolling,
  };
}

function integerOption(
  values: Map<string, string>,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = values.get(name);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} do ${maximum}.`);
  }
  return value;
}
