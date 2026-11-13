// The two walk-in palaces (Dawnhold Castle and the Last Keep) build their rooms
// from the painted castle kit instead of the shared dungeon kit: the same pale
// ashlar the castles wear outside, so a palace reads as one building from the
// court to the throne room. Every structural kind the interior builder places
// (floors, walls, pillars) resolves here to a painted module with the SAME
// bounds as the dungeon module it stands in for, so the authored placements,
// the scale rules, and the sim's collision all keep holding.
//
// The ignivar_tile_kit idiom, with one difference: the painted modules carry
// several materials (stone, plaster, glass), so they are kept as parts with
// the loader's own materials rather than merged onto one pack material.
// dungeon.ts consults this module at its emit funnel only; every other
// interior keeps the shared kit untouched.
import * as THREE from 'three';
import { loadGltf } from './assets/loader';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

/** The painted module each dungeon-kit structural kind resolves to in a palace. */
export const PALACE_TILE_URLS: Readonly<Record<string, string>> = {
  floor_tile_large: '/models/biome/kcas_hall_floor.glb',
  floor_tile_large_rocks: '/models/biome/kcas_hall_floor.glb',
  floor_dirt_large: '/models/biome/kcas_hall_floor.glb',
  floor_dirt_large_rocky: '/models/biome/kcas_hall_floor.glb',
  floor_tile_small: '/models/biome/kcas_hall_floor_small.glb',
  floor_tile_small_broken_A: '/models/biome/kcas_hall_floor_small.glb',
  floor_tile_small_broken_B: '/models/biome/kcas_hall_floor_small.glb',
  floor_tile_small_weeds_A: '/models/biome/kcas_hall_floor_small.glb',
  floor_tile_small_weeds_B: '/models/biome/kcas_hall_floor_small.glb',
  floor_tile_small_decorated: '/models/biome/kcas_hall_floor_small.glb',
  floor_foundation_allsides: '/models/biome/kcas_foundation.glb',
  wall: '/models/biome/kcas_wall.glb',
  wall_cracked: '/models/biome/kcas_wall.glb',
  wall_pillar: '/models/biome/kcas_wall_pillar.glb',
  wall_arched: '/models/biome/kcas_wall_niche.glb',
  wall_archedwindow_gated: '/models/biome/kcas_wall_window.glb',
  wall_gated: '/models/biome/kcas_wall_gated.glb',
  pillar: '/models/biome/kcas_hall_pier.glb',
  pillar_decorated: '/models/biome/kcas_pillar.glb',
};

/** One material's share of a painted module, in the module's own space. */
export interface PalaceTilePart {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
}

/** Whether an interior variant is one of the two palaces. */
export function isPalaceVariant(variant: string): boolean {
  return variant === 'lastkeep' || variant === 'dawnhold';
}

const partsByUrl = new Map<string, PalaceTilePart[]>();
let loadTask: Promise<void> | null = null;

// Meshopt-quantized attributes are normalized ints; bake them to plain floats
// first or applyMatrix4 clamps world-space values back into [-1, 1] (the same
// guard dungeon.ts's module extraction carries).
function attributeToFloat(geo: THREE.BufferGeometry, name: string): void {
  const attr = geo.getAttribute(name);
  if (!attr || (attr.array instanceof Float32Array && !attr.normalized)) return;
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
  }
  geo.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
}

// A module keeps its own origin (the dungeon kit places by it), so the parts
// are baked to the scene's space and never recentred.
function extractParts(scene: THREE.Group, url: string): PalaceTilePart[] {
  scene.updateMatrixWorld(true);
  const parts: PalaceTilePart[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // The loader hands each surface of a module over as its own mesh with one
    // material. A mesh with a material list would need one part per geometry
    // group; drawn with its first material alone it would wear one surface
    // over the whole module, so the module is refused by name instead.
    const mat = mesh.material;
    if (Array.isArray(mat)) {
      throw new Error(
        `palace tile kit: ${url} mesh "${mesh.name}" carries ${mat.length} materials, a module ships one material per mesh`,
      );
    }
    const geo = mesh.geometry.clone();
    attributeToFloat(geo, 'position');
    attributeToFloat(geo, 'normal');
    geo.applyMatrix4(mesh.matrixWorld);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    parts.push({ geo: markSharedGeometry(geo), mat: markSharedMaterial(mat) });
  });
  return parts;
}

/** Resolve the painted modules before a palace builds. A model that fails to
 *  load leaves its kinds on the shared dungeon kit for that build, so a missing
 *  file never breaks a palace, and the next palace build asks for it again. A
 *  no-op for every other interior. */
export function ensurePalaceTileAssets(variant: string): Promise<void> {
  if (!isPalaceVariant(variant)) return Promise.resolve();
  loadTask ??= Promise.all(
    [...new Set(Object.values(PALACE_TILE_URLS))].map(async (url) => {
      if (partsByUrl.has(url)) return true;
      try {
        const gltf = await loadGltf(url);
        partsByUrl.set(url, extractParts(gltf.scene, url));
        return true;
      } catch (error) {
        console.warn(
          `palace tile kit: ${url} is unavailable, its kinds keep the dungeon kit`,
          error,
        );
        return false;
      }
    }),
  ).then((loaded) => {
    // A failure leaves nothing behind (no empty entry, no settled task), so one
    // dropped request does not hold a palace on the dungeon kit for the session.
    if (loaded.includes(false)) loadTask = null;
  });
  return loadTask;
}

// A palace's rooms are lit by warm sconces at arm's length from the walls, a
// rig tuned for the dungeon kit's grey stone: the pale ashlar takes a grade so
// it holds its colour under those lights instead of burning out, the Last
// Keep a step deeper than the garden palace. This grade is the palaces' whole
// colour rule: the interior style's wall and floor tints (dungeon.ts applies
// them to the shared kit's pieces, and the Studio can override them) never
// reach a painted piece, so a palace's stone is retuned here.
const PALACE_STONE_GRADE: Readonly<Record<string, number>> = {
  dawnhold: 0xbdb6a9,
  lastkeep: 0xa8a094,
};

/** The kit's stone, by material name (`eh_ashlar`, `eh_stone`). The grade is
 *  for the stone alone: glass, glowing parts and timber trim keep the loader's
 *  own material, so a lit pane is as bright in a palace as anywhere else. */
const PALACE_STONE_MATERIAL = /ashlar|stone/i;

const gradedMaterials = new Map<string, THREE.Material>();

function gradedMaterial(variant: string, source: THREE.Material): THREE.Material {
  const key = `${variant}:${source.uuid}`;
  let mat = gradedMaterials.get(key);
  if (mat) return mat;
  // A hook-preserving clone: a bare clone() drops onBeforeCompile, so a layer
  // the loader put on the material would stop drawing and its program relink.
  const clone = cloneMaterialWithHooks(source) as THREE.MeshStandardMaterial;
  delete clone.userData.sharedRendererResource;
  clone.color?.multiply(new THREE.Color(PALACE_STONE_GRADE[variant] ?? 0xffffff));
  mat = markSharedMaterial(clone);
  gradedMaterials.set(key, mat);
  return mat;
}

const gradedParts = new Map<string, PalaceTilePart[]>();

/** The painted parts a palace draws for a placement kind, or undefined when
 *  the kind keeps the shared dungeon kit (another interior, a non-structural
 *  kind, or a module that did not load). */
export function palaceTileParts(
  variant: string,
  kind: string,
): readonly PalaceTilePart[] | undefined {
  if (!isPalaceVariant(variant)) return undefined;
  const url = PALACE_TILE_URLS[kind];
  if (!url) return undefined;
  const key = `${variant}:${url}`;
  let parts = gradedParts.get(key);
  if (!parts) {
    const source = partsByUrl.get(url);
    if (!source || source.length === 0) return undefined;
    parts = source.map((part) => ({
      geo: part.geo,
      mat: PALACE_STONE_MATERIAL.test(part.mat.name) ? gradedMaterial(variant, part.mat) : part.mat,
    }));
    gradedParts.set(key, parts);
  }
  return parts;
}

/** Draw one placement kind of a palace from the painted kit: one instanced
 *  mesh per part, with the shadow policy of the ORIGINAL dungeon kind. Answers
 *  false, drawing nothing, when the kind keeps the shared dungeon kit, so the
 *  interior builder's own emit path carries on unchanged. */
export function addPalaceTiles(
  group: THREE.Group,
  variant: string,
  kind: string,
  matrices: readonly THREE.Matrix4[],
  lowGfx: boolean,
  casterKinds: ReadonlySet<string>,
  receiverKinds: ReadonlySet<string>,
): boolean {
  const parts = palaceTileParts(variant, kind);
  if (!parts) return false;
  for (const part of parts) {
    const mesh = new THREE.InstancedMesh(part.geo, part.mat, matrices.length);
    for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = !lowGfx && casterKinds.has(kind);
    mesh.receiveShadow = receiverKinds.has(kind);
    group.add(mesh);
  }
  return true;
}

/** Yards one repeat of the painted ashlar covers on a plain slab. */
const SLAB_TILE = 5.2;
const slabMaterials = new Map<string, THREE.Material>();

/** The palace's own stone for the plain slabs the interior builder models
 *  itself (raised floors, door steps, ledges), or undefined outside a palace
 *  or before the kit has loaded. */
export function palaceSlabMaterial(variant: string): THREE.Material | undefined {
  if (!isPalaceVariant(variant)) return undefined;
  let mat = slabMaterials.get(variant);
  if (mat) return mat;
  const wall = partsByUrl.get(PALACE_TILE_URLS.wall);
  const source = wall?.find((part) => /ashlar/i.test(part.mat.name))?.mat;
  if (!source) return undefined;
  // Hook-preserving, for the same reason as the graded stone above.
  const clone = cloneMaterialWithHooks(source) as THREE.MeshStandardMaterial;
  delete clone.userData.sharedRendererResource;
  // The slabs are plain boxes with no painted shade in their vertices.
  clone.vertexColors = false;
  clone.color?.multiply(new THREE.Color(PALACE_STONE_GRADE[variant] ?? 0xffffff));
  clone.color?.multiplyScalar(0.9);
  mat = markSharedMaterial(clone);
  slabMaterials.set(variant, mat);
  return mat;
}

/** A box whose faces repeat the painted stone at its true size, where a plain
 *  BoxGeometry would stretch one tile over each whole face. */
export function palaceSlabBox(width: number, height: number, depth: number): THREE.BoxGeometry {
  const box = new THREE.BoxGeometry(width, height, depth);
  const uv = box.getAttribute('uv') as THREE.BufferAttribute;
  // BoxGeometry lays its faces out +x, -x, +y, -y, +z, -z, four vertices each.
  const spans: readonly (readonly [number, number])[] = [
    [depth, height],
    [depth, height],
    [width, depth],
    [width, depth],
    [width, height],
    [width, height],
  ];
  for (let face = 0; face < 6; face++) {
    const [su, sv] = spans[face];
    for (let i = face * 4; i < face * 4 + 4; i++) {
      uv.setXY(i, (uv.getX(i) * su) / SLAB_TILE, (uv.getY(i) * sv) / SLAB_TILE);
    }
  }
  uv.needsUpdate = true;
  return box;
}

/** Test-only reset: forget everything loaded and graded, so each case of the
 *  vitest starts from a kit that has never been asked for. */
export const palaceTileInternalsForTest = {
  reset(): void {
    partsByUrl.clear();
    gradedMaterials.clear();
    gradedParts.clear();
    slabMaterials.clear();
    loadTask = null;
  },
};
