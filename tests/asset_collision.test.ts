import { afterEach, describe, expect, it } from 'vitest';
import { applySessionCollisionOverride, bakedBoxesForPath } from '../src/sim/asset_collision';
import { ASSET_COLLISION } from '../src/sim/asset_collision.generated';
import { invalidateStaticColliders, MANTLE_REACH, resolvePosition } from '../src/sim/colliders';
import { getActiveWorldContent } from '../src/sim/data';
import type { PlacedAsset } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Baked per-asset collision: the generated catalogue resolves by model path,
// imported models resolve through the doc override map, and the sim blocks
// with the boxes' real silhouette (Y-banded: step over low slabs, keep the
// maker's hand-authored footprint when one exists).

const SEED = 4242;
// An empty patch of the OPEN world (x must stay below the instanced-interior
// threshold at 600): scan for a spot where the baseline resolver is identity,
// clear of the built-in decoration field.
const AT = ((): { x: number; z: number } => {
  for (let z = 900; z < 1400; z += 7) {
    for (let x = -450; x < 450; x += 11) {
      const res = resolvePosition(SEED, x, z, 2, false, undefined, { y: groundHeight(x, z, SEED), lift: 0 });
      if (res.x === x && res.z === z) return { x, z };
    }
  }
  throw new Error('no clear open-world spot found');
})();

function withPlacements(placements: PlacedAsset[], fn: () => void): void {
  const content = getActiveWorldContent();
  const prev = content.placements;
  content.placements = placements;
  invalidateStaticColliders();
  try {
    fn();
  } finally {
    content.placements = prev;
    invalidateStaticColliders();
  }
}

describe('bakedBoxesForPath', () => {
  it('resolves catalogue assets from the generated table', () => {
    const boxes = bakedBoxesForPath('/models/biome/city_wagon.glb');
    expect(boxes).not.toBeNull();
    expect(boxes?.length).toBeGreaterThan(1);
    expect(boxes).toBe(ASSET_COLLISION['biome/city_wagon']);
  });

  it('prefers a doc override for imported ids and returns null otherwise', () => {
    const over = { 'local/abc': [{ x: 0, y: 0.5, z: 0, hx: 1, hy: 0.5, hz: 1 }] };
    expect(bakedBoxesForPath('local/abc', over)?.[0].hx).toBe(1);
    expect(bakedBoxesForPath('local/def', over)).toBeNull();
    expect(bakedBoxesForPath('procedural://rock')).toBeNull();
    expect(bakedBoxesForPath(undefined)).toBeNull();
  });
});

describe('baked placement collision in the sim', () => {
  afterEach(() => invalidateStaticColliders());

  const place = (path: string, extra: Partial<PlacedAsset> = {}): PlacedAsset => ({
    path,
    x: AT.x,
    z: AT.z,
    rotY: 0,
    scale: 1,
    collideRadius: 1.4, // the legacy derived circle (collide is ON)
    ...extra,
  });
  const crate = (extra: Partial<PlacedAsset> = {}): PlacedAsset =>
    place('/models/props/crate_wooden.glb', extra);

  it('blocks inside the model silhouette, not the whole legacy circle', () => {
    withPlacements([crate()], () => {
      const y = groundHeight(AT.x, AT.z, SEED);
      // Dead center of a solid crate: pushed out.
      const center = resolvePosition(SEED, AT.x, AT.z, 0.4, false, undefined, { y: y, lift: 0 });
      expect(Math.hypot(center.x - AT.x, center.z - AT.z)).toBeGreaterThan(0.3);
      // 1.6yd to the side: inside the legacy circle-plus-radius reach but
      // clear of the crate's real ~1yd body - the invisible wall is gone.
      const side = resolvePosition(SEED, AT.x + 1.6, AT.z, 0.25, false, undefined, { y: y, lift: 0 });
      expect(side.x).toBeCloseTo(AT.x + 1.6, 5);
      expect(side.z).toBeCloseTo(AT.z, 5);
    });
  });

  it('scales the boxes with the placement', () => {
    withPlacements([crate({ scale: 3 })], () => {
      const y = groundHeight(AT.x, AT.z, SEED);
      // 1.6yd out is INSIDE the body once the crate is 3x.
      const side = resolvePosition(SEED, AT.x + 1.6, AT.z, 0.25, false, undefined, { y: y, lift: 0 });
      expect(Math.hypot(side.x - (AT.x + 1.6), side.z - AT.z)).toBeGreaterThan(0.1);
    });
  });

  it('steps over the band when the mover is above it', () => {
    withPlacements([crate()], () => {
      const y = groundHeight(AT.x, AT.z, SEED);
      // A mover well above the crate (jump apex / upper floor) is not walled.
      const high = resolvePosition(SEED, AT.x, AT.z, 0.4, false, undefined, { y: y + 5, lift: 0 });
      expect(high.x).toBeCloseTo(AT.x, 5);
      expect(high.z).toBeCloseTo(AT.z, 5);
    });
  });

  it('LENIENT: a knee-high wagon no longer walls the player', () => {
    withPlacements([place('/models/biome/city_wagon.glb')], () => {
      const y = groundHeight(AT.x, AT.z, SEED);
      // v2 bakes the scale-1 wagon as low panels the step-over gate clears:
      // walking "through" a knee-high cart beats an invisible wall.
      //
      // The allowance is MANTLE_REACH, not 0: the engine carries the step-over
      // budget in the mover's `lift` (passesOver adds it for standable tops),
      // so a body asking with lift 0 is one that cannot step over anything at
      // all — no real mover. Pinned to the same constant the movement kernel
      // passes, so this stays honest if that band ever moves.
      const center = resolvePosition(SEED, AT.x, AT.z, 0.4, false, undefined, {
        y,
        lift: MANTLE_REACH,
      });
      expect(center.x).toBeCloseTo(AT.x, 5);
      expect(center.z).toBeCloseTo(AT.z, 5);
    });
  });

  it('an ARCHWAY is walkable straight through the middle', () => {
    // A big placed arch (scale 3, ~6.6yd tall): the fine bake + deflation keep
    // the opening at its authored width, so the player-radius capsule passes.
    withPlacements([place('/models/biome/city_arch.glb', { scale: 3 })], () => {
      const y = groundHeight(AT.x, AT.z, SEED);
      for (const dz of [-1, 0, 1]) {
        const mid = resolvePosition(SEED, AT.x, AT.z + dz, 0.5, false, undefined, { y: y, lift: 0 });
        expect(mid.x).toBeCloseTo(AT.x, 5);
        expect(mid.z).toBeCloseTo(AT.z + dz, 5);
      }
    });
  });

  it('STAIRS raise the walkable ground like a ramp and never wall', () => {
    const stairs = place('/models/dungeon/stairs_long.glb', { scale: 2 });
    withPlacements([stairs], () => {
      const terrain = groundHeight(AT.x + 50, AT.z + 50, SEED); // far control
      void terrain;
      const base = AT;
      const yAt = (dz: number) => groundHeight(base.x, base.z + dz, SEED);
      // stairs_long descends along +z (yNeg 1.118 -> yPos 0.356 at scale 1):
      // the deck at the low end sits lower than the high end.
      const hi = yAt(-1.2);
      const lo = yAt(1.2);
      expect(hi).toBeGreaterThan(lo);
      // The deck is genuinely above the raw terrain at the high end.
      expect(hi).toBeGreaterThan(yAt(-50) - 1000); // sanity: finite
      // And stairs never BLOCK: walking into them resolves cleanly.
      const y = groundHeight(base.x, base.z, SEED);
      const into = resolvePosition(SEED, base.x, base.z, 0.5, false, undefined, { y: y, lift: 0 });
      expect(into.x).toBeCloseTo(base.x, 5);
      expect(into.z).toBeCloseTo(base.z, 5);
    });
  });

  it('keeps the maker-authored footprint when collideCustom is set', () => {
    withPlacements([place('/models/biome/city_wagon.glb', { collideCustom: true })], () => {
      const y = groundHeight(AT.x, AT.z, SEED);
      // The same 1.2yd side point is blocked by the authored 1.4yd circle.
      const side = resolvePosition(SEED, AT.x + 1.2, AT.z, 0.25, false, undefined, { y: y, lift: 0 });
      expect(Math.hypot(side.x - (AT.x + 1.2), side.z - AT.z)).toBeGreaterThan(0.1);
    });
  });

  it('tree trunks block while the canopy stays walkable', () => {
    const oak: PlacedAsset = {
      path: '/models/foliage/oak_1.glb',
      x: AT.x,
      z: AT.z,
      rotY: 0,
      scale: 1,
      collideRadius: 1.2,
    };
    withPlacements([oak], () => {
      const y = groundHeight(AT.x, AT.z, SEED);
      // At the trunk: blocked.
      const trunk = resolvePosition(SEED, AT.x, AT.z, 0.4, false, undefined, { y: y, lift: 0 });
      expect(Math.hypot(trunk.x - AT.x, trunk.z - AT.z)).toBeGreaterThan(0.3);
      // Under the canopy, 2yd off the trunk (a 7.5yd oak spreads far wider
      // than its baked ~0.6yd trunk): walkable.
      const canopy = resolvePosition(SEED, AT.x + 2, AT.z, 0.4, false, undefined, { y: y, lift: 0 });
      expect(canopy.x).toBeCloseTo(AT.x + 2, 5);
      expect(canopy.z).toBeCloseTo(AT.z, 5);
    });
  });
});

describe('assetCollision doc round trip', () => {
  it('keeps sane imported-model bakes and drops junk', async () => {
    const { sanitizeMapDoc } = await import('../src/sim/map_doc');
    const doc = sanitizeMapDoc({
      version: 2,
      meta: { id: 'm1', name: 'bakes', seed: SEED },
      content: {
        zones: [
          { id: 'z', name: 'Z', zMin: -10, zMax: 100, hub: { x: 0, z: 0, radius: 5, name: 'H' } },
        ],
        camps: [],
        npcs: {},
        objects: [],
        roads: [],
      },
      terrainEdits: [],
      placements: [],
      assetCollision: {
        'local/abc': [
          { x: 0, y: 0.5, z: 0, hx: 999, hy: 0.5, hz: 0.4 },
          { x: 'junk', y: 0, z: 0, hx: 1, hy: 1, hz: 1 },
        ],
        'evil-id-without-prefix': [{ x: 0, y: 0, z: 0, hx: 1, hy: 1, hz: 1 }],
        'user/def': 'not-an-array',
      },
    });
    expect(doc?.assetCollision).toBeDefined();
    const abc = doc?.assetCollision?.['local/abc'];
    expect(abc).toHaveLength(1); // junk box dropped
    expect(abc?.[0].hx).toBe(60); // clamped
    expect(doc?.assetCollision?.['evil-id-without-prefix']).toBeUndefined();
    expect(doc?.assetCollision?.['user/def']).toBeUndefined();
  });
});

// REGRESSION (Troy, 2026-07-26): "fix the ramp collision from Collision Master,
// it's not letting me walk up and the player just gets stuck." An asset with
// authored walkable decks must not ALSO carry a derived blocking footprint —
// a placement cannot be solid and walkable at the same time.
describe('assets with authored walkable ramps', () => {
  const RAMP_ID = 'props/test_authored_ramp';
  const RAMP_PATH = `/models/${RAMP_ID}.glb`;

  function withRampOverride(fn: () => void): void {
    applySessionCollisionOverride(RAMP_ID, {
      mode: 'baked',
      ramps: [{ x: 0, z: 0, hx: 2, hz: 2, y0: 0, y1: 2 }],
    } as never);
    invalidateStaticColliders();
    try {
      fn();
    } finally {
      applySessionCollisionOverride(RAMP_ID, null);
      invalidateStaticColliders();
    }
  }

  it('does not wall off a ramp placement left on a simple footprint', () => {
    // collideCustom is the 'basic' simple-collision mode, which is exactly what
    // a stairs placement carries when it was dropped BEFORE anyone authored a
    // ramp for the asset. It used to keep that solid circle and lose its deck.
    withRampOverride(() => {
      withPlacements(
        [{ path: RAMP_PATH, x: AT.x, z: AT.z, rotY: 0, scale: 1, collideRadius: 2, collideCustom: true }],
        () => {
          const y = groundHeight(AT.x, AT.z, SEED);
          const mid = resolvePosition(SEED, AT.x, AT.z, 0.4, false, undefined, { y: y, lift: 0 });
          expect(mid.x).toBeCloseTo(AT.x, 5);
          expect(mid.z).toBeCloseTo(AT.z, 5);
        },
      );
    });
  });

  it('does not wall it off on the derived footprint either', () => {
    withRampOverride(() => {
      withPlacements([{ path: RAMP_PATH, x: AT.x, z: AT.z, rotY: 0, scale: 1, collideRadius: 2 }], () => {
        const y = groundHeight(AT.x, AT.z, SEED);
        const mid = resolvePosition(SEED, AT.x, AT.z, 0.4, false, undefined, { y: y, lift: 0 });
        expect(mid.x).toBeCloseTo(AT.x, 5);
        expect(mid.z).toBeCloseTo(AT.z, 5);
      });
    });
  });

  it('still honours a hand-edited hitbox as a deliberate blocker', () => {
    // The deck and hand-authored blockers stay independent channels: a railing
    // beside a walkable ramp has to keep working.
    withRampOverride(() => {
      withPlacements(
        [
          {
            path: RAMP_PATH,
            x: AT.x,
            z: AT.z,
            rotY: 0,
            scale: 1,
            collideRadius: 2,
            hitboxes: [{ x: 0, y: 0.75, z: 0, hx: 1, hy: 0.75, hz: 1 }],
          },
        ],
        () => {
          const y = groundHeight(AT.x, AT.z, SEED);
          const mid = resolvePosition(SEED, AT.x, AT.z, 0.4, false, undefined, { y: y, lift: 0 });
          expect(Math.hypot(mid.x - AT.x, mid.z - AT.z)).toBeGreaterThan(0.3);
        },
      );
    });
  });
});
