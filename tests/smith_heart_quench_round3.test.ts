// The Guardian of the Quench's round-3 look as numbers: Tempering Strike's
// wind-up tell that reads from every angle (quench_strike_windup_core.ts), the
// strike's spikes rippling out behind the cracks (quench_strike_core.ts), and
// the Blades Wake's flare at her crown for close and low cameras
// (quench_wake_core.ts).

import { describe, expect, it } from 'vitest';
import { QUENCH_BODY_CLIP } from '../src/render/smith_heart_fx/quench_body_core';
import {
  QUENCH_STRIKE_CRACKS,
  QUENCH_STRIKE_RIPPLE,
  quenchStrikeSpikeDelay,
} from '../src/render/smith_heart_fx/quench_strike_core';
import {
  QUENCH_WINDUP,
  quenchWindupLook,
} from '../src/render/smith_heart_fx/quench_strike_windup_core';
import { QUENCH_WAKE_COLUMN } from '../src/render/smith_heart_fx/quench_wake_core';
import { QUENCH_TUNING as T } from '../src/sim/encounters/smith_heart';

describe('Tempering Strike: the wind-up tell', () => {
  it("builds over the sim's own lead, the ring closing on her and the arc frosting", () => {
    expect(QUENCH_WINDUP.lead).toBeCloseTo(T.strikeWindup, 9);
    const a = quenchWindupLook(0.05, 'pending', 0);
    const b = quenchWindupLook(0.6, 'pending', 0);
    const c = quenchWindupLook(0.98, 'pending', 0);
    expect(a.alpha).toBeGreaterThan(0);
    expect(c.alpha).toBe(1);
    // The ring closes in from its rim, never past her body.
    expect(a.ring).toBeGreaterThan(b.ring);
    expect(b.ring).toBeGreaterThan(c.ring);
    expect(c.ring).toBeGreaterThanOrEqual(QUENCH_WINDUP.ringClose - 1e-9);
    expect(c.ring * QUENCH_WINDUP.ringRadius).toBeGreaterThan(2);
    // The arc is fully frosted before the swing comes.
    expect(c.arc).toBeCloseTo(1, 5);
    expect(c.fist).toBeGreaterThan(a.fist);
    // It reaches past the cleave's own arc, so it reads from every side.
    expect(QUENCH_WINDUP.ringRadius).toBeGreaterThan(T.strikeRange);
  });

  it('holds through a late swing, then fades on its own at the hold', () => {
    expect(quenchWindupLook(1.3, 'pending', 0).alpha).toBe(1);
    expect(QUENCH_WINDUP.hold).toBeGreaterThan(QUENCH_WINDUP.lead);
    const late = quenchWindupLook(QUENCH_WINDUP.hold + QUENCH_WINDUP.fall * 0.5, 'pending', 0);
    expect(late.alpha).toBeGreaterThan(0);
    expect(late.alpha).toBeLessThan(1);
    expect(
      quenchWindupLook(QUENCH_WINDUP.hold + QUENCH_WINDUP.fall + 0.01, 'pending', 0).alpha,
    ).toBe(0);
  });

  it('ends on the outcome: a spent swing lets it fall, the slam bursts the fists', () => {
    // Ended 0.1 s ago, 1 s in.
    const spent = quenchWindupLook(1, 'spent', 0.1);
    const slam = quenchWindupLook(1, 'slam', 0.1);
    expect(spent.alpha).toBeLessThan(1);
    expect(spent.alpha).toBeGreaterThan(0);
    expect(slam.fist).toBeGreaterThan(spent.fist);
    expect(quenchWindupLook(1, 'spent', QUENCH_WINDUP.fall + 0.01).alpha).toBe(0);
    expect(quenchWindupLook(-0.1, 'pending', 0).alpha).toBe(0);
  });
});

describe('Tempering Strike: the cracks lead, the spikes follow', () => {
  it('raises the first spike only once the cracks are open, the far ones later', () => {
    expect(quenchStrikeSpikeDelay(0)).toBeGreaterThanOrEqual(QUENCH_STRIKE_CRACKS.open * 0.8);
    expect(quenchStrikeSpikeDelay(1)).toBeCloseTo(
      QUENCH_STRIKE_RIPPLE.lead + QUENCH_STRIKE_RIPPLE.sweep,
      9,
    );
    expect(quenchStrikeSpikeDelay(0.5)).toBeGreaterThan(quenchStrikeSpikeDelay(0.2));
    // Clamped past the reach.
    expect(quenchStrikeSpikeDelay(3)).toBe(quenchStrikeSpikeDelay(1));
    // The whole ripple lands within the cracks' hold.
    expect(quenchStrikeSpikeDelay(1)).toBeLessThan(QUENCH_STRIKE_CRACKS.hold);
    // And the slam from her raised fists lands a beat after the cleave.
    expect(QUENCH_BODY_CLIP.strikeSlam).toBeLessThan(0.2);
  });
});

describe('Blades Wake: the flare at her crown', () => {
  it('sits where the beam leaves her crown, wider than the beam', () => {
    expect(QUENCH_WAKE_COLUMN.crownHaloR).toBeGreaterThan(QUENCH_WAKE_COLUMN.coreR * 3);
    expect(QUENCH_WAKE_COLUMN.crownFlare).toBeGreaterThan(QUENCH_WAKE_COLUMN.coreR * 4);
  });
});
