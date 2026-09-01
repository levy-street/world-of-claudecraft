// The node-name facts of a composed part, and the merge partition derived from
// them. Both halves are load bearing and both fail silently: a wrong fact
// repaints a part (lipstick on an ear), a wrong partition folds two parts the
// recolour sweep reads differently into one mesh with one name.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MODULAR_HEAD_NODES,
  modularMergePartition,
  modularNameFacts,
} from '../src/render/characters/modular_name_facts_core';
import { headNodeName } from '../src/render/characters/stubble';

describe('modularNameFacts', () => {
  it('names the two head sculpts, and nothing else', () => {
    expect(modularNameFacts('M_Head').head).toBe(true);
    expect(modularNameFacts('F_Head').head).toBe(true);
    expect(modularNameFacts('M_Ear_round').head).toBe(false);
    expect(modularNameFacts('Armor_knight_Head').head).toBe(false);
  });

  it('agrees with the live head lookup the decals use', () => {
    // stubble.ts owns headNodeName (it needs three); this core has to stay
    // three-free, so the two lists are pinned to each other here.
    expect([...MODULAR_HEAD_NODES].sort()).toEqual(
      [headNodeName('male'), headNodeName('female')].sort(),
    );
  });

  it('matches the mouth on its stem, through GLTFLoader primitive suffixes', () => {
    // A multi-primitive part arrives as a Group whose children are named after
    // the mesh datablock, so the whole-name test would miss the lips.
    expect(modularNameFacts('M_Mouth_neutral').mouth).toBe(true);
    expect(modularNameFacts('M_Mouth_neutral_1').mouth).toBe(true);
    expect(modularNameFacts('F_Mouth_grin_0').mouth).toBe(true);
    expect(modularNameFacts('M_Head').mouth).toBe(false);
  });

  it('separates a hair band from the earrings it shares an atlas with', () => {
    const band = modularNameFacts('E2_band_highpony');
    expect(band.jewel).toBe(true);
    expect(band.band).toBe(true);
    const hoop = modularNameFacts('E2_hoop');
    expect(hoop.jewel).toBe(true);
    expect(hoop.band).toBe(false);
    expect(modularNameFacts('Armor_knight_Chest').jewel).toBe(false);
  });
});

describe('modularMergePartition', () => {
  it('never lets the head merge with anything, itself included', () => {
    // The head's geometry is the identity the decal cuts are cached on and the
    // canonical bind space of the shared skeleton.
    expect(modularMergePartition('M_Head')).toBe('head');
    expect(modularMergePartition('F_Head')).toBe('head');
    expect(modularMergePartition('M_Ear_round')).not.toBe('head');
  });

  it('keeps the mouth lips off the skin parts they share a material with', () => {
    // `mod_skin` is on the head, the ears AND the mouth's lip body; only the
    // lips take lipstick.
    expect(modularMergePartition('M_Mouth_neutral_0')).toBe('mouth');
    expect(modularMergePartition('M_Ear_round')).toBe('part');
  });

  it('keeps a band, an earring and an armour piece on the knight atlas apart', () => {
    expect(modularMergePartition('E2_band_topknot')).toBe('band');
    expect(modularMergePartition('E2_hoop')).toBe('jewel');
    expect(modularMergePartition('Armor_knight_Chest')).toBe('part');
  });

  it('leaves the body and hair parts free to merge', () => {
    const body = ['M_Torso', 'M_ArmL', 'M_ArmR', 'M_HandL', 'M_LegR', 'M_FootL'];
    for (const name of body) expect(modularMergePartition(name)).toBe('part');
    for (const name of ['M_Brow_soft', 'H2_layered', 'BI_goatee']) {
      expect(modularMergePartition(name)).toBe('part');
    }
  });

  it('is what the composed merge is actually keyed on', () => {
    // A partition that nothing passes to mergeSkinnedParts protects nothing.
    const assets = readFileSync(
      new URL('../src/render/characters/assets.ts', import.meta.url),
      'utf8',
    );
    expect(assets).toMatch(/partitionKey: \(mesh\) => modularMergePartition\(mesh\.name\)/);
    expect(assets).toMatch(/modularNameFacts\(mesh\.name\)/);
  });
});
