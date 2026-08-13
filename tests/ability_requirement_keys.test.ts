// Truth table for the requirement-line resolver
// (src/ui/hud/action_bar/ability_requirement_keys.ts), pinning the spec scoping
// of the stealth line: the Gloam / Shadow Veil bypass is Skulduggery-only aura
// state, so ONLY spec 'subtlety' reads the extended line. Every other rogue
// spec, an unspecced rogue, and a stalking druid read the plain requirement
// (owner ruling 2026-07-29: a tooltip never shows another spec's mechanics).

import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import { abilityRequirementKeys } from '../src/ui/hud/action_bar/ability_requirement_keys';

function stealthKey(abilityId: string, spec: string | null): string | undefined {
  return abilityRequirementKeys(ABILITIES[abilityId], spec).find((r) =>
    r.key.startsWith('requiresStealth'),
  )?.key;
}

describe('abilityRequirementKeys: the stealth line is spec-scoped', () => {
  const ROGUE_OPENERS = ['ambush', 'garrote', 'cheap_shot'];

  it('Skulduggery reads the Gloam / Shadow Veil bypass on every stealth opener', () => {
    for (const id of ROGUE_OPENERS) {
      expect(stealthKey(id, 'subtlety'), id).toBe('requiresStealthSkulduggery');
    }
  });

  it('the other rogue specs and an unspecced rogue read a plain stealth line', () => {
    for (const spec of ['assassination', 'combat', null]) {
      for (const id of ROGUE_OPENERS) {
        expect(stealthKey(id, spec), `${id} for ${spec}`).toBe('requiresStealth');
      }
    }
  });

  it('a druid stealth opener never mentions the rogue bypass, any spec', () => {
    for (const spec of ['feral', 'subtlety', null]) {
      expect(stealthKey('pounce', spec), `pounce for ${spec}`).toBe('requiresStealth');
    }
  });

  it('a non-stealth ability carries no stealth line at all', () => {
    expect(stealthKey('eviscerate', 'subtlety')).toBeUndefined();
  });
});

describe('abilityRequirementKeys: the moved truth table holds', () => {
  it('keeps the pre-extraction line order for a finisher (combo before target)', () => {
    expect(abilityRequirementKeys(ABILITIES.eviscerate, null).map((r) => r.key)).toEqual([
      'requiresCombo',
      'enemyTarget',
    ]);
  });

  it('resolves form, swing, and percent params as before', () => {
    const maul = abilityRequirementKeys(ABILITIES.maul, 'feral');
    expect(maul.find((r) => r.key === 'requiresForm')?.form).toBe('bear');
    expect(maul.some((r) => r.key === 'onNextSwing')).toBe(true);
  });
});
