import { describe, expect, it } from 'vitest';
import { isBlocked, resolvePosition, supportHeightAt } from '../src/sim/colliders';
import { STATIONS } from '../src/sim/content/professions';
import { NPCS, OVERWORLD_GRAVEYARDS, PLAYER_START } from '../src/sim/data';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { MAX_STEP_HEIGHT } from '../src/sim/physics';
import { GRAVE_COUNT, graveHeight, graveOffset } from '../src/sim/prop_layout';
import { STATION_PROP_SIZES, townPropPlacements } from '../src/sim/town_props';
import { groundHeight } from '../src/sim/world';

const anchors = () => STATIONS.map((st) => ({ type: st.type, x: st.pos.x, z: st.pos.z }));
const townNpcs = () => {
  const out: { x: number; z: number }[] = [];
  for (const npc of Object.values(NPCS)) {
    const pos = (npc as { pos?: { x: number; z: number } }).pos;
    if (pos) out.push({ x: pos.x, z: pos.z });
  }
  for (const g of OVERWORLD_GRAVEYARDS) out.push({ x: g.x, z: g.z });
  return out;
};

// The town used to be full of solid furniture a player walked straight
// through: every profession station's anvil and loom, and every graveyard's
// headstones. These pin that they block, that they block at the height they
// are DRAWN at (so nothing is an invisible wall), and that adding them did
// not seal off anything the player has to reach. (The old Artisan Row pins
// left with the v0.31 civic rebuild, which removed the row itself.)

const SEED = 42;
const R = PLAYER_BODY_RADIUS;

describe('town furniture blocks', () => {
  it('blocks at every profession station cluster', () => {
    const placed = townPropPlacements(anchors(), townNpcs());
    let checked = 0;
    for (const prop of placed) {
      expect(isBlocked(SEED, prop.x, prop.z, R), `${prop.x},${prop.z}`).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('blocks the headstones, except the one a Spirit Healer stands on', () => {
    // Every overworld graveyard spawns a Spirit Healer at its anchor, which is
    // exactly where the grid's first stone is drawn. That one stays scenery
    // (walling it would push players out of release range of the healer); the
    // rest of the cemetery is solid.
    const gy = OVERWORLD_GRAVEYARDS[0];
    let blocked = 0;
    for (let i = 0; i < GRAVE_COUNT; i++) {
      const off = graveOffset(i);
      if (isBlocked(SEED, gy.x + off.x, gy.z + off.z, R)) blocked++;
    }
    expect(blocked).toBe(GRAVE_COUNT - 1);
    // The exception is the anchor stone, and only the anchor stone.
    const anchor = graveOffset(0);
    expect(anchor.x).toBe(0);
    expect(anchor.z).toBe(0);
    expect(isBlocked(SEED, gy.x, gy.z, R)).toBe(false);
  });
});

describe('town furniture is traversable, not a maze of walls', () => {
  it('is standable at exactly the height it is drawn', () => {
    // A collider taller than its model is the bug this whole pass exists to
    // remove, so the support surface must equal the published height.
    let pinned = 0;
    for (const prop of townPropPlacements(anchors(), townNpcs())) {
      if (!prop.size.standable) continue;
      const expected = groundHeight(prop.x, prop.z, SEED) + prop.size.height;
      expect(
        supportHeightAt(SEED, prop.x, prop.z, R, expected + 0.01),
        `${prop.x},${prop.z}`,
      ).toBeCloseTo(expected, 6);
      pinned++;
    }
    expect(pinned).toBeGreaterThan(10);
  });

  it('grows the headstones through the authored height ladder', () => {
    const heights = new Set<number>();
    for (let i = 0; i < GRAVE_COUNT; i++) heights.add(graveHeight(i));
    expect(heights.size).toBeGreaterThan(1);
    for (const h of heights) expect(h).toBeLessThanOrEqual(2.2);
  });

  it('leaves the low pieces strideable and the tall ones climbable', () => {
    // The ladder in one assertion: nothing in town is an unreachable wall.
    const heights = Object.values(STATION_PROP_SIZES).map((s) => s.height);
    const strideable = heights.filter((h) => h <= MAX_STEP_HEIGHT);
    expect(strideable.length).toBeGreaterThan(1); // crates, anvils
    // Everything else is inside the jump-plus-mantle reach or the climb reach.
    for (const h of heights) expect(h).toBeLessThanOrEqual(2.2);
  });

  it('never seals a station anchor or an NPC away from the player', () => {
    // The anchor prop sits ON the station position, which is also where the
    // proximity gate measures from: a body must still be able to stand within
    // interaction range of it rather than being pushed out of reach.
    for (const st of STATIONS) {
      const near = resolvePosition(SEED, st.pos.x + 2.2, st.pos.z, R);
      const dist = Math.hypot(near.x - st.pos.x, near.z - st.pos.z);
      expect(dist, st.id).toBeLessThan(4);
    }
    // No NEWLY added prop may be standing on a town NPC. (Some vendors
    // legitimately stand inside their own stall's long-standing footprint,
    // behind the counter, so the whole collider set is the wrong question:
    // this asks only about the furniture this pass introduced.)
    const npcs = townNpcs();
    for (const prop of townPropPlacements(anchors(), npcs)) {
      for (const npc of npcs) {
        const d = Math.hypot(prop.x - npc.x, prop.z - npc.z);
        expect(d, `prop at ${prop.x},${prop.z} stands on an NPC`).toBeGreaterThan(prop.size.r);
      }
    }
  });

  it('leaves the player spawn clear', () => {
    expect(isBlocked(SEED, PLAYER_START.x, PLAYER_START.z, R)).toBe(false);
  });
});
