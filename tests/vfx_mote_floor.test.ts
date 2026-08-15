import { describe, expect, it } from 'vitest';
import { MOTE_QUALITY_GATE } from '../src/render/ability_vfx/fx';
import { GFX_BUCKET_BANDS, GFX_BUDGETS } from '../src/render/gfx';
import { RenderBudgetGovernor } from '../src/render/render_budget';

// The buff-swirl motes are gated on the governed vfx level, so a tier whose
// vfx floor drops to the gate or under would silently lose them at full
// degradation with every other suite green (the phase 5 ledger recorded the
// 0.08 margin as an unguarded cheap coverage candidate; this is that guard).
// Decoration-only shed either way (the swirl's orb and star core draw below
// the gate), so this is a visual-continuity pin, not a fairness one.

const TIERS = ['low', 'medium', 'high', 'ultra', 'insane'] as const;

describe('vfx floors clear the mote quality gate', () => {
  it('pins the gate constant itself', () => {
    expect(MOTE_QUALITY_GATE).toBe(0.5);
  });

  it.each(TIERS)('keeps the %s band vfx minimum above the gate', (tier) => {
    expect(GFX_BUCKET_BANDS[tier].vfx.min).toBeGreaterThan(MOTE_QUALITY_GATE);
  });

  it.each(TIERS)('keeps the %s governor vfx floor above the gate', (tier) => {
    const caps = new RenderBudgetGovernor({
      tier,
      budget: GFX_BUDGETS[tier],
      enabled: true,
    }).state().caps;
    expect(caps.minVfxLevel).toBeGreaterThan(MOTE_QUALITY_GATE);
  });
});
