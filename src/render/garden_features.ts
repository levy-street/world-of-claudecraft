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
  MAZE_WALL_HEIGHT_SCALE,
  MAZE_WALL_SCALE,
  MAZE_Z1,
  type MazePieceSpot,
  planGardenMazePieces,
} from './garden_maze_core';
import { GFX } from './gfx';
import { greatTreeScale } from './great_tree_look_core';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import { activeWorldPromoted } from './promoted_scenery_gate';
import { prepareSceneryGeometryLod } from './scenery_geometry_lod';
import { applySurfaceDetail, GREAT_TREE_BARK_DETAIL, isBarkMaterialName } from './worn_stone';

export interface GardenFeaturesView {
  group: THREE.Group;
  update(time: number): void;
}

// The specimen elders reuse the twisted-elder model the Hollow, the
// Wraithwood, and the Palmreach already preload, regrown into clipped
// evergreen giants.
const GREAT_TREE_URL = '/models/foliage/twisted_1_lod.glb';
let greatTreeScene: THREE.Group | null = null;
registerDeferredPreload(() =>
  loadGltf(GREAT_TREE_URL).then((gltf) => {
    greatTreeScene = gltf.scene;
  }),
);

// The Great Maze's modeled hedge walls and entry arches (user-authored
// models). The wall grid, cell geometry, and the movement-blocking bands
// all live in sim/world.ts; this module only DRAWS that same data.
const MAZE_WALL_URL = '/models/props/maze_hedge_wall_lod.glb';
const MAZE_ARCH_URL = '/models/props/maze_hedge_arch_lod.glb';
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

// The four watchers of the Fountain Court: the painted castle kit's carved horse bust on
// its stepped plinth. (They were a box, a six-sided cylinder and two spheres under one flat
// marble tone, "kept abstract on purpose"; beside the modeled hedges they read as white
// posts, and the court looked better without them. They are the landmarks of the Four
// Statues quest and stay where they stood.)
const WATCHER_URL = '/models/biome/kcas_decor_statue.glb';
/** Raw model scale: the bust stands 3.7 yards at 1, a head over a walker like the old figure. */
const WATCHER_SCALE = 1;
let watcherScene: THREE.Group | null = null;
registerDeferredPreload(() =>
  loadGltf(WATCHER_URL).then((gltf) => {
    watcherScene = gltf.scene;
  }),
);

// (The modeled flower beds render and collide as decorProps through the
// props system now: PROP_ASSET_DEFS flowerBed* keys, placed by
// content/evergarden with world.ts GARDEN_BED_PADS leveling their ground.)

export const gardenFeaturesPreloadInternalsForTest = {
  mazeAssetUrl: { wall: MAZE_WALL_URL, arch: MAZE_ARCH_URL },
  setMazeScenes(wall: THREE.Group | null, arch: THREE.Group | null): void {
    mazeWallScene = wall;
    mazeArchScene = arch;
  },
  watcherAssetUrl: WATCHER_URL,
  setWatcherScene(scene: THREE.Group | null): void {
    watcherScene = scene;
  },
};

function mat(color: number, rough = 0.85): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  // smooth: the fountain is turned stone, and round at the segment counts below
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ color, roughness: rough })
    : new THREE.MeshLambertMaterial({ color });
}

function mazeMaterial(source: THREE.Material): THREE.Material {
  if (GFX.standardMaterials) return cloneMaterialWithHooks(source);
  const from = source as THREE.Material & {
    map?: THREE.Texture | null;
    color?: THREE.Color;
    emissive?: THREE.Color;
    side?: THREE.Side;
  };
  const out = new THREE.MeshLambertMaterial({
    map: from.map ?? null,
    color: from.color?.clone() ?? new THREE.Color(0xffffff),
    side: from.side ?? THREE.FrontSide,
    // the painted kit carries its shade in vertex colour (the watchers' bust)
    vertexColors: source.vertexColors,
  });
  if (from.emissive) out.emissive = from.emissive.clone();
  out.name = source.name;
  return out;
}

/** Where the four watchers stand, round the fountain at the maze's heart. */
export const WATCHER_SPOTS: readonly (readonly [number, number])[] = [
  [350, 1008],
  [370, 1008],
  [350, 1025],
  [370, 1025],
];

// The Fountain Court's centerpiece: a two-tier stone fountain with a still
// water disc in each basin (the shimmer is the water shader's job elsewhere;
// here a gentle emissive-free blue reads as water at court scale).
function buildFountain(x: number, z: number, y: number): THREE.Group {
  const g = new THREE.Group();
  const stone = mat(0xb8b4a6, 0.9);
  const water = new THREE.MeshBasicMaterial({ color: 0x69b8c4, transparent: true, opacity: 0.85 });
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.3, 0.9, 28), stone);
  basin.position.set(x, y + 0.45, z);
  g.add(basin);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(2.85, 28), water);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(x, y + 0.82, z);
  g.add(pool);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.7, 16), stone);
  column.position.set(x, y + 1.7, z);
  g.add(column);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 0.9, 0.5, 24), stone);
  bowl.position.set(x, y + 2.6, z);
  g.add(bowl);
  const bowlPool = new THREE.Mesh(new THREE.CircleGeometry(1.05, 24), water);
  bowlPool.rotation.x = -Math.PI / 2;
  bowlPool.position.set(x, y + 2.82, z);
  g.add(bowlPool);
  const finial = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.8, 12), stone);
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

export function buildGardenFeatures(
  seed: number,
  // The document may own the giants as placements (jungle_features doctrine):
  // the renderer copy stands down or the movable tree sits inside a ghost.
  renderGreatTrees = !activeWorldPromoted('greatTrees'),
): GardenFeaturesView {
  const group = new THREE.Group();
  group.name = 'garden-features';

  // --- the four watchers inside the Fountain Court: the kit's carved busts (the old
  // paired walk statues came down long ago) ---
  if (watcherScene) {
    watcherScene.updateMatrixWorld(true);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3(WATCHER_SCALE, WATCHER_SCALE, WATCHER_SCALE);
    watcherScene.traverse((obj) => {
      const src = obj as THREE.Mesh;
      if (!src.isMesh) return;
      // the loader cache is immutable and Low draws Lambert: the hedges' own material rule.
      // The GEOMETRY is the cache's own, shared and never disposed with this group (zone
      // features live for the session, like the hedge instances above).
      const material = Array.isArray(src.material)
        ? src.material.map((entry) => mazeMaterial(entry))
        : mazeMaterial(src.material);
      const mesh = new THREE.InstancedMesh(src.geometry, material, WATCHER_SPOTS.length);
      WATCHER_SPOTS.forEach(([x, z], i) => {
        // all four face the fountain
        q.setFromAxisAngle(up, Math.atan2(360 - x, 1016.5 - z));
        v.set(x, terrainHeight(x, z, seed) - 0.1, z);
        mesh.setMatrixAt(i, m.compose(v, q, sc).multiply(src.matrixWorld));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    });
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
    // `rise` clips a piece's height alone (sim/world.ts MAZE_WALL_HEIGHT_SCALE for the
    // walls; the entry arches keep their full authored rise, a walker passes under them).
    const instanceModel = (
      scene: THREE.Group | null,
      spots: MazePieceSpot[],
      s: number,
      rise = 1,
    ) => {
      if (!scene || spots.length === 0) return;
      scene.updateMatrixWorld(true);
      const bandOf = (sp: MazePieceSpot) => Math.min(3, Math.floor((MAZE_Z1 - sp.z) / 40));
      const bands: MazePieceSpot[][] = [[], [], [], []];
      for (const sp of spots) bands[bandOf(sp)].push(sp);
      scene.traverse((obj) => {
        const src = obj as THREE.Mesh;
        if (!src.isMesh) return;
        const material = Array.isArray(src.material)
          ? src.material.map((m) => mazeMaterial(m))
          : mazeMaterial(src.material);
        for (const band of bands) {
          if (band.length === 0) continue;
          const mesh = new THREE.InstancedMesh(src.geometry, material, band.length);
          const m = new THREE.Matrix4();
          const q = new THREE.Quaternion();
          const up = new THREE.Vector3(0, 1, 0);
          const v = new THREE.Vector3();
          const sc = new THREE.Vector3(s, s * rise, s);
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
    instanceModel(mazeWallScene, plan.walls, MAZE_WALL_SCALE, MAZE_WALL_HEIGHT_SCALE);
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
    const trees = renderGreatTrees ? (EVERGARDEN_PROPS.greatTrees ?? []) : [];
    if (greatTreeScene) {
      for (const t of trees) {
        const y = terrainHeight(t.x, t.z, seed);
        if (y < WATER_LEVEL) continue;
        const tree = greatTreeScene.clone(true);
        const scale = greatTreeScale(t.r, hash2(t.x, t.z, seed + 6301));
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

  if (GFX.sceneryGeometryLodDistance > 0) prepareSceneryGeometryLod(group);
  return {
    group,
    update(): void {
      // still air over still water: the fountain holds its pose, the global
      // wind shader sways the modeled foliage
    },
  };
}
