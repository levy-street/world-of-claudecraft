// The geometry fold of a merged WOC head (woc_head_merge.ts owns the rig, the cache and
// the fold rule; woc_head_merge_core.ts the band sizes): every drawn piece's vertices
// posed by its morph influences and moved into the head bone's space, its normals with
// them, its uv, the slot of its material, then its triangles and its coarser levels.
//
// The fold is cut into BANDS. A head is several thousand to some fourteen thousand
// vertices through up to nine morph targets (the shipped library,
// tests/woc_head_merge_library.test.ts), and folded whole it was one queue unit per
// distinct look: a large single piece of a crowd's arrival, several times the frame
// budget's smallest slice on a weak machine. A fold therefore keeps its place between
// calls (WocHeadGeometryFold.step), and its owner runs it as a chain of queue units, a
// band each, the way a composed look paints its decal maps a band of rows a unit
// (look_pieces.ts): the budget, not this module, decides how many bands fit a frame.
//
// Nothing a band reads can change under the chain. The pieces' geometries are the packs'
// own (shared, never written), the placement is the plan's, and the one thing a character
// writes on its meshes, the morph influences, is copied when the fold starts. So a fold
// is a function of what its key names alone (woc_head_merge_core.ts wocHeadMergeKey),
// whichever character's units run it and whatever that character does meanwhile: every
// character in one face can drive one fold, and a fold nobody waits for any more is
// simply let go (its buffers are plain arrays until its last band, which is the first to
// make a geometry).
//
// One implementation: mergeWocHeadGeometry is the same fold run to its end in one call (a
// direct build, a test), so the chained geometry and the one-shot one cannot differ.
import * as THREE from 'three';
import { geometryLodSourceOf, mergeGeometryLod } from '../assets/geometry_lod';
import {
  WOC_HEAD_MERGE_BAND_INDICES,
  WOC_HEAD_MERGE_BAND_VERTICES,
  WOC_HEAD_MERGE_SLOT_ATTRIBUTE,
} from './woc_head_merge_core';

/** One piece mesh folded into a merged head. */
export interface WocHeadMergePiece {
  /** The drawn piece mesh, its morph influences as the head is posed. */
  readonly mesh: THREE.Mesh;
  /** The mesh's local space to the merged mesh's space (the head bone's). */
  readonly toRoot: THREE.Matrix4;
  readonly slot: number;
  /** A flat-coloured piece's uv (the atlas's white cell); null: the piece's own uv. */
  readonly flatUv: readonly [number, number] | null;
}

/** The index count of a triangle list, less a trailing partial triangle: every piece
 *  after a malformed one would otherwise have its triangles shifted. */
const wholeTriangles = (count: number): number => count - (count % 3);

/** What a fold keeps of a piece: everything a later band reads, none of it a live mesh. */
interface FoldPiece {
  /** The piece's SOURCE geometry (a piece drawn at a coarser level draws a variant over
   *  the same buffers: assets/geometry_lod.ts). */
  readonly geometry: THREE.BufferGeometry;
  /** What three's own vertex pose reads of a mesh: that geometry, and the morph
   *  influences the piece wore when the fold started (a copy). */
  readonly posed: Pick<THREE.Mesh, 'geometry' | 'morphTargetInfluences'>;
  readonly toRoot: THREE.Matrix4;
  readonly slot: number;
  readonly flatUv: readonly [number, number] | null;
  /** A mirrored piece (a negative determinant): its winding is flipped, as three flips
   *  the front face for its mesh. */
  readonly flip: boolean;
  readonly vertices: number;
  /** Its index entries, whole triangles only. */
  readonly indices: number;
}

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _base = new THREE.Vector3();
const _normalMatrix = new THREE.Matrix3();

/**
 * One merged head's geometry, folded a band at a time: positions and normals posed and
 * moved into the merged mesh's space, uv, and the per-vertex slot, then the triangles.
 *
 * Each piece is folded from its SOURCE geometry, and the merged geometry carries the
 * pieces' coarser levels, offset and flipped as its own index is: its mid level draws
 * exactly the pieces' mid triangles, whoever folded it.
 */
export class WocHeadGeometryFold {
  /** The vertices and index entries of the whole head. */
  readonly vertices: number;
  readonly indices: number;
  /** How many of each are folded so far. */
  foldedVertices = 0;
  foldedIndices = 0;
  private readonly pieces: FoldPiece[];
  // The buffers (a third of a megabyte for a full head) are allocated by the FIRST band,
  // never by whoever decided to fold: that frame is the one the chain exists to spare.
  private position: Float32Array | null = null;
  private normal: Int16Array | null = null;
  private uv: Float32Array | null = null;
  private slot: Uint8Array | null = null;
  private index: Uint16Array | Uint32Array | null = null;
  /** The vertex cursor: the piece, the vertex within it, the piece's first merged vertex. */
  private vertexPiece = 0;
  private vertexAt = 0;
  private vertexBase = 0;
  /** The index cursor: the piece, the entry within it, its first merged entry and vertex. */
  private indexPiece = 0;
  private indexAt = 0;
  private indexBase = 0;
  private indexVertexBase = 0;
  /** The box of the vertices folded so far (three's own, over the values as stored). */
  private readonly box = new THREE.Box3();
  private built: THREE.BufferGeometry | null = null;

  constructor(pieces: readonly WocHeadMergePiece[]) {
    let vertices = 0;
    let indices = 0;
    this.pieces = pieces.map(({ mesh, toRoot, slot, flatUv }) => {
      const geometry = geometryLodSourceOf(mesh.geometry);
      const count = geometry.getAttribute('position').count;
      const whole = wholeTriangles(geometry.index ? geometry.index.count : count);
      vertices += count;
      indices += whole;
      const influences = mesh.morphTargetInfluences;
      return {
        geometry,
        posed: { geometry, morphTargetInfluences: influences ? [...influences] : influences },
        toRoot,
        slot,
        flatUv,
        flip: toRoot.determinant() < 0,
        vertices: count,
        indices: whole,
      };
    });
    this.vertices = vertices;
    this.indices = indices;
  }

  /** Whether the geometry is whole. */
  get done(): boolean {
    return this.built !== null;
  }

  /**
   * Fold the next band: at most `bandVertices` vertices, then (once every vertex is
   * folded) at most `bandIndices` index entries, and in the call that ends the triangles
   * the bounds and the coarser levels. Returns the geometry once it is whole (the same
   * one from every later call), null while there is more to fold. A head that fits one
   * band is whole after one call.
   */
  step(
    bandVertices: number = WOC_HEAD_MERGE_BAND_VERTICES,
    bandIndices: number = WOC_HEAD_MERGE_BAND_INDICES,
  ): THREE.BufferGeometry | null {
    if (this.built) return this.built;
    if (!this.position) this.allocate();
    let room = Math.max(1, Math.floor(bandVertices));
    while (this.vertexPiece < this.pieces.length) {
      const piece = this.pieces[this.vertexPiece];
      const to = Math.min(piece.vertices, this.vertexAt + room);
      this.foldVertices(piece, this.vertexAt, to);
      room -= to - this.vertexAt;
      this.vertexAt = to;
      if (to < piece.vertices) return null;
      this.vertexBase += piece.vertices;
      this.vertexPiece++;
      this.vertexAt = 0;
      // a band that ends on a piece's last vertex leaves the next piece to the next call
      if (room <= 0 && this.foldedVertices < this.vertices) return null;
    }
    // whole triangles only: a band never splits one
    room = Number.isFinite(bandIndices)
      ? Math.max(3, wholeTriangles(Math.floor(bandIndices)))
      : Number.POSITIVE_INFINITY;
    while (this.indexPiece < this.pieces.length) {
      const piece = this.pieces[this.indexPiece];
      const to = Math.min(piece.indices, this.indexAt + room);
      this.foldIndices(piece, this.indexAt, to);
      room -= to - this.indexAt;
      this.indexAt = to;
      if (to < piece.indices) return null;
      this.indexBase += piece.indices;
      this.indexVertexBase += piece.vertices;
      this.indexPiece++;
      this.indexAt = 0;
      if (room <= 0 && this.foldedIndices < this.indices) return null;
    }
    this.built = this.close();
    return this.built;
  }

  private allocate(): void {
    this.position = new Float32Array(this.vertices * 3);
    this.normal = new Int16Array(this.vertices * 3);
    this.uv = new Float32Array(this.vertices * 2);
    this.slot = new Uint8Array(this.vertices);
    this.index =
      this.vertices > 0xffff ? new Uint32Array(this.indices) : new Uint16Array(this.indices);
  }

  /** Vertices `from` to `to` (exclusive) of one piece. */
  private foldVertices(piece: FoldPiece, from: number, to: number): void {
    const position = this.position as Float32Array;
    const normal = this.normal as Int16Array;
    const uv = this.uv as Float32Array;
    const slot = this.slot as Uint8Array;
    const { geometry: geo, toRoot } = piece;
    const nor = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const tex = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const morphNormals = geo.morphAttributes.normal;
    const influences = piece.posed.morphTargetInfluences;
    _normalMatrix.getNormalMatrix(toRoot);
    const v0 = this.vertexBase;
    for (let i = from; i < to; i++) {
      // the same sum three's morph chunk draws (relative targets, as glTF ships them)
      THREE.Mesh.prototype.getVertexPosition.call(piece.posed, i, _v);
      _v.applyMatrix4(toRoot);
      const p = (v0 + i) * 3;
      position[p] = _v.x;
      position[p + 1] = _v.y;
      position[p + 2] = _v.z;
      // the box three would measure off the finished attribute: over the values as stored
      this.box.expandByPoint(_v.set(position[p], position[p + 1], position[p + 2]));
      if (nor) {
        _n.fromBufferAttribute(nor, i);
        if (morphNormals && influences) {
          // an absolute target moves the normal by its offset from the BASE normal,
          // whatever the targets before it did (three's morph chunk)
          _base.copy(_n);
          for (let t = 0; t < morphNormals.length; t++) {
            const w = influences[t];
            if (!w) continue;
            _d.fromBufferAttribute(morphNormals[t] as THREE.BufferAttribute, i);
            if (geo.morphTargetsRelative) _n.addScaledVector(_d, w);
            else _n.addScaledVector(_d.sub(_base), w);
          }
        }
        _n.applyMatrix3(_normalMatrix).normalize();
      } else {
        _n.set(0, 0, 1);
      }
      normal[p] = Math.round(_n.x * 32767);
      normal[p + 1] = Math.round(_n.y * 32767);
      normal[p + 2] = Math.round(_n.z * 32767);
      const q = (v0 + i) * 2;
      if (piece.flatUv) {
        uv[q] = piece.flatUv[0];
        uv[q + 1] = piece.flatUv[1];
      } else if (tex) {
        uv[q] = tex.getX(i);
        uv[q + 1] = tex.getY(i);
      }
      slot[v0 + i] = piece.slot;
    }
    this.foldedVertices += to - from;
  }

  /** Index entries `from` to `to` (exclusive, whole triangles) of one piece. */
  private foldIndices(piece: FoldPiece, from: number, to: number): void {
    const index = this.index as Uint16Array | Uint32Array;
    const source = piece.geometry.index;
    const i0 = this.indexBase;
    const v0 = this.indexVertexBase;
    const { flip } = piece;
    for (let k = from; k < to; k += 3) {
      const a = source ? source.getX(k) : k;
      const b = source ? source.getX(k + 1) : k + 1;
      const c = source ? source.getX(k + 2) : k + 2;
      index[i0 + k] = v0 + a;
      index[i0 + k + 1] = v0 + (flip ? c : b);
      index[i0 + k + 2] = v0 + (flip ? b : c);
    }
    this.foldedIndices += to - from;
  }

  /** The finished buffers as a geometry: its attributes, its index, its pieces' coarser
   *  levels and its bounds. */
  private close(): THREE.BufferGeometry {
    const position = this.position as Float32Array;
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(position, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(this.normal as Int16Array, 3, true));
    out.setAttribute('uv', new THREE.BufferAttribute(this.uv as Float32Array, 2));
    out.setAttribute(
      WOC_HEAD_MERGE_SLOT_ATTRIBUTE,
      new THREE.BufferAttribute(this.slot as Uint8Array, 1),
    );
    out.setIndex(new THREE.BufferAttribute(this.index as Uint16Array | Uint32Array, 1));
    mergeGeometryLod(
      out,
      this.pieces.map(({ geometry, flip }) => ({ geometry, flip })),
    );
    // The bounds three's computeBoundingBox and computeBoundingSphere answer, without their
    // two more walks of every vertex through an attribute read: the box was gathered band by
    // band, and the sphere is the box's centre and the farthest vertex from it.
    const center = this.box.getCenter(new THREE.Vector3());
    let radiusSq = 0;
    for (let p = 0; p < position.length; p += 3) {
      const dx = center.x - position[p];
      const dy = center.y - position[p + 1];
      const dz = center.z - position[p + 2];
      radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
    }
    out.boundingBox = this.box.clone();
    out.boundingSphere = new THREE.Sphere(center, Math.sqrt(radiusSq));
    this.position = this.normal = this.uv = this.slot = this.index = null;
    return out;
  }
}

/**
 * Fold `pieces` into one geometry, whole, in this call: a direct build (a body with no
 * work queue behind it) and the reference every chained fold is held to.
 */
export function mergeWocHeadGeometry(pieces: readonly WocHeadMergePiece[]): THREE.BufferGeometry {
  const fold = new WocHeadGeometryFold(pieces);
  for (;;) {
    const out = fold.step(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    if (out) return out;
  }
}
