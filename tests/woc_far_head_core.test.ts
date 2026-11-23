// The far LOD's frozen face (src/render/characters/woc_far_head_core.ts): the
// morph influences a WOC far bake applies and the key it shares geometry by.
// The grid is anchored on each control's default, the discrete morphs carry
// exactly, colours never reach the key, the tint partition keeps a tinted
// and an untinted mesh out of one baked group, and the merged head is one group
// of its own whose vertices carry their slot in the order the bake laid them out.
import { describe, expect, it } from 'vitest';
import { coalesceFarBakeGroups } from '../src/render/characters/far_bake_groups_core';
import { DEFAULT_APPEARANCE } from '../src/render/characters/modular';
import {
  WOC_FAR_HEAD_GROUP_KEY,
  WOC_FAR_MORPH_STEP,
  wocFarHeadPose,
  wocFarHeadVertexSlots,
  wocFarMorphInfluence,
  wocFarTintKey,
} from '../src/render/characters/woc_far_head_core';
import {
  WOC_HEAD_BALD_CROWN_MORPH,
  WOC_HEAD_MORPH_RANGE,
  WOC_HEAD_MORPHS,
} from '../src/render/characters/woc_head_catalog';
import { wocHeadLookFromAppearance } from '../src/render/characters/woc_head_look_core';

const CHIN = WOC_HEAD_MORPHS.chinWidth;
const EYES = WOC_HEAD_MORPHS.eyeSize;
const chinRange = WOC_HEAD_MORPH_RANGE.chinWidth;
const eyeRange = WOC_HEAD_MORPH_RANGE.eyeSize;

describe('wocFarMorphInfluence', () => {
  it('keeps every default exactly (the grid is anchored on it)', () => {
    expect(chinRange.def).toBe(0.65);
    expect(wocFarMorphInfluence(0.65, chinRange)).toBe(0.65);
    expect(wocFarMorphInfluence(0, eyeRange)).toBe(0);
  });

  it('snaps to the nearest step of its side of the default', () => {
    expect(WOC_FAR_MORPH_STEP).toBe(0.25);
    // the eyes: 1 either side of 0, four 0.25 steps each
    expect(wocFarMorphInfluence(0.1, eyeRange)).toBe(0);
    expect(wocFarMorphInfluence(0.2, eyeRange)).toBe(0.25);
    expect(wocFarMorphInfluence(-0.6, eyeRange)).toBe(-0.5);
    // the chin: 0.35 above its 0.65 default (two 0.175 steps), 0.65 below (three
    // 0.21667 steps), so both ends land on the grid
    expect(wocFarMorphInfluence(0.7, chinRange)).toBe(0.65);
    expect(wocFarMorphInfluence(0.8, chinRange)).toBe(0.825);
    expect(wocFarMorphInfluence(0.3, chinRange)).toBe(0.216667);
    expect(wocFarMorphInfluence(0.5, chinRange)).toBe(0.433333);
  });

  it('bakes both ends of every range exactly', () => {
    for (const range of Object.values(WOC_HEAD_MORPH_RANGE)) {
      expect(wocFarMorphInfluence(range.min, range)).toBe(range.min);
      expect(wocFarMorphInfluence(range.max, range)).toBe(range.max);
    }
  });

  it('clamps into the control range and reads junk as the default', () => {
    expect(wocFarMorphInfluence(1.7, chinRange)).toBe(1);
    expect(wocFarMorphInfluence(-3, chinRange)).toBe(0);
    expect(wocFarMorphInfluence(4, eyeRange)).toBe(1);
    expect(wocFarMorphInfluence(-4, eyeRange)).toBe(-1);
    expect(wocFarMorphInfluence(Number.NaN, chinRange)).toBe(0.65);
    expect(wocFarMorphInfluence('0.2', eyeRange)).toBe(0);
    expect(wocFarMorphInfluence(undefined, eyeRange)).toBe(0);
  });

  it('never moves a value more than half the widest step', () => {
    for (const range of Object.values(WOC_HEAD_MORPH_RANGE)) {
      for (let v = range.min; v <= range.max; v += 0.01) {
        const q = wocFarMorphInfluence(v, range);
        expect(Math.abs(q - v)).toBeLessThanOrEqual(WOC_FAR_MORPH_STEP / 2 + 1e-6);
      }
    }
  });
});

describe('wocFarHeadPose', () => {
  it('is null for no head (the pack keeps its own influences)', () => {
    expect(wocFarHeadPose(null)).toBeNull();
    expect(wocFarHeadPose(undefined)).toBeNull();
  });

  it('carries every morph a look drives, the discrete ones exactly', () => {
    const state = wocHeadLookFromAppearance({ ...DEFAULT_APPEARANCE, headHair: 'swept' }, 'a');
    const pose = wocFarHeadPose(state.morphs);
    expect(pose).not.toBeNull();
    expect(Object.keys(pose?.morphs ?? {}).sort()).toEqual(Object.keys(state.morphs).sort());
    expect(pose?.morphs.FS_Tuck_swept).toBe(1);
    expect(pose?.morphs.FS_Tuck_long).toBe(0);
    expect(pose?.morphs[WOC_HEAD_BALD_CROWN_MORPH]).toBe(0);
    expect(pose?.morphs[CHIN]).toBe(0.65);
    const bald = wocFarHeadPose(
      wocHeadLookFromAppearance({ ...DEFAULT_APPEARANCE, headHair: 'bald' }, 'a').morphs,
    );
    expect(bald?.morphs[WOC_HEAD_BALD_CROWN_MORPH]).toBe(1);
    expect(bald?.morphs.FS_Tuck_swept).toBe(0);
    expect(bald?.key).not.toBe(pose?.key);
  });

  it('shares one key across a grid cell and splits across cells', () => {
    const at = (chin: number, eye: number) =>
      wocFarHeadPose({ [CHIN]: chin, [EYES]: eye, FS_Tuck_swept: 1 })?.key;
    expect(at(0.66, 0.05)).toBe(at(0.7, -0.1));
    expect(at(0.66, 0.05)).not.toBe(at(0.8, 0.05));
    expect(at(0.66, 0.05)).not.toBe(at(0.66, 0.2));
    // the tuck is a dimension of its own
    expect(wocFarHeadPose({ [CHIN]: 0.65, FS_Tuck_swept: 0 })?.key).not.toBe(
      wocFarHeadPose({ [CHIN]: 0.65, FS_Tuck_swept: 1 })?.key,
    );
  });

  it('keys by value, never by insertion order', () => {
    expect(wocFarHeadPose({ [CHIN]: 1, [EYES]: 0.5 })?.key).toBe(
      wocFarHeadPose({ [EYES]: 0.5, [CHIN]: 1 })?.key,
    );
  });

  it('leaves the colours out: a recoloured look bakes the same far face', () => {
    const a = wocHeadLookFromAppearance({ ...DEFAULT_APPEARANCE, hairHue: 0, hairSat: 1 }, 'a');
    const b = wocHeadLookFromAppearance(
      { ...DEFAULT_APPEARANCE, hairHue: 200, hairSat: 0.4, skinLight: 0.1, eyeHue: 90 },
      'a',
    );
    expect(a.key).not.toBe(b.key);
    expect(wocFarHeadPose(a.morphs)?.key).toBe(wocFarHeadPose(b.morphs)?.key);
  });
});

describe('wocFarTintKey', () => {
  it('splits by tint presence, role, reference and surface', () => {
    const skin = { role: 'skin', ref: [0.2, 0.1, 0.05] };
    expect(wocFarTintKey(null)).toBe('-');
    expect(wocFarTintKey(skin)).not.toBe(wocFarTintKey(null));
    expect(wocFarTintKey(skin)).not.toBe(wocFarTintKey({ ...skin, role: 'hair' }));
    expect(wocFarTintKey(skin)).not.toBe(wocFarTintKey({ ...skin, ref: [0.2, 0.1, 0.06] }));
    expect(wocFarTintKey(skin)).toBe(wocFarTintKey({ role: 'skin', ref: [0.2, 0.1, 0.05] }));
    // the body's own atlas is another layer (another program) than a head piece's skin,
    // even against the same reference: the two never share a baked group
    const suit = { ...skin, surface: 'suit' };
    expect(wocFarTintKey(suit)).not.toBe(wocFarTintKey(skin));
    expect(wocFarTintKey(suit)).toBe('skin@suit:0.2,0.1,0.05');
    expect(wocFarTintKey(skin)).toBe('skin:0.2,0.1,0.05');
    expect(wocFarTintKey({ ...skin, surface: undefined })).toBe(wocFarTintKey(skin));
  });
});

describe('the merged head group', () => {
  it('answers one key no per-material group can', () => {
    // a per-material key is `<material uuid>|<body flag>|<tint key>` (woc_far_bake.ts):
    // the separator alone keeps the two apart, whatever the uuid or the tint
    expect(WOC_FAR_HEAD_GROUP_KEY).not.toContain('|');
    // every folded piece on that key is one group, the pieces left out keep theirs
    const grouping = coalesceFarBakeGroups([
      WOC_FAR_HEAD_GROUP_KEY,
      `a|0|${wocFarTintKey(null)}`,
      WOC_FAR_HEAD_GROUP_KEY,
      `b|0|${wocFarTintKey({ role: 'skin', ref: [0.2, 0.1, 0.05] })}`,
      WOC_FAR_HEAD_GROUP_KEY,
    ]);
    expect(grouping.groups).toEqual([[0, 2, 4], [1], [3]]);
  });
});

describe('wocFarHeadVertexSlots', () => {
  it('gives every vertex of a folded mesh its slot and every other vertex 0', () => {
    // sources: the body (4 vertices), then three head pieces of 2, 3 and 1
    const slots = wocFarHeadVertexSlots([0, 1, 2, 3], [4, 2, 3, 1], [null, 0, 2, 1]);
    expect(Array.from(slots)).toEqual([0, 0, 0, 0, 0, 0, 2, 2, 2, 1]);
  });

  it('follows the MERGE order, never the source order', () => {
    // the head pieces (sources 0, 2, 4) coalesce into the first group, so the bake lays
    // their vertices out first: a slot written by source order would land on the body
    const keys = ['head', 'body', 'head', 'armor', 'head'];
    const { mergeOrder } = coalesceFarBakeGroups(keys);
    expect(mergeOrder).toEqual([0, 2, 4, 1, 3]);
    const slots = wocFarHeadVertexSlots(mergeOrder, [2, 3, 1, 2, 2], [1, null, 2, null, 3]);
    expect(Array.from(slots)).toEqual([1, 1, 2, 3, 3, 0, 0, 0, 0, 0]);
  });

  it('is one value per merged vertex, whatever folds', () => {
    const none = wocFarHeadVertexSlots([1, 0], [3, 5], [null, null]);
    expect(none).toBeInstanceOf(Uint8Array);
    expect(Array.from(none)).toEqual(new Array(8).fill(0));
    expect(wocFarHeadVertexSlots([], [], [])).toHaveLength(0);
  });
});
