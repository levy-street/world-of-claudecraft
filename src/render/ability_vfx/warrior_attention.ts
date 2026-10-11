import * as THREE from 'three';
import { OVERLAY_CELL } from './fx_textures';
import type { OverlaySprites } from './overlay_sprites';
import type { RibbonAnchor } from './ribbons';
import { warriorAttentionCel } from './warrior_attention_core';

interface Attention {
  source: number;
  remaining: number;
  stamp: number;
  priority: boolean;
}
const CAPACITY = 32;

/** One sprite per controlled enemy in the existing overlay draw. It follows
 * live force state, never an independently invented three-second timer. */
export class WarriorAttention {
  private readonly states = new Map<number, Attention>();
  private readonly target = new THREE.Vector3();

  hold(id: number, source: number, remaining: number, frame: number, priority: boolean): void {
    if (!Number.isFinite(remaining) || remaining <= 0) return;
    let state = this.states.get(id);
    if (!state) {
      if (this.states.size >= CAPACITY) {
        if (!priority) return;
        let replaced = false;
        for (const [otherId, other] of this.states)
          if (!other.priority) {
            this.states.delete(otherId);
            replaced = true;
            break;
          }
        if (!replaced) return;
      }
      state = { source, remaining, stamp: frame, priority };
      this.states.set(id, state);
    } else {
      state.source = source;
      state.remaining = remaining;
      state.stamp = frame;
      state.priority = priority;
    }
  }

  draw(
    frame: number,
    reduced: boolean,
    anchor: RibbonAnchor,
    towardCamera: THREE.Vector3,
    overlay: OverlaySprites,
  ): void {
    for (const [id, state] of this.states) {
      if (state.stamp !== frame) {
        this.states.delete(id);
        continue;
      }
      if (!anchor(id, 0.82, this.target)) continue;
      // Normal depth testing remains enabled. A small camera-facing offset
      // puts the carved brow on the visible surface without hiding the face.
      this.target.addScaledVector(towardCamera, 0.85);
      overlay.push(
        this.target.x,
        this.target.y,
        this.target.z,
        0xffa875,
        1.18,
        OVERLAY_CELL.attention0 + warriorAttentionCel(state.remaining, reduced),
        Math.min(1, 0.6 + state.remaining * 2),
        1.45,
        1,
      );
    }
  }
  sleep(id: number): void {
    this.states.delete(id);
  }
  clear(): void {
    this.states.clear();
  }
}
