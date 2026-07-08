import * as THREE from 'three';
import { DUNGEON_X_THRESHOLD, WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z } from '../sim/data';
import type { BiomeId } from '../sim/types';
import { isInSowfieldShell } from '../sim/vale_cup_layout';
import { terrainHeight, waterLevelAt, zoneBiomeAt } from '../sim/world';
import { GFX } from './gfx';

// ---------------------------------------------------------------------------
// Ambient motes — a render-only field of drifting airborne specks (pollen in
// the vale, marsh spores, snow dust on the peaks) that float around the player
// to give each zone a little living atmosphere. Pure presentation: it reads the
// world's terrain height + biome and never touches sim state. The contract
// mirrors the grass ring in foliage.ts — a player-centred pool that recycles
// motes as you walk rather than rebuilding, and that hides itself indoors.
// ---------------------------------------------------------------------------

export interface MotesView {
  group: THREE.Group;
  update(px: number, pz: number, dt: number): void;
}

// per-biome speck colour — warm gold pollen, sickly green marsh spores, pale
// blue snow dust; kept lighter than GRASS_TINT so they read as glints in air
const MOTE_TINT: Record<BiomeId, number> = {
  vale: 0xf4e6a0,
  marsh: 0xb8d28a,
  peaks: 0xdce8f2,
  beach: 0xf6e8b0,
  desert: 0xecd9a0,
  volcano: 0xe8a070,
  cave: 0xa8c4b8,
};

const RADIUS = 26; // motes live within this ring of the player
const FLOOR = 0.6; // min height above the sampled ground
const CEIL = 3.4; // max height above the sampled ground

// deterministic per-render RNG (render convention: never Math.random)
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

// soft round glow sprite, built once on a canvas (no image assets)
function moteSprite(): THREE.Texture {
  const s = 32;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildMotes(seed: number): MotesView {
  const group = new THREE.Group();
  group.name = 'motes';

  // count scales with tier — cheap THREE.Points, so high/ultra can afford a
  // dense shimmer while low stays sparse
  const count = GFX.standardMaterials ? 80 : 30;
  const rng = mulberry32(seed ^ 0x57e3);

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  // per-mote animation state: drift phase, bob amplitude, base ground height
  const phase = new Float32Array(count);
  const bobAmp = new Float32Array(count);
  const baseY = new Float32Array(count);
  // horizontal home of each mote; the speck drifts a little around it
  const homeX = new Float32Array(count);
  const homeZ = new Float32Array(count);

  const tmpColor = new THREE.Color();

  // (re)home a single mote to a random spot inside the ring around the player,
  // re-sampling terrain + biome tint. Returns false when the spot is unusable
  // (out of bounds / over water) so the caller can leave the mote parked.
  function place(i: number, px: number, pz: number): boolean {
    const ang = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * RADIUS; // sqrt → even areal spread, not centre-clumped
    const x = px + Math.cos(ang) * r;
    const z = pz + Math.sin(ang) * r;
    if (Math.abs(x) > WORLD_MAX_X - 8 || z < WORLD_MIN_Z + 8 || z > WORLD_MAX_Z - 8) return false;
    if (isInSowfieldShell(x, z)) return false; // no pollen drifting over the mown pitch
    const h = terrainHeight(x, z, seed);
    if (h < waterLevelAt(x, z) + 0.5) return false; // no motes hovering over open water
    homeX[i] = x;
    homeZ[i] = z;
    baseY[i] = h;
    phase[i] = rng() * Math.PI * 2;
    bobAmp[i] = FLOOR + rng() * (CEIL - FLOOR);
    positions[i * 3] = x;
    positions[i * 3 + 1] = h + bobAmp[i];
    positions[i * 3 + 2] = z;
    tmpColor.setHex(MOTE_TINT[zoneBiomeAt(z)]);
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
    return true;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: GFX.standardMaterials ? 0.5 : 0.7,
    map: moteSprite(),
    vertexColors: true,
    transparent: true,
    depthWrite: false, // glows shouldn't punch holes in what's behind them
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    opacity: 0.85,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; // pool is centred on the player; bounds churn isn't worth it
  group.add(points);

  let seeded = false;
  let t = 0;

  return {
    group,
    update(px: number, pz: number, dt: number): void {
      if (px > DUNGEON_X_THRESHOLD) {
        group.visible = false; // dungeons live outside the strip — no motes indoors
        seeded = false;
        return;
      }
      group.visible = true;
      if (!seeded) {
        for (let i = 0; i < count; i++) {
          if (!place(i, px, pz)) baseY[i] = -1e6; // park unusable motes far below
        }
        seeded = true;
      }
      t += dt;
      for (let i = 0; i < count; i++) {
        // recycle a mote once the player has wandered out of its ring
        const dx = homeX[i] - px;
        const dz = homeZ[i] - pz;
        if (dx * dx + dz * dz > RADIUS * RADIUS) {
          if (!place(i, px, pz)) {
            baseY[i] = -1e6;
            continue;
          }
        }
        if (baseY[i] < -1e5) continue; // parked
        const ph = phase[i] + t * 0.6;
        positions[i * 3] = homeX[i] + Math.sin(ph) * 0.5;
        positions[i * 3 + 1] = baseY[i] + bobAmp[i] + Math.sin(ph * 1.3) * 0.35;
        positions[i * 3 + 2] = homeZ[i] + Math.cos(ph * 0.8) * 0.5;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  };
}
