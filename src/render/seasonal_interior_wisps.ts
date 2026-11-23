// The indoor pumpkins' wisps (Gourdlight Eve): one faint, pale-green will-o'-wisp sprite
// over each candle-lit pumpkin inside the walk-in houses, drifting and breathing
// (seasonal_interior_wisps_core.ts). Cosmetic only. Built by the city decor view
// (seasonal_decor.ts) into its cities' groups, so the decor root's compile gate links the
// one shared sprite material with the rest of the kit and a city out of reach draws none.
import * as THREE from 'three';
import { wispPose } from './seasonal_interior_wisps_core';

export interface WispAnchor {
  x: number;
  y: number;
  z: number;
  scale: number;
}

function wispTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const mid = size / 2;
    const g = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    g.addColorStop(0, 'rgba(235,255,235,1)');
    g.addColorStop(0.18, 'rgba(160,255,180,0.8)');
    g.addColorStop(0.5, 'rgba(70,200,120,0.25)');
    g.addColorStop(1, 'rgba(30,120,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

export class SeasonalInteriorWisps {
  private readonly texture = wispTexture();
  private readonly material = new THREE.SpriteMaterial({
    map: this.texture ?? undefined,
    color: 0x9affb4,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  private readonly sprites: { sprite: THREE.Sprite; anchor: WispAnchor; phase: number }[] = [];

  /** One sprite per anchor, added to `group` (the anchor's city group). */
  build(group: THREE.Group, anchors: readonly WispAnchor[]): void {
    for (const anchor of anchors) {
      const sprite = new THREE.Sprite(this.material);
      sprite.name = 'seasonal-interior-wisp';
      sprite.position.set(anchor.x, anchor.y + 0.6, anchor.z);
      sprite.scale.setScalar(0.4);
      group.add(sprite);
      this.sprites.push({ sprite, anchor, phase: (this.sprites.length * 2.399) % 6.283 });
    }
  }

  /** Per frame while the event runs. The material's colour carries the shared breath. */
  update(time: number, reducedMotion: boolean): void {
    for (const w of this.sprites) {
      const a = w.anchor;
      const pose = wispPose(a.x, a.y, a.z, a.scale, time, w.phase, reducedMotion);
      w.sprite.position.set(pose.x, pose.y, pose.z);
      w.sprite.scale.setScalar(pose.size);
    }
    const breath = wispPose(0, 0, 0, 1, time, 0, reducedMotion).glow;
    this.material.color.setRGB(0.6 * breath, 1.0 * breath, 0.7 * breath);
  }

  dispose(): void {
    for (const w of this.sprites) w.sprite.removeFromParent();
    this.sprites.length = 0;
    this.material.dispose();
    this.texture?.dispose();
  }
}
