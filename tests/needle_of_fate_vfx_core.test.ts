import { describe, expect, it } from 'vitest';
import {
  createNeedleFlightPlan,
  createNeedleImpactPlan,
  createNeedleReleasePlan,
  createNeedleWindupPlan,
  isNeedleOfFateProjectile,
  NEEDLE_OF_FATE_IMPACT_SECONDS,
  NEEDLE_OF_FATE_MAX_FLIGHT,
  NEEDLE_OF_FATE_REACH,
  NEEDLE_OF_FATE_RELEASE_SECONDS,
  NEEDLE_OF_FATE_SPEED,
  writeNeedleFlightPlan,
  writeNeedleImpactPlan,
  writeNeedleReleasePlan,
  writeNeedleWindupPlan,
} from '../src/render/needle_of_fate_vfx_core';
import {
  PROJECTILE_MAX_FLIGHT,
  PROJECTILE_REACH,
  PROJECTILE_SPEED,
} from '../src/sim/projectile_travel';

describe('Needle of Fate VFX plans', () => {
  it('pins travel speed to the authoritative projectile speed', () => {
    expect(NEEDLE_OF_FATE_SPEED).toBe(26);
    expect(NEEDLE_OF_FATE_SPEED).toBe(PROJECTILE_SPEED);
    expect(NEEDLE_OF_FATE_REACH).toBe(0.7);
    expect(NEEDLE_OF_FATE_REACH).toBe(PROJECTILE_REACH);
    expect(NEEDLE_OF_FATE_MAX_FLIGHT).toBe(3);
    expect(NEEDLE_OF_FATE_MAX_FLIGHT).toBe(PROJECTILE_MAX_FLIGHT);
    expect(NEEDLE_OF_FATE_IMPACT_SECONDS).toBe(0.9);
    expect(NEEDLE_OF_FATE_RELEASE_SECONDS).toBe(0.34);
  });

  it('builds a rune-and-eye windup across the authored cast time', () => {
    const plan = createNeedleWindupPlan();

    writeNeedleWindupPlan(plan, 0.75, 1.5, false);

    expect(plan.visible).toBe(true);
    expect(plan.progress).toBe(0.5);
    expect(plan.opacity).toBeGreaterThan(0.9);
    expect(plan.eyeScale).toBeGreaterThan(1);
    expect(plan.orbit).toBeGreaterThan(0);
    expect(plan.runeLift).toBeGreaterThan(0);

    writeNeedleWindupPlan(plan, 0.75, 1.5, true);
    expect(plan.opacity).toBe(1);
    expect(plan.eyeScale).toBe(1.18);
    expect(plan.orbit).toBe(0);
    expect(plan.runeLift).toBe(0);
    expect(plan.pulse).toBe(1);

    writeNeedleWindupPlan(plan, 2, 1.5, false);
    expect(plan.visible).toBe(true);
    expect(plan.progress).toBe(1);
  });

  it('opens a hot release ring and closes it at the exact boundary', () => {
    const plan = createNeedleReleasePlan();

    writeNeedleReleasePlan(plan, 0.1, false);
    expect(plan.visible).toBe(true);
    expect(plan.opacity).toBeGreaterThan(0.5);
    expect(plan.ringScale).toBeGreaterThan(1);

    writeNeedleReleasePlan(plan, 0.1, true);
    expect(plan.rotation).toBe(0);
    expect(plan.ringScale).toBe(1.35);

    writeNeedleReleasePlan(plan, NEEDLE_OF_FATE_RELEASE_SECONDS, false);
    expect(plan.visible).toBe(false);
    expect(plan.opacity).toBe(0);
  });

  it('routes only Needle projectile spell events to the dedicated painter', () => {
    expect(isNeedleOfFateProjectile({ fx: 'projectile', ability: 'needle_of_fate' })).toBe(true);
    expect(isNeedleOfFateProjectile({ fx: 'projectile' })).toBe(false);
    expect(isNeedleOfFateProjectile({ fx: 'beam', ability: 'needle_of_fate' })).toBe(false);
    expect(isNeedleOfFateProjectile({ fx: 'projectile', ability: 'soul_harvest' })).toBe(false);
  });

  it('never travels past the target during a frame', () => {
    const plan = createNeedleFlightPlan();

    writeNeedleFlightPlan(plan, 0.4, 1 / 20, 0.3, false);

    expect(plan.step).toBe(0.4);
    expect(plan.spin).toBeGreaterThan(0);
    expect(plan.glow).toBeGreaterThanOrEqual(0.8);
    expect(plan.glow).toBeLessThanOrEqual(1.2);
    expect(plan.distortion).toBeGreaterThan(0);
    expect(plan.coil).toBeGreaterThan(0);
  });

  it('freezes cosmetic spin under reduced motion without removing travel', () => {
    const plan = createNeedleFlightPlan();

    writeNeedleFlightPlan(plan, 10, 1 / 20, 2, true);

    expect(plan.step).toBeCloseTo(NEEDLE_OF_FATE_SPEED / 20, 8);
    expect(plan.spin).toBe(0);
    expect(plan.glow).toBe(1);
    expect(plan.distortion).toBe(0);
    expect(plan.coil).toBe(0);
  });

  it('builds a short eye-shaped impact that closes at its exact boundary', () => {
    const plan = createNeedleImpactPlan();

    writeNeedleImpactPlan(plan, 0, false);
    expect(plan.visible).toBe(true);
    expect(plan.opacity).toBe(0);

    writeNeedleImpactPlan(plan, NEEDLE_OF_FATE_IMPACT_SECONDS * 0.45, false);
    expect(plan.visible).toBe(true);
    expect(plan.opacity).toBeGreaterThan(0.8);
    expect(plan.scale).toBeGreaterThan(1);
    expect(plan.shockwaveOpacity).toBeGreaterThan(0);
    expect(plan.shockwaveScale).toBeGreaterThan(1);
    expect(plan.sparkDistance).toBeGreaterThan(0);
    expect(plan.pillarOpacity).toBeGreaterThan(0);

    writeNeedleImpactPlan(plan, NEEDLE_OF_FATE_IMPACT_SECONDS * 0.45, true);
    expect(plan.scale).toBe(1);
    expect(plan.irisScale).toBe(1);
    expect(plan.rotation).toBe(0);
    expect(plan.shockwaveScale).toBe(2.4);
    expect(plan.sparkDistance).toBe(0.9);

    writeNeedleImpactPlan(plan, NEEDLE_OF_FATE_IMPACT_SECONDS, false);
    expect(plan.visible).toBe(false);
    expect(plan.opacity).toBe(0);
  });

  it('is deterministic for injected time', () => {
    const first = createNeedleImpactPlan();
    const second = createNeedleImpactPlan();

    writeNeedleImpactPlan(first, 0.27, false);
    writeNeedleImpactPlan(second, 0.27, false);

    expect(second).toEqual(first);
  });
});
