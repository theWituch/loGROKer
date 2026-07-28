import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import type { GrokConfig } from '../shared/contracts.js';

const ALLOWED_KEYS = new Set(['match', 'patterns']);
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

  return { match, patterns };
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
