import type {
  MultilineConfig,
  MultilineFlushReason,
} from '../shared/contracts.js';

export interface AssembledEvent {
  generation: number;
  lines: string[];
  raw: string;
  lineCount: number;
  limitReached: boolean;
  flushReason: MultilineFlushReason;
}

interface PendingEvent {
  generation: number;
  lines: string[];
  bytes: number;
}

export class MultilineAssembler {
  private pending: PendingEvent | null = null;

  constructor(private readonly config: MultilineConfig) {}

  push(generation: number, lines: string[], patternMatches: boolean[]): AssembledEvent[] {
    if (lines.length !== patternMatches.length) {
      throw new Error('The number of multiline classifications does not match the number of lines.');
    }

    const output: AssembledEvent[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (this.pending && this.pending.generation !== generation) {
        output.push(...this.flush('rotation'));
      }

      const selected = this.config.negate ? !patternMatches[index] : patternMatches[index];
      if (this.config.what === 'previous') {
        this.pushPrevious(generation, lines[index], selected, output);
      } else {
        this.pushNext(generation, lines[index], selected, output);
      }
    }
    return output;
  }

  flush(reason: MultilineFlushReason): AssembledEvent[] {
    if (!this.pending) {
      return [];
    }
    const output = this.createEvent(this.pending, reason, isLimitReason(reason));
    this.pending = null;
    return [output];
  }

  pendingLineCount(): number {
    return this.pending?.lines.length ?? 0;
  }

  pendingSnapshot(): { generation: number; lines: string[] } | null {
    return this.pending
      ? { generation: this.pending.generation, lines: [...this.pending.lines] }
      : null;
  }

  private pushPrevious(
    generation: number,
    line: string,
    belongsToPrevious: boolean,
    output: AssembledEvent[],
  ): void {
    if (!belongsToPrevious) {
      output.push(...this.flush('boundary'));
      this.start(generation, line, output);
      return;
    }

    if (!this.pending) {
      this.start(generation, line, output);
      return;
    }
    this.appendOrSplit(generation, line, output);
  }

  private pushNext(
    generation: number,
    line: string,
    belongsToNext: boolean,
    output: AssembledEvent[],
  ): void {
    if (belongsToNext) {
      if (!this.pending) {
        this.start(generation, line, output);
      } else {
        this.appendOrSplit(generation, line, output);
      }
      return;
    }

    if (!this.pending) {
      this.start(generation, line, output);
    } else {
      this.appendOrSplit(generation, line, output);
    }
    output.push(...this.flush('boundary'));
  }

  private start(generation: number, line: string, output: AssembledEvent[]): void {
    this.pending = {
      generation,
      lines: [line],
      bytes: Buffer.byteLength(line, 'utf8'),
    };
    if (this.pending.bytes > this.config.maxBytes) {
      output.push(...this.flush('max_bytes'));
    }
  }

  private appendOrSplit(
    generation: number,
    line: string,
    output: AssembledEvent[],
  ): void {
    if (!this.pending) {
      this.start(generation, line, output);
      return;
    }

    const separatorBytes = this.config.skipNewline ? 0 : 1;
    const nextBytes = this.pending.bytes + separatorBytes + Buffer.byteLength(line, 'utf8');
    if (this.pending.lines.length + 1 > this.config.maxLines) {
      output.push(...this.flush('max_lines'));
      this.start(generation, line, output);
      return;
    }
    if (nextBytes > this.config.maxBytes) {
      output.push(...this.flush('max_bytes'));
      this.start(generation, line, output);
      return;
    }

    this.pending.lines.push(line);
    this.pending.bytes = nextBytes;
  }

  private createEvent(
    pending: PendingEvent,
    reason: MultilineFlushReason,
    limitReached: boolean,
  ): AssembledEvent {
    return {
      generation: pending.generation,
      lines: [...pending.lines],
      raw: pending.lines.join(this.config.skipNewline ? '' : '\n'),
      lineCount: pending.lines.length,
      limitReached,
      flushReason: reason,
    };
  }
}

export function singleLineEvents(generation: number, lines: string[]): AssembledEvent[] {
  return lines.map((line) => ({
    generation,
    lines: [line],
    raw: line,
    lineCount: 1,
    limitReached: false,
    flushReason: 'single',
  }));
}

function isLimitReason(reason: MultilineFlushReason): boolean {
  return reason === 'max_lines' || reason === 'max_bytes';
}
