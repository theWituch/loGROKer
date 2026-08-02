import {
  type ColumnDef,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  defaultRangeExtractor,
  useVirtualizer,
} from '@tanstack/react-virtual';
import {
  type CSSProperties,
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
  const [pinLatest, setPinLatest] = useState(true);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(() => new Set());
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<LogRecord | null>(null);
  const [copied, setCopied] = useState(false);
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

  useEffect(() => {
    if (!selectedRecord) {
      return;
    }
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedRecord(null);
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [selectedRecord]);

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

  useEffect(() => {
    const availableIds = new Set(records.map((record) => record.id));
    setSelectedRowIds((current) => {
      const next = new Set([...current].filter((id) => availableIds.has(id)));
      return next.size === current.size ? current : next;
    });
    setSelectionAnchorId((current) => (
      current && availableIds.has(current) ? current : null
    ));
  }, [records]);

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
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      const latestIndex = rows.length - 1;
      if (pinLatest && latestIndex >= 0 && !indexes.includes(latestIndex)) {
        indexes.push(latestIndex);
      }
      return indexes;
    },
  });

  useEffect(() => {
    if (autoScroll && pausedAt === null && rows.length > 0) {
      const frame = requestAnimationFrame(() => {
        rowVirtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [autoScroll, pausedAt, rowVirtualizer, rows.length]);

  const togglePause = () => {
    setPausedAt((current) => current === null ? latestSequence : null);
  };
  const clearView = () => {
    setClearedBefore(latestSequence);
    setPausedAt(null);
    setSelectedRowIds(new Set());
    setSelectionAnchorId(null);
  };
  const selectRow = (
    record: LogRecord,
    extendRange: boolean,
    toggleIndividual: boolean,
  ) => {
    const targetIndex = visibleRecords.findIndex((candidate) => candidate.id === record.id);
    const anchorIndex = selectionAnchorId
      ? visibleRecords.findIndex((candidate) => candidate.id === selectionAnchorId)
      : -1;

    if (extendRange && anchorIndex >= 0 && targetIndex >= 0) {
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      setSelectedRowIds(new Set(
        visibleRecords.slice(start, end + 1).map((candidate) => candidate.id),
      ));
      return;
    }

    if (toggleIndividual) {
      const next = new Set(selectedRowIds);
      if (next.has(record.id)) {
        next.delete(record.id);
      } else {
        next.add(record.id);
      }
      setSelectedRowIds(next);
      setSelectionAnchorId(next.has(record.id)
        ? record.id
        : ([...next].at(-1) ?? null));
      return;
    }

    setSelectedRowIds(new Set([record.id]));
    setSelectionAnchorId(record.id);
  };
  const showAllColumns = () => {
    setColumnVisibility(Object.fromEntries(
      [...fields, 'raw'].map((field) => [field, true]),
    ));
  };
  const openRecord = (record: LogRecord) => {
    setCopied(false);
    setSelectedRecord(record);
  };
  const copyRecord = async () => {
    if (!selectedRecord) return;
    await navigator.clipboard.writeText(selectedRecord.raw);
    setCopied(true);
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
            label="CONFIG"
            value={status?.configPath ?? 'brak — raw mode'}
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
          <strong>Configuration error:</strong> {status.parserError}
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

        <label className="toggle-control">
          <input
            type="checkbox"
            checked={pinLatest}
            onChange={(event) => setPinLatest(event.target.checked)}
          />
          <span>Blokuj najnowszy</span>
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
          <span>{status?.physicalLines.toLocaleString('pl-PL') ?? 0} lines fizycznych</span>
          {Boolean(status?.pendingMultilineLines) && (
            <span className="summary-pending">
              {status?.pendingMultilineLines} pending
            </span>
          )}
          {status?.parserMode === 'grok' && (
            <>
              <span className="summary-ok">{status.matched.toLocaleString('pl-PL')} matched</span>
              <span className={status.unmatched ? 'summary-error' : ''}>
                {status.unmatched.toLocaleString('pl-PL')} unmatched
              </span>
            </>
          )}
          <span>generation {status?.generation ?? 0}</span>
          {selectedRowIds.size > 0 && (
            <span className="summary-selected">
              <strong>{selectedRowIds.size.toLocaleString('pl-PL')}</strong> selected
            </span>
          )}
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
                    {headerGroup.headers.map((header, index) => {
                      const size = header.getSize();
                      const isLastVisible = index === headerGroup.headers.length - 1;
                      return (
                        <th
                          key={header.id}
                          style={{
                            width: size,
                            flex: isLastVisible ? `1 0 ${size}px` : `0 0 ${size}px`,
                          }}
                        >
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
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody style={{ height: rowVirtualizer.getTotalSize() }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  const previous = virtualRow.index > 0 ? rows[virtualRow.index - 1].original : null;
                  const generationStart = previous && previous.generation !== row.original.generation;
                  const latestVisible = virtualRow.index === rows.length - 1;
                  const visibleCells = row.getVisibleCells();
                  const multilineCell = row.original.multiline
                    ? (
                      visibleCells.find((cell) => (
                        String(cell.getValue() ?? '').includes('\n')
                      ))
                      ?? visibleCells.find((cell) => cell.column.id === 'message')
                      ?? visibleCells.find((cell) => cell.column.id === 'raw')
                    )
                    : undefined;
                  return (
                    <tr
                      key={row.id}
                      ref={rowVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      className={[
                        commonLevelClass(row.original.fields.level),
                        row.original.parseStatus === 'unmatched' ? 'row-unmatched' : '',
                        generationStart ? 'generation-start' : '',
                        latestVisible ? 'row-latest' : '',
                        latestVisible && pinLatest ? 'row-pinned' : '',
                        selectedRowIds.has(row.original.id) ? 'row-selected' : '',
                      ].filter(Boolean).join(' ')}
                      style={{
                        transform: `translateY(${virtualRow.start}px)`,
                        '--latest-row-start': `${virtualRow.start}px`,
                      } as CSSProperties}
                      aria-selected={selectedRowIds.has(row.original.id)}
                      onClick={(event) => {
                        const toggleIndividual = event.ctrlKey || event.metaKey;
                        if (event.shiftKey || toggleIndividual) event.preventDefault();
                        selectRow(row.original, event.shiftKey, toggleIndividual);
                      }}
                      onDoubleClick={() => openRecord(row.original)}
                    >
                      {row.original.parseStatus === 'unmatched' ? (
                        <td className="unmatched-cell">
                          <strong>NIEDOPASOWANY</strong>
                          <span title={row.original.raw}>{row.original.raw}</span>
                          {row.original.multiline && (
                            <button
                              className="multiline-badge"
                              onClick={(event) => {
                                event.stopPropagation();
                                openRecord(row.original);
                              }}
                              title="Show the full multiline record"
                            >
                              {row.original.lineCount} lines
                            </button>
                          )}
                        </td>
                      ) : visibleCells.map((cell, index) => {
                        const value = String(cell.getValue() ?? '');
                        const size = cell.column.getSize();
                        const isLastVisible = index === visibleCells.length - 1;
                        const showsMultilineBadge = multilineCell?.id === cell.id;
                        const renderedValue = cell.column.id === 'level' && value
                          ? <span className={`level-badge ${commonLevelClass(value)}`}>{value}</span>
                          : value;
                        return (
                          <td
                            key={cell.id}
                            className={showsMultilineBadge ? 'cell-multiline' : undefined}
                            style={{
                              width: size,
                              flex: isLastVisible ? `1 0 ${size}px` : `0 0 ${size}px`,
                            }}
                            title={value}
                          >
                            {showsMultilineBadge ? (
                              <>
                                <span className="multiline-cell-value">{renderedValue}</span>
                                <button
                                  className="multiline-badge"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openRecord(row.original);
                                  }}
                                  title="Show the full multiline record"
                                >
                                  {row.original.lineCount} lines
                                </button>
                              </>
                            ) : renderedValue}
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

      {selectedRecord && (
        <div className="record-overlay" role="presentation" onMouseDown={() => setSelectedRecord(null)}>
          <aside
            className="record-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Log record details"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span className="drawer-kicker">Rekord #{selectedRecord.sequence}</span>
                <h2>{selectedRecord.lineCount} {selectedRecord.lineCount === 1 ? 'line' : 'lines'}</h2>
              </div>
              <button className="drawer-close" onClick={() => setSelectedRecord(null)} aria-label="Close">
                ×
              </button>
            </header>

            <div className="record-meta">
              <span>generation {selectedRecord.generation}</span>
              <span>{selectedRecord.parseStatus}</span>
              <span>{selectedRecord.flushReason}</span>
              {selectedRecord.limitReached && <strong>limit reached</strong>}
            </div>

            <section className="drawer-fields">
              <h3>Pola sparsowane</h3>
              <dl>
                {Object.entries(selectedRecord.fields).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="drawer-raw">
              <div>
                <h3>Full log</h3>
                <button className="button" onClick={() => void copyRecord()}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre>{selectedRecord.raw}</pre>
            </section>
          </aside>
        </div>
      )}
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
