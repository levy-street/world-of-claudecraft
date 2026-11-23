// The Mirefen mudfin huts table (src/sim/mudfin_huts.ts): which painted hut
// stands at each of the five built-in mud huts west of Fenbridge, which way its
// door faces, and the solid wall the colliders build from the same numbers the
// renderer draws (the huts are not walk-in).
import { describe, expect, it } from 'vitest';
import { isBlocked, resolvePosition } from '../src/sim/colliders';
import { PALMREACH_PROPS } from '../src/sim/content/palmreach';
import { ZONE1_PROPS } from '../src/sim/content/zone1';
import { ZONE2_OBJECTS } from '../src/sim/content/zone2';
import { PROPS } from '../src/sim/data';
import { FENBRIDGE_LAYOUT } from '../src/sim/fenbridge_layout';
import { HUT_BURN_RANGE, HUT_OBJECT_ID } from '../src/sim/interactions/firebottle_hut';
import {
  insideMudfinHutWall,
  MUDFIN_HUT_MODELS,
  MUDFIN_HUT_TEMPLATE_ID,
  MUDFIN_HUTS,
  mudfinHutAt,
  mudfinHutNear,
  mudHutCollider,
} from '../src/sim/mudfin_huts';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import type { Vec3 } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

const CAMP_LINK_YD = 15;
const YAW_JITTER_RAD = 0.35;
/** A player body (0.5 yd radius, resolvePosition's default) still fits between
 *  two huts' walls, with a little to spare. */
const WALK_GAP_YD = 1.1;
const BODY_RADIUS_YD = 0.5;
/** How far out from a door the lane a player walks up to it runs. */
const DOOR_LANE_YD = 4;

function angleBetween(a: number, b: number): number {
  const d = Math.atan2(Math.sin(a - b), Math.cos(a - b));
  return Math.abs(d);
}

describe('mudfin huts table', () => {
  it('stands one painted hut at every Mirefen mud hut, in layout order', () => {
    const spots = FENBRIDGE_LAYOUT.preservedProps.mudHuts;
    expect(MUDFIN_HUTS).toHaveLength(5);
    expect(MUDFIN_HUTS.map((hut) => [hut.x, hut.z])).toEqual(spots.map(([x, z]) => [x, z]));
    // every one is a live built-in mud hut, so the renderer and colliders meet it
    for (const hut of MUDFIN_HUTS) {
      expect(PROPS.mudHuts.some(([x, z]) => x === hut.x && z === hut.z)).toBe(true);
    }
  });

  it('uses both designs, and both stand in each camp', () => {
    expect(new Set(MUDFIN_HUTS.map((hut) => hut.model))).toEqual(new Set(['a', 'b']));
    const camps: (typeof MUDFIN_HUTS)[number][][] = [];
    for (const hut of MUDFIN_HUTS) {
      const camp = camps.find((c) =>
        c.some((o) => Math.hypot(o.x - hut.x, o.z - hut.z) < CAMP_LINK_YD),
      );
      if (camp) camp.push(hut);
      else camps.push([hut]);
    }
    expect(camps.map((c) => c.length)).toEqual([3, 2]);
    for (const camp of camps) expect(new Set(camp.map((hut) => hut.model)).size).toBe(2);
  });

  it('turns every door away from the middle of its camp, give or take the jitter', () => {
    for (const hut of MUDFIN_HUTS) {
      const camp = MUDFIN_HUTS.filter((o) => Math.hypot(o.x - hut.x, o.z - hut.z) < CAMP_LINK_YD);
      const cx = camp.reduce((s, o) => s + o.x, 0) / camp.length;
      const cz = camp.reduce((s, o) => s + o.z, 0) / camp.length;
      expect(angleBetween(hut.yaw, Math.atan2(hut.x - cx, hut.z - cz))).toBeLessThanOrEqual(
        YAW_JITTER_RAD + 1e-9,
      );
    }
    // the jitter is real: not every door is exactly on the camp's outward line
    expect(new Set(MUDFIN_HUTS.map((hut) => hut.yaw.toFixed(6))).size).toBe(MUDFIN_HUTS.length);
  });

  it('keeps the walk up to every door clear of the neighbouring huts', () => {
    for (const hut of MUDFIN_HUTS) {
      const dx = Math.sin(hut.yaw);
      const dz = Math.cos(hut.yaw);
      const wall = MUDFIN_HUT_MODELS[hut.model].radius;
      for (const other of MUDFIN_HUTS) {
        if (other === hut) continue;
        // the lane's closest point (the door line, from the wall out) to the other hut
        const along = (other.x - hut.x) * dx + (other.z - hut.z) * dz;
        const t = Math.min(Math.max(along, wall), wall + DOOR_LANE_YD);
        const miss = Math.hypot(hut.x + dx * t - other.x, hut.z + dz * t - other.z);
        expect(miss).toBeGreaterThan(MUDFIN_HUT_MODELS[other.model].radius + BODY_RADIUS_YD);
      }
    }
  });

  it('leaves room to walk between neighbouring huts', () => {
    for (const [i, a] of MUDFIN_HUTS.entries()) {
      for (const b of MUDFIN_HUTS.slice(i + 1)) {
        const gap =
          Math.hypot(a.x - b.x, a.z - b.z) -
          MUDFIN_HUT_MODELS[a.model].radius -
          MUDFIN_HUT_MODELS[b.model].radius;
        expect(gap).toBeGreaterThan(WALK_GAP_YD);
      }
    }
  });

  it('looks up only the Mirefen huts; Eastbrook and Palm Reach keep the mushroom', () => {
    for (const hut of MUDFIN_HUTS) expect(mudfinHutAt(hut.x, hut.z)).toBe(hut);
    for (const [x, z] of [...ZONE1_PROPS.mudHuts, ...PALMREACH_PROPS.mudHuts]) {
      expect(mudfinHutAt(x, z)).toBeNull();
    }
    expect(ZONE1_PROPS.mudHuts.length + PALMREACH_PROPS.mudHuts.length).toBeGreaterThan(0);
    expect(mudfinHutAt(MUDFIN_HUTS[0].x + 0.5, MUDFIN_HUTS[0].z)).toBeNull();
  });

  it('finds the nearest hut for a position that crossed the wire, and nothing far off', () => {
    for (const hut of MUDFIN_HUTS) {
      expect(mudfinHutNear(hut.x, hut.z)).toBe(hut);
      expect(mudfinHutNear(hut.x + 0.4, hut.z - 0.3)).toBe(hut);
      expect(mudfinHutNear(hut.x + 2, hut.z)).toBeNull();
    }
    for (const [x, z] of [...ZONE1_PROPS.mudHuts, ...PALMREACH_PROPS.mudHuts]) {
      expect(mudfinHutNear(x, z)).toBeNull();
    }
    // never ambiguous: the closest pair stands far further apart than the reach
    for (const [i, a] of MUDFIN_HUTS.entries()) {
      for (const b of MUDFIN_HUTS.slice(i + 1)) {
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2 * 0.75);
      }
    }
  });

  it('sits the torchable hut objects on the same five spots, under the shared template', () => {
    expect(MUDFIN_HUT_TEMPLATE_ID).toBe(`ground_${HUT_OBJECT_ID}`);
    const huts = ZONE2_OBJECTS.find((o) => o.itemId === HUT_OBJECT_ID);
    expect(huts?.positions.map((p) => [p.x, p.z])).toEqual(MUDFIN_HUTS.map((h) => [h.x, h.z]));
  });

  it('keeps a player pressed against any wall inside the firebottle throw range', () => {
    // the burn range is measured from the hut's centre, and the wall stops the
    // body this far out: a bigger hut must never put its centre out of reach
    for (const spec of Object.values(MUDFIN_HUT_MODELS)) {
      expect(spec.radius + BODY_RADIUS_YD).toBeLessThan(HUT_BURN_RANGE - 1);
    }
  });
});

describe('mud hut colliders', () => {
  const top = (h: number) => 100 + h;

  it('gives a mudfin hut its solid wall and drawn height', () => {
    for (const hut of MUDFIN_HUTS) {
      const spec = MUDFIN_HUT_MODELS[hut.model];
      expect(mudHutCollider(hut.x, hut.z, top)).toEqual({
        type: 'circle',
        x: hut.x,
        z: hut.z,
        r: spec.radius,
        cameraTopY: 100 + spec.height,
        underY: 100,
      });
    }
  });

  it('keeps every other mud hut on the Kenney mushroom stem, as before', () => {
    const [x, z] = ZONE1_PROPS.mudHuts[0];
    expect(mudHutCollider(x, z, top)).toEqual({
      type: 'circle',
      x,
      z,
      r: 1.1,
      cameraTopY: 112.5,
      underY: 100,
    });
  });

  it('stops a player at the wall of every mudfin hut, in the live world', () => {
    for (const hut of MUDFIN_HUTS) {
      const spec = MUDFIN_HUT_MODELS[hut.model];
      // walking up to the door, out on the open side a player comes from
      const outX = Math.sin(hut.yaw);
      const outZ = Math.cos(hut.yaw);
      // inside the wall is solid ground no body can stand on
      expect(
        isBlocked(WORLD_SEED, hut.x + outX * spec.radius * 0.6, hut.z + outZ * spec.radius * 0.6),
      ).toBe(true);
      // a body pressed into the wall is pushed back out to it
      const pushed = resolvePosition(
        WORLD_SEED,
        hut.x + outX * (spec.radius - 0.3),
        hut.z + outZ * (spec.radius - 0.3),
      );
      expect(Math.hypot(pushed.x - hut.x, pushed.z - hut.z)).toBeGreaterThanOrEqual(
        spec.radius + 0.5 - 1e-6,
      );
      // and the doorstep, a stride outside the wall, is open
      expect(
        isBlocked(WORLD_SEED, hut.x + outX * (spec.radius + 1), hut.z + outZ * (spec.radius + 1)),
      ).toBe(false);
    }
  }, 120_000);
});

describe('idle wander around the solid huts', () => {
  it('knows the spots inside a hut wall, a body width out, and nothing else', () => {
    for (const hut of MUDFIN_HUTS) {
      const clear = MUDFIN_HUT_MODELS[hut.model].radius + PLAYER_BODY_RADIUS;
      expect(insideMudfinHutWall(hut.x, hut.z, PLAYER_BODY_RADIUS)).toBe(true);
      for (const a of [0, 1.3, 2.9, 4.4]) {
        const [dx, dz] = [Math.sin(a), Math.cos(a)];
        const at = (d: number) => insideMudfinHutWall(hut.x + dx * d, hut.z + dz * d, 0.5);
        expect(at(clear - 0.01)).toBe(true);
        expect(at(clear + 0.01)).toBe(false);
      }
    }
    // the clearance is the caller's: with none, only the wall itself counts
    const [hut] = MUDFIN_HUTS;
    const wall = MUDFIN_HUT_MODELS[hut.model].radius;
    expect(insideMudfinHutWall(hut.x + wall + 0.2, hut.z, 0)).toBe(false);
    expect(insideMudfinHutWall(hut.x + wall + 0.2, hut.z, PLAYER_BODY_RADIUS)).toBe(true);
    // the Eastbrook and Palm Reach mushroom huts keep their old stem, no wander keep-out
    for (const [x, z] of [...ZONE1_PROPS.mudHuts, ...PALMREACH_PROPS.mudHuts]) {
      expect(insideMudfinHutWall(x, z, PLAYER_BODY_RADIUS)).toBe(false);
    }
  });

  it('never sends an idle mob to a spot inside a hut wall, where it would stand at the wall until the 30 s wander timeout', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
    const lastPick = new Map<number, Vec3>();
    let campPicks = 0;
    for (let tick = 0; tick < 20 * 90; tick++) {
      sim.tick();
      for (const mob of sim.entities.values()) {
        const pick = mob.kind === 'mob' ? mob.wanderTarget : null;
        if (!pick || lastPick.get(mob.id) === pick) continue;
        lastPick.set(mob.id, pick);
        for (const hut of MUDFIN_HUTS) {
          const clear = MUDFIN_HUT_MODELS[hut.model].radius + PLAYER_BODY_RADIUS;
          const d = Math.hypot(pick.x - hut.x, pick.z - hut.z);
          if (d < clear + 9) campPicks++;
          expect(d, `${mob.templateId} #${mob.id} at tick ${tick}`).toBeGreaterThanOrEqual(clear);
        }
      }
    }
    // the camp murlocs really wandered round the huts in this run
    expect(campPicks).toBeGreaterThan(20);
  }, 120_000);
});
