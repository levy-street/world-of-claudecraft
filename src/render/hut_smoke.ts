// A torched mudfin hut's smoke on screen (the puffs' motion is hut_smoke_core.ts): one mesh of
// camera-facing quads holding every burning hut's plume, rewritten each frame a hut smokes, drawn
// with the shared lit smoke puff (lit_smoke_puffs.ts) so the sun and the sky light it (dark grey
// smoke you can see against a bright sky, dim at night) and the fog takes it. The fire's own
// particles stay on the additive cloud; an additive puff only adds light, so it cannot darken
// the sky the way smoke does.
//
// GPU work: built once with the particle cloud (vfx.ts) and added to the scene at boot, hidden
// until a hut smokes. It draws with its OWN copy of the tavern chimney's material (same
// parameters and the same shared puff texture, so the same linked program, which joins the props
// material prewarm through hutSmokePrewarmParts), owned and disposed with the particle cloud; a
// frame only rewrites buffer contents and the draw range, never a material, a texture or a
// geometry's layout. Cosmetic only: the low effects tier builds none (graphics settings never
// hide what a player acts on; smoke is not that).

import * as THREE from 'three';
import { GFX } from './gfx';
import type { HutFireBody } from './hut_fire_core';
import { HUT_SMOKE_PUFFS, type HutSmokePuff, hutSmokePuffInto } from './hut_smoke_core';
import {
  litSmokePuffGeometry,
  litSmokePuffMaterial,
  litSmokePuffPrewarmPart,
  writeLitSmokePuff,
} from './lit_smoke_puffs';

/** Plumes drawn at once: the five Mirefen huts, and a spare. */
export const HUT_SMOKE_MAX_PLUMES = 6;
/** A puff fainter than this is not drawn at all. */
const MIN_ALPHA = 0.004;
/** Thick smoke and thin, before the scene lights it. */
const DARK = [0.08, 0.075, 0.07] as const;
const PALE = [0.34, 0.34, 0.35] as const;

/** One burning hut's plume: the hut and how long since it caught. */
export interface HutSmokePlume {
  readonly body: HutFireBody;
  readonly age: number;
}

export interface HutSmokeView {
  readonly mesh: THREE.Mesh;
  /** Paint every plume this frame, its puffs facing a camera at (camX, camZ). */
  update(plumes: Iterable<HutSmokePlume>, camX: number, camZ: number): void;
  dispose(): void;
}

/** Whether this client draws hut smoke: from medium effects up, like the tavern chimney. */
export function hutSmokeEnabled(): boolean {
  return GFX.effectsTier !== 'low';
}

/** The plume's one program for the props material prewarm: none where no plume is built. */
export function hutSmokePrewarmParts(): {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}[] {
  return hutSmokeEnabled() ? [litSmokePuffPrewarmPart()] : [];
}

/** Build the plumes' mesh (world space; add it to the scene once). */
export function buildHutSmoke(): HutSmokeView {
  const geometry = litSmokePuffGeometry(HUT_SMOKE_MAX_PLUMES * HUT_SMOKE_PUFFS);
  geometry.setDrawRange(0, 0);
  const sphere = new THREE.Sphere(new THREE.Vector3(), 1);
  geometry.boundingSphere = sphere;
  // a copy keeps the program and the texture shared while this view owns what it disposes
  const material = litSmokePuffMaterial().clone();
  material.name = 'hut-smoke';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'hutSmoke';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.visible = false;
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const col = geometry.getAttribute('color') as THREE.BufferAttribute;
  const p = pos.array as Float32Array;
  const c = col.array as Float32Array;
  const puff: HutSmokePuff = { x: 0, y: 0, z: 0, size: 0, alpha: 0, shade: 0 };
  return {
    mesh,
    update(plumes, camX, camZ) {
      let n = 0;
      let plumeCount = 0;
      let minX = Infinity;
      let minY = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let maxZ = -Infinity;
      for (const plume of plumes) {
        if (plumeCount >= HUT_SMOKE_MAX_PLUMES) break;
        plumeCount++;
        const { body, age } = plume;
        // one billboard frame per plume: its right across the camera's view, world up
        let rx = -(body.z - camZ);
        let rz = body.x - camX;
        const rl = Math.hypot(rx, rz) || 1;
        rx /= rl;
        rz /= rl;
        for (let k = 0; k < HUT_SMOKE_PUFFS; k++) {
          hutSmokePuffInto(k, age, body, puff);
          if (puff.alpha < MIN_ALPHA) continue;
          const s = puff.shade;
          writeLitSmokePuff(
            p,
            c,
            n,
            puff.x,
            puff.y,
            puff.z,
            rx,
            rz,
            puff.size,
            DARK[0] + (PALE[0] - DARK[0]) * s,
            DARK[1] + (PALE[1] - DARK[1]) * s,
            DARK[2] + (PALE[2] - DARK[2]) * s,
            puff.alpha,
          );
          n++;
          const h = puff.size / 2;
          if (puff.x - h < minX) minX = puff.x - h;
          if (puff.y - h < minY) minY = puff.y - h;
          if (puff.z - h < minZ) minZ = puff.z - h;
          if (puff.x + h > maxX) maxX = puff.x + h;
          if (puff.y + h > maxY) maxY = puff.y + h;
          if (puff.z + h > maxZ) maxZ = puff.z + h;
        }
      }
      const visible = n > 0;
      if (mesh.visible !== visible) mesh.visible = visible;
      geometry.setDrawRange(0, n * 6);
      if (!visible) return;
      // the culling and sorting sphere follows the puffs actually drawn
      sphere.center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
      sphere.radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2;
      pos.needsUpdate = true;
      col.needsUpdate = true;
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      // its own material copy; the puff texture stays, shared with the tavern chimney
      material.dispose();
    },
  };
}
