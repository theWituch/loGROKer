import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCli } from '../src/server/cli';

describe('parseCli', () => {
  it('reads the configuration path from the --config switch', () => {
    expect(parseCli([
      '--log',
      './log.log',
      '--config',
      './config.yml',
    ])).toMatchObject({
      logPath: resolve('./log.log'),
      configPath: resolve('./config.yml'),
    });
  });

  it('rejects the retired --grok switch', () => {
    expect(() => parseCli([
      '--log',
      './log.log',
      '--grok',
      './config.yml',
    ])).toThrow(/Unknown argument: --grok/);
  });
});
