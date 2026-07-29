// The Palmreach's dressing: the three shipped beach-palm models instanced over
// the beach shelf, giant vine-hung banyans at the greatTrees spots (the same
// records the sim's trunk colliders use), and vine curtains under their crowns.
// The palms' placement AND their trunk colliders come from reachPalmSpots(seed)
// in world.ts, so what you see on the strand is exactly what the sim blocks.
// Same contract as the sibling realm modules: build once, update(time) animates
// gently.
import * as THREE from 'three';
import { PALMREACH_PROPS, PALMREACH_ZONE } from '../sim/content/palmreach';
import { REACH_DECKS, reachDeckClear } from '../sim/reach_decks';
import { hash2 } from '../sim/rng';
import {
  isCliffFace,
  type ReachPalm,
  reachPalmSpots,
  roadDistance,
  terrainHeight,
  WATER_LEVEL,
} from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { buildDeckWood } from './deck_render';
import { GFX } from './gfx';

export interface JungleFeaturesView {
  group: THREE.Group;
  update(time: number): void;
}

// The three beach-palm models, instanced per variant so the whole strand is a
// handful of draws. Preloaded at import; buildJungleFeatures reads the cache.
const PALM_URLS = [
  '/models/biome/beach_palm_1.glb',
  '/models/biome/beach_palm_2.glb',
  '/models/biome/beach_palm_3.glb',
];
const palmScenes: (THREE.Group | null)[] = [null, null, null];
PALM_URLS.forEach((url, i) => {
  registerPreload(
    loadGltf(url).then((gltf) => {
      palmScenes[i] = gltf.scene;
    }),
  );
});

export interface PalmPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
}

/** Baked parts for one of the three beach-palm variants (null before the
 * preload resolves); shared with render/farshore_features.ts. */
export function bakedPalmVariant(variant: number): PalmPart[] | null {
  const scene = palmScenes[variant];
  return scene ? bakePalmParts(scene) : null;
}

// Bake a preloaded palm GLB into instanceable parts. The shipped models are
// meshopt-quantized, so attributes are converted to float32 before the node
// transform is folded into the geometry; writing world-space values back into
// normalized int16 attributes would clip (same recipe as foliage.ts).
function bakePalmParts(scene: THREE.Group): PalmPart[] {
  scene.updateMatrixWorld(true);
  const parts: PalmPart[] = [];
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.geometry;
    const geo = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const attr = src.getAttribute(name);
      if (!attr) continue;
      const out = new Float32Array(attr.count * attr.itemSize);
      for (let i = 0; i < attr.count; i++)
        for (let j = 0; j < attr.itemSize; j++)
          out[i * attr.itemSize + j] = attr.getComponent(i, j);
      geo.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
    }
    if (src.index) geo.setIndex(src.index.clone());
    geo.applyMatrix4(mesh.matrixWorld);
    parts.push({ geometry: geo, material: mesh.material });
  });
  return parts;
}

// The banyans reuse the twisted-elder model the Hollow's centerpiece and the
// Wraithwood's giants wear (already preloaded twice over, so free), regrown
// lush and hung with vines.
const GREAT_TREE_URL = '/models/foliage/twisted_1.glb';
let greatTreeScene: THREE.Group | null = null;
registerPreload(
  loadGltf(GREAT_TREE_URL).then((gltf) => {
    greatTreeScene = gltf.scene;
  }),
);

// The ground props: the maintainer's generated fallen-coconut clusters
// (built by build_palmreach_props.mjs), plus the Willowfen's lily rafts and
// river reeds reused on the Palmreach's still water.
const REACH_PROP_URLS = {
  coconuts: '/models/props/fallen_coconuts.glb',
  lilies: '/models/props/fen_lilies.glb',
  reeds: '/models/props/fen_reeds.glb',
} as const;
type ReachPropKey = keyof typeof REACH_PROP_URLS;
const propScenes: Partial<Record<ReachPropKey, THREE.Group>> = {};
for (const key of Object.keys(REACH_PROP_URLS) as ReachPropKey[]) {
  registerPreload(
    loadGltf(REACH_PROP_URLS[key]).then((gltf) => {
      propScenes[key] = gltf.scene;
    }),
  );
}

export const jungleFeaturesPreloadInternalsForTest = {
  propUrls: [...PALM_URLS, GREAT_TREE_URL, ...Object.values(REACH_PROP_URLS)],
};

export interface Placement {
  x: number;
  y: number;
  z: number;
  s: number;
  rot: number;
}

/** The fallen-coconut clusters dropped around the strand's palm trunks: a pure
 * function of the world seed (placement only, no Three types), so both hosts
 * and a Vitest agree on where they land. Each cluster snaps to terrainHeight at
 * its exact (x, z), so a cliff face would throw it up the wall; isCliffFace
 * rejects those the same way it rejects the palm that carried them. */
export function reachCoconutSpots(seed: number): Placement[] {
  const spots: Placement[] = [];
  for (const sp of reachPalmSpots(seed)) {
    if (hash2(sp.x, sp.z, seed + 5301) > 0.55) continue;
    const n = 2 + Math.floor(hash2(sp.z, sp.x, seed + 5311) * 2);
    for (let k = 0; k < n; k++) {
      const ang = hash2(sp.x + k, sp.z, seed + 5321) * Math.PI * 2;
      const dist = 2.6 + hash2(sp.x, sp.z + k, seed + 5331) * 2.2;
      const x = sp.x + Math.sin(ang) * dist;
      const z = sp.z + Math.cos(ang) * dist;
      const y = terrainHeight(x, z, seed);
      if (y < WATER_LEVEL + 0.4) continue;
      if (roadDistance(x, z) < 3) continue;
      if (!reachDeckClear(x, z, 0.8)) continue;
      if (isCliffFace(x, z, seed)) continue;
      spots.push({
        x,
        z,
        y: y - 0.04,
        s: 3.0 + hash2(k, sp.x, seed + 5341) * 1.75,
        rot: hash2(z, x, seed + 5351) * Math.PI * 2,
      });
    }
  }
  return spots;
}

// bake a loaded scene into (geometry, material) parts: world matrices
// applied, the whole model re-based so xz is centered and min-y sits at 0
// (the fen_features idiom)
function extractParts(scene: THREE.Group): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  scene.updateMatrixWorld(true);
  const parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld);
    parts.push({ geo, mat: mesh.material as THREE.Material });
  });
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geo.computeBoundingBox();
    box.union(p.geo.boundingBox as THREE.Box3);
  }
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  for (const p of parts) {
    p.geo.translate(-cx, -box.min.y, -cz);
    p.geo.computeBoundingBox();
    p.geo.computeBoundingSphere();
  }
  return parts;
}

// merge a pile of box geometries into one mesh (position + normal only)
function mergeBoxes(parts: THREE.BufferGeometry[], material: THREE.Material): THREE.Mesh {
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
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function mat(color: number, rough = 0.85): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true })
    : new THREE.MeshLambertMaterial({ color, flatShading: true });
}

export function buildJungleFeatures(seed: number): JungleFeaturesView {
  const group = new THREE.Group();
  group.name = 'jungle-features';

  const instance = (geo: THREE.BufferGeometry, material: THREE.Material, spots: Placement[]) => {
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
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  };
  const instanceProp = (key: ReachPropKey, spots: Placement[]): void => {
    const scene = propScenes[key];
    if (!scene || spots.length === 0) return;
    for (const part of extractParts(scene)) {
      instance(part.geo, part.mat, spots);
    }
  };

  // --- the palms: the three beach models instanced across the strand, each
  // at the deterministic spot (world.ts) the sim also gives a trunk collider,
  // so the strand you walk matches the one the sim blocks ---
  {
    const byVariant: ReachPalm[][] = [[], [], []];
    for (const sp of reachPalmSpots(seed)) byVariant[sp.variant]?.push(sp);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    byVariant.forEach((list, variant) => {
      const scene = palmScenes[variant];
      if (!scene || list.length === 0) return;
      for (const part of bakePalmParts(scene)) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        list.forEach((sp, i) => {
          q.setFromAxisAngle(up, sp.rot);
          v.set(sp.x, sp.y, sp.z);
          sc.set(sp.scale, sp.scale, sp.scale);
          mesh.setMatrixAt(i, m.compose(v, q, sc));
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        group.add(mesh);
      }
    });
  }

  // --- the fallen coconuts: clusters dropped around the palm trunks ---
  instanceProp('coconuts', reachCoconutSpots(seed));

  // --- the still water dressing: lily rafts and reeds on the lakes ---
  {
    const lilySpots: Placement[] = [];
    const reedSpots: Placement[] = [];
    for (const lake of PALMREACH_ZONE.lakes) {
      const lilies = 2 + Math.floor(hash2(lake.z, lake.x, seed + 5401) * 3);
      for (let k = 0; k < lilies; k++) {
        const ang = hash2(k * 3, lake.x, seed + 5411) * Math.PI * 2;
        const dist = Math.sqrt(hash2(lake.z, k * 5, seed + 5421)) * lake.radius * 0.7;
        const x = lake.x + Math.sin(ang) * dist;
        const z = lake.z + Math.cos(ang) * dist;
        if (terrainHeight(x, z, seed) > WATER_LEVEL - 0.7) continue;
        if (!reachDeckClear(x, z, 1)) continue;
        lilySpots.push({
          x,
          z,
          y: WATER_LEVEL + 0.03,
          s: 3.5 + hash2(lake.x, k + 11, seed + 5441) * 2,
          rot: hash2(k, lake.x + 7, seed + 5431) * Math.PI * 2,
        });
      }
      const reeds = 4 + Math.floor(hash2(lake.x + 3, lake.z, seed + 5451) * 3);
      for (let k = 0; k < reeds; k++) {
        const ang = hash2(k * 7, lake.z, seed + 5461) * Math.PI * 2;
        for (let dist = lake.radius * 0.9; dist < lake.radius * 1.7; dist += 0.6) {
          const x = lake.x + Math.sin(ang) * dist;
          const z = lake.z + Math.cos(ang) * dist;
          const y = terrainHeight(x, z, seed);
          if (y < WATER_LEVEL - 0.45 || y > WATER_LEVEL + 0.25) continue;
          if (roadDistance(x, z) < 4) break;
          if (!reachDeckClear(x, z, 1)) break;
          reedSpots.push({
            x,
            z,
            y: y - 0.1,
            s: 2.6 + hash2(lake.z, k + 5, seed + 5471) * 1.2,
            rot: hash2(k, lake.x + 13, seed + 5481) * Math.PI * 2,
          });
          break;
        }
      }
    }
    instanceProp('lilies', lilySpots);
    instanceProp('reeds', reedSpots);
  }

  // --- the walkways: river bridges and lagoon decks on stilts, planked
  // and railed all round (the shared builder, REACH_DECKS underfoot) ---
  {
    const wood = mat(0x9a7f5e, 0.9);
    const postWood = mat(0x77604a, 0.92);
    const { planks, posts } = buildDeckWood(
      REACH_DECKS,
      (x, z) => terrainHeight(x, z, seed),
      WATER_LEVEL,
      { railAll: true },
    );
    group.add(mergeBoxes(planks, wood));
    group.add(mergeBoxes(posts, postWood));
  }

  // --- the banyans: the twisted elder regrown lush, hung with vines ---
  {
    const lushened = new Map<string, THREE.Material>();
    const lushen = (source: THREE.Material): THREE.Material => {
      let m2 = lushened.get(source.uuid);
      if (!m2) {
        m2 = source.clone();
        const c = (m2 as THREE.MeshStandardMaterial).color;
        if (c) c.multiply(new THREE.Color(0.75, 1.05, 0.7));
        lushened.set(source.uuid, m2);
      }
      return m2;
    };
    const vineGeo = new THREE.CylinderGeometry(0.05, 0.028, 1, 3);
    vineGeo.translate(0, -0.5, 0); // hangs from its anchor
    const vineMats = [mat(0x4a8c46, 0.9), mat(0x6aa858, 0.9)]; // two-tone curtain
    const vineSpots: { x: number; z: number; y: number; s: number; rot: number }[][] = [[], []];
    const rootParts: THREE.BufferGeometry[] = [];
    const barkMat = mat(0x6a5a48, 0.92);
    const trees = PALMREACH_PROPS.greatTrees ?? [];
    if (greatTreeScene) {
      for (const t of trees) {
        const y = terrainHeight(t.x, t.z, seed);
        if (y < WATER_LEVEL) continue;
        const tree = greatTreeScene.clone(true);
        const scale = t.r * (2.5 + hash2(t.x, t.z, seed + 5201) * 0.5);
        tree.position.set(t.x, y - 0.2, t.z);
        tree.scale.setScalar(scale);
        tree.rotation.y = hash2(t.z, t.x, seed + 5211) * Math.PI * 2;
        tree.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.material = Array.isArray(mesh.material)
              ? mesh.material.map(lushen)
              : lushen(mesh.material);
          }
        });
        group.add(tree);
        // the buttress roots: tapered flares leaning into the trunk base,
        // so the giant reads rooted instead of set down
        const roots = 5 + Math.floor(hash2(t.z, t.x, seed + 5271) * 3);
        for (let k = 0; k < roots; k++) {
          const ang = (k / roots) * Math.PI * 2 + hash2(k, t.z, seed + 5281) * 0.8;
          const len = t.r * (1.1 + hash2(t.x, k, seed + 5291) * 0.7);
          const rh = scale * (0.32 + hash2(k, t.x + k, seed + 5292) * 0.2);
          const g = new THREE.CylinderGeometry(0.14 * scale, 0.34 * scale, rh, 5);
          g.translate(0, rh / 2, 0);
          g.rotateX(0.5); // lean the flare outward, foot away from the trunk
          g.rotateY(ang);
          g.translate(t.x + Math.sin(ang) * len, y - 0.3, t.z + Math.cos(ang) * len);
          rootParts.push(g.toNonIndexed());
        }
        // the vine curtain: strands hung in a ring under the crown, plus an
        // inner ring so the canopy reads properly overgrown
        const crownR = scale * 1.6;
        const crownY = y + scale * 2.6;
        const strands = 16 + Math.floor(hash2(t.x, t.z, seed + 5221) * 8);
        for (let k = 0; k < strands; k++) {
          const ang = (k / strands) * Math.PI * 2 + hash2(k, t.x, seed + 5231);
          const inner = k % 3 === 2;
          const rad = crownR * ((inner ? 0.25 : 0.5) + hash2(k, t.z, seed + 5241) * 0.5);
          const len = 4 + hash2(t.x + k, t.z - k, seed + 5251) * 7;
          vineSpots[k % 2].push({
            x: t.x + Math.sin(ang) * rad,
            z: t.z + Math.cos(ang) * rad,
            y: crownY + hash2(k, k + 1, seed + 5261) * scale * 0.8,
            s: len,
            rot: 0,
          });
        }
      }
    }
    if (rootParts.length > 0) group.add(mergeBoxes(rootParts, barkMat));
    // vines scale on Y only: compose with a per-instance non-uniform scale
    vineSpots.forEach((list, tone) => {
      if (list.length === 0) return;
      const mesh = new THREE.InstancedMesh(vineGeo, vineMats[tone], list.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const v = new THREE.Vector3();
      const sc = new THREE.Vector3();
      list.forEach((sp, i) => {
        v.set(sp.x, sp.y, sp.z);
        sc.set(1, sp.s, 1);
        mesh.setMatrixAt(i, m.compose(v, q, sc));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    });
  }

  return {
    group,
    update(): void {
      // still air: the global wind shader sways the modeled foliage; the
      // strand itself holds its pose
    },
  };
}
