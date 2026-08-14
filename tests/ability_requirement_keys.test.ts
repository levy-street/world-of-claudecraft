// Truth table for the requirement-line resolver
// (src/ui/hud/action_bar/ability_requirement_keys.ts), pinning the spec scoping
// of the stealth line: the Gloam / Shadow Veil bypass is Skulduggery-only aura
// state, so ONLY spec 'subtlety' reads the extended line. Every other rogue
// spec, an unspecced rogue, and a stalking druid read the plain requirement
// (owner ruling 2026-07-29: a tooltip never shows another spec's mechanics).

import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers } from '../src/sim/content/talents';
import { ABILITIES } from '../src/sim/data';
import { abilityRequirementKeys } from '../src/ui/hud/action_bar/ability_requirement_keys';

function stealthKey(abilityId: string, spec: string | null): string | undefined {
  return abilityRequirementKeys(ABILITIES[abilityId], spec).find((r) =>
    r.key.startsWith('requiresStealth'),
  )?.key;
}

/** Gut Punch as the real talent bake produces it: the row-11 option is selected
 *  through the live allocation, never a hand-built modifier bag. */
function knownCheapShot(rowOption: string) {
  const mods = computeTalentModifiers('rogue', { spec: null, rows: { 11: rowOption } }, 20);
  const known = abilitiesKnownAt('rogue', 20, mods).find((k) => k.def.id === 'cheap_shot');
  if (!known) throw new Error('cheap_shot missing from the resolved rogue kit at level 20');
  return known;
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

describe('abilityRequirementKeys: Cheap Trick drops the stealth line', () => {
  // The rogue row talent bakes ignoreStealthRequirement onto the RESOLVED
  // ability, and the sim's cast gate honors it. A tooltip still printing
  // "Requires stealth" is then stating a limit the ability no longer has, which
  // is exactly what docs/design/tooltip-writing.md forbids.
  const RESOLVED_IGNORING = { ignoreStealthRequirement: true };

  it('suppresses the plain stealth line on the resolved Gut Punch', () => {
    expect(
      abilityRequirementKeys(ABILITIES.cheap_shot, 'assassination', RESOLVED_IGNORING).some((r) =>
        r.key.startsWith('requiresStealth'),
      ),
    ).toBe(false);
  });

  it('suppresses the Skulduggery bypass line too, since nothing is left to bypass', () => {
    expect(
      abilityRequirementKeys(ABILITIES.cheap_shot, 'subtlety', RESOLVED_IGNORING).some((r) =>
        r.key.startsWith('requiresStealth'),
      ),
    ).toBe(false);
  });

  it('leaves every other requirement line on the ability untouched', () => {
    const withTalent = abilityRequirementKeys(
      ABILITIES.cheap_shot,
      'assassination',
      RESOLVED_IGNORING,
    ).map((r) => r.key);
    const without = abilityRequirementKeys(ABILITIES.cheap_shot, 'assassination').map((r) => r.key);
    expect(without).toContain('requiresStealth');
    expect(withTalent).toEqual(without.filter((key) => key !== 'requiresStealth'));
  });

  it('an untalented resolve, and an absent one, keep the stealth line', () => {
    expect(stealthKey('cheap_shot', 'assassination')).toBe('requiresStealth');
    expect(
      abilityRequirementKeys(ABILITIES.cheap_shot, 'assassination', {
        ignoreStealthRequirement: false,
      }).some((r) => r.key.startsWith('requiresStealth')),
    ).toBe(true);
  });

  // End to end from the real talent row, so the pin fails if the flag ever stops
  // reaching the resolve rather than only if this resolver regresses.
  it('the real Cheap Trick allocation resolves to a Gut Punch with no stealth line', () => {
    const resolved = knownCheapShot('rog_r11_cheap_trick');
    expect(resolved.ignoreStealthRequirement).toBe(true);
    expect(
      abilityRequirementKeys(resolved.def, 'assassination', resolved).some((r) =>
        r.key.startsWith('requiresStealth'),
      ),
    ).toBe(false);
  });

  it('a sibling row option on the same tier leaves the stealth line in place', () => {
    const resolved = knownCheapShot('rog_r11_foul_play');
    expect(resolved.ignoreStealthRequirement).toBeFalsy();
    expect(
      abilityRequirementKeys(resolved.def, 'assassination', resolved).map((r) => r.key),
    ).toContain('requiresStealth');
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
