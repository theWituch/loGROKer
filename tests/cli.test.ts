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
      sources: [{
        id: 'config',
        name: 'config',
        logPath: resolve('./log.log'),
        configPath: resolve('./config.yml'),
      }],
    });
  });

  it('reads multiple log-configuration pairs and explicit names', () => {
    expect(parseCli([
      '--log', './app.log', '--config', 'app|./app.yml',
      '--log', './access.log', '--config', './access.yml',
    ])).toMatchObject({
      sources: [
        { id: 'app', configPath: resolve('./app.yml') },
        { id: 'access', configPath: resolve('./access.yml') },
      ],
    });
  });

  it('rejects odd pairs and duplicate names', () => {
    expect(() => parseCli(['--log', 'one.log', '--log', 'two.log', '--config', 'one.yml']))
      .toThrow(/number.*--log.*--config/i);
    expect(() => parseCli([
      '--log', 'one.log', '--config', 'same|one.yml',
      '--log', 'two.log', '--config', 'same|two.yml',
    ])).toThrow(/occurs more/i);
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
