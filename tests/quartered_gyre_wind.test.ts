// The Gyre's wind (src/sim/quartered_gyre_wind.ts): gale lanes along the climb that carry a body up the
// track (a push with momentum, no key needed, three times the run at its fastest, following every
// bend, the strafe keys still steering across the road), and four openings in the railing that lift a
// grounded body over the face onto the next turn of the road, or onto the crown above the last.

import { describe, expect, it, vi } from 'vitest';
import {
  computeOverrideSignature,
  createMovementOverrideSessionState,
  type MovementOverrideSessionState,
  overrideActive,
  updateMovementOverrideEpochs,
} from '../server/movement_override_epoch';
import { resolvePosition } from '../src/sim/colliders';
import { COUNCIL_BEACON_STOPS } from '../src/sim/content/quartered_council_seat';
import { GYRE_STONE_STOPS } from '../src/sim/content/quartered_gyre_crags';
import { GYRE_RAIL_GAP_HALF } from '../src/sim/content/quartered_gyre_rails';
import { TRINKET_AURA } from '../src/sim/content/trinkets';
import { getActiveWorldContent, setActiveWorldContent } from '../src/sim/data';
import { moveSpeedMult } from '../src/sim/player_motion';
import {
  type GaleFrame,
  type GaleWish,
  galeCoastClamp,
  galeCoastLimit,
  galeCurrentStep,
} from '../src/sim/quartered_gyre_current';
import {
  GALE_LANE_AURA_ID,
  GALE_LANE_AURA_NAME,
  GALE_LANE_GRIP,
  GALE_LANE_LINGER,
  GALE_LANE_SPEED,
  GALE_LAUNCH_COOLDOWN,
  GALE_LAUNCH_COOLDOWN_ID,
  GALE_LIFT_MAX_SECONDS,
  GALE_LIFT_MIN_SECONDS,
  GALE_LIFT_NAME,
  GALE_TAPER_END,
  GALE_TAPER_YD,
  GALE_WIND_ACCEL,
  GALE_WIND_BRAKE,
  GALE_WIND_CENTERING,
  GALE_WIND_OPPOSED_SHARE,
  GYRE_LANE_CROWN_CLEAR_YD,
  GYRE_LANE_FIRST_YD,
  GYRE_LANE_GAP_YD,
  GYRE_LANE_LEN_YD,
  GYRE_LAUNCH_HALF_YD,
  GYRE_LAUNCH_MIN_OFF,
  GYRE_LAUNCH_OFFSET,
  GYRE_LAUNCH_POCKETS,
  GYRE_PATH_YARDS,
  GYRE_WIND_LANES,
  type GyreTrackFrame,
  galeStrengthAtYards,
  gyreLaneAt,
  gyreLaunchPocketAt,
  gyreTAtYards,
  gyreTrackFrameAt,
  gyreYardsAtT,
} from '../src/sim/quartered_gyre_wind';
import { updateGyreWind } from '../src/sim/quartered_gyre_wind_step';
import { GYRE_PEAK, gyrePathAt, gyrePathPoint } from '../src/sim/quartered_landmarks';
import { Sim } from '../src/sim/sim';
import { SLIPPERY_GROUND_AURA, slipperyGrip } from '../src/sim/slippery_ground';
import type { Entity, MoveInput } from '../src/sim/types';
import { DT, RUN_SPEED } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';

const SEED = 1;
const ground = (x: number, z: number) => terrainHeight(x, z, SEED);
/** The path parameter one full turn on: the next turn up, at the same bearing. */
const TURN_T = GYRE_PEAK.turnStep / (GYRE_PEAK.startR - GYRE_PEAK.endR);
const CROWN_TOP = GYRE_PEAK.baseY + GYRE_PEAK.rise;
/** The ceiling of the ride: three times the run. */
const CEILING = GALE_LANE_SPEED * RUN_SPEED;

function stub(x: number, y: number, z: number, extra: Partial<Entity> = {}): Entity {
  return {
    id: 7,
    dead: false,
    ghost: false,
    mountKey: '',
    onGround: true,
    jumping: false,
    vx: 0,
    vy: 0,
    vz: 0,
    facing: 0,
    fallStartY: y,
    pos: { x, y, z },
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

const NO_KEYS: MoveInput = {
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  dive: false,
  surface: false,
};

/** A host the step can read keys and modes from (the stub's id, 7), with spies for the cancelled
 *  cast and the sitter stood up. `modes` adds fields to the player's meta (a vehicle, a mount race). */
function host(keys: Partial<MoveInput> = {}, modes: Record<string, unknown> = {}) {
  // as the real ones leave a body: no cast in progress, on its feet
  const cancelCast = vi.fn((e: Entity) => {
    e.castingAbility = null;
  });
  const standUp = vi.fn((e: Entity) => {
    e.sitting = false;
  });
  const meta = { moveInput: { ...NO_KEYS, ...keys }, ...modes };
  return {
    cancelCast,
    standUp,
    players: new Map([[7, meta]]),
  } as unknown as Parameters<typeof updateGyreWind>[1] & {
    cancelCast: typeof cancelCast;
    standUp: typeof standUp;
  };
}

/** The Gale Lane as the step puts it on a body in a lane. */
function laneAuraOf(remaining = 1) {
  return {
    id: GALE_LANE_AURA_ID,
    name: GALE_LANE_AURA_NAME,
    kind: 'buff_speed',
    remaining,
    duration: GALE_LANE_LINGER,
    value: GALE_LANE_SPEED,
    value2: GALE_LANE_GRIP,
    sourceId: 7,
    school: 'nature',
  } as Entity['auras'][number];
}

/** An aura of the given kind on a stub, as a stun, a root or a feigned death would wear. */
function auraOf(kind: string, id = `test_${kind}`) {
  return {
    id,
    name: id,
    kind,
    remaining: 5,
    duration: 5,
    value: 0,
    sourceId: 1,
    school: 'physical',
  } as unknown as Entity['auras'][number];
}

/** The point `yd` yards up the path's centre line, with the road's frame there. */
function centre(yd: number) {
  const p = gyrePathPoint(gyreTAtYards(yd));
  const frame: GyreTrackFrame = { t: 0, yards: 0, tx: 0, tz: 0, nx: 0, nz: 0, off: 0 };
  expect(gyreTrackFrameAt(p.x, p.z, frame)).toBe(true);
  return { x: p.x, y: p.y, z: p.z, frame };
}

// ---- the lanes -------------------------------------------------------------------------------

describe('the gale lanes', () => {
  it('fill the climb from the first lane to the crown clearance, in order', () => {
    expect(GYRE_WIND_LANES.length).toBeGreaterThanOrEqual(12);
    let prevEnd = -Infinity;
    let widest = 0;
    for (const lane of GYRE_WIND_LANES) {
      expect(lane.yd1 - lane.yd0).toBeCloseTo(GYRE_LANE_LEN_YD, 6);
      if (Number.isFinite(prevEnd)) {
        const gap = lane.yd0 - prevEnd;
        expect(gap).toBeGreaterThanOrEqual(GYRE_LANE_GAP_YD - 1e-6);
        widest = Math.max(widest, gap);
      }
      expect(lane.t1).toBeGreaterThan(lane.t0);
      prevEnd = lane.yd1;
    }
    expect(GYRE_WIND_LANES[0].yd0).toBe(GYRE_LANE_FIRST_YD);
    // the last lane ends exactly at the clearance: no dead stretch to strand a rider short of the crown
    expect(prevEnd).toBeCloseTo(GYRE_PATH_YARDS - GYRE_LANE_CROWN_CLEAR_YD, 6);
    // the gaps are the least gap, stretched only a little to make the lanes fit
    expect(widest).toBeLessThan(GYRE_LANE_GAP_YD * 1.5);
  });

  it('keep the pace across a gap: the aura outlasts a body at speed crossing it', () => {
    const gaps = GYRE_WIND_LANES.slice(1).map((l, i) => l.yd0 - GYRE_WIND_LANES[i].yd1);
    expect(Math.max(...gaps) / CEILING).toBeLessThan(GALE_LANE_LINGER * 0.5);
  });

  it('turn yards into path parameter, monotonically and consistent with the lane ends', () => {
    let prev = -1;
    for (let yd = 0; yd <= GYRE_PATH_YARDS; yd += 7) {
      const t = gyreTAtYards(yd);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
    expect(gyreTAtYards(0)).toBe(0);
    expect(gyreTAtYards(GYRE_PATH_YARDS)).toBe(1);
    for (const lane of GYRE_WIND_LANES) {
      expect(gyreTAtYards(lane.yd0)).toBeCloseTo(lane.t0, 9);
      expect(gyreTAtYards(lane.yd1)).toBeCloseTo(lane.t1, 9);
    }
  });

  it('lie on the path: the middle of every lane is a lane, the gaps between are not', () => {
    GYRE_WIND_LANES.forEach((lane, i) => {
      const mid = gyrePathPoint((lane.t0 + lane.t1) / 2);
      const at = gyrePathAt(mid.x, mid.z);
      expect(at, `lane ${i}`).not.toBeNull();
      expect(Math.abs(at?.off ?? 99), `lane ${i}`).toBeLessThan(0.05);
      expect(gyreLaneAt(mid.x, mid.y, mid.z), `lane ${i}`).toBe(lane);
      const next = GYRE_WIND_LANES[i + 1];
      if (next) {
        const g = gyrePathPoint((lane.t1 + next.t0) / 2);
        expect(gyreLaneAt(g.x, g.y, g.z), `gap ${i}`).toBeNull();
      }
    });
  });

  it('are not on the faces between the turns, past the outermost turn, or high over the path', () => {
    const lane = GYRE_WIND_LANES[2];
    const mid = gyrePathPoint((lane.t0 + lane.t1) / 2);
    const dx = mid.x - GYRE_PEAK.x;
    const dz = mid.z - GYRE_PEAK.z;
    const r = Math.hypot(dx, dz);
    const inner = r - GYRE_PEAK.pathW;
    expect(
      gyreLaneAt(GYRE_PEAK.x + (dx / r) * inner, mid.y, GYRE_PEAK.z + (dz / r) * inner),
    ).toBeNull();
    const outer = r + GYRE_PEAK.pathW;
    expect(
      gyreLaneAt(GYRE_PEAK.x + (dx / r) * outer, mid.y, GYRE_PEAK.z + (dz / r) * outer),
    ).toBeNull();
    expect(gyreLaneAt(mid.x, mid.y + 6, mid.z)).toBeNull();
    expect(gyreLaneAt(mid.x, mid.y + 1.2, mid.z)).toBe(lane);
  });
});

describe('the gale strength', () => {
  it('holds its full ceiling until the last stretch, then eases to a fraction at the crown', () => {
    expect(galeStrengthAtYards(0)).toBe(1);
    expect(galeStrengthAtYards(GYRE_PATH_YARDS - GALE_TAPER_YD - 1)).toBe(1);
    expect(galeStrengthAtYards(GYRE_PATH_YARDS)).toBeCloseTo(GALE_TAPER_END, 9);
    expect(galeStrengthAtYards(GYRE_PATH_YARDS + 50)).toBeCloseTo(GALE_TAPER_END, 9);
    let prev = 1;
    for (let yd = GYRE_PATH_YARDS - GALE_TAPER_YD; yd <= GYRE_PATH_YARDS; yd += 3) {
      const s = galeStrengthAtYards(yd);
      expect(s).toBeLessThanOrEqual(prev + 1e-12);
      prev = s;
    }
    // half way down the stretch, half way down the fall
    expect(galeStrengthAtYards(GYRE_PATH_YARDS - GALE_TAPER_YD / 2)).toBeCloseTo(
      (1 + GALE_TAPER_END) / 2,
      9,
    );
  });
});

// ---- the road's frame ----------------------------------------------------------------------------

describe('the road frame', () => {
  const frame: GyreTrackFrame = { t: 0, yards: 0, tx: 0, tz: 0, nx: 0, nz: 0, off: 0 };

  it('has a unit tangent along the climb and a unit normal out over the drop, at right angles', () => {
    for (let yd = 4; yd < GYRE_PATH_YARDS; yd += 9) {
      const c = centre(yd);
      const f = c.frame;
      expect(Math.hypot(f.tx, f.tz), `yd ${yd}`).toBeCloseTo(1, 9);
      expect(Math.hypot(f.nx, f.nz), `yd ${yd}`).toBeCloseTo(1, 9);
      expect(f.tx * f.nx + f.tz * f.nz, `yd ${yd}`).toBeCloseTo(0, 9);
      // the tangent runs the way the path does (a hair up the path and back)
      const a = gyrePathPoint(f.t - 1e-4);
      const b = gyrePathPoint(f.t + 1e-4);
      const l = Math.hypot(b.x - a.x, b.z - a.z);
      expect(f.tx * ((b.x - a.x) / l) + f.tz * ((b.z - a.z) / l), `yd ${yd}`).toBeGreaterThan(
        0.99999,
      );
      // the normal points away from the peak's axis
      const rx = c.x - GYRE_PEAK.x;
      const rz = c.z - GYRE_PEAK.z;
      const r = Math.hypot(rx, rz);
      expect(f.nx * (rx / r) + f.nz * (rz / r), `yd ${yd}`).toBeGreaterThan(0.95);
    }
  });

  it('reads where along the path and how far outboard of the centre line a point is', () => {
    const c = centre(150);
    const out = { ...c.frame };
    expect(out.yards).toBeCloseTo(150, 3);
    expect(out.t).toBeCloseTo(gyreTAtYards(150), 9);
    expect(out.off).toBeCloseTo(0, 6);
    // a point 1.5 yards outboard of the centre line, along the frame's own normal
    const dx = c.x - GYRE_PEAK.x;
    const dz = c.z - GYRE_PEAK.z;
    const r = Math.hypot(dx, dz);
    expect(gyreTrackFrameAt(c.x + (dx / r) * 1.5, c.z + (dz / r) * 1.5, frame)).toBe(true);
    expect(frame.off).toBeCloseTo(1.5, 6);
    expect(frame.yards).toBeCloseTo(150, 0);
  });

  it('is false off the path, and leaves what it was handed alone', () => {
    frame.tx = 0.5;
    expect(gyreTrackFrameAt(GYRE_PEAK.x + 80, GYRE_PEAK.z + 80, frame)).toBe(false);
    expect(frame.tx).toBe(0.5);
  });
});

// ---- the velocity law ----------------------------------------------------------------------------

describe('the gale current law', () => {
  /** A road running along +x, its drop to -z. */
  const road: GaleFrame = { tx: 1, tz: 0, nx: 0, nz: -1, off: 0 };
  const none: GaleWish = { fx: 0, fz: 0, sx: 0, sz: 0 };
  const out = { x: 0, z: 0 };

  it('carries a body at rest up the road, no key held, at the full push', () => {
    galeCurrentStep(0, 0, none, road, 1, GALE_LANE_GRIP, RUN_SPEED, out);
    expect(out.x).toBeCloseTo(GALE_WIND_ACCEL * DT, 9);
    expect(out.z).toBeCloseTo(0, 9);
  });

  it('builds speed to three times the run and holds it, never past it', () => {
    let vx = 0;
    let ticks = 0;
    while (vx < CEILING - 1e-9 && ticks < 200) {
      galeCurrentStep(vx, 0, none, road, 1, GALE_LANE_GRIP, RUN_SPEED, out);
      vx = out.x;
      ticks++;
    }
    // from a standstill to the ceiling in about a second, the grip's own drag taken out by the caller
    expect(ticks * DT).toBeLessThan(1.1);
    expect(vx).toBe(CEILING);
    for (let i = 0; i < 20; i++) {
      galeCurrentStep(vx, 0, none, road, 1, GALE_LANE_GRIP, RUN_SPEED, out);
      vx = out.x;
      expect(vx).toBe(CEILING);
    }
  });

  it('eases off over the last stretch: a lower ceiling, and a faster body braked down to it', () => {
    galeCurrentStep(0, 0, none, road, GALE_TAPER_END, GALE_LANE_GRIP, RUN_SPEED, out);
    expect(out.x).toBeCloseTo(GALE_WIND_ACCEL * DT, 9);
    galeCurrentStep(
      CEILING * GALE_TAPER_END - 0.1,
      0,
      none,
      road,
      GALE_TAPER_END,
      7,
      RUN_SPEED,
      out,
    );
    expect(out.x).toBeCloseTo(CEILING * GALE_TAPER_END, 9);
    galeCurrentStep(CEILING, 0, none, road, GALE_TAPER_END, GALE_LANE_GRIP, RUN_SPEED, out);
    expect(out.x).toBeCloseTo(CEILING - GALE_WIND_BRAKE * DT, 9);
    galeCurrentStep(
      CEILING * GALE_TAPER_END + 0.01,
      0,
      none,
      road,
      GALE_TAPER_END,
      7,
      RUN_SPEED,
      out,
    );
    expect(out.x).toBeCloseTo(CEILING * GALE_TAPER_END, 9);
  });

  it('lets the keys win when they ask straight back: the push falls under the body grip', () => {
    const back: GaleWish = { fx: -RUN_SPEED, fz: 0, sx: 0, sz: 0 };
    galeCurrentStep(0, 0, back, road, 1, GALE_LANE_GRIP, RUN_SPEED, out);
    expect(out.x).toBeCloseTo(GALE_WIND_OPPOSED_SHARE * GALE_LANE_GRIP * DT, 9);
    expect(GALE_WIND_OPPOSED_SHARE * GALE_LANE_GRIP).toBeLessThan(GALE_LANE_GRIP);
    // forward, or straight across, leaves the full push
    galeCurrentStep(
      0,
      0,
      { fx: RUN_SPEED, fz: 0, sx: 0, sz: 0 },
      road,
      1,
      GALE_LANE_GRIP,
      RUN_SPEED,
      out,
    );
    expect(out.x).toBeCloseTo(GALE_WIND_ACCEL * DT, 9);
    galeCurrentStep(
      0,
      0,
      { fx: 0, fz: RUN_SPEED, sx: 0, sz: 0 },
      road,
      1,
      GALE_LANE_GRIP,
      RUN_SPEED,
      out,
    );
    expect(out.x).toBeCloseTo(GALE_WIND_ACCEL * DT, 9);
    // half way between asking back and asking across: half way between the two pushes
    const half = Math.SQRT1_2 * RUN_SPEED;
    galeCurrentStep(
      0,
      0,
      { fx: -half, fz: half, sx: 0, sz: 0 },
      road,
      1,
      GALE_LANE_GRIP,
      RUN_SPEED,
      out,
    );
    const opposed = GALE_WIND_OPPOSED_SHARE * GALE_LANE_GRIP;
    expect(out.x).toBeCloseTo(
      (GALE_WIND_ACCEL + (opposed - GALE_WIND_ACCEL) * Math.SQRT1_2) * DT,
      9,
    );
  });

  it('sets the sideways speed outright: the strafe keys plus a pull to the centre line', () => {
    // nothing held, 2 yards outboard: pulled back in, in proportion
    galeCurrentStep(10, 3, none, { ...road, off: 2 }, 1, GALE_LANE_GRIP, RUN_SPEED, out);
    // the normal is -z, so "inward" is +z; the sideways speed is -CENTERING * off along the normal
    expect(out.z).toBeCloseTo(-(-GALE_WIND_CENTERING * 2), 9);
    // a strafe wish along the normal at the run's pace: across at the run's pace at the centre line
    galeCurrentStep(
      0,
      0,
      { fx: 0, fz: 0, sx: 0, sz: -RUN_SPEED },
      road,
      1,
      GALE_LANE_GRIP,
      RUN_SPEED,
      out,
    );
    expect(out.z).toBeCloseTo(-RUN_SPEED, 9);
    // clamped to the run's pace whatever the wish says
    galeCurrentStep(
      0,
      0,
      { fx: 0, fz: 0, sx: 0, sz: -3 * RUN_SPEED },
      road,
      1,
      GALE_LANE_GRIP,
      RUN_SPEED,
      out,
    );
    expect(out.z).toBeCloseTo(-RUN_SPEED, 9);
    // the key that is held against the road's pull settles at the road's edge, and no further
    const settle = RUN_SPEED / GALE_WIND_CENTERING;
    galeCurrentStep(
      0,
      0,
      { fx: 0, fz: 0, sx: 0, sz: -RUN_SPEED },
      { ...road, off: settle },
      1,
      GALE_LANE_GRIP,
      RUN_SPEED,
      out,
    );
    expect(out.z).toBeCloseTo(0, 9);
    expect(settle).toBeGreaterThan(GYRE_PEAK.pathW / 2 - 0.5);
  });

  it('follows the road wherever it turns: the answer lies along the frame it is given', () => {
    const turned: GaleFrame = { tx: 0, tz: 1, nx: 1, nz: 0, off: 0 };
    let vx = 0;
    let vz = 0;
    for (let i = 0; i < 30; i++) {
      galeCurrentStep(vx, vz, none, turned, 1, GALE_LANE_GRIP, RUN_SPEED, out);
      vx = out.x;
      vz = out.z;
    }
    expect(vx).toBeCloseTo(0, 9);
    expect(vz).toBeGreaterThan(CEILING * 0.9);
    // a body still moving along the old road is turned onto the new one in a single tick
    galeCurrentStep(15, 0, none, turned, 1, GALE_LANE_GRIP, RUN_SPEED, out);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.z).toBeGreaterThan(0);
  });

  it('never answers faster than the slide ceiling, whatever the sideways pull adds', () => {
    // at the ceiling along the road, 3 yards outboard and a strafe key held: across speed on top
    galeCurrentStep(
      CEILING,
      0,
      { fx: 0, fz: 0, sx: 0, sz: RUN_SPEED },
      { ...road, off: 3 },
      1,
      GALE_LANE_GRIP,
      RUN_SPEED,
      out,
    );
    expect(Math.hypot(out.x, out.z)).toBeLessThanOrEqual(CEILING + 1e-9);
    expect(Math.hypot(out.x, out.z)).toBeGreaterThan(CEILING - 1e-6);
  });

  it('never brakes a body below its own pace: a horse is not slowed where the push has eased', () => {
    const horse = RUN_SPEED * 2;
    // on the last stretch the push eases to the taper's ceiling, under a horse's own pace
    expect(CEILING * GALE_TAPER_END).toBeLessThan(horse);
    galeCurrentStep(horse, 0, none, road, GALE_TAPER_END, GALE_LANE_GRIP, horse, out);
    expect(out.x).toBeCloseTo(horse, 9);
    // a body faster still is braked, but only down to its own pace
    galeCurrentStep(horse + 3, 0, none, road, GALE_TAPER_END, GALE_LANE_GRIP, horse, out);
    expect(out.x).toBeCloseTo(horse + 3 - GALE_WIND_BRAKE * DT, 9);
    galeCurrentStep(horse + 0.1, 0, none, road, GALE_TAPER_END, GALE_LANE_GRIP, horse, out);
    expect(out.x).toBeCloseTo(horse, 9);
    // between the eased push and its own pace the gale neither pushes nor brakes
    const mid = (CEILING * GALE_TAPER_END + horse) / 2;
    galeCurrentStep(mid, 0, none, road, GALE_TAPER_END, GALE_LANE_GRIP, horse, out);
    expect(out.x).toBeCloseTo(mid, 9);
    // below the eased ceiling it pushes, as it does anyone
    galeCurrentStep(0, 0, none, road, GALE_TAPER_END, GALE_LANE_GRIP, horse, out);
    expect(out.x).toBeCloseTo(GALE_WIND_ACCEL * DT, 9);
    // where the push is at full strength, a horse is carried to the ride's top speed like anyone
    galeCurrentStep(CEILING - 0.5, 0, none, road, 1, GALE_LANE_GRIP, horse, out);
    expect(out.x).toBeCloseTo(CEILING, 9);
  });

  it('is a pure function of its arguments: same in, same out, nothing else written', () => {
    const wish: GaleWish = { fx: 2, fz: -3, sx: 1, sz: 0.5 };
    const frame: GaleFrame = { tx: 0.6, tz: 0.8, nx: 0.8, nz: -0.6, off: 0.7 };
    const a = { x: 0, z: 0 };
    const b = { x: 9, z: 9 };
    galeCurrentStep(4, 5, wish, frame, 0.8, 7, RUN_SPEED, a);
    galeCurrentStep(4, 5, wish, frame, 0.8, 7, RUN_SPEED, b);
    expect(b).toEqual(a);
    expect(wish).toEqual({ fx: 2, fz: -3, sx: 1, sz: 0.5 });
    expect(frame).toEqual({ tx: 0.6, tz: 0.8, nx: 0.8, nz: -0.6, off: 0.7 });
  });
});

// ---- the coast limit ------------------------------------------------------------------------------

describe('the coast limit', () => {
  it('is the gale ceiling at its place on the road, eased down the last stretch, and the run off it', () => {
    expect(galeCoastLimit(false, 1, RUN_SPEED)).toBe(RUN_SPEED);
    expect(galeCoastLimit(false, 0.2, RUN_SPEED)).toBe(RUN_SPEED);
    expect(galeCoastLimit(true, 1, RUN_SPEED)).toBe(CEILING);
    expect(galeCoastLimit(true, GALE_TAPER_END, RUN_SPEED)).toBeCloseTo(
      CEILING * GALE_TAPER_END,
      9,
    );
    // never under the body's own pace, whatever the strength
    expect(galeCoastLimit(true, 0, RUN_SPEED)).toBe(RUN_SPEED);
  });

  it("is never under the body's own pace: a mounted rider keeps a horse's speed", () => {
    const horse = RUN_SPEED * 1.7;
    expect(galeCoastLimit(false, 1, horse)).toBe(horse);
    expect(galeCoastLimit(true, GALE_TAPER_END, horse)).toBe(horse);
    expect(galeCoastLimit(true, 1, horse)).toBe(CEILING);
    // and a slowed body is held to its own slowed pace off the road
    expect(galeCoastLimit(false, 1, RUN_SPEED * 0.5)).toBe(RUN_SPEED * 0.5);
  });

  it('holds a velocity to the limit keeping its heading, and leaves one within it alone', () => {
    const out = { x: 99, z: 99 };
    expect(galeCoastClamp(6, 8, 5, out)).toBe(true);
    expect(out.x).toBeCloseTo(3, 9);
    expect(out.z).toBeCloseTo(4, 9);
    const keep = { x: 99, z: 99 };
    expect(galeCoastClamp(3, 4, 5, keep)).toBe(false);
    expect(galeCoastClamp(0, 0, 5, keep)).toBe(false);
    expect(keep).toEqual({ x: 99, z: 99 });
  });
});

// ---- the aura ---------------------------------------------------------------------------------

describe('the Gale Lane aura', () => {
  const lane = GYRE_WIND_LANES[3];
  const mid = gyrePathPoint((lane.t0 + lane.t1) / 2);

  it('is the kernel slick, worn as a speed buff: momentum and a ceiling of three times the run', () => {
    const p = stub(mid.x, mid.y, mid.z);
    updateGyreWind(p);
    expect(p.auras).toHaveLength(1);
    const a = p.auras[0];
    expect(a.id).toBe(GALE_LANE_AURA_ID);
    expect(a.id).toBe(SLIPPERY_GROUND_AURA);
    expect(a.name).toBe(GALE_LANE_AURA_NAME);
    expect(a.kind).toBe('buff_speed');
    expect(a.value).toBe(GALE_LANE_SPEED);
    expect(a.value2).toBe(GALE_LANE_GRIP);
    expect(a.remaining).toBe(GALE_LANE_LINGER);
    expect(a.undispellable).toBe(true);
    // the kernel reads it: the slide's grip, and the run's multiplier that sets its ceiling
    expect(slipperyGrip(p)).toBe(GALE_LANE_GRIP);
    expect(moveSpeedMult(p)).toBe(GALE_LANE_SPEED);
  });

  it('is topped up only once it runs low, never while it is fresh', () => {
    const p = stub(mid.x, mid.y, mid.z);
    updateGyreWind(p);
    const a = p.auras[0];
    a.remaining = GALE_LANE_LINGER * 0.8;
    updateGyreWind(p);
    expect(p.auras).toHaveLength(1);
    expect(p.auras[0].remaining).toBe(GALE_LANE_LINGER * 0.8);
    a.remaining = GALE_LANE_LINGER * 0.3;
    updateGyreWind(p);
    expect(p.auras[0].remaining).toBe(GALE_LANE_LINGER);
  });

  it('is never put on anyone off the lanes, and lapses on its own after a lane', () => {
    const gap = gyrePathPoint((lane.t1 + GYRE_WIND_LANES[4].t0) / 2);
    const p = stub(gap.x, gap.y, gap.z);
    updateGyreWind(p);
    expect(p.auras).toEqual([]);
    const worn = stub(gap.x, gap.y, gap.z);
    worn.auras.push({
      id: GALE_LANE_AURA_ID,
      name: GALE_LANE_AURA_NAME,
      kind: 'buff_speed',
      remaining: 0.4,
      duration: GALE_LANE_LINGER,
      value: GALE_LANE_SPEED,
      value2: GALE_LANE_GRIP,
      sourceId: 7,
      school: 'nature',
    });
    updateGyreWind(worn);
    expect(worn.auras).toHaveLength(1);
    expect(worn.auras[0].remaining).toBe(0.4);
  });

  it("never takes over another slick: a body already on someone else's grip keeps it", () => {
    const p = stub(mid.x, mid.y, mid.z);
    p.auras.push({
      id: SLIPPERY_GROUND_AURA,
      name: 'Slick Ice',
      kind: 'slow',
      remaining: 1,
      duration: 1.5,
      value: 1,
      value2: 4,
      sourceId: 7,
      school: 'frost',
    });
    updateGyreWind(p);
    expect(p.auras).toHaveLength(1);
    expect(p.auras[0].name).toBe('Slick Ice');
    expect(p.auras[0].value2).toBe(4);
    expect(p.auras[0].remaining).toBe(1);
  });

  it('skips the dead, spirits, the carried and ferry passengers', () => {
    for (const extra of [
      { dead: true },
      { ghost: true },
      { carriedBy: 3 },
      { ferryRide: {} },
    ] as Partial<Entity>[]) {
      const p = stub(mid.x, mid.y, mid.z, extra);
      updateGyreWind(p);
      expect(p.auras, JSON.stringify(extra)).toEqual([]);
      expect(p.vx, JSON.stringify(extra)).toBe(0);
    }
  });

  it('carries a mounted rider like anyone on foot', () => {
    const p = stub(mid.x, mid.y, mid.z, { mountKey: 'horse', ridingTier: 1 } as Partial<Entity>);
    updateGyreWind(p);
    expect(p.auras.map((a) => a.name)).toEqual([GALE_LANE_AURA_NAME]);
    expect(Math.hypot(p.vx, p.vz)).toBeCloseTo(GALE_WIND_ACCEL * DT, 6);
  });

  it('costs a player far from the peak nothing', () => {
    const p = stub(900, 10, 900);
    updateGyreWind(p);
    expect(p.auras).toEqual([]);
  });
});

// ---- the gale on a body -------------------------------------------------------------------------

describe('the gale on a body in a lane', () => {
  const c = centre(GYRE_WIND_LANES[3].yd0 + 8);

  /** A body in the lane, wearing the aura already, as the step's first call leaves it. */
  function riding(extra: Partial<Entity> = {}) {
    const p = stub(c.x, c.y, c.z, extra);
    updateGyreWind(p, host());
    p.vx = 0;
    p.vz = 0;
    return p;
  }

  it('pushes a body at rest up the track, with no key held', () => {
    const p = riding();
    updateGyreWind(p, host());
    const f = c.frame;
    expect(Math.hypot(p.vx, p.vz)).toBeCloseTo(GALE_WIND_ACCEL * DT, 6);
    // up the track: along the frame's tangent, nothing across it (to the frame ahead of the body)
    expect(p.vx * f.tx + p.vz * f.tz).toBeGreaterThan(GALE_WIND_ACCEL * DT * 0.999);
    expect(Math.abs(p.vx * f.nx + p.vz * f.nz)).toBeLessThan(0.01);
  });

  it('reads the held keys: back, with the camera down the track, softens the push', () => {
    const f = c.frame;
    // facing down the track, forward key: the wish asks down the climb
    const facingDown = Math.atan2(-f.tx, -f.tz);
    const held = riding({ facing: facingDown });
    updateGyreWind(held, host({ forward: true }));
    const free = riding({ facing: facingDown });
    updateGyreWind(free, host());
    expect(held.vx * f.tx + held.vz * f.tz).toBeCloseTo(
      GALE_WIND_OPPOSED_SHARE * GALE_LANE_GRIP * DT,
      2,
    );
    expect(free.vx * f.tx + free.vz * f.tz).toBeCloseTo(GALE_WIND_ACCEL * DT, 2);
  });

  it('drifts a body across the road with the strafe keys, and only with the strafe keys', () => {
    const f = c.frame;
    const facing = Math.atan2(f.tx, f.tz);
    // the strafe-left key is outboard on this road (the kernel's right is (-cos f, sin f))
    const left = riding({ facing });
    updateGyreWind(left, host({ strafeLeft: true }));
    expect(left.vx * f.nx + left.vz * f.nz).toBeGreaterThan(RUN_SPEED * 0.9);
    const right = riding({ facing });
    updateGyreWind(right, host({ strafeRight: true }));
    expect(right.vx * f.nx + right.vz * f.nz).toBeLessThan(-RUN_SPEED * 0.9);
    // the forward key, held with the camera turned half across the road, shoves no one sideways
    const across = riding({ facing: Math.atan2(f.nx, f.nz) });
    updateGyreWind(across, host({ forward: true }));
    expect(Math.abs(across.vx * f.nx + across.vz * f.nz)).toBeLessThan(0.05);
  });

  it('blows a body in a hop by the same law, so a jump on a bend keeps to the road', () => {
    const f = c.frame;
    const ground = riding();
    updateGyreWind(ground, host());
    const hop = riding({ onGround: false, jumping: true });
    updateGyreWind(hop, host());
    expect([hop.vx, hop.vz]).toEqual([ground.vx, ground.vz]);
    // at speed the hop's velocity is set in the road's frame too, not carried off along a tangent
    const fast = riding({ onGround: false, jumping: true });
    fast.vx = f.tx * CEILING + f.nx * 4;
    fast.vz = f.tz * CEILING + f.nz * 4;
    updateGyreWind(fast, host());
    expect(fast.vx * f.tx + fast.vz * f.tz).toBeGreaterThan(CEILING - 0.5);
    expect(Math.abs(fast.vx * f.nx + fast.vz * f.nz)).toBeLessThan(1);
  });

  it('never blows a body on a scripted flight or one thrown by a knockback, or in a gap between lanes', () => {
    const flying = riding({ leap: {} } as unknown as Partial<Entity>);
    updateGyreWind(flying, host());
    expect([flying.vx, flying.vz]).toEqual([0, 0]);
    const thrown = riding({
      onGround: false,
      launchedBy: { sourceId: 3, ticksLeft: 10 },
    } as unknown as Partial<Entity>);
    updateGyreWind(thrown, host());
    expect([thrown.vx, thrown.vz]).toEqual([0, 0]);
    const gap = gyrePathPoint((GYRE_WIND_LANES[3].t1 + GYRE_WIND_LANES[4].t0) / 2);
    const lingering = stub(gap.x, gap.y, gap.z);
    lingering.auras.push({
      id: GALE_LANE_AURA_ID,
      name: GALE_LANE_AURA_NAME,
      kind: 'buff_speed',
      remaining: 1,
      duration: GALE_LANE_LINGER,
      value: GALE_LANE_SPEED,
      value2: GALE_LANE_GRIP,
      sourceId: 7,
      school: 'nature',
    });
    updateGyreWind(lingering, host());
    expect([lingering.vx, lingering.vz]).toEqual([0, 0]);
  });

  it('works without a host to read keys from: no keys held, the full push', () => {
    const p = riding();
    updateGyreWind(p);
    expect(Math.hypot(p.vx, p.vz)).toBeCloseTo(GALE_WIND_ACCEL * DT, 6);
  });
});

// ---- who the gale carries -------------------------------------------------------------------------

describe('who the gale carries', () => {
  const c = centre(GYRE_WIND_LANES[3].yd0 + 8);
  const pocket = GYRE_LAUNCH_POCKETS[0];

  interface Case {
    label: string;
    /** a hard hold: the gale zeroes its slide, rather than only leaving it alone */
    held: boolean;
    extra?: Partial<Entity>;
    aura?: Entity['auras'][number];
    modes?: Record<string, unknown>;
  }
  const CASES: Case[] = [
    // what stops a body where it stands
    ...(['stun', 'root', 'stasis', 'incapacitate', 'polymorph', 'feign_death'] as const).map(
      (kind): Case => ({ label: kind, held: true, aura: auraOf(kind) }),
    ),
    // what puts another mover on a body: scripted state on the entity itself ...
    { label: 'a charge', held: false, extra: { chargeTargetId: 5 } as Partial<Entity> },
    { label: 'a follow', held: false, extra: { followTargetId: 5 } as Partial<Entity> },
    { label: 'a leap', held: false, extra: { leap: {} } as unknown as Partial<Entity> },
    { label: 'a climb', held: false, extra: { climb: {} } as unknown as Partial<Entity> },
    {
      label: "the Valkyr's call",
      held: false,
      extra: { valkyrsCalling: {} } as unknown as Partial<Entity>,
    },
    // ... a session in the player's own meta ...
    ...(['vehicle', 'mountRace', 'mountTraining', 'devAnchored', 'lance'] as const).map(
      (mode): Case => ({ label: `a ${mode} session`, held: false, modes: { [mode]: {} } }),
    ),
    // ... and a body that refuses to be moved
    { label: 'the anchor', held: false, aura: auraOf('buff_dr', TRINKET_AURA.anchor) },
    {
      label: "the Foreman's shape",
      held: false,
      aura: auraOf('buff_dr', TRINKET_AURA.foremanShape),
    },
  ];

  it.each(CASES)('pushes and steers no body under $label', ({ held, extra, aura, modes }) => {
    const p = stub(c.x, c.y, c.z, extra);
    // wearing the aura with the ride's speed, as a body would a tick after leaving a clear lane
    p.auras.push(laneAuraOf());
    if (aura) p.auras.push(aura);
    p.vx = 3;
    p.vz = 4;
    updateGyreWind(p, host({ forward: true, strafeLeft: true }, modes));
    // a hold takes the slide away; another mover's body is simply left alone
    expect([p.vx, p.vz]).toEqual(held ? [0, 0] : [3, 4]);
  });

  it.each(CASES)('puts no Gale Lane on a body under $label', ({ extra, aura, modes }) => {
    const p = stub(c.x, c.y, c.z, extra);
    if (aura) p.auras.push(aura);
    updateGyreWind(p, host({}, modes));
    expect(p.auras.some((a) => a.id === GALE_LANE_AURA_ID)).toBe(false);
  });

  it.each(CASES)('never lifts a body under $label in a pocket', ({ extra, aura, modes }) => {
    const p = stub(pocket.x, pocket.y, pocket.z, extra);
    if (aura) p.auras.push(aura);
    const before = p.leap;
    updateGyreWind(p, host({}, modes));
    expect(p.leap).toBe(before);
    expect(p.cooldowns.has(GALE_LAUNCH_COOLDOWN_ID)).toBe(false);
  });

  it('lets a free body in the same lane be carried, so the cases above are the only reason', () => {
    const p = stub(c.x, c.y, c.z);
    updateGyreWind(p, host());
    expect(p.auras.some((a) => a.id === GALE_LANE_AURA_ID)).toBe(true);
    expect(Math.hypot(p.vx, p.vz)).toBeGreaterThan(0);
  });
});

// ---- the coast ---------------------------------------------------------------------------------------

describe('the coast, out of a lane', () => {
  const last = GYRE_WIND_LANES[GYRE_WIND_LANES.length - 1];

  /** A body wearing the aura on the road at `yd`, at `speed` yards a second along the track. */
  function coasting(yd: number, speed: number, extra: Partial<Entity> = {}) {
    const c = centre(yd);
    const p = stub(c.x, c.y, c.z, extra);
    p.auras.push(laneAuraOf());
    p.vx = c.frame.tx * speed;
    p.vz = c.frame.tz * speed;
    return { p, c };
  }

  it("holds a body on the road's last stretch to the gale's eased ceiling, keeping its heading", () => {
    const { p, c } = coasting(last.yd1 + 2, 20);
    updateGyreWind(p, host());
    const limit = Math.max(RUN_SPEED, CEILING * galeStrengthAtYards(c.frame.yards));
    expect(limit).toBeLessThan(CEILING * 0.5);
    expect(Math.hypot(p.vx, p.vz)).toBeCloseTo(limit, 6);
    expect(p.vx * c.frame.tx + p.vz * c.frame.tz).toBeCloseTo(limit, 6);
  });

  it('leaves a body in a mid-climb gap, where the gale is at full strength, alone', () => {
    const gap = (GYRE_WIND_LANES[3].yd1 + GYRE_WIND_LANES[4].yd0) / 2;
    const { p, c } = coasting(gap, CEILING - 1);
    const vx = p.vx;
    const vz = p.vz;
    updateGyreWind(p, host());
    expect(galeStrengthAtYards(c.frame.yards)).toBe(1);
    expect([p.vx, p.vz]).toEqual([vx, vz]);
  });

  it('holds a body that has left the road to the plain run', () => {
    // the crown's middle is off the road: nothing blows there
    const p = stub(GYRE_PEAK.x, CROWN_TOP, GYRE_PEAK.z);
    p.auras.push(laneAuraOf());
    p.vx = 20;
    p.vz = 0;
    updateGyreWind(p, host());
    expect(gyrePathAt(p.pos.x, p.pos.z)).toBeNull();
    expect([p.vx, p.vz]).toEqual([RUN_SPEED, 0]);
  });

  it('holds a hop out of a lane to the same limit, and never slows an ordinary pace', () => {
    const { p, c } = coasting(last.yd1 + 2, 20, { onGround: false, jumping: true });
    updateGyreWind(p, host());
    expect(Math.hypot(p.vx, p.vz)).toBeLessThan(CEILING * 0.5);
    const walker = coasting(last.yd1 + 2, RUN_SPEED - 1).p;
    updateGyreWind(walker, host());
    expect(Math.hypot(walker.vx, walker.vz)).toBeCloseTo(RUN_SPEED - 1, 9);
    expect(c.frame.yards).toBeGreaterThan(last.yd1);
  });

  it('leaves a body not wearing the aura, and a thrown one, alone', () => {
    const bare = coasting(last.yd1 + 2, 20).p;
    bare.auras = [];
    updateGyreWind(bare, host());
    expect(Math.hypot(bare.vx, bare.vz)).toBeCloseTo(20, 9);
    const thrown = coasting(last.yd1 + 2, 20, {
      onGround: false,
      launchedBy: { sourceId: 3, ticksLeft: 10 },
    } as unknown as Partial<Entity>).p;
    updateGyreWind(thrown, host());
    expect(Math.hypot(thrown.vx, thrown.vz)).toBeCloseTo(20, 9);
  });
});

// ---- the tooltip ---------------------------------------------------------------------------------

describe('the Gale Lane tooltip', () => {
  it('states the ride with the live numbers, not the ice line that shares its aura id', () => {
    const lane = GYRE_WIND_LANES[3];
    const mid = gyrePathPoint((lane.t0 + lane.t1) / 2);
    const p = stub(mid.x, mid.y, mid.z);
    updateGyreWind(p);
    const d = auraEffectDescriptor(p.auras[0]);
    expect(d?.key).toBe('hudChrome.auraEffect.quartered.galeLane');
    // the ceiling the live ride tops out at, the eased one at the crown, and the linger
    expect(d?.nums?.speed).toBe(CEILING);
    expect(d?.nums?.summit).toBeCloseTo(CEILING * galeStrengthAtYards(GYRE_PATH_YARDS), 9);
    expect(d?.nums?.linger).toBe(GALE_LANE_LINGER);
    // every placeholder is a number the descriptor supplies, every number it supplies is
    // printed, and the copy hardcodes no number of its own
    const text = hudChromeStrings.auraEffect.quartered.galeLane;
    const tokens = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    expect(new Set(tokens)).toEqual(new Set(Object.keys(d?.nums ?? {})));
    expect(text.replace(/\{\w+\}/g, '')).not.toMatch(/\d/);
  });

  it("leaves the ice its own line: the frozen lakes' and the crypt's slick", () => {
    const ice = auraEffectDescriptor({
      id: SLIPPERY_GROUND_AURA,
      kind: 'slow',
      value: 1,
      value2: 4,
    });
    expect(ice?.key).toBe('hudChrome.auraEffect.crypt.slippery');
    expect(ice?.nums?.grip).toBe(4);
  });
});

// ---- the pockets ---------------------------------------------------------------------------------

describe('the launch pockets', () => {
  it('open on the outer lip, apart from the beacons and the standing stones', () => {
    expect(GYRE_LAUNCH_POCKETS).toHaveLength(4);
    for (const pocket of GYRE_LAUNCH_POCKETS) {
      const at = gyrePathAt(pocket.x, pocket.z);
      expect(at, `t ${pocket.t}`).not.toBeNull();
      expect(at?.off ?? 0, `t ${pocket.t}`).toBeCloseTo(GYRE_LAUNCH_OFFSET, 1);
      expect(Math.abs(ground(pocket.x, pocket.z) - pocket.y), `t ${pocket.t}`).toBeLessThan(0.1);
      expect(Math.hypot(pocket.ox, pocket.oz)).toBeCloseTo(1, 9);
      expect(pocket.yd).toBeCloseTo(gyreYardsAtT(pocket.t), 9);
      for (const stop of COUNCIL_BEACON_STOPS) {
        expect(
          Math.abs(gyreYardsAtT(stop) - pocket.yd),
          `t ${pocket.t} vs beacon ${stop}`,
        ).toBeGreaterThan(10);
      }
      for (const stop of GYRE_STONE_STOPS) {
        expect(
          Math.abs(gyreYardsAtT(stop) - pocket.yd),
          `t ${pocket.t} vs stone ${stop}`,
        ).toBeGreaterThan(7);
      }
    }
    const ts = GYRE_LAUNCH_POCKETS.map((p) => p.t);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
    expect(ts[0]).toBeGreaterThan(0.1);
    expect(ts[3]).toBeLessThan(0.95);
  });

  it('set a body down on the next turn of the road, or on the crown above the last turn', () => {
    GYRE_LAUNCH_POCKETS.forEach((pocket, i) => {
      const L = pocket.landing;
      const up = L.y - pocket.y;
      expect(up, `pocket ${i}`).toBeGreaterThan(3);
      const inward =
        Math.hypot(pocket.x - GYRE_PEAK.x, pocket.z - GYRE_PEAK.z) -
        Math.hypot(L.x - GYRE_PEAK.x, L.z - GYRE_PEAK.z);
      expect(inward, `pocket ${i}`).toBeGreaterThan(10);
      if (pocket.t + TURN_T <= 0.97) {
        // the next turn up, at the same bearing, on its centre line
        const at = gyrePathAt(L.x, L.z);
        expect(at, `pocket ${i}`).not.toBeNull();
        expect(at?.t ?? 0, `pocket ${i}`).toBeCloseTo(pocket.t + TURN_T, 6);
        expect(Math.abs(at?.off ?? 9), `pocket ${i}`).toBeLessThan(0.01);
        expect(L.y, `pocket ${i}`).toBeCloseTo(gyrePathPoint(pocket.t + TURN_T).y, 6);
        expect(up, `pocket ${i}`).toBeGreaterThan(12);
      } else {
        // the crown: on its level, inside its rim
        expect(L.y, `pocket ${i}`).toBe(CROWN_TOP);
        expect(Math.hypot(L.x - GYRE_PEAK.x, L.z - GYRE_PEAK.z), `pocket ${i}`).toBeLessThan(
          GYRE_PEAK.endR - GYRE_PEAK.pathW / 2,
        );
      }
      expect(pocket.duration, `pocket ${i}`).toBeGreaterThanOrEqual(GALE_LIFT_MIN_SECONDS);
      expect(pocket.duration, `pocket ${i}`).toBeLessThanOrEqual(GALE_LIFT_MAX_SECONDS);
    });
    // two lifts to the next turn, two to the crown
    const toCrown = GYRE_LAUNCH_POCKETS.filter((p) => p.landing.y === CROWN_TOP);
    expect(toCrown).toHaveLength(2);
  });

  it('set a body down clear of every prop: nothing stands on a touchdown', () => {
    // a Sim builds the isle's colliders
    new Sim({ seed: SEED, playerClass: 'warrior' });
    GYRE_LAUNCH_POCKETS.forEach((pocket, i) => {
      const L = pocket.landing;
      const r = resolvePosition(SEED, L.x, L.z, 0.5, false, undefined, { y: L.y, lift: 0 });
      expect(Math.hypot(r.x - L.x, r.z - L.z), `pocket ${i}`).toBeLessThan(0.02);
    });
  });

  it('fly arcs that clear the ground the whole way over, never grazing the face', () => {
    GYRE_LAUNCH_POCKETS.forEach((pocket, i) => {
      let worst = Number.POSITIVE_INFINITY;
      for (let k = 10; k <= 95; k++) {
        const pr = k / 100;
        const x = pocket.x + (pocket.landing.x - pocket.x) * pr;
        const z = pocket.z + (pocket.landing.z - pocket.z) * pr;
        const y = pocket.y + (pocket.landing.y - pocket.y) * pr + pocket.apex * 4 * pr * (1 - pr);
        worst = Math.min(worst, y - ground(x, z));
      }
      expect(worst, `pocket ${i}`).toBeGreaterThan(1.5);
    });
  });

  it('are found in the outer part of the opening, along its whole length, and nowhere else', () => {
    const p0 = GYRE_LAUNCH_POCKETS[0];
    // the pad itself, on the lip
    expect(gyreLaunchPocketAt(p0.x, p0.y, p0.z)).toBe(p0);
    const frame: GyreTrackFrame = { t: 0, yards: 0, tx: 0, tz: 0, nx: 0, nz: 0, off: 0 };
    // at any yard of the opening (between the gate stones), anywhere from the road's outer part to
    // the lip: nobody gets to the edge without being lifted first
    for (let d = -4; d <= 4; d += 1) {
      const c = centre(p0.yd + d);
      for (const off of [GYRE_LAUNCH_MIN_OFF + 0.05, 2, 2.8, 3.4]) {
        expect(gyreTrackFrameAt(c.x, c.z, frame)).toBe(true);
        const x =
          c.x + (c.x - GYRE_PEAK.x) * (off / Math.hypot(c.x - GYRE_PEAK.x, c.z - GYRE_PEAK.z));
        const z =
          c.z + (c.z - GYRE_PEAK.z) * (off / Math.hypot(c.x - GYRE_PEAK.x, c.z - GYRE_PEAK.z));
        expect(gyreLaunchPocketAt(x, c.y, z), `d ${d} off ${off}`).toBe(p0);
      }
    }
    // the road's middle and its inner half are the ride's, not the lift's
    const mid = centre(p0.yd);
    expect(gyreLaunchPocketAt(mid.x, mid.y, mid.z)).toBeNull();
    // a hair short of the lift's outer part
    const short =
      (GYRE_LAUNCH_MIN_OFF - 0.1) / Math.hypot(mid.x - GYRE_PEAK.x, mid.z - GYRE_PEAK.z);
    expect(
      gyreLaunchPocketAt(
        mid.x + (mid.x - GYRE_PEAK.x) * short,
        mid.y,
        mid.z + (mid.z - GYRE_PEAK.z) * short,
      ),
    ).toBeNull();
    // a rider hugging the lip a yard before the first gate stone is already caught
    for (const d of [-(GYRE_RAIL_GAP_HALF + 0.5), GYRE_RAIL_GAP_HALF + 0.5]) {
      const c = centre(p0.yd + d);
      const k = 2.0 / Math.hypot(c.x - GYRE_PEAK.x, c.z - GYRE_PEAK.z);
      expect(
        gyreLaunchPocketAt(c.x + (c.x - GYRE_PEAK.x) * k, c.y, c.z + (c.z - GYRE_PEAK.z) * k),
        `d ${d}`,
      ).toBe(p0);
    }
    // past the lift's ends along the path, and high over it
    for (const d of [-(GYRE_LAUNCH_HALF_YD + 0.6), GYRE_LAUNCH_HALF_YD + 0.6]) {
      const c = centre(p0.yd + d);
      const k = 2.8 / Math.hypot(c.x - GYRE_PEAK.x, c.z - GYRE_PEAK.z);
      expect(
        gyreLaunchPocketAt(c.x + (c.x - GYRE_PEAK.x) * k, c.y, c.z + (c.z - GYRE_PEAK.z) * k),
      ).toBe(null);
    }
    expect(gyreLaunchPocketAt(p0.x, p0.y + 4, p0.z)).toBeNull();
  });

  it('cover the whole opening and a stretch of railed road either side, so the catch is easy to hit', () => {
    // the catch begins a couple of yards up the railed road before the opening, and ends as far past it
    expect(GYRE_LAUNCH_HALF_YD).toBeGreaterThanOrEqual(GYRE_RAIL_GAP_HALF + 2);
    expect(GYRE_LAUNCH_HALF_YD).toBeLessThanOrEqual(GYRE_RAIL_GAP_HALF + 3.5);
    // at the ride's full speed a rider has most of a second in it
    expect((2 * GYRE_LAUNCH_HALF_YD) / CEILING).toBeGreaterThan(0.75);
    // the road's outer part only: a rider who does not steer drifts up to about 0.9 yd out on the
    // upper bends and must pass it by (the live ride below pins that), while a moment's strafe
    // reaches it
    expect(GYRE_LAUNCH_MIN_OFF).toBeGreaterThan(0.95);
    expect(GYRE_LAUNCH_MIN_OFF).toBeLessThan(1.3);
    const p0 = GYRE_LAUNCH_POCKETS[0];
    for (const d of [
      -(GYRE_LAUNCH_HALF_YD - 0.5),
      -(GYRE_RAIL_GAP_HALF + 1),
      GYRE_RAIL_GAP_HALF + 1,
    ]) {
      const c = centre(p0.yd + d);
      const k = (GYRE_LAUNCH_MIN_OFF + 0.05) / Math.hypot(c.x - GYRE_PEAK.x, c.z - GYRE_PEAK.z);
      expect(
        gyreLaunchPocketAt(c.x + (c.x - GYRE_PEAK.x) * k, c.y, c.z + (c.z - GYRE_PEAK.z) * k),
        `d ${d}`,
      ).toBe(p0);
    }
  });
});

// ---- the lift --------------------------------------------------------------------------------------

describe('the lift', () => {
  it('sets a grounded body on a scripted flight to the pocket landing, once per cooldown', () => {
    const pocket = GYRE_LAUNCH_POCKETS[1];
    const p = stub(pocket.x, pocket.y, pocket.z, { vx: 3, vz: -2 });
    updateGyreWind(p, host());
    const flight = p.leap;
    if (!flight) throw new Error('no flight');
    expect(flight.from).toEqual({ x: pocket.x, y: pocket.y, z: pocket.z });
    expect(flight.to).toEqual(pocket.landing);
    expect(flight.elapsed).toBe(0);
    expect(flight.duration).toBe(pocket.duration);
    expect(flight.apex).toBe(pocket.apex);
    expect(flight.landingAoe).toEqual({ min: 0, max: 0, radius: 0 });
    expect(flight.abilityName).toBe(GALE_LIFT_NAME);
    expect(flight.abilityId).toBe(GALE_LAUNCH_COOLDOWN_ID);
    expect(flight.school).toBe('nature');
    expect(p.cooldowns.get(GALE_LAUNCH_COOLDOWN_ID)).toBe(GALE_LAUNCH_COOLDOWN);
    expect([p.vx, p.vz]).toEqual([0, 0]);
    // already flying, or inside the cooldown: no second flight replaces it
    updateGyreWind(p, host());
    expect(p.leap).toBe(flight);
    p.leap = null;
    updateGyreWind(p, host());
    expect(p.leap).toBeNull();
    p.cooldowns.set(GALE_LAUNCH_COOLDOWN_ID, 0);
    updateGyreWind(p, host());
    expect(p.leap).not.toBeNull();
  });

  it('throws a caster off their cast, as any shove does', () => {
    const pocket = GYRE_LAUNCH_POCKETS[2];
    const p = stub(pocket.x, pocket.y, pocket.z, { castingAbility: 'fireball' } as Partial<Entity>);
    const h = host();
    updateGyreWind(p, h);
    expect(h.cancelCast).toHaveBeenCalledTimes(1);
    expect(h.cancelCast).toHaveBeenCalledWith(p);
    expect(p.leap).not.toBeNull();
  });

  it('throws a caster standing in a lane off their cast too, and a sitter to their feet', () => {
    const lane = GYRE_WIND_LANES[3];
    const mid = gyrePathPoint((lane.t0 + lane.t1) / 2);
    const caster = stub(mid.x, mid.y, mid.z, { castingAbility: 'fireball' } as Partial<Entity>);
    const spy = host();
    updateGyreWind(caster, spy);
    expect(spy.cancelCast).toHaveBeenCalledTimes(1);
    expect(spy.cancelCast).toHaveBeenCalledWith(caster);
    expect(spy.standUp).not.toHaveBeenCalled();
    const sitter = stub(mid.x, mid.y, mid.z, { sitting: true } as Partial<Entity>);
    const seat = host();
    updateGyreWind(sitter, seat);
    expect(seat.standUp).toHaveBeenCalledTimes(1);
    expect(seat.standUp).toHaveBeenCalledWith(sitter);
    expect(seat.cancelCast).not.toHaveBeenCalled();
    // off every lane the wind touches neither
    const gap = gyrePathPoint((lane.t1 + GYRE_WIND_LANES[4].t0) / 2);
    const idle = stub(gap.x, gap.y, gap.z, {
      castingAbility: 'fireball',
      sitting: true,
    } as Partial<Entity>);
    const none = host();
    updateGyreWind(idle, none);
    expect(none.cancelCast).not.toHaveBeenCalled();
    expect(none.standUp).not.toHaveBeenCalled();
  });

  it('lifts a mounted rider, and catches a hop over the opening, but not a body high above it', () => {
    const pocket = GYRE_LAUNCH_POCKETS[0];
    const rider = stub(pocket.x, pocket.y, pocket.z, {
      mountKey: 'horse',
      ridingTier: 1,
    } as Partial<Entity>);
    updateGyreWind(rider, host());
    expect(rider.leap?.to).toEqual(pocket.landing);
    const hop = stub(pocket.x, pocket.y + 1.2, pocket.z, {
      onGround: false,
      jumping: true,
      vy: 3,
    } as Partial<Entity>);
    updateGyreWind(hop, host());
    expect(hop.leap?.from.y).toBeCloseTo(pocket.y + 1.2, 9);
    expect(hop.leap?.to).toEqual(pocket.landing);
    const high = stub(pocket.x, pocket.y + 4, pocket.z, { onGround: false });
    updateGyreWind(high, host());
    expect(high.leap).toBeNull();
  });

  it('never lifts the dead, the carried, a body thrown by a knockback or one a scripted mover drives', () => {
    const pocket = GYRE_LAUNCH_POCKETS[0];
    for (const extra of [
      { dead: true },
      { carriedBy: 3 },
      { onGround: false, launchedBy: { sourceId: 3, ticksLeft: 10 } },
      { leap: {} },
      { climb: {} },
      { valkyrsCalling: {} },
      { chargeTargetId: 5 },
      { followTargetId: 5 },
    ] as unknown as Partial<Entity>[]) {
      const p = stub(pocket.x, pocket.y, pocket.z, extra);
      const before = p.leap;
      updateGyreWind(p, host());
      expect(p.leap, JSON.stringify(extra)).toBe(before);
      expect(p.cooldowns.has(GALE_LAUNCH_COOLDOWN_ID), JSON.stringify(extra)).toBe(false);
    }
  });

  it('never touches a world other than the built-in one', () => {
    const lane = GYRE_WIND_LANES[3];
    const mid = gyrePathPoint((lane.t0 + lane.t1) / 2);
    const pocket = GYRE_LAUNCH_POCKETS[0];
    const builtin = getActiveWorldContent();
    // a copy of the content is a custom world (an editor play-test, an RL map)
    setActiveWorldContent({ ...builtin });
    try {
      const runner = stub(mid.x, mid.y, mid.z);
      updateGyreWind(runner, host());
      expect(runner.auras).toEqual([]);
      expect([runner.vx, runner.vz]).toEqual([0, 0]);
      const jumper = stub(pocket.x, pocket.y, pocket.z);
      updateGyreWind(jumper, host());
      expect(jumper.leap).toBeNull();
    } finally {
      setActiveWorldContent(null);
    }
    const back = stub(mid.x, mid.y, mid.z);
    updateGyreWind(back, host());
    expect(back.auras).toHaveLength(1);
  });
});

// ---- the live Sim ------------------------------------------------------------------------------------

function livePlayer(x: number, z: number, y: number) {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(60);
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = y;
  p.prevPos = { ...p.pos };
  p.fallStartY = y;
  p.onGround = true;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  const meta = sim.players.get(p.id);
  if (!meta) throw new Error('no meta');
  return { sim, p, meta };
}

describe('the ride on the live Sim', () => {
  it('carries a body standing still in a lane up the whole climb, on the road, to the crown', () => {
    const c = centre(GYRE_WIND_LANES[0].yd0 + 1);
    const { sim, p } = livePlayer(c.x, c.z, c.y);
    const hp0 = p.hp;
    let furthest = 0;
    let widest = 0;
    let fastest = 0;
    let lifted = false;
    let secondsToTop = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 40 / DT; i++) {
      sim.tick();
      if (p.leap) lifted = true;
      const at = gyrePathAt(p.pos.x, p.pos.z);
      expect(at, `tick ${i} at ${p.pos.x.toFixed(1)}, ${p.pos.z.toFixed(1)}`).not.toBeNull();
      if (!at) break;
      widest = Math.max(widest, Math.abs(at.off));
      fastest = Math.max(fastest, Math.hypot(p.vx, p.vz));
      const yd = gyreYardsAtT(at.t);
      furthest = Math.max(furthest, yd);
      if (yd >= GYRE_PATH_YARDS - 15 && secondsToTop === Number.POSITIVE_INFINITY) {
        secondsToTop = i * DT;
      }
    }
    // never left the road, never thrown off by a pocket, never hurt
    expect(widest).toBeLessThan(2);
    expect(lifted).toBe(false);
    expect(p.hp).toBe(hp0);
    // all the way up the climb, in well under half a minute: twenty yards a second
    expect(furthest).toBeGreaterThan(GYRE_PATH_YARDS - 15);
    expect(secondsToTop).toBeLessThan(26);
    // at three times the run and never faster
    expect(fastest).toBeGreaterThan(CEILING - 0.5);
    expect(fastest).toBeLessThan(CEILING + 0.01);
  }, 60_000);

  it('gets a standing start to speed in about a second', () => {
    const c = centre(GYRE_WIND_LANES[2].yd0 + 1);
    const { sim, p } = livePlayer(c.x, c.z, c.y);
    for (let i = 0; i < 1 / DT; i++) sim.tick();
    expect(Math.hypot(p.vx, p.vz)).toBeGreaterThan(CEILING * 0.75);
  });

  it('lets the keys walk a body back down the climb against the wind, with the camera turned down it', () => {
    const c = centre(GYRE_WIND_LANES[5].yd0 + 4);
    const b = centre(GYRE_WIND_LANES[5].yd0 - 6);
    const { sim, p, meta } = livePlayer(c.x, c.z, c.y);
    p.facing = Math.atan2(b.x - c.x, b.z - c.z);
    meta.moveInput.forward = true;
    const startYd = gyreYardsAtT(gyrePathAt(p.pos.x, p.pos.z)?.t ?? 0);
    for (let i = 0; i < 3 / DT; i++) sim.tick();
    const at = gyrePathAt(p.pos.x, p.pos.z);
    expect(at).not.toBeNull();
    // down the climb by a good way in three seconds, which no push up could allow
    expect(startYd - gyreYardsAtT(at?.t ?? 0)).toBeGreaterThan(12);
  });

  it('builds no speed past the last lane however long a key is held', () => {
    const last = GYRE_WIND_LANES[GYRE_WIND_LANES.length - 1];
    const c = centre(last.yd1 + 0.5);
    const { sim, p, meta } = livePlayer(c.x, c.z, c.y);
    p.facing = Math.atan2(c.frame.tx, c.frame.tz);
    meta.moveInput.forward = true;
    p.auras.push(laneAuraOf(GALE_LANE_LINGER));
    const eased = CEILING * galeStrengthAtYards(c.frame.yards);
    p.vx = c.frame.tx * eased;
    p.vz = c.frame.tz * eased;
    let fastest = 0;
    for (let i = 0; i < 2 / DT; i++) {
      const x = p.pos.x;
      const z = p.pos.z;
      sim.tick();
      fastest = Math.max(fastest, Math.hypot(p.pos.x - x, p.pos.z - z) / DT);
    }
    // the kernel's own step may add one tick of the grip to the held speed, no more
    expect(fastest).toBeGreaterThan(RUN_SPEED * 0.9);
    expect(fastest).toBeLessThan(eased + GALE_LANE_GRIP * DT + 0.1);
  });

  it('keeps a hop at speed to the road on a tight bend, instead of flying the tangent off the face', () => {
    const radius = (l: (typeof GYRE_WIND_LANES)[number]) => {
      const m = gyrePathPoint((l.t0 + l.t1) / 2);
      return Math.hypot(m.x - GYRE_PEAK.x, m.z - GYRE_PEAK.z);
    };
    const lane = [...GYRE_WIND_LANES].sort(
      (a, b) => Math.abs(radius(a) - 20) - Math.abs(radius(b) - 20),
    )[0];
    const c = centre(lane.yd0 + 2);
    const { sim, p, meta } = livePlayer(c.x, c.z, c.y);
    p.facing = Math.atan2(c.frame.tx, c.frame.tz);
    p.auras.push(laneAuraOf(GALE_LANE_LINGER));
    p.vx = c.frame.tx * CEILING;
    p.vz = c.frame.tz * CEILING;
    const hp0 = p.hp;
    meta.moveInput.jump = true;
    let airborne = 0;
    let widest = 0;
    for (let i = 0; i < 2 / DT; i++) {
      sim.tick();
      meta.moveInput.jump = false;
      if (!p.onGround) airborne++;
      const at = gyrePathAt(p.pos.x, p.pos.z);
      expect(at, `tick ${i} at ${p.pos.x.toFixed(1)}, ${p.pos.z.toFixed(1)}`).not.toBeNull();
      if (!at) break;
      widest = Math.max(widest, Math.abs(at.off));
    }
    // it did hop, stayed on the road the whole way, and came down unhurt
    expect(airborne).toBeGreaterThan(8);
    expect(widest).toBeLessThan(2.5);
    expect(p.hp).toBe(hp0);
  });

  it('carries a mounted rider up to the ride speed, and never slows it below a horse pace on the last stretch', () => {
    const c = centre(GYRE_WIND_LANES[2].yd0 + 1);
    const { sim, p } = livePlayer(c.x, c.z, c.y);
    p.mountKey = 'valorsteed';
    p.ridingTier = 1;
    const horse = RUN_SPEED * moveSpeedMult(p);
    expect(horse).toBeGreaterThan(CEILING * GALE_TAPER_END);
    for (let i = 0; i < 1 / DT; i++) sim.tick();
    expect(p.mountKey).toBe('valorsteed');
    expect(Math.hypot(p.vx, p.vz)).toBeGreaterThan(CEILING * 0.75);
    // the last lane, where the gale's own push has eased under a horse's pace: forward held, the
    // horse keeps its own speed
    const last = GYRE_WIND_LANES[GYRE_WIND_LANES.length - 1];
    const top = centre(last.yd0 + 2);
    const rider = livePlayer(top.x, top.z, top.y);
    rider.p.mountKey = 'valorsteed';
    rider.p.ridingTier = 1;
    rider.p.facing = Math.atan2(top.frame.tx, top.frame.tz);
    // already riding the gale at a horse's pace, as it would be coming up the lane below
    rider.p.auras.push(laneAuraOf(GALE_LANE_LINGER));
    rider.p.vx = top.frame.tx * horse;
    rider.p.vz = top.frame.tz * horse;
    rider.meta.moveInput.forward = true;
    let slowest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 0.8 / DT; i++) {
      const x = rider.p.pos.x;
      const z = rider.p.pos.z;
      rider.sim.tick();
      slowest = Math.min(slowest, Math.hypot(rider.p.pos.x - x, rider.p.pos.z - z) / DT);
    }
    expect(slowest).toBeGreaterThan(horse - 0.5);
  });

  it('stops a rider the moment a stun lands, instead of coasting on the ride speed', () => {
    const c = centre(GYRE_WIND_LANES[5].yd0 + 6);
    const { sim, p, meta } = livePlayer(c.x, c.z, c.y);
    for (let i = 0; i < 1.5 / DT; i++) sim.tick();
    expect(Math.hypot(p.vx, p.vz)).toBeGreaterThan(CEILING * 0.8);
    p.auras.push(auraOf('stun'));
    // the keys cannot steer a stunned body either
    meta.moveInput.forward = true;
    meta.moveInput.strafeLeft = true;
    const x0 = p.pos.x;
    const z0 = p.pos.z;
    for (let i = 0; i < 2 / DT; i++) sim.tick();
    // at most the one tick of the kernel's own slide before the hold takes it
    expect(Math.hypot(p.pos.x - x0, p.pos.z - z0)).toBeLessThan(1.5);
    expect([p.vx, p.vz]).toEqual([0, 0]);
  });

  it('is online-safe: the lane is a slide the client stands its prediction down for', () => {
    const c = centre(GYRE_WIND_LANES[3].yd0 + 3);
    const { sim, p, meta } = livePlayer(c.x, c.z, c.y);
    const session: MovementOverrideSessionState = {
      pid: sim.playerId,
      movementWireVersion: 2,
      ...createMovementOverrideSessionState(),
    };
    updateMovementOverrideEpochs(sim, [session]);
    const e0 = session.movementOverrideEpoch;
    sim.tick();
    updateMovementOverrideEpochs(sim, [session]);
    expect(session.movementOverrideSignature?.slippery).toBe(true);
    expect(session.movementOverrideActive).toBe(true);
    expect(session.movementOverrideEpoch).toBeGreaterThan(e0);
    expect(overrideActive(computeOverrideSignature(p, meta, sim.moveSpeedMult(p)))).toBe(true);
  });
});

describe('the lift on the live Sim', () => {
  const landed = (sim: Sim, p: Entity): number => {
    let ticks = 0;
    // up to the flight's end and a little past it
    for (let i = 0; i < 4 / DT; i++) {
      sim.tick();
      ticks++;
      if (p.leap == null && ticks > 3) break;
    }
    return ticks;
  };

  it.each(GYRE_LAUNCH_POCKETS.map((pk, i) => [i, pk] as const))(
    'carries a body from pocket %i to its touchdown, unhurt, and sets it on the ground there',
    (_i, pocket) => {
      const { sim, p } = livePlayer(pocket.x, pocket.z, pocket.y);
      const hp0 = p.hp;
      sim.tick();
      expect(p.leap, 'lifted at once').not.toBeNull();
      let airborne = 0;
      let crest = p.pos.y;
      for (let i = 0; i < 4 / DT; i++) {
        sim.tick();
        if (!p.onGround) airborne++;
        crest = Math.max(crest, p.pos.y);
        if (p.leap == null) break;
      }
      expect(airborne, 'in the air for the flight').toBeGreaterThan((pocket.duration / DT) * 0.8);
      expect(p.leap).toBeNull();
      expect(p.onGround).toBe(true);
      expect(p.jumping).toBe(false);
      expect(p.hp, 'a soft landing').toBe(hp0);
      expect(p.dead).toBe(false);
      expect(Math.hypot(p.pos.x - pocket.landing.x, p.pos.z - pocket.landing.z)).toBeLessThan(0.05);
      expect(p.pos.y).toBeCloseTo(pocket.landing.y, 1);
      // up and over: the crest of the arc stands well above the pad, above the touchdown too
      expect(crest).toBeGreaterThan(Math.max(pocket.y, pocket.landing.y) + 4);
    },
    60_000,
  );

  it('catches a body that drifts to the edge at speed, and sets it on the next turn up', () => {
    const pocket = GYRE_LAUNCH_POCKETS[0];
    const start = centre(pocket.yd - 24);
    const along = centre(pocket.yd - 22).frame;
    const { sim, p, meta } = livePlayer(start.x, start.z, start.y);
    // the camera along the road, the strafe key toward the drop
    p.facing = Math.atan2(along.tx, along.tz);
    meta.moveInput.strafeLeft = true;
    const hp0 = p.hp;
    let liftedAt: number | null = null;
    for (let i = 0; i < 8 / DT; i++) {
      sim.tick();
      if (p.leap && liftedAt === null) {
        liftedAt = gyreYardsAtT(gyrePathAt(p.pos.x, p.pos.z)?.t ?? 0);
      }
      if (liftedAt !== null && p.leap == null) break;
    }
    expect(liftedAt, 'lifted in the opening').not.toBeNull();
    expect(Math.abs((liftedAt ?? 0) - pocket.yd)).toBeLessThanOrEqual(GYRE_LAUNCH_HALF_YD + 1);
    expect(p.leap).toBeNull();
    expect(p.onGround).toBe(true);
    expect(p.hp).toBe(hp0);
    const at = gyrePathAt(p.pos.x, p.pos.z);
    expect(at?.t ?? 0).toBeCloseTo(pocket.t + TURN_T, 2);
    expect(p.pos.y).toBeGreaterThan(pocket.y + 12);
  }, 60_000);

  it('lifts nobody twice inside the cooldown, even standing where it landed them', () => {
    const pocket = GYRE_LAUNCH_POCKETS[0];
    const { sim, p } = livePlayer(pocket.x, pocket.z, pocket.y);
    landed(sim, p);
    expect(p.cooldowns.get(GALE_LAUNCH_COOLDOWN_ID) ?? 0).toBeGreaterThan(0);
    const [x, y, z] = [p.pos.x, p.pos.y, p.pos.z];
    // put the body back on a pad: the cooldown holds it
    p.pos.x = pocket.x;
    p.pos.y = pocket.y;
    p.pos.z = pocket.z;
    p.prevPos = { x: pocket.x, y: pocket.y, z: pocket.z };
    sim.tick();
    expect(p.leap).toBeNull();
    expect(x + y + z).not.toBeNaN();
  });
});
