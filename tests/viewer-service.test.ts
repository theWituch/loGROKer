import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  it('reloads valid GROK and keeps the last parser after an error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'logroker-viewer-'));
    directories.push(directory);
    const logPath = join(directory, 'app.log');
    const grokPath = join(directory, 'pattern.cfg');
    await writeFile(logPath, 'one\n', 'utf8');
    await writeFile(grokPath, 'match: "^%{WORD:value}$"\npatterns: {}\n', 'utf8');

    const service = new ViewerService({
      logPath,
      grokPath,
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
    await writeFile(grokPath, 'match: "^%{INT:number}$"\npatterns: {}\n', 'utf8');
    await reloaded;
    expect(service.snapshot().records[0].parseStatus).toBe('unmatched');

    const rejected = waitForEvent(
      service,
      (event) => event.type === 'status' && Boolean(event.data.parserError),
    );
    await writeFile(grokPath, 'match: [\n', 'utf8');
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
