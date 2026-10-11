// The posed static bake behind every far LOD and shadow proxy: the visible meshes of a
// posed throwaway clone flattened into ONE BufferGeometry in normalized space (skinned
// vertices through applyBoneTransform), one geometry group per material the far mesh
// draws. assets.ts owns the walks that feed it (which meshes, in which order) and
// re-exports it; woc_far_bake.ts drives it a band of vertices at a time.
//
// The bake is RESUMABLE (StaticPoseBaker.advance) because a body's far bake is a queue
// unit, not a frame's work: the per-vertex transform is the whole cost (a skinned vertex
// is a four-bone blend), so a caller hands it a vertex budget per unit and the frame
// budget decides how many units a frame takes. bakeStaticPose is the one-shot
// form, for a caller that owns its frame (the per-key prepare, the composed bake).
// Nothing may move the throwaway between bands: every band reads the world matrices
// the pose left behind.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { dequantizeAttribute } from './dequantize_attribute';
import { coalesceFarBakeGroups, farBakeGroupRanges } from './far_bake_groups_core';
import { padMissingUv } from './far_bake_uv_pad';

/** What a baked source mesh's far material is a function of, so two meshes that
 *  answer the same string can share ONE geometry group.
 *
 *  The default is the pair `tintedFarMaterials` reads: the source material and
 *  the body flag that gates the skin/emissive override. A composed bake adds
 *  the node-name partition, because a composed group's material is not read off
 *  this walk at all: it is looked up per character, per slot, through
 *  `farSourceMaterials`, and that lookup is `recolored(source, look, name
 *  facts)`. Two slots therefore resolve alike for EVERY look exactly when their
 *  source material and their name facts agree, which is what this key states.
 *  (The temp's material identity already implies the source's: the recolour
 *  cache keys on the source uuid.) A WOC bake adds the head-tint partition on
 *  top of the default, and answers ONE key of its own for every head piece its
 *  merged head material can draw (woc_far_bake.ts). */
export function farBakeGroupKey(mesh: THREE.Mesh): string {
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return `${mat?.uuid ?? 'none'}|${(mesh.userData.skinAtlasTarget ?? mesh.userData.bodyMesh) ? 1 : 0}`;
}

export interface StaticPoseBake {
  geo: THREE.BufferGeometry | null;
  /** One entry per GROUP: the source material of the mesh that group draws. */
  mats: THREE.Material[];
  /** One entry per GROUP: the body flag gating the skin/emissive override. */
  isBody: boolean[];
  /** One entry per GROUP: the index, in the `meshes` walk, of the source mesh
   *  the group draws. The identity map before coalescing, and the indirection a
   *  composed body resolves its per-character materials through. */
  slots: number[];
  /** Every index of the `meshes` walk in the order its vertices sit in `geo`
   *  (groups concatenated): how a caller that adds a per-vertex value after the
   *  bake (the WOC far head's slot attribute) finds one source mesh's vertices. */
  order: number[];
}

/** A walk with nothing to bake (its own arrays: a caller appends to a bake's lists). */
const nothing = (): StaticPoseBake => ({ geo: null, mats: [], isBody: [], slots: [], order: [] });

/** One source mesh on its way through the bake. */
interface Part {
  readonly mesh: THREE.Mesh;
  /** The geometry the mesh held when the bake began (a caller may hand a mesh a
   *  scratch geometry first: woc_far_head.ts). */
  readonly source: THREE.BufferGeometry;
  readonly position: THREE.BufferAttribute;
  readonly baked: Float32Array;
  /** The next vertex to transform. */
  next: number;
  /** The baked geometry, once every vertex of the part is through. */
  geo: THREE.BufferGeometry | null;
}

/**
 * The bake of one walk, a band of vertices at a time. `meshes` is the caller's walk:
 * which filter a bake belongs to is decided at the one place that also knows where its
 * materials come from (the composed bake is handed composedFarMeshes, the same list
 * assembleModular captured its slots from, and group N names slot `slots[N]` there).
 */
export class StaticPoseBaker {
  private readonly parts: Part[];
  /** The part being transformed (parts.length: all through). */
  private at = 0;
  private readonly v = new THREE.Vector3();
  private readonly full = new THREE.Matrix4();

  constructor(
    private readonly norm: THREE.Matrix4,
    private readonly meshes: readonly THREE.Mesh[],
  ) {
    this.parts = meshes.map((mesh) => {
      const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      return {
        mesh,
        source: mesh.geometry,
        position,
        baked: new Float32Array(position.count * 3),
        next: 0,
        geo: null,
      };
    });
  }

  /** Vertices still to transform. */
  get remaining(): number {
    let left = 0;
    for (let i = this.at; i < this.parts.length; i++) {
      left += this.parts[i].position.count - this.parts[i].next;
    }
    return left;
  }

  /**
   * Transform up to `maxVertices` more vertices (all of them by default), finishing each
   * mesh the band completes (its uv, index and normals). True once every mesh is through.
   * A spent budget (zero or less) transforms nothing: a caller handing over what is left
   * of its band never buys the whole bake with it.
   */
  advance(maxVertices = Number.POSITIVE_INFINITY): boolean {
    let budget = maxVertices > 0 ? maxVertices : 0;
    const v = this.v;
    const full = this.full;
    const norm = this.norm;
    while (this.at < this.parts.length && budget > 0) {
      const part = this.parts[this.at];
      const { mesh, position, baked } = part;
      const count = position.count;
      const end = Math.min(count, part.next + budget);
      const skinned = (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh
        ? (mesh as unknown as THREE.SkinnedMesh)
        : null;
      if (!skinned) full.multiplyMatrices(norm, mesh.matrixWorld);
      for (let i = part.next; i < end; i++) {
        v.fromBufferAttribute(position, i);
        if (skinned) {
          skinned.applyBoneTransform(i, v);
          v.applyMatrix4(skinned.matrixWorld).applyMatrix4(norm);
        } else {
          v.applyMatrix4(full);
        }
        baked[i * 3] = v.x;
        baked[i * 3 + 1] = v.y;
        baked[i * 3 + 2] = v.z;
      }
      budget -= end - part.next;
      part.next = end;
      if (end < count) break;
      part.geo = this.finishPart(part);
      this.at++;
    }
    return this.at >= this.parts.length;
  }

  private finishPart(part: Part): THREE.BufferGeometry {
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(part.baked, 3));
    const uv = part.source.getAttribute('uv');
    // Different source primitives can quantize uv differently (e.g. a
    // normalized Uint16Array on one, a plain Float32Array on another);
    // dequantize so every baked geo's uv shares one typed-array type and
    // mergeGeometries below can combine them.
    if (uv) out.setAttribute('uv', dequantizeAttribute(uv as THREE.BufferAttribute));
    if (part.source.index) out.setIndex(part.source.index.clone());
    out.computeVertexNormals();
    return out;
  }

  /**
   * The finished bake (whatever was left to transform is transformed first). Meshes
   * whose `groupKey` agrees share ONE group, so the "single-draw far mesh" the crowd LOD
   * counts on really is close to one draw instead of a group per source primitive.
   * Groups keep the order of their FIRST member, so the slot map stays readable and a
   * bake is deterministic.
   */
  finish(groupKey: (mesh: THREE.Mesh) => string = farBakeGroupKey): StaticPoseBake {
    this.advance();
    const geos: THREE.BufferGeometry[] = [];
    for (const part of this.parts) if (part.geo) geos.push(part.geo);
    if (geos.length === 0) return nothing();
    // GLTFLoader emits one Mesh per primitive: materials are never arrays here
    const mats = this.meshes.map((mesh) =>
      Array.isArray(mesh.material) ? mesh.material[0] : mesh.material,
    );
    const isBody = this.meshes.map(
      (mesh) => !!(mesh.userData.skinAtlasTarget ?? mesh.userData.bodyMesh),
    );
    // uv presence must agree for merging. PAD the parts that lack one rather
    // than dropping it everywhere: a composed body always carries colour-only
    // face parts (head, ears, eyes, mouth, brows) with no uv at all, and the old
    // "delete uv from every geo" arm stripped the atlas-mapped kit beside them
    // too, so the frozen far mesh drew the whole robe and hat from the single
    // texel at uv (0,0), a flat untextured body the moment a peer or NPC
    // crossed into the static band (the "NPCs lose their textures" report).
    // A zero uv on a part that never samples a map costs nothing.
    padMissingUv(geos);

    // One group per distinct key, fed to the merge in grouped order so each
    // group's members land CONTIGUOUSLY (one addGroup can only cover a run).
    const grouping = coalesceFarBakeGroups(this.meshes.map(groupKey));
    const geo =
      grouping.mergeOrder.length === 1
        ? geos[grouping.mergeOrder[0]]
        : mergeGeometries(
            grouping.mergeOrder.map((i) => geos[i]),
            true,
          );
    if (!geo) return nothing();
    // mergeGeometries emitted one group per INPUT (and a single geometry keeps
    // whatever groups it arrived with); rewrite them as one group per coalesced
    // run, whose material index is the run's own index.
    const counts = geos.map((g) => (g.index ? g.index.count : g.getAttribute('position').count));
    geo.clearGroups();
    for (const range of farBakeGroupRanges(grouping, counts)) {
      geo.addGroup(range.start, range.count, range.materialIndex);
    }
    return {
      geo,
      mats: grouping.slots.map((i) => mats[i]),
      isBody: grouping.slots.map((i) => isBody[i]),
      slots: [...grouping.slots],
      order: [...grouping.mergeOrder],
    };
  }
}

/** Bake every visible mesh of a posed clone into one static BufferGeometry
 *  (skinned verts via applyBoneTransform), normalized into world units: the
 *  whole bake in one call. */
export function bakeStaticPose(
  norm: THREE.Matrix4,
  meshes: readonly THREE.Mesh[],
  groupKey: (mesh: THREE.Mesh) => string = farBakeGroupKey,
): StaticPoseBake {
  return new StaticPoseBaker(norm, meshes).finish(groupKey);
}
