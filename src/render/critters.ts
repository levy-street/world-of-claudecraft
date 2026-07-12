// Ambient critters — small decorative wildlife (rabbits, squirrels, songbirds)
// that wander the overworld near the player for atmosphere. PRESENTATION ONLY:
// these have no presence in the sim/IWorld, so they cost nothing on the wire and
// "work online for free". A small pool follows the player like the grass ring
// (foliage.ts): when one drifts past the cull radius it relocates ahead of the
// camera onto valid ground. Each species is a small Tripo-generated GLB (see
// public/models/creatures/CLAUDE.md); a merged-primitive body is kept as a
// fallback for the brief window before the GLB preload resolves.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DUNGEON_X_THRESHOLD, WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z } from '../sim/data';
import { isInSowfieldShell } from '../sim/vale_cup_layout';
import { terrainHeight, terrainSteepnessAt, waterLevelAt } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { GFX } from './gfx';

export interface CritterField {
  group: THREE.Group;
  update(px: number, pz: number, dt: number): void;
}

const CULL_RADIUS = 36; // beyond this from the player a critter relocates
const SPAWN_MIN = 16; // relocate ring around the player (min..max yd)
const SPAWN_MAX = 30;
const FLEE_DIST = 6; // critters bolt when the player gets this close
const EDGE = 8; // keep clear of the world edges
// Same rise/run limit the sim's movement uses (MAX_CLIMB_SLOPE): wildlife stays
// off the unclimbable mountain walls and the world rim, like everything else.
const MAX_WALK_SLOPE = 1.5;

// The Eastbrook Vale / Mirefen Marsh boundary runs along the causeway at z=180.
// Cheerful overworld critters (rabbits/squirrels/songbirds) thin out as the dry
// vale gives way to the sunken fen, so we taper the active pool to a sparse
// floor across this band — fewest right on the causeway crossing.
const CAUSEWAY_Z = 180; // zone boundary between Eastbrook and Mirefen
const CAUSEWAY_FALLOFF = 80; // half-width (yd) of the thinned-out band
const CAUSEWAY_FLOOR = 0.3; // density multiplier at the centre of the band

// Smooth 1 → CAUSEWAY_FLOOR → 1 dip as the player crosses the causeway band.
export function causewayPopScale(pz: number): number {
  const t = Math.min(1, Math.abs(pz - CAUSEWAY_Z) / CAUSEWAY_FALLOFF);
  const eased = t * t * (3 - 2 * t); // smoothstep
  return CAUSEWAY_FLOOR + (1 - CAUSEWAY_FLOOR) * eased;
}

// A tiny seeded RNG so placement/wander variety stays off Math.random (matching
// the render layer's deterministic-generation convention).
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

type Species = 'rabbit' | 'squirrel' | 'bird';

// Build one merged body per species out of primitives, feet resting at y=0.
function buildSpeciesGeo(species: Species): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const sphere = (
    r: number,
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number,
  ) => {
    const g = new THREE.SphereGeometry(r, 8, 6);
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    parts.push(g);
  };
  if (species === 'bird') {
    sphere(0.1, 1, 0.9, 1.4, 0, 0.12, 0); // body
    sphere(0.07, 1, 1, 1, 0, 0.2, 0.1); // head
    const beak = new THREE.ConeGeometry(0.03, 0.08, 5);
    beak.rotateX(Math.PI / 2);
    beak.translate(0, 0.2, 0.18);
    parts.push(beak);
    for (const s of [-1, 1]) sphere(0.07, 1.4, 0.25, 0.8, s * 0.09, 0.13, 0); // wings
  } else {
    const big = species === 'rabbit';
    sphere(0.18, 1, 0.9, 1.3, 0, 0.16, 0); // body
    sphere(0.12, 1, 1, 1, 0, 0.26, 0.18); // head
    if (big) {
      for (const s of [-1, 1]) {
        // upright ears
        const ear = new THREE.BoxGeometry(0.04, 0.18, 0.03);
        ear.translate(s * 0.05, 0.4, 0.18);
        parts.push(ear);
      }
      sphere(0.06, 1, 1, 1, 0, 0.16, -0.18); // cottontail
    } else {
      sphere(0.13, 0.7, 1.5, 0.6, 0, 0.3, -0.2); // bushy squirrel tail
    }
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed())) ?? parts[0];
}

const TINT: Record<Species, number> = {
  rabbit: 0x9a8166,
  squirrel: 0xa05a30,
  bird: 0x6b8fb5,
};

const SPECIES_ASSET_URL: Record<Species, string> = {
  rabbit: '/models/creatures/rabbit_critter.glb',
  squirrel: '/models/creatures/squirrel_critter.glb',
  bird: '/models/creatures/songbird_critter.glb',
};

const loadedSpeciesGltf = new Map<Species, THREE.Group>();

if (typeof window !== 'undefined') {
  for (const [species, url] of Object.entries(SPECIES_ASSET_URL) as [Species, string][]) {
    registerPreload(
      loadGltf(url).then((gltf) => {
        loadedSpeciesGltf.set(species, gltf.scene);
      }),
    );
  }
}

/** Test-only window into the preload asset set (mirrors props.ts). */
export const critterPreloadInternalsForTest = {
  speciesAssetUrl: SPECIES_ASSET_URL,
};

interface Critter {
  obj: THREE.Object3D;
  species: Species;
  x: number;
  z: number;
  heading: number; // radians
  moving: boolean;
  speed: number;
  hopPhase: number;
  turnT: number; // until next heading/pause decision
  baseY: number; // hover height (birds) above ground
}

export function buildCritters(seed: number): CritterField {
  const group = new THREE.Group();
  group.name = 'critters';
  const rng = mulberry32(seed ^ 0x6c12a7);
  const count = GFX.standardMaterials ? 16 : 7;

  const geos: Record<Species, THREE.BufferGeometry> = {
    rabbit: buildSpeciesGeo('rabbit'),
    squirrel: buildSpeciesGeo('squirrel'),
    bird: buildSpeciesGeo('bird'),
  };
  const mats: Record<Species, THREE.Material> = {
    rabbit: matFor('rabbit'),
    squirrel: matFor('squirrel'),
    bird: matFor('bird'),
  };
  function matFor(s: Species): THREE.Material {
    const opts = { color: TINT[s], roughness: 0.85, metalness: 0 };
    return GFX.standardMaterials
      ? new THREE.MeshStandardMaterial(opts)
      : new THREE.MeshLambertMaterial({ color: TINT[s] });
  }

  const pickSpecies = (): Species => {
    const r = rng();
    return r < 0.45 ? 'rabbit' : r < 0.75 ? 'squirrel' : 'bird';
  };

  const buildInstance = (species: Species): THREE.Object3D => {
    const loaded = loadedSpeciesGltf.get(species);
    if (loaded) {
      // Unlike delve_props/mailbox, this is not Box3-normalized: it assumes each
      // species GLB is authored at world scale with feet at the origin (baseY
      // below is tuned for that). A re-export at a different scale or origin
      // will silently sink or oversize the critter.
      const inst = loaded.clone(true);
      inst.traverse((child) => {
        if (child instanceof THREE.Mesh) child.castShadow = GFX.standardMaterials;
      });
      return inst;
    }
    const mesh = new THREE.Mesh(geos[species], mats[species]);
    mesh.castShadow = GFX.standardMaterials;
    return mesh;
  };

  const critters: Critter[] = [];
  for (let i = 0; i < count; i++) {
    const species = pickSpecies();
    const obj = buildInstance(species);
    obj.visible = false;
    group.add(obj);
    critters.push({
      obj,
      species,
      x: 0,
      z: 0,
      heading: rng() * Math.PI * 2,
      moving: false,
      speed: 0,
      hopPhase: 0,
      turnT: 0,
      baseY: species === 'bird' ? 0.25 + rng() * 0.4 : 0,
    });
  }

  const validGround = (x: number, z: number): boolean => {
    if (Math.abs(x) > WORLD_MAX_X - EDGE) return false;
    if (z < WORLD_MIN_Z + EDGE || z > WORLD_MAX_Z - EDGE) return false;
    if (x > DUNGEON_X_THRESHOLD - 24) return false;
    if (isInSowfieldShell(x, z)) return false; // no wildlife on the football pitch
    if (terrainSteepnessAt(x, z, seed) > MAX_WALK_SLOPE) return false;
    return terrainHeight(x, z, seed) > waterLevelAt(x, z) + 0.8;
  };

  const relocate = (c: Critter, px: number, pz: number): void => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const ang = rng() * Math.PI * 2;
      const d = SPAWN_MIN + rng() * (SPAWN_MAX - SPAWN_MIN);
      const x = px + Math.cos(ang) * d;
      const z = pz + Math.sin(ang) * d;
      if (validGround(x, z)) {
        c.x = x;
        c.z = z;
        c.heading = rng() * Math.PI * 2;
        c.turnT = 0.5 + rng() * 2;
        c.moving = false;
        return;
      }
    }
    // no valid spot this frame — hide and retry next tick
    c.x = px;
    c.z = pz;
    c.obj.visible = false;
  };

  return {
    group,
    update(px: number, pz: number, dt: number): void {
      // no wildlife indoors (dungeons/arena live past the strip)
      if (px > DUNGEON_X_THRESHOLD) {
        if (group.visible) group.visible = false;
        return;
      }
      group.visible = true;

      // Thin the active pool across the Eastbrook↔Mirefen causeway band. The
      // tail of the array is parked (hidden, not relocated) so the survivors
      // keep their natural wander instead of the whole flock flickering.
      const active = Math.round(critters.length * causewayPopScale(pz));

      for (let i = 0; i < critters.length; i++) {
        const c = critters[i];
        if (i >= active) {
          if (c.obj.visible) c.obj.visible = false;
          continue;
        }
        const dx = c.x - px,
          dz = c.z - pz;
        const dist = Math.hypot(dx, dz);
        if (dist > CULL_RADIUS || !validGround(c.x, c.z)) {
          relocate(c, px, pz);
          continue;
        }

        // flee when the player closes in, else gentle wander
        let fleeing = false;
        if (dist < FLEE_DIST) {
          c.heading = Math.atan2(dz, dx); // away from player
          c.moving = true;
          fleeing = true;
        } else {
          c.turnT -= dt;
          if (c.turnT <= 0) {
            c.moving = rng() > 0.35;
            if (c.moving) c.heading += (rng() - 0.5) * 2.2;
            c.turnT = 0.6 + rng() * 2.4;
          }
        }

        const baseSpeed = c.species === 'bird' ? 2.4 : 1.5;
        c.speed = c.moving ? (fleeing ? baseSpeed * 2.4 : baseSpeed) : 0;
        if (c.speed > 0) {
          const nx = c.x + Math.cos(c.heading) * c.speed * dt;
          const nz = c.z + Math.sin(c.heading) * c.speed * dt;
          if (validGround(nx, nz)) {
            c.x = nx;
            c.z = nz;
            c.hopPhase += dt * (c.species === 'bird' ? 18 : 9);
          } else {
            // wall, water, or the world edge ahead: turn back instead of
            // hopping up a face nothing can walk
            c.heading += Math.PI + (rng() - 0.5);
            c.turnT = 0.4 + rng();
          }
        }

        const groundY = terrainHeight(c.x, c.z, seed);
        // rabbits/squirrels hop (sin arc while moving); birds bob in place
        const motion =
          c.species === 'bird'
            ? Math.sin(c.hopPhase) * 0.06
            : c.speed > 0
              ? Math.abs(Math.sin(c.hopPhase)) * 0.16
              : 0;
        c.obj.position.set(c.x, groundY + c.baseY + motion, c.z);
        c.obj.rotation.y = -c.heading + Math.PI / 2;
        c.obj.visible = true;
      }
    },
  };
}
