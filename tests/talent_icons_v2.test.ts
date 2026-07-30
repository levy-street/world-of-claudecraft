import { describe, expect, it } from 'vitest';
import { ROW_TREES, type SpecDef, talentsFor } from '../src/sim/content/talents';
import {
  type TalentSpecIconRef,
  talentRowOptionIconRef,
  talentSpecIconRef,
} from '../src/ui/talent_icons';

describe('Talents V2 icon routing', () => {
  const warriorOption = (id: string) => {
    const option = ROW_TREES.warrior
      .flatMap((row) => row.options)
      .find((candidate) => candidate.id === id);
    if (!option) throw new Error(`Missing Warrior row option: ${id}`);
    return option;
  };

  const spec = (cls: 'warrior' | 'mage' | 'rogue', specId?: string): SpecDef => {
    const talents = talentsFor(cls);
    const found = specId
      ? talents?.specs.find((candidate) => candidate.id === specId)
      : talents?.specs[0];
    if (!found) throw new Error(`Missing ${cls} spec${specId ? `: ${specId}` : ''}`);
    return found;
  };

  it('routes row-granted abilities through the shared ability icon pipeline', () => {
    const option = ROW_TREES.warrior[1].options[1];
    expect(option.id).toBe('war_row_die_by_the_sword');
    expect(talentRowOptionIconRef(option)).toEqual({ kind: 'ability', id: 'die_by_sword' });
  });

  it('uses authored Warrior spec art only for the stable Warrior id', () => {
    const fury = spec('warrior', 'fury');
    expect(talentSpecIconRef(fury)).toEqual({
      kind: 'image',
      url: '/ui/specs/warrior/fury.webp',
    });
  });

  it('maps Charge modifiers and Combat Mastery to their exact authored icons', () => {
    expect(talentRowOptionIconRef(warriorOption('war_row_double_charge'))).toEqual({
      kind: 'ability',
      id: 'double_charge',
    });
    expect(talentRowOptionIconRef(warriorOption('war_row_crushing_charge'))).toEqual({
      kind: 'ability',
      id: 'crushing_charge',
    });
    expect(talentRowOptionIconRef(warriorOption('war_row_blood_offering'))).toEqual({
      kind: 'ability',
      id: 'combat_mastery',
    });
  });

  it('uses the authored Mage spec panel art for all three mage specs', () => {
    for (const id of ['arcane', 'fire', 'frost']) {
      expect(talentSpecIconRef(spec('mage', id))).toEqual({
        kind: 'image',
        url: `/ui/specs/mage/${id}.png`,
      });
    }
  });

  it('falls back to a procedural signature icon for classes without authored spec art', () => {
    const rogue = spec('rogue');
    expect(talentSpecIconRef(rogue)).toEqual({ kind: 'ability', id: rogue.signature });
  });

  it('keeps the spec glyph as the final fallback when the signature is unknown', () => {
    const fallbackSpec = {
      ...spec('rogue'),
      signature: 'missing_signature',
      icon: 'R',
    } satisfies SpecDef;
    expect(talentSpecIconRef(fallbackSpec)).toEqual<TalentSpecIconRef>({
      kind: 'text',
      text: 'R',
    });
  });
});
