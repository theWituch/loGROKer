import { describe, expect, it } from 'vitest';
import type { LogRecord } from '../src/shared/contracts';
import {
  NO_LEVEL,
  commonLevelClass,
  filterRecords,
  levelFilterKey,
  mergeRecords,
} from '../src/web/model';
import { compileLogQuery } from '../src/web/search-query';

const records: LogRecord[] = [
  {
    id: '0:1',
    sourceId: 'test',
    sourceName: 'test',
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
    sourceId: 'test',
    sourceName: 'test',
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

describe('view model', () => {
  it('merges records without duplicates and respects the limit', () => {
    expect(mergeRecords(records, [{ ...records[1], raw: 'ERROR zmieniono' }], 1))
      .toEqual([{ ...records[1], raw: 'ERROR zmieniono' }]);
  });

  it('filters by level, text, and pause sequence', () => {
    expect(filterRecords(records, {
      query: compileLogQuery('failure'),
      levels: new Set(['ERROR']),
      maximumSequence: 2,
      clearedBefore: 0,
    })).toEqual([records[1]]);
  });

  it('filters level combinations, aliases, and records without a level', () => {
    const warning = {
      ...records[0],
      id: '0:3',
      sequence: 3,
      raw: 'WARN warning',
      fields: { level: 'WARN', message: 'warning' },
    };
    const withoutLevel = {
      ...records[0],
      id: '0:4',
      sequence: 4,
      raw: 'without level',
      fields: { message: 'without level' },
    };
    expect(filterRecords([...records, warning, withoutLevel], {
      query: compileLogQuery(''),
      levels: new Set(['WARNING', NO_LEVEL]),
      maximumSequence: null,
      clearedBefore: 0,
    })).toEqual([warning, withoutLevel]);
    expect(levelFilterKey('fatal')).toBe('CRITICAL');
    expect(levelFilterKey(undefined)).toBe(NO_LEVEL);
  });

  it('maps all supported levels to color classes', () => {
    expect([
      'TRACE',
      'DEBUG',
      'INFO',
      'WARN',
      'WARNING',
      'ERROR',
      'CRITICAL',
      'FATAL',
    ].map(commonLevelClass)).toEqual([
      'level-trace',
      'level-debug',
      'level-info',
      'level-warning',
      'level-warning',
      'level-error',
      'level-critical',
      'level-critical',
    ]);
    expect(commonLevelClass('custom')).toBe('');
  });
});
