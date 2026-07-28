import { describe, expect, it } from 'vitest';
import type { LogRecord } from '../src/shared/contracts';
import { filterRecords, mergeRecords } from '../src/web/model';

const records: LogRecord[] = [
  {
    id: '0:1',
    generation: 0,
    sequence: 1,
    raw: 'INFO started',
    parseStatus: 'matched',
    fields: { level: 'INFO', message: 'started' },
    lineCount: 1,
    multiline: false,
    limitReached: false,
    flushReason: 'single',
  },
  {
    id: '0:2',
    generation: 0,
    sequence: 2,
    raw: 'ERROR failure',
    parseStatus: 'matched',
    fields: { level: 'ERROR', message: 'failure' },
    lineCount: 1,
    multiline: false,
    limitReached: false,
    flushReason: 'single',
  },
];

describe('model widoku', () => {
  it('merges records without duplicates and respects the limit', () => {
    expect(mergeRecords(records, [{ ...records[1], raw: 'ERROR zmieniono' }], 1))
      .toEqual([{ ...records[1], raw: 'ERROR zmieniono' }]);
  });

  it('filters by level, text, and pause sequence', () => {
    expect(filterRecords(records, {
      query: 'failure',
      level: 'ERROR',
      maximumSequence: 2,
      clearedBefore: 0,
    })).toEqual([records[1]]);
  });
});
