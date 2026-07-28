import { describe, expect, it } from 'vitest';
import { parseGrokConfig } from '../src/server/grok-config';

describe('parseGrokConfig', () => {
  it('reads the main expression and custom definitions', () => {
    const config = parseGrokConfig(`
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
    expect(parseGrokConfig(`
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
    expect(parseGrokConfig('match: "%{WORD:x}"\nmultiline: false'))
      .toMatchObject({ multiline: null });
  });

  it('rejects invalid multiline settings', () => {
    expect(() => parseGrokConfig(`
match: "%{WORD:x}"
multiline:
  pattern: "^start"
  what: somewhere
`)).toThrow(/what/);

    expect(() => parseGrokConfig(`
match: "%{WORD:x}"
multiline:
  pattern: "^start"
  unknown: true
`)).toThrow(/Unknown parser configuration field.*multiline/);
  });

  it('rejects unknown fields', () => {
    expect(() => parseGrokConfig('match: "%{WORD:x}"\nextra: true'))
      .toThrow(/Unknown parser configuration field/);
  });

  it('rejects multiline definitions', () => {
    expect(() => parseGrokConfig(`
match: "%{WORD:x}"
patterns:
  CUSTOM: |
    first
    second
`)).toThrow(/single-line/);
  });
});
