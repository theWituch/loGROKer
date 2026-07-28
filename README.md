# LoGROKer

A local, full-screen viewer for log files. Odczytuje dopisywane linie w czasie
in real time, parses them with GROK, and displays fields as configurable
kolumny.

## Wymagania

- Node.js 24 LTS lub nowszy
- npm

## Installation and startup

```powershell
npm install
npm run build
npm start -- --log "E:\logs\log.log" --grok "E:\logs\pattern.cfg"
```

The panel will be available at `http://127.0.0.1:3000`. The server deliberately does not
listen on network interfaces.

Tryb bez parsera:

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
| `--log <path>` | Obserwowany plik; wymagany | — |
| `--grok <path>` | Opcjonalna konfiguracja YAML | raw mode |
| `--port <number>` | Port panelu | `3000` |
| `--tail <number>` | Number of initial lines | `1000` |
| `--max-records <number>` | Rozmiar bufora | `10000` |
| `--poll` | Polling dla SMB/NFS | disabled |

## Konfiguracja GROK

```yaml
match: >-
  ^%{TIMESTAMP_ISO8601:timestamp}\s+%{LOGLEVEL:level}\s+%{GREEDYDATA:message}$

patterns:
  MY_LOGGER: '[A-Za-z0-9_.]+'
```

`match` is required. `patterns` is an optional map of custom, single-line
definitions. Saving the corrected configuration triggers automatic compilation
and buffer recalculation. If the new configuration is invalid, the panel
pokazuje komunikat, a ostatni poprawny parser nadal works.

## Viewer behavior

- start od ostatnich 1000 complete lines;
- buffer of up to 10,000 records;
- supports CRLF, LF, UTF-8, partial writes, and file rotation;
- rotation preserves history and starts a new generation;
- lines unmatched by GROK are not hidden;
- column visibility is stored locally in the browser;
- search, level filtering, pause, autoscroll, and clearing the view work
  in the browser.

## Verification

```powershell
npm test
npm run typecheck
npm run build
```

Optional browser tests require Chromium installation:

```powershell
npx playwright install chromium
npm run test:e2e
```
