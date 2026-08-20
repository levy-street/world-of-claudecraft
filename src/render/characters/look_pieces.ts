// A composed look's decal textures and geometries as PIECES of the GPU work
// queue, so a body whose styles the session has never seen does not build its
// maps inside the frame the entity enters range.
//
// The measurement behind it (headless crowd-arrival bench, iGPU and RTX 3090
// alike, then a production capture): 94 percent
// of a composed view build is the two procedural decal maps (the 1024^2 stubble
// map at 60 to 100 ms, the 512^2 makeup map at 20 ms) plus their head cuts,
// every one of them a pure function of the STYLE selection and cached per
// style key for the session; everything else in the build is about 1 ms. So
// the split is by piece, not by entity: each map is painted a band of rows at
// a time as its own queue unit (the same admission every other piece rides,
// gpu_prep_budget_core, learning the cost per label kind), a cut is one unit,
// pieces are deduped by key across the crowd, and an entity whose pieces are
// not all resident builds its body at once WITHOUT its face decals (the body
// is the stand-in: nameplate, click target and silhouette on the frame it
// enters range, never an invisible player) and attaches the decals through the
// compile gate once its pieces land (CharacterVisual.attachDeferredDecals).
// Under a cover and for the local target the renderer never consults this
// seam: those builds stay synchronous, decals included.
//
// No import from assets.ts here, on purpose: assets.ts asks this module
// whether a look is ready (its deferral decision), so the head a cut needs is
// a PARAMETER (assets resolves it from the cached variant, modularHeadFor).
import type * as THREE from 'three';
import {
  ensureMakeupGeometry,
  hasMakeupGeometry,
  hasMakeupTexture,
  MAKEUP_TEX_SIZE,
  makeupKeyOf,
  makeupTextureFromData,
  makeupTextureRows,
} from './makeup';
import type { VisualDef } from './manifest';
import {
  type MakeupSelection,
  type ModularLook,
  makeupSelection,
  type StubbleSelection,
  stubbleDecals,
  wearsFaceDecal,
} from './modular';
import {
  DECAL_TEX_SIZE,
  decalKey,
  decalTextureFromData,
  decalTextureRows,
  ensureDecalGeometry,
  hasDecalGeometry,
  hasDecalTexture,
} from './stubble';

/** Rows of a decal map one queue unit paints: a STRUCTURAL fraction of the
 *  texture (bands = size / LOOK_BAND_ROWS: 128 units for the 1024 stubble map,
 *  64 for the 512 makeup map), never a timing. It fixes the size of a unit
 *  small enough that the per-frame budget decides how many units fit a frame,
 *  so no number here is tuned to a machine. The criterion that set it: a unit
 *  must fit inside a frame's spare budget on the weakest target, and the
 *  earlier sixteenth of the stubble map (64 rows) cost 18 to 22 ms per unit
 *  in the browser on the iGPU bench, more than a whole frame there. */
export const LOOK_BAND_ROWS = 8;

/** How many band units a map of `size` rows is painted in. */
export function lookTextureBands(size: number): number {
  return Math.ceil(size / LOOK_BAND_ROWS);
}

/** The slice of the background GPU queue a piece rides (synchronous CPU work
 *  is a valid unit there). */
export interface LookPieceQueue {
  run<T>(work: () => T | Promise<T>, priority?: number, label?: string): Promise<T>;
}

/** Label kinds (the prefix up to the first colon, gpuPrepKindOfLabel): one
 *  per texture family so the budget learns each map's band cost apart, and
 *  one for the cuts. */
export const STUBBLE_BAND_LABEL = 'decal-stubble';
export const MAKEUP_BAND_LABEL = 'decal-makeup';
export const DECAL_GEOMETRY_LABEL = 'decal-geometry';
/** The late attach of a deferred body's decals, one unit per body. */
export const DECAL_ATTACH_LABEL = 'decal-attach';

interface LookPiece {
  key: string;
  start(queue: LookPieceQueue, priority: number): Promise<void>;
}

/** In-flight pieces by key, each a promise that settles once the piece is
 *  resident or dropped, so a look can wait on a piece another look started. */
const inFlight = new Map<string, Promise<void>>();
const warned = new Set<string>();
let completedPieces = 0;
let bandsRun = 0;
let deferred = 0;
let attached = 0;

async function runTextureBands(
  queue: LookPieceQueue,
  priority: number,
  labelKind: string,
  key: string,
  size: number,
  paintRows: (out: Uint8Array<ArrayBuffer>, rowStart: number, rowEnd: number) => void,
  publish: (data: Uint8Array<ArrayBuffer>) => void,
): Promise<void> {
  // The map's buffer (4 MB for the stubble map) is allocated inside the FIRST
  // band's unit, never in the frame that decided to defer: that frame is the
  // one the deferral exists to spare.
  let data: Uint8Array<ArrayBuffer> | null = null;
  const bands = lookTextureBands(size);
  for (let band = 0; band < bands; band++) {
    const last = band === bands - 1;
    // The next band is enqueued from this unit's completion, never all at
    // once, so a map in progress holds one slot in the queue, not a hundred.
    await queue.run(
      () => {
        data ??= new Uint8Array(new ArrayBuffer(size * size * 4));
        paintRows(data, band * LOOK_BAND_ROWS, Math.min(size, (band + 1) * LOOK_BAND_ROWS));
        bandsRun++;
        if (last) publish(data);
      },
      priority,
      `${labelKind}:${key}:${band}`,
    );
  }
}

function stubbleTexturePiece(sel: StubbleSelection): LookPiece {
  const key = decalKey(sel);
  return {
    key: `stubble:${key}`,
    start: (queue, priority) =>
      runTextureBands(
        queue,
        priority,
        STUBBLE_BAND_LABEL,
        key,
        DECAL_TEX_SIZE,
        (out, rowStart, rowEnd) => decalTextureRows(sel, out, rowStart, rowEnd, DECAL_TEX_SIZE),
        (data) => decalTextureFromData(sel, data),
      ),
  };
}

function makeupTexturePiece(sel: Pick<MakeupSelection, 'blush' | 'eyeshadow'>): LookPiece {
  const key = makeupKeyOf(sel);
  return {
    key: `makeup:${key}`,
    start: (queue, priority) =>
      runTextureBands(
        queue,
        priority,
        MAKEUP_BAND_LABEL,
        key,
        MAKEUP_TEX_SIZE,
        (out, rowStart, rowEnd) => makeupTextureRows(sel, out, rowStart, rowEnd, MAKEUP_TEX_SIZE),
        (data) => makeupTextureFromData(sel, data),
      ),
  };
}

function geometryPiece(key: string, ensure: () => void): LookPiece {
  return {
    key,
    start: (queue, priority) => queue.run(ensure, priority, `${DECAL_GEOMETRY_LABEL}:${key}`),
  };
}

/** Every piece the look needs that is not resident yet. `head` is the mesh
 *  the decals ride (assets.modularHeadFor, or the clone's own head inside a
 *  compose); null when the part library has not landed, in which case there is
 *  no head to cut and the cuts are not this seam's to wait on (the fail-soft
 *  build reports the miss). */
function missingPieces(
  def: VisualDef,
  look: ModularLook,
  head: THREE.SkinnedMesh | null,
): LookPiece[] {
  if (!def.modular) return [];
  const stubble = stubbleDecals(look.app, look.worn);
  const wantsStubble = stubble.scalp !== null || stubble.beard !== null;
  const makeup = makeupSelection(look.app, look.worn);
  const wantsMakeup = wearsFaceDecal(makeup);
  if (!wantsStubble && !wantsMakeup) return [];
  const missing: LookPiece[] = [];
  if (wantsStubble && !hasDecalTexture(stubble)) missing.push(stubbleTexturePiece(stubble));
  if (wantsMakeup && !hasMakeupTexture(makeup)) missing.push(makeupTexturePiece(makeup));
  if (!head) return missing;
  const headGeometry = head.geometry;
  if (wantsStubble && !hasDecalGeometry(headGeometry, stubble)) {
    missing.push(
      geometryPiece(`stubble-geometry:${headGeometry.uuid}|${decalKey(stubble)}`, () =>
        ensureDecalGeometry(head, stubble),
      ),
    );
  }
  if (wantsMakeup && !hasMakeupGeometry(headGeometry)) {
    missing.push(
      geometryPiece(`makeup-geometry:${headGeometry.uuid}`, () => ensureMakeupGeometry(head)),
    );
  }
  return missing;
}

/** Start a piece unless it is already in flight; either way the promise that
 *  settles once it is resident or dropped. Never rejects: a failed piece is
 *  dropped so a later enqueue retries it, reported once per key (a queue shut
 *  down by a graphics rebuild rejects every unit at once), and whoever waited
 *  on it paints what is missing synchronously on attach (fail-soft). */
function startPiece(piece: LookPiece, queue: LookPieceQueue, priority: number): Promise<void> {
  const running = inFlight.get(piece.key);
  if (running) return running;
  const settled = piece.start(queue, priority).then(
    () => {
      inFlight.delete(piece.key);
      completedPieces++;
    },
    (err: unknown) => {
      inFlight.delete(piece.key);
      if (warned.has(piece.key)) return;
      warned.add(piece.key);
      console.warn(`[look-pieces] ${piece.key} failed, will retry on demand:`, err);
    },
  );
  inFlight.set(piece.key, settled);
  return settled;
}

/** True when every piece the look needs is resident, so a view build off it
 *  is the ~1 ms cache-hit build. */
export function composedLookReady(
  def: VisualDef,
  look: ModularLook,
  head: THREE.SkinnedMesh | null,
): boolean {
  return missingPieces(def, look, head).length === 0;
}

/** Enqueue every missing piece of the look not already in flight. */
export function enqueueComposedLookPieces(
  def: VisualDef,
  look: ModularLook,
  head: THREE.SkinnedMesh | null,
  queue: LookPieceQueue,
  priority: number,
): void {
  for (const piece of missingPieces(def, look, head)) startPiece(piece, queue, priority);
}

export interface LookPieces {
  /** Every piece resident: build the view whole, now. */
  ready: boolean;
  /** Settles once every piece of THIS look is resident (pieces another look
   *  started included); already settled when `ready`. Never rejects. */
  whenReady: Promise<void>;
  /** Once resident, run `attach` as ONE unit of the same queue at the same
   *  priority (label `decal-attach:<label>`), so a crowd sharing one look
   *  attaches one body per admitted slot instead of every body inside the
   *  microtask that settled the last band. A unit the queue refuses (shut
   *  down by a graphics rebuild) is dropped: the views are rebuilt with it. */
  attachWhenReady(label: string, attach: () => void): void;
}

function lookPieces(
  whenReady: Promise<void>,
  queue: LookPieceQueue,
  priority: number,
  ready: boolean,
): LookPieces {
  return {
    ready,
    whenReady,
    attachWhenReady: (label, attach) => {
      void whenReady
        .then(() => queue.run(attach, priority, `${DECAL_ATTACH_LABEL}:${label}`))
        .catch(() => undefined);
    },
  };
}

/** The renderer's one call on the live candidate path: the look's readiness,
 *  with its missing pieces enqueued (deduped) and the deferral counted when it
 *  is not ready. The caller builds the body without its decals and attaches
 *  them on `whenReady`. */
export function composedLookPiecesFor(
  def: VisualDef,
  look: ModularLook,
  head: THREE.SkinnedMesh | null,
  queue: LookPieceQueue,
  priority: number,
): LookPieces {
  const missing = missingPieces(def, look, head);
  if (missing.length === 0) return lookPieces(Promise.resolve(), queue, priority, true);
  const waits = missing.map((piece) => startPiece(piece, queue, priority));
  noteLookDeferred();
  return lookPieces(
    Promise.all(waits).then(() => undefined),
    queue,
    priority,
    false,
  );
}

/** Count a view the renderer built with its decals deferred (counted at the
 *  decision, so a build that then fails still counts; `attached` counts the
 *  bodies whose decals landed, and a peer that left range first is the
 *  normal gap between the two). */
export function noteLookDeferred(): void {
  deferred++;
}

/** Count a late decal attach (CharacterVisual.attachDeferredDecals). */
export function noteLookAttached(): void {
  attached++;
}

export interface LookPiecesStats {
  /** Pieces enqueued and not yet resident. */
  pending: number;
  completedPieces: number;
  /** Texture band units that ran. */
  bandsRun: number;
  /** Views built without their face decals, the pieces not yet resident. */
  deferred: number;
  /** Late decal attaches done once the pieces landed. */
  attached: number;
}

export function lookPiecesStats(): LookPiecesStats {
  return { pending: inFlight.size, completedPieces, bandsRun, deferred, attached };
}

export function resetLookPiecesForTest(): void {
  inFlight.clear();
  warned.clear();
  completedPieces = 0;
  bandsRun = 0;
  deferred = 0;
  attached = 0;
}
