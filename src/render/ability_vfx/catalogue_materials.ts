import type { AbilityVfxFullSpec } from '../ability_vfx_core';
import { materialResponsePlan } from './material_response_core';
import type { SeqPoint, SequencerHost } from './sequencer';

export function catalogueMaterialResponse(
  host: SequencerHost,
  id: string,
  spec: AbilityVfxFullSpec,
  at: SeqPoint,
  colour: number,
  accent: number,
  tier: number,
  dx: number,
  dz: number,
): number {
  const plan = materialResponsePlan(id, spec, tier);
  if (!plan.detail) return 0;
  const { x, y, z } = at;
  const floor = host.groundYAt(x, z) + 0.08;
  const { substance, size, repeated } = plan;
  const angle = Math.atan2(dx, dz);
  let count = 1;
  host.detailAt?.(
    x,
    y + 0.12,
    z,
    size * (repeated ? 0.65 : 1.15),
    colour,
    accent,
    substance,
    0.025,
    repeated ? 0.42 : 0.8,
  );
  if (plan.fragments && (substance === 'ice' || substance === 'earth')) {
    host.fragmentsAt?.(
      substance === 'ice' ? 'ice_shard' : 'metal_splinter',
      x,
      Math.max(floor + 0.2, y),
      z,
      substance === 'ice' ? 0xa3d4e0 : 0x9a8f7d,
      plan.fragments,
      repeated ? 0.42 : size * 0.65,
      dx,
      dz,
    );
    count++;
  }
  if (plan.volume) {
    host.bakedAt?.(
      'smoke',
      x,
      Math.max(floor + 0.75, y),
      z,
      2.2 * size,
      substance === 'fire' ? 0x735546 : 0x6a536c,
      accent,
      1.45,
      0.08,
      substance === 'fire' ? 0.55 : 0.06,
      angle,
    );
    count++;
  }
  if (plan.crest) {
    host.crestAt?.(
      x,
      floor,
      z,
      size * 0.78,
      plan.gentle ? 0.5 : 0.8,
      colour,
      accent,
      substance,
      angle,
    );
    count++;
  }
  if (plan.residue) {
    host.residueAt?.(x, z, 0.95 * size, colour, substance);
    count++;
  }
  return count;
}
