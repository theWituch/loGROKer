# LoGROKer

A local, full-screen viewer for log files. It reads appended data in real time,
assembles multiline events, parses them with GROK, and displays
fields as configurable columns.

## Wymagania

- Node.js 24 LTS lub nowszy
- npm

## Installation and startup

```powershell
npm install
npm run build
npm start -- --log "E:\logs\log.log" --config "E:\logs\config.yml"
```

Multiple logs can be started. The `--log` and `--config` arguments are paired by
occurrence order, and a configuration name can be explicit:

```powershell
npm start -- --log "E:\logs\app.log" --config "app|E:\logs\app.yml" `
  --log "E:\logs\access.log" --config "E:\logs\access.yml"
```

Configurations can be selected with checkboxes; the selection is stored
in the browser.

The panel will be available at `http://127.0.0.1:3000`. The server deliberately does not
listen on network interfaces.

Mode without a parser or multiline assembly:

```powershell
npm start -- --log "E:\logs\log.log"
```

In development mode, repository samples are used automatically:

```powershell
npm run dev
```

Frontend works wtedy pod `http://127.0.0.1:5173`.

## Argumenty CLI

| Argument | Meaning | Default |
| --- | --- | --- |
| `--log <path>` | Watched file; can be provided multiple times | — |
| `--config <name\|path>` | YAML for the corresponding `--log`; can be provided multiple times | raw mode |
| `--port <number>` | Port panelu | `3000` |
| `--tail <number>` | Number of initial lines | `1000` |
| `--max-records <number>` | Logical record buffer size | `10000` |
| `--poll` | Polling dla SMB/NFS | disabled |

## Plik konfiguracyjny

The `config.yml` file contains the main GROK expression, custom patterns,
and multiline event assembly rules:

```yaml
match: >-
  ^%{TIMESTAMP_ISO8601:timestamp}\s+%{LOGLEVEL:level}\s+%{MULTILINE_DATA:message}$

patterns:
  MULTILINE_DATA: '[\s\S]*'

multiline:
  pattern: '^%{TIMESTAMP_ISO8601}'
  negate: true
  what: previous
  auto_flush_interval: 2
  max_lines: 500
  max_bytes: 10485760
  skip_newline: false
```

`match` is required. `patterns` is an optional map of custom, single-line
definitions. The main expression must allow newline characters if it is to parse
the complete multiline event — the example `MULTILINE_DATA` serves this purpose.

Sekcja `multiline` jest opcjonalna. Jej semantyka odpowiada filtrowi multiline
z Logstash:

- `pattern` — GROK recognizing a boundary, e.g. a timestamp at the start of a line;
- `negate` — inverts the match result;
- `what: previous` — attaches selected lines to the previous event;
- `what: next` — attaches selected lines to the next event;
- `auto_flush_interval` — how many seconds without new data before publishing a record;
- `max_lines` and `max_bytes` — safety limits for the record size;
- `skip_newline` — skleja linie bez separatora `\n`.

The defaults are respectively: `false`, `previous`, 2 sekundy, 500 lines,
10 MiB oraz `false`. Setting `multiline: false` disables assembly.

Saving an updated configuration automatically compiles it and reassembles
events and recalculates the buffer. If the new configuration is invalid, the panel
pokazuje komunikat, a ostatni poprawny parser nadal works.

## Viewer behavior

- starts with the last 1000 complete physical lines;
- has a buffer of up to 10,000 logical records;
- supports CRLF, LF, UTF-8, partial writes, and file rotation;
- flushes a pending record on the next boundary, timeout, rotation,
  configuration change, shutdown, or reaching a limit;
- never combines data from two file generations;
- does not hide orphaned lines or records unmatched by GROK;
- shows a line-count badge for multiline fields, and the full log can be
  opened with a double-click or button and copied;
- the “Pin latest” option pins the last record to the bottom edge, so it
  remains visible while browsing older logs;
- a single click selects a record, while `Shift+click` selects the entire visible
  range from the last selected record;
- `Ctrl+click` adds or removes one record without changing other
  selections;
- column visibility is stored locally in the browser;
- search, level filtering, pause, autoscroll, and clearing the view work
  in the browser.

## Verification

```powershell
npm test
npm run typecheck
npm run build
```

Optional browser tests require Chromium:

```powershell
npx playwright install chromium
npm run test:e2e
```
