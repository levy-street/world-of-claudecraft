// The camera UNDER THE WORLD on an authored map, moved out of renderer.ts:
// everything that is not the ground's own black back face is masked for the
// draw, so the void reads as solid black instead of a sky seen from below
// (SPACEY, 2026-09-19: "i want the under world to be completely black without
// effectin performance"). While it holds, the frame draws LESS (no sky, water,
// vista). The built-in world never masks (the renderer skips update there).

import * as THREE from 'three';
import { cameraUnderWorld } from './underworld_core';

const UNDERWORLD_BLACK = new THREE.Color(0x000000);

export class UnderworldMask {
  /** The last update's verdict; the present step masks while it holds. */
  active = false;
  private readonly hidden: THREE.Object3D[] = [];
  private background: THREE.Scene['background'] = null;

  constructor(private readonly scene: THREE.Scene) {}

  update(cam: THREE.Vector3, seed: number, inBell: boolean): void {
    this.active = cameraUnderWorld(cam.x, cam.y, cam.z, seed, inBell);
  }

  /** Hide everything but the lights (hiding one changes the lighting hash and
   *  recompiles programs): sky, water, assets and the Studio's own overlays
   *  all read as "the world seen from below", and the ground is black anyway. */
  mask(): void {
    const hidden = this.hidden;
    hidden.length = 0;
    for (const child of this.scene.children) {
      if (!(child as { isLight?: boolean }).isLight && child.visible) {
        child.visible = false;
        hidden.push(child);
      }
    }
    this.background = this.scene.background;
    this.scene.background = UNDERWORLD_BLACK;
  }

  unmask(): void {
    for (const o of this.hidden) o.visible = true;
    this.hidden.length = 0;
    this.scene.background = this.background;
    this.background = null;
  }
}
