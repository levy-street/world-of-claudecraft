import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { firstHarborHullColliderOverlap } from '../src/render/harbor_ship_tripwire_core.js';
import type { HarborDef } from '../src/sim/harbor_layout.js';

const HARBOR_SOURCE = readFileSync(new URL('../src/render/harbor.ts', import.meta.url), 'utf8');

function harbor(id: string, x: number, z: number): HarborDef {
  return {
    id: id as HarborDef['id'],
    decks: [{ x: x + 20, z, y: 1, hw: 3, hd: 3 }],
    rails: [],
    ramps: [],
    dressing: [],
    berth: {
      x,
      z,
      rot: 0,
      draft: 2,
      length: 12,
    },
    shipDecks: [{ x, z, y: 2, hw: 4, hd: 8 }],
    shipRails: [],
    shipBlockers: [],
    keeperPost: { x: 0, z: 0 },
  gangplank: { x, z, facing: 0 },
    boarding: { x, z },
    deckArrival: { x, z },
    arrival: { x, z },
    bounds: { x0: x - 4, x1: x + 23, z0: z - 8, z1: z + 8 },
  };
}

describe('harbor ship tripwire core', () => {
  it('reports the first fixed collider overlapped by the moving hull box', () => {
    const moving = harbor('moving', 0, 0);
    const fixed: HarborDef = {
      ...harbor('fixed', 100, 100),
      decks: [{ x: 2, z: 0, y: 1, hw: 2, hd: 2 }],
    };

    expect(
      firstHarborHullColliderOverlap(moving, { position: { x: 0, y: 0, z: 0 }, yaw: 0 }, [
        moving,
        fixed,
      ]),
    ).toMatchObject({
      harborId: 'fixed',
      colliderKind: 'deck',
      colliderIndex: 0,
    });
  });

  it('returns null when the moving hull clears every fixed collider', () => {
    const moving = harbor('moving', 0, 0);
    const fixed = harbor('fixed', 100, 100);

    expect(
      firstHarborHullColliderOverlap(moving, { position: { x: 0, y: 0, z: 0 }, yaw: 0 }, [
        moving,
        fixed,
      ]),
    ).toBeNull();
  });

  it('checks ramps independently and rejects vertical separation', () => {
    const moving = harbor('moving', 0, 0);
    const ramp: HarborDef = {
      ...harbor('ramp', 100, 100),
      decks: [],
      ramps: [{ x: 2, z: 0, hw: 2, hd: 2, dir: 'x+', lowY: -1, highY: 1 }],
    };
    expect(
      firstHarborHullColliderOverlap(moving, { position: { x: 0, y: 0, z: 0 }, yaw: 0 }, [
        moving,
        ramp,
      ]),
    ).toMatchObject({ harborId: 'ramp', colliderKind: 'ramp', colliderIndex: 0 });
    expect(
      firstHarborHullColliderOverlap(moving, { position: { x: 0, y: 20, z: 0 }, yaw: 0 }, [
        moving,
        ramp,
      ]),
    ).toBeNull();
  });

  it('pins the development-only warning and per-cue deduplication boundary', () => {
    expect(HARBOR_SOURCE).toContain('if (import.meta.env.DEV) {');
    expect(HARBOR_SOURCE).toContain(
      'const overlap = firstHarborHullColliderOverlap(handle.harbor, frame, activeHarbors);',
    );
    expect(HARBOR_SOURCE).toContain('if (!warnedHullCues.has(key)) {');
    expect(HARBOR_SOURCE).toContain('console.warn(');
    expect(HARBOR_SOURCE).toContain('warnedHullCues?.clear();');
  });
});
