import type * as THREE from 'three';
import type { AbilityVfxFullSpec } from '../ability_vfx_core';
import type { MoltenOrbProjectileOpts } from '../vfx';
import { type MagmaBurstPlan, magmaBurstPlan } from './magma_boulder_core';

// The Magma Burst cast read (the Shaman's lava_burst): the pooled Vfx
// projectile still does the flying and the arrival burst (it flies at the
// sim's projectile speed, so it lands on the damage tick), its head drawn as a
// molten halo, while a cracking volcanic boulder rides it, growing from a
// pebble to a boulder (magma_boulders.ts), and the ability's archetype
// sequence holds its impact stack for the arrival. The painter routes the ability's heavyBolt cue here and
// falls back to its generic arm when this returns false (the spam-floor tier,
// or a host whose particle cloud has no molten-orb head).

export const MAGMA_BURST_ABILITY = 'lava_burst';

export interface MagmaBurstPrimitives {
  moltenOrbProjectile?(
    sourceId: number,
    targetId: number,
    color?: number,
    opts?: MoltenOrbProjectileOpts,
  ): THREE.Vector3 | null | undefined;
}

export interface MagmaBurstFx {
  magmaBoulder(
    abilityId: string,
    spec: AbilityVfxFullSpec | undefined,
    sourceId: number,
    targetId: number,
    head: THREE.Vector3,
    plan: MagmaBurstPlan,
    colorHex: number,
    tier: number,
  ): number;
  magmaBoulderImpact(handle: number, at: THREE.Vector3): void;
  magmaBoulderLost(handle: number): void;
}

/** Play one Magma Burst; false when the caller should draw its fallback. */
export function playMagmaBurst(
  vfx: MagmaBurstPrimitives,
  fx: MagmaBurstFx,
  spec: AbilityVfxFullSpec | undefined,
  sourceId: number,
  targetId: number,
  color: number,
  tier: number,
  quality = 1,
): boolean {
  const plan = magmaBurstPlan(tier, quality);
  if (!plan || !vfx.moltenOrbProjectile) return false;
  let handle = -1;
  const head = vfx.moltenOrbProjectile(sourceId, targetId, color, {
    onImpact: (at) => fx.magmaBoulderImpact(handle, at),
    onLost: () => fx.magmaBoulderLost(handle),
  });
  // No head means the caster had no anchor: nothing was launched, and the
  // fallback would find no anchor either, so the cue is still handled.
  if (head)
    handle = fx.magmaBoulder(
      MAGMA_BURST_ABILITY,
      spec,
      sourceId,
      targetId,
      head,
      plan,
      color,
      tier,
    );
  return true;
}
