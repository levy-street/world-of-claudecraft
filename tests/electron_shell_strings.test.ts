import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHELL_STRINGS,
  MAX_SHELL_STRING_LENGTH,
  sanitizeShellStrings,
} from '../electron/shell_strings.cjs';

describe('sanitizeShellStrings (the renderer-to-native-dialog trust boundary)', () => {
  it('merges known keys over the current strings', () => {
    const merged = sanitizeShellStrings({ crashBody: 'La vue du jeu a plante. Recharger ?' });
    expect(merged.crashBody).toBe('La vue du jeu a plante. Recharger ?');
    expect(merged.crashTitle).toBe(DEFAULT_SHELL_STRINGS.crashTitle);
    expect(merged.crashReload).toBe(DEFAULT_SHELL_STRINGS.crashReload);
  });

  it('builds on the provided current strings, not always the defaults', () => {
    const first = sanitizeShellStrings({ crashReload: 'Recharger' });
    const second = sanitizeShellStrings({ crashQuit: 'Quitter' }, first);
    expect(second.crashReload).toBe('Recharger');
    expect(second.crashQuit).toBe('Quitter');
  });

  it('drops unknown keys, non-strings, empties, and over-long values', () => {
    const merged = sanitizeShellStrings({
      crashTitle: 42,
      crashBody: '',
      crashQuit: 'x'.repeat(MAX_SHELL_STRING_LENGTH + 1),
      __proto__constructor: 'nope',
      totallyUnknown: 'nope',
    });
    expect(merged).toEqual(DEFAULT_SHELL_STRINGS);
    expect('totallyUnknown' in merged).toBe(false);
  });

  it('flattens the full control range so dialog text stays single-line', () => {
    const merged = sanitizeShellStrings({ crashBody: 'line one\nline two\ttabbed' });
    expect(merged.crashBody).toBe('line one line two tabbed');
    const esc = sanitizeShellStrings({ crashQuit: `Qu${String.fromCharCode(27)}[31mit` });
    expect(esc.crashQuit).toBe('Qu [31mit');
  });

  it('never throws on junk input and returns a copy', () => {
    expect(sanitizeShellStrings(null)).toEqual(DEFAULT_SHELL_STRINGS);
    expect(sanitizeShellStrings('string')).toEqual(DEFAULT_SHELL_STRINGS);
    expect(sanitizeShellStrings(undefined)).not.toBe(DEFAULT_SHELL_STRINGS);
  });
});
