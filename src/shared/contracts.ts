export type ParseStatus = 'raw' | 'matched' | 'unmatched';

export type MultilineFlushReason =
  | 'single'
  | 'boundary'
  | 'timeout'
  | 'initial'
  | 'rotation'
  | 'configuration'
  | 'shutdown'
  | 'max_lines'
  | 'max_bytes';

export interface LogRecord {
  id: string;
  sourceId: string;
  sourceName: string;
  generation: number;
  sequence: number;
  raw: string;
  parseStatus: ParseStatus;
  fields: Record<string, string>;
  lineCount: number;
  multiline: boolean;
  limitReached: boolean;
  flushReason: MultilineFlushReason;
}

export type ViewerState = 'starting' | 'live' | 'waiting' | 'error';

export interface ViewerStatus {
  state: ViewerState;
  message: string;
  /** Kept for compatibility with single-source consumers. */
  logPath?: string;
  configPath?: string | null;
  parserMode?: 'raw' | 'grok';
  parserError?: string | null;
  generation?: number;
  revision?: number;
  initialLines: number;
  maxRecords: number;
  matched: number;
  unmatched: number;
  buffered: number;
  physicalLines: number;
  pendingMultilineLines: number;
  sources: ViewerSourceStatus[];
}

export interface ViewerSourceStatus {
  id: string;
  name: string;
  logPath: string;
  configPath: string | null;
  state: ViewerState;
  message: string;
  parserMode: 'raw' | 'grok';
  parserError: string | null;
  generation: number;
  revision: number;
  matched: number;
  unmatched: number;
  buffered: number;
  physicalLines: number;
  pendingMultilineLines: number;
}

export interface ViewerSnapshot {
  status: ViewerStatus;
  fields: string[];
  records: LogRecord[];
}

export type ServerEvent =
  | { type: 'snapshot'; data: ViewerSnapshot }
  | { type: 'append'; data: { records: LogRecord[]; fields: string[] } }
  | { type: 'status'; data: ViewerStatus };

export interface ParserConfig {
  match: string;
  patterns: Record<string, string>;
  multiline: MultilineConfig | null;
}

export interface MultilineConfig {
  pattern: string;
  negate: boolean;
  what: 'previous' | 'next';
  autoFlushInterval: number;
  maxLines: number;
  maxBytes: number;
  skipNewline: boolean;
}
