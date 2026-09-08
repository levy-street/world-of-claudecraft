import { describe, expect, it } from 'vitest';
import { materialResponsePlan } from '../src/render/ability_vfx/material_response_core';
import { SIGNATURE_ABILITIES } from '../src/render/ability_vfx/signature_core';
import { abilityVfxFullSpec } from '../src/render/ability_vfx_registry';
import { ABILITY_VFX_SPECS } from '../src/render/ability_vfx_specs';

describe('complete catalogue material response', () => {
  it('covers generated and bespoke specs while keeping repeated hits compact and lower tiers quiet', () => {
    const ids = Object.keys(ABILITY_VFX_SPECS);
    expect(ids.length).toBeGreaterThan(280);
    for (const id of ids) {
      const spec = abilityVfxFullSpec(id)!;
      expect(spec, id).toBeDefined();
      const plan = materialResponsePlan(id, spec, 0);
      expect(plan.detail, id).toBe(!SIGNATURE_ABILITIES[id]);
      expect(plan.fragments, id).toBeLessThanOrEqual(7);
      if (plan.repeated) {
        expect(plan.volume, id).toBe(false);
        expect(plan.crest, id).toBe(false);
      }
      if (plan.gentle) expect(plan.fragments, id).toBe(0);
      expect(materialResponsePlan(id, spec, 1).detail, id).toBe(false);
    }
  });
});
