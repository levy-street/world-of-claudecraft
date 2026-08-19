import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import type { ResolvedAbility } from '../src/sim/sim';
import type { AbilityDef, Entity } from '../src/sim/types';
import {
  abilityCastLine,
  abilityRangeLine,
  abilityRequirementLines,
  describeAbilitySummary,
  playerSpellHasteFrac,
  resourceDisplayName,
} from '../src/ui/ability_tooltip_lines';

// Direct pins for the pure ability-tooltip line builders extracted from
// hud.ts (the Phase 10 headroom extraction). Before the move these lines were
// only reachable through the DOM-bound Hud, so none of them had a direct
// test; each arm here exercises a REAL ability def so the pins track content
// changes rather than a hand-rolled fixture drifting on its own.

function resolved(def: AbilityDef, over: Partial<ResolvedAbility> = {}): ResolvedAbility {
  return {
    def,
    rank: 1,
    cost: def.cost ?? 0,
    castTime: def.castTime ?? 0,
    cooldown: def.cooldown ?? 0,
    effects: [],
    threatFlat: 0,
    threatMult: 1,
    ...over,
  };
}

describe('describeAbilitySummary', () => {
  it('joins cost, cast and cooldown for a known casted ability', () => {
    // Fireball: 30 mana, 1.5 sec cast, no cooldown (src/sim/content/classes.ts).
    const line = describeAbilitySummary(resolved(ABILITIES.fireball), 'mana');
    expect(line).toBe('30 Mana · 1.5 sec cast');
  });

  it('appends the RESOLVED cooldown after the cast line', () => {
    const line = describeAbilitySummary(resolved(ABILITIES.fireball, { cooldown: 8 }), 'mana');
    expect(line).toBe('30 Mana · 1.5 sec cast · 8 sec cooldown');
  });

  it('drops the cost part when the resolve zeroed the cost', () => {
    const line = describeAbilitySummary(resolved(ABILITIES.fireball, { cost: 0 }), 'mana');
    expect(line).toBe('1.5 sec cast');
  });
});

describe('abilityCastLine', () => {
  it('renders Instant for a zero cast time and the seconds for a timed cast', () => {
    expect(abilityCastLine(resolved(ABILITIES.fireball, { castTime: 0 }))).toBe('Instant');
    expect(abilityCastLine(resolved(ABILITIES.fireball))).toBe('1.5 sec cast');
  });

  it('shortens the shown cast by the live spell-haste fraction, flooring negatives at 0', () => {
    // 1.5 / (1 + 0.5) = 1: the tooltip must agree with the sim's hasted cast.
    expect(abilityCastLine(resolved(ABILITIES.fireball), 0.5)).toBe('1 sec cast');
    // A net-negative haste floors at 0 exactly like the sim's spellHasteMult.
    expect(abilityCastLine(resolved(ABILITIES.fireball), -0.5)).toBe('1.5 sec cast');
  });
});

describe('abilityRangeLine', () => {
  it('renders the yd range for a ranged def and null for a melee/self def', () => {
    expect(abilityRangeLine(ABILITIES.fireball)).toBe('30 yd range');
    expect(abilityRangeLine({ ...ABILITIES.fireball, range: 0 })).toBeNull();
  });

  it('renders the min-max form when the def carries a minRange', () => {
    expect(abilityRangeLine({ ...ABILITIES.fireball, minRange: 8 })).toBe('8-30 yd range');
  });
});

describe('abilityRequirementLines', () => {
  it('renders the stealth requirement for a stealth-opener def', () => {
    expect(abilityRequirementLines(ABILITIES.ambush)).toContain('Requires stealth');
  });

  it('retires the stealth line when the resolve ignores the requirement (Cheap Trick)', () => {
    const lines = abilityRequirementLines(ABILITIES.ambush, null, {
      ignoreStealthRequirement: true,
    });
    expect(lines).not.toContain('Requires stealth');
  });

  it('renders no lines for a plain unconditional ability', () => {
    expect(abilityRequirementLines(ABILITIES.fireball)).not.toContain('Requires stealth');
  });
});

describe('playerSpellHasteFrac', () => {
  it('sums the resolved stat with buff_spellhaste auras and floors at 0', () => {
    expect(playerSpellHasteFrac(null)).toBe(0);
    expect(playerSpellHasteFrac(undefined)).toBe(0);
    const p = {
      spellHaste: 0.1,
      auras: [
        { kind: 'buff_spellhaste', value: 0.2 },
        { kind: 'buff_ap', value: 90 },
      ],
    } as unknown as Entity;
    expect(playerSpellHasteFrac(p)).toBeCloseTo(0.3, 10);
    const slowed = { spellHaste: -0.4, auras: [] } as unknown as Entity;
    expect(playerSpellHasteFrac(slowed)).toBe(0);
  });

  it('tolerates a mirror-shaped entity (absent spellHaste, empty auras)', () => {
    // The online ClientWorld mirrors entities from snapshots that omit
    // default-zero fields, so the read must hold when spellHaste is simply
    // absent rather than 0.
    const mirrored = { auras: [] } as unknown as Entity;
    expect(playerSpellHasteFrac(mirrored)).toBe(0);
  });
});

describe('resourceDisplayName', () => {
  it('labels each resource and defaults a null resource to Mana', () => {
    expect(resourceDisplayName('rage')).toBe('Rage');
    expect(resourceDisplayName(null)).toBe('Mana');
  });
});
