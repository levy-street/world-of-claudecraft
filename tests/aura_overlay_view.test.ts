import { describe, expect, it } from 'vitest';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import type { TalentAllocation } from '../src/sim/content/talents';
import type { PlayerClass } from '../src/sim/types';
import { activeAuraProcIds, availableAuraProcDefs } from '../src/ui/aura_overlay_view';

const known = (...ids: string[]) => ids.map((id) => ({ def: { id } }));
const talents = (rows: TalentAllocation['rows']): TalentAllocation => ({ spec: null, rows });

describe('availableAuraProcDefs', () => {
  it('shows only procs relevant to the current Warrior loadout', () => {
    expect(availableAuraProcDefs('warrior', known('revenge')).map((p) => p.id)).toEqual([
      'revenge_free',
    ]);
    expect(
      availableAuraProcDefs(
        'warrior',
        known(
          'heroic_strike',
          'execute',
          'sudden_death',
          'victory_rush',
          'overpower',
          'mortal_strike',
        ),
      ).map((p) => p.id),
    ).toEqual(['battle_trance', 'overpower_charge', 'sudden_death', 'victory_rush']);
    expect(
      availableAuraProcDefs('warrior', known('bloodthirst', 'red_harvest', 'enrage_passive')).map(
        (p) => p.id,
      ),
    ).toEqual(['enrage']);
    expect(
      availableAuraProcDefs('warrior', known('overpower', 'execute', 'sudden_death')).map(
        (p) => p.id,
      ),
    ).not.toContain('overpower_charge');
    expect(
      availableAuraProcDefs('warrior', known('mortal_strike', 'execute', 'sudden_death')).map(
        (p) => p.id,
      ),
    ).not.toContain('overpower_charge');
    expect(
      availableAuraProcDefs('warrior', known('mortal_strike', 'sudden_death')).map((p) => p.id),
    ).not.toContain('sudden_death');
    expect(
      availableAuraProcDefs('warrior', known('mortal_strike', 'execute')).map((p) => p.id),
    ).not.toContain('sudden_death');
    expect(
      availableAuraProcDefs('warrior', known('red_harvest')).find((p) => p.id === 'enrage'),
    ).toMatchObject({ iconAbilityId: 'red_harvest' });
    expect(
      availableAuraProcDefs('warrior', known('heroic_strike', 'mortal_strike')).find(
        (p) => p.id === 'battle_trance',
      ),
    ).toMatchObject({ iconAbilityId: 'mortal_strike' });
    expect(
      availableAuraProcDefs('warrior', known('overpower', 'mortal_strike')).find(
        (p) => p.id === 'overpower_charge',
      ),
    ).toMatchObject({ iconAbilityId: 'overpower' });
    expect(
      availableAuraProcDefs(
        'warrior',
        known('revenge', 'heroic_strike', 'raised_guard', 'iron_resolve'),
      ).map((p) => p.id),
    ).toEqual(['revenge_free', 'battle_trance', 'raised_guard', 'iron_resolve']);
    expect(
      availableAuraProcDefs('warrior', known('bloodthirst')).find((p) => p.id === 'enrage'),
    ).toMatchObject({ iconAbilityId: 'bloodthirst' });
    expect(
      availableAuraProcDefs('warrior', known('enrage_passive')).find((p) => p.id === 'enrage'),
    ).toMatchObject({ iconAbilityId: 'red_harvest' });
  });

  it('exposes only the proc family belonging to the current class', () => {
    expect(availableAuraProcDefs('mage', known('revenge'))).toEqual([]);
    expect(availableAuraProcDefs('warrior', known('hot_streak'))).toEqual([]);
  });

  it('shows Hunter, Shaman, and Druid reactive states from the active build only', () => {
    expect(
      availableAuraProcDefs(
        'hunter',
        known('mongoose_bite'),
        talents({ 11: 'hun_r11_survival_instincts', 20: 'hun_r20_rapid_killing' }),
      ).map((proc) => proc.id),
    ).toEqual(['counterfang_window', 'hun_deathless_will']);

    expect(
      availableAuraProcDefs(
        'shaman',
        known('elemental_mastery'),
        talents({
          5: 'sha_r5_concussion',
          11: 'sha_r11_ancestral_guidance',
          20: 'sha_r20_elemental_fury',
        }),
      ).map((proc) => proc.id),
    ).toEqual(['elemental_mastery', 'sha_fault_line', 'sha_guiding_spirits', 'sha_storm_recall']);

    expect(
      availableAuraProcDefs(
        'druid',
        known('wrath', 'moonfire'),
        talents({
          5: 'dru_r5_improved_wrath',
          11: 'dru_r11_furor',
          17: 'dru_r17_survival_of_the_fittest',
        }),
      ).map((proc) => proc.id),
    ).toEqual(['dru_improved_wildbolt', 'dru_wildsurge', 'dru_survival_of_the_fittest']);
  });

  it('derives actionable talent auras for every remaining class', () => {
    expect(
      availableAuraProcDefs('paladin', known(), talents({ 11: 'pal_r11_divine_wisdom' })).map(
        (proc) => proc.id,
      ),
    ).toEqual(['pal_divine_wisdom']);
    expect(
      availableAuraProcDefs(
        'rogue',
        known('cold_blood'),
        talents({ 5: 'rog_r5_improved_backstab', 8: 'rog_r8_improved_gouge' }),
      ).map((proc) => proc.id),
    ).toEqual(['cold_blood', 'rog_improved_backstab', 'rog_blindside_opening']);
    expect(
      availableAuraProcDefs(
        'priest',
        known('inner_focus'),
        talents({ 5: 'pri_r5_searing_light', 17: 'pri_r17_inner_fire' }),
      ).map((proc) => proc.id),
    ).toEqual(['inner_focus', 'pri_searing_light', 'pri_inner_fire']);
    expect(
      availableAuraProcDefs(
        'warlock',
        known(),
        talents({ 5: 'wlk_r5_bane', 20: 'wlk_r20_curse_mastery' }),
      ).map((proc) => proc.id),
    ).toEqual(['wlk_grave_rhythm', 'wlk_curse_mastery']);
  });

  it('pins generated talent proc aura ids, kinds, icons, and localized choice labels', () => {
    const defs = availableAuraProcDefs(
      'shaman',
      known(),
      talents({
        5: 'sha_r5_concussion',
        11: 'sha_r11_ancestral_guidance',
        20: 'sha_r20_tidal_waves',
      }),
    );
    expect(
      defs.map(({ id, auraKind, auraId, iconAbilityId, talentChoice }) => ({
        id,
        auraKind,
        auraId,
        iconAbilityId,
        talentChoiceId: talentChoice?.id,
      })),
    ).toEqual([
      {
        id: 'sha_fault_line',
        auraKind: 'next_cast_free',
        auraId: 'sha_fault_line',
        iconAbilityId: 'lightning_bolt',
        talentChoiceId: 'sha_r5_concussion',
      },
      {
        id: 'sha_guiding_spirits',
        auraKind: 'next_cast_instant',
        auraId: 'sha_guiding_spirits',
        iconAbilityId: 'healing_wave',
        talentChoiceId: 'sha_r11_ancestral_guidance',
      },
      {
        id: 'sha_undertow_promise',
        auraKind: 'heal_echo',
        auraId: 'sha_undertow_promise',
        iconAbilityId: 'healing_wave',
        talentChoiceId: 'sha_r20_tidal_waves',
      },
    ]);
  });

  it('includes every selected talent proc that creates a player-visible aura window', () => {
    const actionableKinds = new Set(['empowerNext', 'aura', 'absorb', 'echo']);
    const missing: string[] = [];

    for (const [rawClass, tree] of Object.entries(CHOICE_ROWS)) {
      const playerClass = rawClass as PlayerClass;
      for (const row of tree.rows) {
        for (const option of row.options) {
          const proc = option.effect.proc;
          if (!proc || !proc.responses.some((response) => actionableKinds.has(response.kind))) {
            continue;
          }
          const defs = availableAuraProcDefs(
            playerClass,
            known(),
            talents({ [row.level]: option.id }),
          );
          if (!defs.some((def) => def.id === proc.id)) {
            missing.push(`${playerClass}:${option.id}:${proc.id}`);
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('covers the actionable Fire, Frost, and Arcane Mage states', () => {
    expect(availableAuraProcDefs('mage', known('hot_streak')).map((p) => p.id)).toEqual([
      'heating_up',
      'hot_streak',
    ]);
    expect(
      availableAuraProcDefs(
        'mage',
        known('ice_lance', 'fingers_of_frost', 'flurry', 'brain_freeze'),
      ).map((p) => p.id),
    ).toEqual(['fingers_of_frost', 'brain_freeze']);
    expect(
      availableAuraProcDefs('mage', known('arcane_surge', 'perfect_moment')).map((p) => p.id),
    ).toEqual(['arcane_charge', 'aether_rush', 'perfect_moment']);
    expect(availableAuraProcDefs('mage', known('ice_lance', 'brain_freeze'))).toEqual([]);
    expect(availableAuraProcDefs('mage', known('fingers_of_frost', 'flurry'))).toEqual([]);
  });

  it('pins every Mage proc to the aura emitted by combat', () => {
    const defs = availableAuraProcDefs(
      'mage',
      known(
        'hot_streak',
        'ice_lance',
        'fingers_of_frost',
        'flurry',
        'brain_freeze',
        'arcane_surge',
        'perfect_moment',
      ),
    );
    expect(
      Object.fromEntries(
        defs.map((def) => [
          def.id,
          { auraKind: def.auraKind, auraId: def.auraId, iconAbilityId: def.iconAbilityId },
        ]),
      ),
    ).toEqual({
      heating_up: {
        auraKind: 'internal_cd',
        auraId: 'heating_up',
        iconAbilityId: 'fireball',
      },
      hot_streak: {
        auraKind: 'next_cast_free',
        auraId: 'hot_streak',
        iconAbilityId: 'hot_streak',
      },
      fingers_of_frost: {
        auraKind: 'fingers_of_frost',
        auraId: undefined,
        iconAbilityId: 'fingers_of_frost',
      },
      brain_freeze: {
        auraKind: 'brain_freeze',
        auraId: undefined,
        iconAbilityId: 'brain_freeze',
      },
      arcane_charge: {
        auraKind: 'arcane_charge',
        auraId: 'arcane_surge',
        iconAbilityId: 'arcane_surge',
      },
      aether_rush: {
        auraKind: 'next_cast_free',
        auraId: 'aether_surge_free',
        iconAbilityId: 'arcane_surge',
      },
      perfect_moment: {
        auraKind: 'perfect_moment',
        auraId: 'perfect_moment',
        iconAbilityId: 'perfect_moment',
      },
    });
  });
});

describe('activeAuraProcIds', () => {
  it('maps active definitions and ignores unrelated or same-kind buffs', () => {
    const defs = availableAuraProcDefs('mage', known('hot_streak', 'arcane_surge'));
    expect(
      activeAuraProcIds(defs, [
        { id: 'other_free_cast', kind: 'next_cast_free' },
        { id: 'hot_streak', kind: 'next_cast_free' },
        { kind: 'buff_ap_pct' },
      ]),
    ).toEqual(new Set(['hot_streak']));
  });
});
