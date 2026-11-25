// The Guardian of the Heat's lip wall and the playtest of 2026-11-24 (Jose,
// Heroic with bots): the low wall round the wellspring is solid (nobody walks
// into the stumps or the fire), sight-clear (every cast still reaches the
// guardian), melee strikes the guardian from outside it with room to spare,
// nothing the fight lays on the floor is anchored inside it, the Wellspawn
// still reach their feeding post past it, and a wipe turns the guardian back
// to the facing it had before the pull. Since Jose's playtest of 2026-11-25
// the wall is one smooth circle (a melee player walking sideways along it
// slides, never snags on a segment's corner) and the shore runs all the way
// round it (the altar-stone behind the well is gone).

import { describe, expect, it } from 'vitest';
import { lineOfSightClear, resolvePosition } from '../src/sim/colliders';
import { effectivePlayerAttackRange } from '../src/sim/combat/player_attack_reach';
import {
  HEARTH_LIP_RING,
  HEARTH_WELL,
  SMITH_HEART_FIELD,
} from '../src/sim/content/smith_heart_layout';
import { MOBS } from '../src/sim/data';
import { HEAT_PULL_SPOT } from '../src/sim/dev/smith_heart_dev';
import { fistSpot } from '../src/sim/encounters/smith_heart/heat_fist';
import {
  inHearthFloor,
  outOfLip,
  SHORE_POINTS,
  wellDistance,
} from '../src/sim/encounters/smith_heart/heat_geometry';
import {
  HEAT_BODY_R,
  HEAT_GUARDIAN,
  HEAT_HOME_FACING,
  HEAT_LIP_WALL,
  HEAT_MOBS,
  HEAT_WELL_R,
  HEAT_TUNING as T,
} from '../src/sim/encounters/smith_heart/heat_ids';
import { authoredFieldColliders } from '../src/sim/instances/authored_field/field_colliders';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { DT, MELEE_RANGE, RUN_SPEED } from '../src/sim/types';
import { heatFight } from './helpers/heat_fight';

const ticks = (s: number) => Math.round(s / DT);
const bearings = Array.from({ length: 48 }, (_, i) => (i / 48) * Math.PI * 2);

describe('Guardian of the Heat: the lip wall', () => {
  it('spans the lip out to its outer face as ONE sight-clear circle', () => {
    expect(HEAT_LIP_WALL.inner).toBe(HEAT_WELL_R);
    expect(HEAT_LIP_WALL.outer).toBeGreaterThan(HEAT_LIP_WALL.inner);
    expect(SMITH_HEART_FIELD.ringWalls).toEqual([HEARTH_LIP_RING]);
    expect(HEARTH_LIP_RING).toMatchObject({
      x: HEARTH_WELL.x,
      z: HEARTH_WELL.z,
      inner: HEAT_LIP_WALL.inner,
      outer: HEAT_LIP_WALL.outer,
      sightClear: true,
    });
    const cols = authoredFieldColliders(SMITH_HEART_FIELD, 0);
    const lip = cols.filter(
      (c) =>
        c.type === 'circle' &&
        Math.hypot(c.x - HEARTH_WELL.x, c.z - HEARTH_WELL.z) < 1e-9 &&
        c.r === HEAT_LIP_WALL.outer,
    );
    expect(lip.length).toBe(1);
    expect(lip[0].type === 'circle' && lip[0].sightClear).toBe(true);
    // No box segment of the old ring is left.
    expect(cols.some((c) => c.type === 'obb' && c.sightClear)).toBe(false);
  });

  it('a body walking at the well from any side is held outside the wall', () => {
    const f = heatFight(1);
    const seed = f.sim.ctx.cfg.seed;
    for (const a of bearings) {
      // A step that would put the body's edge into the wall (a walk from the
      // shore never gets deeper in one tick; keepOffLip frees any deeper).
      for (const into of [HEAT_LIP_WALL.outer + 0.2, HEAT_LIP_WALL.outer - 0.2]) {
        const p = f.world(HEARTH_WELL.x + Math.sin(a) * into, HEARTH_WELL.z + Math.cos(a) * into);
        const r = resolvePosition(seed, p.x, p.z, PLAYER_BODY_RADIUS);
        const o = f.world(0, 0);
        expect(wellDistance(r.x - o.x, r.z - o.z)).toBeGreaterThanOrEqual(
          HEAT_LIP_WALL.outer + PLAYER_BODY_RADIUS - 1e-6,
        );
      }
      // A body standing clear of the wall is left where it is.
      const out = HEAT_LIP_WALL.outer + PLAYER_BODY_RADIUS + 0.3;
      const q = f.world(HEARTH_WELL.x + Math.sin(a) * out, HEARTH_WELL.z + Math.cos(a) * out);
      const s = resolvePosition(seed, q.x, q.z, PLAYER_BODY_RADIUS);
      expect(Math.hypot(s.x - q.x, s.z - q.z)).toBeLessThan(1e-6);
    }
  });

  it('a melee player strafing sideways along the wall slides round it, never snagging', () => {
    // Jose's playtest of 2026-11-25: pressed to the wall and walking sideways
    // (the step a tangent, pushed a little into the wall each tick), the body
    // goes the whole way round at an even pace. On the old ring of 32 box
    // segments each corner pushed it back along the wall and it stuck.
    const f = heatFight(1);
    const seed = f.sim.ctx.cfg.seed;
    const o = f.world(0, 0);
    const rest = HEAT_LIP_WALL.outer + PLAYER_BODY_RADIUS;
    const step = RUN_SPEED * DT;
    for (const dir of [1, -1]) {
      let x = o.x + HEARTH_WELL.x + rest;
      let z = o.z + HEARTH_WELL.z;
      let travelled = 0;
      let slowest = Number.POSITIVE_INFINITY;
      for (let i = 0; i < ticks(14); i++) {
        const lx = x - o.x - HEARTH_WELL.x;
        const lz = z - o.z - HEARTH_WELL.z;
        const d = Math.hypot(lx, lz);
        // Sideways (the tangent) and a hand into the wall (pressing on it).
        const tx = (dir * lz) / d;
        const tz = (-dir * lx) / d;
        const wx = x + tx * step - (lx / d) * 0.05;
        const wz = z + tz * step - (lz / d) * 0.05;
        const r = resolvePosition(seed, wx, wz, PLAYER_BODY_RADIUS);
        const moved = Math.hypot(r.x - x, r.z - z);
        slowest = Math.min(slowest, moved);
        travelled += moved;
        x = r.x;
        z = r.z;
        expect(wellDistance(x - o.x, z - o.z)).toBeGreaterThanOrEqual(rest - 1e-6);
        expect(wellDistance(x - o.x, z - o.z)).toBeLessThan(rest + 0.2);
      }
      // Every tick keeps nearly all its stride (a snag would stall it), and
      // the walk carries it most of the way round.
      expect(slowest).toBeGreaterThan(step * 0.9);
      expect(travelled).toBeGreaterThan(2 * Math.PI * rest * 0.9);
    }
  });

  it('sets a player found inside it (a leap onto the well) down on the shore past it', () => {
    expect(outOfLip(HEARTH_WELL.x + HEAT_LIP_WALL.outer + 0.1, 0, 0.5)).toBeNull();
    const mid = outOfLip(HEARTH_WELL.x, HEARTH_WELL.z, 0.5);
    expect(mid && wellDistance(mid.x, mid.z)).toBeCloseTo(HEAT_LIP_WALL.outer + 0.55, 6);
    const f = heatFight(2);
    const p = f.players[1];
    for (const d of [0, 3, HEAT_WELL_R - 1, HEAT_LIP_WALL.outer - 0.6]) {
      f.put(p, HEARTH_WELL.x - 0.7 * d, HEARTH_WELL.z + 0.7 * d);
      f.tick(1);
      const l = f.local(p);
      expect(wellDistance(l.x, l.z)).toBeGreaterThan(HEAT_LIP_WALL.outer + PLAYER_BODY_RADIUS);
    }
  });

  it('never blocks a sight line to the guardian, from the wall or across the hall, from any side', () => {
    const f = heatFight(1);
    const seed = f.sim.ctx.cfg.seed;
    const mid = f.world(HEARTH_WELL.x, HEARTH_WELL.z);
    for (const a of bearings) {
      for (const d of [HEAT_LIP_WALL.outer + 0.6, 20, 30]) {
        const lx = HEARTH_WELL.x + Math.sin(a) * d;
        const lz = HEARTH_WELL.z + Math.cos(a) * d;
        if (!inHearthFloor(lx, lz)) continue;
        const from = f.world(lx, lz);
        expect(lineOfSightClear(seed, from, mid)).toBe(true);
      }
    }
  });

  it('the shore runs all the way round: no altar-stone behind the well', () => {
    expect(SMITH_HEART_FIELD.props.some((p) => p.kind === 'sh_giant_anvil')).toBe(false);
    // A body stands behind the guardian, clear of every collider.
    const f = heatFight(1);
    const seed = f.sim.ctx.cfg.seed;
    for (const d of [HEAT_LIP_WALL.outer + 1, 16, 22]) {
      const q = f.world(HEARTH_WELL.x - d, HEARTH_WELL.z);
      expect(inHearthFloor(HEARTH_WELL.x - d, HEARTH_WELL.z)).toBe(true);
      const s = resolvePosition(seed, q.x, q.z, PLAYER_BODY_RADIUS);
      expect(Math.hypot(s.x - q.x, s.z - q.z)).toBeLessThan(1e-6);
    }
  });
});

describe('Guardian of the Heat: melee from outside the wall', () => {
  it('its body reaches a yard past the wall; a melee swing lands from the wall out to four yards', () => {
    expect(MOBS[HEAT_GUARDIAN]?.bodyRadius).toBe(HEAT_BODY_R);
    const reach = effectivePlayerAttackRange(
      { kind: 'mob', templateId: HEAT_GUARDIAN },
      MELEE_RANGE,
    );
    expect(reach).toBe(HEAT_BODY_R + 3);
    // Where a player stands pressed to the wall, and how far back it may go.
    const atWall = HEAT_LIP_WALL.outer + PLAYER_BODY_RADIUS;
    expect(reach - atWall).toBeGreaterThanOrEqual(3);
    // Still out of Hearth Flare's reach: melee is never struck for standing in it.
    expect(reach).toBeLessThan(T.flareReach);
    // A short ability (Goad, 10 yd) reaches past the body too.
    expect(
      effectivePlayerAttackRange({ kind: 'mob', templateId: HEAT_GUARDIAN }, 10),
    ).toBeGreaterThan(reach);
  });

  it('the dev pull spot stands outside the wall and inside the reach', () => {
    const d = wellDistance(HEAT_PULL_SPOT.x, HEAT_PULL_SPOT.z);
    expect(d).toBeGreaterThan(HEAT_LIP_WALL.outer + PLAYER_BODY_RADIUS);
    expect(d).toBeLessThan(HEAT_BODY_R + 3);
  });

  it('a warrior standing at the wall lands its swings on the guardian', () => {
    const f = heatFight(1);
    expect(f.dev('/dev heart heat pull')).toBe(true);
    const p = f.players[0];
    f.put(p, HEARTH_WELL.x + HEAT_LIP_WALL.outer + 2.5, 0);
    const b = f.boss();
    p.targetId = b.id;
    p.autoAttack = true;
    p.facing = -Math.PI / 2;
    const hp0 = b.hp;
    f.tick(ticks(6));
    expect(b.hp).toBeLessThan(hp0);
  });
});

describe('Guardian of the Heat: nothing laid inside the wall', () => {
  it("every Rolling Cinder landing's circle stays off the wall and the hall's props", () => {
    expect(SHORE_POINTS.length).toBeGreaterThan(20);
    for (const p of SHORE_POINTS)
      expect(wellDistance(p.x, p.z) - T.cinderLandR).toBeGreaterThanOrEqual(HEAT_LIP_WALL.outer);
    for (const p of SHORE_POINTS)
      for (const prop of SMITH_HEART_FIELD.props) {
        if (!inHearthFloor(prop.x, prop.z)) continue;
        const r = prop.r ?? Math.hypot(prop.hw ?? 0, prop.hd ?? 0);
        if (r <= 0) continue;
        expect(Math.hypot(p.x - prop.x, p.z - prop.z)).toBeGreaterThan(r + T.cinderLandR);
      }
  });

  it('Rolling Cinders land all the way round the well, behind the guardian too', () => {
    const behind = SHORE_POINTS.filter((p) => p.x < HEARTH_WELL.x - HEAT_LIP_WALL.outer);
    const front = SHORE_POINTS.filter((p) => p.x > HEARTH_WELL.x + HEAT_LIP_WALL.outer);
    expect(behind.length).toBeGreaterThan(4);
    expect(front.length).toBeGreaterThan(4);
  });

  it("Basalt Fist's spot is pushed out past the wall", () => {
    for (const d of [0, 4, HEAT_WELL_R, HEAT_LIP_WALL.outer - 0.1]) {
      const s = fistSpot({ x: HEARTH_WELL.x + d, z: HEARTH_WELL.z });
      expect(wellDistance(s.x, s.z)).toBeCloseTo(HEAT_LIP_WALL.outer, 6);
    }
    const far = fistSpot({ x: HEARTH_WELL.x + 20, z: 3 });
    expect(far).toEqual({ x: HEARTH_WELL.x + 20, z: 3 });
  });

  it('heroic: a Wellspawn walking in from its post still reaches its feeding reach past the wall', () => {
    expect(T.spawnReach).toBeGreaterThan(HEAT_LIP_WALL.outer + 0.8);
    const f = heatFight(2);
    f.dev('/dev heart heat heroic');
    expect(f.dev('/dev heart heat pull')).toBe(true);
    f.boss().hp = Math.floor(f.boss().maxHp * 0.69);
    f.tick(ticks(T.sinkSeconds + 0.2));
    const kids = f.inst.mobIds
      .map((id) => f.sim.ctx.entities.get(id))
      .filter((e) => e && e.templateId === HEAT_MOBS.spawn && !e.dead);
    expect(kids.length).toBeGreaterThan(0);
    const [kid] = kids;
    if (!kid) throw new Error('no wellspawn');
    // Nearly there: a few strides from its reach, walking straight in.
    const at = f.world(HEARTH_WELL.x + T.spawnReach + 3, 0.5);
    kid.pos.x = at.x;
    kid.pos.z = at.z;
    for (let i = 0; i < ticks(8) && (f.state()?.feeds ?? 0) === 0; i++) f.tick(1);
    expect(f.state()?.feeds).toBe(1);
  });
});

describe('Guardian of the Heat: the wipe', () => {
  it('turns it back to the facing it had before the pull', () => {
    const f = heatFight(2);
    expect(f.boss().facing).toBeCloseTo(HEAT_HOME_FACING, 9);
    expect(f.dev('/dev heart heat pull')).toBe(true);
    // The tank drags it round to the north side.
    f.put(f.players[0], HEARTH_WELL.x, HEARTH_WELL.z + HEAT_LIP_WALL.outer + 2);
    f.boss().threat.set(f.players[0].id, 1e6);
    f.tick(ticks(3));
    expect(Math.abs(f.boss().facing - HEAT_HOME_FACING)).toBeGreaterThan(0.5);
    for (const p of f.players) f.sim.ctx.handleDeath(p, f.boss());
    for (let i = 0; i < ticks(30) && f.state() !== null; i++) f.tick(1, false);
    expect(f.state()).toBeNull();
    f.tick(ticks(2), false);
    expect(f.boss().facing).toBeCloseTo(HEAT_HOME_FACING, 9);
    expect(f.boss().prevFacing).toBeCloseTo(HEAT_HOME_FACING, 9);
  });
});
