// The far body's skin layer SWITCHED OFF is one material for every wearer
// (src/render/characters/woc_far_tint.ts sharedOffLayer). A body under a class under-armor
// atlas draws its layer at strength 0, and the layer's whole body sits behind
// `if (uWocHtMix > 0.0)` (woc_head_tint.ts), so at 0 no uniform of it reaches a texel: every
// character on the same far material draws the same thing. A clone per character there was
// a material of its own, on a program of its own, between every two far heads of a crowd
// sorted by material. Pins: the clone is shared exactly where the layer is off, no
// character's colours ever reach it, a body on its suit keeps a clone of its own, and the
// shared clone is freed with its source, never with a character.
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
  WOC_HEAD_MERGE_ROLE_CODE,
  type WocHeadMergeSlot,
} from '../src/render/characters/woc_head_merge_core';
import { wocHeadMergedTintOf, wocHeadTintOf } from '../src/render/characters/woc_head_tint';

const PALE = {
  skin: [0.8, 0.6, 0.5],
  eye: [0.1, 0.3, 0.6],
  hair: [0.5, 0.05, 0.05],
  brow: [0.2, 0.1, 0.05],
} as const;
const EBONY = {
  skin: [0.1, 0.05, 0.02],
  eye: [0.3, 0.6, 0.1],
  hair: [0.05, 0.05, 0.5],
  brow: [0.02, 0.02, 0.02],
} as const;
const BODY: WocHeadTintRef = { role: 'skin', surface: 'suit', ref: [0.3, 0.17, 0.1] };
const NOSE: WocHeadTintRef = { role: 'skin', ref: [0.24, 0.12, 0.08] };
const SKIN: WocHeadMergeSlot = {
  material: 'skin_head',
  roleCode: WOC_HEAD_MERGE_ROLE_CODE.skin,
  ref: [0.23, 0.12, 0.09],
  layer: WOC_HEAD_MERGE_LAYER.atlas,
  oneSided: true,
};

const material = (name: string): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ name });

/** A far set as the bake hands it over: the body, the merged head, the armor, a head piece
 *  left out of the fold, then the head's one slot source (never drawn). */
function farSet() {
  const mats = [
    material('body'),
    material('woc_head_merged'),
    material('armor'),
    material('skin_nose'),
    material('skin_head'),
  ];
  const head: WocFarHeadTint = {
    slots: [SKIN],
    sources: [4],
    hairMap: null,
    beardMap: null,
    scalpMap: null,
  };
  const tints: WocFarGroupTint[] = [BODY, head, null, NOSE];
  return { mats, tints };
}

describe('the far body layer switched off', () => {
  it('is ONE material for every character on the same far source, whatever their colours', () => {
    const { mats, tints } = farSet();
    const a = new WocFarTint().wrap(mats, tints, PALE, 'underArmor');
    const b = new WocFarTint().wrap(mats, tints, EBONY, 'underArmor');
    // the body group: the very same material object, so a crowd binds it once
    expect(b[0]).toBe(a[0]);
    // a wrapped clone, not the source: it wears the suit layer's program, the one a body on
    // its suit draws with, so an armored and a bare body never switch programs between them
    expect(a[0]).not.toBe(mats[0]);
    expect(wocHeadTintOf(a[0])?.surface).toBe('suit');
    expect(a[0].customProgramCacheKey()).toContain('woc_head_tint|skin_suit|');
    // nothing else is shared: each character's head and its unfolded skin piece are its own
    expect(b[1]).not.toBe(a[1]);
    expect(b[3]).not.toBe(a[3]);
    expect(wocHeadMergedTintOf(a[1])).not.toBeNull();
    // the armor passes through untouched, as before
    expect(a[2]).toBe(mats[2]);
    expect(b[2]).toBe(mats[2]);
  });

  it("stays off and takes no character's colour: not at the wrap, not on a colour change", () => {
    const { mats, tints } = farSet();
    const first = new WocFarTint();
    const second = new WocFarTint();
    const pale = first.wrap(mats, tints, PALE, 'underArmor');
    const u = wocHeadTintOf(pale[0]);
    if (!u) throw new Error('no layer');
    const born = u.tint.value.toArray();
    expect(u.mix.value).toBe(0);
    const ebony = second.wrap(mats, tints, EBONY, 'underArmor');
    // strength 0 is the whole proof that sharing draws what a clone each drew: the layer
    // runs only where the strength is above 0
    expect(u.mix.value).toBe(0);
    // ...and no wearer wrote its skin tone into the shared uniforms
    expect(u.tint.value.toArray()).toEqual(born);
    expect(born).not.toEqual([...PALE.skin]);
    expect(born).not.toEqual([...EBONY.skin]);
    // the layers that DO draw follow their own character, here and across a colour change
    const nose = (set: THREE.Material[]) => wocHeadTintOf(set[3])?.tint.value.toArray();
    expect(nose(pale)).toEqual([...PALE.skin]);
    expect(nose(ebony)).toEqual([...EBONY.skin]);
    first.setColors(EBONY);
    second.setColors(PALE);
    expect(nose(pale)).toEqual([...EBONY.skin]);
    expect(nose(ebony)).toEqual([...PALE.skin]);
    expect(u.mix.value).toBe(0);
    expect(u.tint.value.toArray()).toEqual(born);
  });

  it('is not what a body on its suit draws: that one keeps a clone of its own, at full strength', () => {
    const { mats, tints } = farSet();
    const armored = new WocFarTint().wrap(mats, tints, PALE, 'underArmor')[0];
    const pale = new WocFarTint().wrap(mats, tints, PALE, 'suit')[0];
    const ebony = new WocFarTint().wrap(mats, tints, EBONY, 'suit')[0];
    expect(pale).not.toBe(armored);
    expect(ebony).not.toBe(armored);
    expect(ebony).not.toBe(pale);
    expect(wocHeadTintOf(pale)?.mix.value).toBe(1);
    expect(wocHeadTintOf(pale)?.tint.value.toArray()).toEqual([...PALE.skin]);
    expect(wocHeadTintOf(ebony)?.tint.value.toArray()).toEqual([...EBONY.skin]);
    // same program all three: the switch is a uniform, never a link
    expect(pale.customProgramCacheKey()).toBe(armored.customProgramCacheKey());
    // the shared clone was not switched on by its neighbours
    expect(wocHeadTintOf(armored)?.mix.value).toBe(0);
  });

  it('does not switch the shared clone on when ONE set is asked for both atlases', () => {
    // the visual never does this (a far source is one atlas for good), but the tint set
    // must not depend on it: a set that kept the shared clone as its own would write its
    // strength and its colour into every other wearer's body
    const { mats, tints } = farSet();
    const set = new WocFarTint();
    const off = set.wrap(mats, tints, PALE, 'underArmor')[0];
    const on = set.wrap(mats, tints, PALE, 'suit')[0];
    expect(on).not.toBe(off);
    expect(wocHeadTintOf(on)?.mix.value).toBe(1);
    expect(wocHeadTintOf(off)?.mix.value).toBe(0);
    set.setColors(EBONY);
    expect(wocHeadTintOf(off)?.mix.value).toBe(0);
    expect(wocHeadTintOf(off)?.tint.value.toArray()).not.toEqual([...EBONY.skin]);
    // and going back hands the shared clone out again
    expect(set.wrap(mats, tints, EBONY, 'underArmor')[0]).toBe(off);
  });

  it('is kept per far source and per layer reference', () => {
    const { mats, tints } = farSet();
    const other = farSet();
    const a = new WocFarTint().wrap(mats, tints, PALE, 'underArmor')[0];
    // another far source (another class's under-armor atlas, another tint, another tier)
    const b = new WocFarTint().wrap(other.mats, other.tints, PALE, 'underArmor')[0];
    expect(b).not.toBe(a);
    // the same source under another measured skin reference (the other head type's body)
    const typeB: WocFarGroupTint[] = [{ ...BODY, ref: [0.31, 0.18, 0.11] }, ...tints.slice(1)];
    const c = new WocFarTint().wrap(mats, typeB, PALE, 'underArmor')[0];
    expect(c).not.toBe(a);
    expect(wocHeadTintOf(c)?.ref.value.toArray()).toEqual([0.31, 0.18, 0.11]);
    expect(wocHeadTintOf(a)?.ref.value.toArray()).toEqual([...BODY.ref]);
  });

  it('is freed with its source, never with a character', () => {
    const { mats, tints } = farSet();
    const first = new WocFarTint();
    const second = new WocFarTint();
    const out = first.wrap(mats, tints, PALE, 'underArmor');
    second.wrap(mats, tints, EBONY, 'underArmor');
    const freed = new Set<THREE.Material>();
    for (const m of [...mats, ...out]) m.addEventListener('dispose', () => freed.add(m));
    // a character leaves: its own clones go (the head, the unfolded piece), the shared
    // body layer stays mounted on everyone else
    first.dispose();
    expect(freed).toEqual(new Set([out[1], out[3]]));
    second.dispose();
    expect(freed.has(out[0])).toBe(false);
    // still the one handed out while its source lives (a body walking back into range)
    expect(new WocFarTint().wrap(mats, tints, PALE, 'underArmor')[0]).toBe(out[0]);
    // the tinted-material cache frees a far source once nothing mounts it: its layer goes
    // with it, once
    const disposed = vi.spyOn(out[0], 'dispose');
    mats[0].dispose();
    expect(freed.has(out[0])).toBe(true);
    expect(disposed).toHaveBeenCalledTimes(1);
    // a source drawn again after that is wrapped afresh, never handed the freed clone
    const again = new WocFarTint().wrap(mats, tints, PALE, 'underArmor')[0];
    expect(again).not.toBe(out[0]);
    expect(wocHeadTintOf(again)?.mix.value).toBe(0);
    const againDisposed = vi.spyOn(again, 'dispose');
    mats[0].dispose();
    expect(againDisposed).toHaveBeenCalledTimes(1);
    expect(disposed).toHaveBeenCalledTimes(1);
  });
});
