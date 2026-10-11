import { describe, expect, it } from 'vitest';
import { resolveInitialActionBarLayout } from '../src/net/action_bar_restore';

describe('initial action bar layout resolution', () => {
  it('keeps the local layout when a resumed session omits the field', () => {
    expect(resolveInitialActionBarLayout(undefined)).toEqual({ source: 'noop' });
  });

  it.each([null, false, 'broken', { v: 2, profiles: false }])(
    'seeds from local when the server document is absent or invalid: %j',
    (value) => expect(resolveInitialActionBarLayout(value)).toEqual({ source: 'seed' }),
  );

  it('keeps a valid server profile and sanitizes its untrusted slots', () => {
    const result = resolveInitialActionBarLayout({
      v: 2,
      profiles: {
        desktop: {
          v: 1,
          forms: {
            normal: {
              bar: [
                { type: 'ability', id: 'heroic_strike' },
                { type: 'script', id: 'bad' },
              ],
            },
          },
        },
      },
    });
    expect(result).toEqual({
      source: 'server',
      profiles: {
        v: 2,
        profiles: {
          desktop: {
            v: 1,
            forms: { normal: { bar: [{ type: 'ability', id: 'heroic_strike' }, null] } },
          },
        },
      },
    });
  });
});
