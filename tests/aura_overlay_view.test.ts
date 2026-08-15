import { describe, expect, it } from 'vitest';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import type { TalentAllocation } from '../src/sim/content/talents';
import type { PlayerClass } from '../src/sim/types';
import { activeAuraProcIds, availableAuraProcDefs } from '../src/ui/aura_overlay_view';
import { abilityImageUrl } from '../src/ui/icons';

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

  // The v0.31 class overhauls rewrote the Hunter, Shaman, Priest, Rogue, Paladin,
  // Druid, and Warlock choice rows, so the ids these three tests name are the
  // CURRENT ones. Any class whose rewritten rows carry no proc-with-aura option
  // contributes nothing but its known-ability procs, which is asserted rather than
  // skipped: an overhaul that adds a talent proc must land here too.
  it('shows Hunter, Shaman, and Druid reactive states from the active build only', () => {
    // Hunter and Shaman rows carry no proc auras after the overhauls; the base
    // known-ability procs are the whole set, and an unselected row adds nothing.
    expect(
      availableAuraProcDefs('hunter', known('mongoose_bite'), talents({})).map((proc) => proc.id),
    ).toEqual(['counterfang_window']);

    expect(
      availableAuraProcDefs('shaman', known('elemental_mastery'), talents({})).map(
        (proc) => proc.id,
      ),
    ).toEqual(['elemental_mastery']);

    // Druid does still generate talent procs, and only for the SELECTED options:
    // Wrath and Moonfire contribute no base proc, so every id here is talent-derived.
    expect(
      availableAuraProcDefs(
        'druid',
        known('wrath', 'moonfire'),
        talents({ 8: 'dru_r8_improved_roots', 11: 'dru_r11_furor' }),
      ).map((proc) => proc.id),
    ).toEqual(['dru_ironhide_reflex', 'dru_gripping_ambush']);

    // The active build only: swap the row-8 pick and its proc drops out.
    expect(
      availableAuraProcDefs(
        'druid',
        known('wrath', 'moonfire'),
        talents({ 11: 'dru_r11_furor' }),
      ).map((proc) => proc.id),
    ).toEqual(['dru_gripping_ambush']);
  });

  it('derives actionable talent auras for every remaining class', () => {
    // Paladin's rewritten rows carry no proc aura at all: the derivation must
    // return an empty list, not throw or leak another class's procs.
    expect(
      availableAuraProcDefs('paladin', known(), talents({ 11: 'pal_r11_fist_of_justice' })),
    ).toEqual([]);
    expect(
      availableAuraProcDefs(
        'rogue',
        known('cold_blood'),
        talents({ 5: 'rog_r5_slipstream', 17: 'rog_r17_ghostfoot_gambit' }),
      ).map((proc) => proc.id),
    ).toEqual(['cold_blood', 'rog_slipstream', 'rog_improved_evasion']);
    expect(
      availableAuraProcDefs(
        'priest',
        known('inner_focus'),
        talents({ 8: 'pri_r17_inner_fire', 14: 'pri_r11_meditation' }),
      ).map((proc) => proc.id),
    ).toEqual(['inner_focus', 'pri_inner_fire', 'pri_measured_faith']);
    expect(
      availableAuraProcDefs('warlock', known(), talents({ 17: 'wlk_r17_demonic_resilience' })).map(
        (proc) => proc.id,
      ),
    ).toEqual(['wlk_curse_mastery']);
  });

  it('pins generated talent proc aura ids, kinds, icons, and localized choice labels', () => {
    const defs = availableAuraProcDefs(
      'druid',
      known(),
      talents({ 8: 'dru_r8_improved_roots', 11: 'dru_r11_furor' }),
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
        id: 'dru_ironhide_reflex',
        auraKind: 'absorb',
        auraId: 'dru_ironhide_reflex',
        // The choice's own `icon` wins over the proc id, so the overlay shows the
        // ability the talent modifies rather than an icon-less proc key.
        iconAbilityId: 'bear_form',
        talentChoiceId: 'dru_r8_improved_roots',
      },
      {
        id: 'dru_gripping_ambush',
        auraKind: 'next_cast_instant',
        auraId: 'dru_gripping_ambush',
        iconAbilityId: 'entangling_roots',
        talentChoiceId: 'dru_r11_furor',
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

  it('routes every selected talent proc overlay to authored ability art', () => {
    const actionableKinds = new Set(['empowerNext', 'aura', 'absorb', 'echo']);
    const missing: string[] = [];

    for (const [rawClass, tree] of Object.entries(CHOICE_ROWS)) {
      const playerClass = rawClass as PlayerClass;
      for (const row of tree.rows) {
        for (const option of row.options) {
          const proc = option.effect.proc;
          if (!proc?.responses.some((response) => actionableKinds.has(response.kind))) {
            continue;
          }
          const def = availableAuraProcDefs(
            playerClass,
            known(),
            talents({ [row.level]: option.id }),
          ).find((candidate) => candidate.id === proc.id);
          if (def && !abilityImageUrl(def.iconAbilityId)) {
            missing.push(`${playerClass}:${option.id}:${def.iconAbilityId}`);
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('routes generated talent procs to their canonical ability icons', () => {
    // The Hellglass Ward -> Felhunter special case retired with the warlock
    // three-spec overhaul; the surviving contract is the generic one: each
    // drawable talent proc surfaces exactly when its row is selected and
    // carries a real ability id for its icon.
    expect(
      availableAuraProcDefs('warlock', known(), talents({ 17: 'wlk_r17_demonic_resilience' })).map(
        ({ id, iconAbilityId }) => ({ id, iconAbilityId }),
      ),
    ).toEqual([{ id: 'wlk_curse_mastery', iconAbilityId: 'wlk_r17_demonic_resilience' }]);
    expect(
      availableAuraProcDefs(
        'druid',
        known(),
        talents({ 8: 'dru_r8_improved_roots', 11: 'dru_r11_furor' }),
      ).map(({ id, iconAbilityId }) => ({ id, iconAbilityId })),
    ).toEqual([
      { id: 'dru_ironhide_reflex', iconAbilityId: 'bear_form' },
      { id: 'dru_gripping_ambush', iconAbilityId: 'entangling_roots' },
    ]);
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
