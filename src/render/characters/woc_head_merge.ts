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
// back into view) and the oldest are dropped past a cap; a head folded whole whose owner
// has yet to mount it is not idle. A mount is real main-thread
// work, a build most of all (ten thousand vertices and more through their morph
// targets), so this module never decides WHEN: the rig only plans and waits, and its
// owner asks the host's work queue for the fold, a band a unit (foldPending over
// woc_head_merge_fold.ts: one fold for every character in the same face, and the head
// that has waited longest folded first, whichever character's unit runs a band), and
// then for the mount (woc_head_dressing.ts), whose frame budget spreads a crowd arriving
// at once. Everyone waiting keeps drawing their pieces: correct, just not yet cheap.
import * as THREE from 'three';
import {
  type GeometryLodLevel,
  geometryLodSourceOf,
  geometryLodVariant,
} from '../assets/geometry_lod';
import { recordBuildSpan } from '../build_spans';
import { GFX } from '../gfx';
import { riggedWornFamilyFor } from '../worn_stone';
import { logAssetMissOnce } from './asset_miss_log';
import type { WocHeadType } from './woc_head_catalog';
import type { WocHeadTintedRole, WocLinearRgb } from './woc_head_look_core';
import {
  type WocHeadMergeFoldFacts,
  type WocHeadMergeLayer,
  type WocHeadMergeSlot,
  wocHeadMergeFoldPlan,
  wocHeadMergeKey,
  wocHeadMergeTransformHash,
} from './woc_head_merge_core';
import {
  mergeWocHeadGeometry,
  WocHeadGeometryFold,
  type WocHeadMergePiece,
} from './woc_head_merge_fold';
import type { WocHeadMergeSurface } from './woc_head_tint';
import { wocIdleCacheCaps } from './woc_idle_cache_core';

export { mergeWocHeadGeometry, WocHeadGeometryFold, type WocHeadMergePiece };

// ---------------------------------------------------------------------------
// The shared geometry cache
// ---------------------------------------------------------------------------

interface Entry {
  geometry: THREE.BufferGeometry;
  refs: number;
  /** Rigs that folded this head a band a unit and have yet to mount it or let it go
   *  (the fold's drivers when its last band handed it over: publishSharedFold). A head is
   *  whole a queue turn or two before its owner's mount unit comes round, and a crowd of
   *  new faces hands the cache heads faster than that: counted idle meanwhile, the cap
   *  would drop it, its owner would fold it all over again, and past a certain crowd
   *  nothing would ever mount. */
  awaited: number;
}

const cache = new Map<string, Entry>();
/** Idle merged heads kept for a look that comes back (each is about 0.35 MB: some ten
 *  thousand vertices at 27 bytes and their indices): fewer on a constrained profile
 *  (woc_idle_cache_core.ts). */
const maxIdleMerges = (): number => wocIdleCacheCaps(GFX.constrainedMemory).mergedHeads;

/** Nobody draws it, and nobody who folded it still waits to: kept only for a look that
 *  comes back, and counted against the cap. */
const idle = (entry: Entry): boolean => entry.refs === 0 && entry.awaited === 0;

export interface WocHeadMergeLease {
  readonly geometry: THREE.BufferGeometry;
  release(): void;
}

/** Whether a merged head is already built (taking it costs no build). */
export function wocHeadMergeBuilt(key: string): boolean {
  return cache.has(key);
}

function trimIdle(): void {
  let spare = 0;
  for (const entry of cache.values()) if (idle(entry)) spare++;
  const cap = maxIdleMerges();
  for (const [key, entry] of cache) {
    if (spare <= cap) break;
    if (!idle(entry)) continue;
    cache.delete(key);
    entry.geometry.dispose();
    spare--;
  }
}

/** A lease or a wait on `entry` just ended: once nobody holds it, it is idle from here,
 *  the newest of the idle ones (release order is the LRU order, as in the far bake cache),
 *  and the cap is applied. */
function settleEntry(key: string, entry: Entry): void {
  if (idle(entry) && cache.get(key) === entry) {
    cache.delete(key);
    cache.set(key, entry);
  }
  trimIdle();
}

/** Lease the merged geometry for `key`, building it on a miss. */
export function retainWocHeadMerge(
  key: string,
  build: () => THREE.BufferGeometry,
): WocHeadMergeLease {
  let entry = cache.get(key);
  if (!entry) {
    entry = { geometry: build(), refs: 0, awaited: 0 };
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
      settleEntry(key, held);
    },
  };
}

/**
 * Drop every merged head nobody draws (a graphics profile change: the views that
 * leased them are gone, and the idle entries would otherwise outlive the renderer
 * that uploaded them). A head still leased is left to its holder; one only waited for
 * goes too, and its owner folds it again.
 */
export function clearIdleWocHeadMerges(): void {
  for (const [key, entry] of cache) {
    if (entry.refs > 0) continue;
    cache.delete(key);
    entry.geometry.dispose();
  }
}

// ---------------------------------------------------------------------------
// Folds in flight
// ---------------------------------------------------------------------------

/** A head's geometry being folded a band at a time (woc_head_merge_fold.ts), and how
 *  many rigs drive it. */
interface SharedFold {
  readonly key: string;
  /** The fold, while it stands in the line: null once it left (whole, failed, overtaken
   *  by a head built whole, or let go of by its last driver), so a rig that still holds
   *  this entry pins none of its buffers. */
  fold: WocHeadGeometryFold | null;
  /** The rigs whose units fold its bands: the last one to leave lets it go. */
  drivers: number;
  /** What a band of it threw, once one did: nobody folds it again, and each rig that
   *  drove it leaves its head in pieces when it next looks. */
  failure: { readonly error: unknown } | null;
  /** The cache entry its last band made, which its drivers wait to mount (Entry.awaited). */
  built: Entry | null;
}

/** A fold standing in the line. */
type LinedFold = SharedFold & { fold: WocHeadGeometryFold };

/** The line: the folds in flight, by the head each builds, in the order they started.
 *  Every character in one face drives ONE, whichever character's unit runs a band. Never
 *  a geometry in here: a fold holds plain arrays until its last band, and what that band
 *  makes goes straight into the cache. */
const folds = new Map<string, LinedFold>();

/** Drive the fold of `key`, starting it from `pieces` (behind every fold already in the
 *  line) when nobody folds that head yet. */
function joinSharedFold(key: string, pieces: readonly WocHeadMergePiece[]): LinedFold {
  let shared = folds.get(key);
  if (!shared) {
    shared = {
      key,
      fold: new WocHeadGeometryFold(pieces),
      drivers: 0,
      failure: null,
      built: null,
    };
    folds.set(key, shared);
  }
  shared.drivers++;
  return shared;
}

/** Take a fold out of the line, and its buffers with it. */
function leaveLine(shared: SharedFold): void {
  if (folds.get(shared.key) === shared) folds.delete(shared.key);
  shared.fold = null;
}

/** One driver lets go of a fold: with none left it is dropped where it stands (a head
 *  nobody waits for is never finished, and a later ask starts over). Of a fold that is
 *  whole, it is one rig fewer waiting to mount the head: mounted or let go of. */
function leaveSharedFold(shared: SharedFold): void {
  shared.drivers--;
  if (shared.drivers <= 0) leaveLine(shared);
  const entry = shared.built;
  if (!entry) return;
  entry.awaited--;
  settleEntry(shared.key, entry);
}

/** A fold's last band made its geometry: it is the cache's from here on, waited for by
 *  the rigs that drove the fold until each mounts it, from a unit of its own, or lets it
 *  go. Nobody folds a band of a head the cache already holds (a rig looks before it
 *  joins, and leadingFold before it answers), so the key is free. */
function publishSharedFold(shared: LinedFold, geometry: THREE.BufferGeometry): void {
  leaveLine(shared);
  shared.built = { geometry, refs: 0, awaited: shared.drivers };
  cache.set(shared.key, shared.built);
  trimIdle();
}

/**
 * The fold the next band belongs to: the one in the line LONGEST, whoever asks. A head
 * half folded saves nobody a draw, so a crowd's heads are folded one after another, each
 * standing in as soon as its own bands are done. Folded a band each in turn (the order
 * the bodies' units leave the queue in) they would all be whole in the same few frames
 * at the very end, every body drawing its pieces until then, and every one of them
 * holding its buffers meanwhile.
 */
function leadingFold(): LinedFold | undefined {
  for (const shared of folds.values()) {
    if (!cache.has(shared.key)) return shared;
    // built whole meanwhile (a body with no queue behind it mounted that face on the
    // spot): over, and its drivers only mount. A band more would end in a second
    // geometry under a key the cache holds, and orphan the leased one.
    leaveLine(shared);
  }
  return undefined;
}

/**
 * Fold ONE band of the leading fold. The band that ends it hands its geometry to the
 * cache; one that throws takes the fold out of the line for good, and each rig that
 * drove it finds that out from its own next unit (foldPending), never the rig whose unit
 * happened to run the band.
 */
function foldLeadingBand(): void {
  const lead = leadingFold();
  if (!lead) return;
  const started = performance.now();
  try {
    const geometry = lead.fold.step();
    // each band under its own view-lane kind, beside the mount's
    recordBuildSpan('view:woc-head-fold', performance.now() - started, started);
    if (geometry) publishSharedFold(lead, geometry);
  } catch (error) {
    lead.failure = { error };
    leaveLine(lead);
  }
}

export const wocHeadMergeInternalsForTest = {
  cache,
  /** The folds in flight, by key (a fold's `drivers` and its progress). */
  folds: folds as ReadonlyMap<
    string,
    { readonly fold: WocHeadGeometryFold; readonly drivers: number }
  >,
  reset(): void {
    for (const entry of cache.values()) entry.geometry.dispose();
    cache.clear();
    for (const shared of [...folds.values()]) leaveLine(shared);
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
  /** The waiting head's fold: its place in the line (foldPending), shared with every rig
   *  waiting on the same face, and, once the fold is whole, this rig's wait on the head
   *  until it mounts it or lets it go. */
  private folding: SharedFold | null = null;

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
    // a fold driven for another head than the one drawn now is no longer this rig's
    if (this.folding && this.folding.key !== plan?.key) this.leaveFold();
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
    try {
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
        this.refuse(wanted.plan.key, err);
        return false;
      }
      // the whole mount (the build on a miss, the visual's per-mesh setup, the wrap) under
      // its own view-lane kind: it runs from the per-frame path, never inside a view build
      recordBuildSpan('view:woc-head-merge', performance.now() - started, started);
      return this.mounted !== null;
    } finally {
      // After the lease, never before it: a head this rig folded stays waited for until
      // it is mounted. (And a head mounted whole, no queue behind its owner, needs no
      // band of a chained fold.)
      this.leaveFold();
    }
  }

  /**
   * Fold ONE band of a head's geometry (woc_head_merge_fold.ts): the build `mountPending`
   * does whole, for an owner that runs it as a chain of queue units. The waiting head
   * takes its place in the line (every rig waiting on one face drives the same fold),
   * and the band folded is the LEADING fold's, this rig's own or not (leadingFold): the
   * heads of a crowd finish one after another, whichever rig's unit runs a band, and the
   * band that ends a fold hands its geometry to the cache. `wanted` false (the owner
   * looked again: the head is no longer at rest, its body no longer drawn, the merge
   * switched off) lets go of this rig's fold instead, and a fold nobody drives is
   * dropped. Returns whether nothing is left to fold FOR THIS RIG: its head is built
   * (`mountPending` only mounts), or it is no longer waited for. A plan gone stale and a
   * fold that threw (a band of it, under any rig's unit, or its start) leave the head in
   * its pieces, as they do in `mountPending`.
   */
  foldPending(wanted = true): boolean {
    const pending = wanted ? this.pending : null;
    if (!pending) {
      this.leaveFold();
      return true;
    }
    if (wocHeadMergeBuilt(pending.plan.key)) {
      // Whole: nothing to fold. A rig that drove the fold to its end goes on waiting for
      // the head until it mounts it or lets it go; one whose fold was overtaken (a body
      // with no queue built that face whole) has no band left to drive.
      if (!this.folding?.built) this.leaveFold();
      return true;
    }
    const { plan } = pending;
    let own = this.folding;
    // (a band of it threw under another rig's unit since this one last looked)
    if (own?.key === plan.key && own.failure) return this.failFold(plan.key, own.failure.error);
    // (a fold that left the line since, finished or overtaken by a head built whole, and
    // whose geometry the cache has dropped again, is over: the head starts another)
    if (own?.key !== plan.key || !own.fold) {
      this.leaveFold();
      try {
        // a fold bakes the pieces as they are when it STARTS, under the key taken when
        // the head was planned (mountPending's rule): a face written since is another head
        if (planKey(plan) !== plan.key) {
          this.pending = null;
          return true;
        }
        own = joinSharedFold(plan.key, plan.pieces);
      } catch (err) {
        return this.failFold(plan.key, err);
      }
      this.folding = own;
    }
    foldLeadingBand();
    if (own.failure) return this.failFold(plan.key, own.failure.error);
    // still in the line: more to fold, its own bands or those of the heads ahead of it;
    // out of it, the head is whole and this rig waits to mount it
    return !own.fold;
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
    this.leaveFold();
  }

  /** Stop driving the fold this rig ran bands of: the last driver to leave drops it. */
  private leaveFold(): void {
    const shared = this.folding;
    if (!shared) return;
    this.folding = null;
    leaveSharedFold(shared);
  }

  /** The waiting head's fold threw (a band of it, under this rig's unit or another's, or
   *  its start): the head keeps its pieces and is never tried again, or its owner would
   *  ask for the same band on every frame after this one. Answers what foldPending does:
   *  nothing is left to fold. */
  private failFold(key: string, err: unknown): true {
    this.leaveFold();
    this.pending = null;
    this.refuse(key, err);
    return true;
  }

  /** Leave a head that threw in its pieces for good. */
  private refuse(key: string, err: unknown): void {
    this.refused = key;
    logAssetMissOnce(
      `woc-head-merge:${this.type}:${err instanceof Error ? err.message : String(err)}`,
      'WOC merged head could not mount, the head keeps drawing piece by piece:',
      err,
    );
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
