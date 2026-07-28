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
    });
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
