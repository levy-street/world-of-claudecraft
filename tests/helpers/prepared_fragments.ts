// A SolidImpactFragments pool built and prepared the way the Warrior kit
// recipe does it (build, compile, touch, bounded draw), over a host whose
// compile resolves at once and whose one program answers ready. For suites
// that exercise the burst itself, not its preparation.
import type * as THREE from 'three';
import { SolidImpactFragments } from '../../src/render/ability_vfx/solid_impact_fragments';

export async function preparedFragments(scene: THREE.Scene): Promise<SolidImpactFragments> {
  const pool = new SolidImpactFragments(scene);
  const program = { isReady: () => true, getUniforms: () => ({}), getAttributes: () => ({}) };
  const host = {
    properties: { get: () => ({ programs: new Map([['flat', program]]) }) },
    compile: async () => {},
    draw: () => {},
  };
  for (const unit of pool.units(host)) await unit.run();
  return pool;
}
