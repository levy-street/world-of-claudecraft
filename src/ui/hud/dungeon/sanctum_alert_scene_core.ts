// The Gravewyrm Sanctum alert's scene: the bodies the alert reads that are not
// the local player (the three bosses, the Bonewalkers, the seal chain objects,
// the lake plates, the Plunging Fire warnings, the landing shadows, the
// Soulfire Trench lanes and the Ice Slabs). Pure and DOM-free: it walks the
// world's entities ONLY when the roster changed, keeps the references, and the
// view reads each live template off them (a plate cracking or a chain breaking
// changes its template id, not the roster). An Ice Slab is stamped with the
// clock it was first seen at (`now`, the caller's seconds), so its hint shows
// for its first moments only. The Sledge Tusker's road rides the same scan:
// the Tusker, the ice outcrops and the soulfire trails and patches; the clock
// its pull was first seen at is stamped every frame (a pull is not a roster
// change).

import {
  BONEWALKER_ID,
  isIceOutcrop,
  KORGATH_ID,
  KORZUL_ID,
  plateOf,
  SANCTUM_CHAIN_PREFIX,
  SANCTUM_LANDING_SHADOW,
  SANCTUM_PLATE_PREFIX,
  SANCTUM_PLUNGING_FIRE,
  SANCTUM_SOULFIRE_PATCH,
  SANCTUM_SOULFIRE_TRAIL,
  SANCTUM_TRENCH_LANE,
  SLEDGE_TUSKER_ID,
  VELKHAR_ID,
} from '../../../sim/encounters/gravewyrm_sanctum/ids';
import { SANCTUM_ICE_SLAB } from '../../../sim/mob/trash_kit/sanctum_cast_ids';
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
  private readonly slabs: SanctumSceneEntity[] = [];
  private readonly slabBorn: number[] = [];
  private readonly outcrops: SanctumSceneEntity[] = [];
  private readonly roadFires: SanctumSceneEntity[] = [];
  /** When each Ice Slab was first seen (entity id to the caller's clock). */
  private readonly slabSeen = new Map<number, number>();
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
    slabs: this.slabs,
    slabBorn: this.slabBorn,
    tusker: null,
    outcrops: this.outcrops,
    roadFires: this.roadFires,
    tuskerPulledAt: null,
  };

  /** The scene for this frame (the same object every frame). `now` is the
   *  caller's clock in seconds (the Ice Slabs' first sight). */
  update(world: SanctumSceneWorld, now = 0): SanctumAlertScene {
    if (world.entityRosterVersion !== this.version) this.rescan(world, now);
    // The Tusker's pull: stamped the frame it is first seen fighting.
    const tusker = this.scene.tusker;
    if (!tusker || tusker.dead || !tusker.inCombat) this.scene.tuskerPulledAt = null;
    else if (this.scene.tuskerPulledAt === null) this.scene.tuskerPulledAt = now;
    return this.scene;
  }

  private rescan(world: SanctumSceneWorld, now: number): void {
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
    this.slabs.length = 0;
    this.slabBorn.length = 0;
    this.scene.tusker = null;
    this.outcrops.length = 0;
    this.roadFires.length = 0;
    for (const e of world.entities.values()) {
      const id = e.templateId;
      if (e.kind === 'object') {
        if (id.startsWith(SANCTUM_CHAIN_PREFIX)) this.chains.push(e);
        else if (id.startsWith(SANCTUM_PLATE_PREFIX) && plateOf(id)) this.plates.push(e);
        else if (id === SANCTUM_PLUNGING_FIRE) this.fires.push(e);
        else if (id === SANCTUM_LANDING_SHADOW) this.shadows.push(e);
        else if (id === SANCTUM_TRENCH_LANE) this.trenches.push(e);
        else if (isIceOutcrop(id)) this.outcrops.push(e);
        else if (id === SANCTUM_SOULFIRE_TRAIL || id === SANCTUM_SOULFIRE_PATCH)
          this.roadFires.push(e);
        else if (id === SANCTUM_ICE_SLAB && e.id !== undefined) {
          const seen = this.slabSeen.get(e.id) ?? now;
          this.slabSeen.set(e.id, seen);
          this.slabs.push(e);
          this.slabBorn.push(seen);
        }
        continue;
      }
      if (id === KORGATH_ID) this.scene.korgath = pick(this.scene.korgath, e);
      else if (id === VELKHAR_ID) this.scene.velkhar = pick(this.scene.velkhar, e);
      else if (id === KORZUL_ID) this.scene.korzul = pick(this.scene.korzul, e);
      else if (id === BONEWALKER_ID) this.bonewalkers.push(e);
      else if (id === SLEDGE_TUSKER_ID) this.scene.tusker = pick(this.scene.tusker, e);
    }
    // Forget the slabs that shattered.
    if (this.slabSeen.size > this.slabs.length)
      for (const id of [...this.slabSeen.keys()])
        if (!this.slabs.some((s) => s.id === id)) this.slabSeen.delete(id);
  }
}
