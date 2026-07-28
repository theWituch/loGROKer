import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadGrokConfig } from '../src/server/grok-config';
import { GrokParserService } from '../src/server/grok-parser-service';

const services: GrokParserService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()));
});

describe('GrokParserService', () => {
  it('parses the supplied sample into the expected fields', async () => {
    const service = new GrokParserService();
    services.push(service);
    await service.configure(await loadGrokConfig(resolve('pattern.cfg')));

    const lines = (await readFile(resolve('log.log'), 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean);
    const results = await service.parse(lines);

    expect(results).toHaveLength(lines.length);
    for (const [index, result] of results.entries()) {
      if (/^\d{4}-\d{2}-\d{2}T/.test(lines[index])) {
        expect(result, `Did not match: ${lines[index]}`).not.toBeNull();
        expect(Object.keys(result ?? {})).toEqual([
          'timestamp',
          'level',
          'logger',
          'pid',
          'thread',
          'message',
        ]);
      } else {
        expect(result, `An extra line should not match: ${lines[index]}`).toBeNull();
      }
    }
  });

  it('supports a custom definition', async () => {
    const service = new GrokParserService();
    services.push(service);
    await service.configure({
      match: '^%{CUSTOM:value}$',
      patterns: { CUSTOM: '[a-z]+' },
      multiline: null,
    });
    await expect(service.parse(['abc', '123'])).resolves.toEqual([
      { value: 'abc' },
      null,
    ]);
  });

  it('classifies event starts with the same GROK dictionary', async () => {
    const service = new GrokParserService();
    services.push(service);
    await service.configure({
      match: '^%{GREEDYDATA:message}$',
      patterns: {},
      multiline: {
        pattern: '^%{TIMESTAMP_ISO8601}',
        negate: true,
        what: 'previous',
        autoFlushInterval: 2,
        maxLines: 500,
        maxBytes: 10 * 1024 * 1024,
        skipNewline: false,
      },
    });

    await expect(service.classifyMultiline([
      '2025-11-07T10:14:12.000Z INFO start',
      '    at worker.ts:10',
    ])).resolves.toEqual([true, false]);
  });
});
