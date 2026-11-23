// The Hollow Crypt alert's scene: the bodies the alert reads that are not the
// local player (Morthen, the Knellwyrm, the Remembrance Candles, the Bound
// Souls in flight, the Grasp of the Grave rings and the Burning Knell's
// halves). Pure and DOM-free: it walks the world's entities ONLY when the
// roster changed, keeps the references, and the view reads each live template
// off them (a candle catching, a ring erupting or a marked half catching fire
// changes its template id, not the roster).

import {
  KNELL_HALF_FIRE_TEMPLATE,
  KNELL_HALF_MARK_TEMPLATE,
  KNELLWYRM_ID,
  MORTHEN_ID,
} from '../../../sim/encounters/hollow_crypt/ids';
import {
  isRiteCandleTemplate,
  MORTHEN_GRASP_HANDS_TEMPLATE,
  MORTHEN_GRASP_TEMPLATE,
  MORTHEN_SOUL_TEMPLATE,
} from '../../../sim/encounters/hollow_crypt/morthen_ids';
import type { CryptAlertEntity, CryptAlertScene } from './crypt_alert_view';

export interface CryptSceneEntity extends CryptAlertEntity {
  kind?: string;
  templateId: string;
}

export interface CryptSceneWorld {
  entities: ReadonlyMap<number, CryptSceneEntity>;
  entityRosterVersion: number;
}

/** A living boss over a fallen one (a corpse can share the roster). */
function pick(have: CryptAlertEntity | null, e: CryptSceneEntity): CryptAlertEntity {
  return have && !have.dead ? have : e;
}

export class CryptAlertSceneScan {
  private version = Number.NaN;
  private readonly candles: CryptSceneEntity[] = [];
  private readonly souls: CryptSceneEntity[] = [];
  private readonly grasps: CryptSceneEntity[] = [];
  private readonly halves: CryptSceneEntity[] = [];
  private readonly scene: CryptAlertScene = {
    morthen: null,
    knellwyrm: null,
    candles: this.candles,
    souls: this.souls,
    grasps: this.grasps,
    halves: this.halves,
  };

  /** The scene for this frame (the same object every frame). */
  update(world: CryptSceneWorld): CryptAlertScene {
    if (world.entityRosterVersion === this.version) return this.scene;
    this.version = world.entityRosterVersion;
    this.scene.morthen = null;
    this.scene.knellwyrm = null;
    this.candles.length = 0;
    this.souls.length = 0;
    this.grasps.length = 0;
    this.halves.length = 0;
    for (const e of world.entities.values()) {
      const id = e.templateId;
      if (e.kind === 'object') {
        if (isRiteCandleTemplate(id)) this.candles.push(e);
        else if (id === MORTHEN_SOUL_TEMPLATE) this.souls.push(e);
        else if (id === MORTHEN_GRASP_TEMPLATE || id === MORTHEN_GRASP_HANDS_TEMPLATE)
          this.grasps.push(e);
        else if (id === KNELL_HALF_MARK_TEMPLATE || id === KNELL_HALF_FIRE_TEMPLATE)
          this.halves.push(e);
        continue;
      }
      if (id === MORTHEN_ID) this.scene.morthen = pick(this.scene.morthen, e);
      else if (id === KNELLWYRM_ID) this.scene.knellwyrm = pick(this.scene.knellwyrm, e);
    }
    return this.scene;
  }
}
