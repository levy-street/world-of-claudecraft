import { afterEach, describe, expect, it } from 'vitest';
import { ABILITIES, ITEMS } from '../src/sim/data';
import {
  contextualIconPrewarmEntries,
  defaultIconPrewarmEntries,
  defaultIconPrewarmPlan,
  type IconPrewarmEntry,
  prewarmIconCache,
  prewarmIconDataUrl,
} from '../src/ui/icon_prewarm';
import {
  AURA_RECIPE_IDS,
  iconDataUrl,
  needsIconDataUrlWarm,
  needsProceduralIconDataUrlWarm,
  proceduralIconDataUrl,
  storePrewarmedIconDataUrl,
  storePrewarmedProceduralIconDataUrl,
} from '../src/ui/icons';

type IdleCb = (d: { timeRemaining(): number }) => void;

// Minimal window stub: captures idle callbacks so the test drives the pump by
// hand (the vitest env is plain Node; jsdom is deliberately not a dependency).
function stubWindow(): { idleQueue: IdleCb[]; restore: () => void } {
  const idleQueue: IdleCb[] = [];
  const fake = {
    requestIdleCallback: (cb: IdleCb) => {
      idleQueue.push(cb);
      return idleQueue.length;
    },
    setTimeout: (cb: () => void) => {
      idleQueue.push(() => cb());
      return 0;
    },
  };
  const prev = (globalThis as any).window;
  (globalThis as any).window = fake;
  return {
    idleQueue,
    restore: () => {
      if (prev === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = prev;
    },
  };
}

function entries(n: number): IconPrewarmEntry[] {
  return Array.from({ length: n }, (_, i) => ({ kind: 'item' as const, id: `it${i}` }));
}

describe('prewarmIconCache', () => {
  let restore = () => {};
  afterEach(() => restore());

  // fake clock: each warm() call costs 2ms, so the 6ms slice budget admits 3
  // icons per pump before the per-icon check trips
  function fakeClock(costMs = 2): { now: () => number; tick: () => void } {
    let t = 0;
    return { now: () => t, tick: () => (t += costMs) };
  }

  it('warms every entry across slices and stops rescheduling when drained', () => {
    const w = stubWindow();
    restore = w.restore;
    const clock = fakeClock();
    const warmed: string[] = [];
    prewarmIconCache(entries(20), {
      warm: (_k, id) => {
        warmed.push(id);
        clock.tick();
      },
      now: clock.now,
    });
    while (w.idleQueue.length > 0) w.idleQueue.shift()!(undefined as any);
    expect(warmed).toHaveLength(20);
    expect(warmed[0]).toBe('it0');
    expect(warmed[19]).toBe('it19');
    expect(w.idleQueue).toHaveLength(0); // drained: no further schedule
  });

  it('checks the budget per icon: one pump never exceeds the slice budget', () => {
    const w = stubWindow();
    restore = w.restore;
    const clock = fakeClock(2);
    const warmed: string[] = [];
    prewarmIconCache(entries(20), {
      warm: (_k, id) => {
        warmed.push(id);
        clock.tick();
      },
      now: clock.now,
    });
    // one pump with a GENEROUS idle deadline: the 6ms wall-clock budget must
    // still stop it after 3 icons (2ms each), not run the whole list
    w.idleQueue.shift()!({ timeRemaining: () => 50 });
    expect(warmed).toHaveLength(3);
  });

  it('yields early when the idle deadline runs out before the budget', () => {
    const w = stubWindow();
    restore = w.restore;
    const clock = fakeClock(1);
    const warmed: string[] = [];
    let remaining = 10;
    prewarmIconCache(entries(30), {
      warm: (_k, id) => {
        warmed.push(id);
        clock.tick();
        remaining -= 4; // deadline shrinks faster than the 6ms budget
      },
      now: clock.now,
    });
    w.idleQueue.shift()!({ timeRemaining: () => remaining });
    expect(warmed).toHaveLength(2); // stopped by timeRemaining() <= 3, not the budget
    expect(w.idleQueue).toHaveLength(1); // rescheduled for the rest
  });

  it('cancel stops the pump between slices', () => {
    const w = stubWindow();
    restore = w.restore;
    const clock = fakeClock(2);
    const warmed: string[] = [];
    const cancel = prewarmIconCache(entries(20), {
      warm: (_k, id) => {
        warmed.push(id);
        clock.tick();
      },
      now: clock.now,
    });
    w.idleQueue.shift()!(undefined as any); // first slice only
    const after = warmed.length;
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(20);
    cancel();
    while (w.idleQueue.length > 0) w.idleQueue.shift()!(undefined as any);
    expect(warmed).toHaveLength(after); // nothing warmed after cancel
  });

  it('a throwing recipe is skipped, not fatal', () => {
    const w = stubWindow();
    restore = w.restore;
    const warmed: string[] = [];
    prewarmIconCache(entries(3), {
      warm: (_k, id) => {
        if (id === 'it1') throw new Error('bad recipe');
        warmed.push(id);
      },
    });
    while (w.idleQueue.length > 0) w.idleQueue.shift()!(undefined as any);
    expect(warmed).toEqual(['it0', 'it2']);
  });

  it('waits for an asynchronous warm before scheduling the next icon', async () => {
    const w = stubWindow();
    restore = w.restore;
    const warmed: string[] = [];
    let release = () => {};
    prewarmIconCache(entries(2), {
      warm: (_k, id) => {
        warmed.push(id);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });

    w.idleQueue.shift()!({ timeRemaining: () => 50 });
    expect(warmed).toEqual(['it0']);
    expect(w.idleQueue).toHaveLength(0);

    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(w.idleQueue).toHaveLength(1);
    w.idleQueue.shift()!({ timeRemaining: () => 50 });
    expect(warmed).toEqual(['it0', 'it1']);
  });

  it('continues after an asynchronous warm rejects', async () => {
    const w = stubWindow();
    restore = w.restore;
    const warmed: string[] = [];
    prewarmIconCache(entries(2), {
      warm: (_k, id) => {
        warmed.push(id);
        return id === 'it0' ? Promise.reject(new Error('bad async recipe')) : Promise.resolve();
      },
    });

    w.idleQueue.shift()!({ timeRemaining: () => 50 });
    await Promise.resolve();
    await Promise.resolve();
    expect(w.idleQueue).toHaveLength(1);
    w.idleQueue.shift()!({ timeRemaining: () => 50 });
    expect(warmed).toEqual(['it0', 'it1']);
  });

  it('schedules nothing for an empty list', () => {
    const w = stubWindow();
    restore = w.restore;
    prewarmIconCache([], { warm: () => {} });
    expect(w.idleQueue).toHaveLength(0);
  });

  it('dispatches the eager prefix without waiting for an idle deadline', () => {
    const w = stubWindow();
    restore = w.restore;
    const warmed: string[] = [];
    prewarmIconCache(entries(3), {
      eagerCount: 2,
      warm: (_kind, id) => {
        warmed.push(id);
      },
    });

    // The first two callbacks are zero-delay loading tasks. Once the prefix is
    // drained, the remaining catalog work returns to the idle lane.
    w.idleQueue.shift()!(undefined as any);
    expect(warmed).toEqual(['it0', 'it1']);
    expect(w.idleQueue).toHaveLength(1);
    w.idleQueue.shift()!({ timeRemaining: () => 50 });
    expect(warmed).toEqual(['it0', 'it1', 'it2']);
  });

  it('forwards an entry-specific size to the cache warmer', () => {
    const w = stubWindow();
    restore = w.restore;
    const warmed: Array<[string, number]> = [];
    prewarmIconCache([{ kind: 'crest', id: 'class_mage', size: 20 }], {
      warm: (_kind, id, size) => {
        warmed.push([id, size]);
      },
    });
    w.idleQueue.shift()!({ timeRemaining: () => 50 });
    expect(warmed).toEqual([['class_mage', 20]]);
  });

  it('forwards the procedural-cache mode used by painted aura fallbacks', () => {
    const w = stubWindow();
    restore = w.restore;
    const warmed: Array<[string, string]> = [];
    prewarmIconCache([{ kind: 'aura', id: 'counter_shot', mode: 'procedural' }], {
      warm: (_kind, id, _size, mode) => {
        warmed.push([id, mode]);
      },
    });
    w.idleQueue.shift()!({ timeRemaining: () => 50 });
    expect(warmed).toEqual([['counter_shot', 'procedural']]);
  });
});

describe('defaultIconPrewarmEntries', () => {
  it('covers the exact item catalog, ability table, and core chrome entries', () => {
    const list = defaultIconPrewarmEntries();
    const itemIds = new Set(list.filter((entry) => entry.kind === 'item').map((entry) => entry.id));
    const abilityIds = new Set(
      list.filter((entry) => entry.kind === 'ability').map((entry) => entry.id),
    );
    expect(itemIds).toEqual(
      new Set([...Object.keys(ITEMS), 'backpack', 'coin_gold', 'slot_empty']),
    );
    expect(abilityIds).toEqual(new Set([...Object.keys(ABILITIES), 'attack']));
    for (const e of list) expect(typeof e.id).toBe('string');
  });

  it('puts a stable, deduplicated runtime priority prefix before the catalog', () => {
    const plan = defaultIconPrewarmPlan([
      { kind: 'item', id: 'baked_bread' },
      { kind: 'ability', id: 'heroic_strike' },
      { kind: 'item', id: 'baked_bread' },
    ]);
    expect(plan.priorityCount).toBeGreaterThan(2);
    expect(plan.entries.slice(0, 2)).toEqual([
      { kind: 'item', id: 'baked_bread' },
      { kind: 'ability', id: 'heroic_strike' },
    ]);
    expect(
      plan.entries.filter((entry) => entry.kind === 'item' && entry.id === 'baked_bread'),
    ).toHaveLength(1);
    expect(plan.entries.slice(0, plan.priorityCount)).toContainEqual({
      kind: 'item',
      id: 'coin_gold',
    });
  });

  it('deduplicates exact cache keys but preserves different requested sizes', () => {
    const plan = defaultIconPrewarmPlan([
      { kind: 'crest', id: 'class_mage', size: 20 },
      { kind: 'crest', id: 'class_mage', size: 20 },
      { kind: 'crest', id: 'class_mage' },
    ]);
    expect(plan.entries.slice(0, 2)).toEqual([
      { kind: 'crest', id: 'class_mage', size: 20 },
      { kind: 'crest', id: 'class_mage' },
    ]);
  });

  it('keeps painted ability URLs static while prewarming explicit procedural aura recipes', () => {
    const plan = defaultIconPrewarmPlan();
    expect(plan.entries).toContainEqual({ kind: 'ability', id: 'counter_shot' });
    expect(plan.entries).not.toContainEqual({
      kind: 'aura',
      id: 'counter_shot',
      mode: 'procedural',
    });
    expect(plan.entries).toContainEqual({
      kind: 'aura',
      id: 'aura_buff_ap_pct',
      mode: 'procedural',
    });
  });

  it('limits the full procedural fallback catalog to explicit aura recipes', () => {
    const actual = new Set(
      defaultIconPrewarmPlan()
        .entries.filter((entry) => entry.kind === 'aura' && entry.mode === 'procedural')
        .map((entry) => entry.id),
    );
    expect(actual).toEqual(new Set(AURA_RECIPE_IDS));
    expect(actual.size).toBeLessThan(Object.keys(ABILITIES).length);
  });
});

describe('contextualIconPrewarmEntries', () => {
  it('routes every player and session source into its exact first-open cache entries', () => {
    expect(
      contextualIconPrewarmEntries({
        equipmentItemIds: ['equipment', null],
        classIds: ['mage'],
        inventoryItemIds: ['inventory'],
        bagItemIds: ['bag'],
        knownAbilityIds: ['known_ability'],
        classAbilityIds: ['class_ability'],
        talentIconRefs: [
          { kind: 'crest', id: 'talent_crest' },
          { kind: 'ability', id: 'talent_ability' },
        ],
        recipeResultItemIds: ['recipe'],
        finderLootItemIds: ['finder'],
        questRewardItemIds: ['quest'],
        heroicVendorItemIds: ['heroic_vendor'],
        marketListingItemIds: ['market_listing'],
        marketCollectionItemIds: ['market_collection'],
        marketHouseItemIds: ['market_house'],
        vendorItemIds: ['vendor'],
      }),
    ).toEqual([
      { kind: 'item', id: 'equipment' },
      { kind: 'crest', id: 'class_mage', size: 20, mode: 'procedural' },
      { kind: 'crest', id: 'class_mage', size: 96, mode: 'procedural' },
      { kind: 'item', id: 'inventory' },
      { kind: 'item', id: 'bag' },
      { kind: 'ability', id: 'known_ability' },
      { kind: 'aura', id: 'known_ability', mode: 'procedural' },
      { kind: 'ability', id: 'class_ability' },
      { kind: 'aura', id: 'class_ability', mode: 'procedural' },
      { kind: 'crest', id: 'talent_crest' },
      { kind: 'ability', id: 'talent_ability' },
      { kind: 'aura', id: 'talent_ability', mode: 'procedural' },
      { kind: 'item', id: 'recipe' },
      { kind: 'item', id: 'finder' },
      { kind: 'item', id: 'quest' },
      { kind: 'item', id: 'heroic_vendor' },
      { kind: 'item', id: 'market_listing' },
      { kind: 'item', id: 'market_collection' },
      { kind: 'item', id: 'market_house' },
      { kind: 'item', id: 'vendor' },
    ]);
  });
});

describe('worker icon cache bridge', () => {
  it('routes the production worker result to the requested procedural cache only', async () => {
    const id = '__worker_production_procedural_route_test__';
    const size = 75;
    const url = 'data:image/png;base64,cHJvZHVjdGlvbi1wcm9jZWR1cmFs';
    expect(needsProceduralIconDataUrlWarm('aura', id, size)).toBe(true);
    expect(needsIconDataUrlWarm('aura', id, size)).toBe(true);

    await prewarmIconDataUrl('aura', id, size, 'procedural', {
      requestIcon: () => Promise.resolve(new Blob(['worker-icon'])),
      toDataUrl: () => Promise.resolve(url),
    });

    expect(needsProceduralIconDataUrlWarm('aura', id, size)).toBe(false);
    expect(proceduralIconDataUrl('aura', id, size)).toBe(url);
    expect(needsIconDataUrlWarm('aura', id, size)).toBe(true);
  });

  it('routes the production worker result to the requested default cache only', async () => {
    const id = '__worker_production_default_route_test__';
    const size = 76;
    const url = 'data:image/png;base64,cHJvZHVjdGlvbi1kZWZhdWx0';
    expect(needsIconDataUrlWarm('aura', id, size)).toBe(true);
    expect(needsProceduralIconDataUrlWarm('aura', id, size)).toBe(true);

    await prewarmIconDataUrl('aura', id, size, 'default', {
      requestIcon: () => Promise.resolve(new Blob(['worker-icon'])),
      toDataUrl: () => Promise.resolve(url),
    });

    expect(needsIconDataUrlWarm('aura', id, size)).toBe(false);
    expect(iconDataUrl('aura', id, size)).toBe(url);
    expect(needsProceduralIconDataUrlWarm('aura', id, size)).toBe(true);
  });

  it('makes a worker-rendered URL immediately available to synchronous consumers', () => {
    const id = '__worker_cache_bridge_test__';
    const size = 73;
    const url = 'data:image/png;base64,d29ya2VyLWljb24=';
    expect(needsIconDataUrlWarm('aura', id, size)).toBe(true);
    storePrewarmedIconDataUrl('aura', id, size, url);
    expect(needsIconDataUrlWarm('aura', id, size)).toBe(false);
    expect(iconDataUrl('aura', id, size)).toBe(url);
  });

  it('publishes worker output into the separate painted-aura fallback cache', () => {
    const id = '__worker_procedural_cache_bridge_test__';
    const size = 74;
    const url = 'data:image/png;base64,cHJvY2VkdXJhbC1mYWxsYmFjaw==';
    expect(needsProceduralIconDataUrlWarm('aura', id, size)).toBe(true);
    storePrewarmedProceduralIconDataUrl('aura', id, size, url);
    expect(needsProceduralIconDataUrlWarm('aura', id, size)).toBe(false);
    expect(proceduralIconDataUrl('aura', id, size)).toBe(url);
  });
});
