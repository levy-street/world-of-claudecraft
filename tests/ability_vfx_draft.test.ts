import { describe, expect, it } from 'vitest';
import {
  parseAbilityVfxDraftPack,
  validAbilityVfxDraft,
} from '../src/render/ability_vfx_draft_core';
import {
  abilityVfxFullSpec,
  abilityVfxSpec,
  setAbilityVfxDraft,
} from '../src/render/ability_vfx_registry';

describe('shared VFX authoring drafts', () => {
  const draft = { tint: '#237d91', accent: '#dcefff', power: 1.2, sparks: 12 };
  it.each([
    { tint: 'red' },
    { tint: '#12345g' },
    { accent: '#abc' },
    { power: 0.24 },
    { power: 2.01 },
    { sparks: -1 },
    { sparks: 61 },
    { sparks: 1.5 },
    { sparks: '12' },
  ])('rejects an independently invalid draft field %j', (bad) => {
    expect(validAbilityVfxDraft({ ...draft, ...bad })).toBe(false);
  });
  it('validates schema, record count, identifier and text size boundaries', () => {
    const pack = { format: 'woc-vfx-draft', version: 1, abilities: { chain_heal: draft } };
    for (const invalid of [
      { ...pack, format: 'other' },
      { ...pack, version: 2 },
      { ...pack, abilities: [] },
      { ...pack, abilities: { 'invalid.id': draft } },
      {
        ...pack,
        abilities: Object.fromEntries(
          Array.from({ length: 513 }, (_, i) => [`ability_${i}`, draft]),
        ),
      },
    ]) {
      expect(parseAbilityVfxDraftPack(JSON.stringify(invalid))).toBeNull();
    }
    expect(parseAbilityVfxDraftPack(JSON.stringify(pack).padEnd(256001, ' '))).toBeNull();
    expect(parseAbilityVfxDraftPack(JSON.stringify(pack).padEnd(256000, ' '))).not.toBeNull();
    expect(
      parseAbilityVfxDraftPack(
        JSON.stringify({
          ...pack,
          abilities: Object.fromEntries(
            Array.from({ length: 512 }, (_, i) => [`ability_${i}`, draft]),
          ),
        }),
      ),
    ).not.toBeNull();
    expect(validAbilityVfxDraft({ ...draft, power: 0.25, sparks: 0 })).toBe(true);
    expect(validAbilityVfxDraft({ ...draft, power: 2, sparks: 60 })).toBe(true);
  });
  it('changes both runtime projections without changing shipping definitions', () => {
    const base = abilityVfxFullSpec('chain_heal');
    expect(setAbilityVfxDraft('chain_heal', draft)).toBe(true);
    expect(abilityVfxFullSpec('chain_heal')?.power).toBe(1.2);
    expect(abilityVfxSpec('chain_heal')?.c).toBe('#237d91');
    expect(abilityVfxFullSpec('chain_heal')?.accent).toBe('#dcefff');
    expect(abilityVfxFullSpec('chain_heal')?.impact?.sparks).toBe(12);
    expect(abilityVfxSpec('chain_heal')?.pw).toBe(1.2);
    expect(abilityVfxSpec('chain_heal')?.sp).toBe(12);
    expect(abilityVfxFullSpec('chain_heal')).toBe(abilityVfxFullSpec('chain_heal'));
    expect(base?.motifs).not.toContain('chains');
    setAbilityVfxDraft('chain_heal', null);
    expect(abilityVfxFullSpec('chain_heal')).toBe(base);
  });
  it('rejects invalid shapes, executable fields, unknown IDs and unbounded values', () => {
    expect(validAbilityVfxDraft({ ...draft, power: Infinity })).toBe(false);
    expect(validAbilityVfxDraft({ ...draft, code: 'evil' })).toBe(false);
    expect(setAbilityVfxDraft('missing', draft)).toBe(false);
    expect(setAbilityVfxDraft('constructor', draft)).toBe(false);
    expect(setAbilityVfxDraft('__proto__', draft)).toBe(false);
    expect(parseAbilityVfxDraftPack('{')).toBeNull();
    expect(
      parseAbilityVfxDraftPack(
        JSON.stringify({ format: 'woc-vfx-draft', version: 1, abilities: { chain_heal: draft } }),
      )?.abilities.chain_heal,
    ).toEqual(draft);
  });
});
