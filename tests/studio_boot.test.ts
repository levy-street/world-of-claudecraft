import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { audio } from '../src/game/audio';
import { music } from '../src/game/music';
import { sfx } from '../src/game/sfx';
import {
  bootOfflinePlay,
  loadOfflineWorld,
  offlineWorldSlug,
  resolveStudioEntry,
  type StartOfflineFn,
} from '../src/game/studio_boot';
import {
  PUBLISHED_MAPS,
  type PublishedMapEntry,
  publishedMapBySlug,
} from '../src/sim/maps/index.generated';

const REBUILD = 'eastbrook_rebuild';
const none = new URLSearchParams('');
const query = (q: string): URLSearchParams => new URLSearchParams(q);

/** A startOffline that records its arguments. */
function recordingStart(): { calls: Parameters<StartOfflineFn>[]; start: StartOfflineFn } {
  const calls: Parameters<StartOfflineFn>[] = [];
  return {
    calls,
    start: async (...args) => {
      calls.push(args);
    },
  };
}

/** Spy the three audio engines' init for one test. */
function spyAudio(): { inits: ReturnType<typeof vi.spyOn>[]; restore(): void } {
  const inits = [audio, music, sfx].map((engine) =>
    vi.spyOn(engine, 'init').mockImplementation(() => {}),
  );
  return {
    inits,
    restore: () => {
      for (const init of inits) init.mockRestore();
    },
  };
}

describe('resolveStudioEntry', () => {
  it('is null on the normal flow: no ?map slug', () => {
    expect(resolveStudioEntry(new URLSearchParams(''), false)).toBeNull();
    expect(resolveStudioEntry(new URLSearchParams('?ref=abc'), false)).toBeNull();
  });

  it('falls through for an unknown slug and yields to an editor playtest', () => {
    const slug = PUBLISHED_MAPS[0]?.slug;
    if (!slug) throw new Error('expected a published map in the registry');
    expect(resolveStudioEntry(new URLSearchParams('?map=no_such_map'), false)).toBeNull();
    expect(resolveStudioEntry(new URLSearchParams(`?map=${slug}`), true)).toBeNull();
  });

  it('resolves a published slug to an entry', () => {
    const slug = PUBLISHED_MAPS[0]?.slug;
    if (!slug) throw new Error('expected a published map in the registry');
    expect(resolveStudioEntry(new URLSearchParams(`?map=${slug}`), false)).not.toBeNull();
  });

  // The offline world switch is a different entry: it never changes what a
  // plain page load resolves.
  it('ignores ?offlineWorld: that is the offline Play click, not a page entry', () => {
    expect(resolveStudioEntry(query(`?offlineWorld=${REBUILD}`), false)).toBeNull();
  });
});

describe('offlineWorldSlug', () => {
  it('is the built-in world unless a map is asked for', () => {
    expect(offlineWorldSlug(none, undefined)).toBeNull();
    expect(offlineWorldSlug(query('?ref=abc'), undefined)).toBeNull();
    expect(offlineWorldSlug(none, '')).toBeNull();
  });

  it('takes the map from the query, or from the machine default', () => {
    expect(offlineWorldSlug(query(`?offlineWorld=${REBUILD}`), undefined)).toBe(REBUILD);
    expect(offlineWorldSlug(none, REBUILD)).toBe(REBUILD);
  });

  it('lets the query win over the machine default, in both directions', () => {
    expect(offlineWorldSlug(query('?offlineWorld=other_map'), REBUILD)).toBe('other_map');
    expect(offlineWorldSlug(query('?offlineWorld=builtin'), REBUILD)).toBeNull();
    expect(offlineWorldSlug(query('?offlineWorld='), REBUILD)).toBeNull();
    expect(offlineWorldSlug(none, 'builtin')).toBeNull();
  });
});

describe('loadOfflineWorld', () => {
  it('loads nothing, and warns of nothing, when no map is asked for', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadOfflineWorld(none, undefined)).toBeNull();
    expect(await loadOfflineWorld(query('?offlineWorld=builtin'), REBUILD)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  // The Eastbrook rebuild is the map this switch exists for. A registry
  // regenerated without it would fall back to the built-in world, and the town
  // a developer asked for would be the old one again.
  it('loads the published Eastbrook rebuild, built from the Tidehold set', async () => {
    const entry = publishedMapBySlug(REBUILD);
    expect(entry).toBeDefined();
    const picked = await loadOfflineWorld(none, REBUILD);
    expect(picked?.seed).toBe(entry?.seed);
    expect(picked?.world).toBe(await entry?.load());
    const paths = (picked?.world.placements ?? []).map((p) => p.path);
    for (const name of ['smithy', 'tavern', 'hall', 'bank', 'shop_a', 'house_b', 'vault']) {
      expect(paths, name).toContain(`/models/tidehold/${name}.glb`);
    }
  });

  it('falls back to the built-in world, and says so, for an unpublished or failing map', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadOfflineWorld(query('?offlineWorld=no_such_map'), undefined)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const broken: PublishedMapEntry = {
      slug: REBUILD,
      name: 'Broken',
      seed: 7,
      load: () => Promise.reject(new Error('chunk failed')),
    };
    expect(await loadOfflineWorld(none, REBUILD, () => broken)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('bootOfflinePlay', () => {
  it('boots the built-in world in the same task as the click, audio first', () => {
    const spy = spyAudio();
    const order: string[] = [];
    for (const init of spy.inits) init.mockImplementation(() => void order.push('audio'));
    const start: StartOfflineFn = async (...args) => {
      order.push(`start:${args.length}`);
    };
    // '' and not undefined: an undefined argument would take the parameter's
    // default, which is the developer's own VITE_OFFLINE_WORLD on their machine.
    void bootOfflinePlay(start, 'warrior', 'Ana', 2, none, '');
    // No await anywhere above: the world entry began inside the click's own task.
    expect(order).toEqual(['audio', 'audio', 'audio', 'start:3']);
    spy.restore();
  });

  it('starts the audio on the click even when a map has to load first', async () => {
    const spy = spyAudio();
    const { calls, start } = recordingStart();
    const booting = bootOfflinePlay(start, 'priest', 'Ana', 2, none, REBUILD);
    for (const init of spy.inits) expect(init).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
    await booting;
    const entry = publishedMapBySlug(REBUILD);
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(0, 3)).toEqual(['priest', 'Ana', 2]);
    expect(calls[0][3]).toBe(await entry?.load());
    expect(calls[0][4]).toBe(entry?.seed);
    spy.restore();
  });

  it('boots the built-in world when the map asked for is not published', async () => {
    const spy = spyAudio();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { calls, start } = recordingStart();
    await bootOfflinePlay(start, 'mage', 'Ana', 0, query('?offlineWorld=no_such_map'), REBUILD);
    expect(calls).toEqual([['mage', 'Ana', 0, undefined, undefined]]);
    warn.mockRestore();
    spy.restore();
  });

  // The click handler lives in main.ts, which no test can import. Pin its one
  // line: it must go through bootOfflinePlay, and must not start the engines or
  // the world itself (that would boot twice, or skip the world switch).
  it('is what the offline Play click calls', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    const handler = /const handleOfflineStart = [\s\S]*?\n {2}\};\n/.exec(main)?.[0] ?? '';
    expect(handler).toContain(
      "void bootOfflinePlay(startOffline, cls, name, selectedSkin('#offline-skin-row', offlineSkin));",
    );
    expect(handler).not.toMatch(/\b(audio|music|sfx)\.init\(\)/);
    expect(handler).not.toMatch(/void startOffline\(/);
  });
});
