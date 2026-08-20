// The town static-cull first-reveal policy (town_reveal_core.ts). A camera
// already among the buildings is an IMMINENT hold, not an instant reveal and
// not a timed one: it consults like any other reveal, its compiles are
// submitted first and nearest first, and each root comes in on its own
// compile. The only thing that shows an unlinked root is the reach floor.

import { describe, expect, it } from 'vitest';
import { createRevealGateCore } from '../src/render/reveal_gate_core';
import {
  newTownPiecewiseReveal,
  orderTownRootsNearestFirst,
  TOWN_PIECEWISE_REVEALS_PER_FRAME,
  TOWN_REVEAL_REACH_YD,
  townPiecewiseRevealInto,
  townRootVisible,
  townStaticReveal,
} from '../src/render/town_reveal_core';

const CULL_RADIUS = 60;

describe('town static first-reveal policy (hitch-hunt P3a)', () => {
  it('fog-hidden wins regardless of the latch, without consulting the gate', () => {
    let consulted = 0;
    const gate = {
      allow: () => {
        consulted++;
        return true;
      },
    };
    expect(townStaticReveal(false, false, 1e6, CULL_RADIUS, gate, 'town')).toBe('hidden');
    expect(townStaticReveal(false, true, 1e6, CULL_RADIUS, gate, 'town')).toBe('hidden');
    expect(consulted).toBe(0);
  });

  it('an already-revealed town never consults the gate again', () => {
    let consulted = 0;
    const gate = {
      allow: () => {
        consulted++;
        return false;
      },
    };
    expect(townStaticReveal(true, true, 1e6, CULL_RADIUS, gate, 'town')).toBe('revealed');
    expect(consulted).toBe(0);
  });

  it('a camera already inside the town holds, marked IMMINENT, with no end but the compile', () => {
    // Login, hearth, or teleport lands the player among the buildings. That
    // used to reveal on the spot, on the premise that the cover's zone
    // prepare had compiled the town; where it had not, the whole kit linked
    // in live frames. It holds now, and what being inside buys is that the
    // town's compiles are submitted ahead of every other reveal.
    const requested: { key: string; imminent: boolean }[] = [];
    const gate = createRevealGateCore((key, imminent) => requested.push({ key, imminent }));
    const inside = CULL_RADIUS * CULL_RADIUS;
    expect(townStaticReveal(true, false, inside, CULL_RADIUS, gate, 'town')).toBe('held');
    expect(requested).toEqual([{ key: 'town', imminent: true }]);
    // No clock is threaded anywhere: however many frames consult, the answer
    // stays 'held' until the compiles land.
    for (let frame = 0; frame < 500; frame++) {
      expect(townStaticReveal(true, false, inside, CULL_RADIUS, gate, 'town')).toBe('held');
    }
    expect(requested).toHaveLength(1);
  });

  it('an inside camera reveals as soon as the town settles', () => {
    const gate = createRevealGateCore(() => undefined);
    const inside = CULL_RADIUS * CULL_RADIUS;
    expect(townStaticReveal(true, false, inside, CULL_RADIUS, gate, 'town')).toBe('held');
    gate.settle('town');
    expect(townStaticReveal(true, false, inside, CULL_RADIUS, gate, 'town')).toBe('revealed');
  });

  it('a walking approach is submitted ordinarily and waits for its compiles', () => {
    const outside = (CULL_RADIUS + 1) * (CULL_RADIUS + 1);
    const requested: { key: string; imminent: boolean }[] = [];
    const gate = createRevealGateCore((key, imminent) => requested.push({ key, imminent }));
    expect(townStaticReveal(true, false, outside, CULL_RADIUS, gate, 'town')).toBe('held');
    expect(requested).toEqual([{ key: 'town', imminent: false }]);
    for (let frame = 0; frame < 500; frame++) {
      expect(townStaticReveal(true, false, outside, CULL_RADIUS, gate, 'town')).toBe('held');
    }
  });

  it('a walking approach holds while the gate denies and reveals once it allows', () => {
    const outside = (CULL_RADIUS + 1) * (CULL_RADIUS + 1);
    let warm = false;
    const consulted: string[] = [];
    const gate = {
      allow: (key: string) => {
        consulted.push(key);
        return warm;
      },
    };
    expect(townStaticReveal(true, false, outside, CULL_RADIUS, gate, 'town')).toBe('held');
    warm = true;
    expect(townStaticReveal(true, false, outside, CULL_RADIUS, gate, 'town')).toBe('revealed');
    expect(consulted).toEqual(['town', 'town']);
  });

  it('no gate keeps the historical immediate reveal', () => {
    const outside = (CULL_RADIUS + 1) * (CULL_RADIUS + 1);
    expect(townStaticReveal(true, false, outside, CULL_RADIUS, null, 'town')).toBe('revealed');
  });
});

describe('town piecewise per-root reveal', () => {
  const roots = [{ id: 'batch' }, { id: 'near' }, { id: 'mid' }, { id: 'far' }];
  const xs = [0, 100, 300, 900];
  const zs = [0, 0, 0, 0];
  /** Camera far enough from every anchor that the reach floor never fires:
   *  these cases are about READINESS order, and the floor has its own block. */
  const CAM_X = -500;
  const newState = () => newTownPiecewiseReveal('town', roots, xs, zs);

  /** A gate whose readiness set the test drives directly. */
  function readyGate(ready: Set<object>) {
    const noted: string[] = [];
    const reached: string[] = [];
    return {
      noted,
      reached,
      gate: {
        allow: () => false,
        rootReady: (_key: string, root: object) => ready.has(root),
        noteRootRevealed: (key: string) => noted.push(key),
        noteRootRevealedAtReach: (key: string) => reached.push(key),
      },
    };
  }

  it('reveals a ready root while the key is still held', () => {
    const ready = new Set<object>([roots[2]]);
    const { gate } = readyGate(ready);
    const state = newState();
    expect(townPiecewiseRevealInto(state, 'held', CAM_X, 0, gate)).toBe(1);
    expect(townRootVisible('held', state, 2)).toBe(true);
    // Everything else keeps waiting for its own compile.
    expect(townRootVisible('held', state, 0)).toBe(false);
    expect(townRootVisible('held', state, 3)).toBe(false);
  });

  it('takes the NEAREST ready roots first when several land in the same frame', () => {
    // The reveal order decides which first draws the player is looking at
    // while the rest still link: the near ones must not queue behind a
    // distant batch that happened to link first.
    const ready = new Set<object>(roots);
    const { gate } = readyGate(ready);
    const state = newState();
    // Camera at x=1400: 'far' (900) is nearest, then 'mid' (300).
    expect(townPiecewiseRevealInto(state, 'held', 1_400, 0, gate)).toBe(2);
    expect(townRootVisible('held', state, 3)).toBe(true);
    expect(townRootVisible('held', state, 2)).toBe(true);
    expect(townRootVisible('held', state, 1)).toBe(false);
    expect(townRootVisible('held', state, 0)).toBe(false);
    // Next frame continues down the same order, still nearest first.
    expect(townPiecewiseRevealInto(state, 'held', 1_400, 0, gate)).toBe(2);
    expect(townRootVisible('held', state, 1)).toBe(true);
    expect(townRootVisible('held', state, 0)).toBe(true);
    expect(townPiecewiseRevealInto(state, 'held', 1_400, 0, gate)).toBe(0);
  });

  it('never flips more than the per-frame budget, so a whole town cannot land in one frame', () => {
    const ready = new Set<object>(roots);
    const { gate } = readyGate(ready);
    const state = newState();
    expect(townPiecewiseRevealInto(state, 'held', CAM_X, 0, gate)).toBe(
      TOWN_PIECEWISE_REVEALS_PER_FRAME,
    );
  });

  it('a root once shown is never hidden again by the policy', () => {
    // Hiding a revealed object between frames moves the counted light set
    // (numPointLights is in three's program cache key), which is a fresh
    // program link on the re-show: the exact cost the gate exists to avoid.
    const ready = new Set<object>([roots[1]]);
    const { gate } = readyGate(ready);
    const state = newState();
    townPiecewiseRevealInto(state, 'held', CAM_X, 0, gate);
    ready.clear();
    townPiecewiseRevealInto(state, 'held', CAM_X, 0, gate);
    expect(townRootVisible('held', state, 1)).toBe(true);
  });

  it('reports every piecewise reveal to the gate, once per root', () => {
    const ready = new Set<object>([roots[1]]);
    const { gate, noted, reached } = readyGate(ready);
    const state = newState();
    townPiecewiseRevealInto(state, 'held', CAM_X, 0, gate);
    townPiecewiseRevealInto(state, 'held', CAM_X, 0, gate);
    expect(noted).toEqual(['town']);
    // A compile-driven reveal is never counted as a reach one.
    expect(reached).toEqual([]);
  });

  it('does nothing outside the held state', () => {
    const ready = new Set<object>(roots);
    const { gate } = readyGate(ready);
    const state = newState();
    expect(townPiecewiseRevealInto(state, 'revealed', CAM_X, 0, gate)).toBe(0);
    expect(townPiecewiseRevealInto(state, 'hidden', CAM_X, 0, gate)).toBe(0);
    // Not even the reach floor: a fog-hidden or already-revealed town has
    // nothing for this pass to decide.
    expect(townPiecewiseRevealInto(state, 'hidden', 0, 0, gate)).toBe(0);
    expect(state.revealed[0]).toBe(0);
  });

  it('a fog-hidden town hides every root, revealed or not', () => {
    const ready = new Set<object>([roots[1]]);
    const { gate } = readyGate(ready);
    const state = newState();
    townPiecewiseRevealInto(state, 'held', CAM_X, 0, gate);
    expect(townRootVisible('hidden', state, 1)).toBe(false);
  });

  it('a warm town shows every root, whatever the piecewise latch says', () => {
    const state = newState();
    for (let index = 0; index < roots.length; index++) {
      expect(townRootVisible('revealed', state, index)).toBe(true);
    }
  });

  it('a gate without per-root readiness keeps the all-or-nothing hold', () => {
    // The historical shape: an older gate, or none at all, must never leave a
    // root revealed by an undefined readiness answer.
    const state = newState();
    expect(townPiecewiseRevealInto(state, 'held', CAM_X, 0, { allow: () => false })).toBe(0);
    expect(townPiecewiseRevealInto(state, 'held', CAM_X, 0, null)).toBe(0);
    expect(townRootVisible('held', state, 0)).toBe(false);
  });

  it('a root with no position falls back to the town centre distance', () => {
    // The static batches span the whole town: their honest anchor is the
    // centre, and a short position list must not read past its end.
    const state = newTownPiecewiseReveal('town', roots, [0, 100], [0, 0]);
    const ready = new Set<object>([roots[3]]);
    const { gate } = readyGate(ready);
    expect(townPiecewiseRevealInto(state, 'held', CAM_X, 0, gate)).toBe(1);
    expect(townRootVisible('held', state, 3)).toBe(true);
  });

  it('holds a root whose compile never lands, for as many frames as it takes', () => {
    // The bound is gone: there is no clock in this core and no argument that
    // could stand in for one, so an unready root outside the reach floor is
    // simply never shown by this pass.
    const { gate } = readyGate(new Set<object>());
    const state = newState();
    for (let frame = 0; frame < 1_000; frame++) {
      expect(townPiecewiseRevealInto(state, 'held', CAM_X, 0, gate)).toBe(0);
    }
    for (let index = 0; index < roots.length; index++) {
      expect(townRootVisible('held', state, index)).toBe(false);
    }
  });
});

describe('town reveal reach floor', () => {
  const roots = [{ id: 'batch' }, { id: 'near' }, { id: 'mid' }, { id: 'far' }];
  const xs = [0, 100, 300, 900];
  const zs = [0, 0, 0, 0];
  const newState = () => newTownPiecewiseReveal('town', roots, xs, zs);

  function reachGate() {
    const noted: string[] = [];
    const reached: string[] = [];
    return {
      noted,
      reached,
      gate: {
        allow: () => false,
        rootReady: () => false,
        noteRootRevealed: (key: string) => noted.push(key),
        noteRootRevealedAtReach: (key: string) => reached.push(key),
      },
    };
  }

  it('shows a root inside the reach on the first held frame, unlinked, and says so', () => {
    const { gate, noted, reached } = reachGate();
    const state = newState();
    // Camera on the 'near' anchor: it is at arm's length, the rest is not.
    expect(townPiecewiseRevealInto(state, 'held', 100, 0, gate)).toBe(1);
    expect(townRootVisible('held', state, 1)).toBe(true);
    expect(townRootVisible('held', state, 0)).toBe(false);
    expect(townRootVisible('held', state, 2)).toBe(false);
    expect(townRootVisible('held', state, 3)).toBe(false);
    // Counted apart from the compile-driven reveals: these may draw cold.
    expect(reached).toEqual(['town']);
    expect(noted).toEqual([]);
    // Reported once, however many frames the key stays held.
    expect(townPiecewiseRevealInto(state, 'held', 100, 0, gate)).toBe(0);
    expect(reached).toEqual(['town']);
  });

  it('takes exactly the roots at or inside the reach, and no others', () => {
    const { gate } = reachGate();
    const state = newState();
    // Camera at the reach distance from 'near' (100) and one yard further
    // from 'batch' (0): the boundary is inclusive.
    expect(townPiecewiseRevealInto(state, 'held', 100 - TOWN_REVEAL_REACH_YD, 0, gate)).toBe(1);
    expect(townRootVisible('held', state, 1)).toBe(true);
    expect(townRootVisible('held', state, 0)).toBe(false);
  });

  it("ignores the per-frame budget: every collider at arm's length shows at once", () => {
    // Three anchors on the same spot is a plaza: the fairness floor is not a
    // paced reveal, so the budget that spreads compile landings cannot hold
    // one of them back.
    const plaza = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const state = newTownPiecewiseReveal('town', plaza, [0, 1, 2], [0, 0, 0]);
    const { gate } = reachGate();
    expect(townPiecewiseRevealInto(state, 'held', 0, 0, gate)).toBe(plaza.length);
    expect(plaza.length).toBeGreaterThan(TOWN_PIECEWISE_REVEALS_PER_FRAME);
  });

  it('floors a gate with no per-root readiness, and a null gate', () => {
    // The fairness contract does not depend on the gate's shape: a collider
    // at arm's length is visible whatever the gate can answer.
    const state = newTownPiecewiseReveal('town', roots, xs, zs);
    expect(townPiecewiseRevealInto(state, 'held', 100, 0, { allow: () => false })).toBe(1);
    expect(townRootVisible('held', state, 1)).toBe(true);
    const other = newTownPiecewiseReveal('town', roots, xs, zs);
    expect(townPiecewiseRevealInto(other, 'held', 100, 0, null)).toBe(1);
    expect(townRootVisible('held', other, 1)).toBe(true);
  });

  it('is far smaller than the props reach, because a town kit links as one', () => {
    // Revealing one unlinked building links the whole shared kit cold, so the
    // town floor covers only what the player can physically touch.
    expect(TOWN_REVEAL_REACH_YD).toBe(12);
  });

  it('never takes a town-spanning batch, whose anchor is the town centre', () => {
    // The arrival shape the towns really produce: every static batch anchors
    // at the centre, so a camera standing there is "at arm's length" of all of
    // them at once. That is the whole-kit unlinked burst the policy exists to
    // prevent, and only the building with a real footprint may take the floor.
    const townRoots = [
      { id: 'micro-batch' },
      { id: 'wall-batch' },
      { id: 'building-here' },
      { id: 'building-far' },
    ];
    const state = newTownPiecewiseReveal(
      'town',
      townRoots,
      [0, 0, 3, 400],
      [0, 0, 0, 0],
      [false, false, true, true],
    );
    const { gate, reached } = reachGate();
    expect(townPiecewiseRevealInto(state, 'held', 0, 0, gate)).toBe(1);
    expect(townRootVisible('held', state, 2)).toBe(true);
    expect(townRootVisible('held', state, 0)).toBe(false);
    expect(townRootVisible('held', state, 1)).toBe(false);
    expect(townRootVisible('held', state, 3)).toBe(false);
    expect(reached).toEqual(['town']);
    // The batches are not merely deferred a frame: they wait for their own
    // compile however long the camera stands on their anchor.
    expect(townPiecewiseRevealInto(state, 'held', 0, 0, gate)).toBe(0);
    expect(townRootVisible('held', state, 0)).toBe(false);
  });

  it('keeps the centre anchor for the ORDER a batch is submitted in', () => {
    // Excluding a batch from the reach must not cost it its anchor: the
    // nearest-first submission still reads x/z, so a camera at the centre
    // still asks for the batches before the far building.
    const townRoots = [{ id: 'micro-batch' }, { id: 'building-far' }];
    const state = newTownPiecewiseReveal('town', townRoots, [0, 400], [0, 0], [false, true]);
    const out: { id: string }[] = [];
    expect(orderTownRootsNearestFirst(townRoots, state.x, state.z, 0, 0, out)).toEqual(townRoots);
    expect(state.footprint[0]).toBe(0);
    expect(state.footprint[1]).toBe(1);
  });

  it('defaults an unflagged root to footprint-anchored, so the floor still holds', () => {
    // Every caller that has a real anchor per root omits the flag list.
    const state = newTownPiecewiseReveal('town', [{ id: 'near' }], [100], [0]);
    expect(state.footprint[0]).toBe(1);
    const { gate } = reachGate();
    expect(townPiecewiseRevealInto(state, 'held', 100, 0, gate)).toBe(1);
  });
});

describe('town reveal root submission order', () => {
  const roots = ['batch', 'near', 'mid', 'far'];
  const x = Float32Array.from([0, 100, 300, 900]);
  const z = Float32Array.from([0, 0, 0, 0]);

  it('hands the gate the roots nearest to the camera first', () => {
    const out: string[] = [];
    expect(orderTownRootsNearestFirst(roots, x, z, 950, 0, out)).toEqual([
      'far',
      'mid',
      'near',
      'batch',
    ]);
    expect(orderTownRootsNearestFirst(roots, x, z, -50, 0, out)).toEqual([
      'batch',
      'near',
      'mid',
      'far',
    ]);
  });

  it('refills the caller-owned array rather than allocating a new one', () => {
    const out: string[] = [];
    const first = orderTownRootsNearestFirst(roots, x, z, 0, 0, out);
    const second = orderTownRootsNearestFirst(roots, x, z, 1_000, 0, out);
    expect(first).toBe(out);
    expect(second).toBe(out);
    expect(out).toHaveLength(roots.length);
  });

  it('keeps declaration order for roots at the same distance', () => {
    // Every static batch anchors at the town centre, so ties are the norm and
    // the submission order has to stay deterministic.
    const tied = ['a', 'b', 'c'];
    const out: string[] = [];
    const anchors = Float32Array.from([0, 0, 0]);
    expect(orderTownRootsNearestFirst(tied, anchors, anchors, 40, 0, out)).toEqual(tied);
  });

  it('anchors a root past the end of the position arrays at the town centre', () => {
    const out: string[] = [];
    const short = Float32Array.from([900]);
    expect(orderTownRootsNearestFirst(roots, short, short, 10, 0, out)).toEqual([
      'near',
      'mid',
      'far',
      'batch',
    ]);
  });
});
