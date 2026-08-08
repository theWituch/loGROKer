import { describe, expect, it } from 'vitest';
import { RingBuffer } from '../src/server/ring-buffer';

describe('RingBuffer', () => {
  it('deletes oldest items when limit is reached', () => {
    const buffer = new RingBuffer<number>(3);
    expect(buffer.push(1, 2)).toEqual([]);
    expect(buffer.push(3, 4)).toEqual([1]);
    expect(buffer.toArray()).toEqual([2, 3, 4]);
  });

  it('trims data while replacing contents', () => {
    const buffer = new RingBuffer<number>(2);
    buffer.replace([1, 2, 3]);
    expect(buffer.toArray()).toEqual([2, 3]);
  });
});
