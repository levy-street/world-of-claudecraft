// The Wildheart Basin alert's scene: the bodies of Zulgar's fight the alert
// reads that are not the local player (Zulgar himself, the six sun glyphs, a
// Hunting Spear standing in the terrace, the Idol's Breath over its half, and
// the players, so the Prey can be told when nobody else stands free to light),
// plus the Great Saurian and its rider's Sunbone Sap Totems.
// Pure and DOM-free: it walks the world's entities ONLY when the roster
// changed, keeps the references, and the view reads each live template and
// clock off them (a glyph catching light or the breath landing flips a
// template id, not the roster).

import {
  GREAT_SAURIAN_ID,
  HUNTING_SPEAR_ID,
  SAP_TOTEM_ID,
  WILDHEART_IDOL_BREATH,
  WILDHEART_IDOL_BREATH_WARNING,
  WILDHEART_SUN_GLYPH_DARK,
  WILDHEART_SUN_GLYPH_LIT,
  ZULGAR_ID,
} from '../../../sim/encounters/wildheart_basin/ids';
import type { WildheartAlertEntity, WildheartAlertScene } from './wildheart_alert_view';

export interface WildheartSceneEntity extends WildheartAlertEntity {
  kind?: string;
  templateId: string;
}

export interface WildheartSceneWorld {
  entities: ReadonlyMap<number, WildheartSceneEntity>;
  entityRosterVersion: number;
}

export class WildheartAlertSceneScan {
  private version = Number.NaN;
  private readonly glyphs: WildheartSceneEntity[] = [];
  private readonly spears: WildheartSceneEntity[] = [];
  private readonly breaths: WildheartSceneEntity[] = [];
  private readonly players: WildheartSceneEntity[] = [];
  private readonly sapTotems: WildheartSceneEntity[] = [];
  private readonly scene: WildheartAlertScene = {
    zulgar: null,
    glyphs: this.glyphs,
    spears: this.spears,
    breaths: this.breaths,
    players: this.players,
    saurian: null,
    sapTotems: this.sapTotems,
  };

  /** The scene for this frame (the same object every frame). */
  update(world: WildheartSceneWorld): WildheartAlertScene {
    if (world.entityRosterVersion === this.version) return this.scene;
    this.version = world.entityRosterVersion;
    this.scene.zulgar = null;
    this.glyphs.length = 0;
    this.spears.length = 0;
    this.breaths.length = 0;
    this.players.length = 0;
    this.scene.saurian = null;
    this.sapTotems.length = 0;
    for (const e of world.entities.values()) {
      const id = e.templateId;
      if (e.kind === 'player') {
        this.players.push(e);
        continue;
      }
      if (e.kind === 'object') {
        if (id === WILDHEART_SUN_GLYPH_DARK || id === WILDHEART_SUN_GLYPH_LIT) this.glyphs.push(e);
        else if (id === WILDHEART_IDOL_BREATH_WARNING || id === WILDHEART_IDOL_BREATH)
          this.breaths.push(e);
        continue;
      }
      if (id === HUNTING_SPEAR_ID) this.spears.push(e);
      else if (id === SAP_TOTEM_ID) this.sapTotems.push(e);
      // A living Saurian over a fallen one, as for Zulgar.
      else if (id === GREAT_SAURIAN_ID && (!this.scene.saurian || this.scene.saurian.dead))
        this.scene.saurian = e;
      // A living Zulgar over a fallen one (a corpse can share the roster).
      else if (id === ZULGAR_ID && (!this.scene.zulgar || this.scene.zulgar.dead))
        this.scene.zulgar = e;
    }
    return this.scene;
  }
}
