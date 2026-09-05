// The client's read of the realm's honour roll (src/net/realm_builder_roll.ts).
//
// This runs on the world-load path of every online client, so the property that
// actually matters is not "it parses json": it is that NOTHING it can hit
// keeps a player out of the world. A realm with no honourees, a realm running
// an older server without the endpoint, a 500, a network drop, garbage in the
// body: all five leave the shipped placeholder standing and return null.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { startRealmBuilderRollLoad } from '../src/game/realm_builder_boot';
import { loadRealmBuilderRoll } from '../src/net/realm_builder_roll';
import {
  currentRealmBuilder,
  pastRealmBuilders,
  REALM_BUILDER_PLACEHOLDER_NAME,
  resetRealmBuilderRoll,
} from '../src/sim/content/realm_builders';

const URL = '/api/realm-builder';

function respond(body: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status, json: async () => body })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetRealmBuilderRoll();
});

describe('loadRealmBuilderRoll', () => {
  it('publishes the realm roll and answers the current name', async () => {
    respond({
      realm: 'live',
      entries: [
        { year: 2026, month: 9, name: 'Isolde Vane', note: 'the lantern walk' },
        { year: 2026, month: 8, name: 'Wren Ashdown', note: '' },
      ],
    });
    // The caller uses this return to re-bake the plaque's gold projection when
    // the town is already built, so it has to be the name, not just a boolean.
    expect(await loadRealmBuilderRoll(URL)).toBe('Isolde Vane');
    expect(currentRealmBuilder().name).toBe('Isolde Vane');
    expect(pastRealmBuilders().map((honour) => honour.name)).toEqual(['Wren Ashdown']);
  });

  it('drops malformed rows instead of the whole response', async () => {
    respond({
      entries: [
        { year: 2026, month: 13, name: 'Bad Month' },
        { year: 2026, month: 9, name: '   ' },
        { year: 'nope', month: 9, name: 'Bad Year' },
        { year: 2026, month: 8, name: '  Wren Ashdown  ' },
      ],
    });
    expect(await loadRealmBuilderRoll(URL)).toBe('Wren Ashdown');
    expect(pastRealmBuilders()).toEqual([]);
  });

  it.each([
    ['an empty roll', { entries: [] }, true, 200],
    ['a body with no entries at all', { realm: 'live' }, true, 200],
    ['entries that are not a list', { entries: 'nope' }, true, 200],
    ['a 404 from an older server', {}, false, 404],
    ['a 500', {}, false, 500],
  ])('keeps the placeholder on %s', async (_label, body, ok, status) => {
    respond(body, ok, status);
    expect(await loadRealmBuilderRoll(URL)).toBeNull();
    expect(currentRealmBuilder().name).toBe(REALM_BUILDER_PLACEHOLDER_NAME);
    expect(pastRealmBuilders()).toEqual([]);
  });

  it('never throws at the caller when the network is gone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    await expect(loadRealmBuilderRoll(URL)).resolves.toBeNull();
  });

  it('never throws when the body is not json', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      })),
    );
    await expect(loadRealmBuilderRoll(URL)).resolves.toBeNull();
  });

  it('is never started for an offline world, and re-bakes the plate online', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ entries: [{ year: 2026, month: 9, name: 'Isolde Vane' }] }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const sink = { setRealmBuilderHonouree: vi.fn() };

    // The offline entry passes null: the shipped placeholder is its roll, and
    // a realm's names must not be pulled into a world they do not belong to.
    startRealmBuilderRollLoad(sink, null);
    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sink.setRealmBuilderHonouree).not.toHaveBeenCalled();
    expect(currentRealmBuilder().name).toBe(REALM_BUILDER_PLACEHOLDER_NAME);

    // Online: one read, and the current name reaches the plate.
    startRealmBuilderRollLoad(sink, {});
    await vi.waitFor(() =>
      expect(sink.setRealmBuilderHonouree).toHaveBeenCalledWith('Isolde Vane'),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite a good roll with a later failed read', async () => {
    respond({ entries: [{ year: 2026, month: 9, name: 'Isolde Vane' }] });
    await loadRealmBuilderRoll(URL);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expect(await loadRealmBuilderRoll(URL)).toBeNull();
    // A dropped connection mid-session must not blank a name off the statue.
    expect(currentRealmBuilder().name).toBe('Isolde Vane');
  });
});
