// The streaming rules of the split WOC head library (woc_head_stream_core.ts): the
// files a creator's slot prefetch fetches, the files a stored appearance's head needs,
// the look a live head DRAWS while a newly picked hairstyle or beard streams (the old
// one held, never a bald frame), the morphs following the drawn hairstyle, and when a
// body waits for its head (a base file ends at the neck). The going-live rule itself
// (every file of the look shown) is pinned on the dressing,
// tests/woc_head_dressing.test.ts.
import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '../src/render/characters/modular';
import {
  WOC_HEAD_BALD_CROWN_MORPH,
  WOC_HEAD_TYPES,
  type WocHeadLook,
  wocHeadCoreUrl,
  wocHeadLookUrls,
  wocHeadTuckMorph,
} from '../src/render/characters/woc_head_catalog';
import { wocHeadLookFromAppearance } from '../src/render/characters/woc_head_look_core';
import {
  wocHeadAppearanceUrls,
  wocHeadAwaited,
  wocHeadDrawnLook,
  wocHeadDrawnMorphs,
  wocHeadSlotUrls,
} from '../src/render/characters/woc_head_stream_core';

const DIR = 'models/chars/players/woc';
const A = WOC_HEAD_TYPES.a.defaults;

describe('wocHeadSlotUrls', () => {
  it('fetches every Type A hairstyle file, one per style, and never a file for bald', () => {
    expect(wocHeadSlotUrls('a', 'hair')).toEqual([
      `${DIR}/head_type_a_hair_swept.glb`,
      `${DIR}/head_type_a_hair_long.glb`,
      `${DIR}/head_type_a_hair_mohawk.glb`,
      `${DIR}/head_type_a_hair_quiff.glb`,
      `${DIR}/head_type_a_hair_undercut.glb`,
      `${DIR}/head_type_a_hair_topknot.glb`,
      `${DIR}/head_type_a_hair_shoulder.glb`,
      // Type B's styles fitted onto the Type A head ship as Type A files
      `${DIR}/head_type_a_hair_ponytail.glb`,
      `${DIR}/head_type_a_hair_braid.glb`,
      `${DIR}/head_type_a_hair_waves.glb`,
    ]);
  });

  it("fetches Type B's own hairstyles, never Type A's", () => {
    const b = wocHeadSlotUrls('b', 'hair');
    expect(b).toHaveLength(10);
    for (const url of b) expect(url).toMatch(/^models\/chars\/players\/woc\/head_type_b_hair_/);
    expect(b).toContain(`${DIR}/head_type_b_hair_braid.glb`);
    // a Type A style fitted onto the Type B head is Type B's own file
    expect(b).toContain(`${DIR}/head_type_b_hair_undercut.glb`);
  });

  it('fetches the shared beards file and the handlebar, nothing for clean shaven', () => {
    // catalog order: the moustache (the shared file) comes before the handlebar
    expect(wocHeadSlotUrls('a', 'beard')).toEqual([
      `${DIR}/head_type_a_beards.glb`,
      `${DIR}/head_type_a_beard_handlebar.glb`,
    ]);
    expect(wocHeadSlotUrls('b', 'beard')).toEqual([
      `${DIR}/head_type_b_beards.glb`,
      `${DIR}/head_type_b_beard_handlebar.glb`,
    ]);
  });

  it('a slot riding the core fetches only the core', () => {
    for (const slot of ['nose', 'mouth', 'brows', 'ears', 'eyes'] as const) {
      expect(wocHeadSlotUrls('a', slot), slot).toEqual([wocHeadCoreUrl('a')]);
    }
  });
});

describe('wocHeadDrawnLook', () => {
  const shownOnly =
    (...urls: string[]) =>
    (url: string) =>
      url === wocHeadCoreUrl('a') || urls.includes(url);

  it('keeps the drawn hairstyle while the picked one streams, then draws it', () => {
    const prev: WocHeadLook = { ...A };
    const want: WocHeadLook = { ...A, hair: 'mohawk' };
    const held = wocHeadDrawnLook('a', want, prev, shownOnly(`${DIR}/head_type_a_beards.glb`));
    expect(held.hair).toBe(A.hair);
    expect(held).not.toBe(want);
    const swapped = wocHeadDrawnLook(
      'a',
      want,
      prev,
      shownOnly(`${DIR}/head_type_a_beards.glb`, `${DIR}/head_type_a_hair_mohawk.glb`),
    );
    // nothing held: the wanted look itself
    expect(swapped).toBe(want);
  });

  it('holds the hairstyle and the beard independently, and every core slot swaps at once', () => {
    const prev: WocHeadLook = { ...A };
    const want: WocHeadLook = {
      ...A,
      hair: 'long',
      beard: 'handlebar',
      nose: 'broad',
      brows: 'arched',
      piercing: 'full',
    };
    const drawn = wocHeadDrawnLook('a', want, prev, shownOnly(`${DIR}/head_type_a_hair_long.glb`));
    expect(drawn).toEqual({ ...want, beard: A.beard });
  });

  it('bald and clean shaven are always ready, so picking them never holds', () => {
    const prev: WocHeadLook = { ...A };
    const want: WocHeadLook = { ...A, hair: 'bald', beard: 'none' };
    expect(wocHeadDrawnLook('a', want, prev, () => false)).toBe(want);
  });

  it('a bald head picking a streaming hairstyle stays bald until it lands', () => {
    const prev: WocHeadLook = { ...A, hair: 'bald' };
    const want: WocHeadLook = { ...A, hair: 'swept' };
    expect(wocHeadDrawnLook('a', want, prev, shownOnly()).hair).toBe('bald');
  });
});

describe('wocHeadDrawnMorphs', () => {
  it('equals the look state morphs when the drawn hair is the picked one and no helm is worn', () => {
    const state = wocHeadLookFromAppearance({ ...DEFAULT_APPEARANCE, headHair: 'long' }, 'a');
    expect(wocHeadDrawnMorphs(state, state.look, false)).toEqual(state.morphs);
  });

  it('moves the scalp tuck and bald crown with a HELD hairstyle, never the picked one', () => {
    const state = wocHeadLookFromAppearance({ ...DEFAULT_APPEARANCE, headHair: 'mohawk' }, 'a');
    const drawn = wocHeadDrawnMorphs(state, { ...state.look, hair: 'topknot' }, false);
    expect(drawn[wocHeadTuckMorph('topknot')]).toBe(1);
    expect(drawn[wocHeadTuckMorph('mohawk')]).toBe(0);
    expect(drawn[WOC_HEAD_BALD_CROWN_MORPH]).toBe(0);
    // held bald: the short crown, every tuck off
    const bald = wocHeadDrawnMorphs(state, { ...state.look, hair: 'bald' }, false);
    expect(bald[WOC_HEAD_BALD_CROWN_MORPH]).toBe(1);
    for (const v of WOC_HEAD_TYPES.a.slots.hair) {
      if (v.id !== 'bald') expect(bald[wocHeadTuckMorph(v.id)], v.id).toBe(0);
    }
    // the face controls are the look's own, untouched
    expect(drawn.FS_Chin_Softness).toBe(state.morphs.FS_Chin_Softness);
  });

  it('raises the crown under a hair-hiding helm, keeping the tuck', () => {
    const state = wocHeadLookFromAppearance({ ...DEFAULT_APPEARANCE, headHair: 'long' }, 'a');
    const helmed = wocHeadDrawnMorphs(state, state.look, true);
    expect(helmed[WOC_HEAD_BALD_CROWN_MORPH]).toBe(1);
    expect(helmed[wocHeadTuckMorph('long')]).toBe(1);
  });
});

describe('wocHeadAppearanceUrls', () => {
  it('names exactly the files the dressing will want for that appearance', () => {
    // the prefetch a host kicks before it builds must be the dressing's own look files
    // (woc_head_dressing.ts: wocHeadLookUrls of wocHeadLookFromAppearance's look)
    for (const app of [
      null,
      { ...DEFAULT_APPEARANCE, headHair: 'long', headBeard: 'handlebar' },
      { ...DEFAULT_APPEARANCE, headHair: 'braid' }, // a Type B pick on Type A: the default
      { gender: 'female', headHair: 'crown', headBeard: 'none' },
      { headHair: 'junk', headBeard: 42 },
    ]) {
      for (const type of ['a', 'b'] as const) {
        const want = wocHeadLookUrls(type, wocHeadLookFromAppearance(app, type).look);
        expect(wocHeadAppearanceUrls(app, type), `${type} ${JSON.stringify(app)}`).toEqual(want);
      }
    }
  });

  it("names the files: Type A's default is its core, swept hair and beards; Type B's the core and braid", () => {
    expect(wocHeadAppearanceUrls(null, 'a')).toEqual([
      `${DIR}/head_type_a_core.glb`,
      `${DIR}/head_type_a_hair_swept.glb`,
      `${DIR}/head_type_a_beards.glb`,
    ]);
    expect(wocHeadAppearanceUrls(null, 'b')).toEqual([
      `${DIR}/head_type_b_core.glb`,
      `${DIR}/head_type_b_hair_braid.glb`,
    ]);
    expect(
      wocHeadAppearanceUrls({ ...DEFAULT_APPEARANCE, headHair: 'bald', headBeard: 'none' }, 'a'),
    ).toEqual([`${DIR}/head_type_a_core.glb`]);
    // a Type B hairstyle on a Type A body: Type A's default, never a Type B file
    expect(wocHeadAppearanceUrls({ ...DEFAULT_APPEARANCE, headHair: 'curls' }, 'a')).toEqual([
      `${DIR}/head_type_a_core.glb`,
      `${DIR}/head_type_a_hair_swept.glb`,
      `${DIR}/head_type_a_beards.glb`,
    ]);
  });
});

describe('wocHeadAwaited', () => {
  it('waits while any file of the look is not ready and none has failed', () => {
    expect(wocHeadAwaited(['resident', 'loading', 'resident'])).toBe(true);
    expect(wocHeadAwaited(['loading', 'loading'])).toBe(true);
    // not asked for yet: the next poll fetches it, the body still waits
    expect(wocHeadAwaited(['resident', 'idle'])).toBe(true);
  });

  it('has nothing to wait for once every file is resident (and for a look with no file)', () => {
    expect(wocHeadAwaited(['resident', 'resident', 'resident'])).toBe(false);
    expect(wocHeadAwaited([])).toBe(false);
  });

  it('a failed file ends the wait whatever the others are doing: a dead request never hides a body', () => {
    expect(wocHeadAwaited(['failed'])).toBe(false);
    expect(wocHeadAwaited(['resident', 'failed', 'loading'])).toBe(false);
    expect(wocHeadAwaited(['loading', 'idle', 'failed'])).toBe(false);
  });
});
