import { describe, expect, it } from 'vitest';
import {
  HUNTER_CHOICE_ROWS,
  PRIEST_CHOICE_ROWS,
  SHAMAN_CHOICE_ROWS,
} from '../src/sim/content/choice_rows_classic';
import { HUNTER_TALENTS, PRIEST_TALENTS, SHAMAN_TALENTS } from '../src/sim/content/talents_classic';
import { ABILITIES } from '../src/sim/data';
import { classAbilityNamesEn } from '../src/ui/i18n.catalog/abilities';

const OWNED_CLASSES = new Set(['hunter', 'shaman', 'priest']);
const VAGUE_ABILITY_COPY =
  /primary wound|calculated (?:healing|before overhealing)|become unsafe|valid .* impacts|normal rotation|\bnearby\b|\brecently affected\b|\bempowers? it\b/i;
const VAGUE_TALENT_COPY =
  /spec relationships?|specialization-specific throughput|selected specialization spirit|^Grants [^.]+\.$|Focus generator|\bnearby\b|specialization resource|full (?:payoff|vent)/i;

describe('owned-class English tooltip clarity', () => {
  it('keeps the rendered English catalog in sync with canonical ability copy', () => {
    const rendered = classAbilityNamesEn.entities.abilities;
    const canonicalPlaceholders = (description: string) =>
      description
        .replaceAll('{damage}', '$d')
        .replaceAll('{overTime}', '$o')
        .replaceAll('{buff}', '$b')
        .replaceAll('{duration}', '$t')
        .replaceAll('{healing}', '$h')
        .replaceAll('{hostilePveDuration}', '$e')
        .replaceAll('{hostilePvpDuration}', '$p')
        .replaceAll('{groundDuration}', '$g')
        .replaceAll('{selfCooldownRecovery}', '$s')
        .replaceAll('{allyCooldownRecovery}', '$a');
    const failures = Object.values(ABILITIES)
      .filter((ability) => OWNED_CLASSES.has(ability.class))
      .filter((ability) => rendered[ability.id])
      .filter(
        (ability) =>
          canonicalPlaceholders(rendered[ability.id].description) !== ability.description,
      )
      .map(
        (ability) =>
          `${ability.id}: catalog="${canonicalPlaceholders(rendered[ability.id].description)}" source="${ability.description}"`,
      );

    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('does not hide spell rules behind vague implementation language', () => {
    const failures = Object.values(ABILITIES)
      .filter((ability) => OWNED_CLASSES.has(ability.class))
      .filter((ability) => VAGUE_ABILITY_COPY.test(ability.description))
      .map((ability) => `${ability.id}: ${ability.description}`);

    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('explains granted actions and spec-specific talent outcomes', () => {
    const failures = [HUNTER_CHOICE_ROWS, SHAMAN_CHOICE_ROWS, PRIEST_CHOICE_ROWS]
      .flatMap((tree) => tree.rows)
      .flatMap((row) => row.options)
      .filter((option) => VAGUE_TALENT_COPY.test(option.description))
      .map((option) => `${option.id}: ${option.description}`);

    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('names the scaling stat on owned-class damage, healing, and absorb actions', () => {
    const scalingCopy: Record<string, RegExp> = {
      serpent_sting: /Ranged Attack Power/,
      arcane_shot: /Ranged Attack Power/,
      concussive_shot: /Ranged Attack Power/,
      wing_clip: /Attack Power/,
      volley: /Ranged Attack Power/,
      lightning_bolt: /Spell Power/,
      healing_wave: /Spell Power/,
      earth_shock: /Spell Power/,
      flame_shock: /Spell Power/,
      frost_shock: /Spell Power/,
      smite: /Spell Power/,
      lesser_heal: /Spell Power/,
      shadow_word_pain: /Spell Power/,
      renew: /Spell Power/,
      heal: /Spell Power/,
      mind_flay: /Spell Power/,
      flash_heal: /Spell Power/,
      prayer_of_healing: /Spell Power/,
      choir_of_deliverance: /Spell Power/,
    };
    const failures = Object.entries(scalingCopy)
      .filter(([id, pattern]) => !pattern.test(ABILITIES[id]?.description ?? ''))
      .map(([id]) => `${id}: ${ABILITIES[id]?.description ?? 'missing ability'}`);

    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('states hidden ranges, limits, and lockouts on owned-class utility', () => {
    expect(ABILITIES.veilstep.description).toMatch(/10 yards/);
    expect(ABILITIES.psychic_scream.description).toMatch(/8 yards/);
    expect(ABILITIES.prayer_of_healing.description).toMatch(/30 yards/);
    expect(ABILITIES.choir_of_deliverance.description).toMatch(/30 yards/);
    expect(ABILITIES.bloodlust.description).toMatch(/10 min/);
    expect(ABILITIES.counter_shot.description).not.toMatch(/talent/i);
  });

  it('keeps spec masteries honest about the abilities they modify', () => {
    const ownedSpecs = [HUNTER_TALENTS, SHAMAN_TALENTS, PRIEST_TALENTS].flatMap(
      (tree) => tree.specs,
    );
    expect(ownedSpecs).toHaveLength(9);
    expect(
      SHAMAN_TALENTS.specs.find((spec) => spec.id === 'restoration')?.mastery.description,
    ).toBe('Mending Waters and Cascading Mend cost 20% less Mana.');
  });
});
