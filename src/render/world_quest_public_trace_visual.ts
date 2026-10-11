// Four fixed social trail slots. Blue only, never a remote guide or gold path.
import * as THREE from 'three';
import { WORLD_QUESTS_BY_ID } from '../sim/data';
import type { WorldQuestDef, WorldQuestTraceDef } from '../sim/types';
import { PUBLIC_WORLD_QUEST_TRACE_TAIL } from '../sim/world_quest_trace_public';
import {
  newPublicTraceSlots,
  type PublicTraceReader,
  publicTraceSlotsInto,
  publicTraceTrailChangedInto,
} from './world_quest_public_trace_core';
import { writeTraceRibbon } from './world_quest_trace_core';
import { traceRibbonGeometry, worldQuestTraceMaterials } from './world_quest_trace_materials';

export class WorldQuestPublicTraceVisual {
  readonly group = new THREE.Group();
  private readonly slots = newPublicTraceSlots();
  private readonly views = this.slots.map(() => {
    const trail = new THREE.Mesh(traceRibbonGeometry(512), worldQuestTraceMaterials().publicBlue);
    const pulse = new THREE.Mesh(
      traceRibbonGeometry(1024),
      worldQuestTraceMaterials().completionBlue,
    );
    for (const mesh of [trail, pulse]) {
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      mesh.userData.renderCategory = 'ui3d';
      this.group.add(mesh);
    }
    trail.name = 'public-calligraphy-trail';
    pulse.name = 'public-calligraphy-completion';
    return {
      trail,
      pulse,
      count: -1,
      samples: new Float64Array(PUBLIC_WORLD_QUEST_TRACE_TAIL * 2),
      shape: null as WorldQuestTraceDef | null,
    };
  });

  constructor(
    parent: THREE.Object3D,
    private readonly groundAt: (x: number, z: number) => number,
    private readonly definitions: Readonly<Record<string, WorldQuestDef>> = WORLD_QUESTS_BY_ID,
  ) {
    this.group.name = 'public-calligraphy';
    parent.add(this.group);
    // Parent attaches this preconstructed subtree through its entry compile gate.
  }

  update(world: PublicTraceReader): void {
    publicTraceSlotsInto(this.slots, world, this.definitions);
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const view = this.views[i];
      const trace = slot.trace;
      view.trail.visible = !!trace;
      view.pulse.visible = trace?.phase === 'success';
      if (!trace || !slot.shape) {
        view.count = -1;
        view.shape = null;
        view.trail.geometry.setDrawRange(0, 0);
        view.pulse.geometry.setDrawRange(0, 0);
        continue;
      }
      if (publicTraceTrailChangedInto(view.samples, view.count, trace.trail)) {
        const attribute = view.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
        view.trail.geometry.setDrawRange(
          0,
          writeTraceRibbon(attribute.array as Float32Array, trace.trail, 0.22, 0.12, this.groundAt),
        );
        attribute.needsUpdate = true;
        view.count = trace.trail.length;
      }
      if (view.shape !== slot.shape) {
        const attribute = view.pulse.geometry.getAttribute('position') as THREE.BufferAttribute;
        view.pulse.geometry.setDrawRange(
          0,
          writeTraceRibbon(
            attribute.array as Float32Array,
            slot.shape.points,
            0.6,
            0.14,
            this.groundAt,
          ),
        );
        attribute.needsUpdate = true;
        view.shape = slot.shape;
      }
    }
  }
}
