// Thin Three applier for The Open Source's mains-to-backup lighting. Owns the
// button lookup and the scene writes; every decision lives in the pure core
// (source_cave_mains_core.ts). Cosmetic only: the sim never reads any of this.

import * as THREE from 'three';
import { isSourceCavePos, SOURCE_CAVE_REBOOT_TEMPLATE } from '../sim/source_cave';
import type { IWorld } from '../world_api';
import {
  createSourceCaveMainsState,
  SOURCE_CAVE_BACKUP_FOG_COLOR,
  SOURCE_CAVE_MAINS_FOG_COLOR,
  type SourceCaveMainsAnchors,
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
  // Cached so the per-frame power check is a map get, not an entity scan;
  // re-scanned only when the cached id stops resolving (fresh claim, or
  // interest churn online).
  private buttonId: number | null = null;
  private readonly baseColor = new THREE.Color();
  private readonly caveColor = new THREE.Color();
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
      { inCave, powered: inCave ? this.buttonPowered(world) : true, dt },
      baseline,
    );
    if (!levels) return;

    if (!target.lowGfx) {
      target.hemi.intensity = levels.hemi;
      target.scene.environmentIntensity = levels.env;
    }
    target.fog.far = levels.fogFar;
    this.caveColor
      .setHex(SOURCE_CAVE_BACKUP_FOG_COLOR)
      .lerp(this.mainsColor.setHex(SOURCE_CAVE_MAINS_FOG_COLOR), levels.power);
    this.baseColor.setHex(baseline.fogColorHex).lerp(this.caveColor, levels.mix);
    target.fog.color.copy(this.baseColor);
  }

  /** An unresolved button (an online snapshot gap) keeps the hall lit rather
   *  than flickering to backup on missing data. */
  private buttonPowered(world: IWorld): boolean {
    const cached = this.buttonId !== null ? world.entities.get(this.buttonId) : undefined;
    if (cached?.templateId === SOURCE_CAVE_REBOOT_TEMPLATE) return cached.lootable;
    this.buttonId = null;
    for (const e of world.entities.values()) {
      if (e.kind === 'object' && e.templateId === SOURCE_CAVE_REBOOT_TEMPLATE) {
        this.buttonId = e.id;
        return e.lootable;
      }
    }
    return true;
  }
}
