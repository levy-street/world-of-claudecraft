// The map-wide wilderness night layer: luminous mushroom clusters underfoot and
// fireflies drifting over the water edges, streamed around the camera so every
// region of the world has something lit after dark, not just the towns the
// streetlamps reach.
//
// Two pools, both player-centred, both night-gated:
//   - GLOW FLORA is world-ANCHORED: a cluster is a pure function of its integer
//     cell (night_accents_core.ts), so it stays put while you walk past it and
//     is identical when you come back. The instanced fill is rebuilt only when
//     the camera crosses a cell boundary, never per frame.
//   - FIREFLIES are player-centred and disposable, the motes.ts contract: a
//     recycled pool of additive points, rehomed as you walk. Nobody tracks an
//     individual insect, so they may move when you are not looking.
//
// Both hide completely by day, so the daytime world is untouched: the flora
// fades in over the dusk ramp with its emissive rather than existing as new
// daylight geometry, which would be a world-content change nobody asked for.
import * as THREE from 'three';
import { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z } from '../sim/data';
import { hash2 } from '../sim/rng';
import type { BiomeId } from '../sim/types';
import { roadDistance, terrainHeight, WATER_LEVEL, zoneBiomeAt } from '../sim/world';
import { EMISSIVE_GLOW, GFX } from './gfx';
import {
  FLORA_CAP_POOL,
  FLORA_TINT,
  fireflyBlink,
  fireflyHabitat,
  floraCellChanged,
  floraCellOf,
  type GlowFloraCap,
  glowFloraCaps,
} from './night_accents_core';

export interface NightAccentsView {
  group: THREE.Group;
  /** Drive from the frame's accent glow amount (0 = out, 1 = full). */
  update(glow: number, time: number, dt: number, camX: number, camZ: number): void;
}

// Flora exclusions: a mushroom on the cobbles or on a town plateau reads as a
// placement bug, and one standing in a lake reads as a floating sprite.
const FLORA_ROAD_CLEAR = 3.4;
const FLORA_WATER_CLEAR = 0.4;

const FIREFLY_RADIUS = 34;
const FIREFLY_FLOOR = 0.5;
const FIREFLY_CEIL = 2.6;
const FIREFLY_TINT = 0xffe08a;

/** Deterministic 0..1 for a cell plus a salt. The sim's shared world hash, so
 *  the flora field is reproducible everywhere the sim is (never Math.random). */
function cellHash(cx: number, cz: number, salt: number): number {
  return hash2(cx, cz, 0x9e37 + salt * 2654435761);
}

/** Player-centred RNG for the disposable firefly pool (the motes.ts idiom). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Soft round glow sprite for a firefly, built once (no image assets). */
function fireflySprite(): THREE.Texture {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('night_accents: no 2d context for the firefly sprite');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A mushroom: a stubby stalk under a domed cap, at the world's low-poly grain. */
function capGeometry(): THREE.BufferGeometry {
  const cap = new THREE.SphereGeometry(0.19, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.55);
  cap.scale(1, 0.78, 1);
  cap.translate(0, 0.17, 0);
  return cap;
}

function stalkGeometry(): THREE.BufferGeometry {
  const stalk = new THREE.CylinderGeometry(0.035, 0.055, 0.19, 5);
  stalk.translate(0, 0.095, 0);
  return stalk;
}

export function buildNightAccents(seed = 0): NightAccentsView {
  const group = new THREE.Group();
  group.name = 'night-accents';
  group.visible = false;

  // ---- glow flora ---------------------------------------------------------
  const capMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true });
  const stalkMat = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ color: 0xd8cdba, roughness: 0.9, flatShading: true })
    : new THREE.MeshLambertMaterial({ color: 0xd8cdba, flatShading: true });
  const caps = new THREE.InstancedMesh(capGeometry(), capMat, FLORA_CAP_POOL);
  const stalks = new THREE.InstancedMesh(stalkGeometry(), stalkMat, FLORA_CAP_POOL);
  caps.frustumCulled = false; // the fill follows the camera; baked bounds go stale
  stalks.frustumCulled = false;
  caps.count = 0;
  stalks.count = 0;
  caps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FLORA_CAP_POOL * 3), 3);
  group.add(caps);
  group.add(stalks);

  const floraSlots: GlowFloraCap[] = [];
  const floraTint = new THREE.Color();
  const floraBase: number[] = [];
  let floraCount = 0;
  let floraCx = Number.NaN;
  let floraCz = Number.NaN;

  const probes = {
    hash: cellHash,
    groundAt: (x: number, z: number) => terrainHeight(x, z, seed),
    biomeAt: (x: number, z: number) => zoneBiomeAt(x, z),
    excluded: (x: number, z: number, groundY: number): boolean => {
      if (groundY < WATER_LEVEL + FLORA_WATER_CLEAR) return true;
      if (Math.abs(x) > WORLD_MAX_X - 6 || z < WORLD_MIN_Z + 6 || z > WORLD_MAX_Z - 6) return true;
      return roadDistance(x, z) < FLORA_ROAD_CLEAR;
    },
  };

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scaleVec = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function rebuildFlora(camX: number, camZ: number): void {
    floraCount = glowFloraCaps(camX, camZ, probes, floraSlots);
    for (let i = 0; i < floraCount; i++) {
      const slot = floraSlots[i];
      quaternion.setFromAxisAngle(up, slot.yaw);
      position.set(slot.x, slot.y, slot.z);
      scaleVec.set(slot.scale, slot.scale, slot.scale);
      matrix.compose(position, quaternion, scaleVec);
      caps.setMatrixAt(i, matrix);
      stalks.setMatrixAt(i, matrix);
      // The realm's tint, shaded apart per cap so a cluster is not one flat blob.
      const biome: BiomeId = zoneBiomeAt(slot.x, slot.z);
      floraTint.setHex(FLORA_TINT[biome]);
      floraBase[i * 3] = floraTint.r * (0.7 + slot.variant * 0.5);
      floraBase[i * 3 + 1] = floraTint.g * (0.7 + slot.variant * 0.5);
      floraBase[i * 3 + 2] = floraTint.b * (0.7 + slot.variant * 0.5);
    }
    caps.count = floraCount;
    stalks.count = floraCount;
    caps.instanceMatrix.needsUpdate = true;
    stalks.instanceMatrix.needsUpdate = true;
  }

  // ---- fireflies ----------------------------------------------------------
  const flyCount = GFX.standardMaterials ? 70 : 26;
  const rng = mulberry32((seed ^ 0x3f19) >>> 0);
  const flyPos = new Float32Array(flyCount * 3);
  const flyColor = new Float32Array(flyCount * 3);
  const flyHomeX = new Float32Array(flyCount);
  const flyHomeZ = new Float32Array(flyCount);
  const flyBaseY = new Float32Array(flyCount);
  const flyLift = new Float32Array(flyCount);
  const flyPhase = new Float32Array(flyCount);
  const flyDrift = new Float32Array(flyCount);
  const flyTint = new THREE.Color(FIREFLY_TINT);

  const flyGeo = new THREE.BufferGeometry();
  const flyPosAttr = new THREE.BufferAttribute(flyPos, 3).setUsage(THREE.DynamicDrawUsage);
  const flyColorAttr = new THREE.BufferAttribute(flyColor, 3).setUsage(THREE.DynamicDrawUsage);
  flyGeo.setAttribute('position', flyPosAttr);
  flyGeo.setAttribute('color', flyColorAttr);
  const flyMat = new THREE.PointsMaterial({
    size: 0.34,
    map: fireflySprite(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    opacity: 0.9,
  });
  const flies = new THREE.Points(flyGeo, flyMat);
  flies.frustumCulled = false; // the pool is centred on the player
  group.add(flies);

  /** Rehome one firefly inside the ring; false when the spot is no habitat. */
  function placeFly(i: number, px: number, pz: number): boolean {
    const angle = rng() * Math.PI * 2;
    const reach = Math.sqrt(rng()) * FIREFLY_RADIUS;
    const x = px + Math.cos(angle) * reach;
    const z = pz + Math.sin(angle) * reach;
    if (Math.abs(x) > WORLD_MAX_X - 8 || z < WORLD_MIN_Z + 8 || z > WORLD_MAX_Z - 8) return false;
    const groundY = terrainHeight(x, z, seed);
    if (!fireflyHabitat(groundY, WATER_LEVEL, zoneBiomeAt(x, z))) return false;
    flyHomeX[i] = x;
    flyHomeZ[i] = z;
    flyBaseY[i] = groundY;
    flyLift[i] = FIREFLY_FLOOR + rng() * (FIREFLY_CEIL - FIREFLY_FLOOR);
    flyPhase[i] = rng();
    flyDrift[i] = 0.35 + rng() * 0.5;
    flyPos[i * 3] = x;
    flyPos[i * 3 + 1] = groundY + flyLift[i];
    flyPos[i * 3 + 2] = z;
    return true;
  }

  let fliesSeeded = false;
  let clock = 0;

  return {
    group,
    update(glow: number, time: number, dt: number, camX: number, camZ: number): void {
      // The CALLER owns the outdoor decision (renderer.ts gates on fogState,
      // which knows about every instanced interior and about being underwater);
      // this layer only asks whether it is lit.
      const lit = glow > 0.001;
      group.visible = lit;
      if (!lit) {
        fliesSeeded = false;
        return;
      }
      // --- flora: rebuild only on a cell crossing, then just re-grade colour
      if (Number.isNaN(floraCx) || floraCellChanged(camX, camZ, floraCx, floraCz)) {
        const cell = floraCellOf(camX, camZ);
        floraCx = cell.cx;
        floraCz = cell.cz;
        rebuildFlora(camX, camZ);
      }
      if (floraCount > 0 && caps.instanceColor) {
        // Emissive-by-brightness: an unlit basic material scaled by the glow is
        // the cheapest way to carry an HDR cap past the bloom threshold on the
        // composer tiers while collapsing to nothing by day.
        const pulse = 0.9 + Math.sin(time * 0.9) * 0.1;
        const level = EMISSIVE_GLOW * glow * pulse;
        const array = caps.instanceColor.array as Float32Array;
        for (let i = 0; i < floraCount * 3; i++) array[i] = floraBase[i] * level;
        caps.instanceColor.needsUpdate = true;
      }
      // --- fireflies: recycle out-of-ring flies, drift and blink the rest
      if (!fliesSeeded) {
        for (let i = 0; i < flyCount; i++) if (!placeFly(i, camX, camZ)) flyBaseY[i] = -1e6;
        fliesSeeded = true;
      }
      clock += dt;
      for (let i = 0; i < flyCount; i++) {
        const dx = flyHomeX[i] - camX;
        const dz = flyHomeZ[i] - camZ;
        if (dx * dx + dz * dz > FIREFLY_RADIUS * FIREFLY_RADIUS) {
          if (!placeFly(i, camX, camZ)) {
            flyBaseY[i] = -1e6;
            flyColor[i * 3] = 0;
            flyColor[i * 3 + 1] = 0;
            flyColor[i * 3 + 2] = 0;
            continue;
          }
        }
        if (flyBaseY[i] < -1e5) continue;
        const wander = clock * flyDrift[i] + flyPhase[i] * 6.283;
        flyPos[i * 3] = flyHomeX[i] + Math.sin(wander) * 1.4;
        flyPos[i * 3 + 1] = flyBaseY[i] + flyLift[i] + Math.sin(wander * 1.7) * 0.35;
        flyPos[i * 3 + 2] = flyHomeZ[i] + Math.cos(wander * 0.75) * 1.4;
        const blink = fireflyBlink(clock, flyPhase[i]) * glow;
        flyColor[i * 3] = flyTint.r * blink;
        flyColor[i * 3 + 1] = flyTint.g * blink;
        flyColor[i * 3 + 2] = flyTint.b * blink;
      }
      flyPosAttr.needsUpdate = true;
      flyColorAttr.needsUpdate = true;
    },
  };
}
