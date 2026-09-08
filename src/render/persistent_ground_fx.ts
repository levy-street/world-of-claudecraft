import type * as THREE from 'three';
import { AbyssalRiftFx } from './abyssal_rift_fx';
import { HunterTrapVisuals } from './hunter_trap_visual';
import { NecromancyArmyPortalFx } from './necromancy_army_portal_fx';
import { NecromancyGroundFx } from './necromancy_ground_fx';
import { RingOfFrostVisuals } from './ring_of_frost_visual';

/** World-bound persistent class effects share the renderer's terrain sampler. */
export function createPersistentGroundFx(
  scene: THREE.Scene,
  groundY: (x: number, z: number) => number,
) {
  return {
    necromancyGroundFx: new NecromancyGroundFx(scene, groundY),
    necromancyArmyPortalFx: new NecromancyArmyPortalFx(scene, groundY),
    abyssalRiftFx: new AbyssalRiftFx(scene, groundY),
    ringOfFrostVisuals: new RingOfFrostVisuals(scene, groundY),
    hunterTrapVisuals: new HunterTrapVisuals(scene, groundY),
  };
}
