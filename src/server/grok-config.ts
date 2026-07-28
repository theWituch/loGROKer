import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import type { GrokConfig, MultilineConfig } from '../shared/contracts.js';

const ALLOWED_KEYS = new Set(['match', 'patterns', 'multiline']);
const ALLOWED_MULTILINE_KEYS = new Set([
  'pattern',
  'negate',
  'what',
  'auto_flush_interval',
  'max_lines',
  'max_bytes',
  'skip_newline',
]);
const PATTERN_NAME = /^[A-Z][A-Z0-9_]*$/;

export function parseGrokConfig(source: string): GrokConfig {
  let raw: unknown;
  try {
    raw = parse(source, {
      maxAliasCount: 0,
      schema: 'core',
    });
  } catch (error) {
    throw new Error(`Invalid YAML: ${errorMessage(error)}`);
  }

  if (!isPlainObject(raw)) {
    throw new Error('GROK configuration must be a YAML object.');
  }

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`Unknown parser configuration field konfiguracji GROK: ${key}`);
    }
  }

  if (typeof raw.match !== 'string' || raw.match.trim().length === 0) {
    throw new Error('The "match" field must be a non-empty GROK expression.');
  }
  const match = raw.match.trim();
  if (/[\r\n]/.test(match)) {
    throw new Error('The "match" field must fit on one line after YAML folding.');
  }

  const patterns: Record<string, string> = {};
  if (raw.patterns !== undefined) {
    if (!isPlainObject(raw.patterns)) {
      throw new Error('The "patterns" field must map names to regular expressions.');
    }
    for (const [name, expression] of Object.entries(raw.patterns)) {
      if (!PATTERN_NAME.test(name)) {
        throw new Error(`Invalid pattern name "${name}". Use A-Z, 0-9, and _.`);
      }
      if (
        typeof expression !== 'string'
        || expression.length === 0
        || /[\r\n]/.test(expression)
      ) {
        throw new Error(`Pattern "${name}" must be non-empty, single-line text.`);
      }
      patterns[name] = expression;
    }
  }

  return {
    match,
    patterns,
    multiline: parseMultiline(raw.multiline),
  };
}

export async function loadGrokConfig(path: string): Promise<GrokConfig> {
  const source = await readFile(path, 'utf8');
  return parseGrokConfig(source);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseMultiline(value: unknown): MultilineConfig | null {
  if (value === undefined || value === null || value === false) {
    return null;
  }
  if (!isPlainObject(value)) {
    throw new Error('The "multiline" field must be a YAML object.');
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_MULTILINE_KEYS.has(key)) {
      throw new Error(`Unknown parser configuration field konfiguracji multiline: ${key}`);
    }
  }
  if (typeof value.pattern !== 'string' || value.pattern.trim().length === 0) {
    throw new Error('The "multiline.pattern" field must be a non-empty pattern.');
  }
  const pattern = value.pattern.trim();
  if (/[\r\n]/.test(pattern)) {
    throw new Error('The "multiline.pattern" field must fit on one line.');
  }

  const negate = booleanOption(value, 'negate', false);
  const what = value.what ?? 'previous';
  if (what !== 'previous' && what !== 'next') {
    throw new Error('The "multiline.what" field must be "previous" or "next".');
  }

  return {
    pattern,
    negate,
    what,
    autoFlushInterval: numberOption(value, 'auto_flush_interval', 2, 0.05, 3600),
    maxLines: integerOption(value, 'max_lines', 500, 1, 100_000),
    maxBytes: integerOption(value, 'max_bytes', 10 * 1024 * 1024, 1, 1024 * 1024 * 1024),
    skipNewline: booleanOption(value, 'skip_newline', false),
  };
}

function booleanOption(
  value: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const option = value[key];
  if (option === undefined) {
    return fallback;
  }
  if (typeof option !== 'boolean') {
    throw new Error(`Field "multiline.${key}" must be true or false.`);
  }
  return option;
}

function numberOption(
  value: Record<string, unknown>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const option = value[key];
  if (option === undefined) {
    return fallback;
  }
  if (typeof option !== 'number' || !Number.isFinite(option) || option < minimum || option > maximum) {
    throw new Error(`Field "multiline.${key}" must be a number from ${minimum} do ${maximum}.`);
  }
  return option;
}

function integerOption(
  value: Record<string, unknown>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const option = numberOption(value, key, fallback, minimum, maximum);
  if (!Number.isInteger(option)) {
    throw new Error(`Field "multiline.${key}" must be an integer.`);
  }
  return option;
}
