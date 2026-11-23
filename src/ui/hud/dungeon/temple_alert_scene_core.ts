// The Drowned Temple alert's scene: the bodies of Choirmother Selthe's Score
// the alert reads that are not the local player (Selthe herself and the five
// moon tiles round her pool). Pure and DOM-free: it walks the world's entities
// ONLY when the roster changed, keeps the references, and the view reads each
// live template, bar and aura off them (a tile ringing, lighting or souring
// flips its template id, not the roster).

import { moonTileOf, SELTHE_ID } from '../../../sim/encounters/drowned_temple/ids';
import type { TempleAlertEntity, TempleAlertScene } from './temple_alert_view';

export interface TempleSceneEntity extends TempleAlertEntity {
  kind?: string;
  templateId: string;
}

export interface TempleSceneWorld {
  entities: ReadonlyMap<number, TempleSceneEntity>;
  entityRosterVersion: number;
}

export class TempleAlertSceneScan {
  private version = Number.NaN;
  private readonly tiles: TempleSceneEntity[] = [];
  private readonly scene: TempleAlertScene = { selthe: null, tiles: this.tiles };

  /** The scene for this frame (the same object every frame). */
  update(world: TempleSceneWorld): TempleAlertScene {
    if (world.entityRosterVersion === this.version) return this.scene;
    this.version = world.entityRosterVersion;
    this.scene.selthe = null;
    this.tiles.length = 0;
    for (const e of world.entities.values()) {
      if (e.kind === 'player') continue;
      if (e.kind === 'object') {
        if (moonTileOf(e.templateId)) this.tiles.push(e);
        continue;
      }
      // A living Selthe over a fallen one (a corpse can share the roster).
      if (e.templateId === SELTHE_ID && (!this.scene.selthe || this.scene.selthe.dead))
        this.scene.selthe = e;
    }
    return this.scene;
  }
}
