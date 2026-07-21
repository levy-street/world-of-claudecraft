import * as THREE from 'three';
import { DUNGEON_X_THRESHOLD } from '../sim/data';
import { GFX } from './gfx';

// Ambient high-altitude BIRD FLOCK — a render-only flourish, no sim state.
// A small V-formation of dark silhouettes drifts across the sky high above the
// player, wings flapping in a travelling wave. Distinct from ground critters
// and airborne motes: birds live in the sky band, far above terrain, and never
// interact with the world. Follows the foliage/clouds contract: a fixed pool is
// recycled around the moving player, never rebuilt, with no per-frame allocs.

export interface BirdsView {
  group: THREE.Group;
  update(px: number, pz: number, dt: number): void;
}

// Local seeded PRNG — render convention is never to touch Math.random so the
// flock is reproducible per world seed (mirrors foliage's hashing discipline).
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

const SPAWN_RADIUS = 120; // where a recycled flock re-enters around the player
const DESPAWN_RADIUS = 165; // once the flock drifts past this it is recycled
const ALT_MIN = 54;
const ALT_MAX = 82;
const SPEED_MIN = 5;
const SPEED_MAX = 9;
const WING_LEN = 1.7;
const WING_CHORD = 0.75;
const FLAP_AMP = 0.55;

interface Bird {
  obj: THREE.Group;
  lw: THREE.Mesh;
  rw: THREE.Mesh;
  ox: number; // formation offset, flock-local (lateral)
  oz: number; // formation offset, flock-local (along travel)
  oy: number; // altitude jitter within the flock
  flapSpeed: number;
  flapPhase: number;
  bobAmp: number;
}

function buildBird(mat: THREE.Material): Bird {
  const obj = new THREE.Group();

  // Each wing is a flat quad pivoting at the shoulder (origin), lying in the
  // XZ plane and extending along ±X with its chord along Z. Flapping then rides
  // a single rotation about the forward (Z) axis — no Euler-order surprises.
  const leftGeo = new THREE.PlaneGeometry(WING_LEN, WING_CHORD);
  leftGeo.rotateX(-Math.PI / 2);
  leftGeo.translate(WING_LEN / 2, 0, 0);
  const rightGeo = new THREE.PlaneGeometry(WING_LEN, WING_CHORD);
  rightGeo.rotateX(-Math.PI / 2);
  rightGeo.translate(-WING_LEN / 2, 0, 0);

  const lw = new THREE.Mesh(leftGeo, mat);
  const rw = new THREE.Mesh(rightGeo, mat);
  obj.add(lw, rw);

  return {
    obj,
    lw,
    rw,
    ox: 0,
    oz: 0,
    oy: 0,
    flapSpeed: 0,
    flapPhase: 0,
    bobAmp: 0,
  };
}

export function buildBirds(seed: number): BirdsView {
  const rand = mulberry32((seed ^ 0x5f3b21) >>> 0);
  const group = new THREE.Group();
  group.name = 'birds';

  // Dark, double-sided, fog-aware silhouettes — read as specks against the sky
  // and fade into the haze at the rim like the clouds do.
  const mat = new THREE.MeshBasicMaterial({
    color: 0x2b2f38,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.82,
    fog: true,
    depthWrite: false,
  });

  const count = GFX.standardMaterials ? 14 : 6;
  const birds: Bird[] = [];
  for (let i = 0; i < count; i++) {
    const b = buildBird(mat);
    // Loose V-formation: pairs fan out behind a leader, left/right alternating.
    const rank = Math.ceil(i / 2);
    const side = i % 2 === 0 ? 1 : -1;
    b.ox = side * rank * (2.4 + rand() * 0.8);
    b.oz = -rank * (2.6 + rand() * 0.9) - rand() * 1.5;
    b.oy = (rand() - 0.5) * 3.0;
    b.flapSpeed = 5.5 + rand() * 3.5;
    b.flapPhase = rand() * Math.PI * 2;
    b.bobAmp = 0.4 + rand() * 0.5;
    const s = 0.7 + rand() * 0.7; // size variety = fake depth
    b.obj.scale.setScalar(s);
    birds.push(b);
    group.add(b.obj);
  }

  // Flock state, in absolute world coords. Lazily seeded on the first update
  // once we know where the player actually is.
  let cx = 0;
  let cz = 0;
  let cy = (ALT_MIN + ALT_MAX) / 2;
  let heading = 0;
  let speed = SPEED_MIN;
  let phase = 0;
  let seeded = false;

  function reseat(px: number, pz: number): void {
    const bearing = rand() * Math.PI * 2;
    cx = px + Math.sin(bearing) * SPAWN_RADIUS;
    cz = pz + Math.cos(bearing) * SPAWN_RADIUS;
    cy = ALT_MIN + rand() * (ALT_MAX - ALT_MIN);
    // Aim roughly back across the player's neighbourhood, with a lateral skew
    // so the flock crosses the sky rather than flying straight at the camera.
    const toPlayer = Math.atan2(px - cx, pz - cz);
    heading = toPlayer + (rand() - 0.5) * 1.3;
    speed = SPEED_MIN + rand() * (SPEED_MAX - SPEED_MIN);
  }

  function update(px: number, pz: number, dt: number): void {
    // No birds inside dungeons / arena interiors — the sky isn't rendered there.
    group.visible = px <= DUNGEON_X_THRESHOLD;
    if (!group.visible) return;

    if (!seeded) {
      reseat(px, pz);
      seeded = true;
    }

    cx += Math.sin(heading) * speed * dt;
    cz += Math.cos(heading) * speed * dt;
    phase += dt;

    const dx = cx - px;
    const dz = cz - pz;
    if (dx * dx + dz * dz > DESPAWN_RADIUS * DESPAWN_RADIUS) reseat(px, pz);

    const sh = Math.sin(heading);
    const ch = Math.cos(heading);
    for (const b of birds) {
      // Rotate the flock-local formation offset into world space by heading.
      const wx = b.ox * ch + b.oz * sh;
      const wz = -b.ox * sh + b.oz * ch;
      const bob = Math.sin(phase * 0.6 + b.flapPhase) * b.bobAmp;
      b.obj.position.set(cx + wx, cy + b.oy + bob, cz + wz);
      b.obj.rotation.y = heading;

      // Travelling-wave flap: rank further back lags, so the flock ripples.
      const flap = Math.sin(phase * b.flapSpeed + b.flapPhase + b.oz * 0.5) * FLAP_AMP;
      b.lw.rotation.z = flap;
      b.rw.rotation.z = -flap;
    }
  }

  return { group, update };
}
