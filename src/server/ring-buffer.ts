export class RingBuffer<T> {
  private items: T[] = [];

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('Buffer capacity must be a positive integer.');
    }
  }

  push(...values: T[]): T[] {
    this.items.push(...values);
    const overflow = Math.max(0, this.items.length - this.capacity);
    return overflow > 0 ? this.items.splice(0, overflow) : [];
  }

  replace(values: T[]): void {
    this.items = values.slice(-this.capacity);
  }

  clear(): void {
    this.items = [];
  }

  toArray(): T[] {
    return [...this.items];
  }

  get length(): number {
    return this.items.length;
  }
}
