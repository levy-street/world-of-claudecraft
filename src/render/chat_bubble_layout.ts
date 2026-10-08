// Per-frame placement of the overhead chat bubbles, moved out of renderer.ts under the
// monolith ratchet. The renderer still owns the bubble map (creation, the ttl, the
// disposal sweep); this only expires stale bubbles and parks each live one over its
// speaker's head, or hides it when there is nothing drawable to anchor it to.

import * as THREE from 'three';
import type { Entity } from '../sim/types';
import {
  isProjectedNameplateAnchorVisible,
  nameplateScreenTransform,
} from './nameplate_projection';

export interface ChatBubble {
  el: HTMLDivElement;
  until: number;
}

/** The view fields a bubble reads: the drawn position, and the height it floats above. */
export interface ChatBubbleAnchorView {
  group: THREE.Object3D;
  height: number;
  mountLift: number;
}

const anchor = new THREE.Vector3();
const scratch = new THREE.Vector3();

export function layoutChatBubbles(
  bubbles: Map<number, ChatBubble>,
  entities: ReadonlyMap<number, Entity>,
  views: ReadonlyMap<number, ChatBubbleAnchorView>,
  camera: THREE.PerspectiveCamera,
  viewport: { width: number; height: number },
): void {
  if (bubbles.size === 0) return;
  const { width: w, height: h } = viewport;
  const now = performance.now();
  for (const [id, b] of bubbles) {
    const e = entities.get(id);
    const v = e ? views.get(id) : undefined;
    if (now >= b.until) {
      b.el.remove();
      bubbles.delete(id);
      continue;
    }
    if (!e || !v) {
      b.el.style.display = 'none';
      continue;
    }
    // culled rigs (beyond ENTITY_DRAW_RANGE) stop updating group.position,
    // so a yell from 80 to 100u away would hang frozen over empty terrain:
    // fall back to the live entity position when the rig isn't being drawn
    if (v.group.visible) anchor.copy(v.group.position);
    else anchor.set(e.pos.x, e.pos.y, e.pos.z);
    anchor.y += (v.height + v.mountLift) * e.scale + 1.0;
    if (!isProjectedNameplateAnchorVisible(camera, anchor, scratch)) {
      b.el.style.display = 'none';
      continue;
    }
    anchor.project(camera);
    if (anchor.z < -1 || anchor.z > 1) {
      b.el.style.display = 'none';
      continue;
    }
    b.el.style.display = '';
    const sx = (anchor.x * 0.5 + 0.5) * w;
    const sy = (-anchor.y * 0.5 + 0.5) * h;
    b.el.style.transform = nameplateScreenTransform(sx, sy);
  }
}
