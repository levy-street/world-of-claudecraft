import { describe, expect, it } from 'vitest';
import { VAMPIRIC_TOUCH_HEAL_RATE } from '../src/sim/combat/priest/vampiric_touch';
import { ABILITIES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { DICT, localizeSimAuraName } from '../src/ui/sim_i18n';
import { EMPTY_TEST_WORLD } from './sim_shared';

// Vespers rework tuning: the kit changes
// beside the Tithefiend rework. The Duskhymn Regalia rework is pinned in
// tests/vanguard_set_bonus_a.test.ts.
describe('Vespers rework tuning', () => {
  it('Void Rupture scales with a 0.7 Spell Power coefficient', () => {
    const effect = ABILITIES.void_rupture.effects[0];
    expect(effect.type).toBe('directDamage');
    expect((effect as { spellPowerCoeff?: number }).spellPowerCoeff).toBe(0.7);
  });

  it('Vampiric Touch shares 30 percent of the health lost as healing', () => {
    expect(VAMPIRIC_TOUCH_HEAL_RATE).toBe(0.3);
  });

  it('Stilled Mind and Anointing are off the global cooldown', () => {
    expect(ABILITIES.inner_focus.offGcd).toBe(true);
    expect(ABILITIES.power_infusion.offGcd).toBe(true);
  });

  it('casting Anointing leaves the global cooldown free', () => {
    const sim = new Sim({ seed: 7, playerClass: 'priest', world: EMPTY_TEST_WORLD });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: 'shadow', rows: { 17: 'pri_r17_anointing' } })).toBe(true);
    sim.player.resource = sim.player.maxResource;
    sim.targetEntity(sim.player.id);
    sim.castAbility('power_infusion');
    expect(sim.player.cooldowns.has('power_infusion'), 'Anointing was cast').toBe(true);
    expect(sim.player.gcdRemaining).toBe(0);
  });

  it('Duskhymn Ward localizes through the sim aura matcher', () => {
    expect(localizeSimAuraName('Duskhymn Ward')).toBe('Duskhymn Ward');
    for (const lang of ['zh_CN', 'zh_TW', 'ko_KR', 'ja_JP', 'ru_RU'] as const) {
      expect(DICT[lang]['aura.duskhymnWard'], lang).not.toBe('Duskhymn Ward');
    }
  });
});
