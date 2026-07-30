// The titledNameDecoration splitter's locale-order branches. The English
// pattern places {name} first, so tests/deed_i18n.test.ts only ever exercises
// the suffix branch; here the i18n runtime is partially mocked to serve a
// PREFIX-placing pattern and a NAME-OMITTING pattern, proving the split
// honors whatever placement a release-fill overlay chooses (pre-decoration
// support is why the target frame carries two spans).
import { describe, expect, it, vi } from 'vitest';

const mockPattern = vi.hoisted(() => ({ value: '{name} [{title}]' }));

vi.mock('../src/ui/i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/ui/i18n')>();
  return {
    ...orig,
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'hudChrome.deeds.titledName') {
        let out = mockPattern.value;
        for (const [k, v] of Object.entries(params ?? {})) {
          out = out.replaceAll(`{${k}}`, String(v));
        }
        return out;
      }
      return orig.t(key as never, params as never);
    },
  };
});

import { titledNameDecoration } from '../src/ui/deed_i18n';

describe('titledNameDecoration under non-English pattern placements', () => {
  it('a prefix-placing locale yields a PRE decoration and an empty post', () => {
    mockPattern.value = '[{title}] {name}';
    expect(titledNameDecoration('prog_veteran')).toEqual({ pre: '[Veteran] ', post: '' });
  });

  it('a wrapping locale yields both sides', () => {
    mockPattern.value = '~{title}~ {name} =={title}==';
    expect(titledNameDecoration('prog_veteran')).toEqual({
      pre: '~Veteran~ ',
      post: ' ==Veteran==',
    });
  });

  it('a pattern that omits {name} degrades to the whole rendering after the name', () => {
    mockPattern.value = '{title}';
    expect(titledNameDecoration('prog_veteran')).toEqual({ pre: '', post: ' Veteran' });
  });

  it('titles containing spaces never confuse the split (the sentinel is exact)', () => {
    mockPattern.value = '[{title}] {name}';
    // "the Resplendent" carries a space; a naive space-token split would cut it.
    expect(titledNameDecoration('col_seven_regalia')).toEqual({
      pre: '[the Resplendent] ',
      post: '',
    });
  });
});
