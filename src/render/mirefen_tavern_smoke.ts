// The Mirefen tavern's chimney smoke on screen (the puffs' motion is mirefen_tavern_smoke_core.ts):
// one mesh of camera-facing quads, one per puff, rewritten each frame the camera is near, drawn
// with a soft grey puff through a Lambert material so the sun and the sky light it (pale in the
// day, dim at night) and the fog takes it with the rest of the world.
//
// GPU work: built with the tavern into the props root at world build (mirefen_tavern.ts), so the
// world-entry compile links its program, and its (geometry, material) joins the props material
// prewarm beside the tavern's own (mirefenTavernPrewarmParts); a frame only rewrites buffer
// contents, never a material, a texture or a geometry's layout. Cosmetic only: the low effects
// tier builds none (graphics settings never hide what a player acts on; smoke is not that).

import * as THREE from 'three';
import { TAVERN_FLOOR_Y, TAVERN_ORIGIN, tavernToWorld } from '../sim/content/mirefen_tavern';
import {
  TAVERN_SMOKE_PUFFS,
  TAVERN_SMOKE_SOURCES,
  type TavernSmokePuff,
  tavernSmokePuffInto,
} from './mirefen_tavern_smoke_core';

/** The smoke's tint (lit by the scene: the sun and sky make it pale grey by day). */
const SMOKE_TINT = new THREE.Color(0.3, 0.33, 0.42);
/** Past this distance from the tavern the plumes stop drawing and deciding. */
export const TAVERN_SMOKE_RANGE = 220;

let texture: THREE.DataTexture | null = null;
let material: THREE.MeshLambertMaterial | null = null;

function puffTexture(): THREE.DataTexture {
  if (texture) return texture;
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.hypot(dx, dy) * 2;
      // a soft round puff, lumpy at its edge (a stable hash, no rng)
      const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const lump = 0.85 + 0.3 * (n - Math.floor(n));
      const a = Math.min(1, 1.25 * Math.max(0, 1 - d * lump) ** 0.9);
      const o = (y * size + x) * 4;
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
      data[o + 3] = Math.round(255 * a);
    }
  }
  texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'mirefen-tavern-smoke';
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function smokeMaterial(): THREE.MeshLambertMaterial {
  if (material) return material;
  material = new THREE.MeshLambertMaterial({
    map: puffTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });
  material.name = 'mirefen-tavern-smoke';
  return material;
}

/** The smoke's attribute layout (its program's inputs): position, normal, uv, RGBA colour. */
function smokeGeometry(puffs: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(puffs * 4 * 3);
  const normals = new Float32Array(puffs * 4 * 3);
  const uvs = new Float32Array(puffs * 4 * 2);
  const colors = new Float32Array(puffs * 4 * 4);
  const index = new Uint16Array(puffs * 6);
  for (let i = 0; i < puffs; i++) {
    for (let v = 0; v < 4; v++) {
      // lit from above: the sky and the sun light it like a cloud
      normals[(i * 4 + v) * 3 + 1] = 1;
      uvs[(i * 4 + v) * 2] = v === 1 || v === 2 ? 1 : 0;
      uvs[(i * 4 + v) * 2 + 1] = v >= 2 ? 1 : 0;
    }
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const pos = new THREE.BufferAttribute(positions, 3);
  const col = new THREE.BufferAttribute(colors, 4);
  pos.setUsage(THREE.DynamicDrawUsage);
  col.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', pos);
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('color', col);
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

/** The smoke's one program, for the props material prewarm (props.ts builds a mesh of it). */
export function mirefenTavernSmokePrewarmPart(): {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
} {
  return { geometry: smokeGeometry(1), material: smokeMaterial() };
}

export interface TavernSmokeView {
  readonly mesh: THREE.Mesh;
  update(camX: number, camZ: number, dt: number): void;
}

/** Build the plumes (world space; parent under the tavern's group). */
export function buildMirefenTavernSmoke(): TavernSmokeView {
  const geometry = smokeGeometry(TAVERN_SMOKE_PUFFS);
  const mesh = new THREE.Mesh(geometry, smokeMaterial());
  mesh.name = 'mirefenTavernSmoke';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const centre = tavernToWorld(8, 2);
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(centre.x, TAVERN_FLOOR_Y + 26, centre.z),
    30,
  );
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const col = geometry.getAttribute('color') as THREE.BufferAttribute;
  const p = pos.array as Float32Array;
  const c = col.array as Float32Array;
  const puff: TavernSmokePuff = { x: 0, y: 0, z: 0, size: 0, alpha: 0 };
  let clock = 0;
  return {
    mesh,
    update(camX, camZ, dt) {
      const far =
        (camX - TAVERN_ORIGIN.x) ** 2 + (camZ - TAVERN_ORIGIN.z) ** 2 >
        TAVERN_SMOKE_RANGE * TAVERN_SMOKE_RANGE;
      if (mesh.visible === far) mesh.visible = !far;
      if (far) return;
      clock += dt;
      let i = 0;
      for (let s = 0; s < TAVERN_SMOKE_SOURCES.length; s++) {
        const src = TAVERN_SMOKE_SOURCES[s];
        // one billboard frame per plume: its right across the camera's view, world up
        const mouth = tavernToWorld(src.x, src.z);
        let rx = -(mouth.z - camZ);
        let rz = mouth.x - camX;
        const rl = Math.hypot(rx, rz) || 1;
        rx /= rl;
        rz /= rl;
        for (let k = 0; k < src.puffs; k++, i++) {
          tavernSmokePuffInto(i, clock, puff);
          const w = tavernToWorld(puff.x, puff.z);
          const y = TAVERN_FLOOR_Y + puff.y;
          const h = puff.size / 2;
          const o = i * 12;
          // bottom left, bottom right, top right, top left
          p[o] = w.x - rx * h;
          p[o + 1] = y - h;
          p[o + 2] = w.z - rz * h;
          p[o + 3] = w.x + rx * h;
          p[o + 4] = y - h;
          p[o + 5] = w.z + rz * h;
          p[o + 6] = w.x + rx * h;
          p[o + 7] = y + h;
          p[o + 8] = w.z + rz * h;
          p[o + 9] = w.x - rx * h;
          p[o + 10] = y + h;
          p[o + 11] = w.z - rz * h;
          for (let v = 0; v < 4; v++) {
            const q = (i * 4 + v) * 4;
            c[q] = SMOKE_TINT.r;
            c[q + 1] = SMOKE_TINT.g;
            c[q + 2] = SMOKE_TINT.b;
            c[q + 3] = puff.alpha;
          }
        }
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
    },
  };
}
