import { describe, expect, it } from 'vitest';
import type { MultilineConfig } from '../src/shared/contracts';
import { MultilineAssembler } from '../src/server/multiline-assembler';

const previousConfig: MultilineConfig = {
  pattern: '^%{TIMESTAMP_ISO8601}',
  negate: true,
  what: 'previous',
  autoFlushInterval: 2,
  maxLines: 500,
  maxBytes: 10 * 1024 * 1024,
  skipNewline: false,
};

describe('MultilineAssembler', () => {
  it('attaches lines without a timestamp to the previous event', () => {
    const assembler = new MultilineAssembler(previousConfig);
    const emitted = assembler.push(0, [
      '2025-11-07T10:00:00Z ERROR failure',
      'Traceback:',
      '  at worker.py:10',
      '2025-11-07T10:00:01Z INFO works',
    ], [true, false, false, true]);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      generation: 0,
      lineCount: 3,
      flushReason: 'boundary',
      limitReached: false,
    });
    expect(emitted[0].raw).toContain('Traceback:\n  at worker.py:10');
    expect(assembler.pendingLineCount()).toBe(1);
    expect(assembler.flush('timeout')[0]).toMatchObject({
      raw: '2025-11-07T10:00:01Z INFO works',
      flushReason: 'timeout',
    });
  });

  it('keeps an orphaned continuation instead of losing it', () => {
    const assembler = new MultilineAssembler(previousConfig);
    const output = assembler.push(0, [
      'orphan continuation',
      '2025-11-07T10:00:00Z INFO start',
    ], [false, true]);

    expect(output).toHaveLength(1);
    expect(output[0].raw).toBe('orphan continuation');
    expect(output[0].flushReason).toBe('boundary');
  });

  it('supports what: next mode', () => {
    const assembler = new MultilineAssembler({
      ...previousConfig,
      pattern: '\\\\$',
      negate: false,
      what: 'next',
    });
    const output = assembler.push(0, ['first \\', 'second \\', 'end', 'separate'], [
      true,
      true,
      false,
      false,
    ]);

    expect(output.map((event) => event.raw)).toEqual([
      'first \\\nsecond \\\nend',
      'separate',
    ]);
  });

  it('splits the event by the lines limit without losing data', () => {
    const assembler = new MultilineAssembler({
      ...previousConfig,
      maxLines: 2,
    });
    const output = assembler.push(0, ['start', 'one', 'two'], [true, false, false]);

    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      raw: 'start\none',
      lineCount: 2,
      flushReason: 'max_lines',
      limitReached: true,
    });
    expect(assembler.pendingSnapshot()?.lines).toEqual(['two']);
  });

  it('splits an event at the byte limit and respects skip_newline', () => {
    const assembler = new MultilineAssembler({
      ...previousConfig,
      maxBytes: 4,
      skipNewline: true,
    });
    const output = assembler.push(0, ['ab', 'cd', 'e'], [true, false, false]);

    expect(output[0]).toMatchObject({
      raw: 'abcd',
      flushReason: 'max_bytes',
      limitReached: true,
    });
    expect(assembler.flush('shutdown')[0].raw).toBe('e');
  });

  it('does not combine records from different file generations', () => {
    const assembler = new MultilineAssembler(previousConfig);
    assembler.push(4, ['2025-11-07T10:00:00Z INFO old'], [true]);
    const output = assembler.push(5, ['2025-11-07T10:00:01Z INFO new'], [true]);

    expect(output[0]).toMatchObject({
      generation: 4,
      flushReason: 'rotation',
    });
    expect(assembler.pendingSnapshot()?.generation).toBe(5);
  });
});
