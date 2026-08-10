import { describe, expect, it } from 'vitest';
import { DEFAULT_GAMEPAD_BINDINGS } from '../src/game/gamepad_map';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers } from '../src/sim/content/talents';
import type { PlayerClass } from '../src/sim/types';
import {
  ACTION_BAR_ABILITY_SLOTS,
  ActionBarController,
} from '../src/ui/hud/action_bar/action_bar_controller';
import { actionBarRowForSlot } from '../src/ui/hud/action_bar/action_bar_layout_core';
import {
  applyActionBarLayout,
  captureActionBarLayout,
  planActionBarRestore,
} from '../src/ui/hud/action_bar/action_bar_layout_sync';
import {
  applyLoadoutBar,
  buildDefaultFormBar,
  type HotbarAction,
  loadoutKnownAbilityIds,
} from '../src/ui/hud/action_bar/hotbar';
import {
  MOBILE_ACTION_PAGE_COUNT,
  MOBILE_ACTIONS_PER_PAGE,
  mobileButtonHasSourceSlot,
  sourceSlotForMobileButton,
} from '../src/ui/hud/action_bar/mobile_action_page_view';
import {
  ownedClassSpecDefaultAbilityIds,
  ownedDruidFormDefaultAbilityIds,
  shouldSeedOwnedSpecDefault,
} from '../src/ui/hud/action_bar/owned_class_spec_defaults';

const EXPECTED = {
  'hunter/beast_mastery': [
    'pack_command',
    'arcane_shot',
    'serpent_sting',
    'volley',
    'bestial_wrath',
    'stampede',
    'counter_shot',
    'trailbreak',
    'wildheart',
    'shellskin',
    'frostjaw_trap',
    'concussive_shot',
    'wing_clip',
    'aspect_of_the_hawk',
    'aspect_of_the_monkey',
    'aspect_of_the_cheetah',
    'revive_pet',
  ],
  'hunter/marksmanship': [
    'measured_shot',
    'aimed_shot',
    'rapid_fire',
    'arcane_shot',
    'cold_focus',
    'counter_shot',
    'trailbreak',
    'wildheart',
    'shellskin',
    'serpent_sting',
    'volley',
    'frostjaw_trap',
    'concussive_shot',
    'wing_clip',
    'aspect_of_the_hawk',
    'aspect_of_the_monkey',
    'aspect_of_the_cheetah',
    'revive_pet',
  ],
  'hunter/survival': [
    'bloodhook',
    'raptor_strike',
    'mongoose_bite',
    'shrapnel_charge',
    'bloodtrail_assault',
    'counter_shot',
    'trailbreak',
    'wildheart',
    'shellskin',
    'frostjaw_trap',
    'wing_clip',
    'concussive_shot',
    'serpent_sting',
    'volley',
    'aspect_of_the_hawk',
    'aspect_of_the_monkey',
    'aspect_of_the_cheetah',
    'revive_pet',
  ],
  'shaman/elemental': [
    'lightning_bolt',
    'chain_lightning',
    'earth_shock',
    'flame_shock',
    'earthquake',
    'frost_shock',
    'elemental_mastery',
    'unleash_weapon',
    'lightning_shield',
    'healing_wave',
    'ghost_wolf',
    'bloodlust',
    'flametongue_weapon',
  ],
  'shaman/enhancement': [
    'stormstrike',
    'unleash_weapon',
    'earth_shock',
    'galeheart_weapon',
    'rockbiter_weapon',
    'flame_shock',
    'lightning_bolt',
    'frost_shock',
    'healing_wave',
    'lightning_shield',
    'ghost_wolf',
    'bloodlust',
  ],
  'shaman/restoration': [
    'healing_wave',
    'tidecall',
    'unleash_weapon',
    'chain_heal',
    'ancestor_return',
    'lightning_shield',
    'ghost_wolf',
    'earth_shock',
    'frost_shock',
    'flame_shock',
    'lightning_bolt',
    'lifespring_weapon',
    'bloodlust',
  ],
  'priest/discipline': [
    'scouring_mercy',
    'smite',
    'power_word_shield',
    'flash_heal',
    'mind_blast',
    'heal',
    'renew',
    'shadow_word_pain',
    'veilstep',
    'psychic_scream',
    'lesser_heal',
    'mind_flay',
    'power_word_fortitude',
  ],
  'priest/holy': [
    'seraphic_vigil',
    'flash_heal',
    'heal',
    'prayer_of_healing',
    'holy_nova',
    'power_word_shield',
    'renew',
    'lesser_heal',
    'smite',
    'mind_blast',
    'veilstep',
    'psychic_scream',
    'shadow_word_pain',
    'mind_flay',
    'power_word_fortitude',
  ],
  'priest/shadow': [
    'shadow_word_pain',
    'mind_blast',
    'mind_flay',
    'summon_tithefiend',
    'shadowform',
    'flash_heal',
    'power_word_shield',
    'veilstep',
    'psychic_scream',
    'heal',
    'renew',
    'smite',
    'lesser_heal',
    'power_word_fortitude',
  ],
  'druid/balance': [
    'moonkin_form',
    'wrath',
    'starfire',
    'moonseed',
    'moonfire',
    'barkskin',
    'entangling_roots',
    'faerie_fire',
    'healing_touch',
    'rejuvenation',
    'regrowth',
    'travel_form',
  ],
  'druid/feral': [
    'cat_form',
    'bear_form',
    'feral_charge',
    'barkskin',
    'primal_reflexes',
    'travel_form',
    'healing_touch',
    'rejuvenation',
    'mark_of_the_wild',
    'thorns',
    'faerie_fire',
  ],
  'druid/restoration': [
    'rejuvenation',
    'regrowth',
    'healing_touch',
    'swiftmend',
    'barkskin',
    'entangling_roots',
    'moonfire',
    'wrath',
    'mark_of_the_wild',
    'thorns',
    'travel_form',
  ],
} as const;

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function ownedSpecEntries(): Array<{
  key: string;
  playerClass: PlayerClass;
  spec: string;
  expected: readonly string[];
  known: Set<string>;
}> {
  return Object.entries(EXPECTED).map(([key, expected]) => {
    const [playerClass, spec] = key.split('/');
    const cls = playerClass as PlayerClass;
    const modifiers = computeTalentModifiers(cls, { spec, rows: {} }, 20);
    const known = new Set(abilitiesKnownAt(cls, 20, modifiers).map(({ def }) => def.id));
    return { key, playerClass: cls, spec, expected, known };
  });
}

function controllerFor(
  storage: MemoryStorage,
  playerClass: PlayerClass,
  spec: string,
  known: ReadonlySet<string>,
): ActionBarController {
  return new ActionBarController({
    storage,
    playerClass,
    playerName: 'OwnedDefaultTester',
    playerLevel: () => 20,
    talentSpec: () => spec,
    knownAbilityIds: () => [...known],
    hasAura: () => false,
    isInSportMatch: () => false,
    showAttackButton: () => true,
  });
}

function seedOwnedSpecBar(
  storage: MemoryStorage,
  playerClass: PlayerClass,
  spec: string,
  known: ReadonlySet<string>,
): ActionBarController {
  const controller = controllerFor(storage, playerClass, spec, known);
  controller.init();
  controller.syncKnownAbilities();
  return controller;
}

describe('owned class level 20 default action bars', () => {
  it('pins the manual-first templates for every redesigned owned spec', () => {
    for (const { key, playerClass, spec, expected, known } of ownedSpecEntries()) {
      expect(ownedClassSpecDefaultAbilityIds(playerClass, spec, 20, known), key).toEqual(expected);
      expect(
        expected.some((id) => id.includes('one_button')),
        key,
      ).toBe(false);
    }
  });

  it('waits until level 20 and removes abilities the player does not know', () => {
    expect(
      ownedClassSpecDefaultAbilityIds('hunter', 'survival', 19, new Set(['bloodhook'])),
    ).toBeNull();
    expect(
      ownedClassSpecDefaultAbilityIds(
        'hunter',
        'survival',
        20,
        new Set(['bloodhook', 'raptor_strike']),
      ),
    ).toEqual(['bloodhook', 'raptor_strike']);
  });

  it('keeps the Wildfang signature and defensives on both curated form pages', () => {
    const known = new Set(
      abilitiesKnownAt(
        'druid',
        20,
        computeTalentModifiers('druid', { spec: 'feral', rows: {} }, 20),
      ).map((ability) => ability.def.id),
    );
    for (const form of ['bear', 'cat'] as const) {
      const ids = ownedDruidFormDefaultAbilityIds('druid', form, known);
      expect(ids, form).toEqual(
        expect.arrayContaining(['feral_charge', 'barkskin', 'primal_reflexes']),
      );
      expect(ids, form).toHaveLength(12);
    }
  });

  it('replaces only a missing bar or the exact previously generated layout', () => {
    const previous = buildDefaultFormBar(['pack_command', 'arcane_shot'], 5);
    const customized: HotbarAction[] = [previous[1], previous[0], ...previous.slice(2)];

    expect(shouldSeedOwnedSpecDefault(previous, previous, true)).toBe(true);
    expect(shouldSeedOwnedSpecDefault(customized, previous, true)).toBe(false);
    expect(shouldSeedOwnedSpecDefault(previous, null, false)).toBe(true);
    expect(shouldSeedOwnedSpecDefault(previous, null, true)).toBe(false);
  });

  it('keeps every generated spec bar byte-for-byte through a local relog', () => {
    for (const { key, playerClass, spec, expected, known } of ownedSpecEntries()) {
      const storage = new MemoryStorage();
      seedOwnedSpecBar(storage, playerClass, spec, known);

      const relogged = controllerFor(storage, playerClass, spec, known);
      relogged.init();
      relogged.syncKnownAbilities();

      expect(relogged.actions, key).toEqual(
        buildDefaultFormBar(expected, ACTION_BAR_ABILITY_SLOTS),
      );
    }
  });

  it('restores the curated spec template when Reset Action Bar is used', () => {
    for (const { key, playerClass, spec, expected, known } of ownedSpecEntries()) {
      const storage = new MemoryStorage();
      const controller = seedOwnedSpecBar(storage, playerClass, spec, known);
      controller.replaceActions(
        buildDefaultFormBar([...known].reverse(), ACTION_BAR_ABILITY_SLOTS),
      );

      controller.resetActiveBar();

      expect(controller.actions, key).toEqual(
        buildDefaultFormBar(expected, ACTION_BAR_ABILITY_SLOTS),
      );
    }
  });

  it('restores every generated spec bar on another device and leaves it alone on reconnect', () => {
    for (const { key, playerClass, spec, expected, known } of ownedSpecEntries()) {
      const source = new MemoryStorage();
      seedOwnedSpecBar(source, playerClass, spec, known);
      const layout = captureActionBarLayout(source, playerClass, 'OwnedDefaultTester');

      const destination = new MemoryStorage();
      const restore = planActionBarRestore({ source: 'server', layout }, () => ({
        v: 1,
        forms: {},
      }));
      expect(restore.action, key).toBe('apply-server');
      if (restore.action !== 'apply-server') throw new Error(`${key} did not restore from server`);
      applyActionBarLayout(destination, playerClass, 'OwnedDefaultTester', restore.layout);

      const imported = controllerFor(destination, playerClass, spec, known);
      imported.init();
      imported.syncKnownAbilities();
      const expectedBar = buildDefaultFormBar(expected, ACTION_BAR_ABILITY_SLOTS);
      expect(imported.actions, key).toEqual(expectedBar);

      const reconnect = planActionBarRestore({ source: 'noop' }, () =>
        captureActionBarLayout(destination, playerClass, 'OwnedDefaultTester'),
      );
      expect(reconnect, key).toEqual({ action: 'none' });
      const reconnected = controllerFor(destination, playerClass, spec, known);
      reconnected.init();
      reconnected.syncKnownAbilities();
      expect(reconnected.actions, key).toEqual(expectedBar);
    }
  });

  it('accepts every generated template as an imported saved talent-loadout bar', () => {
    for (const { key, playerClass, spec, expected } of ownedSpecEntries()) {
      const known = loadoutKnownAbilityIds(playerClass, { spec, rows: {} }, 20);
      const imported = applyLoadoutBar(
        buildDefaultFormBar([], ACTION_BAR_ABILITY_SLOTS),
        [...expected],
        ACTION_BAR_ABILITY_SLOTS,
        (abilityId) => known.has(abilityId),
      );
      expect(imported, key).toEqual(buildDefaultFormBar(expected, ACTION_BAR_ABILITY_SLOTS));
    }
  });

  it('keeps core actions visible and controller-bound, with every action reachable on mobile', () => {
    const controllerActions = new Set(Object.values(DEFAULT_GAMEPAD_BINDINGS));
    for (const { key, expected } of ownedSpecEntries()) {
      const actions = buildDefaultFormBar(expected, ACTION_BAR_ABILITY_SLOTS);
      for (let index = 0; index < actions.length; index++) {
        if (!actions[index]) continue;
        const sourceSlot = index + 1;
        const desktopRow = actionBarRowForSlot(sourceSlot);
        expect(desktopRow, `${key} desktop slot ${sourceSlot}`).toBeLessThanOrEqual(3);
        if (index < 11) {
          expect(desktopRow, `${key} visible desktop slot ${sourceSlot}`).toBe(1);
        }
        if (index < 8) {
          expect(controllerActions, `${key} default controller slot ${sourceSlot}`).toContain(
            `slot${sourceSlot}`,
          );
        }
        const page = Math.floor(index / MOBILE_ACTIONS_PER_PAGE);
        const button = index % MOBILE_ACTIONS_PER_PAGE;
        expect(page, `${key} mobile slot ${sourceSlot}`).toBeLessThan(MOBILE_ACTION_PAGE_COUNT);
        expect(mobileButtonHasSourceSlot(page, button), `${key} mobile slot ${sourceSlot}`).toBe(
          true,
        );
        expect(sourceSlotForMobileButton(page, button), `${key} mobile slot ${sourceSlot}`).toBe(
          sourceSlot,
        );
      }
    }
  });
});
