// The Highwatch manor's chimney smoke on screen (the puffs' motion is highwatch_manor_smoke_core.ts):
// one mesh of camera-facing quads, one per puff, rewritten each frame the camera is near, a soft
// grey puff through a Lambert material so the sun and the sky light it (pale by day, dim at
// night) and the fog takes it with the rest of the world. The Mirefen tavern's smoke, in the
// manor's frame.
//
// GPU work: built with the props at world build (props.ts, only while the built-in Highwatch
// town stands; the low effects tier hides it), and its (geometry, material) joins the props'
// material prewarm (highwatchManorSmokePrewarmPart), so the world-entry compile links its one
// program; a frame only rewrites buffer contents, never a material, a texture or a layout.
// Cosmetic only (graphics-settings fairness: nothing a player acts on is behind it).

import * as THREE from 'three';
import { GFX } from './gfx';
import { highwatchManorWorldPoint } from './highwatch_manor_lights';
import {
  MANOR_SMOKE_PUFFS,
  MANOR_SMOKE_SOURCES,
  type ManorSmokePuff,
  manorSmokePuffInto,
} from './highwatch_manor_smoke_core';

const SMOKE_TINT = new THREE.Color(0.32, 0.34, 0.4);
/** Past this distance from the chimney the plumes stop drawing and deciding. */
export const MANOR_SMOKE_RANGE = 240;

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
  texture.name = 'highwatch-manor-smoke';
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
  material.name = 'highwatch-manor-smoke';
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

/** The smoke's one program, for the props material prewarm. */
export function highwatchManorSmokePrewarmPart(): {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
} {
  return { geometry: smokeGeometry(1), material: smokeMaterial() };
}

export interface ManorSmokeView {
  readonly mesh: THREE.Mesh;
  update(camX: number, camZ: number, dt: number): void;
}

/** Build the plumes (world space; the caller adds the mesh to the props root). */
export function buildHighwatchManorSmoke(seed: number): ManorSmokeView {
  const geometry = smokeGeometry(MANOR_SMOKE_PUFFS);
  const mesh = new THREE.Mesh(geometry, smokeMaterial());
  mesh.name = 'highwatchManorSmoke';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // the model frame's origin and axes in the world, once
  const o = highwatchManorWorldPoint(0, 0, 0, seed);
  const ax = highwatchManorWorldPoint(1, 0, 0, seed);
  const az = highwatchManorWorldPoint(0, 0, 1, seed);
  const xx = ax.x - o.x;
  const xz = ax.z - o.z;
  const zx = az.x - o.x;
  const zz = az.z - o.z;
  const src = MANOR_SMOKE_SOURCES[0];
  const mouthX = o.x + xx * src.x + zx * src.z;
  const mouthZ = o.z + xz * src.x + zz * src.z;
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(mouthX, o.y + src.y + 10, mouthZ),
    24,
  );
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const col = geometry.getAttribute('color') as THREE.BufferAttribute;
  const p = pos.array as Float32Array;
  const c = col.array as Float32Array;
  const puff: ManorSmokePuff = { x: 0, y: 0, z: 0, size: 0, alpha: 0 };
  let clock = 0;
  return {
    mesh,
    update(camX, camZ, dt) {
      // the low effects tier draws none (read live: the tier can change after the build)
      const far =
        GFX.effectsTier === 'low' ||
        (camX - mouthX) ** 2 + (camZ - mouthZ) ** 2 > MANOR_SMOKE_RANGE * MANOR_SMOKE_RANGE;
      if (mesh.visible === far) mesh.visible = !far;
      if (far) return;
      clock += dt;
      // one billboard frame for both plumes: its right across the camera's view, world up
      let rx = -(mouthZ - camZ);
      let rz = mouthX - camX;
      const rl = Math.hypot(rx, rz) || 1;
      rx /= rl;
      rz /= rl;
      for (let i = 0; i < MANOR_SMOKE_PUFFS; i++) {
        manorSmokePuffInto(i, clock, puff);
        const wx = o.x + xx * puff.x + zx * puff.z;
        const wz = o.z + xz * puff.x + zz * puff.z;
        const y = o.y + puff.y;
        const h = puff.size / 2;
        const q = i * 12;
        p[q] = wx - rx * h;
        p[q + 1] = y - h;
        p[q + 2] = wz - rz * h;
        p[q + 3] = wx + rx * h;
        p[q + 4] = y - h;
        p[q + 5] = wz + rz * h;
        p[q + 6] = wx + rx * h;
        p[q + 7] = y + h;
        p[q + 8] = wz + rz * h;
        p[q + 9] = wx - rx * h;
        p[q + 10] = y + h;
        p[q + 11] = wz - rz * h;
        for (let v = 0; v < 4; v++) {
          const k = (i * 4 + v) * 4;
          c[k] = SMOKE_TINT.r;
          c[k + 1] = SMOKE_TINT.g;
          c[k + 2] = SMOKE_TINT.b;
          c[k + 3] = puff.alpha;
        }
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
    },
  };
}
