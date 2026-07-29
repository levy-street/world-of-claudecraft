// The battleground field's authored art: every catalogue GLB the Thornhollow
// map placed, drawn as instanced meshes.
//
// One InstancedMesh per (asset, sub-mesh) pair, so a keep wall made of 235
// module copies costs one draw call rather than 235 scene nodes. Placement
// transforms come from the generated field record, which the SAME compiler
// derived the colliders from, so a model and its collision cannot drift.
//
// Seating rule, and it is load-bearing: a model is normalized to
// `targetHeightFor(path) / maxSourceDimension` and then seated so its lowest
// point rests on the placement's precomputed `seatY`. That is exactly what the
// editor's collision bake assumed when it baked the boxes now vendored into
// data/battleground/thornhollow_assets.json.

import * as THREE from 'three';
import { targetHeightFor } from './asset_scale';
import { loadGltf } from './assets/loader';
import type { BgAssetGroup, ThFieldPlacement } from './battleground_core';
import { type InstancedGhostHandle, InstancedOccluderGhosts } from './instanced_occluder_ghosts';
import {
  occluderFadeSettled,
  occluderSegmentHitsBox,
  stepOccluderFade,
} from './occluder_fade_core';
import { markSharedMaterial } from './shared_resource';

export interface BgPlacementsView {
  group: THREE.Group;
  /**
   * Per-frame: fade any tall structure crossing the eye-to-camera segment to
   * the global occluder alpha, so a camera parked behind a keep or gatehouse
   * wall still shows the fight (the yumi_maze / props behavior). World
   * coordinates in; the view converts to its own field-local space.
   */
  updateOccluderFades(
    camX: number,
    camY: number,
    camZ: number,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    dt: number,
    reducedMotion?: boolean,
  ): void;
  dispose(): void;
}

/** Assets whose instances cast the sun shadow on tiers that draw one: the
 *  structures that define the field's silhouette. Clutter and foliage skip it,
 *  the same cosmetic-only split every other subsystem makes. */
const CASTER_PREFIX =
  /^(dungeon\/(wall|pillar|arch|barrier)|city\/|medieval_village_v2\/|biome\/dungeon_arch_stone|props\/(timber_pillar|column_broken))/;

interface SubMesh {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** The mesh's transform inside the GLB, relative to the model root. */
  local: THREE.Matrix4;
}

interface Template {
  subs: SubMesh[];
  /** source units -> world yards */
  norm: number;
  /** source-unit lowest point, so the model seats on the ground */
  minY: number;
  /** source-unit bounding size, the footprint the occluder fade measures from */
  size: THREE.Vector3;
}

/**
 * The pieces a chase camera can end up BEHIND: the field's wall courses, their
 * parapet caps, the drum towers and the gate arch, the structures that make up
 * the field's silhouette. Everything else the map places (crates, rubble,
 * bones, banners, foliage, grass) is ground clutter the camera clears, and
 * ghosting it would make the field flicker for nothing.
 *
 * Purely cosmetic, like every other occluder-fade consumer: a wall that fades
 * hides nothing a player acts on, the same geometry keeps blocking movement and
 * casts, and nothing here is tier-gated.
 */
const OCCLUDER_ASSET_IDS: ReadonlySet<string> = new Set([
  'biome/dungeon_arch_stone',
  'city/wall_tower',
  'dungeon/barrier',
  'dungeon/barrier_half',
  'dungeon/wall',
  'dungeon/wall_broken',
]);

/** Does this authored asset belong to the field's fadeable structure set? */
export function isBattlegroundOccluderAsset(assetId: string): boolean {
  return OCCLUDER_ASSET_IDS.has(assetId);
}

/** A structure shorter than this is a kerb or a floor slab whatever its asset
 *  says: the camera never ends up behind it, so it never ghosts. */
const OCCLUDER_MIN_HEIGHT = 2.5;

/** How far the eye can be from a slot's field centre and still see into it.
 *  Past this the view belongs to another match's copy (or its world matrix has
 *  not been composed yet), so it has nothing to fade. */
const OCCLUDER_SLOT_REACH_X = 260;
const OCCLUDER_SLOT_REACH_Z = 320;

/** One sub-mesh instance a fading structure has to swap for a ghost. */
interface OccluderPart {
  mesh: THREE.InstancedMesh;
  index: number;
  visible: THREE.Matrix4;
  hidden: THREE.Matrix4;
  ghost: InstancedGhostHandle | null;
}

/** One authored structure, in FIELD-LOCAL coordinates, with every sub-mesh
 *  instance that draws it. A GLB with several sub-meshes fades as one body. */
interface Occluder {
  x: number;
  z: number;
  hw: number;
  hd: number;
  topY: number;
  /** XZ reach from the centre, for the cheap per-frame distance reject. */
  radius: number;
  alpha: number;
  parts: OccluderPart[];
}

const ZERO_SCALE = new THREE.Vector3(0, 0, 0);

/**
 * The world-axis-aligned footprint of one placement, or null when the piece is
 * too short to be worth ghosting. The box is the rotated model's AABB, which
 * over-covers a diagonal wall slightly; the fade is cosmetic, so covering a
 * little early is the right side to err on.
 */
function occluderFor(p: ThFieldPlacement, t: Template): Occluder | null {
  const s = t.norm * (p.scale > 0 ? p.scale : 1);
  const sy = s * (p.scaleY ?? 1);
  const height = t.size.y * sy;
  if (height < OCCLUDER_MIN_HEIGHT) return null;
  const halfX = (t.size.x * s * (p.scaleX ?? 1)) / 2;
  const halfZ = (t.size.z * s * (p.scaleZ ?? 1)) / 2;
  const c = Math.abs(Math.cos(p.rotY));
  const sn = Math.abs(Math.sin(p.rotY));
  const hw = halfX * c + halfZ * sn;
  const hd = halfX * sn + halfZ * c;
  return {
    x: p.x,
    z: p.z,
    hw,
    hd,
    topY: p.seatY + height,
    radius: Math.hypot(hw, hd),
    alpha: 1,
    parts: [],
  };
}

/** Every live field's placements, so the renderer drives the whole family with
 *  one call instead of reaching through the field view for each slot. */
const liveViews = new Set<BgPlacementsView>();

/** Per-frame occluder fade for every battleground field currently built. */
export function updateBattlegroundOccluderFades(
  camX: number,
  camY: number,
  camZ: number,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  dt: number,
  reducedMotion = false,
): void {
  for (const view of liveViews) {
    view.updateOccluderFades(camX, camY, camZ, eyeX, eyeY, eyeZ, dt, reducedMotion);
  }
}

/**
 * Some source packs ship LOD0, LOD1, and LOD2 as simultaneously active
 * meshes. The battleground instancer chooses the authored highest-detail mesh;
 * otherwise every placement would draw all three levels on top of each other.
 */
export function isPrimaryBattlegroundMeshName(name: string): boolean {
  return !/_LOD[1-9]\d*(?:$|[._-])/i.test(name);
}

async function loadTemplate(path: string): Promise<Template | null> {
  const gltf = await loadGltf(path);
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const subs: SubMesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || !isPrimaryBattlegroundMeshName(mesh.name)) return;
    box.expandByObject(mesh, true);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) markSharedMaterial(m);
    subs.push({
      geometry: mesh.geometry,
      material: Array.isArray(mesh.material) ? mesh.material[0] : mesh.material,
      local: mesh.matrixWorld.clone(),
    });
  });
  if (subs.length === 0) return null;
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  return { subs, norm: targetHeightFor(path) / maxDim, minY: box.min.y, size };
}

/** The world matrix for one placement's model root. */
function rootMatrix(p: ThFieldPlacement, t: Template, out: THREE.Matrix4): THREE.Matrix4 {
  const s = t.norm * (p.scale > 0 ? p.scale : 1);
  const sy = s * (p.scaleY ?? 1);
  const pos = new THREE.Vector3(p.x, p.seatY - t.minY * sy, p.z);
  const quat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(p.rotX ?? 0, p.rotY, p.rotZ ?? 0),
  );
  const scl = new THREE.Vector3(s * (p.scaleX ?? 1), sy, s * (p.scaleZ ?? 1));
  return out.compose(pos, quat, scl);
}

/**
 * Build every authored placement. Groups whose GLB fails to load are skipped
 * with a warning rather than failing the field: a missing prop must never cost
 * a player their match.
 */
export async function buildBattlegroundPlacements(
  groups: readonly BgAssetGroup[],
  opts: { lowGfx: boolean },
): Promise<BgPlacementsView> {
  const group = new THREE.Group();
  group.name = 'battleground-placements';
  const meshes: THREE.InstancedMesh[] = [];

  const templates = await Promise.all(
    groups.map((g) =>
      loadTemplate(g.path).catch((err) => {
        console.warn(`battleground: placement asset failed '${g.assetId}'`, err);
        return null;
      }),
    ),
  );

  const root = new THREE.Matrix4();
  const full = new THREE.Matrix4();
  const occluders: Occluder[] = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const t = templates[gi];
    if (!t) continue;
    const caster = !opts.lowGfx && CASTER_PREFIX.test(g.assetId);
    // Resolved once per group: one entry per placement, null where the piece is
    // not a structure worth ghosting. The sub-mesh loop below hangs its
    // instances off the SAME entry, so a multi-mesh GLB fades as one body.
    const fadeable: (Occluder | null)[] = isBattlegroundOccluderAsset(g.assetId)
      ? g.placements.map((p) => occluderFor(p, t))
      : [];
    for (const sub of t.subs) {
      const mesh = new THREE.InstancedMesh(sub.geometry, sub.material, g.placements.length);
      for (let i = 0; i < g.placements.length; i++) {
        rootMatrix(g.placements[i], t, root);
        full.multiplyMatrices(root, sub.local);
        mesh.setMatrixAt(i, full);
        const fade = fadeable[i];
        if (fade) {
          const visible = full.clone();
          fade.parts.push({
            mesh,
            index: i,
            visible,
            hidden: visible.clone().scale(ZERO_SCALE),
            ghost: null,
          });
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = caster;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      meshes.push(mesh);
      group.add(mesh);
    }
    for (const fade of fadeable) if (fade && fade.parts.length > 0) occluders.push(fade);
  }

  const ghosts = new InstancedOccluderGhosts();
  const showParts = (o: Occluder): void => {
    for (const part of o.parts) {
      part.mesh.setMatrixAt(part.index, part.visible);
      part.mesh.instanceMatrix.needsUpdate = true;
      if (part.ghost) {
        ghosts.release(part.ghost);
        part.ghost = null;
      }
    }
  };

  const view: BgPlacementsView = {
    group,
    updateOccluderFades(camX, camY, camZ, eyeX, eyeY, eyeZ, dt, reducedMotion = false) {
      if (occluders.length === 0) return;
      // Placements are FIELD-LOCAL and the group sits at its slot origin, so
      // the eye and camera come back to local space by that translation alone
      // (the field group carries no rotation or scale).
      const ox = group.matrixWorld.elements[12];
      const oz = group.matrixWorld.elements[14];
      const ex = eyeX - ox;
      const ez = eyeZ - oz;
      // Another match's copy of the field, or a group whose world matrix has
      // not been composed yet: nothing here can be between this eye and this
      // camera, and anything still ghosted settled on an earlier frame.
      if (Math.abs(ex) > OCCLUDER_SLOT_REACH_X || Math.abs(ez) > OCCLUDER_SLOT_REACH_Z) return;
      const cx = camX - ox;
      const cz = camZ - oz;
      const reach = Math.hypot(cx - ex, cz - ez);
      for (const o of occluders) {
        // Cheap squared-distance reject before the slab test: a structure
        // farther from the eye than the whole boom length plus its own reach
        // cannot straddle the segment. A ghost already out there still runs the
        // path below, because `hide` false is exactly what fades it back in.
        const dx = o.x - ex;
        const dz = o.z - ez;
        const span = reach + o.radius;
        const hide =
          dx * dx + dz * dz <= span * span &&
          occluderSegmentHitsBox(o.x, o.z, o.hw, o.hd, o.topY, ex, eyeY, ez, cx, camY, cz);
        if (!hide && o.parts[0].ghost === null) {
          o.alpha = 1;
          continue;
        }
        if (o.parts[0].ghost === null) {
          for (const part of o.parts) {
            part.mesh.setMatrixAt(part.index, part.hidden);
            part.mesh.instanceMatrix.needsUpdate = true;
            part.ghost = ghosts.acquire(part.mesh, part.index, part.visible);
          }
        }
        o.alpha = stepOccluderFade(o.alpha, hide, dt, reducedMotion);
        for (const part of o.parts) if (part.ghost) ghosts.setAlpha(part.ghost, o.alpha);
        if (!hide && occluderFadeSettled(o.alpha, false)) showParts(o);
      }
    },
    dispose() {
      liveViews.delete(view);
      for (const o of occluders) showParts(o);
      // Geometry and materials belong to the shared GLB cache: dispose only
      // the instance buffers this view created.
      for (const m of meshes) m.dispose();
      group.clear();
    },
  };
  liveViews.add(view);
  return view;
}
