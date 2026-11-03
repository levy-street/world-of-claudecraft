// The Hammer Council's boss-mechanic looks as numbers
// (src/render/smith_heart_fx/council_mechanic_look_core.ts): Bond of the
// Stone's tether is anchored on each member's real body and loops clear of the
// Singer's crown when they stand together (readable shoulder to shoulder), its
// light grows with the sim's own pulse multiplier and flares on a pulse; Mountain's Rush's wind-up and run read the sim's own tuning, and the
// scar it tears follows the body, cools and fades.

import { describe, expect, it } from 'vitest';
import {
  BOND_ARCH,
  BOND_BODY,
  type BondTetherLook,
  bondAnchorY,
  bondArch,
  bondArchPoint,
  bondSigil,
  bondTetherLook,
  RUSH_SCAR,
  RUSH_TRACE_SECONDS,
  rushPhase,
  rushScar,
} from '../src/render/smith_heart_fx/council_mechanic_look_core';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { COUNCIL_TUNING as T } from '../src/sim/encounters/smith_heart/council_ids';

const look = (): BondTetherLook => ({ core: 0, halo: 0, glow: 0, sigil: 0, flow: 0, flare: 0 });

describe('Bond of the Stone: the tether', () => {
  it("reads each member's real body: the Guardian towers over the Singer", () => {
    expect(BOND_BODY.guardian.height).toBeCloseTo(
      3.4 * (SMITH_HEART_MOBS.heart_hammer_guardian?.scale ?? 0),
      6,
    );
    expect(BOND_BODY.guardian.height).toBeGreaterThan(BOND_BODY.singer.height * 1.5);
    for (const role of ['guardian', 'singer'] as const) {
      expect(bondAnchorY(role)).toBeGreaterThan(BOND_BODY[role].height * 0.5);
      expect(bondAnchorY(role)).toBeLessThan(BOND_BODY[role].height);
      expect(bondSigil(role).column).toBeGreaterThan(BOND_BODY[role].height);
    }
    expect(bondSigil('guardian').radius).toBeGreaterThan(bondSigil('singer').radius);
  });

  it("standing together it loops clear of the Singer's crown; apart it eases to a shallow arc", () => {
    const ay = bondAnchorY('guardian');
    const by = bondAnchorY('singer');
    const p = { x: 0, y: 0, z: 0 };
    for (const span of [0, 2, BOND_ARCH.near]) {
      const rise = bondArch(span);
      expect(rise).toBe(BOND_ARCH.close);
      bondArchPoint(0.5, span, by - ay, 0, rise, p);
      expect(ay + p.y).toBeGreaterThan(BOND_BODY.singer.height + 1.5);
    }
    expect(bondArch(BOND_ARCH.far)).toBeCloseTo(BOND_ARCH.apart, 9);
    expect(bondArch(40)).toBeCloseTo(BOND_ARCH.apart, 9);
    expect(BOND_ARCH.apart).toBeGreaterThan(1.5);
    // Easing down monotonically as they part.
    let last = Number.POSITIVE_INFINITY;
    for (let span = 0; span <= 20; span += 1) {
      const r = bondArch(span);
      expect(r).toBeLessThanOrEqual(last + 1e-9);
      last = r;
    }
  });

  it("is anchored on both members' chests", () => {
    const p = { x: 0, y: 0, z: 0 };
    expect(bondArchPoint(0, 8, -0.8, 3, 4, p)).toEqual({ x: 0, y: 0, z: 0 });
    bondArchPoint(1, 8, -0.8, 3, 4, p);
    expect(p.x).toBeCloseTo(8, 9);
    expect(p.y).toBeCloseTo(-0.8, 9);
    expect(p.z).toBeCloseTo(3, 9);
    // Its middle sits `rise` over the line between them.
    bondArchPoint(0.5, 8, -0.8, 3, 4, p);
    expect(p.y).toBeCloseTo(-0.4 + 4, 9);
  });

  it('is thick enough to read from a raid camera, grows with the pulses and flares on one', () => {
    const settled = bondTetherLook(99, 1, 0, look());
    expect(settled.core).toBeGreaterThanOrEqual(0.4);
    expect(settled.halo).toBeGreaterThan(settled.core * 2.5);
    const grown = bondTetherLook(99, 12, 0, look());
    expect(grown.core).toBeGreaterThan(settled.core);
    expect(grown.glow).toBeGreaterThan(settled.glow);
    expect(grown.flow).toBeGreaterThan(settled.flow);
    const flared = bondTetherLook(0, 1, 0, look());
    expect(flared.flare).toBe(1);
    expect(flared.core).toBeGreaterThan(settled.core);
    expect(flared.sigil).toBeGreaterThan(settled.sigil);
    expect(bondTetherLook(0.7, 1, 0, look()).flare).toBe(0);
    const out = look();
    expect(bondTetherLook(1, 1, 0, out)).toBe(out);
  });
});

describe("Mountain's Rush: the wind-up, the run and the scar", () => {
  it("phases off the sim's own wind-up", () => {
    const o = { phase: 'over' as const as 'windup' | 'run' | 'over', k: 0 };
    expect(rushPhase(0, 1, o).phase).toBe('windup');
    expect(rushPhase(T.rushWindup / 2, 1, o)).toEqual({ phase: 'windup', k: 0.5 });
    expect(rushPhase(T.rushWindup + 0.25, 1, o)).toEqual({ phase: 'run', k: 0.25 });
    expect(rushPhase(T.rushWindup + 1.01, 1, o).phase).toBe('over');
  });

  it('tears the scar behind the body, then cools and fades it', () => {
    const o = { reveal: 0, heat: 0, fade: 0 };
    expect(rushScar(T.rushWindup * 0.5, 1, o).reveal).toBe(0);
    rushScar(T.rushWindup + 0.5, 1, o);
    expect(o.reveal).toBeCloseTo(0.5, 9);
    expect(o.heat).toBe(1);
    expect(o.fade).toBe(1);
    rushScar(T.rushWindup + 1 + RUSH_SCAR.hold, 1, o);
    expect(o.reveal).toBe(1);
    expect(o.heat).toBe(0);
    expect(o.fade).toBe(1);
    rushScar(T.rushWindup + 1 + RUSH_TRACE_SECONDS, 1, o);
    expect(o.fade).toBe(0);
  });
});
