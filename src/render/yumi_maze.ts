// Protect Yumi maze interior: procedural walls/floor/accents for the far-east
// maze band, one view per match slot, built lazily by the renderer when the
// player is near (the arena pattern). Geometry derives from the SAME
// yumiMazeLayout the sim collides against, so what you see is exactly what
// blocks movement, spells, and the camera. Also owns the two team beacons:
// tall translucent pillars over each cat, readable above the 5yd walls from
// anywhere in the maze and identical on every gfx tier (the objective's
// position is actionable info per the fairness invariant; nothing here is
// tier-gated).
import * as THREE from 'three';
import { groundHeight } from '../sim/world';
import { YUMI_MAZE_WALL_HEIGHT, yumiMazeLayout } from '../sim/yumi_maze_layout';
import type { IWorld } from '../world_api';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { surfaceMat } from './gfx';
import { stoneTexture } from './textures';

// GLB-backed static bodies (Tripo-generated, see public/models/props), with a
// procedural fallback for pre-load races / headless test hosts (mirrors the
// gather_nodes.ts pattern). Flames/lights stay procedural VFX either way.
type YumiMazeAssetKind = 'brazier_stand' | 'torch_handle';

const YUMI_MAZE_ASSET_URL: Record<YumiMazeAssetKind, string> = {
  brazier_stand: '/models/props/yumi_brazier_stand.glb',
  torch_handle: '/models/props/yumi_torch_handle.glb',
};

const loadedYumiMazeGltf = new Map<YumiMazeAssetKind, THREE.Group>();

if (typeof window !== 'undefined') {
  for (const [kind, url] of Object.entries(YUMI_MAZE_ASSET_URL) as [YumiMazeAssetKind, string][]) {
    registerPreload(
      loadGltf(url).then((gltf) => {
        loadedYumiMazeGltf.set(kind, gltf.scene);
      }),
    );
  }
}

function cloneYumiMazeAsset(kind: YumiMazeAssetKind): THREE.Object3D | null {
  const loaded = loadedYumiMazeGltf.get(kind);
  if (!loaded) return null;
  const inst = loaded.clone(true);
  inst.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return inst;
}

/** Test-only window into the preload asset set (mirrors gather_nodes.ts). */
export const yumiMazePreloadInternalsForTest = {
  yumiMazeAssetUrl: YUMI_MAZE_ASSET_URL,
};

const TEAM_BLUE = 0x2f6fe0;
const TEAM_RED = 0xd8342c;
const CENTER_GOLD = 0xcaa84a;
const WALL_COLOR = 0x8a8175;
const FLOOR_COLOR = 0x635c52;
const BEACON_HEIGHT = 12;
const BEACON_RADIUS = 0.7;
// Brazier lights ride the renderer's shared fire-light budget (the dungeon
// torch contract: flame cone -> flames[], PointLight with baseIntensity ->
// fireLights[], budgetFireLights enables the nearest GFX.maxPointLights).
// Values mirror the dungeon torches.
const BRAZIER_LIGHT_INTENSITY = 46;
const BRAZIER_LIGHT_DISTANCE = 36;
const BRAZIER_LIGHT_Y = 5.4;
const BRAZIER_FLAME_Y = 1.9;
const BRAZIER_FLAME_EMISSIVE = 2.2;
const WARM_FLAME = 0xffb054;

/** The renderer-owned pools the maze's braziers plug into. */
export interface YumiMazeLightHooks {
  flames: THREE.Mesh[];
  fireLights: THREE.PointLight[];
  lowGfx: boolean;
}

export interface YumiMazeView {
  group: THREE.Group;
  /** Per-frame: anchors the two team beacons to the live cat positions. */
  update(world: IWorld): void;
  /**
   * Fold a yumiTeleport event's landing spot into the beacon immediately.
   * Online, arenaInfo rides the 10s arena wire cadence, so without this the
   * beacon would mark the OLD cell for up to 10s after each teleport; the
   * beacon is actionable info and must be as fresh on every host as it is
   * offline (where arenaInfo is polled per frame).
   */
  noteTeleport(catId: number, x: number, z: number): void;
  dispose(): void;
}

export function buildYumiMaze(
  origin: { x: number; z: number },
  seed: number,
  lights: YumiMazeLightHooks,
): YumiMazeView {
  const group = new THREE.Group();
  const layout = yumiMazeLayout();
  const floorY = groundHeight(origin.x, origin.z, seed);
  group.position.set(origin.x, floorY, origin.z);

  // Walls: every stub (interior + shell) is one instance of a unit box,
  // scaled to its rect, so the whole maze is a single draw call.
  const stubs = [...layout.shell, ...layout.walls];
  const wallMat = surfaceMat({ color: WALL_COLOR, map: stoneTexture(), roughness: 0.9 });
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wallMat, stubs.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  for (let i = 0; i < stubs.length; i++) {
    const s = stubs[i];
    pos.set(s.x, YUMI_MAZE_WALL_HEIGHT / 2, s.z);
    scl.set(s.hw * 2, YUMI_MAZE_WALL_HEIGHT, s.hd * 2);
    m.compose(pos, q, scl);
    walls.setMatrixAt(i, m);
  }
  walls.instanceMatrix.needsUpdate = true;
  walls.castShadow = false;
  walls.receiveShadow = true;
  group.add(walls);

  // Floor: one plane over the whole footprint.
  const floorTex = stoneTexture().clone();
  floorTex.wrapS = THREE.RepeatWrapping;
  floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(12, 12);
  floorTex.needsUpdate = true;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(layout.halfExtent * 2 + 2, layout.halfExtent * 2 + 2),
    surfaceMat({ color: FLOOR_COLOR, map: floorTex, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.02;
  floor.receiveShadow = true;
  group.add(floor);

  // Team accents: an emissive pad under each spawn plaza, so orientation
  // reads at a glance (the center plaza is marked by its gold brazier alone).
  const plazaHalf = layout.pitch * 2 - layout.wallHalf * 2;
  const accent = (cx: number, cz: number, color: number) => {
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(plazaHalf, plazaHalf),
      surfaceMat({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.6 }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(cx, 0.05, cz);
    group.add(pad);
  };
  const spawnACenter = {
    x: (layout.spawnA[0].x + layout.spawnA[4].x) / 2,
    z: (layout.spawnA[0].z + layout.spawnA[4].z) / 2,
  };
  const spawnBCenter = {
    x: (layout.spawnB[0].x + layout.spawnB[4].x) / 2,
    z: (layout.spawnB[0].z + layout.spawnB[4].z) / 2,
  };
  accent(spawnACenter.x, spawnACenter.z, TEAM_BLUE);
  accent(spawnBCenter.x, spawnBCenter.z, TEAM_RED);

  // Plaza braziers: a proper bowl-on-pedestal at each of the five plazas
  // (team-colored flames at the spawns). Corridors are lit by wall torches
  // below, not freestanding posts. Every light joins the renderer's shared
  // budget, so tiers cap how many burn while the flames always show.
  const flameGeo = new THREE.ConeGeometry(0.24, 0.7, 6);
  const brazierFlameGeo = new THREE.ConeGeometry(0.38, 1.0, 7);
  const pedestalGeo = new THREE.CylinderGeometry(0.28, 0.52, 1.15, 8);
  const bowlGeo = new THREE.CylinderGeometry(0.62, 0.34, 0.42, 8);
  const pedestalMat = surfaceMat({ color: WALL_COLOR, roughness: 0.9 });
  const flameMat = (flameColor: number) =>
    new THREE.MeshLambertMaterial({
      color: flameColor,
      emissive: flameColor,
      emissiveIntensity: lights.lowGfx ? 1.6 : BRAZIER_FLAME_EMISSIVE,
      transparent: true,
      opacity: 0.92,
    });
  const fireLight = (bx: number, by: number, bz: number, flameColor: number) => {
    // Low tier keeps a stronger constructor intensity than the dungeon
    // torches (14 vs 10): the maze rooms are far wider than a crypt aisle,
    // so the same falloff reads darker.
    const light = new THREE.PointLight(flameColor, 16, BRAZIER_LIGHT_DISTANCE, 2);
    if (!lights.lowGfx) light.userData.baseIntensity = BRAZIER_LIGHT_INTENSITY;
    light.position.set(bx, by, bz);
    group.add(light);
    lights.fireLights.push(light);
  };
  const brazier = (bx: number, bz: number, flameColor: number) => {
    const stand = cloneYumiMazeAsset('brazier_stand');
    if (stand) {
      stand.position.set(bx, 0, bz);
      group.add(stand);
    } else {
      const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
      pedestal.position.set(bx, 0.58, bz);
      group.add(pedestal);
      const bowl = new THREE.Mesh(bowlGeo, pedestalMat);
      bowl.position.set(bx, 1.3, bz);
      group.add(bowl);
    }
    const flame = new THREE.Mesh(brazierFlameGeo, flameMat(flameColor));
    // The procedural bowl's rim sits at 1.51 (bowl y 1.3 + half its 0.42
    // height), which tucks the flame cone's 1.4 base inside it. The GLB
    // stand is only 1.30 tall, so re-seat the flame down to match its rim
    // instead of floating above it.
    flame.position.set(bx, stand ? BRAZIER_FLAME_Y - 0.1 : BRAZIER_FLAME_Y, bz);
    group.add(flame);
    lights.flames.push(flame);
    fireLight(bx, BRAZIER_LIGHT_Y, bz, flameColor);
  };
  // Every brazier sits OFF the cell centers (teleport destinations) and
  // clear of the corridor wall faces; the offsets keep the pedestal inside
  // the open floor of its cell whatever the wall pattern.
  const inward = (v: number, by: number) => v - Math.sign(v) * by;
  brazier(inward(spawnACenter.x, 1.8), inward(spawnACenter.z, 1.8), TEAM_BLUE);
  brazier(inward(spawnBCenter.x, 1.8), inward(spawnBCenter.z, 1.8), TEAM_RED);
  brazier(inward(layout.yumiStartA.x, 1.8), inward(layout.yumiStartA.z, 1.8), WARM_FLAME);
  brazier(inward(layout.yumiStartB.x, 1.8), inward(layout.yumiStartB.z, 1.8), WARM_FLAME);
  brazier(1.4, 1.4, CENTER_GOLD);

  // Wall torches: an angled handle + flame mounted on EVERY long wall run,
  // alternating faces, each with its own fire light, so corridors read
  // torch-lit end to end. The shared budget still caps how many burn at
  // once (nearest GFX.maxPointLights), so density costs pool entries, not
  // per-frame lighting work. Deterministic from the fixed layout (no rng).
  const handleGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.95, 5);
  const handleMat = surfaceMat({ color: 0x4a3a28, roughness: 0.95 });
  const torchRuns = layout.walls.filter((w) => Math.max(w.hw, w.hd) >= layout.pitch * 0.9);
  const torchY = YUMI_MAZE_WALL_HEIGHT * 0.55;
  for (let i = 0; i < torchRuns.length; i++) {
    const w = torchRuns[i];
    const vertical = w.hd > w.hw; // wall runs along z, faces point along x
    const side = i % 2 === 0 ? 1 : -1;
    const tx = w.x + (vertical ? side * (w.hw + 0.34) : 0);
    const tz = w.z + (vertical ? 0 : side * (w.hd + 0.34));
    const handleAsset = cloneYumiMazeAsset('torch_handle');
    if (handleAsset) {
      handleAsset.position.set(tx, torchY - 0.72, tz);
      handleAsset.rotation.y = vertical
        ? side > 0
          ? Math.PI / 2
          : -Math.PI / 2
        : side > 0
          ? 0
          : Math.PI;
      group.add(handleAsset);
    } else {
      const handle = new THREE.Mesh(handleGeo, handleMat);
      handle.position.set(tx, torchY - 0.28, tz);
      handle.rotation.z = vertical ? side * 0.35 : 0;
      handle.rotation.x = vertical ? 0 : -side * 0.35;
      group.add(handle);
    }
    const flame = new THREE.Mesh(flameGeo, flameMat(WARM_FLAME));
    flame.position.set(
      tx + (vertical ? side * 0.18 : 0),
      torchY + 0.28,
      tz + (vertical ? 0 : side * 0.18),
    );
    group.add(flame);
    lights.flames.push(flame);
    fireLight(tx, torchY + 1.6, tz, WARM_FLAME);
  }
  // The two cat beacons: world-anchored, so they live on the SCENE-space
  // subgroup (the cats' coordinates are world coords, not maze-local).
  const beacons = new THREE.Group();
  beacons.position.set(-origin.x, -floorY, -origin.z); // undo the group offset
  group.add(beacons);
  const beacon = (color: number) => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(BEACON_RADIUS, BEACON_RADIUS * 1.6, BEACON_HEIGHT, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    mesh.visible = false;
    beacons.add(mesh);
    return mesh;
  };
  const beaconA = beacon(TEAM_BLUE);
  const beaconB = beacon(TEAM_RED);
  const lastA = { x: Number.NaN, z: Number.NaN, on: false };
  const lastB = { x: Number.NaN, z: Number.NaN, on: false };
  // Teleport landing spots by cat entity id, ahead of the (online, 10s-cadence)
  // arenaInfo mirror. A cat only ever moves by teleporting, so the latest event
  // position is authoritative until arenaInfo catches up, at which point the
  // override is dropped. Cleared whenever no yumi match is visible.
  const teleported = new Map<number, { x: number; z: number }>();

  const place = (
    mesh: THREE.Mesh,
    last: { x: number; z: number; on: boolean },
    view: { entityId: number; x: number; z: number; alive: boolean } | undefined,
  ) => {
    const on = !!view?.alive;
    if (on !== last.on) {
      mesh.visible = on;
      last.on = on;
    }
    if (!view || !on) return;
    let px = view.x;
    let pz = view.z;
    const o = teleported.get(view.entityId);
    if (o) {
      if (o.x === view.x && o.z === view.z) teleported.delete(view.entityId);
      else {
        px = o.x;
        pz = o.z;
      }
    }
    if (px !== last.x || pz !== last.z) {
      const gy = groundHeight(px, pz, seed);
      mesh.position.set(px, gy + BEACON_HEIGHT / 2, pz);
      last.x = px;
      last.z = pz;
    }
  };

  return {
    group,
    update(world: IWorld): void {
      const yumi = world.arenaInfo?.match?.yumi;
      if (!yumi && teleported.size > 0) teleported.clear();
      place(beaconA, lastA, yumi?.yumiA);
      place(beaconB, lastB, yumi?.yumiB);
    },
    noteTeleport(catId: number, x: number, z: number): void {
      teleported.set(catId, { x, z });
    },
    dispose(): void {
      group.removeFromParent();
      walls.dispose();
    },
  };
}
