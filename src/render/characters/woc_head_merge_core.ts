// The pure half of the merged WOC head (woc_head_merge.ts draws it): which SLOT of
// the one merged material each drawn head piece becomes, and the identity a merged
// geometry is cached under. Three-free and DOM-free, so a Vitest reads the same
// table the shader indexes.
//
// Why a merge at all: a WOC face is a dozen rigid pieces on the head bone (the base
// head, two brows, two ears, two eyelid shells, two eyeballs, the mouth, the nose,
// Type B's eyeliner, then the hairstyle and the beard), each its own mesh with its
// own material, so one character cost a dozen draws in the colour pass and a dozen
// more in the shadow pass before its body and armor drew at all. Measured in one
// build on one Apple GPU with vsync off, 40 characters close by drew 2,099 calls
// piece by piece and 874 folded (the crowd page of the character pack's screenshots,
// characters-20260923/crowd/README.md: the fold measured against itself, never a
// comparison with the bodies a release player draws, which that page describes). The
// pieces of a core all sample ONE
// atlas since 2026-10-02
// (scripts/assets/woc_character/head_atlas.mjs), so the only thing still keeping
// them apart is what differs per MATERIAL: the tint role and its measured
// reference, the surface (roughness, metalness, a flat colour) and, for the hair
// and the beard, the texture. The merged material carries all of that in small
// uniform tables indexed by a per-vertex slot, and the merged mesh draws the whole
// head in one call.
//
// A slot is one distinct (material, texture layer) among the drawn pieces. Slots are
// assigned in first-seen order of the pieces as given (the dressing hands them over
// in a stable order), so the same look always numbers its slots the same way.
import type { WocHeadTintedRole, WocLinearRgb } from './woc_head_look_core';

/** The most slots one merged head carries: the size of the shader's uniform tables,
 *  and so a share of the program's uniform budget (four rows a slot). The fullest look
 *  the library can draw (a Type B head with eyeliner, a two texture hairstyle and a
 *  beard) fits with room for a new piece kind; a look that needed more would keep
 *  drawing piece by piece (wocHeadMergeSlots answers null). */
export const WOC_HEAD_MERGE_MAX_SLOTS = 18;

/** The per-vertex attribute that carries a folded vertex's slot (the merged shader
 *  declares it; the near merge and the far bake both write it). */
export const WOC_HEAD_MERGE_SLOT_ATTRIBUTE = 'aWocHmSlot';

/** Which texture a slot samples: the core atlas, the worn hairstyle's, the beard's, or
 *  the scalp cap's (a hairstyle with a shaved or parted scalp ships that as a second
 *  texture: the merge names it, wocHeadMergeLayerOf only knows the piece is hair). */
export const WOC_HEAD_MERGE_LAYER = { atlas: 0, hair: 1, beard: 2, scalp: 3 } as const;
export type WocHeadMergeLayer = (typeof WOC_HEAD_MERGE_LAYER)[keyof typeof WOC_HEAD_MERGE_LAYER];

/** The role code the shader branches on (0: the slot is not tinted). */
export const WOC_HEAD_MERGE_ROLE_CODE: Readonly<Record<WocHeadTintedRole, number>> = {
  skin: 1,
  eye: 2,
  hair: 3,
  brow: 4,
};

/** The roles in the order the shader's colour table holds them (code - 1). */
export const WOC_HEAD_MERGE_ROLES: readonly WocHeadTintedRole[] = ['skin', 'eye', 'hair', 'brow'];

/** What one drawn piece mesh contributes to the slot table. */
export interface WocHeadMergePieceFacts {
  /** Identity of the material the piece draws with (two pieces on one material share
   *  a slot): the file material's uuid. */
  readonly material: string;
  /** Its tint role and measured reference (woc_head_packs.ts stamps both at hang
   *  time); null for an untinted piece (eyeliner, a piercing). */
  readonly role: WocHeadTintedRole | null;
  readonly ref: WocLinearRgb | null;
  readonly layer: WocHeadMergeLayer;
  /** Whether its material draws its front faces only (the merged head is drawn two
   *  sided, and the shader drops the backs of a one sided slot). */
  readonly oneSided: boolean;
}

/** One slot of the merged material. */
export interface WocHeadMergeSlot {
  readonly material: string;
  /** 0 for an untinted slot, else WOC_HEAD_MERGE_ROLE_CODE. */
  readonly roleCode: number;
  readonly ref: WocLinearRgb;
  readonly layer: WocHeadMergeLayer;
  readonly oneSided: boolean;
}

export interface WocHeadMergeSlotTable {
  readonly slots: readonly WocHeadMergeSlot[];
  /** Per input piece, the slot it draws with. */
  readonly slotOf: readonly number[];
}

/**
 * The slot table for a head's drawn pieces, or null when they need more slots than the
 * shader carries (the head then keeps drawing piece by piece: correct, just not cheap).
 * A tinted piece with no measured reference draws untinted, exactly as its own material
 * would (woc_skin_tint_core.ts wocMeshTint).
 */
export function wocHeadMergeSlots(
  pieces: readonly WocHeadMergePieceFacts[],
): WocHeadMergeSlotTable | null {
  const index = new Map<string, number>();
  const slots: WocHeadMergeSlot[] = [];
  const slotOf: number[] = [];
  for (const piece of pieces) {
    const tinted = piece.role !== null && piece.ref !== null;
    const key = `${piece.material}|${piece.layer}`;
    let at = index.get(key);
    if (at === undefined) {
      at = slots.length;
      index.set(key, at);
      slots.push({
        material: piece.material,
        roleCode: tinted && piece.role ? WOC_HEAD_MERGE_ROLE_CODE[piece.role] : 0,
        ref: tinted && piece.ref ? piece.ref : [0, 0, 0],
        layer: piece.layer,
        oneSided: piece.oneSided,
      });
    }
    slotOf.push(at);
  }
  return slots.length <= WOC_HEAD_MERGE_MAX_SLOTS ? { slots, slotOf } : null;
}

/** One drawn piece mesh in a merged head's identity. */
export interface WocHeadMergeKeyPiece {
  /** The shared geometry it draws (a pack's geometry is one object per piece). */
  readonly geometry: string;
  readonly material: string;
  readonly layer: WocHeadMergeLayer;
  /** Its morph influences, as drawn. */
  readonly influences: readonly number[];
  /** Where it sits in the merged mesh's space (wocHeadMergeTransformHash): two heads
   *  share a buffer only when every piece sits the same way. */
  readonly transform: number;
}

/** Morph influences are compared at this resolution: a slider's stored step is far
 *  coarser, and two faces closer than this bake to the same vertices. */
const INFLUENCE_STEP = 1e-4;

/**
 * The identity of a merged head's GEOMETRY: the pieces it folds (their geometry,
 * material, texture layer and placement, in order) and the face they are posed with.
 * Two characters answering the same key draw one shared buffer; colours are uniforms
 * and never enter it.
 */
export function wocHeadMergeKey(pieces: readonly WocHeadMergeKeyPiece[]): string {
  return pieces
    .map((p) => {
      const morphs = p.influences.map((w) => Math.round(w / INFLUENCE_STEP)).join(',');
      return `${p.geometry}:${p.material}:${p.layer}:${p.transform}:${morphs}`;
    })
    .join('|');
}

/** Which texture layer a head piece samples, from its node name
 *  (`WocHead_<T>_<slot>_<variant>`): the hairstyle and the beard have a texture of
 *  their own, every other piece the core atlas. A hairstyle's scalp cap answers `hair`
 *  here: the fold moves it to the scalp layer when it meets its second texture. */
export function wocHeadMergeLayerOf(pieceName: string): WocHeadMergeLayer {
  const slot = /^WocHead_[A-Za-z]_([a-z]+)(?:_|$)/.exec(pieceName)?.[1];
  if (slot === 'hair') return WOC_HEAD_MERGE_LAYER.hair;
  if (slot === 'beard') return WOC_HEAD_MERGE_LAYER.beard;
  return WOC_HEAD_MERGE_LAYER.atlas;
}

const _hashFloat = new Float32Array(1);
const _hashBits = new Uint32Array(_hashFloat.buffer);

/** A 32-bit hash of a placement matrix (its elements at single precision, FNV-1a over
 *  their bits), for the cache key: a piece's file transform is the same for every
 *  character today, and a per-character one would otherwise share a buffer wrongly. */
export function wocHeadMergeTransformHash(elements: ArrayLike<number>): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < elements.length; i++) {
    _hashFloat[0] = elements[i];
    let bits = _hashBits[0];
    for (let b = 0; b < 4; b++) {
      h = Math.imul(h ^ (bits & 0xff), 0x01000193);
      bits >>>= 8;
    }
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// The fold rule
// ---------------------------------------------------------------------------

/** What the fold rule reads of one drawn piece mesh: plain facts the three.js half
 *  takes off the mesh and its file material (woc_head_merge.ts wocHeadMergeFold). */
export interface WocHeadMergeFoldFacts {
  /** The piece node's name (`WocHead_<T>_<slot>_<variant>[_L|_R]`). */
  readonly piece: string;
  /** Identity of the file material, and of its colour map (null: untextured). */
  readonly material: string;
  readonly map: string | null;
  /** Whether the merged material can stand in for this material at all (opaque, plain,
   *  one colour map: the three.js half's test), and whether the caller can place the
   *  mesh in the merged mesh's space. */
  readonly mergeable: boolean;
  readonly placeable: boolean;
  readonly hasUv: boolean;
  readonly oneSided: boolean;
  readonly role: WocHeadTintedRole | null;
  readonly ref: WocLinearRgb | null;
}

/** One piece the fold takes. */
export interface WocHeadMergeFolding {
  /** Its index in the pieces given. */
  readonly at: number;
  readonly layer: WocHeadMergeLayer;
  readonly slot: number;
  /** Untextured: it samples the atlas's white cell. */
  readonly flat: boolean;
}

export interface WocHeadMergeFoldPlan {
  readonly folded: readonly WocHeadMergeFolding[];
  readonly slots: readonly WocHeadMergeSlot[];
  /** The base head's index in the pieces given: its material is the merged one's source. */
  readonly base: number;
  /** The colour map each texture layer samples, by identity (null: the layer is unused). */
  readonly hairMap: string | null;
  readonly beardMap: string | null;
  readonly scalpMap: string | null;
}

const BASE_PIECE = /^WocHead_[A-Za-z]_base$/;

/**
 * The fold rule: which of a head's drawn pieces ONE merged material can draw, the
 * texture layer and the slot each takes. One answer for the near stand-in and the far
 * bake's head group. A piece folds when its material is mergeable, the caller can
 * place it, and its texture is one the merged shader samples: a core piece the atlas
 * the base head samples (an untextured one the atlas's white cell, when the core
 * carries one), a hair piece the first hair texture met or the second (the scalp cap:
 * its own layer; a third has no sampler), a beard piece the first beard texture met.
 * Null when there is nothing to fold: no mergeable base head among the folded pieces,
 * fewer than two of them, or more slots than the shader carries. Every piece left out
 * keeps drawing with its own material.
 */
export function wocHeadMergeFoldPlan(
  pieces: readonly WocHeadMergeFoldFacts[],
  hasWhiteCell: boolean,
): WocHeadMergeFoldPlan | null {
  const base = pieces.findIndex((p) => BASE_PIECE.test(p.piece));
  const head = pieces[base];
  if (!head?.mergeable) return null;
  const atlas = head.map;
  let hairMap: string | null = null;
  let beardMap: string | null = null;
  let scalpMap: string | null = null;
  const taken: { at: number; layer: WocHeadMergeLayer; flat: boolean }[] = [];
  for (const [at, p] of pieces.entries()) {
    // a piece that cannot fold at all never claims a texture layer (a hair mesh left
    // out would otherwise take the hair sampler from the real cut)
    if (!p.mergeable || !p.placeable) continue;
    if (p.map !== null && !p.hasUv) continue;
    let layer = wocHeadMergeLayerOf(p.piece);
    let flat = false;
    if (layer === WOC_HEAD_MERGE_LAYER.atlas) {
      // a core piece rides the atlas the base head samples; an untextured one takes
      // the atlas's white cell (a core built before the atlas has neither)
      if (p.map === null) {
        if (atlas === null || !hasWhiteCell) continue;
        flat = true;
      } else if (p.map !== atlas) continue;
    } else if (p.map === null) continue;
    else if (layer === WOC_HEAD_MERGE_LAYER.hair) {
      // a hairstyle is one texture, or two: the cut, then the scalp cap under it
      hairMap ??= p.map;
      if (p.map !== hairMap) {
        scalpMap ??= p.map;
        if (p.map !== scalpMap) continue;
        layer = WOC_HEAD_MERGE_LAYER.scalp;
      }
    } else {
      beardMap ??= p.map;
      if (p.map !== beardMap) continue;
    }
    taken.push({ at, layer, flat });
  }
  // the base head is the merged material's source: without it there is no merge
  if (taken.length < 2 || !taken.some((t) => t.at === base)) return null;
  const table = wocHeadMergeSlots(
    taken.map(({ at, layer }) => ({
      material: pieces[at].material,
      role: pieces[at].role,
      ref: pieces[at].ref,
      layer,
      oneSided: pieces[at].oneSided,
    })),
  );
  if (!table) return null;
  return {
    folded: taken.map((t, i) => ({ ...t, slot: table.slotOf[i] })),
    slots: table.slots,
    base,
    hairMap,
    beardMap,
    scalpMap,
  };
}

/** Whether a slot table needs the one sided program variant (the merged shader's
 *  back-face drop: woc_head_tint.ts attachWocHeadMergedTint). */
export function wocHeadMergeOneSided(slots: readonly WocHeadMergeSlot[]): boolean {
  return slots.some((slot) => slot.oneSided);
}

// ---------------------------------------------------------------------------
// The fold's bands
// ---------------------------------------------------------------------------

/** Vertices of a head one queue unit folds (woc_head_merge_fold.ts): a STRUCTURAL
 *  fraction of a head (several thousand vertices for a bald one to some fourteen
 *  thousand for the fullest in the shipped library, so a head is a dozen units to thirty:
 *  tests/woc_head_merge_library.test.ts), never a timing, as the decal maps' row bands
 *  are (look_pieces.ts LOOK_BAND_ROWS). It fixes a unit small enough that the frame
 *  budget decides how many fit a frame. What set it: a vertex is posed through as many
 *  as nine morph targets and moved, its normal with it, and a head folded whole measured
 *  several times the budget's smallest slice on a weak machine; a band is a small
 *  fraction of that. */
export const WOC_HEAD_MERGE_BAND_VERTICES = 512;

/** Index entries one unit copies once the vertices are folded (whole triangles: a
 *  multiple of three). An entry is a read, an add and a write, a small fraction of what
 *  a posed vertex costs, so a band of them is this many times a band of vertices. */
export const WOC_HEAD_MERGE_BAND_INDICES = WOC_HEAD_MERGE_BAND_VERTICES * 24;

/**
 * How many units the fold of a head takes (woc_head_merge_fold.ts WocHeadGeometryFold.step,
 * at the bands above): a band of vertices each, the one that ends them going on to the
 * first band of triangles, and the one that ends those closing the geometry. A head that
 * fits one band of each is one unit. `indices` counts index entries, whole triangles only.
 */
export function wocHeadMergeFoldUnits(vertices: number, indices: number): number {
  const bands = (count: number, band: number): number => Math.max(1, Math.ceil(count / band));
  return (
    bands(vertices, WOC_HEAD_MERGE_BAND_VERTICES) + bands(indices, WOC_HEAD_MERGE_BAND_INDICES) - 1
  );
}
