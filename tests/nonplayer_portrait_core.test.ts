import { describe, expect, it, vi } from 'vitest';
import { npcPortraitSourceFor } from '../src/render/characters/manifest';
import { MOBS } from '../src/sim/data';
import {
  FACE_PORTRAIT_SKIN,
  type FacePortraitLookup,
  type NonPlayerPortraitSubject,
  nonPlayerPortraitSubject,
  nonPlayerPortraitUpdateFrames,
} from '../src/ui/nonplayer_portrait_core';

// What a frame holding a non-player draws, and which landed capture repaints
// it. The regression this pins: every world NPC moved onto a class body with a
// face of its own, and the target frame kept drawing the generic lantern crest.

type Head = { face: string };
const TAM_HEAD: Head = { face: 'tam' };
const BRAM_HEAD: Head = { face: 'bram' };

/** A lookup with a fixed table, keyed the way the real one is asked. */
function lookup(table: Record<string, { visualKey: string; head: Head }>) {
  return vi.fn<FacePortraitLookup<Head>>((id, kind) => table[`${kind}:${id}`] ?? null);
}

describe('nonPlayerPortraitSubject', () => {
  it('shows an NPC with an authored look its own face, the NPC crest as its fallback', () => {
    const faceFor = lookup({ 'npc:warden_tam': { visualKey: 'player_warrior', head: TAM_HEAD } });
    const subject = nonPlayerPortraitSubject({ templateId: 'warden_tam', kind: 'npc' }, faceFor);
    expect(subject).toEqual({
      kind: 'face',
      crestId: 'status_npc',
      visualKey: 'player_warrior',
      head: TAM_HEAD,
    });
    // the head is handed through by reference: the portrait lane keys on it
    expect((subject as { head: Head }).head).toBe(TAM_HEAD);
    expect(faceFor).toHaveBeenCalledWith('warden_tam', 'npc');
  });

  it('keeps the crest for an NPC with no look', () => {
    expect(
      nonPlayerPortraitSubject({ templateId: 'no_such_npc', kind: 'npc' }, lookup({})),
    ).toEqual({ kind: 'crest', crestId: 'status_npc' });
  });

  it('keeps committed art, and the family crest behind it, for an ordinary mob', () => {
    expect(MOBS.forest_wolf.family).toBe('beast');
    expect(
      nonPlayerPortraitSubject({ templateId: 'forest_wolf', kind: 'mob' }, lookup({})),
    ).toEqual({ kind: 'art', crestId: 'family_beast', url: '/ui/mobs/forest_wolf.webp' });
  });

  it('lets a look win over committed art for a mob that wears one', () => {
    const faceFor = lookup({ 'mob:fisher_bram': { visualKey: 'player_rogue', head: BRAM_HEAD } });
    expect(MOBS.fisher_bram).toBeDefined();
    expect(nonPlayerPortraitSubject({ templateId: 'fisher_bram', kind: 'mob' }, faceFor)).toEqual({
      kind: 'face',
      crestId: `family_${MOBS.fisher_bram.family ?? 'humanoid'}`,
      visualKey: 'player_rogue',
      head: BRAM_HEAD,
    });
  });

  it('asks for the look by entity KIND, so a mob sharing an NPC id keeps its art', () => {
    // Sexton Marrow is a living NPC and an undead encounter under one id.
    const faceFor = lookup({ 'npc:sexton_marrow': { visualKey: 'player_priest', head: TAM_HEAD } });
    const asMob = nonPlayerPortraitSubject({ templateId: 'sexton_marrow', kind: 'mob' }, faceFor);
    expect(faceFor).toHaveBeenLastCalledWith('sexton_marrow', 'mob');
    expect(asMob).toMatchObject({ kind: 'art', url: '/ui/mobs/sexton_marrow.webp' });
    const asNpc = nonPlayerPortraitSubject({ templateId: 'sexton_marrow', kind: 'npc' }, faceFor);
    expect(asNpc).toMatchObject({ kind: 'face', crestId: 'status_npc' });
  });

  it('leaves a transient guardian on the art and family of the body it borrows', () => {
    const subject = nonPlayerPortraitSubject(
      { templateId: 'guardian_stampede_1', kind: 'mob' },
      lookup({}),
    );
    expect(MOBS.guardian_stampede_1).toBeUndefined();
    expect(subject).toEqual({
      kind: 'art',
      crestId: `family_${MOBS.wild_boar.family}`,
      url: '/ui/mobs/wild_boar.webp',
    });
  });

  it('resolves the shipped roster through the real lookup: Warden Tam has a face', () => {
    const source = npcPortraitSourceFor('warden_tam', 'npc');
    expect(source).not.toBeNull();
    expect(
      nonPlayerPortraitSubject({ templateId: 'warden_tam', kind: 'npc' }, npcPortraitSourceFor),
    ).toEqual({
      kind: 'face',
      crestId: 'status_npc',
      visualKey: source?.visualKey,
      head: source?.head,
    });
    expect(
      nonPlayerPortraitSubject({ templateId: 'sexton_marrow', kind: 'mob' }, npcPortraitSourceFor),
    ).toMatchObject({ kind: 'art' });
  });
});

describe('nonPlayerPortraitUpdateFrames', () => {
  const face: NonPlayerPortraitSubject<Head> = {
    kind: 'face',
    crestId: 'status_npc',
    visualKey: 'player_warrior',
    head: TAM_HEAD,
  };
  const own = { visualKey: 'player_warrior', skin: FACE_PORTRAIT_SKIN };

  it('matches the keyless capture of the body the face is drawn on', () => {
    expect(FACE_PORTRAIT_SKIN).toBe(0);
    expect(nonPlayerPortraitUpdateFrames(face, own)).toBe(true);
  });

  it('rejects another body, another skin, and a composed capture, one field at a time', () => {
    expect(nonPlayerPortraitUpdateFrames(face, { ...own, visualKey: 'player_mage' })).toBe(false);
    expect(nonPlayerPortraitUpdateFrames(face, { ...own, skin: 1 })).toBe(false);
    expect(nonPlayerPortraitUpdateFrames(face, { ...own, key: 'player_warrior:mod:x' })).toBe(
      false,
    );
  });

  it('never repaints a frame showing art or a crest: neither waits on a capture', () => {
    const art: NonPlayerPortraitSubject<Head> = { kind: 'art', crestId: 'family_beast', url: '/a' };
    const crest: NonPlayerPortraitSubject<Head> = { kind: 'crest', crestId: 'status_npc' };
    expect(nonPlayerPortraitUpdateFrames(art, own)).toBe(false);
    expect(nonPlayerPortraitUpdateFrames(crest, own)).toBe(false);
  });
});
