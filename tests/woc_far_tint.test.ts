// One character's far tint set (src/render/characters/woc_far_tint.ts) on real three
// materials, no WebGL: a group per role keeps its role's layer, the merged head group
// wears the merged layer with a row per slot read off that slot's own far material
// (which rides behind the groups' and never reaches the mesh), a colour change is a
// uniform write on the clones already minted, a new head on the same source rewrites
// the same clone (one per program variant), and the clones are freed with the set.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  type WocFarGroupTint,
  type WocFarHeadTint,
  WocFarTint,
} from '../src/render/characters/woc_far_tint';
import type { WocHeadTintRef } from '../src/render/characters/woc_head_look_core';
import {
  WOC_HEAD_MERGE_LAYER,
  WOC_HEAD_MERGE_MAX_SLOTS,
  WOC_HEAD_MERGE_ROLE_CODE,
  WOC_HEAD_MERGE_ROLES,
  type WocHeadMergeSlot,
} from '../src/render/characters/woc_head_merge_core';
import { wocHeadMergedTintOf, wocHeadTintOf } from '../src/render/characters/woc_head_tint';

const COLORS = {
  skin: [0.4, 0.2, 0.1],
  eye: [0.1, 0.3, 0.6],
  hair: [0.5, 0.05, 0.05],
  brow: [0.2, 0.1, 0.05],
} as const;
const OTHER = {
  skin: [0.1, 0.05, 0.02],
  eye: [0.3, 0.6, 0.1],
  hair: [0.05, 0.05, 0.5],
  brow: [0.02, 0.02, 0.02],
} as const;
const BODY: WocHeadTintRef = { role: 'skin', surface: 'suit', ref: [0.3, 0.17, 0.1] };
const NOSE: WocHeadTintRef = { role: 'skin', ref: [0.24, 0.12, 0.08] };

function texture(name: string): THREE.Texture {
  const t = new THREE.Texture();
  t.name = name;
  return t;
}

interface Surface {
  color: readonly [number, number, number];
  emissive?: readonly [number, number, number];
  roughness?: number;
  metalness?: number;
}

function material(name: string, surface: Surface): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    name,
    roughness: surface.roughness ?? 1,
    metalness: surface.metalness ?? 0,
  });
  m.color.setRGB(surface.color[0], surface.color[1], surface.color[2]);
  const e = surface.emissive ?? [0, 0, 0];
  m.emissive.setRGB(e[0], e[1], e[2]);
  return m;
}

/** A Type A head: the skin one sided, its hair and liner two sided. */
const SKIN: WocHeadMergeSlot = {
  material: 'skin_head',
  roleCode: WOC_HEAD_MERGE_ROLE_CODE.skin,
  ref: [0.23, 0.12, 0.09],
  layer: WOC_HEAD_MERGE_LAYER.atlas,
  oneSided: true,
};
const HAIR: WocHeadMergeSlot = {
  material: 'hair_swept',
  roleCode: WOC_HEAD_MERGE_ROLE_CODE.hair,
  ref: [0.04, 0.04, 0.04],
  layer: WOC_HEAD_MERGE_LAYER.hair,
  oneSided: false,
};
const LINER: WocHeadMergeSlot = {
  material: 'liner_L',
  roleCode: 0,
  ref: [0, 0, 0],
  layer: WOC_HEAD_MERGE_LAYER.atlas,
  oneSided: false,
};
const SLOTS: readonly WocHeadMergeSlot[] = [SKIN, HAIR, LINER];

/** A far set as the bake and the tier derivation hand it over (woc_far_bake.ts): the
 *  groups' materials (the body, the merged head, the armor, a head piece left out of the
 *  fold), then one material per head slot. The head's own colour is not white and its
 *  emissive not black, so a row that forgot to be RELATIVE to it is told apart, and no
 *  slot's material has the head's surface, so "relative to the head group's material"
 *  is told from "relative to the first slot". */
function farSet() {
  const head = material('woc_head_merged', {
    color: [0.8, 0.5, 0.25],
    emissive: [0.02, 0.02, 0.02],
    roughness: 0.6,
  });
  head.map = texture('atlas');
  const mats = [
    material('body', { color: [1, 1, 1] }),
    head,
    material('armor', { color: [1, 1, 1] }),
    material('skin_nose', { color: [1, 1, 1] }),
    // the slots' own far materials
    material('skin_head', {
      color: [0.6, 0.4, 0.2],
      emissive: [0.03, 0.02, 0.02],
      roughness: 0.65,
    }),
    material('hair_swept', {
      color: [0.4, 0.25, 0.5],
      emissive: [0.05, 0.02, 0.01],
      roughness: 0.72,
    }),
    material('liner_L', { color: [0.2, 0.1, 0.05], roughness: 0.9, metalness: 0.25 }),
  ];
  const headTint: WocFarHeadTint = {
    slots: SLOTS,
    sources: [4, 5, 6],
    hairMap: texture('hair'),
    beardMap: texture('beard'),
    scalpMap: texture('scalp'),
  };
  const tints: WocFarGroupTint[] = [BODY, headTint, null, NOSE];
  return { mats, tints, head, headTint };
}

function mergedOf(m: THREE.Material) {
  const u = wocHeadMergedTintOf(m);
  if (!u) throw new Error(`${m.name} does not wear the merged layer`);
  return u;
}

describe('WocFarTint.wrap', () => {
  it('returns one material per group and leaves the slot sources out of the set', () => {
    const { mats, tints, head } = farSet();
    const out = new WocFarTint().wrap(mats, tints, COLORS);
    expect(out).toHaveLength(tints.length);
    // an untinted group is the shared far clone itself
    expect(out[2]).toBe(mats[2]);
    // the body and the piece left out of the fold wear their own role's layer, on clones
    expect(out[0]).not.toBe(mats[0]);
    expect(wocHeadTintOf(out[0])?.surface).toBe('suit');
    expect(out[0].customProgramCacheKey()).toContain('woc_head_tint|skin_suit|');
    expect(wocHeadTintOf(out[3])?.role).toBe('skin');
    expect(wocHeadTintOf(out[3])?.surface).toBeUndefined();
    expect(wocHeadTintOf(out[3])?.ref.value.toArray()).toEqual([...NOSE.ref]);
    // the head group wears the merged layer, on a clone: the shared source is not hooked
    expect(out[1]).not.toBe(head);
    expect(wocHeadMergedTintOf(head)).toBeNull();
    expect(wocHeadTintOf(out[1])).toBeNull();
    expect(out[1].customProgramCacheKey()).toContain('woc_head_tint|merged|');
    // no slot's own material is drawn
    for (const source of mats.slice(tints.length)) expect(out).not.toContain(source);
  });

  it("writes each slot's row from its own far material, relative to the head material", () => {
    const { mats, tints } = farSet();
    const u = mergedOf(new WocFarTint().wrap(mats, tints, COLORS)[1]);
    // the skin: its reference and role, its colour over the head's, its emissive less the
    // head's, its own roughness, and one sided
    expect(u.ref.value[0].toArray()).toEqual([0.23, 0.12, 0.09, WOC_HEAD_MERGE_ROLE_CODE.skin]);
    expect(u.col.value[0].toArray()).toEqual([
      0.6 / 0.8,
      0.4 / 0.5,
      0.2 / 0.25,
      WOC_HEAD_MERGE_LAYER.atlas,
    ]);
    expect(u.emi.value[0].toArray()).toEqual([0.03 - 0.02, 0.02 - 0.02, 0.02 - 0.02, 0.65]);
    expect(u.surf.value[0].toArray().slice(0, 2)).toEqual([0, 1]);
    // ...then its reference's sRGB hue and saturation, converted on the CPU for the skin
    // band (woc_tint_hsv_core.ts; literal, by hand: an orange of hue 0.044, saturation 0.347)
    expect(u.surf.value[0].z).toBeCloseTo(0.0438, 3);
    expect(u.surf.value[0].w).toBeCloseTo(0.347, 3);
    // the hair: its colour over the head's, its emissive less the head's, its roughness
    expect(u.ref.value[1].toArray()).toEqual([0.04, 0.04, 0.04, WOC_HEAD_MERGE_ROLE_CODE.hair]);
    expect(u.col.value[1].toArray()).toEqual([
      0.4 / 0.8,
      0.25 / 0.5,
      0.5 / 0.25,
      WOC_HEAD_MERGE_LAYER.hair,
    ]);
    expect(u.emi.value[1].toArray()).toEqual([0.05 - 0.02, 0.02 - 0.02, 0.01 - 0.02, 0.72]);
    expect(u.surf.value[1].toArray()).toEqual([0, 0, 0, 0]);
    // the liner: untinted, and its own roughness and metalness
    expect(u.ref.value[2].toArray()).toEqual([0, 0, 0, 0]);
    expect(u.col.value[2].toArray()).toEqual([
      0.2 / 0.8,
      0.1 / 0.5,
      0.05 / 0.25,
      WOC_HEAD_MERGE_LAYER.atlas,
    ]);
    expect(u.emi.value[2].toArray()).toEqual([0 - 0.02, 0 - 0.02, 0 - 0.02, 0.9]);
    expect(u.surf.value[2].toArray()).toEqual([0.25, 0, 0, 0]);
    // every row past the table is inert
    for (let i = SLOTS.length; i < WOC_HEAD_MERGE_MAX_SLOTS; i++) {
      expect(u.ref.value[i].toArray()).toEqual([0, 0, 0, 0]);
      expect(u.col.value[i].toArray()).toEqual([1, 1, 1, 0]);
      expect(u.emi.value[i].toArray()).toEqual([0, 0, 0, 1]);
      expect(u.surf.value[i].toArray()).toEqual([0, 0, 0, 0]);
    }
  });

  it('hands the layer its textures and the look colours, at full strength whatever the body wears', () => {
    const { mats, tints, headTint } = farSet();
    const out = new WocFarTint().wrap(mats, tints, COLORS, 'underArmor');
    const u = mergedOf(out[1]);
    expect(u.hair.value).toBe(headTint.hairMap);
    expect(u.beard.value).toBe(headTint.beardMap);
    expect(u.scalp.value).toBe(headTint.scalpMap);
    // the core atlas is the head material's own map, carried by the clone
    expect((out[1] as THREE.MeshStandardMaterial).map?.name).toBe('atlas');
    WOC_HEAD_MERGE_ROLES.forEach((role, i) => {
      expect(u.tints.value[i].toArray(), role).toEqual([...COLORS[role]]);
    });
    // under a class under-armor atlas the BODY's skin layer is off; the head's never is
    expect(wocHeadTintOf(out[0])?.mix.value).toBe(0);
    expect(u.mix.value).toBe(1);
    expect(wocHeadTintOf(out[3])?.mix.value).toBe(1);
  });

  it('compiles the back-face drop only for a head with a one sided slot, a clone per variant', () => {
    const { mats, tints, headTint } = farSet();
    const tint = new WocFarTint();
    // the skin slot is one sided: the variant that drops its back faces
    const mixed = tint.wrap(mats, tints, COLORS)[1];
    expect(mergedOf(mixed).oneSided).toBe(true);
    expect(mixed.defines).toHaveProperty('WOC_HM_ONE_SIDED');
    // a head whose every slot is two sided: the plain variant, on a clone of its own (a
    // define is the program, so the two never share a material)
    const open: WocFarHeadTint = { ...headTint, slots: [HAIR, LINER], sources: [5, 6] };
    const plain = tint.wrap(mats, [BODY, open, null, NOSE], COLORS)[1];
    expect(plain).not.toBe(mixed);
    expect(mergedOf(plain).oneSided).toBe(false);
    expect(plain.defines ?? {}).not.toHaveProperty('WOC_HM_ONE_SIDED');
    expect(mergedOf(plain).surf.value[0].toArray()).toEqual([0, 0, 0, 0]);
    // back on the first head: the clone it already linked
    expect(tint.wrap(mats, tints, COLORS)[1]).toBe(mixed);
  });
});

describe('WocFarTint: colours are uniform writes', () => {
  it('setColors rewrites the clones it holds and mints none', () => {
    const { mats, tints } = farSet();
    const tint = new WocFarTint();
    const out = tint.wrap(mats, tints, COLORS);
    const u = mergedOf(out[1]);
    const key = out[1].customProgramCacheKey();
    tint.setColors(OTHER);
    WOC_HEAD_MERGE_ROLES.forEach((role, i) => {
      expect(u.tints.value[i].toArray(), role).toEqual([...OTHER[role]]);
    });
    expect(u.mix.value).toBe(1);
    expect(wocHeadTintOf(out[0])?.tint.value.toArray()).toEqual([...OTHER.skin]);
    expect(wocHeadTintOf(out[3])?.tint.value.toArray()).toEqual([...OTHER.skin]);
    // the same uniform objects on the same material, under the same program key
    expect(mergedOf(out[1])).toBe(u);
    expect(out[1].customProgramCacheKey()).toBe(key);
    // ...and a second wrap of the same sources hands back the very same clones
    const again = tint.wrap(mats, tints, OTHER);
    expect(again.every((m, i) => m === out[i])).toBe(true);
  });

  it('rewrites the same clone for a new head on the same source', () => {
    const { mats, tints, headTint } = farSet();
    const tint = new WocFarTint();
    const first = tint.wrap(mats, tints, COLORS)[1];
    const u = mergedOf(first);
    // a re-bake: the hair came off (two slots, no hair texture), the liner moved up a row
    const bald: WocFarHeadTint = {
      slots: [SKIN, LINER],
      sources: [4, 6],
      hairMap: null,
      beardMap: headTint.beardMap,
      scalpMap: null,
    };
    const second = tint.wrap(mats, [BODY, bald, null, NOSE], COLORS)[1];
    expect(second).toBe(first);
    expect(mergedOf(second)).toBe(u);
    expect(u.hair.value).toBeNull();
    expect(u.scalp.value).toBeNull();
    expect(u.beard.value).toBe(headTint.beardMap);
    expect(u.ref.value[1].toArray()).toEqual([0, 0, 0, 0]);
    expect(u.col.value[1].toArray()).toEqual([
      0.2 / 0.8,
      0.1 / 0.5,
      0.05 / 0.25,
      WOC_HEAD_MERGE_LAYER.atlas,
    ]);
    expect(u.surf.value[1].toArray()).toEqual([0.25, 0, 0, 0]);
    // the row the old table used is inert again
    expect(u.col.value[2].toArray()).toEqual([1, 1, 1, 0]);
    expect(u.surf.value[2].toArray()).toEqual([0, 0, 0, 0]);
  });

  it('keeps a clone per head source: a re-derived far material is a new wrap', () => {
    // a far re-skin or a new entity colour re-derives the far set: another head source
    const first = farSet();
    const second = farSet();
    const tint = new WocFarTint();
    const a = tint.wrap(first.mats, first.tints, COLORS)[1];
    const b = tint.wrap(second.mats, second.tints, COLORS)[1];
    expect(b).not.toBe(a);
    expect(mergedOf(b)).not.toBe(mergedOf(a));
    // both keep the look's colours: the set that is still mounted while the new one links
    tint.setColors(OTHER);
    const hair = WOC_HEAD_MERGE_ROLES.indexOf('hair');
    expect(mergedOf(a).tints.value[hair].toArray()).toEqual([...OTHER.hair]);
    expect(mergedOf(b).tints.value[hair].toArray()).toEqual([...OTHER.hair]);
    // the first source again: the clone it already linked
    expect(tint.wrap(first.mats, first.tints, COLORS)[1]).toBe(a);
  });

  it('shares one program key between two characters, whatever their heads and colours', () => {
    const a = farSet();
    const b = farSet();
    const headA = new WocFarTint().wrap(a.mats, a.tints, COLORS)[1];
    const headB = new WocFarTint().wrap(
      b.mats,
      [BODY, { ...b.headTint, slots: [SKIN], sources: [4], hairMap: null }, null, NOSE],
      OTHER,
    )[1];
    expect(headA).not.toBe(headB);
    expect(mergedOf(headA)).not.toBe(mergedOf(headB));
    expect(headA.customProgramCacheKey()).toBe(headB.customProgramCacheKey());
    expect(headA.defines).toEqual(headB.defines);
  });

  it('frees its wrapped clones, the head included, and never the shared sources', () => {
    const { mats, tints } = farSet();
    const tint = new WocFarTint();
    const out = tint.wrap(mats, tints, COLORS);
    const freed = new Set<THREE.Material>();
    for (const m of new Set([...mats, ...out])) m.addEventListener('dispose', () => freed.add(m));
    tint.dispose();
    expect(freed).toEqual(new Set([out[0], out[1], out[3]]));
    // a set wrapped after a dispose starts over on fresh clones
    const next = tint.wrap(mats, tints, COLORS);
    expect(next[1]).not.toBe(out[1]);
    const spy = vi.fn();
    next[1].addEventListener('dispose', spy);
    tint.dispose();
    expect(spy).toHaveBeenCalledOnce();
  });
});
