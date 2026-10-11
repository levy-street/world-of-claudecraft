// The streaming rules of the split WOC head library (woc_head_stream_core.ts): the
// files a creator's slot prefetch fetches, the files a stored appearance's head needs,
// the piece nodes a look draws out of each file (all a body hangs), when a head goes
// live (whole look for a preview, the bare head standing in for a hairstyle or a beard
// still on the wire in the world), the look a live head DRAWS while a newly picked
// piece is not ready (the old one held, never a hole in the face), the morphs following
// the drawn hairstyle, and when a body waits for its head (a base file ends at the
// neck). The dressing applies these over its own hung pieces,
// tests/woc_head_dressing.test.ts.
import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '../src/render/characters/modular';
import {
  WOC_HEAD_BALD_CROWN_MORPH,
  WOC_HEAD_TYPES,
  type WocHeadLook,
  type WocHeadType,
  wocHeadAllNodes,
  wocHeadAllUrls,
  wocHeadCoreUrl,
  wocHeadLookUrls,
  wocHeadTuckMorph,
  wocHeadVisibleNodes,
} from '../src/render/characters/woc_head_catalog';
import { wocHeadLookFromAppearance } from '../src/render/characters/woc_head_look_core';
import {
  wocHeadAppearanceUrls,
  wocHeadAwaited,
  wocHeadBareLook,
  wocHeadDrawnLook,
  wocHeadDrawnMorphs,
  wocHeadFileJoining,
  wocHeadFileSettled,
  wocHeadLiveLook,
  wocHeadLookPieces,
  wocHeadPieceFiles,
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

/** Every piece node of the files named (the whole file hung and revealed). */
function nodesOf(type: WocHeadType, ...urls: string[]): Set<string> {
  const out = new Set<string>();
  for (const [node, url] of wocHeadPieceFiles(type)) if (urls.includes(url)) out.add(node);
  return out;
}
/** A `ready` over piece nodes: the core's, plus those of the files named. */
const readyWith =
  (...urls: string[]) =>
  (node: string): boolean =>
    nodesOf('a', wocHeadCoreUrl('a'), ...urls).has(node);
const HAIR = (id: string): string => `${DIR}/head_type_a_hair_${id}.glb`;
const BEARDS = `${DIR}/head_type_a_beards.glb`;
const HANDLEBAR = `${DIR}/head_type_a_beard_handlebar.glb`;

describe('wocHeadLookPieces', () => {
  it("names the pieces of Type A's default look, file by file, the core first", () => {
    expect([...wocHeadLookPieces('a', A)]).toEqual([
      [
        `${DIR}/head_type_a_core.glb`,
        [
          'WocHead_A_base',
          'WocHead_A_nose_default',
          'WocHead_A_mouth_default',
          'WocHead_A_brows_relaxed_L',
          'WocHead_A_brows_relaxed_R',
          'WocHead_A_ears_default_L',
          'WocHead_A_ears_default_R',
          'WocHead_A_eyes_default_L',
          'WocHead_A_eyes_default_R',
        ],
      ],
      [HAIR('swept'), ['WocHead_A_hair_swept']],
      // ONE beard of the seven the shared file ships
      [BEARDS, ['WocHead_A_beard_boxed']],
    ]);
  });

  it('is exactly the files the look fetches and the nodes it draws with no helm, for every look', () => {
    for (const type of ['a', 'b'] as const) {
      const def = WOC_HEAD_TYPES[type];
      const looks: WocHeadLook[] = [
        def.defaults,
        { ...def.defaults, hair: 'bald', beard: 'none' },
        { ...def.defaults, beard: 'handlebar', piercing: 'full' },
        ...def.slots.hair.map((v) => ({ ...def.defaults, hair: v.id })),
        ...def.slots.nose.map((v) => ({ ...def.defaults, nose: v.id, piercing: 'septum' })),
      ];
      for (const look of looks) {
        const pieces = wocHeadLookPieces(type, look);
        expect([...pieces.keys()], JSON.stringify(look)).toEqual(wocHeadLookUrls(type, look));
        expect([...pieces.values()].flat().sort(), JSON.stringify(look)).toEqual(
          wocHeadVisibleNodes(type, look, { helm: false }).sort(),
        );
        // ...each from the file that ships it
        for (const [url, nodes] of pieces) {
          for (const node of nodes) expect(wocHeadPieceFiles(type).get(node), node).toBe(url);
        }
      }
    }
  });

  it('a bald, clean shaven look hangs nothing but core pieces', () => {
    const pieces = wocHeadLookPieces('a', { ...A, hair: 'bald', beard: 'none' });
    expect([...pieces.keys()]).toEqual([`${DIR}/head_type_a_core.glb`]);
  });
});

describe('wocHeadPieceFiles', () => {
  it('files every node of the library, each in a file the library ships', () => {
    for (const type of ['a', 'b'] as const) {
      const files = wocHeadPieceFiles(type);
      expect([...files.keys()].sort()).toEqual([...wocHeadAllNodes(type)].sort());
      expect([...new Set(files.values())].sort()).toEqual(wocHeadAllUrls(type).sort());
    }
    expect(wocHeadPieceFiles('a').get('WocHead_A_beard_handlebar')).toBe(HANDLEBAR);
    expect(wocHeadPieceFiles('a').get('WocHead_A_beard_goatee')).toBe(BEARDS);
    expect(wocHeadPieceFiles('a').get('WocHead_A_piercing_lip')).toBe(wocHeadCoreUrl('a'));
    // a Type B node is no Type A piece
    expect(wocHeadPieceFiles('a').has('WocHead_B_base')).toBe(false);
  });
});

describe('wocHeadBareLook', () => {
  it('takes the hairstyle and the beard off and leaves every core slot as picked', () => {
    const look: WocHeadLook = { ...A, nose: 'broad', piercing: 'full' };
    expect(wocHeadBareLook('a', look)).toEqual({ ...look, hair: 'bald', beard: 'none' });
    expect(wocHeadBareLook('b', WOC_HEAD_TYPES.b.defaults)).toEqual({
      ...WOC_HEAD_TYPES.b.defaults,
      hair: 'bald',
    });
  });

  it('a look that is already bare is itself', () => {
    const bare: WocHeadLook = { ...A, hair: 'bald', beard: 'none' };
    expect(wocHeadBareLook('a', bare)).toBe(bare);
  });
});

describe('wocHeadLiveLook', () => {
  const none = (): boolean => false;
  const all = (): boolean => true;

  describe('whole look (a preview, a portrait, the face builder)', () => {
    it('goes live on the look itself once every piece is ready', () => {
      expect(wocHeadLiveLook('a', A, all, false)).toBe(A);
      expect(wocHeadLiveLook('a', A, readyWith(HAIR('swept'), BEARDS), false)).toBe(A);
    });

    it('never goes live while a hairstyle, a beard or the core is missing', () => {
      // the hairstyle on the wire (or failed: not ready either way)
      expect(wocHeadLiveLook('a', A, readyWith(BEARDS), false)).toBeNull();
      // the beard
      expect(wocHeadLiveLook('a', A, readyWith(HAIR('swept')), false)).toBeNull();
      // the core
      const noCore = (node: string): boolean => nodesOf('a', HAIR('swept'), BEARDS).has(node);
      expect(wocHeadLiveLook('a', A, noCore, false)).toBeNull();
      expect(wocHeadLiveLook('a', A, none, false)).toBeNull();
    });

    it('one piece of the look still linking keeps the whole head back', () => {
      const butTheNose = (node: string): boolean => node !== 'WocHead_A_nose_default';
      expect(wocHeadLiveLook('a', A, butTheNose, false)).toBeNull();
    });
  });

  describe('bare stand-in (a body in the world)', () => {
    it('with everything ready, goes live on the look itself', () => {
      expect(wocHeadLiveLook('a', A, all, true)).toBe(A);
    });

    it('a hairstyle not ready: live at once, bald, the beard drawn', () => {
      const live = wocHeadLiveLook('a', A, readyWith(BEARDS), true);
      expect(live).toEqual({ ...A, hair: 'bald' });
      // the wanted look is never written
      expect(A.hair).toBe('swept');
    });

    it('a beard not ready: live at once, clean shaven, the hairstyle drawn', () => {
      expect(wocHeadLiveLook('a', A, readyWith(HAIR('swept')), true)).toEqual({
        ...A,
        beard: 'none',
      });
    });

    it('neither ready: the bare head, every core slot as picked', () => {
      const want: WocHeadLook = { ...A, nose: 'broad', brows: 'arched', piercing: 'lobes' };
      expect(wocHeadLiveLook('a', want, readyWith(), true)).toEqual({
        ...want,
        hair: 'bald',
        beard: 'none',
      });
    });

    it('the core missing: no head to draw, whatever else is there', () => {
      const noCore = (node: string): boolean => nodesOf('a', HAIR('swept'), BEARDS).has(node);
      expect(wocHeadLiveLook('a', A, noCore, true)).toBeNull();
      expect(wocHeadLiveLook('a', A, none, true)).toBeNull();
      // a core piece of the look alone is enough to keep it back
      const butAnEye = (node: string): boolean => node !== 'WocHead_A_eyes_default_R';
      expect(wocHeadLiveLook('a', A, butAnEye, true)).toBeNull();
    });

    it('a core piece the look does not draw holds nothing back', () => {
      // only the pieces the default look draws are ready, never the other noses
      const drawn = new Set(wocHeadVisibleNodes('a', A, { helm: false }));
      expect(wocHeadLiveLook('a', A, (node) => drawn.has(node), true)).toBe(A);
      expect(wocHeadLiveLook('a', A, (node) => drawn.has(node), false)).toBe(A);
    });

    it('what it left off joins through the slot hold once its file is ready', () => {
      const born = wocHeadLiveLook('a', A, readyWith(), true) as WocHeadLook;
      expect(born.hair).toBe('bald');
      // the hairstyle lands: drawn, the beard still left off
      const haired = wocHeadDrawnLook('a', A, born, readyWith(HAIR('swept')));
      expect(haired).toEqual({ ...A, beard: 'none' });
      // the beard too: the wanted look itself
      expect(wocHeadDrawnLook('a', A, haired, readyWith(HAIR('swept'), BEARDS))).toBe(A);
    });

    it('a bald, clean shaven look needs only the core in either mode', () => {
      const bald: WocHeadLook = { ...A, hair: 'bald', beard: 'none' };
      expect(wocHeadLiveLook('a', bald, readyWith(), true)).toBe(bald);
      expect(wocHeadLiveLook('a', bald, readyWith(), false)).toBe(bald);
    });
  });
});

describe('wocHeadDrawnLook', () => {
  it('keeps the drawn hairstyle while the picked one is not ready, then draws it', () => {
    const prev: WocHeadLook = { ...A };
    const want: WocHeadLook = { ...A, hair: 'mohawk' };
    const held = wocHeadDrawnLook('a', want, prev, readyWith(BEARDS));
    expect(held.hair).toBe(A.hair);
    expect(held).not.toBe(want);
    const swapped = wocHeadDrawnLook('a', want, prev, readyWith(BEARDS, HAIR('mohawk')));
    // nothing held: the wanted look itself
    expect(swapped).toBe(want);
  });

  it('holds the hairstyle and the beard independently, and a core slot whose piece is ready swaps at once', () => {
    const prev: WocHeadLook = { ...A };
    const want: WocHeadLook = {
      ...A,
      hair: 'long',
      beard: 'handlebar',
      nose: 'broad',
      brows: 'arched',
      piercing: 'full',
    };
    const drawn = wocHeadDrawnLook('a', want, prev, readyWith(HAIR('long')));
    expect(drawn).toEqual({ ...want, beard: A.beard });
  });

  it('a core slot holds too while its own piece is not ready: never a hole in the face', () => {
    const prev: WocHeadLook = { ...A };
    const want: WocHeadLook = { ...A, nose: 'broad', brows: 'arched' };
    // the broad nose is hung and linked, the arched brows only the left one
    const ready = (node: string): boolean =>
      node === 'WocHead_A_nose_broad' || node === 'WocHead_A_brows_arched_L';
    expect(wocHeadDrawnLook('a', want, prev, ready)).toEqual({ ...want, brows: A.brows });
    // the pair complete: the wanted look itself
    const both = (node: string): boolean => ready(node) || node === 'WocHead_A_brows_arched_R';
    expect(wocHeadDrawnLook('a', want, prev, both)).toBe(want);
  });

  it('holds the piercing preset until every site of the new one is ready', () => {
    const prev: WocHeadLook = { ...A, piercing: 'lobes' };
    const want: WocHeadLook = { ...A, piercing: 'ears' };
    const lobes = (node: string): boolean => /_piercing_lobe_[lr]$/.test(node);
    expect(wocHeadDrawnLook('a', want, prev, lobes).piercing).toBe('lobes');
    const ears = (node: string): boolean => /_piercing_(lobe|rim)_[lr]$/.test(node);
    expect(wocHeadDrawnLook('a', want, prev, ears)).toBe(want);
    // taking them all off needs no piece: at once
    expect(wocHeadDrawnLook('a', { ...A, piercing: 'none' }, prev, () => false).piercing).toBe(
      'none',
    );
  });

  it('bald and clean shaven are always ready, so picking them never holds', () => {
    const prev: WocHeadLook = { ...A };
    const want: WocHeadLook = { ...A, hair: 'bald', beard: 'none' };
    expect(wocHeadDrawnLook('a', want, prev, () => false)).toBe(want);
  });

  it('a bald head picking a streaming hairstyle stays bald until it lands', () => {
    const prev: WocHeadLook = { ...A, hair: 'bald' };
    const want: WocHeadLook = { ...A, hair: 'swept' };
    expect(wocHeadDrawnLook('a', want, prev, readyWith()).hair).toBe('bald');
  });

  it('a slot that did not change is never held, ready or not', () => {
    // the drawn look IS the wanted one: nothing to decide, whatever `ready` says
    expect(wocHeadDrawnLook('a', A, A, () => false)).toBe(A);
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

describe('wocHeadFileSettled (the merged stand-in waits for a head at rest)', () => {
  it('a file that is drawn, or that failed, leaves the head at rest in what it holds', () => {
    expect(wocHeadFileSettled('resident')).toBe(true);
    expect(wocHeadFileSettled('failed')).toBe(true);
  });

  it('a file on its way, or one nobody asked for yet, is about to change the head', () => {
    expect(wocHeadFileSettled('loading')).toBe(false);
    expect(wocHeadFileSettled('idle')).toBe(false);
  });
});

describe('wocHeadFileJoining (the far bake waits for a piece on its way)', () => {
  it('a file on the wire, or landed and still linking, is on its way', () => {
    expect(wocHeadFileJoining('loading')).toBe(true);
  });

  it('a file that is there, or that failed, is not', () => {
    expect(wocHeadFileJoining('resident')).toBe(false);
    expect(wocHeadFileJoining('failed')).toBe(false);
  });

  it('a file nobody asked for is not on its way: a far bake never waits on a fetch that was not started', () => {
    expect(wocHeadFileJoining('idle')).toBe(false);
  });
});
