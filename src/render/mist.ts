import * as THREE from 'three';
import { DUNGEON_X_THRESHOLD, WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z } from '../sim/data';
import { terrainHeight, WATER_LEVEL, zoneBiomeAt } from '../sim/world';
import { GFX } from './gfx';

// ---------------------------------------------------------------------------
// Mirror World ground mist — a render-only field of thick, soft white mist
// banks that hug the vale floor and drift on a steady wind, giving the Vale of
// Glass its haunted-marsh ambience without the old draw-distance fog that
// crushed the view. Pure presentation: reads the world's terrain height + biome
// and never touches sim state. Like the mote/grass rings it is a player-centred
// pool that recycles banks as you walk and as the wind carries them past, and
// it fades itself out the moment you leave the mirror biome (or step indoors).
// ---------------------------------------------------------------------------

export interface MistView {
  group: THREE.Group;
  update(px: number, pz: number, dt: number): void;
}

const RADIUS = 62; // mist fills this ring around the player
// steady wind across the vale (xz direction); banks drift along it and the
// per-bank churn/billow rides the same clock so the whole field reads as wind
const WIND = new THREE.Vector2(0.86, 0.32).normalize();
const WIND_SPEED = 3.1; // units/sec — a visible, unhurried drift

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

// a soft, uneven mist puff: several overlapping feathered blobs so the edge
// reads wispy rather than a clean disc (no image assets)
function mistTexture(variantSeed: number): THREE.Texture {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;
  const rng = mulberry32(variantSeed);
  for (let i = 0; i < 8; i++) {
    const bx = s * (0.28 + rng() * 0.44);
    const by = s * (0.34 + rng() * 0.32);
    const br = s * (0.16 + rng() * 0.24);
    const a = 0.09 + rng() * 0.11;
    const grad = g.createRadialGradient(bx, by, 0, bx, by, br);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Bank {
  sp: THREE.Sprite;
  hx: number; // drifting home (moves with the wind)
  hz: number;
  hy: number; // height above the sampled ground
  sx: number; // base sprite scale (wide banks)
  sy: number;
  op: number; // base opacity — low; layered banks build the veil
  phase: number;
  rot: number; // slow per-bank churn rate
}

export function buildMist(seed: number): MistView {
  const group = new THREE.Group();
  group.name = 'mist';

  const count = GFX.standardMaterials ? 38 : 20;
  const rng = mulberry32(seed ^ 0x312157);
  const tex = [mistTexture(0x1a), mistTexture(0x2b), mistTexture(0x3c)];

  const banks: Bank[] = [];
  for (let i = 0; i < count; i++) {
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex[i % tex.length],
        transparent: true,
        depthWrite: false, // soft veils must layer, not punch holes
        opacity: 0,
        // mist is its own depth cue; letting scene fog also dim it double-darkens
        fog: false,
      }),
    );
    group.add(sp);
    banks.push({ sp, hx: 0, hz: 0, hy: 0, sx: 1, sy: 1, op: 0, phase: 0, rot: 0 });
  }

  // (re)home a bank to a fresh spot in the ring around the player
  function place(b: Bank, px: number, pz: number): void {
    const ang = rng() * Math.PI * 2;
    // keep a minimum radius so a big bank never spawns on the camera and whites
    // out the frame; sqrt → even areal spread across the rest of the ring
    const r = 8 + Math.sqrt(rng()) * (RADIUS - 8);
    b.hx = px + Math.cos(ang) * r;
    b.hz = pz + Math.sin(ang) * r;
    const big = rng();
    b.hy = 0.5 + rng() * 3.6; // hug the floor; a few banks ride a little higher
    b.sx = 20 + big * 32; // wide, flat banks
    b.sy = 11 + big * 15;
    b.op = 0.18 + rng() * 0.18;
    b.phase = rng() * Math.PI * 2;
    b.rot = (rng() - 0.5) * 0.05;
  }

  let seeded = false;
  let t = 0;
  let factor = 0; // eased mirror-biome presence (0 outside, 1 deep in the vale)

  return {
    group,
    update(px: number, pz: number, dt: number): void {
      const inMirror = px <= DUNGEON_X_THRESHOLD && zoneBiomeAt(pz) === 'mirror';
      factor += ((inMirror ? 1 : 0) - factor) * (1 - Math.exp(-dt * 1.5));
      if (factor < 0.01) {
        group.visible = false;
        seeded = false;
        return;
      }
      group.visible = true;
      if (!seeded) {
        for (const b of banks) place(b, px, pz);
        seeded = true;
      }
      t += dt;
      const wx = WIND.x * WIND_SPEED * dt;
      const wz = WIND.y * WIND_SPEED * dt;
      for (const b of banks) {
        b.hx += wx;
        b.hz += wz;
        const dx = b.hx - px;
        const dz = b.hz - pz;
        if (dx * dx + dz * dz > RADIUS * RADIUS) place(b, px, pz);
        // keep out of the void beyond the world edge
        if (Math.abs(b.hx) > WORLD_MAX_X || b.hz < WORLD_MIN_Z || b.hz > WORLD_MAX_Z) {
          b.sp.material.opacity = 0;
          continue;
        }
        // resample the ground so mist rides the terrain as it drifts
        const gh = terrainHeight(b.hx, b.hz, seed);
        const ph = b.phase + t * 0.5;
        b.sp.position.set(
          b.hx + Math.sin(ph) * 1.6,
          gh + b.hy + Math.sin(ph * 1.3) * 0.6,
          b.hz + Math.cos(ph * 0.7) * 1.6,
        );
        const billow = 0.72 + 0.28 * Math.sin(ph * 0.6);
        const overWater = gh < WATER_LEVEL + 0.3; // mist pools thicker on the mere
        const mat = b.sp.material as THREE.SpriteMaterial;
        mat.opacity = b.op * factor * billow * (overWater ? 1.25 : 1);
        mat.rotation = b.phase + t * b.rot;
        const puff = 0.9 + billow * 0.22;
        b.sp.scale.set(b.sx * puff, b.sy * puff, 1);
      }
    },
  };
}
