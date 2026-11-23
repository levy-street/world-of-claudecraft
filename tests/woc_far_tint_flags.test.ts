// The far tint set's dev A/B arms (src/render/characters/woc_far_tint.ts, read through
// render_dev_flags.ts renderLayerDisabled): `?wocfarheadtint=off` draws a far body's head
// group with its plain far material, `?wocfarbodytint=off` its own body group with the
// far material itself, and `?wocfarshare=off` gives each body its own clone of a
// switched-off body layer again. They exist to attribute what a far crowd costs, one
// layer at a time, so each arm must take exactly its layer off and nothing else, and
// none may be on by any other spelling.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WocFarGroupTint, WocFarHeadTint } from '../src/render/characters/woc_far_tint';
import type { WocHeadTintRef } from '../src/render/characters/woc_head_look_core';
import {
  WOC_HEAD_MERGE_LAYER,
  WOC_HEAD_MERGE_ROLE_CODE,
  type WocHeadMergeSlot,
} from '../src/render/characters/woc_head_merge_core';

const COLORS = {
  skin: [0.4, 0.2, 0.1],
  eye: [0.1, 0.3, 0.6],
  hair: [0.5, 0.05, 0.05],
  brow: [0.2, 0.1, 0.05],
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

// render_dev_flags reads location ONCE at module load, so every case imports the tint
// set (and the flags with it) fresh behind a stubbed location.
async function load(search: string | null, bodyAtlas: 'suit' | 'underArmor' = 'suit') {
  vi.resetModules();
  if (search === null) vi.stubGlobal('location', undefined);
  else vi.stubGlobal('location', { search });
  const tint = await import('../src/render/characters/woc_far_tint');
  const layer = await import('../src/render/characters/woc_head_tint');
  const material = (name: string): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ name });
  /** A far set as the bake hands it over: the body, the merged head, the armor, a head
   *  piece left out of the fold, then the head's one slot source. */
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
  const out = new tint.WocFarTint().wrap(mats, tints, COLORS, bodyAtlas);
  /** A second character's set over the same far materials. */
  const peer = new tint.WocFarTint().wrap(mats, tints, COLORS, bodyAtlas);
  return {
    tint,
    mats,
    out,
    peer,
    merged: (m: THREE.Material) => layer.wocHeadMergedTintOf(m),
    role: (m: THREE.Material) => layer.wocHeadTintOf(m),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('the far tint A/B arms', () => {
  it('names the flags the tint set reads', async () => {
    const { tint } = await load('');
    expect(tint.WOC_FAR_HEAD_TINT_FLAG).toBe('wocfarheadtint');
    expect(tint.WOC_FAR_BODY_TINT_FLAG).toBe('wocfarbodytint');
    expect(tint.WOC_FAR_SHARE_FLAG).toBe('wocfarshare');
  });

  it('?wocfarshare=off gives every body its own clone of a switched-off body layer again, and changes no pixel', async () => {
    // by default the two characters share ONE clone under the under-armor atlas...
    const shared = await load('', 'underArmor');
    expect(shared.peer[0]).toBe(shared.out[0]);
    // ...and with the arm off each has its own: the layer still off, on the same program
    const split = await load('?wocfarshare=off', 'underArmor');
    expect(split.peer[0]).not.toBe(split.out[0]);
    expect(split.out[0]).not.toBe(split.mats[0]);
    for (const body of [split.out[0], split.peer[0]]) {
      expect(split.role(body)?.surface).toBe('suit');
      expect(split.role(body)?.mix.value).toBe(0);
    }
    expect(split.out[0].customProgramCacheKey()).toBe(shared.out[0].customProgramCacheKey());
    // nothing else moves: the head keeps its merged layer, the armor passes through
    expect(split.merged(split.out[1])).not.toBeNull();
    expect(split.out[2]).toBe(split.mats[2]);
    // on the suit the arm changes nothing: those clones were per body already
    const suit = await load('?wocfarshare=off');
    expect(suit.peer[0]).not.toBe(suit.out[0]);
    expect(suit.role(suit.out[0])?.mix.value).toBe(1);
  }, 60_000);

  it('wears every layer by default, and in a headless host with no location', async () => {
    for (const search of ['', '?perf', null]) {
      const { mats, out, merged, role } = await load(search);
      expect(out).toHaveLength(4);
      expect(merged(out[1]), String(search)).not.toBeNull();
      expect(out[1]).not.toBe(mats[1]);
      expect(role(out[0])?.surface, String(search)).toBe('suit');
      expect(out[0]).not.toBe(mats[0]);
      expect(role(out[3])?.role, String(search)).toBe('skin');
    }
  }, 60_000);

  it('?wocfarheadtint=off draws the head group with its plain far material, and nothing else changes', async () => {
    const { mats, out, merged, role } = await load('?wocfarheadtint=off');
    // the head group: the shared far material itself, no clone, no merged layer
    expect(out[1]).toBe(mats[1]);
    expect(merged(out[1])).toBeNull();
    expect(out[1].customProgramCacheKey()).not.toContain('woc_head_tint');
    // (a layered material's key does say so: the body beside it, still wearing its own)
    expect(out[0].customProgramCacheKey()).toContain('woc_head_tint');
    // the body keeps its skin layer, the unfolded piece its own, the armor is untouched
    expect(role(out[0])?.surface).toBe('suit');
    expect(out[0]).not.toBe(mats[0]);
    expect(role(out[3])?.role).toBe('skin');
    expect(out[2]).toBe(mats[2]);
    // still one material per group: the slot source rides behind and is never drawn
    expect(out).toHaveLength(4);
    expect(out).not.toContain(mats[4]);
  });

  it('?wocfarbodytint=off draws the body group with the far material itself, and nothing else changes', async () => {
    const { mats, out, merged, role } = await load('?wocfarbodytint=off');
    // the body's own group: no clone, no layer (the program is the plain far program)
    expect(out[0]).toBe(mats[0]);
    expect(role(out[0])).toBeNull();
    expect(out[0].customProgramCacheKey()).not.toContain('woc_head_tint');
    // (the head beside it still says so)
    expect(out[1].customProgramCacheKey()).toContain('woc_head_tint');
    // the head keeps its merged layer, and a head piece left out of the fold its skin layer
    // (it is skin too, but not the body's suit surface)
    expect(merged(out[1])).not.toBeNull();
    expect(role(out[3])?.role).toBe('skin');
    expect(out[3]).not.toBe(mats[3]);
    expect(out[2]).toBe(mats[2]);
  });

  it('takes both arms at once, and neither on any other value', async () => {
    const both = await load('?wocfarheadtint=off&wocfarbodytint=off');
    expect(both.out[0]).toBe(both.mats[0]);
    expect(both.out[1]).toBe(both.mats[1]);
    expect(both.role(both.out[3])?.role).toBe('skin');
    for (const search of [
      '?wocfarheadtint=1&wocfarbodytint=',
      '?wocfarheadtint=on',
      '?wocmerge=off',
      '?wocfarshare=off',
    ]) {
      const { mats, out, merged, role } = await load(search);
      expect(merged(out[1]), search).not.toBeNull();
      expect(role(out[0])?.surface, search).toBe('suit');
      expect(out[0], search).not.toBe(mats[0]);
    }
  }, 60_000);
});
