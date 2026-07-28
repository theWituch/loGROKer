export type ParseStatus = 'raw' | 'matched' | 'unmatched';

export interface LogRecord {
  id: string;
  generation: number;
  sequence: number;
  raw: string;
  parseStatus: ParseStatus;
  fields: Record<string, string>;
}

export type ViewerState = 'starting' | 'live' | 'waiting' | 'error';

export interface ViewerStatus {
  state: ViewerState;
  message: string;
  logPath: string;
  grokPath: string | null;
  parserMode: 'raw' | 'grok';
  parserError: string | null;
  generation: number;
  revision: number;
  initialLines: number;
  maxRecords: number;
  matched: number;
  unmatched: number;
  buffered: number;
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

export interface GrokConfig {
  match: string;
  patterns: Record<string, string>;
}
