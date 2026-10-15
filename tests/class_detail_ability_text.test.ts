import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import type { AbilityDef, PlayerClass } from '../src/sim/types';
import { abilityDisplayDescription, abilityEffectText } from '../src/ui/ability_description';
import { classDetailAbilityDescription } from '../src/ui/class_detail_ability_text';
import { SIGNATURE_ABILITIES } from '../src/ui/class_details_data';

// The HUD spellbook / action-bar tooltip text (no Spell Power scaling) for a
// character that has just learned `id`: the rank-1 surface the class-detail
// panel describes. A spec-gated ability resolves with its first spec committed.
function hudTooltipAtLearnLevel(cls: PlayerClass, id: string): string {
  const def = ABILITIES[id];
  if (!def) throw new Error(`missing ability ${id}`);
  const spec = def.specs?.[0];
  const mods = spec ? computeTalentModifiers(cls, { ...emptyAllocation(), spec }) : undefined;
  const known = abilitiesKnownAt(cls, def.learnLevel, mods).find((k) => k.def.id === id);
  if (!known) throw new Error(`${id} is not known at its learn level`);
  return abilityDisplayDescription(known, abilityEffectText(known));
}

// Neither max-health shield is a SIGNATURE_ABILITIES entry today, so these pin
// the panel's formatter rather than a row a player sees: the old inline copy in
// main.ts formatted an absorb from its raw `amount` (0%) and filled only
// {damage}, so any max-health shield given a panel row would have read wrong.
describe('class-detail ability text for max-health absorbs', () => {
  it('shows Ward of Faith as a resolved max-health percent and duration', () => {
    // Ward of Faith authors `amount: 0` plus casterMaxHpPct 0.25 for 10 sec.
    const text = classDetailAbilityDescription(ABILITIES.divine_protection);
    expect(text).toContain('25% of your maximum health');
    expect(text).toContain('for 10 sec');
    expect(text).not.toContain(' 0% of');
    expect(text).not.toMatch(/[{}]/);
    expect(text).toBe(hudTooltipAtLearnLevel('paladin', 'divine_protection'));
  });

  it('resolves the Iron Resolve effect shape (20% of max health, 10 sec)', () => {
    // Iron Resolve's flat-20-rage shield reuses Ward of Faith's effect shape:
    // `absorb` with amount 0 and casterMaxHpPct 0.2 for 10 sec. Driven through
    // the Ward of Faith prose so the pin holds on any base that carries it.
    const ironResolveShape: AbilityDef = {
      ...ABILITIES.divine_protection,
      effects: [{ type: 'absorb', amount: 0, casterMaxHpPct: 0.2, duration: 10 }],
    };
    const text = classDetailAbilityDescription(ironResolveShape);
    expect(text).toContain('20% of your maximum health');
    expect(text).toContain('for 10 sec');
    expect(text).not.toMatch(/[{}]/);
  });

  it('renders every max-health absorb ability the way the HUD tooltip does', () => {
    const shields = Object.values(ABILITIES).filter(
      (def) =>
        !def.hiddenFromPlayer &&
        def.effects.some((eff) => eff.type === 'absorb' && eff.casterMaxHpPct !== undefined),
    );
    expect(shields.map((def) => def.id)).toContain('divine_protection');
    for (const def of shields) {
      const text = classDetailAbilityDescription(def);
      expect(text, def.id).not.toMatch(/[{}]/);
      expect(text, def.id).toBe(hudTooltipAtLearnLevel(def.class as PlayerClass, def.id));
    }
  });
});

describe('class-detail panel signature abilities', () => {
  it('fills every placeholder the old inline filler dropped', () => {
    // {duration} was never passed, and Life Tap's {damage} value had no arm.
    expect(classDetailAbilityDescription(ABILITIES.polymorph)).toContain('for up to 15 sec');
    expect(classDetailAbilityDescription(ABILITIES.life_tap)).toBe(
      'Converts 30 health into 30 mana.',
    );
    // A DoT total reads in whole ticks, the damage it really deals (the HUD rule).
    expect(classDetailAbilityDescription(ABILITIES.corruption)).toContain(
      'causing 42 Shadow damage over 18 sec',
    );
  });

  it('matches the HUD tooltip for every signature ability a new character can learn', () => {
    let compared = 0;
    for (const [cls, ids] of Object.entries(SIGNATURE_ABILITIES)) {
      for (const id of ids) {
        const def = ABILITIES[id];
        const text = classDetailAbilityDescription(def);
        expect(text, `${cls}:${id}`).not.toMatch(/[{}]|\s\s/);
        // The panel is talent-free; a spec-locked signature (Measured Shot) reads
        // its unspecced base values, so only the ungated kit is held byte-equal.
        if (def.specs) continue;
        expect(text, `${cls}:${id}`).toBe(hudTooltipAtLearnLevel(cls as PlayerClass, id));
        compared++;
      }
    }
    expect(compared).toBeGreaterThanOrEqual(20);
  });
});
