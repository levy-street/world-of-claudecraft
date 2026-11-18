// The Gyre's back foot and its wind pads (src/sim/quartered_gyre_pads.ts, content/graveyards.ts):
// Gyrefoot Rest, the graveyard on the flat west shore below the storm peak where a fall on the
// mountain rises; the pad beside it that throws a body, or a released spirit, up to the crown; and
// the pad on the crown that throws one back down to the foot by the town, unhurt.

import { describe, expect, it } from 'vitest';
import { handleDeath } from '../src/sim/combat/damage';
import {
  GYREFOOT_GRAVEYARD_ID,
  GYREFOOT_SPIRIT_HEALER_ENTITY_ID,
  RESERVED_SPIRIT_HEALER_ENTITY_IDS,
} from '../src/sim/content/graveyards';
import {
  COUNCIL_PLAZA,
  COUNCIL_SEAT_GATE,
  COUNCIL_SEAT_KIT,
  gyreFootPadDecor,
} from '../src/sim/content/quartered_council_seat';
import { QUARTERED_ISLE_DECOR, QUARTERED_ISLE_PROPS } from '../src/sim/content/quartered_isle';
import { OVERWORLD_GRAVEYARDS, zoneAt } from '../src/sim/data';
import {
  GYRE_CROWN_PAD,
  GYRE_FOOT_PAD,
  GYRE_WIND_PADS,
  GYREFOOT_REST,
  type GyreWindPad,
  gyreWindPadAt,
} from '../src/sim/quartered_gyre_pads';
import {
  GALE_LAUNCH_COOLDOWN,
  GALE_LAUNCH_COOLDOWN_ID,
  GYRE_CROWN_LANE_LANDING,
  GYRE_CROWN_NORTH_LANDING,
} from '../src/sim/quartered_gyre_wind';
import { updateGyreWind } from '../src/sim/quartered_gyre_wind_step';
import { GYRE_PEAK, gyrePathPoint } from '../src/sim/quartered_landmarks';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { DT, type Entity } from '../src/sim/types';
import { groundHeight, waterLevelAt } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const ground = (x: number, z: number): number => groundHeight(x, z, WORLD_SEED);

/** The lowest and highest ground within `rad` yards of (x, z). */
function relief(x: number, z: number, rad: number): number {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let dx = -rad; dx <= rad; dx += 0.5) {
    for (let dz = -rad; dz <= rad; dz += 0.5) {
      if (dx * dx + dz * dz > rad * rad) continue;
      const h = ground(x + dx, z + dz);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  return hi - lo;
}

/** The gate's footprint on the crown, as an axis-aligned box (it faces east, so its width runs
 *  along z and its depth along x). */
const GATE = {
  x0: COUNCIL_SEAT_GATE.x - COUNCIL_SEAT_KIT.councilSeatGate.d / 2,
  x1: COUNCIL_SEAT_GATE.x + COUNCIL_SEAT_KIT.councilSeatGate.d / 2,
  z0: COUNCIL_SEAT_GATE.z - COUNCIL_SEAT_KIT.councilSeatGate.w / 2,
  z1: COUNCIL_SEAT_GATE.z + COUNCIL_SEAT_KIT.councilSeatGate.w / 2,
};
const gateGap = (x: number, z: number): number =>
  Math.hypot(Math.max(GATE.x0 - x, 0, x - GATE.x1), Math.max(GATE.z0 - z, 0, z - GATE.z1));

/** A pad's flight: the same arc the scripted flight flies (combat/heroic_leap.ts pointOnFlight),
 *  from the pad's ground to its touchdown on the real ground. */
function arc(pad: GyreWindPad) {
  const from = { x: pad.x, y: ground(pad.x, pad.z), z: pad.z };
  const to = {
    x: pad.landing.x,
    y: pad.landing.y ?? ground(pad.landing.x, pad.landing.z),
    z: pad.landing.z,
  };
  return (s: number) => ({
    x: from.x + (to.x - from.x) * s,
    y: from.y + (to.y - from.y) * s + pad.apex * 4 * s * (1 - s),
    z: from.z + (to.z - from.z) * s,
  });
}

// ---- Gyrefoot Rest ---------------------------------------------------------------------------------

describe('Gyrefoot Rest', () => {
  it('is an overworld graveyard, appended last, with its own reserved Pale Keeper', () => {
    const yard = OVERWORLD_GRAVEYARDS[OVERWORLD_GRAVEYARDS.length - 1];
    expect(yard).toEqual({
      id: GYREFOOT_GRAVEYARD_ID,
      name: 'Gyrefoot Rest',
      x: GYREFOOT_REST.x,
      z: GYREFOOT_REST.z,
    });
    expect(RESERVED_SPIRIT_HEALER_ENTITY_IDS[GYREFOOT_GRAVEYARD_ID]).toBe(
      GYREFOOT_SPIRIT_HEALER_ENTITY_ID,
    );
    // no other reserved keeper shares its id
    const ids = Object.values(RESERVED_SPIRIT_HEALER_ENTITY_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    // and its headstones stand at the same corner
    expect(QUARTERED_ISLE_PROPS.graveyards).toContainEqual({
      x: GYREFOOT_REST.x,
      z: GYREFOOT_REST.z,
    });
  });

  it('stands on the isle behind the storm peak from the town, on dry, near-level ground', () => {
    expect(zoneAt(GYREFOOT_REST.x, GYREFOOT_REST.z).id).toBe('quartered_isle');
    const rivalmoot = zoneAt(GYREFOOT_REST.x, GYREFOOT_REST.z).hub;
    // the far side of the mountain from Rivalmoot: farther from the town than the peak is
    expect(
      Math.hypot(GYREFOOT_REST.x - rivalmoot.x, GYREFOOT_REST.z - rivalmoot.z),
    ).toBeGreaterThan(Math.hypot(GYRE_PEAK.x - rivalmoot.x, GYRE_PEAK.z - rivalmoot.z));
    // off the mountain's foot, which ends where the path's widest turn does
    expect(
      Math.hypot(GYREFOOT_REST.x - GYRE_PEAK.x, GYREFOOT_REST.z - GYRE_PEAK.z),
    ).toBeGreaterThan(GYRE_PEAK.startR + GYRE_PEAK.pathW);
    // the six headstones (render/props.ts lays them 2.2 yd apart in x, 2.6 in z) on dry, level ground
    for (const [dx, dz] of [
      [0, 0],
      [4.4, 0],
      [0, 2.6],
      [4.4, 2.6],
    ]) {
      const x = GYREFOOT_REST.x + dx;
      const z = GYREFOOT_REST.z + dz;
      const water = waterLevelAt(x, z, WORLD_SEED);
      expect(!Number.isFinite(water) || ground(x, z) > water + 0.5, `${x},${z}`).toBe(true);
    }
    expect(relief(GYREFOOT_REST.x + 2.2, GYREFOOT_REST.z + 1.3, 3)).toBeLessThan(2.5);
  });
});

// ---- the pads ------------------------------------------------------------------------------------

describe('the wind pads', () => {
  it('set the foot pad apart from the Rest, so a spirit rising there is not thrown at once', () => {
    expect(
      Math.hypot(GYRE_FOOT_PAD.x - GYREFOOT_REST.x, GYRE_FOOT_PAD.z - GYREFOOT_REST.z),
    ).toBeGreaterThan(6 + GYRE_FOOT_PAD.radius);
    // clear of the headstones' block too
    expect(GYRE_FOOT_PAD.z - GYRE_FOOT_PAD.radius).toBeGreaterThan(GYREFOOT_REST.z + 2.6 + 1);
    // on dry, level ground
    expect(relief(GYRE_FOOT_PAD.x, GYRE_FOOT_PAD.z, GYRE_FOOT_PAD.radius + 0.5)).toBeLessThan(1);
    const water = waterLevelAt(GYRE_FOOT_PAD.x, GYRE_FOOT_PAD.z, WORLD_SEED);
    expect(!Number.isFinite(water) || ground(GYRE_FOOT_PAD.x, GYRE_FOOT_PAD.z) > water + 0.5).toBe(
      true,
    );
  });

  it("set the crown pad on the crown's level top, clear of the gate, the touchdowns and the path's arrival", () => {
    const c = GYRE_CROWN_PAD;
    expect(Math.hypot(c.x - COUNCIL_PLAZA.x, c.z - COUNCIL_PLAZA.z) + c.radius).toBeLessThanOrEqual(
      COUNCIL_PLAZA.radius + 0.5,
    );
    expect(Math.abs(ground(c.x, c.z) - (GYRE_PEAK.baseY + GYRE_PEAK.rise))).toBeLessThan(0.5);
    expect(gateGap(c.x, c.z)).toBeGreaterThan(c.radius + 1);
    for (const land of [GYRE_CROWN_NORTH_LANDING, GYRE_CROWN_LANE_LANDING, GYRE_FOOT_PAD.landing]) {
      expect(Math.hypot(c.x - land.x, c.z - land.z), `${land.x},${land.z}`).toBeGreaterThan(
        c.radius + 2.5,
      );
    }
    const arrival = gyrePathPoint(1);
    expect(Math.hypot(c.x - arrival.x, c.z - arrival.z)).toBeGreaterThan(c.radius + 4);
  });

  it("lays the foot pad its floor: the crown's paved disc drawn small, walk-through, on the pad", () => {
    const floor = gyreFootPadDecor();
    expect(QUARTERED_ISLE_DECOR).toContainEqual(floor);
    expect(floor.key).toBe('councilPlaza');
    expect([floor.x, floor.z]).toEqual([GYRE_FOOT_PAD.x, GYRE_FOOT_PAD.z]);
    // no collider and no terrain calm: a body walks onto it and is thrown
    expect(floor.terrainCalm).toBe(false);
    expect(floor.r).toBeUndefined();
    expect(floor.hw).toBeUndefined();
    expect(floor.hd).toBeUndefined();
    // a little wider than the pad it marks
    const radius = ((floor.scale ?? 1) * COUNCIL_SEAT_KIT.councilPlaza.w) / 2;
    expect(radius).toBeGreaterThan(GYRE_FOOT_PAD.radius);
    expect(radius).toBeLessThan(GYRE_FOOT_PAD.radius + 0.6);
  });

  it('are found within their radius and nowhere else', () => {
    for (const pad of GYRE_WIND_PADS) {
      expect(gyreWindPadAt(pad.x, pad.z)).toBe(pad);
      expect(gyreWindPadAt(pad.x + pad.radius - 0.05, pad.z)).toBe(pad);
      expect(gyreWindPadAt(pad.x + pad.radius + 0.05, pad.z)).toBeNull();
      expect(gyreWindPadAt(pad.x, pad.z - pad.radius - 0.05)).toBeNull();
    }
    expect(gyreWindPadAt(GYREFOOT_REST.x, GYREFOOT_REST.z)).toBeNull();
    expect(gyreWindPadAt(GYRE_PEAK.x, GYRE_PEAK.z)).toBeNull();
  });

  it.each(GYRE_WIND_PADS.map((pad) => [pad.id, pad] as const))(
    'fly the %s pad arc clear of the mountain, every solid on the isle and the gate',
    (_id, pad) => {
      const at = arc(pad);
      const solids = QUARTERED_ISLE_DECOR.filter((d) => (d.r ?? 0) > 0 || (d.hw ?? 0) > 0).map(
        (d) => ({
          key: d.key,
          x: d.x,
          z: d.z,
          // the circumscribed circle of its collider, and its top
          reach: Math.max(d.r ?? 0, Math.hypot(d.hw ?? 0, d.hd ?? 0)) + 0.6,
          top: ground(d.x, d.z) + (d.h ?? 0),
        }),
      );
      for (let i = 0; i <= 400; i++) {
        const s = i / 400;
        const p = at(s);
        // clear of the ground all the way, but for its own take-off and touchdown
        if (s > 0.06 && s < 0.92) {
          expect(p.y - ground(p.x, p.z), `ground at ${s}`).toBeGreaterThan(1.5);
        }
        for (const d of solids) {
          if (Math.hypot(p.x - d.x, p.z - d.z) > d.reach) continue;
          expect(p.y - d.top, `${d.key} at ${d.x},${d.z}, s ${s}`).toBeGreaterThan(1);
        }
        // never through the sealed gate: beside it, or over its top
        if (gateGap(p.x, p.z) < 0.75) {
          expect(p.y, `gate at ${s}`).toBeGreaterThan(
            GYRE_PEAK.baseY + GYRE_PEAK.rise + COUNCIL_SEAT_KIT.councilSeatGate.h,
          );
        }
      }
    },
  );
});

// ---- the throw, per player -------------------------------------------------------------------------

/** A host the step can read keys, modes and the ground from (the stub's id, 7). */
function host() {
  return {
    cancelCast: () => {},
    standUp: () => {},
    players: new Map([[7, { moveInput: {} }]]),
    groundPos: (x: number, z: number) => ({ x, y: ground(x, z), z }),
  } as unknown as Parameters<typeof updateGyreWind>[1];
}

function stub(pad: GyreWindPad, extra: Partial<Entity> = {}): Entity {
  return {
    id: 7,
    dead: false,
    ghost: false,
    mountKey: '',
    onGround: true,
    vx: 0,
    vy: 0,
    vz: 0,
    facing: 0,
    pos: { x: pad.x, y: ground(pad.x, pad.z), z: pad.z },
    auras: [],
    cooldowns: new Map<string, number>(),
    leap: null,
    climb: null,
    valkyrsCalling: null,
    chargeTargetId: null,
    followTargetId: null,
    chargePath: [],
    castingAbility: null,
    ...extra,
  } as unknown as Entity;
}

describe('the throw', () => {
  it('sets a body on a pad on the scripted flight to its touchdown, under the gale cooldown', () => {
    const p = stub(GYRE_FOOT_PAD);
    updateGyreWind(p, host());
    const flight = p.leap;
    if (!flight) throw new Error('not thrown');
    expect(flight.to).toEqual({ ...GYRE_CROWN_NORTH_LANDING });
    expect(flight.duration).toBe(GYRE_FOOT_PAD.duration);
    expect(flight.apex).toBe(GYRE_FOOT_PAD.apex);
    expect(flight.landingAoe.radius).toBe(0);
    expect(flight.spiritFlight).toBeUndefined();
    expect(p.cooldowns.get(GALE_LAUNCH_COOLDOWN_ID)).toBe(GALE_LAUNCH_COOLDOWN);
    // the crown pad's touchdown is read off the ground there
    const down = stub(GYRE_CROWN_PAD);
    updateGyreWind(down, host());
    expect(down.leap?.to).toEqual({
      x: GYRE_CROWN_PAD.landing.x,
      y: ground(GYRE_CROWN_PAD.landing.x, GYRE_CROWN_PAD.landing.z),
      z: GYRE_CROWN_PAD.landing.z,
    });
  });

  it('throws a released spirit too, on a flight marked for it, and a mounted rider', () => {
    const ghost = stub(GYRE_FOOT_PAD, { dead: true, ghost: true });
    updateGyreWind(ghost, host());
    expect(ghost.leap?.spiritFlight).toBe(true);
    const rider = stub(GYRE_CROWN_PAD, {
      mountKey: 'valorsteed',
      ridingTier: 1,
    } as Partial<Entity>);
    updateGyreWind(rider, host());
    expect(rider.leap).not.toBeNull();
    expect(rider.leap?.spiritFlight).toBeUndefined();
  });

  it('throws nobody who is a corpse, held, airborne, on another flight or inside the cooldown', () => {
    const stun = {
      id: 'test_stun',
      name: 'Stun',
      kind: 'stun',
      remaining: 5,
      duration: 5,
      value: 0,
      sourceId: 1,
      school: 'physical',
    } as unknown as Entity['auras'][number];
    for (const extra of [
      { dead: true },
      { auras: [stun] },
      { onGround: false },
      { leap: {} },
      { cooldowns: new Map([[GALE_LAUNCH_COOLDOWN_ID, 1]]) },
    ] as unknown as Partial<Entity>[]) {
      const p = stub(GYRE_FOOT_PAD, extra);
      const before = p.leap;
      updateGyreWind(p, host());
      expect(p.leap, JSON.stringify(Object.keys(extra))).toBe(before);
    }
  });

  it('throws nobody off the crown with no ground to read the touchdown from', () => {
    const p = stub(GYRE_CROWN_PAD);
    updateGyreWind(p);
    expect(p.leap).toBeNull();
    // the foot pad's touchdown is the crown's own level, so it needs none
    const q = stub(GYRE_FOOT_PAD);
    updateGyreWind(q);
    expect(q.leap).not.toBeNull();
  });
});

// ---- the live Sim -------------------------------------------------------------------------------------

function liveAt(x: number, z: number) {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  const ctx = (sim as unknown as { ctx: SimContext }).ctx;
  const p = sim.player;
  standOn(ctx, p, x, z);
  return { sim, ctx, p };
}

function standOn(ctx: SimContext, p: Entity, x: number, z: number): void {
  const g = ctx.groundPos(x, z);
  p.pos = { x, y: g.y, z };
  p.prevPos = { ...p.pos };
  p.fallStartY = g.y;
  p.onGround = true;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
}

/** Tick until the body has been thrown and has landed again; the ticks it spent in the air. */
function fly(sim: Sim, p: Entity, maxSeconds = 6): number {
  let air = 0;
  let thrown = false;
  for (let i = 0; i < maxSeconds / DT; i++) {
    sim.tick();
    if (p.leap) thrown = true;
    if (!p.onGround) air++;
    if (thrown && p.leap == null) break;
  }
  expect(thrown, 'thrown').toBe(true);
  expect(p.leap, 'landed').toBeNull();
  return air;
}

describe('the pads on the live Sim', () => {
  it('throw a body from the foot to the crown, and from the crown back down to the foot, unhurt', () => {
    const { sim, ctx, p } = liveAt(GYRE_FOOT_PAD.x, GYRE_FOOT_PAD.z);
    const hp0 = p.hp;
    const up = fly(sim, p);
    expect(up * DT).toBeGreaterThan(GYRE_FOOT_PAD.duration * 0.8);
    expect(
      Math.hypot(p.pos.x - GYRE_CROWN_NORTH_LANDING.x, p.pos.z - GYRE_CROWN_NORTH_LANDING.z),
    ).toBeLessThan(0.1);
    expect(p.pos.y).toBeCloseTo(GYRE_CROWN_NORTH_LANDING.y, 1);
    expect(p.onGround).toBe(true);
    expect(p.hp).toBe(hp0);
    // a step across the crown onto the down pad, once the cooldown has run out
    for (let i = 0; i < 0.5 / DT; i++) sim.tick();
    standOn(ctx, p, GYRE_CROWN_PAD.x, GYRE_CROWN_PAD.z);
    fly(sim, p);
    const foot = GYRE_CROWN_PAD.landing;
    expect(Math.hypot(p.pos.x - foot.x, p.pos.z - foot.z)).toBeLessThan(0.1);
    expect(p.pos.y).toBeCloseTo(ctx.groundPos(foot.x, foot.z).y, 1);
    expect(p.onGround).toBe(true);
    // a thirty-five yard drop, and not a point of fall damage
    expect(p.hp).toBe(hp0);
    expect(p.dead).toBe(false);
  }, 60_000);

  it('rises a fall on the crown at Gyrefoot Rest, beside its Keeper, and throws the spirit back up', () => {
    const { sim, ctx, p } = liveAt(GYRE_CROWN_LANE_LANDING.x, GYRE_CROWN_LANE_LANDING.z);
    handleDeath(ctx, p, null);
    sim.releaseSpirit(p.id);
    expect(p.ghost).toBe(true);
    expect(Math.hypot(p.pos.x - GYREFOOT_REST.x, p.pos.z - GYREFOOT_REST.z)).toBeLessThan(1.5);
    const keeper = ctx.entities.get(GYREFOOT_SPIRIT_HEALER_ENTITY_ID);
    expect(keeper).toBeDefined();
    expect(
      Math.hypot((keeper?.pos.x ?? 0) - GYREFOOT_REST.x, (keeper?.pos.z ?? 0) - GYREFOOT_REST.z),
    ).toBeLessThan(0.5);
    // the spirit is not thrown where it rises: it walks to the pad
    sim.tick();
    expect(p.leap ?? null).toBeNull();
    standOn(ctx, p, GYRE_FOOT_PAD.x, GYRE_FOOT_PAD.z);
    fly(sim, p);
    expect(p.ghost).toBe(true);
    expect(
      Math.hypot(p.pos.x - GYRE_CROWN_NORTH_LANDING.x, p.pos.z - GYRE_CROWN_NORTH_LANDING.z),
    ).toBeLessThan(0.1);
  }, 60_000);

  it('lets a spirit reclaim its body in mid-flight: set down on the ground beneath, with no fall taken', () => {
    const { sim, ctx, p } = liveAt(GYRE_CROWN_LANE_LANDING.x, GYRE_CROWN_LANE_LANDING.z);
    handleDeath(ctx, p, null);
    sim.releaseSpirit(p.id);
    standOn(ctx, p, GYRE_FOOT_PAD.x, GYRE_FOOT_PAD.z);
    // up toward the crown until the body on it is within reach of a reclaim
    const corpse = p.corpsePos;
    if (!corpse) throw new Error('no corpse');
    let reached = false;
    for (let i = 0; i < 6 / DT; i++) {
      sim.tick();
      if (p.leap && Math.hypot(p.pos.x - corpse.x, p.pos.z - corpse.z) < 30) {
        reached = true;
        break;
      }
    }
    expect(reached, 'in reach of the body while still flying').toBe(true);
    // a reclaim revives where the spirit is (spirit.ts resurrectAtCorpse): here, in the air
    const above = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
    sim.resurrectAtCorpse(p.id);
    expect(p.dead).toBe(false);
    expect(p.ghost).toBe(false);
    // set on the ground beneath, settled: well under the arc, standing
    expect(p.pos.y).toBeLessThan(above.y - 1);
    expect(p.onGround).toBe(true);
    const hp = p.hp;
    for (let i = 0; i < 20; i++) sim.tick();
    // the flight is dropped, no climb starts, and not a point of the arc's height is taken as a fall
    expect(p.leap ?? null).toBeNull();
    expect(p.climb ?? null).toBeNull();
    // (a fresh body regenerates; it must never lose any)
    expect(p.hp).toBeGreaterThanOrEqual(hp);
    expect(p.dead).toBe(false);
  }, 60_000);

  it('throws a mounted rider, still mounted', () => {
    const { sim, p } = liveAt(GYRE_FOOT_PAD.x, GYRE_FOOT_PAD.z);
    p.mountKey = 'valorsteed';
    p.ridingTier = 1;
    fly(sim, p);
    expect(p.mountKey).toBe('valorsteed');
    expect(
      Math.hypot(p.pos.x - GYRE_CROWN_NORTH_LANDING.x, p.pos.z - GYRE_CROWN_NORTH_LANDING.z),
    ).toBeLessThan(0.1);
  }, 60_000);
});
