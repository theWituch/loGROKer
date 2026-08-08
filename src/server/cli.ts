import { basename, extname, resolve } from 'node:path';

export interface SourceDefinition {
  id: string;
  name: string;
  logPath: string;
  configPath: string | null;
}

export interface CliOptions {
  sources: SourceDefinition[];
  port: number;
  initialLines: number;
  maxRecords: number;
  usePolling: boolean;
}

export function parseCli(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  const logs: string[] = [];
  const configs: string[] = [];
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
    if (argument === '--log') {
      logs.push(value);
    } else if (argument === '--config') {
      configs.push(value);
    } else {
      values.set(argument, value);
    }
    index += 1;
  }

  if (logs.length === 0) {
    throw new Error('Argument --log <path> jest wymagany.');
  }

  if (configs.length !== 0 && configs.length !== logs.length) {
    throw new Error('The number of --log and --config arguments must match.');
  }

  const port = integerOption(values, '--port', 3000, 1, 65_535);
  const initialLines = integerOption(values, '--tail', 1000, 0, 1_000_000);
  const maxRecords = integerOption(values, '--max-records', 10_000, 1, 1_000_000);
  if (initialLines > maxRecords) {
    throw new Error('--tail cannot be greater than --max-records.');
  }

  const known = new Set(['--port', '--tail', '--max-records']);
  for (const key of values.keys()) {
    if (!known.has(key)) {
      throw new Error(`Unknown argument: ${key}`);
    }
  }

  const sources = logs.map((log, index) => {
    const config = configs.length === 0 ? null : parseConfigSpec(configs[index]);
    const name = config?.name ?? basename(log, extname(log));
    if (!name) {
      throw new Error(`Cannot determine a source name for log "${log}".`);
    }
    return {
      id: name,
      name,
      logPath: resolve(log),
      configPath: config?.path ?? null,
    };
  });
  const duplicate = sources.find((source, index) => sources.some(
    (candidate, candidateIndex) => candidateIndex < index && candidate.id === source.id,
  ));
  if (duplicate) {
    throw new Error(`Source name "${duplicate.id}" occurs more than once.`);
  }

  return {
    sources,
    port,
    initialLines,
    maxRecords,
    usePolling,
  };
}

function parseConfigSpec(raw: string): { name: string; path: string } {
  const separator = raw.indexOf('|');
  const path = separator >= 0 ? raw.slice(separator + 1).trim() : raw.trim();
  const name = separator >= 0 ? raw.slice(0, separator).trim() : basename(path, extname(path));
  if (!name || !path || raw.indexOf('|', separator + 1) >= 0) {
    throw new Error(`Invalid --config value "${raw}". Use name|path or path.`);
  }
  return { name, path: resolve(path) };
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
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}
