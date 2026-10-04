import { describe, expect, it } from 'vitest';
import { type CannonPuffBurst, CannonPuffBursts } from '../src/render/cannon_puff_burst_core';
import {
  CANNON_PUFF_STYLES,
  CANNON_SMOKE_OCCLUSION_MAX,
  cannonPuffInto,
  newCannonPuffFrame,
  PUFF,
} from '../src/render/cannon_puff_core';
import {
  newTurretContact,
  TURRET_CLOD_SPEED,
  TURRET_CONTACT_MAX_LAG,
  TURRET_CONTACT_PUFFS,
  type TurretContact,
  type TurretContactKind,
  turretContactBurstInto,
  turretContactCounts,
  turretContactLag,
  turretContactPower,
  turretContactScale,
  turretSlideTrailInto,
} from '../src/render/turret_contact_dust_core';
import { TURRET_SIZE_CLASSES } from '../src/sim/content/turret_defense';
import { DT } from '../src/sim/types';
import {
  occlusionTargets,
  smokeOcclusionPeak,
  TURRET_CAMERA_EYE,
} from './helpers/cannon_smoke_occlusion';

const flat = () => 0;
const full = turretContactCounts(false);
const low = turretContactCounts(true);

function burst(): CannonPuffBurst {
  return new CannonPuffBursts(1, TURRET_CONTACT_PUFFS).take(0) as CannonPuffBurst;
}

function contact(over: Partial<TurretContact> = {}): TurretContact {
  return Object.assign(newTurretContact(), {
    kind: 'bounce' as TurretContactKind,
    id: 4,
    seq: 9,
    x: 10,
    y: 0,
    z: -3,
    speed: 12,
    dirX: 1,
    dirZ: 0,
    height: TURRET_SIZE_CLASSES.small.height,
    radius: TURRET_SIZE_CLASSES.small.radius,
    ...over,
  });
}

function launched(c: TurretContact, counts = full): CannonPuffBurst {
  const b = burst();
  turretContactBurstInto(b, c, counts, flat);
  return b;
}

function ofKind(b: CannonPuffBurst, kind: number) {
  return b.puffs.slice(0, b.count).filter((p) => p.kind === kind);
}

/** The biggest a puff of the burst ever draws. */
function peakSize(b: CannonPuffBurst): number {
  let most = 0;
  for (const p of b.puffs.slice(0, b.count)) most = Math.max(most, p.size0, p.size1);
  return most;
}

describe('Fire and Fly contact dust power', () => {
  it('grows with the contact speed and the body size', () => {
    expect(turretContactPower(0)).toBe(0);
    expect(turretContactPower(8)).toBeGreaterThan(turretContactPower(4));
    expect(turretContactPower(60)).toBe(1);
    expect(turretContactScale(TURRET_SIZE_CLASSES.small.height)).toBe(1);
    expect(turretContactScale(TURRET_SIZE_CLASSES.huge.height)).toBeGreaterThan(2);
    expect(turretContactScale(Number.NaN)).toBe(1);
  });

  it('heaves far more dust under a yeti landing than under a wolf', () => {
    const wolf = launched(contact());
    const yeti = launched(contact({ height: TURRET_SIZE_CLASSES.huge.height, radius: 1.2 }));
    expect(peakSize(yeti)).toBeGreaterThan(2 * peakSize(wolf));
    expect(ofKind(yeti, PUFF.shock).length).toBeGreaterThanOrEqual(ofKind(wolf, PUFF.shock).length);
  });

  it('rolls a fuller ring out of a hard contact than a soft one', () => {
    const soft = launched(contact({ speed: 3 }));
    const hard = launched(contact({ speed: 16 }));
    expect(ofKind(hard, PUFF.shock).length).toBeGreaterThan(ofKind(soft, PUFF.shock).length);
    expect(peakSize(hard)).toBeGreaterThan(peakSize(soft));
    expect(ofKind(soft, PUFF.shock).length).toBeGreaterThan(0);
  });

  it('throws clods only from a contact at least as fast as the clod speed, never from a landing', () => {
    expect(ofKind(launched(contact({ speed: TURRET_CLOD_SPEED - 0.01 })), PUFF.dirt)).toHaveLength(
      0,
    );
    const hard = ofKind(launched(contact({ speed: TURRET_CLOD_SPEED })), PUFF.dirt);
    expect(hard.length).toBeGreaterThan(0);
    for (const clod of hard) {
      expect(clod.gravity).toBeGreaterThan(0);
      expect(clod.floorY).toBeGreaterThan(0);
    }
    expect(ofKind(launched(contact({ kind: 'land', speed: 30 })), PUFF.dirt)).toHaveLength(0);
    expect(
      ofKind(launched(contact({ kind: 'bowl', speed: 20 })), PUFF.dirt).length,
    ).toBeGreaterThan(0);
  });

  it('sheds bark chips and a puff at the trunk, behind the body as it rebounds', () => {
    const c = contact({
      kind: 'wall',
      speed: 14,
      dirX: 0,
      dirZ: 1,
      y: 0.5,
      height: 2,
      radius: 0.5,
    });
    const b = launched(c);
    const chips = ofKind(b, PUFF.bark);
    expect(chips.length).toBeGreaterThan(0);
    expect(ofKind(b, PUFF.shock)).toHaveLength(0);
    for (const chip of chips) {
      expect(chip.z).toBeCloseTo(c.z - c.radius, 9);
      expect(chip.y).toBeGreaterThan(c.y);
      // They fly out with the rebound, never back into the trunk.
      expect(chip.vz).toBeGreaterThan(0);
    }
    expect(CANNON_PUFF_STYLES[PUFF.bark].sprite).toBe(CANNON_PUFF_STYLES[PUFF.dirt].sprite);
  });

  it('launches no more puffs than a burst holds, deterministically, and lives until its last puff is spent', () => {
    for (const kind of ['bounce', 'land', 'wall', 'bowl'] as const) {
      const c = contact({ kind, speed: 40, height: 3.4, radius: 1.2 });
      const a = launched(c);
      const b = launched(c);
      expect(a.count).toBeLessThanOrEqual(TURRET_CONTACT_PUFFS);
      expect(a.count).toBeGreaterThan(0);
      expect(b.puffs.slice(0, b.count)).toEqual(a.puffs.slice(0, a.count));
      const frame = newCannonPuffFrame();
      for (const p of a.puffs.slice(0, a.count)) {
        expect(p.delay + p.life).toBeLessThanOrEqual(a.life + 1e-9);
        expect(cannonPuffInto(p, a.life, frame)).toBe(false);
      }
    }
    // Another contact of the same body draws another spread.
    const other = launched(contact({ seq: 10 }));
    expect(other.puffs[0].x).not.toBe(launched(contact()).puffs[0].x);
  });

  it('sheds cosmetic counts on the low preset without ever dropping the dust', () => {
    for (const key of ['ring', 'rise', 'clods', 'trail', 'chips'] as const) {
      expect(low[key]).toBeGreaterThan(0);
      expect(low[key]).toBeLessThanOrEqual(full[key]);
    }
    const c = contact({ speed: 16, height: 3 });
    expect(launched(c, low).count).toBeLessThan(launched(c, full).count);
    expect(launched(c, low).count).toBeGreaterThan(0);
  });

  it('never lets a landing hide more than the cap of the body in its dust, and no more on high', () => {
    // The body stands in its own dust: the worst of every contact kind, from
    // a settling hop to a yeti's hardest bounce, on each preset.
    const worst = (counts: typeof full): number => {
      let peak = 0;
      for (const kind of ['bounce', 'land', 'bowl', 'wall'] as const) {
        for (const size of [TURRET_SIZE_CLASSES.small, TURRET_SIZE_CLASSES.huge]) {
          for (const speed of [4, 9, 16]) {
            const c = contact({ kind, speed, x: 0, z: 18, dirX: 0, dirZ: 1, ...size });
            const b = launched(c, counts);
            const at = occlusionTargets(0, 18);
            peak = Math.max(
              peak,
              smokeOcclusionPeak(b.puffs, b.count, TURRET_CAMERA_EYE, at, b.life),
            );
          }
        }
      }
      return peak;
    };
    const high = worst(full);
    const lowest = worst(low);
    expect(high).toBeLessThanOrEqual(CANNON_SMOKE_OCCLUSION_MAX);
    expect(lowest).toBeLessThanOrEqual(CANNON_SMOKE_OCCLUSION_MAX);
    expect(high).toBeLessThanOrEqual(lowest);
    expect(high).toBeGreaterThan(0.1);
    // The dust a low preset keeps carries the puffs it sheds; the full set is as authored.
    const hard = contact({ speed: 16, ...TURRET_SIZE_CLASSES.huge });
    const kept = launched(hard, low);
    const ring = kept.puffs.slice(0, kept.count).filter((p) => p.kind === PUFF.shock);
    expect(ring.length).toBeGreaterThan(0);
    for (const p of ring) expect(p.alpha).toBeGreaterThan(1);
    const all = launched(hard, full);
    for (const p of all.puffs.slice(0, all.count)) expect(p.alpha).toBe(1);
  });

  it('ploughs a trail along the slide, each puff dropped as the body passes, sized by its speed', () => {
    const b = launched(contact({ kind: 'land', speed: 4 }));
    const before = b.count;
    const slide = {
      x: 10,
      y: 0,
      z: -3,
      vx: 12,
      vz: 0,
      decel: 25,
      start: 100,
      end: 100 + 0.44 / DT,
    };
    turretSlideTrailInto(b, slide, 1.2, 77, 100, full, flat);
    const trail = b.puffs.slice(before, b.count);
    expect(trail.length).toBeGreaterThan(1);
    expect(trail.length).toBeLessThanOrEqual(full.trail);
    const total = 12 * 0.44 - 0.5 * 25 * 0.44 * 0.44;
    let lastDelay = -1;
    for (const p of trail) {
      expect(p.kind).toBe(PUFF.shock);
      expect(p.x).toBeGreaterThan(10);
      expect(p.x).toBeLessThanOrEqual(10 + total + 0.2);
      expect(p.delay).toBeGreaterThan(lastDelay);
      lastDelay = p.delay;
      expect(p.delay + p.life).toBeLessThanOrEqual(b.life + 1e-9);
    }
    // The body slows along the slide: the dust it ploughs up shrinks with it.
    expect(trail[0].size1).toBeGreaterThan(trail[trail.length - 1].size1);
    // A contact seen late ages the trail too: its puffs start earlier.
    const late = launched(contact({ kind: 'land', speed: 4 }));
    turretSlideTrailInto(late, slide, 1.2, 77, 101, full, flat);
    expect(late.puffs[before].delay).toBeCloseTo(trail[0].delay - DT, 12);
    // No slide, no trail.
    const still = launched(contact({ kind: 'land', speed: 4 }));
    turretSlideTrailInto(still, { ...slide, vx: 0 }, 1.2, 77, 100, full, flat);
    expect(still.count).toBe(before);
  });

  it('ages a contact seen a frame late by that frame, never by more than the bound', () => {
    expect(turretContactLag(0)).toBe(0);
    expect(turretContactLag(-2)).toBe(0);
    expect(turretContactLag(1)).toBeCloseTo(DT, 12);
    expect(turretContactLag(50)).toBe(TURRET_CONTACT_MAX_LAG);
  });
});

describe('cannon puff bursts', () => {
  it('hands out free slots, then the one nearest its end, and retires spent ones', () => {
    const pool = new CannonPuffBursts(2, 3);
    expect(pool.capacity).toBe(6);
    const a = pool.take(0);
    const b = pool.take(0);
    if (!a || !b) throw new Error('slots expected');
    expect(a).not.toBe(b);
    expect(a.puffs).toHaveLength(3);
    a.life = 2;
    b.life = 1;
    // Full: the burst with the least left is reused.
    expect(pool.take(0.5)).toBe(b);
    b.life = 1;
    expect(pool.sweep(1.2)).toBe(true);
    expect(pool.sweep(2.5)).toBe(false);
    expect(pool.slots.every((s) => !s.active)).toBe(true);
    const c = pool.take(3);
    expect(c?.active).toBe(true);
    expect(c?.count).toBe(0);
    pool.clear();
    expect(pool.slots.every((s) => !s.active)).toBe(true);
    expect(new CannonPuffBursts(0, 4).take(0)).toBeNull();
  });
});
