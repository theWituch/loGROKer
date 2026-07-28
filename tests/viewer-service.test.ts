import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerEvent } from '../src/shared/contracts';
import { ViewerService } from '../src/server/viewer-service';

const services: ViewerService[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()));
  await Promise.all(directories.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

describe('ViewerService', () => {
  it('assembles the supplied sample into logical records before GROK parsing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'logroker-multiline-'));
    directories.push(directory);
    const logPath = join(directory, 'log.log');
    const configPath = join(directory, 'config.yml');
    const source = await readFile(resolve('log.log'), 'utf8');
    const physicalLines = source.split(/\r?\n/).filter(Boolean);
    const logicalRecords = physicalLines.filter((line) => /^\d{4}-\d{2}-\d{2}T/.test(line));
    await writeFile(logPath, source, 'utf8');
    await writeFile(configPath, await readFile(resolve('config.yml'), 'utf8'), 'utf8');

    const service = new ViewerService({
      logPath,
      configPath,
      initialLines: 1000,
      maxRecords: 100,
      usePolling: true,
    });
    services.push(service);
    await service.start();

    const snapshot = service.snapshot();
    expect(snapshot.status).toMatchObject({
      physicalLines: physicalLines.length,
      buffered: logicalRecords.length,
      matched: logicalRecords.length,
      unmatched: 0,
      pendingMultilineLines: 0,
    });
    const stackTrace = snapshot.records.find((record) => record.raw.includes('Traceback'));
    expect(stackTrace).toMatchObject({
      parseStatus: 'matched',
      multiline: true,
    });
    expect(stackTrace?.lineCount).toBeGreaterThan(1);
    expect(stackTrace?.fields.message).toContain('RuntimeError');

    if (source.includes('Server:s1')) {
      const notification = snapshot.records.find((record) => record.raw.includes('Server:s1'));
      expect(notification).toMatchObject({
        parseStatus: 'matched',
        multiline: true,
        lineCount: 3,
      });
      expect(notification?.fields.message).toContain('City changed');
    }
  });

  it('emituje ostatni rekord multiline po auto_flush_interval', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'logroker-timeout-'));
    directories.push(directory);
    const logPath = join(directory, 'app.log');
    const configPath = join(directory, 'config.yml');
    await writeFile(logPath, '', 'utf8');
    await writeFile(configPath, `
match: '^%{MULTILINE_DATA:message}$'
patterns:
  MULTILINE_DATA: '[\\s\\S]*'
multiline:
  pattern: '^%{TIMESTAMP_ISO8601}'
  negate: true
  what: previous
  auto_flush_interval: 0.05
`, 'utf8');

    const service = new ViewerService({
      logPath,
      configPath,
      initialLines: 10,
      maxRecords: 100,
      usePolling: true,
    });
    services.push(service);
    await service.start();

    const appended = waitForEvent(service, (event) => event.type === 'append');
    await appendFile(logPath, '2025-11-07T10:00:00Z ERROR failure\nTraceback\n', 'utf8');
    const appendEvent = await appended;
    if (appendEvent.type !== 'append') {
      throw new Error('Oczekiwano zdarzenia append.');
    }
    expect(appendEvent.data.records).toEqual([
      expect.objectContaining({
        raw: '2025-11-07T10:00:00Z ERROR failure\nTraceback',
        lineCount: 2,
        multiline: true,
        flushReason: 'timeout',
      }),
    ]);
  });

  it('rebuilds the existing buffer after enabling multiline during hot reload', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'logroker-rebuild-'));
    directories.push(directory);
    const logPath = join(directory, 'app.log');
    const configPath = join(directory, 'config.yml');
    await writeFile(logPath, 'START first\ncontinuation\nSTART second\n', 'utf8');
    await writeFile(configPath, `
match: '^%{GREEDYDATA:message}$'
patterns: {}
`, 'utf8');

    const service = new ViewerService({
      logPath,
      configPath,
      initialLines: 10,
      maxRecords: 100,
      usePolling: true,
    });
    services.push(service);
    await service.start();
    expect(service.snapshot().records).toHaveLength(3);

    const reloaded = waitForEvent(
      service,
      (event) => event.type === 'snapshot' && event.data.status.revision === 2,
    );
    await writeFile(configPath, `
match: '^%{MULTILINE_DATA:message}$'
patterns:
  MULTILINE_DATA: '[\\s\\S]*'
multiline:
  pattern: '^START'
  negate: true
  what: previous
`, 'utf8');
    await reloaded;

    expect(service.snapshot().records).toEqual([
      expect.objectContaining({
        raw: 'START first\ncontinuation',
        lineCount: 2,
        multiline: true,
        parseStatus: 'matched',
      }),
      expect.objectContaining({
        raw: 'START second',
        lineCount: 1,
        multiline: false,
        parseStatus: 'matched',
        flushReason: 'configuration',
      }),
    ]);
  });

  it('reloads valid GROK and keeps the last parser after an error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'logroker-viewer-'));
    directories.push(directory);
    const logPath = join(directory, 'app.log');
    const configPath = join(directory, 'config.yml');
    await writeFile(logPath, 'one\n', 'utf8');
    await writeFile(configPath, 'match: "^%{WORD:value}$"\npatterns: {}\n', 'utf8');

    const service = new ViewerService({
      logPath,
      configPath,
      initialLines: 10,
      maxRecords: 100,
      usePolling: true,
    });
    services.push(service);
    await service.start();
    expect(service.snapshot().records[0].fields).toEqual({ value: 'one' });

    const reloaded = waitForEvent(
      service,
      (event) => event.type === 'snapshot' && event.data.status.revision === 2,
    );
    await writeFile(configPath, 'match: "^%{INT:number}$"\npatterns: {}\n', 'utf8');
    await reloaded;
    expect(service.snapshot().records[0].parseStatus).toBe('unmatched');

    const rejected = waitForEvent(
      service,
      (event) => event.type === 'status' && Boolean(event.data.parserError),
    );
    await writeFile(configPath, 'match: [\n', 'utf8');
    await rejected;

    const appended = waitForEvent(service, (event) => event.type === 'append');
    await appendFile(logPath, '42\n', 'utf8');
    const appendEvent = await appended;
    if (appendEvent.type !== 'append') {
      throw new Error('Oczekiwano zdarzenia append.');
    }
    expect(appendEvent.data.records.at(-1)).toMatchObject({
      parseStatus: 'matched',
      fields: { number: '42' },
    });
  });
});

function waitForEvent(
  service: ViewerService,
  predicate: (event: ServerEvent) => boolean,
): Promise<ServerEvent> {
  return new Promise((resolve) => {
    const listener = (event: ServerEvent) => {
      if (predicate(event)) {
        service.off('event', listener);
        resolve(event);
      }
    };
    service.on('event', listener);
  });
}
