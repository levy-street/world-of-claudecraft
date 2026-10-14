import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { audio } from '../src/game/audio';
import { music } from '../src/game/music';
import { sfx } from '../src/game/sfx';
import {
  bootOfflinePlay,
  boutSizeFromUrl,
  loadOfflineWorld,
  offlineWorldSlug,
  resolveStudioEntry,
  type StartOfflineFn,
  studioMapBySlug,
} from '../src/game/studio_boot';
import { DEEPGLASS_DEFAULT_PER_SIDE } from '../src/sim/deepglass/match';
import { DEEPGLASS_MAP_ENTRY } from '../src/sim/deepglass/world';
import {
  PUBLISHED_MAPS,
  type PublishedMapEntry,
  publishedMapBySlug,
} from '../src/sim/maps/index.generated';
import type { WorldContent } from '../src/sim/types';

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

const arena = { presentationMode: 'deepglass' } as WorldContent;

function installStorage(): Map<string, string> {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
  return map;
}

describe('boutSizeFromUrl', () => {
  it('books nothing outside the arena or without a ?bout', () => {
    expect(boutSizeFromUrl(undefined, '?bout=3')).toBeNull();
    expect(
      boutSizeFromUrl({ presentationMode: 'overworld' } as unknown as WorldContent, '?bout=3'),
    ).toBeNull();
    expect(boutSizeFromUrl(arena, '?map=deepglass')).toBeNull();
  });

  it('clamps the booking to the roster and defaults a junk value', () => {
    expect(boutSizeFromUrl(arena, '?bout=3')).toBe(3);
    expect(boutSizeFromUrl(arena, '?bout=0')).toBe(1);
    expect(boutSizeFromUrl(arena, '?bout=99')).toBe(5);
    expect(boutSizeFromUrl(arena, '?bout=abc')).toBe(DEEPGLASS_DEFAULT_PER_SIDE);
  });
});

describe('resolveStudioEntry', () => {
  beforeEach(() => {
    installStorage();
  });

  it('is null on the normal flow: no ?map slug and no portal handoff', () => {
    expect(resolveStudioEntry(new URLSearchParams(''), false)).toBeNull();
    expect(resolveStudioEntry(new URLSearchParams('?ref=abc'), false)).toBeNull();
  });

  it('falls through for an unknown slug and yields to an editor playtest', () => {
    expect(resolveStudioEntry(new URLSearchParams('?map=no_such_map'), false)).toBeNull();
    expect(resolveStudioEntry(new URLSearchParams('?map=deepglass'), true)).toBeNull();
  });

  it('resolves the arena slug to an entry', () => {
    expect(resolveStudioEntry(new URLSearchParams('?map=deepglass'), false)).not.toBeNull();
  });

  it('resolves every published slug to an entry', () => {
    expect(PUBLISHED_MAPS.length).toBeGreaterThan(0);
    for (const { slug } of PUBLISHED_MAPS) {
      expect(resolveStudioEntry(new URLSearchParams(`?map=${slug}`), false), slug).not.toBeNull();
    }
  });

  // The offline world switch is a different entry: it never changes what a
  // plain page load resolves.
  it('ignores ?offlineWorld: that is the offline Play click, not a page entry', () => {
    expect(resolveStudioEntry(query(`?offlineWorld=${REBUILD}`), false)).toBeNull();
  });
});

describe('studioMapBySlug', () => {
  // Both entries (?map= and offline Play's ?offlineWorld=) look a map up the
  // same way: the published registry first, the programmatic arena after.
  it('prefers the published registry and falls back to the programmatic arena', () => {
    expect(studioMapBySlug(REBUILD)).toBe(publishedMapBySlug(REBUILD));
    expect(studioMapBySlug(DEEPGLASS_MAP_ENTRY.slug)).toBe(
      publishedMapBySlug(DEEPGLASS_MAP_ENTRY.slug) ?? DEEPGLASS_MAP_ENTRY,
    );
    expect(studioMapBySlug('no_such_map')).toBeUndefined();
  });

  it('lets offline Play boot the arena through the same lookup', async () => {
    const picked = await loadOfflineWorld(query('?offlineWorld=deepglass'), undefined);
    expect(picked?.seed).toBe(studioMapBySlug('deepglass')?.seed);
    expect(picked?.world.presentationMode).toBe('deepglass');
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
