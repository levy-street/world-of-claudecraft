import type { SolidImpactFragments } from '../../src/render/ability_vfx/solid_impact_fragments';

/** Exercise the real preparation units with a completed fake graphics driver. */
export async function prepareImpactFragments(pool: SolidImpactFragments): Promise<void> {
  const programs = new Map([
    ['canvas', { isReady: () => true, getUniforms: () => ({}), getAttributes: () => ({}) }],
  ]);
  for (const unit of pool.prewarmUnits({
    properties: { get: () => ({ programs }) },
    compile: async () => {},
    draw: () => {},
  }))
    await unit.run();
}
