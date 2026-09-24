// The wisp maze kit, loaded and baked: every Kit_* node of the Blender kit
// (wisp_maze_kit_core.ts names them, docs/design/wisp-maze/ builds them) as
// shared geometry split by material, the painted solid, the tint a guardian
// colours, and the glow. Fetched in the deferred world-content lane, so the
// maze visual (built with the world, gated before entry) reads it resolved and
// allocates everything before the player ever enters. A kit that fails to load
// costs the maze its dressing, never its readability: the stand-in kit below
// draws plain cell-filling hedge blocks and a simple spirit, the pre-kit look.

import * as THREE from 'three';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { markSharedGeometry } from './shared_resource';
import { WISP_MAZE_WALL_HEIGHT } from './wisp_maze_core';
import { WISP_MAZE_KIT_CELL, WISP_MAZE_KIT_URL } from './wisp_maze_kit_core';

export interface WispMazeKitPart {
  solid: THREE.BufferGeometry | null;
  tint: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
}
/** Parts by piece name without the Kit_ prefix (HedgePost, Spirit, Crest0...). */
export type WispMazeKit = ReadonlyMap<string, WispMazeKitPart>;

let baked: WispMazeKit | null = null;

if (typeof window !== 'undefined') {
  registerDeferredPreload(() =>
    loadGltf(WISP_MAZE_KIT_URL)
      .then((gltf) => {
        baked ??= bakeWispMazeKit(gltf.scene);
        // Every attribute was copied out: the parsed source can go.
        releaseGltf(WISP_MAZE_KIT_URL);
      })
      .catch((error: unknown) => {
        // The stand-in keeps the maze playable; say so, so a capture shows why.
        console.warn('Wisp maze kit failed to load, drawing the stand-in kit', error);
      }),
  );
}

export const wispMazeKitPreloadInternalsForTest = { urls: [WISP_MAZE_KIT_URL] };

/** Decode (the shipped kit is quantized) and bake every Kit_ node, split by material. */
export function bakeWispMazeKit(scene: THREE.Object3D): WispMazeKit {
  scene.updateWorldMatrix(true, true);
  const kit = new Map<string, WispMazeKitPart>();
  scene.traverse((node) => {
    if (!node.name.startsWith('Kit_')) return;
    const part: WispMazeKitPart = { solid: null, tint: null, glow: null };
    node.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const geometry = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'color']) {
        const attr = child.geometry.getAttribute(name);
        if (!attr) continue;
        // getComponent denormalizes a quantized stream; colour ships RGBA, keep RGB.
        const size = name === 'color' ? 3 : attr.itemSize;
        const values = new Float32Array(attr.count * size);
        for (let i = 0; i < attr.count; i++)
          for (let j = 0; j < size; j++) values[i * size + j] = attr.getComponent(i, j);
        geometry.setAttribute(name, new THREE.BufferAttribute(values, size));
      }
      if (child.geometry.index) geometry.setIndex(child.geometry.index.clone());
      // The node's own matrix is what restores a quantized node's real size.
      geometry.applyMatrix4(child.matrixWorld);
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      const material = Array.isArray(child.material) ? child.material[0] : child.material;
      const name = material?.name ?? '';
      const slot = /glow/i.test(name) ? 'glow' : /tint/i.test(name) ? 'tint' : 'solid';
      // The builder pins one primitive per material per node; a second would be lost.
      if (part[slot]) console.warn(`Wisp maze kit ${node.name} repeats its ${slot} part`);
      part[slot] = markSharedGeometry(geometry);
    });
    kit.set(node.name.slice(4), part);
  });
  return kit;
}

/** Paint a plain geometry one colour, so a vertex-coloured material draws it. */
function painted(geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const color = new THREE.Color(hex);
  const count = geometry.getAttribute('position').count;
  const values = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) color.toArray(values, i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
  return markSharedGeometry(geometry);
}

let standIn: WispMazeKit | null = null;

/**
 * The stand-in kit: every hedge a cell-filling block at the wall height (the
 * collision box itself), a cloaked spirit with lit eyes, and one crest shape
 * per guardian. No gates, lanterns or flagstones.
 */
export function standInWispMazeKit(): WispMazeKit {
  if (standIn) return standIn;
  const block = new THREE.BoxGeometry(
    WISP_MAZE_KIT_CELL,
    WISP_MAZE_WALL_HEIGHT,
    WISP_MAZE_KIT_CELL,
  );
  block.translate(0, WISP_MAZE_WALL_HEIGHT / 2, 0);
  const hedge = painted(block, 0x48645f);
  const body = new THREE.ConeGeometry(0.5, 1.5, 7, 1, true);
  body.rotateX(Math.PI);
  body.translate(0, 0.95, 0);
  const eyes = new THREE.BoxGeometry(0.36, 0.08, 0.06);
  eyes.translate(0, 1.72, 0.34);
  const hood = new THREE.SphereGeometry(0.4, 9, 7);
  hood.translate(0, 1.72, 0);
  const crests = [
    new THREE.ConeGeometry(0.12, 0.5, 5).translate(0, 2.2, 0),
    new THREE.OctahedronGeometry(0.22).translate(0, 2.3, 0),
    new THREE.TorusGeometry(0.5, 0.05, 5, 14).rotateX(Math.PI / 2).translate(0, 1.6, 0),
    new THREE.CylinderGeometry(0.3, 0.3, 0.2, 6).translate(0, 2.1, 0),
    new THREE.BoxGeometry(0.9, 0.5, 0.1).translate(0, 2.2, -0.2),
  ];
  const kit = new Map<string, WispMazeKitPart>();
  for (const kind of ['Post', 'End', 'Straight', 'Corner', 'Tee', 'Cross', 'Gate'])
    kit.set(`Hedge${kind}`, { solid: hedge, tint: null, glow: null });
  kit.set('Spirit', {
    solid: null,
    tint: painted(mergeBasic([body, hood]), 0xffffff),
    glow: painted(eyes, 0xfff1c4),
  });
  for (let i = 0; i < crests.length; i++)
    kit.set(`Crest${i}`, { solid: null, tint: painted(crests[i], 0xffffff), glow: null });
  standIn = kit;
  return kit;
}

/** Concatenate non-indexed copies of simple geometries (positions and normals). */
function mergeBasic(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((part) => (part.index ? part.toNonIndexed() : part));
  let total = 0;
  for (const g of flat) total += g.getAttribute('position').count;
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  let offset = 0;
  for (const g of flat) {
    position.set(g.getAttribute('position').array as Float32Array, offset);
    normal.set(g.getAttribute('normal').array as Float32Array, offset);
    offset += g.getAttribute('position').count * 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  return out;
}

/** The baked kit when it loaded, else the stand-in. */
export function wispMazeKit(): WispMazeKit {
  return baked ?? standInWispMazeKit();
}

/** True once the real kit is baked (false in Node, and after a failed load). */
export function wispMazeKitLoaded(): boolean {
  return baked !== null;
}

export const wispMazeKitInternalsForTest = {
  /** Install a kit (a baked fixture, or null to fall back to the stand-in). */
  install(kit: WispMazeKit | null): void {
    baked = kit;
  },
};
