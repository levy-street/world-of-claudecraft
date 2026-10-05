// The three.js half of the merged WOC head (woc_head_merge_core.ts owns the slot
// table and the cache identity): fold the pieces a head DRAWS into ONE mesh on the
// head bone, drawn with one material (woc_head_tint.ts, the merged layer), so a face
// costs one draw in the colour pass and one in the shadow pass instead of a dozen of
// each.
//
// The pieces stay the source of truth. The dressing (woc_head_dressing.ts) still
// decides what a look shows, poses the face morphs and owns the colours on the hung
// pieces exactly as before; this module only builds a stand-in for whatever is drawn
// right now and takes the pieces out of the render lists while it stands
// (`layers.mask = 0`: three tests layers in both passes, and nothing that reads a
// piece's `visible` flag, its bounds or its morphs is told otherwise). Anything that
// changes the drawn head (a hairstyle, the helm, a slider) drops the stand-in, the
// pieces draw again on that frame, and a new one is built for the new head.
//
// What a merge bakes: each piece's vertices with its current morph influences applied
// (the face sliders, the bald crown, the scalp tuck), moved into the head bone's space
// through the piece's own node transform (which carries the pack's dequantization),
// its normals with them, its uv as authored (a flat-coloured piece takes the atlas's
// white cell), and the SLOT of its material in a per-vertex byte. Nothing is skinned:
// the merged mesh is a rigid child of the head bone, as every piece was.
//
// Sidedness is not baked: the merged head is drawn two sided and each slot remembers
// whether its own material was one sided (woc_head_tint.ts explains the back-face
// drop, and why neither a two sided draw of everything nor a second copy of the two
// sided pieces was kept). The shadow pass draws the merged head by both faces: the
// same shadow for every closed piece, and an open one sided card (the handlebar
// moustache) casts from both faces instead of its back only.
//
// The geometry is cached by the head it draws (wocHeadMergeKey, by each piece's SOURCE
// geometry) and leased: a crowd in one face (a camp of the same NPC) shares one buffer,
// a player's own face is its own. The fold carries the pieces' coarser levels
// (assets/geometry_lod.ts), and each character's merged mesh draws the level its pieces
// draw, a variant over the very same buffers, so two characters in one face share the
// buffer whatever their detail and each draws its own level of it. An idle entry is
// kept for a while (the same look comes back when a peer walks
// back into view) and the oldest are dropped past a cap. A mount is real main-thread
// work, a build most of all (a few thousand vertices through their morph targets), so
// this module never decides WHEN: the rig only plans and waits, and its owner asks the
// host's work queue for the mount (woc_head_dressing.ts), whose frame budget spreads a
// crowd arriving at once. Everyone waiting keeps drawing their pieces: correct, just
// not yet cheap.
import * as THREE from 'three';
import {
  type GeometryLodLevel,
  geometryLodSourceOf,
  geometryLodVariant,
  mergeGeometryLod,
} from '../assets/geometry_lod';
import { recordBuildSpan } from '../build_spans';
import { riggedWornFamilyFor } from '../worn_stone';
import { logAssetMissOnce } from './asset_miss_log';
import type { WocHeadType } from './woc_head_catalog';
import type { WocHeadTintedRole, WocLinearRgb } from './woc_head_look_core';
import {
  WOC_HEAD_MERGE_SLOT_ATTRIBUTE,
  type WocHeadMergeFoldFacts,
  type WocHeadMergeLayer,
  type WocHeadMergeSlot,
  wocHeadMergeFoldPlan,
  wocHeadMergeKey,
  wocHeadMergeTransformHash,
} from './woc_head_merge_core';
import type { WocHeadMergeSurface } from './woc_head_tint';

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

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _base = new THREE.Vector3();

/**
 * Fold `pieces` into one geometry: positions and normals posed and moved into the
 * merged mesh's space, uv, and the per-vertex slot. A mirrored piece (a negative
 * determinant) has its winding flipped, as three flips the front face for its mesh.
 *
 * Each piece is folded from its SOURCE geometry (a piece drawn at a coarser level draws a
 * variant over the same buffers: assets/geometry_lod.ts), and the merged geometry carries
 * the pieces' coarser levels, offset and flipped as its own index is: its mid level draws
 * exactly the pieces' mid triangles, whoever folded it.
 */
export function mergeWocHeadGeometry(pieces: readonly WocHeadMergePiece[]): THREE.BufferGeometry {
  let vertices = 0;
  let indices = 0;
  for (const { mesh } of pieces) {
    const source = geometryLodSourceOf(mesh.geometry);
    const pos = source.getAttribute('position');
    vertices += pos.count;
    indices += wholeTriangles(source.index ? source.index.count : pos.count);
  }
  const position = new Float32Array(vertices * 3);
  const normal = new Int16Array(vertices * 3);
  const uv = new Float32Array(vertices * 2);
  const slot = new Uint8Array(vertices);
  const index = vertices > 0xffff ? new Uint32Array(indices) : new Uint16Array(indices);
  const normalMatrix = new THREE.Matrix3();
  let v0 = 0;
  let i0 = 0;
  for (const piece of pieces) {
    const { mesh, toRoot } = piece;
    const geo = geometryLodSourceOf(mesh.geometry);
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const tex = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const morphNormals = geo.morphAttributes.normal;
    const influences = mesh.morphTargetInfluences;
    normalMatrix.getNormalMatrix(toRoot);
    for (let i = 0; i < pos.count; i++) {
      // the same sum three's morph chunk draws (relative targets, as glTF ships them)
      THREE.Mesh.prototype.getVertexPosition.call(mesh, i, _v);
      _v.applyMatrix4(toRoot);
      const p = (v0 + i) * 3;
      position[p] = _v.x;
      position[p + 1] = _v.y;
      position[p + 2] = _v.z;
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
        _n.applyMatrix3(normalMatrix).normalize();
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
    const flip = toRoot.determinant() < 0;
    const count = wholeTriangles(geo.index ? geo.index.count : pos.count);
    for (let k = 0; k < count; k += 3) {
      const a = geo.index ? geo.index.getX(k) : k;
      const b = geo.index ? geo.index.getX(k + 1) : k + 1;
      const c = geo.index ? geo.index.getX(k + 2) : k + 2;
      index[i0 + k] = v0 + a;
      index[i0 + k + 1] = v0 + (flip ? c : b);
      index[i0 + k + 2] = v0 + (flip ? b : c);
    }
    v0 += pos.count;
    i0 += count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3, true));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute(WOC_HEAD_MERGE_SLOT_ATTRIBUTE, new THREE.BufferAttribute(slot, 1));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  mergeGeometryLod(
    out,
    pieces.map(({ mesh, toRoot }) => ({ geometry: mesh.geometry, flip: toRoot.determinant() < 0 })),
  );
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

// ---------------------------------------------------------------------------
// The shared geometry cache
// ---------------------------------------------------------------------------

interface Entry {
  geometry: THREE.BufferGeometry;
  refs: number;
}

const cache = new Map<string, Entry>();
/** Idle merged heads kept for a look that comes back (each is about 0.35 MB: some ten
 *  thousand vertices at 27 bytes and their indices). */
const MAX_IDLE_MERGES = 12;

export interface WocHeadMergeLease {
  readonly geometry: THREE.BufferGeometry;
  release(): void;
}

/** Whether a merged head is already built (taking it costs no build). */
export function wocHeadMergeBuilt(key: string): boolean {
  return cache.has(key);
}

function trimIdle(): void {
  let idle = 0;
  for (const entry of cache.values()) if (entry.refs === 0) idle++;
  for (const [key, entry] of cache) {
    if (idle <= MAX_IDLE_MERGES) break;
    if (entry.refs > 0) continue;
    cache.delete(key);
    entry.geometry.dispose();
    idle--;
  }
}

/** Lease the merged geometry for `key`, building it on a miss. */
export function retainWocHeadMerge(
  key: string,
  build: () => THREE.BufferGeometry,
): WocHeadMergeLease {
  let entry = cache.get(key);
  if (!entry) {
    entry = { geometry: build(), refs: 0 };
    cache.set(key, entry);
  }
  entry.refs++;
  const held = entry;
  let released = false;
  return {
    geometry: entry.geometry,
    release() {
      if (released) return;
      released = true;
      held.refs--;
      // release order is the LRU order, as in the far bake cache
      if (held.refs === 0 && cache.get(key) === held) {
        cache.delete(key);
        cache.set(key, held);
      }
      trimIdle();
    },
  };
}

/**
 * Drop every merged head nobody draws (a graphics profile change: the views that
 * leased them are gone, and the idle entries would otherwise outlive the renderer
 * that uploaded them). A head still leased is left to its holder.
 */
export function clearIdleWocHeadMerges(): void {
  for (const [key, entry] of cache) {
    if (entry.refs > 0) continue;
    cache.delete(key);
    entry.geometry.dispose();
  }
}

export const wocHeadMergeInternalsForTest = {
  cache,
  reset(): void {
    for (const entry of cache.values()) entry.geometry.dispose();
    cache.clear();
  },
};

// ---------------------------------------------------------------------------
// The merged material's source
// ---------------------------------------------------------------------------

const mergedSources = new WeakMap<THREE.Material, THREE.Material>();

/**
 * The SOURCE material a merged head draws with: the base head's file material (its
 * map is the core atlas), two sided because a merged head folds the open pieces (the
 * ears, the brow cards, the hair) with the closed ones; the merged shader drops the
 * back of a slot whose own material was one sided. One per head file, so the tier
 * derivation is shared by every merged head of the type. The slot tables carry what
 * differed per piece (woc_head_tint.ts setWocHeadMergedSlots).
 */
export function wocHeadMergedSource(base: THREE.Material): THREE.Material {
  let out = mergedSources.get(base);
  if (!out) {
    out = base.clone();
    out.name = 'woc_head_merged';
    out.side = THREE.DoubleSide;
    mergedSources.set(base, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The fold, read off the meshes
// ---------------------------------------------------------------------------

/** Tag on the merged mesh (the dressing wraps it with the merged tint layer). */
export const WOC_HEAD_MERGED_KEY = 'wocHeadMerged';

/** What the merge needs of a drawn piece mesh. */
export interface WocHeadMergeCandidate {
  readonly mesh: THREE.Mesh;
  /** The piece node's name (`WocHead_<T>_<slot>_<variant>[_L|_R]`). */
  readonly piece: string;
  /** The FILE material the mesh hangs with (its name is the tint row, its uuid the slot). */
  readonly material: THREE.Material;
  readonly role: WocHeadTintedRole | null;
  readonly ref: WocLinearRgb | null;
}

const mapOf = (m: THREE.Material): THREE.Texture | null =>
  (m as THREE.MeshStandardMaterial).map ?? null;

/** Whether a colour map samples the mesh's first uv set untransformed, as the merged
 *  shader does for all four of its textures. */
function plainMap(map: THREE.Texture | null): boolean {
  return (
    map === null ||
    (map.channel === 0 &&
      map.offset.x === 0 &&
      map.offset.y === 0 &&
      map.repeat.x === 1 &&
      map.repeat.y === 1 &&
      map.rotation === 0)
  );
}

/**
 * Whether a file material can ride the merged material: a plain standard material
 * (the merged one is a clone of the base head's: a basic material has no lighting to
 * share, a physical one carries layers the slot rows do not), opaque, depth-writing,
 * drawn by its front (or both sides), nothing but an untransformed colour map on the
 * first uv set (the merged shader samples no other slot), and no surface layer of its
 * own: the tier derivation gives a material the worn detail layer by its NAME (the
 * gold of a piercing takes the metal one: worn_stone.ts riggedWornFamilyFor), which
 * the merged material does not carry, so such a piece keeps drawing by itself.
 */
function mergeable(m: THREE.Material): boolean {
  const s = m as THREE.MeshStandardMaterial;
  return (
    m.type === 'MeshStandardMaterial' &&
    riggedWornFamilyFor(m.name) === null &&
    s.side !== THREE.BackSide &&
    !s.transparent &&
    !(s.alphaTest > 0) &&
    s.depthWrite !== false &&
    !s.polygonOffset &&
    plainMap(s.map) &&
    !s.alphaMap &&
    !s.normalMap &&
    !s.roughnessMap &&
    !s.metalnessMap &&
    !s.emissiveMap &&
    !s.aoMap &&
    !s.vertexColors
  );
}

/** One drawn piece the merged material draws. */
export interface WocHeadMergeFolded<P> {
  readonly candidate: WocHeadMergeCandidate;
  readonly layer: WocHeadMergeLayer;
  /** Its slot in the merged material's tables. */
  readonly slot: number;
  /** A flat-coloured piece's uv (the atlas's white cell); null: the piece's own uv. */
  readonly flatUv: readonly [number, number] | null;
  /** What the caller's `place` answered for it. */
  readonly placed: P;
}

/** What of a drawn head ONE merged material can draw. */
export interface WocHeadMergeFold<P> {
  /** The base head's file material: the merged material's source (wocHeadMergedSource). */
  readonly base: THREE.Material;
  /** The folded pieces, in the order given. */
  readonly folded: readonly WocHeadMergeFolded<P>[];
  readonly slots: readonly WocHeadMergeSlot[];
  readonly hairMap: THREE.Texture | null;
  readonly beardMap: THREE.Texture | null;
  /** A hairstyle's second texture (its scalp cap), or null. */
  readonly scalpMap: THREE.Texture | null;
}

/**
 * The fold rule (woc_head_merge_core.ts wocHeadMergeFoldPlan) read off the meshes: one
 * answer for the near stand-in (WocHeadMergeRig) and the far bake's head group
 * (woc_far_head.ts). `place` is the caller's own say over a piece: what it answers
 * rides the folded piece, and null leaves the piece out (the near merge: no path into
 * the head bone's space). Null when there is nothing to fold. Every piece left out
 * keeps drawing with its own material.
 */
export function wocHeadMergeFold<P>(
  drawn: readonly WocHeadMergeCandidate[],
  place: (candidate: WocHeadMergeCandidate) => P | null,
): WocHeadMergeFold<P> | null {
  const maps = new Map<string, THREE.Texture>();
  const placed: (P | null)[] = [];
  const facts = drawn.map((c): WocHeadMergeFoldFacts => {
    const geo = c.mesh.geometry;
    // one whole geometry on one material (three ignores a geometry's groups under a
    // single material): a draw range would have the fold draw triangles the piece
    // itself does not
    const whole =
      !!geo?.getAttribute('position') &&
      geo.drawRange.start === 0 &&
      geo.drawRange.count === Number.POSITIVE_INFINITY;
    const ok = !Array.isArray(c.mesh.material) && whole && mergeable(c.material);
    const at = ok ? place(c) : null;
    placed.push(at);
    const map = mapOf(c.material);
    if (map) maps.set(map.uuid, map);
    return {
      piece: c.piece,
      material: c.material.uuid,
      map: map?.uuid ?? null,
      mergeable: ok,
      placeable: at !== null,
      hasUv: !!geo?.getAttribute('uv'),
      oneSided: c.material.side !== THREE.DoubleSide,
      role: c.role,
      ref: c.ref,
    };
  });
  const base = drawn.find((c) => /^WocHead_[A-Za-z]_base$/.test(c.piece))?.material;
  const white = (base?.userData.wocHeadAtlas as { white?: [number, number] } | undefined)?.white;
  const plan = wocHeadMergeFoldPlan(facts, !!white);
  if (!plan || !base) return null;
  const mapAt = (id: string | null): THREE.Texture | null => (id ? (maps.get(id) ?? null) : null);
  return {
    base,
    folded: plan.folded.map(({ at, layer, slot, flat }) => ({
      candidate: drawn[at],
      layer,
      slot,
      flatUv: flat && white ? white : null,
      placed: placed[at] as P,
    })),
    slots: plan.slots,
    hairMap: mapAt(plan.hairMap),
    beardMap: mapAt(plan.beardMap),
    scalpMap: mapAt(plan.scalpMap),
  };
}

/** The mesh's local space to `root`'s, composed from local transforms (never world
 *  matrices: a body is dressed before its first matrix update). */
function matrixTo(mesh: THREE.Object3D, root: THREE.Object3D): THREE.Matrix4 | null {
  const out = new THREE.Matrix4();
  const step = new THREE.Matrix4();
  for (let o: THREE.Object3D | null = mesh; o && o !== root; o = o.parent) {
    // a node that keeps its own matrix is drawn by it, not by its position and rotation
    if (o.matrixAutoUpdate) step.compose(o.position, o.quaternion, o.scale);
    else step.copy(o.matrix);
    out.premultiply(step);
    if (!o.parent) return null;
  }
  return out;
}

const colorOf = (c: THREE.Color | undefined): [number, number, number] =>
  c ? [c.r, c.g, c.b] : [1, 1, 1];

/** A material's surface as the merged shader needs it. */
export function wocHeadMergeSurfaceOf(
  material: THREE.Material | THREE.Material[],
): WocHeadMergeSurface {
  const m = (Array.isArray(material) ? material[0] : material) as THREE.MeshStandardMaterial;
  const k = m.emissiveIntensity ?? 1;
  const e = m.emissive;
  return {
    color: colorOf(m.color),
    emissive: e ? [e.r * k, e.g * k, e.b * k] : [0, 0, 0],
    roughness: m.roughness ?? 1,
    metalness: m.metalness ?? 0,
  };
}

// ---------------------------------------------------------------------------
// One character's merged head
// ---------------------------------------------------------------------------

/** The character-visual side of a merged head: the late-attach seam every streamed
 *  part of a WOC body uses (woc_armor_dressing.ts's host shape). */
export interface WocHeadMergeHost {
  /** Give a freshly mounted wrapper's meshes the visual's per-mesh setup; `retint` runs
   *  between its material pass and its snapshot. */
  adopt(node: THREE.Object3D, retint: () => void): void;
  /** Take a removed wrapper's meshes out of the visual's bookkeeping. */
  forget(node: THREE.Object3D): void;
}

interface Plan {
  readonly key: string;
  readonly pieces: WocHeadMergePiece[];
  /** Per piece: its file material's identity and its texture layer (the key's inputs). */
  readonly materials: string[];
  readonly layers: WocHeadMergeLayer[];
  readonly sources: THREE.Mesh[];
  readonly slots: readonly WocHeadMergeSlot[];
  /** One source mesh per slot: its material is the slot's surface. */
  readonly slotSources: THREE.Mesh[];
  readonly base: THREE.Material;
  readonly hairMap: THREE.Texture | null;
  readonly beardMap: THREE.Texture | null;
  readonly scalpMap: THREE.Texture | null;
}

/** The cache key of a plan's pieces as they are posed right now. */
function planKey(plan: Plan): string {
  return wocHeadMergeKey(
    plan.pieces.map((piece, i) => ({
      // the piece's SOURCE geometry: a head folds the same buffer at every level (its levels
      // ride the merged geometry), so characters of every detail share one entry
      geometry: geometryLodSourceOf(piece.mesh.geometry).uuid,
      material: plan.materials[i],
      layer: plan.layers[i],
      influences: piece.mesh.morphTargetInfluences ?? [],
      transform: wocHeadMergeTransformHash(piece.toRoot.elements),
    })),
  );
}

interface Mounted extends Plan {
  readonly lease: WocHeadMergeLease;
  readonly wrapper: THREE.Group;
  readonly mesh: THREE.Mesh;
  /** Each source's layer mask from before it was taken out of the render lists. */
  masks: number[] | null;
}

/** What the dressing writes onto the merged material it wraps. */
export interface WocHeadMergeTable {
  readonly slots: readonly WocHeadMergeSlot[];
  /** One source mesh per slot: its pre-effect material is the slot's surface. */
  readonly slotSources: readonly THREE.Mesh[];
  readonly hairMap: THREE.Texture | null;
  readonly beardMap: THREE.Texture | null;
  readonly scalpMap: THREE.Texture | null;
}

const materialOf = (mesh: THREE.Mesh): THREE.Material | undefined =>
  Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;

/** How many reveals of one head may come back unprepared before it is left in pieces. */
const MAX_UNPREPARED_REVEALS = 2;

export class WocHeadMergeRig {
  private mounted: Mounted | null = null;
  /** The head wanted but not mounted yet: `mountPending` mounts it without planning it
   *  again. */
  private pending: { readonly bone: THREE.Object3D; readonly plan: Plan } | null = null;
  /** A head never tried again: its mount threw (a per-frame throw would be a stall), or
   *  its reveal came back unprepared more than once. */
  private refused: string | null = null;
  /** Reveals of one head in a row that came back unprepared. */
  private unprepared: { key: string; count: number } | null = null;
  /** The last mount was adopted straight into a translucent effect and taken down. */
  private translucent = false;

  constructor(
    private readonly host: WocHeadMergeHost,
    readonly type: WocHeadType,
    /** Wrap the mounted merged mesh's material with the merged tint layer (the dressing). */
    private readonly retint: () => void,
    /** Reveal a freshly mounted wrapper once it can draw without linking, then call
     *  `live`; `live(false)` when it could not be prepared (the head stays in pieces). */
    private readonly reveal: (node: THREE.Object3D, live: (prepared: boolean) => void) => void,
    /** The geometry level the pieces draw (woc_lod_core.ts): the merged mesh draws the same
     *  level of the shared merged geometry. */
    private readonly lod: GeometryLodLevel = 'lod0',
  ) {}

  /** The merged mesh while one is mounted (drawn once its reveal settled). */
  get mesh(): THREE.Mesh | null {
    return this.mounted?.mesh ?? null;
  }

  /** Whether the merged mesh stands in for its pieces right now. */
  get standing(): boolean {
    return this.mounted?.masks != null;
  }

  /** Whether a wanted head still waits to be mounted (the caller schedules `mountPending`). */
  get isWaiting(): boolean {
    return this.pending !== null;
  }

  /** Whether the waiting head's geometry is already built (its mount builds nothing). */
  get pendingBuilt(): boolean {
    return this.pending !== null && wocHeadMergeBuilt(this.pending.plan.key);
  }

  /** Whether the last `mountPending` took its head straight down again because the body
   *  wears a translucent effect the pieces had not shown yet (the effect's swap was
   *  still linking): the caller plans again when the effect state next changes. */
  get heldByEffect(): boolean {
    return this.translucent;
  }

  /** The slot table and textures of the mounted head, or null. */
  get table(): WocHeadMergeTable | null {
    return this.mounted;
  }

  /**
   * Reconcile with exactly these drawn pieces under `headBone` (null: nothing to stand
   * in for). A head already mounted for them is left alone; any other is dropped at
   * once, so its pieces draw again, and the new head waits (isWaiting) for
   * `mountPending`. Never a mount: a look change lands inside the caller's own material
   * pass, where a mount would be adopted twice. Returns whether a mounted head dropped.
   */
  sync(headBone: THREE.Object3D | null, drawn: readonly WocHeadMergeCandidate[] | null): boolean {
    const plan = headBone && drawn ? this.plan(headBone, drawn) : null;
    this.pending = null;
    if (!plan || !headBone || plan.key === this.refused) return this.drop();
    if (this.mounted?.key === plan.key) return false;
    const dropped = this.drop();
    this.pending = { bone: headBone, plan };
    return dropped;
  }

  /**
   * Mount the head `sync` left waiting. The caller owns the when (its frame budget).
   * Returns whether this call mounted one (false with nothing waiting); a mount that
   * throws, one adopted straight into a translucent effect, and a plan gone stale
   * leave the head in its pieces.
   */
  mountPending(): boolean {
    const wanted = this.pending;
    if (!wanted) return false;
    this.pending = null;
    this.translucent = false;
    // the geometry is baked from the pieces as they are NOW, under the key taken when
    // the head was planned: a face written since (only `apply` writes one, and it plans
    // again) would be cached under another face's key
    if (planKey(wanted.plan) !== wanted.plan.key) return false;
    const started = performance.now();
    try {
      this.mount(wanted.bone, wanted.plan);
    } catch (err) {
      // a head that cannot mount keeps its pieces, and is never tried again: a throw
      // from the per-frame path would stall every frame after it
      this.drop();
      this.refused = wanted.plan.key;
      logAssetMissOnce(
        `woc-head-merge:${this.type}:${err instanceof Error ? err.message : String(err)}`,
        'WOC merged head could not mount, the head keeps drawing piece by piece:',
        err,
      );
      return false;
    }
    // the whole mount (the build on a miss, the visual's per-mesh setup, the wrap) under
    // its own view-lane kind: it runs from the per-frame path, never inside a view build
    recordBuildSpan('view:woc-head-merge', performance.now() - started, started);
    return this.mounted !== null;
  }

  /** Take the merged head down; its pieces draw again. Returns whether one was up. */
  drop(): boolean {
    const m = this.mounted;
    if (!m) return false;
    this.mounted = null;
    const masks = m.masks;
    if (masks) {
      for (let i = 0; i < m.sources.length; i++) m.sources[i].layers.mask = masks[i] ?? 1;
    }
    this.host.forget(m.wrapper);
    m.wrapper.removeFromParent();
    m.lease.release();
    return true;
  }

  dispose(): void {
    this.drop();
    this.pending = null;
  }

  private plan(headBone: THREE.Object3D, drawn: readonly WocHeadMergeCandidate[]): Plan | null {
    // a piece hung on another bone keeps drawing by itself
    const fold = wocHeadMergeFold(drawn, (c) => matrixTo(c.mesh, headBone));
    if (!fold) return null;
    const pieces: WocHeadMergePiece[] = [];
    const slotSources: THREE.Mesh[] = [];
    for (const { candidate: c, slot, flatUv, placed: toRoot } of fold.folded) {
      pieces.push({ mesh: c.mesh, toRoot, slot, flatUv });
      slotSources[slot] ??= c.mesh;
    }
    const plan = {
      pieces,
      materials: fold.folded.map(({ candidate }) => candidate.material.uuid),
      layers: fold.folded.map(({ layer }) => layer),
      sources: fold.folded.map(({ candidate }) => candidate.mesh),
      slots: fold.slots,
      slotSources,
      base: fold.base,
      hairMap: fold.hairMap,
      beardMap: fold.beardMap,
      scalpMap: fold.scalpMap,
    };
    return { ...plan, key: planKey({ ...plan, key: '' }) };
  }

  private mount(headBone: THREE.Object3D, plan: Plan): void {
    const lease = retainWocHeadMerge(plan.key, () => mergeWocHeadGeometry(plan.pieces));
    const mesh = new THREE.Mesh(
      geometryLodVariant(lease.geometry, this.lod),
      wocHeadMergedSource(plan.base),
    );
    mesh.name = `WocHead_${this.type.toUpperCase()}_merged`;
    mesh.userData = { wocHeadPart: true, wocArmorPart: true, [WOC_HEAD_MERGED_KEY]: true };
    // drawn wherever its pieces were (a layer mask a piece carries rides onto the stand-in)
    mesh.layers.mask = plan.sources[0]?.layers.mask ?? mesh.layers.mask;
    const wrapper = new THREE.Group();
    wrapper.name = 'woc_head_merged';
    // hidden until revealed: a mount that fails half way never draws over its pieces
    wrapper.visible = false;
    wrapper.add(mesh);
    headBone.add(wrapper);
    const mounted: Mounted = { ...plan, lease, wrapper, mesh, masks: null };
    this.mounted = mounted;
    this.host.adopt(wrapper, this.retint);
    // A translucent effect the body is about to wear (its swap still linking, so the
    // pieces looked opaque when this head was planned) lands on a mesh adopted now: one
    // two sided mesh blends its pieces differently, so the head stays in pieces and the
    // caller plans again when the effect ends.
    if (materialOf(mesh)?.transparent) {
      this.translucent = true;
      this.drop();
      return;
    }
    this.reveal(wrapper, (prepared) => {
      // a head dropped (or replaced) while its programs linked: nothing to stand in for
      if (this.mounted !== mounted) return;
      if (!prepared) {
        // its program is not known linked: drawing it now could link on a live frame,
        // and the pieces are still there to draw. The caller plans it again (an effect
        // edge during the link is the usual cause, and the next try lands); a head that
        // comes back unprepared twice running is left in its pieces for good.
        this.drop();
        const strikes = this.unprepared?.key === plan.key ? this.unprepared.count + 1 : 1;
        this.unprepared = { key: plan.key, count: strikes };
        if (strikes >= MAX_UNPREPARED_REVEALS) this.refused = plan.key;
        return;
      }
      this.unprepared = null;
      wrapper.visible = true;
      mounted.masks = mounted.sources.map((source) => {
        const mask = source.layers.mask;
        source.layers.mask = 0;
        return mask;
      });
    });
  }
}
