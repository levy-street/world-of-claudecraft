import type * as THREE from 'three';
import type { AbilityVfxFullSpec } from '../ability_vfx_core';
import type { LightningProjectileOpts } from '../vfx';
import { type MagmaBurstPlan, magmaBurstPlan } from './magma_braid_core';

// The Magma Burst cast read (the Shaman's lava_burst): the pooled Vfx
// projectile still does the flying and the arrival burst (it flies at the
// sim's projectile speed, so it lands on the damage tick), drawn with its
// molten-orb head, while three molten strands ride it from the caster's hand
// (magma_braid.ts) and the ability's archetype sequence holds its impact stack
// for the arrival. The painter routes the ability's heavyBolt cue here and
// falls back to its generic arm when this returns false (the spam-floor tier,
// or a host whose particle cloud has no molten-orb head).

export const MAGMA_BURST_ABILITY = 'lava_burst';

export interface MagmaBurstPrimitives {
  moltenOrbProjectile?(
    sourceId: number,
    targetId: number,
    color?: number,
    opts?: Omit<LightningProjectileOpts, 'tip'>,
  ): THREE.Vector3 | null | undefined;
}

export interface MagmaBurstFx {
  magmaBraid(
    abilityId: string,
    spec: AbilityVfxFullSpec | undefined,
    sourceId: number,
    targetId: number,
    head: THREE.Vector3,
    plan: MagmaBurstPlan,
    colorHex: number,
    tier: number,
  ): number;
  magmaBraidImpact(handle: number, at: THREE.Vector3): void;
  magmaBraidLost(handle: number): void;
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
    onImpact: (at) => fx.magmaBraidImpact(handle, at),
    onLost: () => fx.magmaBraidLost(handle),
  });
  // No head means the caster had no anchor: nothing was launched, and the
  // fallback would find no anchor either, so the cue is still handled.
  if (head)
    handle = fx.magmaBraid(MAGMA_BURST_ABILITY, spec, sourceId, targetId, head, plan, color, tier);
  return true;
}
