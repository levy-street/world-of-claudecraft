import { describe, expect, it } from 'vitest';
import {
  createUmbralAnchorVfxPlan,
  UMBRAL_ANCHOR_PLACE_SECONDS,
  UMBRAL_ANCHOR_RECALL_SECONDS,
  writeUmbralAnchorVfxPlan,
} from '../src/render/umbral_anchor_vfx_core';

describe('Umbral Anchor VFX plan', () => {
  it('pins the authored ceremony timings', () => {
    expect(UMBRAL_ANCHOR_PLACE_SECONDS).toBe(0.72);
    expect(UMBRAL_ANCHOR_RECALL_SECONDS).toBe(0.58);
  });

  it('keeps hidden and completed recall phases out of the scene', () => {
    const plan = createUmbralAnchorVfxPlan();

    writeUmbralAnchorVfxPlan(plan, 'hidden', 0, 0, false);
    expect(plan.visible).toBe(false);

    writeUmbralAnchorVfxPlan(
      plan,
      'recalling',
      UMBRAL_ANCHOR_RECALL_SECONDS,
      UMBRAL_ANCHOR_RECALL_SECONDS,
      false,
    );
    expect(plan.visible).toBe(false);
    expect(plan.opacity).toBe(0);
  });

  it('keeps recall visible until its exact authored boundary', () => {
    const plan = createUmbralAnchorVfxPlan();

    writeUmbralAnchorVfxPlan(plan, 'recalling', 0.579, 8, false);
    expect(plan.visible).toBe(true);

    writeUmbralAnchorVfxPlan(plan, 'recalling', 0.58, 8, false);
    expect(plan.visible).toBe(false);
  });

  it('grows the placement ceremony into a fully readable anchor', () => {
    const plan = createUmbralAnchorVfxPlan();

    writeUmbralAnchorVfxPlan(plan, 'placing', 0, 12, false);
    const startScale = plan.scale;
    expect(plan.visible).toBe(true);
    expect(plan.opacity).toBe(0);

    writeUmbralAnchorVfxPlan(plan, 'placing', UMBRAL_ANCHOR_PLACE_SECONDS * 0.65, 12.4, false);
    expect(plan.opacity).toBeGreaterThan(0.95);
    expect(plan.scale).toBeGreaterThan(startScale);
    expect(plan.columnScale).toBeGreaterThan(0.8);
  });

  it('makes recall an accelerating implosion instead of an instant disappearance', () => {
    const plan = createUmbralAnchorVfxPlan();

    writeUmbralAnchorVfxPlan(plan, 'recalling', UMBRAL_ANCHOR_RECALL_SECONDS * 0.7, 3, false);

    expect(plan.visible).toBe(true);
    expect(plan.scale).toBeLessThan(0.8);
    expect(plan.columnScale).toBeGreaterThan(1);
    expect(plan.shardLift).toBeGreaterThan(1);
    expect(Math.abs(plan.runeRotation)).toBeGreaterThan(1);
  });

  it('removes perpetual movement when reduced motion is enabled', () => {
    const plan = createUmbralAnchorVfxPlan();

    writeUmbralAnchorVfxPlan(plan, 'active', 4, 99, true);

    expect(plan.visible).toBe(true);
    expect(plan.scale).toBe(1);
    expect(plan.groundRotation).toBe(0);
    expect(plan.runeRotation).toBe(0);
    expect(plan.wispSpin).toBe(0);
    expect(plan.wispRise).toBe(0.5);
  });

  it('is deterministic for the same phase and injected time', () => {
    const first = createUmbralAnchorVfxPlan();
    const second = createUmbralAnchorVfxPlan();

    writeUmbralAnchorVfxPlan(first, 'active', 7, 31.25, false);
    writeUmbralAnchorVfxPlan(second, 'active', 7, 31.25, false);

    expect(second).toEqual(first);
  });
});
