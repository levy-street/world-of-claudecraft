// The lit smoke puff: soft grey puffs on camera-facing quads, drawn through a Lambert material so
// the sun and the sky light them (pale in the day, dim at night) and the fog takes them with the
// rest of the world. The pooled particle cloud (vfx.ts) cannot draw this: it blends additively,
// and smoke has to darken the sky behind it.
//
// One texture, one material and one attribute layout for every plume that draws with it (the
// Mirefen tavern's chimneys, mirefen_tavern_smoke.ts; a torched mudfin hut, hut_smoke.ts), so
// they share ONE linked program and one prewarm twin (litSmokePuffPrewarmPart). A frame only
// rewrites buffer contents (writeLitSmokePuff), never a material, a texture or a layout.

import * as THREE from 'three';

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
  texture.name = 'lit-smoke-puff';
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** The one material every lit plume draws with. Shared: never dispose it from a plume. */
export function litSmokePuffMaterial(): THREE.MeshLambertMaterial {
  if (material) return material;
  material = new THREE.MeshLambertMaterial({
    map: puffTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });
  material.name = 'lit-smoke-puff';
  return material;
}

/** A buffer of `puffs` quads in the one layout (the program's inputs): position, normal, uv,
 *  RGBA colour. Positions and colours are dynamic; writeLitSmokePuff fills them. */
export function litSmokePuffGeometry(puffs: number): THREE.BufferGeometry {
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

/** The lit smoke's one program, for a prewarm (a mesh of one puff). */
export function litSmokePuffPrewarmPart(): {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
} {
  return { geometry: litSmokePuffGeometry(1), material: litSmokePuffMaterial() };
}

/**
 * Write puff `i` of a lit smoke buffer: a quad of side `size` centred on (x, y, z), spanning the
 * unit horizontal (rx, rz) across the view and world up, coloured (r, g, b) at opacity `a`.
 */
export function writeLitSmokePuff(
  positions: Float32Array,
  colors: Float32Array,
  i: number,
  x: number,
  y: number,
  z: number,
  rx: number,
  rz: number,
  size: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  const h = size / 2;
  const o = i * 12;
  // bottom left, bottom right, top right, top left
  positions[o] = x - rx * h;
  positions[o + 1] = y - h;
  positions[o + 2] = z - rz * h;
  positions[o + 3] = x + rx * h;
  positions[o + 4] = y - h;
  positions[o + 5] = z + rz * h;
  positions[o + 6] = x + rx * h;
  positions[o + 7] = y + h;
  positions[o + 8] = z + rz * h;
  positions[o + 9] = x - rx * h;
  positions[o + 10] = y + h;
  positions[o + 11] = z - rz * h;
  for (let v = 0; v < 4; v++) {
    const q = (i * 4 + v) * 4;
    colors[q] = r;
    colors[q + 1] = g;
    colors[q + 2] = b;
    colors[q + 3] = a;
  }
}
