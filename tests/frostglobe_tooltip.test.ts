// Frostglobe's tooltip used to render "dealing  Frost damage each second":
// its `frozenOrb` effect had no placeholder resolver, so {damage} spliced an
// empty string. This pins the fix against the REAL cast: the per-pulse Spell
// Power bonus the tooltip shows must equal the spBonus the orb snapshots when
// the sim releases it, at two different Spell Power values.
import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import { abilityDamageBonus, abilityPrimaryEffect } from '../src/ui/ability_damage';
import { abilityDisplayDescription, abilityEffectText } from '../src/ui/ability_description';
import { EMPTY_TEST_WORLD } from './sim_shared';

function frostglobe(level: number): ResolvedAbility {
  const mods = computeTalentModifiers('mage', { ...emptyAllocation(), spec: 'frost' } as never);
  const known = abilitiesKnownAt('mage', level, mods).find((k) => k.def.id === 'frozen_orb');
  if (!known) throw new Error('frost mage should know Frostglobe');
  return known;
}

function castOrbSpBonus(spellPower: number): number {
  const sim = new Sim({ seed: 7, playerClass: 'mage', autoEquip: false, world: EMPTY_TEST_WORLD });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('frost')).toBe(true);
  sim.tick();
  sim.player.spellPower = spellPower;
  sim.player.resource = sim.player.maxResource;
  sim.castAbility('frozen_orb');
  const orb = (sim as unknown as { ctx: { frozenOrbs: { spBonus: number }[] } }).ctx.frozenOrbs[0];
  if (!orb) throw new Error('Frostglobe cast spawned no orb');
  return orb.spBonus;
}

describe('Frostglobe tooltip damage', () => {
  it('fills {damage} with the resolved pulse range instead of an empty string', () => {
    const res = frostglobe(20);
    const eff = abilityPrimaryEffect(res);
    expect(eff?.type).toBe('frozenOrb');
    const text = abilityEffectText(res);
    expect(text).toMatch(/^\d+ to \d+$/);
    const desc = abilityDisplayDescription(res, text);
    expect(desc).not.toMatch(/dealing\s+Frost/);
    expect(desc).toContain(`dealing ${text} Frost damage each second`);
  });

  it('shows the same Spell Power rider the cast snapshots, at two power values', () => {
    const res = frostglobe(20);
    const eff = abilityPrimaryEffect(res);
    if (!eff) throw new Error('no primary effect');
    for (const sp of [120, 360]) {
      const shown = abilityDamageBonus(res, eff, {
        spellPower: sp,
        healPower: 0,
        attackPower: 0,
        rangedPower: 0,
      });
      expect(shown).toBeGreaterThan(0);
      expect(shown).toBe(castOrbSpBonus(sp));
    }
  });
});
