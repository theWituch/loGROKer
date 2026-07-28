import { mkdtemp, rm, writeFile, appendFile, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { FileTailer, readLastCompleteLines } from '../src/server/tailer';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

describe('readLastCompleteLines', () => {
  it('returns the last complete CRLF lines and preserves the fragment', async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, 'app.log');
    await writeFile(path, 'jeden\r\ndwa\r\ntrzy\r\nfragment', 'utf8');

    await expect(readLastCompleteLines(path, 2)).resolves.toEqual({
      lines: ['dwa', 'trzy'],
      remainder: 'fragment',
    });
  });
});

describe('FileTailer', () => {
  it('emits appended complete lines and a new generation after truncation', async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, 'app.log');
    await writeFile(path, 'start\n', 'utf8');
    const tailer = new FileTailer(path, { initialLines: 10, usePolling: true });

    const initial = await tailer.start();
    expect(initial.lines).toEqual(['start']);

    const appended = waitForLines(tailer);
    await appendFile(path, 'part', 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 150));
    await appendFile(path, '-continuation\n', 'utf8');
    await expect(appended).resolves.toMatchObject({
      generation: 0,
      lines: ['part-continuation'],
    });

    const rotation = new Promise<number>((resolve) => {
      tailer.once('rotation', (event) => resolve(event.generation));
    });
    await truncate(path, 0);
    expect(await rotation).toBe(1);
    await tailer.stop();
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'logroker-test-'));
  directories.push(directory);
  return directory;
}

function waitForLines(tailer: FileTailer) {
  return new Promise<{ generation: number; lines: string[] }>((resolve) => {
    tailer.once('lines', resolve);
  });
}
