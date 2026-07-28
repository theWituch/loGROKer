import {
  type ColumnDef,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  LogRecord,
  ViewerSnapshot,
  ViewerStatus,
} from '../shared/contracts';
import { commonLevelClass, filterRecords, mergeRecords } from './model';
import './styles.css';

const VISIBILITY_KEY = 'logroker.columnVisibility.v1';
const FALLBACK_LIMIT = 10_000;

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export default function App() {
  const [records, setRecords] = useState<LogRecord[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [status, setStatus] = useState<ViewerStatus | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('');
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [clearedBefore, setClearedBefore] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    readVisibility,
  );
  const maxRecordsRef = useRef(FALLBACK_LIMIT);

  useEffect(() => {
    const stream = new EventSource('/api/events');
    stream.onopen = () => setConnection('connected');
    stream.onerror = () => setConnection('disconnected');
    stream.addEventListener('snapshot', (event) => {
      const snapshot = parseEvent<ViewerSnapshot>(event);
      setRecords(snapshot.records);
      setFields(snapshot.fields);
      setStatus(snapshot.status);
      maxRecordsRef.current = snapshot.status.maxRecords;
      setConnection('connected');
    });
    stream.addEventListener('append', (event) => {
      const payload = parseEvent<{ records: LogRecord[]; fields: string[] }>(event);
      setRecords((current) => mergeRecords(
        current,
        payload.records,
        maxRecordsRef.current,
      ));
      setFields(payload.fields);
    });
    stream.addEventListener('status', (event) => {
      setStatus(parseEvent<ViewerStatus>(event));
    });
    return () => stream.close();
  }, []);

  useEffect(() => {
    setColumnVisibility((current) => {
      const next = { ...current };
      for (const field of fields) {
        if (next[field] === undefined) next[field] = true;
      }
      if (status?.parserMode === 'raw') {
        next.raw = true;
      } else if (next.raw === undefined) {
        next.raw = false;
      }
      return next;
    });
  }, [fields, status?.parserMode]);

  useEffect(() => {
    localStorage.setItem(VISIBILITY_KEY, JSON.stringify(columnVisibility));
  }, [columnVisibility]);

  const latestSequence = records.at(-1)?.sequence ?? 0;
  const newWhilePaused = pausedAt === null
    ? 0
    : records.filter((record) => record.sequence > pausedAt).length;

  const levels = useMemo(
    () => [...new Set(records.map((record) => record.fields.level).filter(Boolean))].sort(),
    [records],
  );

  useEffect(() => {
    if (level && !levels.includes(level)) {
      setLevel('');
    }
  }, [level, levels]);

  const visibleRecords = useMemo(
    () => filterRecords(records, {
      query,
      level,
      maximumSequence: pausedAt,
      clearedBefore,
    }),
    [records, query, level, pausedAt, clearedBefore],
  );

  const columns = useMemo<ColumnDef<LogRecord>[]>(() => [
    ...fields.map((field): ColumnDef<LogRecord> => ({
      id: field,
      header: field,
      accessorFn: (record) => record.fields[field] ?? '',
      size: defaultColumnSize(field),
      minSize: 80,
      maxSize: 800,
    })),
    {
      id: 'raw',
      header: 'raw',
      accessorFn: (record) => record.raw,
      size: 520,
      minSize: 180,
      maxSize: 1200,
    },
  ], [fields]);

  const table = useReactTable({
    data: visibleRecords,
    columns,
    state: { columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
    getRowId: (row) => row.id,
  });

  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 38,
    overscan: 12,
  });

  useEffect(() => {
    if (autoScroll && pausedAt === null && rows.length > 0) {
      rowVirtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
    }
  }, [autoScroll, pausedAt, rowVirtualizer, rows.length]);

  const togglePause = () => {
    setPausedAt((current) => current === null ? latestSequence : null);
  };
  const clearView = () => {
    setClearedBefore(latestSequence);
    setPausedAt(null);
  };
  const showAllColumns = () => {
    setColumnVisibility(Object.fromEntries(
      [...fields, 'raw'].map((field) => [field, true]),
    ));
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">L</span>
          <div>
            <h1>LoGROKer</h1>
            <p>live log viewer</p>
          </div>
        </div>

        <div className="paths">
          <PathLine label="LOG" value={status?.logPath ?? 'Loading…'} />
          <PathLine
            label="GROK"
            value={status?.grokPath ?? 'brak — raw mode'}
          />
        </div>

        <div className="status-panel">
          <span className={`connection-dot ${connection}`} />
          <div>
            <strong>{statusLabel(connection, status)}</strong>
            <small>{status?.message ?? 'Connecting to server…'}</small>
          </div>
        </div>
      </header>

      {status?.parserError && (
        <div className="error-banner" role="alert">
          <strong>Error GROK:</strong> {status.parserError}
        </div>
      )}

      <section className="toolbar" aria-label="Viewer controls">
        <label className="search-field">
          <span className="sr-only">Szukaj w logach</span>
          <span aria-hidden="true">⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Szukaj we wszystkich polach…"
          />
          {query && (
            <button className="icon-button" onClick={() => setQuery('')} title="Clear">
              ×
            </button>
          )}
        </label>

        {levels.length > 0 && (
          <label className="select-field">
            <span>Poziom</span>
            <select value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="">Wszystkie</option>
              {levels.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
        )}

        <details className="column-picker">
          <summary>Columns <span>{table.getVisibleLeafColumns().length}/{columns.length}</span></summary>
          <div className="column-menu">
            <div className="column-menu-actions">
              <button onClick={showAllColumns}>Show all</button>
              <button onClick={() => setColumnVisibility(
                Object.fromEntries([...fields, 'raw'].map((field) => [field, false])),
              )}>Hide all</button>
            </div>
            {table.getAllLeafColumns().map((column) => (
              <label key={column.id}>
                <input
                  type="checkbox"
                  checked={column.getIsVisible()}
                  onChange={column.getToggleVisibilityHandler()}
                />
                <span>{column.id}</span>
              </label>
            ))}
          </div>
        </details>

        <div className="toolbar-spacer" />

        <label className="toggle-control">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(event) => setAutoScroll(event.target.checked)}
          />
          <span>Autoscroll</span>
        </label>

        <button className={`button ${pausedAt !== null ? 'button-active' : ''}`} onClick={togglePause}>
          {pausedAt === null ? 'Ⅱ Pause' : `▶ Resume${newWhilePaused ? ` (${newWhilePaused})` : ''}`}
        </button>
        <button className="button button-quiet" onClick={clearView}>Clear widok</button>
      </section>

      <section className="table-region">
        <div className="table-summary">
          <span><strong>{visibleRecords.length.toLocaleString('pl-PL')}</strong> widocznych</span>
          <span>{status?.buffered.toLocaleString('pl-PL') ?? 0} in buffer</span>
          {status?.parserMode === 'grok' && (
            <>
              <span className="summary-ok">{status.matched.toLocaleString('pl-PL')} matched</span>
              <span className={status.unmatched ? 'summary-error' : ''}>
                {status.unmatched.toLocaleString('pl-PL')} unmatched
              </span>
            </>
          )}
          <span>generation {status?.generation ?? 0}</span>
        </div>

        <div className="table-scroll" ref={scrollRef}>
          {table.getVisibleLeafColumns().length === 0 ? (
            <div className="empty-state">Select at least one column.</div>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              {pausedAt !== null ? 'The viewer is paused.' : 'No records match the filters.'}
            </div>
          ) : (
            <table className="log-table">
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th key={header.id} style={{ width: header.getSize() }}>
                        <span>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </span>
                        <button
                          className="resize-handle"
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          aria-label={`Resize column ${header.id}`}
                        />
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody style={{ height: rowVirtualizer.getTotalSize() }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  const previous = virtualRow.index > 0 ? rows[virtualRow.index - 1].original : null;
                  const generationStart = previous && previous.generation !== row.original.generation;
                  return (
                    <tr
                      key={row.id}
                      className={[
                        commonLevelClass(row.original.fields.level),
                        row.original.parseStatus === 'unmatched' ? 'row-unmatched' : '',
                        generationStart ? 'generation-start' : '',
                      ].filter(Boolean).join(' ')}
                      style={{
                        height: virtualRow.size,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      {row.original.parseStatus === 'unmatched' ? (
                        <td className="unmatched-cell">
                          <strong>NIEDOPASOWANY</strong>
                          <span title={row.original.raw}>{row.original.raw}</span>
                        </td>
                      ) : row.getVisibleCells().map((cell) => {
                        const value = String(cell.getValue() ?? '');
                        return (
                          <td key={cell.id} style={{ width: cell.column.getSize() }} title={value}>
                            {cell.column.id === 'level' && value ? (
                              <span className={`level-badge ${commonLevelClass(value)}`}>{value}</span>
                            ) : value}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  );
}

function PathLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="path-line">
      <span>{label}</span>
      <code title={value}>{value}</code>
    </div>
  );
}

function parseEvent<T>(event: Event): T {
  return JSON.parse((event as MessageEvent<string>).data) as T;
}

function readVisibility(): VisibilityState {
  try {
    const stored = localStorage.getItem(VISIBILITY_KEY);
    return stored ? JSON.parse(stored) as VisibilityState : {};
  } catch {
    return {};
  }
}

function defaultColumnSize(field: string): number {
  if (field === 'timestamp') return 220;
  if (field === 'level') return 110;
  if (field === 'pid') return 90;
  if (field === 'logger' || field === 'thread') return 260;
  if (field === 'message') return 620;
  return 180;
}

function statusLabel(connection: ConnectionState, status: ViewerStatus | null): string {
  if (connection === 'disconnected') return 'Reconnecting';
  if (!status) return 'Connecting';
  if (status.state === 'live') return 'Live';
  if (status.state === 'waiting') return 'Waiting';
  if (status.state === 'error') return 'Error';
  return 'Starting';
}
