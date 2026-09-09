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

  it('renders the Wrack cost line for a ruin-spending ability (Rain of Fire)', () => {
    // rain_of_fire: 45 mana, ruinCost 3, instant, no cooldown
    // (src/sim/content/classes.ts). The QA closed this branch: deleting the
    // ruinCost push shipped green before this arm existed.
    const line = describeAbilitySummary(resolved(ABILITIES.rain_of_fire), 'mana');
    expect(line).toBe('45 Mana · 3 Wrack · Instant');
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

  it('renders the channel line, hasted by the same divisor (Aether Darts)', () => {
    // arcane_missiles: channel { duration: 3 } (src/sim/content/classes.ts).
    // The QA closed this branch: deleting the channel arm (every channel
    // tooltip degrading to Instant) and dropping the /h haste division both
    // shipped green before these two pins.
    expect(abilityCastLine(resolved(ABILITIES.arcane_missiles))).toBe('Channeled (3 sec)');
    // 3 / (1 + 0.5) = 2: a hasted channel shortens exactly like a cast.
    expect(abilityCastLine(resolved(ABILITIES.arcane_missiles), 0.5)).toBe('Channeled (2 sec)');
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

  it('renders the Skulduggery stealth-bypass wording for a subtlety rogue', () => {
    expect(abilityRequirementLines(ABILITIES.ambush, 'subtlety')).toContain(
      'Requires stealth (not needed at 3 Gloam or during the Shadow Veil)',
    );
  });

  it('renders exactly the enemy-target line for a plain hostile nuke', () => {
    // The exact array, not a not-contains (the QA hardening: the old arm
    // only denied the stealth line, which fireball could never produce).
    expect(abilityRequirementLines(ABILITIES.fireball)).toEqual(['Enemy target']);
  });

  it('maps every requirement key to its own distinct English row', () => {
    // Table-driven over synthesized flags on a real def, one flag per row,
    // so collapsing any switch case into the selfOnly default (or swapping
    // two cases) reds on its exact English. Flags come from the resolver's
    // truth table (ability_requirement_keys.ts).
    const base = ABILITIES.fireball;
    const rows: { def: AbilityDef; line: string }[] = [
      {
        def: { ...base, requiresForm: 'bear' } as AbilityDef,
        line: 'Requires Bear Form',
      },
      { def: { ...base, spendsCombo: true } as AbilityDef, line: 'Consumes combo points' },
      {
        def: { ...base, requiresDodgeProc: true } as AbilityDef,
        line: 'Only usable after the target dodges',
      },
      {
        def: { ...base, requiresOutOfCombat: true } as AbilityDef,
        line: 'Requires being out of combat',
      },
      {
        def: { ...base, executeThreshold: 0.2 } as AbilityDef,
        line: 'Requires target below 20% health',
      },
      {
        def: { ...base, onNextSwing: true } as AbilityDef,
        line: 'Activates on your next swing',
      },
      { def: { ...base, offGcd: true } as AbilityDef, line: 'Off the global cooldown' },
      {
        def: { ...base, targetType: 'friendly' } as unknown as AbilityDef,
        line: 'Friendly target',
      },
    ];
    for (const row of rows) {
      expect(abilityRequirementLines(row.def), row.line).toContain(row.line);
    }
    // Distinctness: no two rows collapsed onto one string.
    expect(new Set(rows.map((r) => r.line)).size).toBe(rows.length);
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
