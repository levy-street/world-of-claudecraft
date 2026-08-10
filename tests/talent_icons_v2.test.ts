import { describe, expect, it } from 'vitest';
import {
  ROW_TREES,
  type SpecDef,
  TALENTS,
  type TalentRowOption,
  talentsFor,
} from '../src/sim/content/talents';
import { hasAbilityIconIdentity, iconDataUrl, storePrewarmedIconDataUrl } from '../src/ui/icons';
import {
  type TalentSpecIconRef,
  talentRowOptionIconRef,
  talentSpecIconCssBackground,
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

  it('honors every authored painted choice-row icon before effect-shape inference', () => {
    const authored = Object.values(ROW_TREES)
      .flat()
      .flatMap((row) => row.options)
      .filter((option) => option.icon !== undefined);

    expect(authored).toHaveLength(144);
    for (const option of authored) {
      expect(hasAbilityIconIdentity(option.icon ?? ''), `${option.id} painted icon`).toBe(true);
      expect(talentRowOptionIconRef(option), option.id).toEqual({
        kind: 'ability',
        id: option.icon,
      });
    }
  });

  it('falls back to effect-shape inference when an authored option icon is present but invalid', () => {
    const invalid = {
      ...warriorOption('war_row_die_by_the_sword'),
      icon: 'missing_painted_talent_icon',
    } satisfies TalentRowOption;

    expect(hasAbilityIconIdentity(invalid.icon)).toBe(false);
    expect(talentRowOptionIconRef(invalid)).toEqual({ kind: 'ability', id: 'die_by_sword' });
  });

  it('keeps reworked classic lanes on their current source abilities', () => {
    const classicOptions = Object.values(ROW_TREES)
      .flat()
      .flatMap((row) => row.options);
    for (const [optionId, abilityId] of [
      ['wlk_r14_ruin', 'searing_pain'],
      ['wlk_r17_demonic_resilience', 'drain_life'],
      ['sha_r17_elemental_warding', 'healing_wave'],
    ] as const) {
      const option = classicOptions.find((candidate) => candidate.id === optionId);
      expect(option?.icon, optionId).toBe(abilityId);
      expect(option && talentRowOptionIconRef(option), optionId).toEqual({
        kind: 'ability',
        id: abilityId,
      });
    }
  });

  it('uses dedicated painted art for every live specialization', () => {
    for (const talents of Object.values(TALENTS)) {
      for (const liveSpec of talents.specs) {
        expect(talentSpecIconRef(liveSpec)).toEqual({
          kind: 'image',
          url: `/ui/specs/${liveSpec.class}/${liveSpec.id}.webp`,
          fallback: { kind: 'ability', id: liveSpec.signature },
        });
        expect(talentSpecIconCssBackground(talentSpecIconRef(liveSpec))).toBe(
          `url(/ui/specs/${liveSpec.class}/${liveSpec.id}.webp),url(/ui/skills/${liveSpec.class}/${liveSpec.signature}.webp)`,
        );
      }
    }
  });

  it('maps Charge modifiers and Combat Mastery to their exact authored icons', () => {
    // Frozen option id, new content: the level-5 row grants Intervene now, so its
    // icon resolves through the granted ability rather than the old modifier art.
    expect(talentRowOptionIconRef(warriorOption('war_row_double_charge'))).toEqual({
      kind: 'ability',
      id: 'intervene',
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

  it('uses normalized WebP art for all three Mage specs', () => {
    for (const id of ['arcane', 'fire', 'frost']) {
      expect(talentSpecIconRef(spec('mage', id))).toEqual({
        kind: 'image',
        url: `/ui/specs/mage/${id}.webp`,
        fallback: { kind: 'ability', id: spec('mage', id).signature },
      });
    }
  });

  it('preserves the signature fallback for a synthetic unregistered spec', () => {
    const rogue = spec('rogue');
    const synthetic = { ...rogue, id: 'unpainted_spec' } satisfies SpecDef;
    expect(talentSpecIconRef(synthetic)).toEqual({ kind: 'ability', id: rogue.signature });
    expect(talentSpecIconCssBackground(talentSpecIconRef(synthetic))).toBe(
      `url(${iconDataUrl('ability', rogue.signature)})`,
    );
  });

  it('keeps the spec glyph as the final fallback when the signature is unknown', () => {
    const fallbackSpec = {
      ...spec('rogue'),
      id: 'unpainted_spec',
      signature: 'missing_signature',
      icon: 'R',
    } satisfies SpecDef;
    expect(talentSpecIconRef(fallbackSpec)).toEqual<TalentSpecIconRef>({
      kind: 'text',
      text: 'R',
    });
    expect(talentSpecIconCssBackground(talentSpecIconRef(fallbackSpec))).toBeNull();
  });

  it('keeps painted spec art over a generic crest when its signature is unknown', () => {
    const genericFallback = 'data:image/png;base64,prewarmed-talent-choice';
    storePrewarmedIconDataUrl('crest', 'talent_choice', 96, genericFallback);
    const fallbackSpec = {
      ...spec('rogue'),
      signature: 'missing_signature',
    } satisfies SpecDef;
    const ref = talentSpecIconRef(fallbackSpec);

    expect(ref).toEqual<TalentSpecIconRef>({
      kind: 'image',
      url: `/ui/specs/${fallbackSpec.class}/${fallbackSpec.id}.webp`,
      fallback: { kind: 'crest', id: 'talent_choice' },
    });
    expect(talentSpecIconCssBackground(ref)).toBe(
      `url(/ui/specs/${fallbackSpec.class}/${fallbackSpec.id}.webp),url(${genericFallback})`,
    );
  });
});
