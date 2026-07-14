import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DUNGEON_X_THRESHOLD, WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z } from '../sim/data';
import { terrainHeight, waterLevel, waterLevelAt } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { GFX } from './gfx';

// Ambient leaping fish — a RENDER-ONLY decoration, no sim/IWorld/server state.
//
// Mirrors the player-centred-pool contract that foliage's grass ring,
// critters and motes use: a fixed pool of fish that recycle (we never grow
// the pool), each idling beneath the surface until it arcs out of the water,
// splashes, and re-enters. Fish only ever break water that is genuinely deep
// enough: we sample the SAME deterministic `terrainHeight`/`waterLevel()` the
// sim uses (the hard "terrain height = sim height" invariant), so a leap can
// never appear over dry land or a shoreline puddle.
//
// Placement RNG is a local mulberry32 seeded from the world seed — the render
// convention forbids Math.random so the ambient field is reproducible.
//
// The fish body is a small Tripo-generated GLB (see public/models/creatures/
// CLAUDE.md); a merged-primitive body is kept as a fallback for the brief
// window before the GLB preload resolves.

const FISH_ASSET_URL = '/models/creatures/leaping_fish.glb';
let loadedFishGltf: THREE.Group | null = null;

if (typeof window !== 'undefined') {
  registerPreload(
    loadGltf(FISH_ASSET_URL).then((gltf) => {
      loadedFishGltf = gltf.scene;
    }),
  );
}

/** Test-only window into the preload asset (mirrors props.ts). */
export const fishPreloadInternalsForTest = { fishAssetUrl: FISH_ASSET_URL };

const SPAWN_RADIUS = 72; // fish surface within this distance of the player
const MIN_RADIUS = 9; // ...but never right on top of the camera
const WATER_MARGIN = 1.6; // require this much depth so leaps avoid the foam line
const LEAP_DURATION = 1.15; // seconds spent out of the water
const LEAP_HEIGHT = 1.8; // arc apex above the surface (yards)
const LEAP_TRAVEL = 3.2; // horizontal distance covered across a leap
const REST_MIN = 1.4; // idle seconds between a fish's leaps
const REST_MAX = 7.0;
const RETRY_REST = 0.6; // shorter wait when no water was found nearby
const SPLASH_TIME = 0.42; // how long an entry/exit ripple lives
const SPLASH_MAX = 1.7; // ripple radius at full expansion
const PLACE_TRIES = 6; // attempts to find deep water per leap

export interface FishView {
  group: THREE.Group;
  /** per-frame: advance leaps and recycle idle fish near the player */
  update(px: number, pz: number, dt: number): void;
}

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

// PURE (unit-tested): vertical offset above the surface and body pitch for a
// fish `t` seconds into a leap of length `duration` and apex `height`. The
// path is a parabola (0 at both ends, `height` at the midpoint); pitch tracks
// the trajectory's slope so the fish noses up out of the water and dives back.
export function fishLeapPose(
  t: number,
  duration: number,
  height: number,
): { y: number; pitch: number } {
  const u = Math.max(0, Math.min(1, t / duration));
  const y = height * 4 * u * (1 - u);
  // vertical velocity ∝ d(y)/du = height*4*(1-2u); compare to forward travel
  const vy = height * 4 * (1 - 2 * u);
  const pitch = Math.atan2(vy, LEAP_TRAVEL * 1.6);
  return { y, pitch };
}

// PURE (unit-tested): is (x, z) deep, in-bounds open water fit for a leap?
// `depthAt` returns waterLevelAt() - terrainHeight at that spot (negative on
// land, and always negative outside every declared lake since waterLevelAt()
// is -Infinity there, so a dry sunken feature never gets fish).
export function isLeapableWater(
  x: number,
  z: number,
  depthAt: (x: number, z: number) => number,
): boolean {
  if (Math.abs(x) > WORLD_MAX_X - 8) return false;
  if (z < WORLD_MIN_Z + 8 || z > WORLD_MAX_Z - 8) return false;
  return depthAt(x, z) >= WATER_MARGIN;
}

type Phase = 'rest' | 'leap';

interface Fish {
  body: THREE.Object3D;
  splash: THREE.Mesh;
  phase: Phase;
  timer: number; // rest countdown / leap elapsed depending on phase
  ox: number; // leap origin (where it breaks the surface)
  oz: number;
  heading: number; // travel + facing yaw
  splashAt: number; // -1 = idle; otherwise seconds since the active ripple began
  splashX: number;
  splashZ: number;
}

// A small fish silhouette: a stretched ellipsoid body + a flat tail fin, merged
// into one geometry so every fish in the pool is one draw call's worth of mesh.
function fishGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.2, 10, 7);
  body.scale(0.46, 0.62, 2.5); // long and slim, swimming down +z
  const tail = new THREE.ConeGeometry(0.3, 0.46, 5);
  tail.rotateX(-Math.PI / 2); // point the cone down -z (behind the body)
  tail.scale(1, 0.42, 1); // flatten into a fin
  tail.translate(0, 0.04, -0.58);
  return mergeGeometries([body, tail]);
}

// A flat expanding ring used for the surface splash, laid in the XZ plane.
function splashGeometry(): THREE.RingGeometry {
  const ring = new THREE.RingGeometry(0.5, 1, 16);
  ring.rotateX(-Math.PI / 2);
  return ring;
}

const scratch = new THREE.Vector3();

export function buildFish(seed: number): FishView {
  const group = new THREE.Group();
  group.name = 'fish';
  const rng = mulberry32(seed ^ 0x515f1577);
  const count = GFX.standardMaterials ? 12 : 5;

  const bodyGeo = fishGeometry();
  const splashGeo = splashGeometry();
  const bodyMat = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        color: 0x7f97a6,
        roughness: 0.4,
        metalness: 0.55,
        emissive: 0x12303d,
        emissiveIntensity: 0.18,
      })
    : new THREE.MeshLambertMaterial({ color: 0x95a9b6 });
  const splashMat = new THREE.MeshBasicMaterial({
    color: 0xdff1ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const depthAt = (x: number, z: number): number => waterLevelAt(x, z) - terrainHeight(x, z, seed);

  const buildBody = (): THREE.Object3D => {
    if (loadedFishGltf) {
      // Not Box3-normalized: assumes the fish GLB is authored at world scale
      // with its body centered at the origin, same assumption as critters.ts.
      // A re-export at a different scale or origin will silently sink or
      // oversize the fish.
      const inst = loadedFishGltf.clone(true);
      inst.traverse((child) => {
        if (child instanceof THREE.Mesh) child.castShadow = GFX.standardMaterials;
      });
      return inst;
    }
    return new THREE.Mesh(bodyGeo, bodyMat);
  };

  const fish: Fish[] = [];
  for (let i = 0; i < count; i++) {
    const body = buildBody();
    body.visible = false;
    const splash = new THREE.Mesh(splashGeo, splashMat.clone());
    splash.visible = false;
    group.add(body, splash);
    fish.push({
      body,
      splash,
      phase: 'rest',
      timer: REST_MIN + (rng() * (REST_MAX - REST_MIN) * (i + 1)) / count, // stagger the first wave
      ox: 0,
      oz: 0,
      heading: 0,
      splashAt: -1,
      splashX: 0,
      splashZ: 0,
    });
  }

  // place a fish's next leap at deep water near the player; false = none found
  const seekWater = (f: Fish, px: number, pz: number): boolean => {
    for (let t = 0; t < PLACE_TRIES; t++) {
      const ang = rng() * Math.PI * 2;
      const r = MIN_RADIUS + rng() * (SPAWN_RADIUS - MIN_RADIUS);
      const x = px + Math.cos(ang) * r;
      const z = pz + Math.sin(ang) * r;
      if (!isLeapableWater(x, z, depthAt)) continue;
      f.ox = x;
      f.oz = z;
      f.heading = rng() * Math.PI * 2;
      return true;
    }
    return false;
  };

  const startSplash = (f: Fish, x: number, z: number): void => {
    f.splashAt = 0;
    f.splashX = x;
    f.splashZ = z;
  };

  const animateSplash = (f: Fish, dt: number): void => {
    if (f.splashAt < 0) {
      f.splash.visible = false;
      return;
    }
    f.splashAt += dt;
    const u = f.splashAt / SPLASH_TIME;
    if (u >= 1) {
      f.splashAt = -1;
      f.splash.visible = false;
      return;
    }
    const s = 0.3 + u * SPLASH_MAX;
    f.splash.position.set(f.splashX, waterLevel() + 0.02, f.splashZ);
    f.splash.scale.set(s, 1, s);
    (f.splash.material as THREE.MeshBasicMaterial).opacity = (1 - u) * 0.7;
    f.splash.visible = true;
  };

  return {
    group,
    update(px: number, pz: number, dt: number): void {
      // no fish indoors — dungeon instances live far past the strip
      if (px > DUNGEON_X_THRESHOLD) {
        if (group.visible) group.visible = false;
        return;
      }
      group.visible = true;

      for (const f of fish) {
        if (f.phase === 'rest') {
          f.timer -= dt;
          if (f.timer <= 0) {
            if (seekWater(f, px, pz)) {
              f.phase = 'leap';
              f.timer = 0;
              startSplash(f, f.ox, f.oz); // surface break ripple
            } else {
              f.timer = RETRY_REST; // no water nearby — try again shortly
            }
          }
        } else {
          f.timer += dt;
          const { y, pitch } = fishLeapPose(f.timer, LEAP_DURATION, LEAP_HEIGHT);
          const travel = (f.timer / LEAP_DURATION) * LEAP_TRAVEL;
          const x = f.ox + Math.sin(f.heading) * travel;
          const z = f.oz + Math.cos(f.heading) * travel;
          f.body.position.set(x, waterLevel() + y, z);
          f.body.rotation.set(0, 0, 0);
          f.body.rotateY(f.heading);
          f.body.rotateX(-pitch);
          // a slight roll + the arc make the silver flank catch the light
          f.body.rotateZ(Math.sin(f.timer * 9) * 0.25);
          f.body.visible = true;
          if (f.timer >= LEAP_DURATION) {
            f.phase = 'rest';
            f.timer = REST_MIN + rng() * (REST_MAX - REST_MIN);
            f.body.visible = false;
            startSplash(f, x, z); // re-entry ripple where it lands
          }
        }
        animateSplash(f, dt);
      }
    },
  };
}
