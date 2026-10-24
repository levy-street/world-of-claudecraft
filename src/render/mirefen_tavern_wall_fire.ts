// The Mirefen tavern's wall fire on screen (its layout is mirefen_tavern_wall_fire_core.ts): the
// logs and the bed of embers in the fireplace's mouth, and the firelight glowing on the soot
// behind them and on the hearthstone before them. The flames themselves are the campfires'
// live flame (props.ts, from MIREFEN_TAVERN_FLAMES), and the fire's point light joins the
// fire-light budget with the tavern's other lights (mirefen_tavern.ts).
//
// GPU work: built with the tavern into the props root at world build (mirefen_tavern.ts, under
// the model, in its local frame), so the world-entry compile links it, and its (geometry,
// material) pairs join the tavern's props prewarm (mirefenTavernPrewarmParts). The logs draw
// with the tavern's own vertex-coloured material and the embers with its glow material (the
// same programs as the model's); the two glows share one additive program. A frame only
// writes the glows' opacity (a uniform), never a material, a texture or a geometry's layout.
// Cosmetic, on every tier (a lit fireplace is the room's centrepiece, and cheap).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  TAVERN_WALL_FIRE_EMBERS,
  TAVERN_WALL_FIRE_GLOW,
  TAVERN_WALL_FIRE_LOGS,
  tavernWallFireFlicker,
} from './mirefen_tavern_wall_fire_core';
import type { VertexColourPart } from './vertex_colour_glb_parts';

/** The glows' tint and resting opacity (additive: the soot takes more than the stone). */
const GLOW_TINT = 0xff8636;
const BACK_GLOW_OPACITY = 0.62;
const FLOOR_GLOW_OPACITY = 0.26;

const BARK = [0.26, 0.16, 0.09] as const;
const CHAR = [0.06, 0.045, 0.04] as const;
const EMBER_HOT = [0.95, 0.36, 0.08] as const;
const EMBER_DULL = [0.32, 0.07, 0.03] as const;

export interface TavernWallFireView {
  /** The logs, the embers and the glows, in the tavern's local frame (add under the model). */
  group: THREE.Group;
  /** Every (geometry, material) it draws, for the props prewarm. */
  parts: VertexColourPart[];
  /** The glows' flicker this frame. */
  update(t: number, reducedMotion: boolean): void;
  dispose(): void;
}

function hash(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Colour every vertex (itemSize matches the model's colour attribute, so the program is its). */
function paint(
  geometry: THREE.BufferGeometry,
  itemSize: number,
  pick: (i: number, nx: number, ny: number, nz: number) => readonly [number, number, number],
): void {
  const normal = geometry.getAttribute('normal');
  const n = geometry.getAttribute('position').count;
  const colour = new Float32Array(n * itemSize);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = pick(i, normal.getX(i), normal.getY(i), normal.getZ(i));
    colour[i * itemSize] = r;
    colour[i * itemSize + 1] = g;
    colour[i * itemSize + 2] = b;
    if (itemSize === 4) colour[i * itemSize + 3] = 1;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colour, itemSize));
}

function logsGeometry(itemSize: number): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  TAVERN_WALL_FIRE_LOGS.forEach((log, k) => {
    const g = new THREE.CylinderGeometry(log.r, log.r * 0.92, log.length, 7, 1);
    g.deleteAttribute('uv');
    // the axis along z, then pitched up out of the hearth and turned about y
    g.rotateX(Math.PI / 2);
    m.makeRotationFromEuler(new THREE.Euler(-log.pitch, log.yaw, 0, 'YXZ'));
    g.applyMatrix4(m);
    g.translate(log.x, log.y, log.z);
    const axis = new THREE.Vector3(0, 0, 1).applyMatrix4(m);
    paint(g, itemSize, (i, nx, ny, nz) => {
      // the sawn ends charred black, the bark mottled and blackened on its underside
      if (Math.abs(nx * axis.x + ny * axis.y + nz * axis.z) > 0.8) return CHAR;
      const burnt = ny < -0.2 ? 0.75 : 0.25 * hash(k, i);
      return [
        BARK[0] + (CHAR[0] - BARK[0]) * burnt,
        BARK[1] + (CHAR[1] - BARK[1]) * burnt,
        BARK[2] + (CHAR[2] - BARK[2]) * burnt,
      ];
    });
    pieces.push(g.toNonIndexed());
    g.dispose();
  });
  // a few lumps of charcoal on the bed
  for (let k = 0; k < 7; k++) {
    const e = TAVERN_WALL_FIRE_EMBERS;
    const g = new THREE.IcosahedronGeometry(0.05 + 0.03 * hash(k, 3), 0);
    g.deleteAttribute('uv');
    g.scale(1, 0.6, 1);
    g.translate(
      e.x0 + 0.08 + (e.x1 - e.x0 - 0.16) * hash(k, 1),
      e.y + e.crown * 0.6,
      e.z0 + 0.1 + (e.z1 - e.z0 - 0.2) * hash(k, 2),
    );
    paint(g, itemSize, () => CHAR);
    pieces.push(g.toNonIndexed());
    g.dispose();
  }
  const merged = mergeGeometries(pieces, false);
  for (const p of pieces) p.dispose();
  if (!merged) throw new Error('mirefen tavern wall fire: the logs did not merge');
  merged.name = 'mirefenTavernWallFireLogs';
  return merged;
}

function embersGeometry(itemSize: number): THREE.BufferGeometry {
  const e = TAVERN_WALL_FIRE_EMBERS;
  const g = new THREE.PlaneGeometry(e.x1 - e.x0, e.z1 - e.z0, 6, 10);
  g.deleteAttribute('uv');
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  const hx = (e.x1 - e.x0) / 2;
  const hz = (e.z1 - e.z0) / 2;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / hx;
    const v = pos.getZ(i) / hz;
    // a low mound, heaped where the logs meet, lumpy across its crown
    const mound = Math.max(0, 1 - u * u) * Math.max(0, 1 - v * v) ** 0.6;
    pos.setY(i, e.crown * mound * (0.7 + 0.6 * hash(i, 7)));
  }
  g.translate((e.x0 + e.x1) / 2, e.y, (e.z0 + e.z1) / 2);
  g.computeVertexNormals();
  paint(g, itemSize, (i) => {
    const heat = hash(i, 11);
    return [
      EMBER_DULL[0] + (EMBER_HOT[0] - EMBER_DULL[0]) * heat,
      EMBER_DULL[1] + (EMBER_HOT[1] - EMBER_DULL[1]) * heat,
      EMBER_DULL[2] + (EMBER_HOT[2] - EMBER_DULL[2]) * heat,
    ];
  });
  g.name = 'mirefenTavernWallFireEmbers';
  return g;
}

/** A soft round glow (a stable radial falloff; Node-safe, no canvas). */
function glowTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2;
      const a = Math.max(0, 1 - d) ** 1.6;
      const o = (y * size + x) * 4;
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
      data[o + 3] = Math.round(255 * a);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'mirefen-tavern-wall-fire-glow';
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function glowMaterial(map: THREE.Texture, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    color: GLOW_TINT,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Build the wall fire: `wood` is the model's vertex-coloured material, `glow` its glow
 *  material, `colourItemSize` its colour attribute's width (3 or 4). */
export function buildMirefenTavernWallFire(
  wood: THREE.Material,
  glow: THREE.Material,
  colourItemSize: number,
): TavernWallFireView {
  const group = new THREE.Group();
  group.name = 'mirefenTavernWallFire';
  const logs = new THREE.Mesh(logsGeometry(colourItemSize), wood);
  logs.name = 'mirefenTavernWallFireLogs';
  logs.receiveShadow = true;
  const embers = new THREE.Mesh(embersGeometry(colourItemSize), glow);
  embers.name = 'mirefenTavernWallFireEmbers';
  const map = glowTexture();
  const backMat = glowMaterial(map, BACK_GLOW_OPACITY);
  const floorMat = glowMaterial(map, FLOOR_GLOW_OPACITY);
  const G = TAVERN_WALL_FIRE_GLOW;
  const backGeo = new THREE.PlaneGeometry(G.back.width, G.back.height);
  backGeo.rotateY(-Math.PI / 2); // facing the room
  const back = new THREE.Mesh(backGeo, backMat);
  back.name = 'mirefenTavernWallFireGlow';
  back.position.set(G.back.x, G.back.y, G.back.z);
  const floorGeo = new THREE.PlaneGeometry(G.floor.depth, G.floor.width);
  floorGeo.rotateX(-Math.PI / 2); // lying on the hearthstone
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.name = 'mirefenTavernWallFireGlow';
  floor.position.set(G.floor.x, G.floor.y, G.floor.z);
  group.add(logs, embers, back, floor);
  let last = -1;
  return {
    group,
    parts: [
      { geometry: logs.geometry, material: wood },
      { geometry: embers.geometry, material: glow },
      { geometry: backGeo, material: backMat },
      { geometry: floorGeo, material: floorMat },
    ],
    update(t: number, reducedMotion: boolean): void {
      const f = tavernWallFireFlicker(t, reducedMotion);
      if (f === last) return;
      last = f;
      backMat.opacity = BACK_GLOW_OPACITY * f;
      floorMat.opacity = FLOOR_GLOW_OPACITY * f;
    },
    dispose(): void {
      logs.geometry.dispose();
      embers.geometry.dispose();
      backGeo.dispose();
      floorGeo.dispose();
      backMat.dispose();
      floorMat.dispose();
      map.dispose();
    },
  };
}
