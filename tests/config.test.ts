import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/server/config';

describe('parseConfig', () => {
  it('reads the main expression and custom definitions', () => {
    const config = parseConfig(`
match: >-
  ^%{CUSTOM:value}$
patterns:
  CUSTOM: '[a-z]+'
`);
    expect(config).toEqual({
      match: '^%{CUSTOM:value}$',
      patterns: { CUSTOM: '[a-z]+' },
      multiline: null,
    });
  });

  it('reads multiline configuration and fills safe defaults', () => {
    expect(parseConfig(`
match: "%{GREEDYDATA:message}"
patterns: {}
multiline:
  pattern: "^%{TIMESTAMP_ISO8601}"
  negate: true
  what: previous
`)).toEqual({
      match: '%{GREEDYDATA:message}',
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
  });

  it('allows explicitly disabling multiline', () => {
    expect(parseConfig('match: "%{WORD:x}"\nmultiline: false'))
      .toMatchObject({ multiline: null });
  });

  it('rejects invalid multiline settings', () => {
    expect(() => parseConfig(`
match: "%{WORD:x}"
multiline:
  pattern: "^start"
  what: somewhere
`)).toThrow(/what/);

    expect(() => parseConfig(`
match: "%{WORD:x}"
multiline:
  pattern: "^start"
  unknown: true
`)).toThrow(/Unknown parser configuration field.*multiline/);
  });

  it('rejects unknown fields', () => {
    expect(() => parseConfig('match: "%{WORD:x}"\nextra: true'))
      .toThrow(/Unknown parser configuration field/);
  });

  it('rejects multiline definitions', () => {
    expect(() => parseConfig(`
match: "%{WORD:x}"
patterns:
  CUSTOM: |
    first
    second
`)).toThrow(/single-line/);
  });
});
