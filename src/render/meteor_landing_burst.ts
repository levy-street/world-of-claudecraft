// The one landing detonation every ground-warned meteor shares, lifted out of
// the renderer's MageGroundFx wiring: an authored cue (a boss cast with a VFX
// spec in ability_vfx/encounter_specs.ts, a mage Meteor) detonates through the
// spec-driven painter as an aimed 'nova' in the cue's own school; anything
// unclaimed (no ability, no spec) falls back to the pooled school-coloured
// burst on the terrain. The school rides the spawn so a shadow Grave Eruption
// never lands in fire; the legacy mage cue carries none and keeps fire.

import * as THREE from 'three';
import { groundHeight } from '../sim/world';
import type { AbilityVfxSpellfxAtEvent } from './ability_vfx/painter';
import type { MeteorFallSpawn } from './mage_ground_fx';

export interface MeteorLandingSpecPainter {
  handleSpellfxAt(ev: AbilityVfxSpellfxAtEvent): boolean;
}

export interface MeteorLandingBurstPool {
  burst(at: THREE.Vector3, school: string, count?: number, power?: number): void;
}

export const METEOR_LANDING_DEFAULT_SCHOOL = 'fire';
const LANDING_BURST_COUNT = 34;
const LANDING_BURST_POWER = 1.4;
const LANDING_BURST_LIFT = 0.4;

/** `seed` is the world seed for the terrain height sample under the landing.
 *  Returns which arm detonated, so a test can pin the routing without a scene. */
export function meteorLandingBurst(
  abilityVfx: MeteorLandingSpecPainter,
  vfx: MeteorLandingBurstPool,
  seed: number,
  x: number,
  z: number,
  spawn?: MeteorFallSpawn,
): 'spec' | 'burst' {
  const school = spawn?.school ?? METEOR_LANDING_DEFAULT_SCHOOL;
  if (
    spawn?.ability &&
    abilityVfx.handleSpellfxAt({
      x,
      z,
      school,
      fx: 'nova',
      radius: spawn.radius,
      sourceId: spawn.sourceId,
      ability: spawn.ability,
    })
  ) {
    return 'spec';
  }
  const gy = groundHeight(x, z, seed);
  vfx.burst(
    new THREE.Vector3(x, gy + LANDING_BURST_LIFT, z),
    school,
    LANDING_BURST_COUNT,
    LANDING_BURST_POWER,
  );
  return 'burst';
}
