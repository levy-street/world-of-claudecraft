// The pure half of the merged WOC head (src/render/characters/woc_head_merge_core.ts):
// the slot table the merged shader's uniform rows are indexed by (one slot per distinct
// material and texture layer, in first-seen order), the role codes and layers the GLSL
// branches on, the identity a merged geometry is cached under (the pieces, in order,
// where each sits and the face they are posed with), the texture layer a piece samples,
// read off its node name, and the fold rule: which drawn pieces ONE merged material can
// draw, the layer and the slot each takes.
import { describe, expect, it } from 'vitest';
import {
  WOC_HEAD_SLOTS,
  WOC_HEAD_TYPES,
  type WocHeadType,
  wocHeadAllNodes,
  wocHeadVariantNodes,
} from '../src/render/characters/woc_head_catalog';
import { WOC_HEAD_TINTED_ROLES } from '../src/render/characters/woc_head_look_core';
import {
  WOC_HEAD_MERGE_LAYER,
  WOC_HEAD_MERGE_MAX_SLOTS,
  WOC_HEAD_MERGE_ROLE_CODE,
  WOC_HEAD_MERGE_ROLES,
  WOC_HEAD_MERGE_SLOT_ATTRIBUTE,
  type WocHeadMergeFoldFacts,
  type WocHeadMergeKeyPiece,
  type WocHeadMergePieceFacts,
  type WocHeadMergeSlot,
  wocHeadMergeFoldPlan,
  wocHeadMergeKey,
  wocHeadMergeLayerOf,
  wocHeadMergeOneSided,
  wocHeadMergeSlots,
  wocHeadMergeTransformHash,
} from '../src/render/characters/woc_head_merge_core';

const { atlas: ATLAS, hair: HAIR, beard: BEARD, scalp: SCALP } = WOC_HEAD_MERGE_LAYER;

const SKIN_REF = [0.2346, 0.1195, 0.0865] as const;
const EYE_REF = [0.227, 0.1845, 0.1651] as const;
const BROW_REF = [0.023, 0.023, 0.023] as const;
const HAIR_REF = [0.0184, 0.0184, 0.0184] as const;

/** One drawn piece's facts (an untinted core piece unless told otherwise). */
function facts(
  material: string,
  over: Partial<Omit<WocHeadMergePieceFacts, 'material'>> = {},
): WocHeadMergePieceFacts {
  return { material, role: null, ref: null, layer: ATLAS, oneSided: false, ...over };
}

/** `n` pieces, each on a material of its own. */
const distinct = (n: number): WocHeadMergePieceFacts[] =>
  Array.from({ length: n }, (_x, i) => facts(`m${i}`));

describe('the constants the merged shader indexes', () => {
  it('holds the roles in code order: skin, eye, hair, brow', () => {
    // literal on purpose: the fragment reads uWocHmTint[code - 1] and branches on the
    // code's value, so a reorder here recolours every merged head
    expect(WOC_HEAD_MERGE_ROLES).toEqual(['skin', 'eye', 'hair', 'brow']);
    expect(WOC_HEAD_MERGE_ROLE_CODE).toEqual({ skin: 1, eye: 2, hair: 3, brow: 4 });
    for (const role of WOC_HEAD_MERGE_ROLES) {
      expect(WOC_HEAD_MERGE_ROLES[WOC_HEAD_MERGE_ROLE_CODE[role] - 1], role).toBe(role);
    }
    // every role a head recolours has a code, and 0 stays free for "untinted"
    expect(Object.keys(WOC_HEAD_MERGE_ROLE_CODE).sort()).toEqual([...WOC_HEAD_TINTED_ROLES].sort());
    expect(Object.values(WOC_HEAD_MERGE_ROLE_CODE)).not.toContain(0);
  });

  it('names the per-vertex slot attribute the merged shader declares', () => {
    // literal: the near merge and the far bake write it, the GLSL reads it by this name
    expect(WOC_HEAD_MERGE_SLOT_ATTRIBUTE).toBe('aWocHmSlot');
  });

  it('numbers the texture layers atlas 0, hair 1, beard 2, scalp 3', () => {
    // literal on purpose: the fragment picks its sampler by `layer < 0.5`, `< 1.5` and
    // `< 2.5`, so a renumbering here samples every slot from the wrong texture
    expect(WOC_HEAD_MERGE_LAYER).toEqual({ atlas: 0, hair: 1, beard: 2, scalp: 3 });
  });
});

describe('wocHeadMergeSlots', () => {
  it('gives each distinct material one slot in first-seen order, and maps every piece', () => {
    const pieces = [
      facts('skin_head', { role: 'skin', ref: SKIN_REF }),
      facts('brow_L', { role: 'brow', ref: BROW_REF }),
      facts('brow_R', { role: 'brow', ref: BROW_REF }),
      // an eyelid shell and its eyeball: two meshes of one piece node, two materials
      facts('skin_eyelid_L', { role: 'skin', ref: SKIN_REF }),
      facts('eye_L', { role: 'eye', ref: EYE_REF }),
      // a second mesh on a material already seen shares its slot
      facts('brow_L', { role: 'brow', ref: BROW_REF }),
      facts('metal_gold'),
      facts('hair_swept', { role: 'hair', ref: HAIR_REF, layer: HAIR }),
      facts('skin_head', { role: 'skin', ref: SKIN_REF }),
      facts('hair_beard_boxed', { role: 'hair', ref: HAIR_REF, layer: BEARD }),
      facts('metal_gold'),
    ];
    const table = wocHeadMergeSlots(pieces);
    expect(table?.slots.map((s) => s.material)).toEqual([
      'skin_head',
      'brow_L',
      'brow_R',
      'skin_eyelid_L',
      'eye_L',
      'metal_gold',
      'hair_swept',
      'hair_beard_boxed',
    ]);
    expect(table?.slotOf).toEqual([0, 1, 2, 3, 4, 1, 5, 6, 0, 7, 5]);
    // every input piece is mapped, onto the slot that carries ITS material and layer
    expect(table?.slotOf).toHaveLength(pieces.length);
    pieces.forEach((piece, i) => {
      const slot = table?.slots[table.slotOf[i]];
      expect(slot?.material, `piece ${i}`).toBe(piece.material);
      expect(slot?.layer, `piece ${i}`).toBe(piece.layer);
    });
  });

  it("carries each slot's role code, reference and layer", () => {
    const table = wocHeadMergeSlots([
      facts('skin_head', { role: 'skin', ref: SKIN_REF }),
      facts('eye_L', { role: 'eye', ref: EYE_REF }),
      facts('hair_swept', { role: 'hair', ref: HAIR_REF, layer: HAIR }),
      facts('brow_L', { role: 'brow', ref: BROW_REF }),
      facts('hair_beard_boxed', { role: 'hair', ref: HAIR_REF, layer: BEARD }),
    ]);
    expect(table?.slots.map(({ oneSided, ...rest }) => rest)).toEqual([
      { material: 'skin_head', roleCode: 1, ref: [0.2346, 0.1195, 0.0865], layer: 0 },
      { material: 'eye_L', roleCode: 2, ref: [0.227, 0.1845, 0.1651], layer: 0 },
      { material: 'hair_swept', roleCode: 3, ref: [0.0184, 0.0184, 0.0184], layer: 1 },
      { material: 'brow_L', roleCode: 4, ref: [0.023, 0.023, 0.023], layer: 0 },
      { material: 'hair_beard_boxed', roleCode: 3, ref: [0.0184, 0.0184, 0.0184], layer: 2 },
    ]);
    // the code is the table's, for every role
    for (const role of WOC_HEAD_MERGE_ROLES) {
      const one = wocHeadMergeSlots([facts(`m_${role}`, { role, ref: SKIN_REF })]);
      expect(one?.slots[0].roleCode, role).toBe(WOC_HEAD_MERGE_ROLE_CODE[role]);
    }
  });

  it('keeps one material apart on each texture layer it draws on', () => {
    const table = wocHeadMergeSlots([
      facts('shared', { layer: ATLAS }),
      facts('shared', { layer: HAIR }),
      facts('shared', { layer: ATLAS }),
      facts('shared', { layer: BEARD }),
      facts('shared', { layer: SCALP }),
      facts('shared', { layer: HAIR }),
    ]);
    expect(table?.slots.map((s) => s.layer)).toEqual([0, 1, 2, 3]);
    expect(table?.slotOf).toEqual([0, 1, 0, 2, 3, 1]);
  });

  it("gives a hairstyle's scalp cap a slot of its own on the scalp layer", () => {
    const table = wocHeadMergeSlots([
      facts('hair_quiff', { role: 'hair', ref: HAIR_REF, layer: HAIR }),
      facts('hair_quiff_scalp', { role: 'hair', ref: BROW_REF, layer: SCALP }),
    ]);
    expect(table?.slots).toEqual([
      {
        material: 'hair_quiff',
        roleCode: 3,
        ref: [0.0184, 0.0184, 0.0184],
        layer: 1,
        oneSided: false,
      },
      {
        material: 'hair_quiff_scalp',
        roleCode: 3,
        ref: [0.023, 0.023, 0.023],
        layer: 3,
        oneSided: false,
      },
    ]);
  });

  it("carries each piece's sidedness into its slot", () => {
    // a Type A head: one sided, under two sided brows; the shader drops the backs of
    // the one sided slots, so the flag has to reach the row
    const table = wocHeadMergeSlots([
      facts('skin_head', { role: 'skin', ref: SKIN_REF, oneSided: true }),
      facts('brow_L', { role: 'brow', ref: BROW_REF, oneSided: false }),
      facts('skin_eyelid_L', { oneSided: true }),
      facts('hair_swept', { role: 'hair', ref: HAIR_REF, layer: HAIR, oneSided: false }),
      // a second mesh on a material already seen: the slot keeps what it was given
      facts('skin_head', { role: 'skin', ref: SKIN_REF, oneSided: true }),
    ]);
    expect(table?.slots.map((s) => [s.material, s.oneSided])).toEqual([
      ['skin_head', true],
      ['brow_L', false],
      ['skin_eyelid_L', true],
      ['hair_swept', false],
    ]);
    expect(table?.slots[0]).toEqual({
      material: 'skin_head',
      roleCode: 1,
      ref: [0.2346, 0.1195, 0.0865],
      layer: 0,
      oneSided: true,
    });
  });

  it('draws a role with no measured reference untinted, as its own material would', () => {
    const table = wocHeadMergeSlots([
      // a tinted role, never measured: no tint (woc_skin_tint_core.ts wocMeshTint)
      facts('hair_new', { role: 'hair', ref: null, layer: HAIR }),
      // an untinted piece (eyeliner, a piercing)
      facts('liner_L'),
      // a reference with no role is no tint either, and its numbers never reach the row
      facts('odd', { role: null, ref: [0.4, 0.5, 0.6] }),
      facts('skin_head', { role: 'skin', ref: SKIN_REF }),
    ]);
    expect(table?.slots.map(({ oneSided, ...rest }) => rest)).toEqual([
      { material: 'hair_new', roleCode: 0, ref: [0, 0, 0], layer: 1 },
      { material: 'liner_L', roleCode: 0, ref: [0, 0, 0], layer: 0 },
      { material: 'odd', roleCode: 0, ref: [0, 0, 0], layer: 0 },
      { material: 'skin_head', roleCode: 1, ref: [0.2346, 0.1195, 0.0865], layer: 0 },
    ]);
  });

  it("returns null past the shader's table, and a full table at exactly its size", () => {
    const full = wocHeadMergeSlots(distinct(WOC_HEAD_MERGE_MAX_SLOTS));
    expect(full?.slots).toHaveLength(WOC_HEAD_MERGE_MAX_SLOTS);
    expect(full?.slotOf).toEqual(Array.from({ length: WOC_HEAD_MERGE_MAX_SLOTS }, (_x, i) => i));
    expect(wocHeadMergeSlots(distinct(WOC_HEAD_MERGE_MAX_SLOTS + 1))).toBeNull();
    // the limit counts SLOTS, never pieces: three meshes per material still fit
    const crowded = [
      ...distinct(WOC_HEAD_MERGE_MAX_SLOTS),
      ...distinct(WOC_HEAD_MERGE_MAX_SLOTS),
      ...distinct(WOC_HEAD_MERGE_MAX_SLOTS),
    ];
    const table = wocHeadMergeSlots(crowded);
    expect(table?.slots).toHaveLength(WOC_HEAD_MERGE_MAX_SLOTS);
    expect(table?.slotOf).toHaveLength(3 * WOC_HEAD_MERGE_MAX_SLOTS);
    // ...and one layer too many on a material already seen is a slot too many
    expect(wocHeadMergeSlots([...crowded, facts('m0', { layer: HAIR })])).toBeNull();
  });

  it('answers an empty head with an empty table', () => {
    expect(wocHeadMergeSlots([])).toEqual({ slots: [], slotOf: [] });
  });
});

describe('wocHeadMergeKey', () => {
  const base: WocHeadMergeKeyPiece = {
    geometry: 'geo_base',
    material: 'skin_head',
    layer: ATLAS,
    influences: [0.3, 0, 1],
    transform: 2358302629,
  };
  const hair: WocHeadMergeKeyPiece = {
    geometry: 'geo_hair',
    material: 'hair_swept',
    layer: HAIR,
    influences: [],
    transform: 458782360,
  };
  const key = wocHeadMergeKey([base, hair]);

  it('is the same for the same head, whoever asks', () => {
    expect(wocHeadMergeKey([{ ...base, influences: [0.3, 0, 1] }, { ...hair }])).toBe(key);
  });

  it('changes with a geometry, a material, a layer, a placement and the piece order', () => {
    const variants: Record<string, WocHeadMergeKeyPiece[]> = {
      geometry: [base, { ...hair, geometry: 'geo_mohawk' }],
      // the same piece hung another way (a per-character transform) is another buffer
      placement: [base, { ...hair, transform: 458782361 }],
      'the base placed as the hair was': [{ ...base, transform: hair.transform }, hair],
      material: [base, { ...hair, material: 'hair_mohawk' }],
      layer: [base, { ...hair, layer: BEARD }],
      'the scalp layer': [base, { ...hair, layer: SCALP }],
      order: [hair, base],
      'a piece more': [base, hair, { ...hair, geometry: 'geo_beard', layer: BEARD }],
      'a piece fewer': [base],
    };
    const keys = Object.entries(variants).map(([what, pieces]) => {
      expect(wocHeadMergeKey(pieces), what).not.toBe(key);
      return wocHeadMergeKey(pieces);
    });
    // ...and each of them is a head of its own
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('changes with a face slider step, and not with a change inside one step', () => {
    const posed = (w: number): string =>
      wocHeadMergeKey([{ ...base, influences: [w, 0, 1] }, hair]);
    // a slider moved by a thousandth is another face
    expect(posed(0.301)).not.toBe(key);
    expect(posed(0.299)).not.toBe(key);
    // influences are compared at 1e-4: a change that rounds to the same step bakes the
    // same vertices and shares the buffer
    expect(posed(0.30004)).toBe(key);
    expect(posed(0.29996)).toBe(key);
    // ...and the next step over does not
    expect(posed(0.30006)).not.toBe(key);
    expect(posed(0.2999)).not.toBe(key);
    // a zero written with its sign is the same rest pose
    expect(wocHeadMergeKey([{ ...base, influences: [0.3, -0, 1] }, hair])).toBe(key);
  });

  it('tells which piece and which target a pose belongs to', () => {
    // the same numbers on another target, or on another piece, are another face
    expect(wocHeadMergeKey([{ ...base, influences: [0, 0.3, 1] }, hair])).not.toBe(key);
    expect(wocHeadMergeKey([{ ...base, influences: [0.3, 0, 1, 0] }, hair])).not.toBe(key);
    const onBase = wocHeadMergeKey([
      { ...base, influences: [1] },
      { ...hair, influences: [] },
    ]);
    const onHair = wocHeadMergeKey([
      { ...base, influences: [] },
      { ...hair, influences: [1] },
    ]);
    expect(onBase).not.toBe(onHair);
    // two poses whose steps read the same run together (1 then 12, 11 then 2) differ
    const posed = (influences: number[]): string => wocHeadMergeKey([{ ...base, influences }]);
    expect(posed([0.0001, 0.0012])).not.toBe(posed([0.0011, 0.0002]));
    expect(posed([0.5, 0])).not.toBe(posed([0, 0.5]));
  });
});

describe('wocHeadMergeLayerOf', () => {
  it('reads the hair and beard layers off the slot in a piece name', () => {
    // a hair node is `hair` whichever of its textures a mesh of it samples: the fold
    // moves a scalp cap to the scalp layer, never this
    expect(wocHeadMergeLayerOf('WocHead_A_hair_swept')).toBe(1);
    expect(wocHeadMergeLayerOf('WocHead_A_hair_quiff')).toBe(1);
    expect(wocHeadMergeLayerOf('WocHead_B_beard_full')).toBe(2);
    expect(wocHeadMergeLayerOf('WocHead_A_base')).toBe(0);
    expect(wocHeadMergeLayerOf('WocHead_A_brows_L')).toBe(0);
    expect(wocHeadMergeLayerOf('WocHead_B_eyes_default_R')).toBe(0);
    expect(wocHeadMergeLayerOf('WocHead_A_piercing_lobe_l')).toBe(0);
  });

  it('files anything that is not a hair or beard piece under the atlas', () => {
    // not a head piece at all
    expect(wocHeadMergeLayerOf('Character_Body')).toBe(0);
    expect(wocHeadMergeLayerOf('')).toBe(0);
    // the slot is a whole word of a WocHead_ name, never a substring
    expect(wocHeadMergeLayerOf('hair_swept')).toBe(0);
    expect(wocHeadMergeLayerOf('Prop_WocHead_A_hair_swept')).toBe(0);
    expect(wocHeadMergeLayerOf('WocHead_A_hairband_gold')).toBe(0);
    expect(wocHeadMergeLayerOf('WocHead_A_nose_beard')).toBe(0);
    expect(wocHeadMergeLayerOf('WocHead_A_merged')).toBe(0);
  });

  it.each<WocHeadType>(['a', 'b'])('agrees with the catalog for every Type %s node', (type) => {
    const want = new Map<string, number>();
    for (const node of wocHeadAllNodes(type)) want.set(node, ATLAS);
    for (const slot of WOC_HEAD_SLOTS) {
      if (slot !== 'hair' && slot !== 'beard') continue;
      for (const { id } of WOC_HEAD_TYPES[type].slots[slot]) {
        for (const node of wocHeadVariantNodes(type, slot, id)) {
          want.set(node, slot === 'hair' ? HAIR : BEARD);
        }
      }
    }
    // the library has pieces on every layer a NAME can say, so no arm of this is vacuous
    // (no name answers the scalp layer: that is the fold's call)
    expect(new Set(want.values())).toEqual(new Set([ATLAS, HAIR, BEARD]));
    for (const [node, layer] of want) expect(wocHeadMergeLayerOf(node), node).toBe(layer);
  });
});

describe('wocHeadMergeTransformHash', () => {
  /** FNV-1a over the bytes of the elements at single precision: the same hash, written
   *  the long way round. */
  function reference(elements: readonly number[]): number {
    let h = 0x811c9dc5;
    for (const byte of new Uint8Array(new Float32Array(elements).buffer)) {
      h = Math.imul(h ^ byte, 0x01000193);
    }
    return h >>> 0;
  }
  const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  it('is a 32 bit hash of the elements at single precision', () => {
    const h = wocHeadMergeTransformHash(IDENTITY);
    expect(Number.isInteger(h) && h >= 0 && h <= 0xffffffff).toBe(true);
    // literal: an unplaced piece (the identity) under FNV-1a
    expect(h).toBe(0x8c90d7a5);
    expect(h).toBe(reference(IDENTITY));
    // a matrix's own element array answers as a plain list does
    expect(wocHeadMergeTransformHash(new Float32Array(IDENTITY))).toBe(h);
    expect(wocHeadMergeTransformHash(new Float64Array(IDENTITY))).toBe(h);
    // deterministic, and nothing is carried over from the call before
    wocHeadMergeTransformHash([9, 8, 7]);
    expect(wocHeadMergeTransformHash(IDENTITY)).toBe(h);
    const placed = [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0.125, -1.75, 3, 1];
    expect(wocHeadMergeTransformHash(placed)).toBe(reference(placed));
    expect(wocHeadMergeTransformHash([])).toBe(0x811c9dc5);
  });

  it('tells two placements apart, whichever element moved', () => {
    const seen = new Set([wocHeadMergeTransformHash(IDENTITY)]);
    for (let i = 0; i < 16; i++) {
      const moved = [...IDENTITY];
      moved[i] += 0.25;
      seen.add(wocHeadMergeTransformHash(moved));
    }
    // the identity and sixteen nudges of it: seventeen hashes
    expect(seen.size).toBe(17);
    // the same numbers in another order are another placement
    expect(wocHeadMergeTransformHash([1, 2, 3])).not.toBe(wocHeadMergeTransformHash([3, 2, 1]));
    // a mirror is not the identity
    const mirror = [...IDENTITY];
    mirror[0] = -1;
    expect(wocHeadMergeTransformHash(mirror)).not.toBe(wocHeadMergeTransformHash(IDENTITY));
  });

  it('a piece moved by a thousandth is another hash, and another cache key', () => {
    const moved = [...IDENTITY];
    moved[13] += 1e-3;
    const here = wocHeadMergeTransformHash(IDENTITY);
    const there = wocHeadMergeTransformHash(moved);
    // equal matrices built apart hash equal
    expect(wocHeadMergeTransformHash([...IDENTITY])).toBe(here);
    expect(there).not.toBe(here);
    const placed = (transform: number): WocHeadMergeKeyPiece => ({
      geometry: 'geo_base',
      material: 'skin_head',
      layer: ATLAS,
      influences: [],
      transform,
    });
    expect(wocHeadMergeKey([placed(there)])).not.toBe(wocHeadMergeKey([placed(here)]));
    expect(wocHeadMergeKey([placed(wocHeadMergeTransformHash([...IDENTITY]))])).toBe(
      wocHeadMergeKey([placed(here)]),
    );
  });

  it('reads at single precision: what a float cannot tell apart shares a hash', () => {
    const nudge = (by: number): number => {
      const m = [...IDENTITY];
      m[12] = 1 + by;
      return wocHeadMergeTransformHash(m);
    };
    // a billionth is below what the baked Float32 vertices could show
    expect(nudge(1e-9)).toBe(nudge(0));
    // a millionth is not
    expect(nudge(1e-6)).not.toBe(nudge(0));
  });
});

describe('wocHeadMergeOneSided', () => {
  const slot = (oneSided: boolean): WocHeadMergeSlot => ({
    material: 'm',
    roleCode: 0,
    ref: [0, 0, 0],
    layer: 0,
    oneSided,
  });

  it('a head needs the back-face drop when ANY of its slots is one sided', () => {
    expect(wocHeadMergeOneSided([slot(false), slot(false), slot(true)])).toBe(true);
    expect(wocHeadMergeOneSided([slot(true)])).toBe(true);
    // an all two sided head (Type B) keeps the program without it
    expect(wocHeadMergeOneSided([slot(false), slot(false)])).toBe(false);
    expect(wocHeadMergeOneSided([])).toBe(false);
  });
});

describe('wocHeadMergeFoldPlan', () => {
  /** One drawn piece mesh's facts: a textured core piece on the base head's atlas that
   *  the merged material can draw and the caller can place, unless told otherwise. */
  function fact(piece: string, over: Partial<WocHeadMergeFoldFacts> = {}): WocHeadMergeFoldFacts {
    return {
      piece,
      material: `mat:${piece}`,
      map: 'atlas',
      mergeable: true,
      placeable: true,
      hasUv: true,
      oneSided: false,
      role: null,
      ref: null,
      ...over,
    };
  }
  const HEAD = fact('WocHead_A_base', {
    material: 'skin_head',
    role: 'skin',
    ref: SKIN_REF,
    oneSided: true,
  });
  const BROW = fact('WocHead_A_brows_relaxed_L', {
    material: 'brow_L',
    role: 'brow',
    ref: BROW_REF,
  });
  const CUT = fact('WocHead_A_hair_quiff', {
    material: 'hair_quiff',
    map: 'quiff',
    role: 'hair',
    ref: HAIR_REF,
  });
  const CAP = fact('WocHead_A_hair_quiff', {
    material: 'hair_quiff_scalp',
    map: 'quiff_scalp',
    role: 'hair',
    ref: BROW_REF,
  });
  const BEARD_PIECE = fact('WocHead_A_beard_boxed', {
    material: 'hair_beard_boxed',
    map: 'beards',
    role: 'hair',
    ref: HAIR_REF,
    oneSided: true,
  });
  /** Type B's eyeliner: a flat colour, no texture and no uv. */
  const LINER = fact('WocHead_A_eyes_default_L', { material: 'liner_L', map: null, hasUv: false });

  /** The pieces a plan folds, by their index in the list given. */
  const foldedAt = (pieces: WocHeadMergeFoldFacts[], hasWhiteCell = true): number[] | null =>
    wocHeadMergeFoldPlan(pieces, hasWhiteCell)?.folded.map((f) => f.at) ?? null;

  it('folds every piece one merged material can draw, each on its layer and slot', () => {
    const plan = wocHeadMergeFoldPlan([HEAD, BROW, CUT, CAP, BEARD_PIECE, LINER], true);
    expect(plan).toEqual({
      folded: [
        { at: 0, layer: 0, slot: 0, flat: false },
        { at: 1, layer: 0, slot: 1, flat: false },
        // the cut on the hair layer, its scalp cap (a second texture) on the scalp layer
        { at: 2, layer: 1, slot: 2, flat: false },
        { at: 3, layer: 3, slot: 3, flat: false },
        { at: 4, layer: 2, slot: 4, flat: false },
        // the untextured piece samples the atlas's white cell
        { at: 5, layer: 0, slot: 5, flat: true },
      ],
      slots: [
        {
          material: 'skin_head',
          roleCode: 1,
          ref: [0.2346, 0.1195, 0.0865],
          layer: 0,
          oneSided: true,
        },
        { material: 'brow_L', roleCode: 4, ref: [0.023, 0.023, 0.023], layer: 0, oneSided: false },
        {
          material: 'hair_quiff',
          roleCode: 3,
          ref: [0.0184, 0.0184, 0.0184],
          layer: 1,
          oneSided: false,
        },
        {
          material: 'hair_quiff_scalp',
          roleCode: 3,
          ref: [0.023, 0.023, 0.023],
          layer: 3,
          oneSided: false,
        },
        {
          material: 'hair_beard_boxed',
          roleCode: 3,
          ref: [0.0184, 0.0184, 0.0184],
          layer: 2,
          oneSided: true,
        },
        { material: 'liner_L', roleCode: 0, ref: [0, 0, 0], layer: 0, oneSided: false },
      ],
      base: 0,
      hairMap: 'quiff',
      beardMap: 'beards',
      scalpMap: 'quiff_scalp',
    });
  });

  it('finds the base head wherever it sits, and folds in the order given', () => {
    const plan = wocHeadMergeFoldPlan([BEARD_PIECE, BROW, HEAD, CUT], true);
    expect(plan?.base).toBe(2);
    expect(plan?.folded.map((f) => [f.at, f.slot])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(plan?.slots.map((s) => s.material)).toEqual([
      'hair_beard_boxed',
      'brow_L',
      'skin_head',
      'hair_quiff',
    ]);
    // two meshes on one material and layer share a slot
    const twice = wocHeadMergeFoldPlan(
      [HEAD, BROW, { ...BROW, piece: 'WocHead_A_brows_relaxed_R' }],
      true,
    );
    expect(twice?.folded.map((f) => f.slot)).toEqual([0, 1, 1]);
    expect(twice?.slots).toHaveLength(2);
    // a head with no hair and no beard names no texture for either layer
    expect(twice).toMatchObject({ hairMap: null, beardMap: null, scalpMap: null });
  });

  it('answers null with no base head, or a base the merged material cannot stand in for', () => {
    expect(wocHeadMergeFoldPlan([BROW, CUT, BEARD_PIECE], true)).toBeNull();
    expect(wocHeadMergeFoldPlan([], true)).toBeNull();
    expect(wocHeadMergeFoldPlan([{ ...HEAD, mergeable: false }, BROW, CUT], true)).toBeNull();
    // the base is the merged material's source: left out for ANY reason, nothing folds
    expect(wocHeadMergeFoldPlan([{ ...HEAD, placeable: false }, BROW, CUT], true)).toBeNull();
    expect(wocHeadMergeFoldPlan([{ ...HEAD, hasUv: false }, BROW, CUT], true)).toBeNull();
    // only the base node itself is the base: a piece that merely starts like it is not
    expect(
      wocHeadMergeFoldPlan([{ ...HEAD, piece: 'WocHead_A_base_extra' }, BROW, CUT], true),
    ).toBeNull();
  });

  it('answers null for fewer than two pieces to fold', () => {
    expect(wocHeadMergeFoldPlan([HEAD], true)).toBeNull();
    expect(wocHeadMergeFoldPlan([HEAD, { ...BROW, mergeable: false }], true)).toBeNull();
    expect(foldedAt([HEAD, BROW])).toEqual([0, 1]);
  });

  it('folds a core piece only on the atlas the base head samples', () => {
    const nose = fact('WocHead_A_nose_default', { map: 'nose_source' });
    expect(foldedAt([HEAD, BROW, nose])).toEqual([0, 1]);
    // a base with no texture: a textured piece has no atlas to share
    expect(foldedAt([{ ...HEAD, map: null, hasUv: false }, BROW, LINER], false)).toBeNull();
  });

  it('folds an untextured core piece onto the white cell, when the core carries one', () => {
    expect(wocHeadMergeFoldPlan([HEAD, BROW, LINER], true)?.folded[2]).toEqual({
      at: 2,
      layer: 0,
      slot: 2,
      flat: true,
    });
    // a core built before the atlas has no white cell: the piece keeps drawing by itself
    expect(foldedAt([HEAD, BROW, LINER], false)).toEqual([0, 1]);
    // ...and with no atlas at all there is nothing to hold a cell
    expect(foldedAt([{ ...HEAD, map: null }, { ...BROW, map: null }, LINER], true)).toBeNull();
  });

  it('gives a hairstyle its first texture, its second the scalp layer, and no third', () => {
    const third = fact('WocHead_A_hair_quiff', { material: 'hair_third', map: 'third' });
    const bare = fact('WocHead_A_hair_quiff', { material: 'hair_bare', map: null });
    const strands = fact('WocHead_A_hair_quiff', { material: 'hair_strands', map: 'quiff' });
    const cap2 = fact('WocHead_A_hair_quiff', { material: 'hair_cap2', map: 'quiff_scalp' });
    const plan = wocHeadMergeFoldPlan([HEAD, CUT, CAP, third, bare, strands, cap2], true);
    expect(plan?.folded.map((f) => [f.at, f.layer])).toEqual([
      [0, 0],
      [1, 1],
      [2, 3],
      [5, 1],
      [6, 3],
    ]);
    expect(plan).toMatchObject({ hairMap: 'quiff', scalpMap: 'quiff_scalp', beardMap: null });
    // an untextured hairstyle is never the hairstyle's texture, even the only one
    expect(foldedAt([HEAD, BROW, bare])).toEqual([0, 1]);
    expect(wocHeadMergeFoldPlan([HEAD, bare, CUT], true)).toMatchObject({
      hairMap: 'quiff',
      scalpMap: null,
    });
    // a hairstyle the merged material cannot draw claims no layer: the next one's
    // texture is still THE hairstyle's
    const plain = wocHeadMergeFoldPlan([HEAD, { ...CUT, mergeable: false }, CAP], true);
    expect(plain?.folded.map((f) => [f.at, f.layer])).toEqual([
      [0, 0],
      [2, 1],
    ]);
    expect(plain).toMatchObject({ hairMap: 'quiff_scalp', scalpMap: null });
  });

  it('a hair or beard mesh that cannot fold never claims the layer from the one that can', () => {
    // each kind of mesh that is left out, drawn AHEAD of the real cut
    const ghost = { ...CUT, material: 'hair_ghost', map: 'ghost' };
    for (const [what, lost] of Object.entries({
      'cannot be placed': { ...ghost, placeable: false },
      'has no uv': { ...ghost, hasUv: false },
      'cannot be drawn': { ...ghost, mergeable: false },
    })) {
      const plan = wocHeadMergeFoldPlan([HEAD, lost, CUT, CAP], true);
      // the cut keeps the hair layer and its cap the scalp layer: the ghost took neither
      expect(
        plan?.folded.map((f) => [f.at, f.layer]),
        what,
      ).toEqual([
        [0, 0],
        [2, 1],
        [3, 3],
      ]);
      expect(plan, what).toMatchObject({ hairMap: 'quiff', scalpMap: 'quiff_scalp' });
    }
    // ...and the same for a beard
    const stray = { ...BEARD_PIECE, material: 'hair_beard_ghost', map: 'ghost' };
    for (const lost of [
      { ...stray, placeable: false },
      { ...stray, hasUv: false },
    ]) {
      const plan = wocHeadMergeFoldPlan([HEAD, lost, BEARD_PIECE], true);
      expect(plan?.folded.map((f) => [f.at, f.layer])).toEqual([
        [0, 0],
        [2, 2],
      ]);
      expect(plan?.beardMap).toBe('beards');
    }
    // a cap that cannot fold leaves the scalp layer to the next texture
    const third = fact('WocHead_A_hair_quiff', { material: 'hair_third', map: 'third' });
    const capped = wocHeadMergeFoldPlan([HEAD, CUT, { ...CAP, placeable: false }, third], true);
    expect(capped?.folded.map((f) => [f.at, f.layer])).toEqual([
      [0, 0],
      [1, 1],
      [3, 3],
    ]);
    expect(capped?.scalpMap).toBe('third');
  });

  it('gives a beard one texture: a second, and an untextured one, stay out', () => {
    const other = fact('WocHead_A_beard_handlebar', {
      material: 'hair_beard_handlebar',
      map: 'handlebar',
    });
    const bare = fact('WocHead_A_beard_boxed', { material: 'hair_beard_bare', map: null });
    const same = fact('WocHead_A_beard_goatee', { material: 'hair_beard_goatee', map: 'beards' });
    const plan = wocHeadMergeFoldPlan([HEAD, BEARD_PIECE, other, bare, same], true);
    expect(plan?.folded.map((f) => [f.at, f.layer])).toEqual([
      [0, 0],
      [1, 2],
      [4, 2],
    ]);
    // a beard's second texture is never a scalp cap
    expect(plan).toMatchObject({ beardMap: 'beards', scalpMap: null, hairMap: null });
    expect(foldedAt([HEAD, BROW, bare])).toEqual([0, 1]);
  });

  it('leaves out a textured piece with no uv, and a piece the caller cannot place', () => {
    expect(foldedAt([HEAD, BROW, { ...CUT, hasUv: false }, BEARD_PIECE])).toEqual([0, 1, 3]);
    expect(foldedAt([HEAD, BROW, { ...CUT, placeable: false }, BEARD_PIECE])).toEqual([0, 1, 3]);
    // a flat piece needs no uv, but it still has to be placed
    expect(foldedAt([HEAD, BROW, { ...LINER, placeable: false }])).toEqual([0, 1]);
    // a piece left out takes no slot
    expect(
      wocHeadMergeFoldPlan([HEAD, { ...BROW, placeable: false }, CUT], true)?.slots.map(
        (s) => s.material,
      ),
    ).toEqual(['skin_head', 'hair_quiff']);
  });

  it("answers null past the shader's table, and a plan at exactly its size", () => {
    const many = (n: number): WocHeadMergeFoldFacts[] => [
      HEAD,
      ...Array.from({ length: n - 1 }, (_x, i) => fact(`WocHead_A_nose_n${i}`)),
    ];
    const full = wocHeadMergeFoldPlan(many(WOC_HEAD_MERGE_MAX_SLOTS), true);
    expect(full?.slots).toHaveLength(WOC_HEAD_MERGE_MAX_SLOTS);
    expect(full?.folded).toHaveLength(WOC_HEAD_MERGE_MAX_SLOTS);
    expect(wocHeadMergeFoldPlan(many(WOC_HEAD_MERGE_MAX_SLOTS + 1), true)).toBeNull();
    // a piece that is left out takes no slot, so it cannot push a head past the table
    const spare = wocHeadMergeFoldPlan(
      [...many(WOC_HEAD_MERGE_MAX_SLOTS), fact('WocHead_A_nose_extra', { mergeable: false })],
      true,
    );
    expect(spare?.slots).toHaveLength(WOC_HEAD_MERGE_MAX_SLOTS);
  });

  it('draws a role with no measured reference untinted', () => {
    const plan = wocHeadMergeFoldPlan([HEAD, { ...BROW, ref: null }, { ...CUT, role: null }], true);
    expect(plan?.slots.map((s) => [s.roleCode, s.ref])).toEqual([
      [1, [0.2346, 0.1195, 0.0865]],
      [0, [0, 0, 0]],
      [0, [0, 0, 0]],
    ]);
  });
});
