import type { LogRecord } from '../shared/contracts';

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
    query: string;
    level: string;
    maximumSequence: number | null;
    clearedBefore: number;
  },
): LogRecord[] {
  const needle = options.query.trim().toLocaleLowerCase('pl');
  return records.filter((record) => {
    if (record.sequence <= options.clearedBefore) {
      return false;
    }
    if (options.maximumSequence !== null && record.sequence > options.maximumSequence) {
      return false;
    }
    if (options.level && record.fields.level !== options.level) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return [record.raw, ...Object.values(record.fields)]
      .some((value) => value.toLocaleLowerCase('pl').includes(needle));
  });
}

export function commonLevelClass(level: string | undefined): string {
  const normalized = level?.toUpperCase();
  if (!normalized) return '';
  if (normalized === 'WARN') return 'level-warning';
  if (['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'FATAL'].includes(normalized)) {
    return `level-${normalized.toLowerCase()}`;
  }
  return '';
}
