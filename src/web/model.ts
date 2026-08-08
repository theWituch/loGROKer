import type { LogRecord } from '../shared/contracts';
import {
  type CompiledLogQuery,
  matchesLogQuery,
} from './search-query';

export const NO_LEVEL = '__no_level__';

export function mergeRecords(
  current: LogRecord[],
  incoming: LogRecord[],
  limit: number,
): LogRecord[] {
  const byId = new Map(current.map((record) => [record.id, record]));
  for (const record of incoming) {
    byId.set(record.id, record);
  }
  return [...byId.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-limit);
}

export function filterRecords(
  records: LogRecord[],
  options: {
    query: CompiledLogQuery;
    levels: ReadonlySet<string>;
    maximumSequence: number | null;
    clearedBefore: number;
  },
): LogRecord[] {
  return records.filter((record) => {
    if (record.sequence <= options.clearedBefore) {
      return false;
    }
    if (options.maximumSequence !== null && record.sequence > options.maximumSequence) {
      return false;
    }
    if (!options.levels.has(levelFilterKey(record.fields.level))) {
      return false;
    }
    return matchesLogQuery(options.query, record);
  });
}

export function commonLevelClass(level: string | undefined): string {
  const normalized = normalizeLogLevel(level);
  if (!normalized) return '';
  const classes: Record<string, string> = {
    TRACE: 'level-trace',
    DEBUG: 'level-debug',
    INFO: 'level-info',
    WARNING: 'level-warning',
    ERROR: 'level-error',
    CRITICAL: 'level-critical',
  };
  return classes[normalized] ?? '';
}

export function normalizeLogLevel(level: string | undefined): string | null {
  const normalized = level?.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === 'WARN') return 'WARNING';
  if (normalized === 'FATAL') return 'CRITICAL';
  return normalized;
}

export function levelFilterKey(level: string | undefined): string {
  return normalizeLogLevel(level) ?? NO_LEVEL;
}
