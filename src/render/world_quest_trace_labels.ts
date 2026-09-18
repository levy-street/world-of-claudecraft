// Social completion captions share the existing batched overhead surface and
// its bounded text cache. No extra DOM canvas, textures or player-name markup.
import * as THREE from 'three';
import { WORLD_QUESTS_BY_ID } from '../sim/data';
import type { WorldQuestDef } from '../sim/types';
import { groundHeight } from '../sim/world';
import { getI18nRevision } from '../ui/i18n';
import { worldQuestTraceRatingLabel } from '../ui/world_quest_trace_view';
import { createNameplateCanvasState, type NameplateCanvasSurface } from './nameplate_canvas';
import {
  isNameplateScreenAnchorVisible,
  isProjectedNameplateAnchorVisible,
} from './nameplate_projection';
import {
  newPublicTraceSlots,
  type PublicTraceReader,
  publicTraceSlotsInto,
} from './world_quest_public_trace_core';

export class WorldQuestTraceLabels {
  private readonly slots = newPublicTraceSlots();
  private readonly labels = this.slots.map(() => createNameplateCanvasState());
  private readonly ratings = this.slots.map(() => '');
  private readonly position = new THREE.Vector3();
  private readonly cameraSpace = new THREE.Vector3();
  private revision = -1;

  constructor(
    private readonly definitions: Readonly<Record<string, WorldQuestDef>> = WORLD_QUESTS_BY_ID,
  ) {}

  draw(
    world: PublicTraceReader & { cfg: { seed: number } },
    surface: Pick<NameplateCanvasSurface, 'drawBase'>,
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
  ): void {
    publicTraceSlotsInto(this.slots, world, this.definitions);
    const revision = getI18nRevision();
    const languageChanged = revision !== this.revision;
    this.revision = revision;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const trace = slot.trace;
      if (trace?.phase !== 'success') continue;
      this.position.set(slot.x, groundHeight(slot.x, slot.z, world.cfg.seed) + 2, slot.z);
      if (!isProjectedNameplateAnchorVisible(camera, this.position, this.cameraSpace)) continue;
      this.position.project(camera);
      if (this.position.z < -1 || this.position.z > 1) continue;
      const x = (this.position.x * 0.5 + 0.5) * width;
      const y = (-this.position.y * 0.5 + 0.5) * height;
      if (!isNameplateScreenAnchorVisible(x, y, width, height)) continue;
      const label = this.labels[i];
      if (languageChanged || label.name !== slot.name || this.ratings[i] !== trace.rating) {
        label.name = slot.name;
        label.title = worldQuestTraceRatingLabel(trace.rating);
        this.ratings[i] = trace.rating;
        label.nameColor = '#b8edff';
        label.initialized = true;
      }
      surface.drawBase(label, x, y);
    }
  }
}
