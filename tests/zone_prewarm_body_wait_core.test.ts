// Unit test for src/render/zone_prewarm_body_wait_core.ts, the zone prewarm's
// wait for cold creature bodies, over a fake host (a residency set, a manual
// deferral queue, a rewarm log). The store-level flow (the real lanes and asset
// store) is pinned by tests/zone_prewarm_isle_lane_wait.test.ts.
import { describe, expect, it } from 'vitest';
import { zoneArrivalReady } from '../src/render/sky_residency_core';
import { ZonePrewarmBodyWait } from '../src/render/zone_prewarm_body_wait_core';

function harness() {
  const resident = new Set<string>();
  const queued: (() => void)[] = [];
  const rewarms: { x: number; z: number }[] = [];
  const prewarmed = new Set<string>();
  const wait = new ZonePrewarmBodyWait(
    {
      resident: (key) => resident.has(key),
      defer: (fn) => queued.push(fn),
      rewarm: (x, z) => rewarms.push({ x, z }),
    },
    prewarmed,
  );
  const runQueued = () => {
    for (const fn of queued.splice(0)) fn();
  };
  return { resident, queued, rewarms, prewarmed, wait, runQueued };
}

describe('ZonePrewarmBodyWait', () => {
  it('counts a pass that skipped nothing as prewarmed, and one that skipped a body as waiting', () => {
    const h = harness();
    expect(h.wait.settle('fen', 1, 2, [])).toBe(true);
    expect(h.prewarmed.has('fen')).toBe(true);
    expect(h.wait.skips('fen')).toBe(true);
    expect(h.wait.settle('isle', 3, 4, ['mob_bear'])).toBe(false);
    expect(h.prewarmed.has('isle')).toBe(false);
    expect(h.wait.waitingZoneIds()).toEqual(['isle']);
    // a re-settled zone with a new cold body leaves the record again
    expect(h.wait.settle('fen', 1, 2, ['mob_ember'])).toBe(false);
    expect(h.prewarmed.has('fen')).toBe(false);
  });

  it('reads a waiting zone as ready for arrival, and runs no pass per frame while it waits', () => {
    const h = harness();
    h.wait.settle('isle', 3, 4, ['mob_bear', 'mob_ember']);
    let passes = 0;
    let arrivals = 0;
    // main.ts maybeWarmCurrentZone over renderer.ts isZoneReadyAt and prewarmZoneAt
    for (let frame = 0; frame < 240; frame++) {
      const ready = zoneArrivalReady({
        prepared: true,
        programsPrewarmed: h.wait.settledOrWaiting('isle'),
        standardMaterials: false,
        skyResident: () => true,
      });
      if (ready) continue;
      arrivals++;
      if (!h.wait.skips('isle')) passes++;
    }
    expect(arrivals).toBe(0);
    expect(passes).toBe(0);
    expect(h.wait.skips('isle')).toBe(true);
    expect(h.queued).toHaveLength(0);
    // a zone neither prewarmed nor waiting is NOT ready (the guard still bites)
    expect(h.wait.settledOrWaiting('fen')).toBe(false);
    h.prewarmed.add('fen');
    expect(h.wait.settledOrWaiting('fen')).toBe(true);
  });

  it('hands a zone back once per landing, and keeps it reading ready until its pass settles', () => {
    const h = harness();
    h.wait.settle('isle', 3, 4, ['mob_bear', 'mob_ember']);
    h.wait.bodyArrived(); // an unrelated file: nothing landed for this zone
    expect(h.queued).toHaveLength(0);
    h.resident.add('mob_bear');
    h.wait.bodyArrived();
    h.wait.bodyArrived(); // another file of the same arrival: no second hand-back
    expect(h.queued).toHaveLength(1);
    expect(h.wait.skips('isle')).toBe(false);
    expect(h.wait.settledOrWaiting('isle')).toBe(true);
    h.runQueued();
    expect(h.rewarms).toEqual([{ x: 3, z: 4 }]);
    // that pass warmed the bear; the ember is still cold
    expect(h.wait.settle('isle', 3, 4, ['mob_ember'])).toBe(false);
    expect(h.wait.skips('isle')).toBe(true);
    h.resident.add('mob_ember');
    h.wait.bodyArrived();
    h.runQueued();
    expect(h.rewarms).toHaveLength(2);
    expect(h.wait.settle('isle', 3, 4, [])).toBe(true);
    expect(h.prewarmed.has('isle')).toBe(true);
    expect(h.wait.waitingZoneIds()).toEqual([]);
  });

  it('hands back at once a zone whose body landed while its pass was in flight', () => {
    const h = harness();
    // skipped cold at build time, resident by the time the pass settles
    h.resident.add('mob_bear');
    expect(h.wait.settle('isle', 3, 4, ['mob_bear'])).toBe(false);
    expect(h.queued).toHaveLength(1);
    expect(h.rewarms).toHaveLength(0); // deferred: never joined to the settling pass
    h.runQueued();
    expect(h.rewarms).toEqual([{ x: 3, z: 4 }]);
  });

  it('hands back every zone waiting on the same body, each at its own point', () => {
    const h = harness();
    h.wait.settle('isle', 3, 4, ['mob_bear']);
    h.wait.settle('dungeon:rift', 9000, 0, ['mob_bear', 'mob_bear']);
    h.resident.add('mob_bear');
    h.wait.bodyArrived();
    h.runQueued();
    expect(h.rewarms).toEqual([
      { x: 3, z: 4 },
      { x: 9000, z: 0 },
    ]);
  });

  it('drops a hand-back queued before clear(), and forgets the wait', () => {
    const h = harness();
    h.wait.settle('isle', 3, 4, ['mob_bear']);
    h.resident.add('mob_bear');
    h.wait.bodyArrived();
    expect(h.queued).toHaveLength(1);
    h.wait.clear();
    h.runQueued();
    expect(h.rewarms).toEqual([]);
    expect(h.wait.settledOrWaiting('isle')).toBe(false);
    expect(h.wait.skips('isle')).toBe(false);
    // a wait recorded after the clear hands back as usual
    h.wait.settle('isle', 3, 4, ['mob_bear']);
    h.runQueued();
    expect(h.rewarms).toEqual([{ x: 3, z: 4 }]);
  });

  it('keeps waiting through a lane fetch that fails, and settles when the retry lands', () => {
    const h = harness();
    h.wait.settle('isle', 3, 4, ['mob_bear']);
    // the lane's fetch fails: no file landed, so no arrival and nothing to hand back
    for (let frame = 0; frame < 60; frame++) expect(h.wait.skips('isle')).toBe(true);
    expect(h.wait.settledOrWaiting('isle')).toBe(true);
    expect(h.queued).toHaveLength(0);
    // the store's cooldown retry lands it (characters/assets.ts armCharacterRetry)
    h.resident.add('mob_bear');
    h.wait.bodyArrived();
    h.runQueued();
    expect(h.rewarms).toEqual([{ x: 3, z: 4 }]);
    expect(h.wait.settle('isle', 3, 4, [])).toBe(true);
    expect(h.prewarmed.has('isle')).toBe(true);
  });
});
