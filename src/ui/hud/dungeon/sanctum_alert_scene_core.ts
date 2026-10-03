// The Gravewyrm Sanctum alert's scene: the bodies the alert reads that are not
// the local player (the three bosses, the Bonewalkers, the seal chain objects,
// the lake plates, the Plunging Fire warnings, the landing shadows and the
// Soulfire Trench lanes). Pure and DOM-free: it walks the world's entities
// ONLY when the roster changed, keeps the references, and the view reads each
// live template off them (a plate cracking or a chain breaking changes its
// template id, not the roster).

import {
  BONEWALKER_ID,
  KORGATH_ID,
  KORZUL_ID,
  plateOf,
  SANCTUM_CHAIN_PREFIX,
  SANCTUM_LANDING_SHADOW,
  SANCTUM_PLATE_PREFIX,
  SANCTUM_PLUNGING_FIRE,
  SANCTUM_TRENCH_LANE,
  VELKHAR_ID,
} from '../../../sim/encounters/gravewyrm_sanctum/ids';
import type { SanctumAlertEntity, SanctumAlertScene } from './sanctum_alert_view';

export interface SanctumSceneEntity extends SanctumAlertEntity {
  kind?: string;
  templateId: string;
}

export interface SanctumSceneWorld {
  entities: ReadonlyMap<number, SanctumSceneEntity>;
  entityRosterVersion: number;
}

/** A living boss over a fallen one (a corpse can share the roster). */
function pick(have: SanctumAlertEntity | null, e: SanctumSceneEntity): SanctumAlertEntity {
  return have && !have.dead ? have : e;
}

export class SanctumAlertSceneScan {
  private version = Number.NaN;
  private readonly chains: SanctumSceneEntity[] = [];
  private readonly plates: SanctumSceneEntity[] = [];
  private readonly fires: SanctumSceneEntity[] = [];
  private readonly shadows: SanctumSceneEntity[] = [];
  private readonly trenches: SanctumSceneEntity[] = [];
  private readonly bonewalkers: SanctumSceneEntity[] = [];
  private readonly scene: SanctumAlertScene = {
    korgath: null,
    velkhar: null,
    korzul: null,
    chains: this.chains,
    plates: this.plates,
    fires: this.fires,
    shadows: this.shadows,
    trenches: this.trenches,
    bonewalkers: this.bonewalkers,
  };

  /** The scene for this frame (the same object every frame). */
  update(world: SanctumSceneWorld): SanctumAlertScene {
    if (world.entityRosterVersion === this.version) return this.scene;
    this.version = world.entityRosterVersion;
    this.scene.korgath = null;
    this.scene.velkhar = null;
    this.scene.korzul = null;
    this.chains.length = 0;
    this.plates.length = 0;
    this.fires.length = 0;
    this.shadows.length = 0;
    this.trenches.length = 0;
    this.bonewalkers.length = 0;
    for (const e of world.entities.values()) {
      const id = e.templateId;
      if (e.kind === 'object') {
        if (id.startsWith(SANCTUM_CHAIN_PREFIX)) this.chains.push(e);
        else if (id.startsWith(SANCTUM_PLATE_PREFIX) && plateOf(id)) this.plates.push(e);
        else if (id === SANCTUM_PLUNGING_FIRE) this.fires.push(e);
        else if (id === SANCTUM_LANDING_SHADOW) this.shadows.push(e);
        else if (id === SANCTUM_TRENCH_LANE) this.trenches.push(e);
        continue;
      }
      if (id === KORGATH_ID) this.scene.korgath = pick(this.scene.korgath, e);
      else if (id === VELKHAR_ID) this.scene.velkhar = pick(this.scene.velkhar, e);
      else if (id === KORZUL_ID) this.scene.korzul = pick(this.scene.korzul, e);
      else if (id === BONEWALKER_ID) this.bonewalkers.push(e);
    }
    return this.scene;
  }
}
