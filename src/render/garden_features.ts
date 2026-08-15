// The Evergarden's dressing, render-only: the four marble watchers in the
// Fountain Court, the tiered fountain itself at the maze's heart, the Great
// Maze's modeled hedge walls and arches (planned by garden_maze_core over
// the wall grid world.ts owns, the same cells movement blocking reads), and
// the specimen elders at the greatTrees spots (the same records the sim's
// trunk colliders use). Same contract as the sibling realm modules: build
// once, update(time) animates.
import * as THREE from 'three';
import { EVERGARDEN_PROPS } from '../sim/content/evergarden';
import { hash2 } from '../sim/rng';
import { terrainHeight, WATER_LEVEL } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import {
  MAZE_ARCH_SCALE,
  MAZE_WALL_SCALE,
  MAZE_Z1,
  type MazePieceSpot,
  planGardenMazePieces,
} from './garden_maze_core';
import { GFX } from './gfx';
import { applySurfaceDetail, GREAT_TREE_BARK_DETAIL, isBarkMaterialName } from './worn_stone';

export interface GardenFeaturesView {
  group: THREE.Group;
  update(time: number): void;
}

const GARDEN_ZMIN = 700;
const GARDEN_ZMAX = 1260;

// The specimen elders reuse the twisted-elder model the Hollow, the
// Wraithwood, and the Palmreach already preload, regrown into clipped
// evergreen giants.
const GREAT_TREE_URL = '/models/foliage/twisted_1.glb';
let greatTreeScene: THREE.Group | null = null;
registerDeferredPreload(() =>
  loadGltf(GREAT_TREE_URL).then((gltf) => {
    greatTreeScene = gltf.scene;
  }),
);

// The Great Maze's modeled hedge walls and entry arches (user-authored
// models). The wall grid, cell geometry, and the movement-blocking bands
// all live in sim/world.ts; this module only DRAWS that same data.
const MAZE_WALL_URL = '/models/props/maze_hedge_wall.glb';
const MAZE_ARCH_URL = '/models/props/maze_hedge_arch.glb';
let mazeWallScene: THREE.Group | null = null;
let mazeArchScene: THREE.Group | null = null;
registerDeferredPreload(() =>
  loadGltf(MAZE_WALL_URL).then((gltf) => {
    mazeWallScene = gltf.scene;
  }),
);
registerDeferredPreload(() =>
  loadGltf(MAZE_ARCH_URL).then((gltf) => {
    mazeArchScene = gltf.scene;
  }),
);

// (The modeled flower beds render and collide as decorProps through the
// props system now: PROP_ASSET_DEFS flowerBed* keys, placed by
// content/evergarden with world.ts GARDEN_BED_PADS leveling their ground.)

export const gardenFeaturesPreloadInternalsForTest = {
  mazeAssetUrl: { wall: MAZE_WALL_URL, arch: MAZE_ARCH_URL },
};

function mat(color: number, rough = 0.85): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true })
    : new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function mergeGeos(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  for (const g of parts) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const norm = new Float32Array(total * 3);
  let off = 0;
  for (const g of parts) {
    pos.set(g.getAttribute('position').array as Float32Array, off);
    norm.set(g.getAttribute('normal').array as Float32Array, off);
    off += g.getAttribute('position').count * 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  return out;
}

// A weathered garden statue: a plinth, a robed figure, a bowed head. Kept
// abstract on purpose: at game distance it reads as statuary, not a person.
function statueGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const plinth = new THREE.BoxGeometry(1.5, 0.9, 1.5);
  plinth.translate(0, 0.45, 0);
  parts.push(plinth.toNonIndexed());
  const robe = new THREE.CylinderGeometry(0.28, 0.52, 2.1, 6);
  robe.translate(0, 0.9 + 1.05, 0);
  parts.push(robe.toNonIndexed());
  const shoulders = new THREE.SphereGeometry(0.34, 6, 5);
  shoulders.scale(1.2, 0.7, 0.9);
  shoulders.translate(0, 3.0, 0);
  parts.push(shoulders.toNonIndexed());
  const head = new THREE.SphereGeometry(0.2, 6, 5);
  head.translate(0.05, 3.32, 0.08); // bowed, a little forward
  parts.push(head.toNonIndexed());
  return mergeGeos(parts);
}

const MARBLE = 0xcfcdc2;

// The Fountain Court's centerpiece: a two-tier stone fountain with a still
// water disc in each basin (the shimmer is the water shader's job elsewhere;
// here a gentle emissive-free blue reads as water at court scale).
function buildFountain(x: number, z: number, y: number): THREE.Group {
  const g = new THREE.Group();
  const stone = mat(0xb8b4a6, 0.9);
  const water = new THREE.MeshBasicMaterial({ color: 0x69b8c4, transparent: true, opacity: 0.85 });
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.3, 0.9, 14), stone);
  basin.position.set(x, y + 0.45, z);
  g.add(basin);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(2.85, 14), water);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(x, y + 0.82, z);
  g.add(pool);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.7, 8), stone);
  column.position.set(x, y + 1.7, z);
  g.add(column);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 0.9, 0.5, 12), stone);
  bowl.position.set(x, y + 2.6, z);
  g.add(bowl);
  const bowlPool = new THREE.Mesh(new THREE.CircleGeometry(1.05, 12), water);
  bowlPool.rotation.x = -Math.PI / 2;
  bowlPool.position.set(x, y + 2.82, z);
  g.add(bowlPool);
  const finial = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.8, 6), stone);
  finial.position.set(x, y + 3.4, z);
  g.add(finial);
  g.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return g;
}

export function buildGardenFeatures(seed: number): GardenFeaturesView {
  const group = new THREE.Group();
  group.name = 'garden-features';

  const instance = (
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    spots: { x: number; z: number; y: number; s: number; rot: number; tint?: number }[],
    tinted = false,
  ) => {
    if (spots.length === 0) return;
    const mesh = new THREE.InstancedMesh(geo, material, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    spots.forEach((sp, i) => {
      q.setFromAxisAngle(up, sp.rot);
      v.set(sp.x, sp.y, sp.z);
      sc.set(sp.s, sp.s, sp.s);
      mesh.setMatrixAt(i, m.compose(v, q, sc));
      if (tinted && sp.tint !== undefined) mesh.setColorAt(i, new THREE.Color(sp.tint));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  };

  // --- the four marble watchers inside the Fountain Court (the old paired
  // walk statues came down: the white figures read as rubble pillars among
  // the new hedge and flower borders) ---
  {
    const spots: { x: number; z: number; y: number; s: number; rot: number }[] = [];
    for (const [x, z] of [
      [350, 1008],
      [370, 1008],
      [350, 1025],
      [370, 1025],
    ]) {
      const y = terrainHeight(x, z, seed);
      spots.push({
        x,
        z,
        y: y - 0.1,
        s: 1.05,
        rot: Math.atan2(360 - x, 1016.5 - z), // all four face the fountain
      });
    }
    instance(statueGeo(), mat(MARBLE, 0.75), spots);
  }

  // --- the fountain at the heart of the Great Maze ---
  {
    const y = terrainHeight(360, 1016.5, seed);
    if (y > WATER_LEVEL) group.add(buildFountain(360, 1016.5, y - 0.1));
  }

  // --- the Great Maze's modeled hedge walls and entry arches ---
  // The plan comes from garden_maze_core (which reads the sim's wall grid),
  // so the drawn hedges, the movement-blocking boxes, and the map painter
  // all derive from the same cells. Instances split into north-south bands
  // so the far half of the maze frustum-culls from inside it.
  {
    const instanceModel = (scene: THREE.Group | null, spots: MazePieceSpot[], s: number) => {
      if (!scene || spots.length === 0) return;
      scene.updateMatrixWorld(true);
      const bandOf = (sp: MazePieceSpot) => Math.min(3, Math.floor((MAZE_Z1 - sp.z) / 40));
      const bands: MazePieceSpot[][] = [[], [], [], []];
      for (const sp of spots) bands[bandOf(sp)].push(sp);
      scene.traverse((obj) => {
        const src = obj as THREE.Mesh;
        if (!src.isMesh) return;
        for (const band of bands) {
          if (band.length === 0) continue;
          const mesh = new THREE.InstancedMesh(src.geometry, src.material, band.length);
          const m = new THREE.Matrix4();
          const q = new THREE.Quaternion();
          const up = new THREE.Vector3(0, 1, 0);
          const v = new THREE.Vector3();
          const sc = new THREE.Vector3(s, s, s);
          band.forEach((sp, i) => {
            // sunk a quarter yard so overlapped piece ends seat into the
            // lawn together on the garden's gentle slopes
            q.setFromAxisAngle(up, sp.rot);
            v.set(sp.x, terrainHeight(sp.x, sp.z, seed) - 0.25, sp.z);
            mesh.setMatrixAt(i, m.compose(v, q, sc).multiply(src.matrixWorld));
          });
          mesh.instanceMatrix.needsUpdate = true;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.computeBoundingSphere();
          group.add(mesh);
        }
      });
    };
    const plan = planGardenMazePieces();
    instanceModel(mazeWallScene, plan.walls, MAZE_WALL_SCALE);
    instanceModel(mazeArchScene, plan.arches, MAZE_ARCH_SCALE);
  }

  // (The topiary forms retired entirely: even the clipped ball read as a
  // lollipop tree beside the walks. The garden's greenery is now the hedge
  // lines, the oaks, and the specimen elders below.)

  // --- the specimen elders: the twisted giant regrown clipped and green ---
  {
    const clipped = new Map<string, THREE.Material>();
    const clip = (source: THREE.Material): THREE.Material => {
      let m2 = clipped.get(source.uuid);
      if (!m2) {
        m2 = source.clone();
        const c = (m2 as THREE.MeshStandardMaterial).color;
        if (c) c.multiply(new THREE.Color(0.62, 0.98, 0.64));
        // giant specimen trunks take the coarse landmark bark grain
        if (isBarkMaterialName(source.name))
          applySurfaceDetail(m2 as THREE.MeshStandardMaterial, 'bark', GREAT_TREE_BARK_DETAIL);
        clipped.set(source.uuid, m2);
      }
      return m2;
    };
    const trees = EVERGARDEN_PROPS.greatTrees ?? [];
    if (greatTreeScene) {
      for (const t of trees) {
        const y = terrainHeight(t.x, t.z, seed);
        if (y < WATER_LEVEL) continue;
        const tree = greatTreeScene.clone(true);
        const scale = t.r * (2.4 + hash2(t.x, t.z, seed + 6301) * 0.5);
        tree.position.set(t.x, y - 0.2, t.z);
        tree.scale.setScalar(scale);
        tree.rotation.y = hash2(t.z, t.x, seed + 6311) * Math.PI * 2;
        tree.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.material = Array.isArray(mesh.material)
              ? mesh.material.map(clip)
              : clip(mesh.material);
          }
        });
        group.add(tree);
      }
    }
  }

  return {
    group,
    update(): void {
      // still air over still water: the fountain holds its pose, the global
      // wind shader sways the modeled foliage
    },
  };
}
