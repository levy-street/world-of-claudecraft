import * as THREE from 'three';
import type { IWorld } from '../world_api';
import { hasVisibleHuntersMark } from './hunter_mark_marker_core';

const TARGET_SIZE = 64;
const TARGET_BASE_Y = 0.65;
const TARGET_BOB = 0.08;

function targetTexture(): THREE.DataTexture {
  const data = new Uint8Array(TARGET_SIZE * TARGET_SIZE * 4);
  const center = (TARGET_SIZE - 1) / 2;
  for (let y = 0; y < TARGET_SIZE; y++) {
    for (let x = 0; x < TARGET_SIZE; x++) {
      const dx = x - center;
      const dy = y - center;
      const radius = Math.hypot(dx, dy);
      const ring = (radius >= 22 && radius <= 27) || (radius >= 10 && radius <= 14);
      const centerDot = radius <= 4;
      const crosshair =
        (Math.abs(dx) <= 1.5 && radius >= 28 && radius <= 31) ||
        (Math.abs(dy) <= 1.5 && radius >= 28 && radius <= 31);
      if (!ring && !centerDot && !crosshair) continue;
      const offset = (y * TARGET_SIZE + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 28;
      data[offset + 2] = 24;
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, TARGET_SIZE, TARGET_SIZE, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

interface HunterMarkHostView {
  group: THREE.Group;
  height: number;
}

interface MarkerEntry {
  sprite: THREE.Sprite;
  group: THREE.Group;
  phase: number;
}

/** Floating red bullseyes driven solely by replicated Hunter's Mark auras. */
export class HunterMarkMarkers {
  private readonly markers = new Map<number, MarkerEntry>();
  private readonly material = new THREE.SpriteMaterial({
    map: targetTexture(),
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });

  update(world: IWorld, views: ReadonlyMap<number, HunterMarkHostView>): void {
    for (const [id, entry] of this.markers) {
      const entity = world.entities.get(id);
      const view = views.get(id);
      if (!entity || !view || view.group !== entry.group || !hasVisibleHuntersMark(entity)) {
        entry.sprite.removeFromParent();
        this.markers.delete(id);
      }
    }

    for (const entity of world.entities.values()) {
      if (!hasVisibleHuntersMark(entity) || this.markers.has(entity.id)) continue;
      const view = views.get(entity.id);
      if (!view) continue;
      const sprite = new THREE.Sprite(this.material);
      sprite.name = 'hunters-mark-bullseye';
      view.group.add(sprite);
      this.markers.set(entity.id, {
        sprite,
        group: view.group,
        phase: (entity.id % 9) * 0.65,
      });
    }

    const time = performance.now() / 1000;
    for (const [id, entry] of this.markers) {
      const entity = world.entities.get(id);
      const view = views.get(id);
      if (!entity || !view) continue;
      // The marker is parented to a group that is already scaled by entity.scale.
      // Counter-scale the fixed head gap and sprite so the world-space diana stays
      // correctly sized, and recompute every frame for live scale changes.
      const hostScale = Math.max(0.01, entity.scale);
      const bob = Math.sin((time + entry.phase) * Math.PI * 2) * TARGET_BOB;
      entry.sprite.position.y = view.height + (TARGET_BASE_Y + bob) / hostScale;
      const pulse = 0.9 + Math.sin((time + entry.phase) * Math.PI * 3) * 0.06;
      entry.sprite.scale.set(pulse / hostScale, pulse / hostScale, 1);
    }
  }

  clear(): void {
    for (const entry of this.markers.values()) entry.sprite.removeFromParent();
    this.markers.clear();
  }
}
