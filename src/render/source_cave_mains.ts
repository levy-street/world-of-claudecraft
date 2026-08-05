// Thin Three applier for The Open Source's mains lighting. Owns the phase lookup
// and the scene writes; every decision lives in the pure core
// (source_cave_mains_core.ts). Cosmetic only: the sim never reads any of this.

import * as THREE from 'three';
import { isSourceCavePos } from '../sim/source_cave';
import type { IWorld } from '../world_api';
import {
  createSourceCaveMainsState,
  SOURCE_CAVE_AFTERMATH_FOG_COLOR,
  SOURCE_CAVE_BACKUP_FOG_COLOR,
  SOURCE_CAVE_MAINS_FOG_COLOR,
  type SourceCaveMainsAnchors,
  type SourceCaveMainsPhase,
  stepSourceCaveMains,
} from './source_cave_mains_core';

/** The shared delve ambience, plus the fog tint the core has no math for. */
export interface SourceCaveMainsBaseline extends SourceCaveMainsAnchors {
  fogColorHex: number;
}

export interface SourceCaveMainsTarget {
  hemi: THREE.HemisphereLight;
  scene: THREE.Scene;
  fog: THREE.Fog;
  /** Low tier keeps the fog half of the cue, so the state stays readable. */
  lowGfx: boolean;
}

export class SourceCaveMains {
  private readonly state = createSourceCaveMainsState();
  private readonly baseColor = new THREE.Color();
  private readonly caveColor = new THREE.Color();
  private readonly darkColor = new THREE.Color();
  private readonly mainsColor = new THREE.Color();

  update(
    world: IWorld,
    px: number,
    dt: number,
    baseline: SourceCaveMainsBaseline,
    target: SourceCaveMainsTarget,
  ): void {
    const inCave = isSourceCavePos(px);
    const levels = stepSourceCaveMains(
      this.state,
      { inCave, phase: inCave ? sealPhase(world) : 'mains', dt },
      baseline,
    );
    if (!levels) return;

    if (!target.lowGfx) {
      target.hemi.intensity = levels.hemi;
      target.scene.environmentIntensity = levels.env;
    }
    target.fog.far = levels.fogFar;
    // Dark end first (outage -> aftermath), then the lit blend, then how far
    // into the cave we are. `power` is 0 for the whole aftermath, so the two
    // dark tints never fight over the same frame.
    this.darkColor
      .setHex(SOURCE_CAVE_BACKUP_FOG_COLOR)
      .lerp(this.caveColor.setHex(SOURCE_CAVE_AFTERMATH_FOG_COLOR), levels.reach);
    this.darkColor.lerp(this.mainsColor.setHex(SOURCE_CAVE_MAINS_FOG_COLOR), levels.power);
    this.baseColor.setHex(baseline.fogColorHex).lerp(this.darkColor, levels.mix);
    target.fog.color.copy(this.baseColor);
  }
}

/**
 * The lighting follows the ENCOUNTER, not the button. It used to read the reboot
 * button's `lootable` flag, which only ever says "pressable" or "pressed": a
 * pressed button never unpresses, so a cleared room stayed in combat gloom
 * forever and the room had no way to say the fight was over.
 *
 * A missing cave or an online snapshot that has not shipped the info yet keeps
 * the hall lit, the same fail-soft the button lookup had: never flicker to
 * darkness on absent data.
 */
function sealPhase(world: IWorld): SourceCaveMainsPhase {
  const seal = world.sourceCaveInfo()?.sealState;
  if (seal === 'active' || seal === 'breached') return 'outage';
  if (seal === 'cleared') return 'aftermath';
  return 'mains';
}
