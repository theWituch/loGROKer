import type { LogRecord } from '../shared/contracts';
import {
  type CompiledLogQuery,
  matchesLogQuery,
} from './search-query';

export const NO_LEVEL = '__no_level__';

export type ColumnDropPosition = 'before' | 'after';

export function sanitizeColumnOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.filter((item): item is string => {
    if (typeof item !== 'string' || item.length === 0 || seen.has(item)) {
      return false;
    }
    seen.add(item);
    return true;
  });
}

export function completeColumnOrder(
  preferred: readonly string[],
  available: readonly string[],
): string[] {
  return sanitizeColumnOrder([...preferred, ...available]);
}

export function reorderColumn(
  order: readonly string[],
  draggedId: string,
  targetId: string,
  position: ColumnDropPosition,
): string[] {
  const normalized = sanitizeColumnOrder(order);
  if (draggedId === targetId || !normalized.includes(draggedId)) {
    return normalized;
  }

  const withoutDragged = normalized.filter((id) => id !== draggedId);
  const targetIndex = withoutDragged.indexOf(targetId);
  if (targetIndex < 0) return normalized;

  withoutDragged.splice(targetIndex + (position === 'after' ? 1 : 0), 0, draggedId);
  return withoutDragged;
}

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
