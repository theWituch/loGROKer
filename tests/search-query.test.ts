import { describe, expect, it } from 'vitest';
import type { LogRecord } from '../src/shared/contracts';
import {
  appendCellFilter,
  compileLogQuery,
  isFilterableCellValue,
  matchesLogQuery,
  toSearchDocument,
} from '../src/web/search-query';

const record: LogRecord = {
  id: '0:42',
  sourceId: 'test.app',
  sourceName: 'test.app',
  generation: 0,
  sequence: 42,
  raw: 'ERROR Database connection failed',
  parseStatus: 'matched',
  fields: {
    level: 'ERROR',
    message: 'Database connection failed',
    pid: '22720',
  },
  lineCount: 14,
  multiline: true,
  limitReached: false,
  flushReason: 'boundary',
};

function matches(query: string, subject: LogRecord = record): boolean {
  return matchesLogQuery(compileLogQuery(query), subject);
}

describe('log search DSL', () => {
  it('appends include and exclude filters without changing OR precedence', () => {
    expect(appendCellFilter('', 'level', 'ERROR', 'include'))
      .toBe('"level":"ERROR"');
    expect(appendCellFilter('level:ERROR', 'pid', '22720', 'exclude'))
      .toBe('level:ERROR AND NOT "pid":"22720"');
    expect(appendCellFilter(
      'level:INFO OR level:ERROR',
      'message',
      'Database connection failed',
      'include',
    )).toBe(
      '(level:INFO OR level:ERROR) AND "message":"Database connection failed"',
    );
  });

  it('escapes generated field and value literals', () => {
    const query = appendCellFilter(
      '',
      'field name',
      'say "hello" from \\server',
      'include',
    );
    expect(query).toBe('"field name":"say \\"hello\\" from \\\\server"');
    expect(query && matchesLogQuery(compileLogQuery(query), {
      ...record,
      fields: { 'field name': 'say "hello" from \\server' },
    })).toBe(true);
  });

  it('rejects quick filters for invalid queries and unsupported cell values', () => {
    expect(appendCellFilter('level:ERROR AND (', 'pid', '22720', 'include')).toBeNull();
    expect(appendCellFilter('', 'message', 'first\nsecond', 'include')).toBeNull();
    expect(isFilterableCellValue('')).toBe(false);
    expect(isFilterableCellValue('first\r\nsecond')).toBe(false);
    expect(isFilterableCellValue('single line')).toBe(true);
  });

  it('supports terms, fields, operators, parentheses, and wildcards', () => {
    expect(matches('database connection')).toBe(true);
    expect(matches('level:ERROR AND NOT message:timeout')).toBe(true);
    expect(matches('(level:INFO OR level:ERROR) AND message:connect*')).toBe(true);
    expect(matches('level:INFO OR message:timeout')).toBe(false);
  });

  it('exposes dynamic GROK fields and stable system fields', () => {
    expect(matches('pid:22720')).toBe(true);
    expect(matches('_source:test.app AND _status:matched')).toBe(true);
    expect(matches('_sequence:>40 AND _lines:=14 AND _multiline:true')).toBe(true);
    expect(matches('unknown:value')).toBe(false);
  });

  it('gives system fields precedence on name collisions', () => {
    const colliding = {
      ...record,
      fields: { ...record.fields, raw: 'GROK value', _source: 'another source' },
    };
    expect(toSearchDocument(colliding).raw).toBe(record.raw);
    expect(toSearchDocument(colliding)._source).toBe(record.sourceName);
  });

  it('preserves Liqe case semantics', () => {
    expect(matches('level:error')).toBe(true);
    expect(matches('message:"Database connection"')).toBe(true);
    expect(matches('message:"database connection"')).toBe(false);
    expect(matches('LEVEL:error')).toBe(false);
  });

  it('rejects regexes and invalid syntax with zero matches', () => {
    const regex = compileLogQuery('message:/connection/i');
    expect(regex.status).toBe('invalid');
    if (regex.status === 'invalid') {
      expect(regex.error.message).toContain('Regular expressions');
      expect(regex.error.column).toBe(9);
    }
    expect(matchesLogQuery(regex, record)).toBe(false);

    const invalid = compileLogQuery('level:ERROR AND (');
    expect(invalid.status).toBe('invalid');
    expect(matchesLogQuery(invalid, record)).toBe(false);
  });

  it('treats an empty query as no filter', () => {
    expect(matches('   ')).toBe(true);
  });
});
