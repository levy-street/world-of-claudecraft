import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { PlayerClass } from '../src/sim/types';
import {
  ACTION_BAR_ABILITY_SLOTS,
  ActionBarController,
} from '../src/ui/hud/action_bar/action_bar_controller';
import type { HotbarAction } from '../src/ui/hud/action_bar/hotbar';
import type { ActionBarLayout } from '../src/world_api/action_bar';

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

interface MutableState {
  known: string[];
  level: number;
  spec: string | null;
  auras: string[];
  sportTeam: number | null | undefined;
  showAttackButton: boolean;
}

interface Harness {
  controller: ActionBarController;
  state: MutableState;
  storage: MemoryStorage;
}

function bar(...abilityIds: string[]): HotbarAction[] {
  return Array.from({ length: ACTION_BAR_ABILITY_SLOTS }, (_, index) => {
    const id = abilityIds[index];
    return id ? { type: 'ability' as const, id } : null;
  });
}

function makeHarness(
  playerClass: PlayerClass,
  known: string[],
  initialBar: HotbarAction[],
  storage = new MemoryStorage(),
): Harness {
  const state: MutableState = {
    known: [...known],
    level: 20,
    spec: null,
    auras: [],
    sportTeam: undefined,
    showAttackButton: true,
  };
  const controller = new ActionBarController({
    storage,
    playerClass,
    playerName: 'ActionbarTester',
    playerLevel: () => state.level,
    talentSpec: () => state.spec,
    knownAbilityIds: () => state.known,
    hasAura: (kind) => state.auras.includes(kind),
    isInSportMatch: () => state.sportTeam !== undefined && state.sportTeam !== null,
    showAttackButton: () => state.showAttackButton,
  });
  controller.replaceActions(initialBar);
  return { controller, state, storage };
}

describe('ActionBarController form persistence', () => {
  it('keeps the public bar contract at one attack slot plus 33 configurable slots', () => {
    expect(ACTION_BAR_ABILITY_SLOTS).toBe(33);
  });

  it('keeps Paladin auras on their choice row and auto-places standalone long buffs', () => {
    const { controller } = makeHarness(
      'paladin',
      [
        'devotion_ward',
        'radiant_devotion',
        'dawn_devotion',
        'grace_devotion',
        'retribution_aura',
        'solar_step',
      ],
      bar(),
    );

    controller.syncKnownAbilities();

    expect(controller.actions).toEqual(
      bar('radiant_devotion', 'dawn_devotion', 'grace_devotion', 'solar_step'),
    );
  });

  it('extends a saved two-row bar with an empty third row without losing bindings', () => {
    const storage = new MemoryStorage();
    const legacy = Array.from(
      { length: 22 },
      (_, index): HotbarAction => (index === 0 ? { type: 'ability', id: 'sunder_armor' } : null),
    );
    storage.setItem('woc_hotbar_warrior_ActionbarTester', JSON.stringify(legacy));
    const { controller } = makeHarness('warrior', ['sunder_armor'], bar(), storage);

    controller.init();

    expect(controller.actions).toHaveLength(33);
    expect(controller.actions[0]).toEqual({ type: 'ability', id: 'sunder_armor' });
    expect(controller.actions.slice(22)).toEqual(Array.from({ length: 11 }, () => null));
  });

  it('repairs a pre-overhaul Warlock bar with the active specialization kit', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'woc_hotbar_warlock_ActionbarTester',
      JSON.stringify(bar('corruption', 'curse_of_agony', 'searing_pain', 'summon_doomguard')),
    );
    const known = [
      'shadow_bolt',
      'life_tap',
      'demon_skin',
      'umbral_anchor',
      'conflagrate',
      'chaos_bolt',
      'shadowburn',
      'ruinous_brand',
      'rain_of_fire',
      'summon_infernal',
    ];
    const { controller } = makeHarness('warlock', known, bar(), storage);

    controller.init();
    controller.syncKnownAbilities();

    const abilityIds = controller.actions.flatMap((action) =>
      action?.type === 'ability' ? [action.id] : [],
    );
    expect(abilityIds).toEqual(expect.arrayContaining(known));
    expect(abilityIds).not.toEqual(
      expect.arrayContaining(['corruption', 'curse_of_agony', 'searing_pain', 'summon_doomguard']),
    );
  });

  it('preserves an item id this bundle predates through load and save (R34)', () => {
    // The layout is per-character SERVER state and the save is a wholesale
    // overwrite: nulling an unresolvable slot at parse used to DESTROY the
    // binding for every device the moment any ordinary save fired (a form
    // switch, a level-up auto-place). The unknown slot rides through as an
    // inert item action; the known-but-ineligible strip stays.
    const storage = new MemoryStorage();
    const stored = bar();
    stored[0] = { type: 'item', id: 'ghost_tool_from_v33' };
    stored[1] = { type: 'item', id: 'baked_bread' };
    stored[2] = { type: 'item', id: 'wolf_fang' }; // known, NOT a hotbar kind
    storage.setItem('woc_hotbar_warrior_ActionbarTester', JSON.stringify(stored));
    const { controller } = makeHarness('warrior', [], bar(), storage);
    controller.init();
    expect(controller.actions[0]).toEqual({ type: 'item', id: 'ghost_tool_from_v33' });
    expect(controller.actions[1]).toEqual({ type: 'item', id: 'baked_bread' });
    expect(controller.actions[2]).toBeNull();
    controller.saveActions();
    const roundTrip = JSON.parse(storage.getItem('woc_hotbar_warrior_ActionbarTester') ?? '[]');
    expect(roundTrip[0]).toEqual({ type: 'item', id: 'ghost_tool_from_v33' });
    expect(roundTrip[2]).toBeNull();
  });

  it('persists the last third-row slot independently across Druid forms and reloads', () => {
    const storage = new MemoryStorage();
    const first = makeHarness('druid', ['wrath', 'bear_form', 'claw'], bar(), storage);
    const caster = bar();
    caster[32] = { type: 'ability', id: 'wrath' };
    first.controller.replaceActions(caster);
    first.controller.saveActions();

    first.state.auras = ['form_bear'];
    first.controller.syncActiveForm();
    const bear = bar();
    bear[32] = { type: 'ability', id: 'claw' };
    first.controller.replaceActions(bear);
    first.controller.saveActions();

    const reloaded = makeHarness('druid', ['wrath', 'bear_form', 'claw'], bar(), storage);
    reloaded.controller.init();
    expect(reloaded.controller.actions[32]).toEqual({ type: 'ability', id: 'wrath' });

    reloaded.state.auras = ['form_bear'];
    reloaded.controller.syncActiveForm();
    expect(reloaded.controller.actions[32]).toEqual({ type: 'ability', id: 'claw' });
  });

  it('round-trips source slot 20 through the expanded storage model', () => {
    const storage = new MemoryStorage();
    const slot20Bar = bar();
    slot20Bar[19] = { type: 'ability', id: 'sinister_strike' };
    const writer = makeHarness('rogue', ['sinister_strike'], slot20Bar, storage);
    writer.controller.saveActions();

    const reader = makeHarness('rogue', ['sinister_strike'], bar(), storage);
    reader.controller.init();

    expect(reader.controller.actions).toHaveLength(ACTION_BAR_ABILITY_SLOTS);
    expect(reader.controller.actions[19]).toEqual({ type: 'ability', id: 'sinister_strike' });
    expect(reader.controller.actions[20]).toBeNull();
    expect(reader.controller.actions[21]).toBeNull();
  });

  it('keeps Rogue normal and stealth pages independently editable', () => {
    const normal = bar('sinister_strike', 'stealth');
    const stealth = bar('ambush', 'garrote', 'stealth');
    const { controller, state } = makeHarness(
      'rogue',
      ['sinister_strike', 'stealth', 'ambush', 'garrote'],
      normal,
    );

    state.auras = ['stealth'];
    expect(controller.syncActiveForm()).toBe(true);
    expect(controller.activeForm).toBe('stealth');
    expect(controller.actions).toEqual(bar());

    controller.replaceActions(stealth);
    controller.saveActions();
    state.auras = [];
    controller.syncActiveForm();
    expect(controller.actions).toEqual(normal);

    state.auras = ['stealth'];
    controller.syncActiveForm();
    expect(controller.actions).toEqual(stealth);
  });

  it('migrates a legacy Rogue clone to blank without overwriting later customization', () => {
    const normal = bar('sinister_strike', 'stealth');
    const customStealth = bar('garrote', 'stealth');
    const { controller, state, storage } = makeHarness(
      'rogue',
      ['sinister_strike', 'stealth', 'garrote'],
      normal,
    );
    storage.setItem('woc_hotbar_rogue_ActionbarTester_stealth', JSON.stringify(normal));

    state.auras = ['stealth'];
    controller.syncActiveForm();
    expect(controller.actions).toEqual(bar());

    controller.replaceActions(customStealth);
    controller.saveActions();
    state.auras = [];
    controller.syncActiveForm();
    state.auras = ['stealth'];
    controller.syncActiveForm();
    expect(controller.actions).toEqual(customStealth);
  });

  it('preserves customized or byte-distinct legacy stealth pages', () => {
    const normal = bar('sinister_strike', 'stealth');
    const customStealth = bar('garrote', 'stealth');

    const custom = makeHarness('rogue', ['sinister_strike', 'stealth', 'garrote'], normal);
    custom.storage.setItem(
      'woc_hotbar_rogue_ActionbarTester_stealth',
      JSON.stringify(customStealth),
    );
    custom.state.auras = ['stealth'];
    custom.controller.syncActiveForm();
    expect(custom.controller.actions).toEqual(customStealth);

    const encoded = makeHarness('rogue', ['sinister_strike', 'stealth'], normal);
    const legacyEncoded = normal.map((action) => (action?.type === 'ability' ? action.id : action));
    encoded.storage.setItem('woc_hotbar_rogue_ActionbarTester', JSON.stringify(normal));
    encoded.storage.setItem(
      'woc_hotbar_rogue_ActionbarTester_stealth',
      JSON.stringify(legacyEncoded),
    );
    encoded.state.auras = ['stealth'];
    encoded.controller.syncActiveForm();
    expect(encoded.controller.actions).toEqual(normal);
  });

  it('writes the migration marker only after the blank page persists', () => {
    const normal = bar('sinister_strike', 'stealth');
    const normalKey = 'woc_hotbar_rogue_ActionbarTester';
    const stealthKey = `${normalKey}_stealth`;
    const markerKey = `${stealthKey}_blank_v1`;
    const storage = new MemoryStorage();
    storage.setItem(normalKey, JSON.stringify(normal));
    storage.setItem(stealthKey, JSON.stringify(normal));
    const write = storage.setItem.bind(storage);
    const blankJson = JSON.stringify(bar());
    let failBlankWrite = true;
    storage.setItem = (key, value) => {
      if (failBlankWrite && key === stealthKey && value === blankJson) {
        throw new Error('quota exceeded');
      }
      write(key, value);
    };

    const first = makeHarness('rogue', ['sinister_strike', 'stealth'], normal, storage);
    first.state.auras = ['stealth'];
    first.controller.syncActiveForm();
    expect(first.controller.actions).toEqual(bar());
    expect(storage.getItem(markerKey)).toBeNull();

    failBlankWrite = false;
    const retry = makeHarness('rogue', ['sinister_strike', 'stealth'], normal, storage);
    retry.state.auras = ['stealth'];
    retry.controller.syncActiveForm();
    expect(retry.controller.actions).toEqual(bar());
    expect(storage.getItem(markerKey)).toBe('1');
  });

  it('preserves an intentionally empty stealth page when abilities are learned', () => {
    const normal = bar('sinister_strike', 'stealth');
    const { controller, state } = makeHarness('rogue', ['sinister_strike', 'stealth'], normal);
    state.auras = ['stealth'];
    controller.syncActiveForm();
    controller.replaceActions(bar());
    controller.saveActions();
    controller.syncKnownAbilities();

    state.known = ['sinister_strike', 'stealth', 'ambush'];
    controller.syncKnownAbilities();

    expect(controller.actions).toEqual(bar());
  });

  it('keeps Druid caster, Wolf, and stealthed Wolf pages independently editable', () => {
    const caster = bar('wrath', 'moonfire', 'cat_form');
    const wolf = bar('claw', 'rip', 'prowl', 'cat_form');
    const stealthedWolf = bar('pounce', 'rake', 'prowl', 'cat_form');
    const { controller, state } = makeHarness(
      'druid',
      ['wrath', 'moonfire', 'cat_form', 'claw', 'rip', 'prowl', 'rake', 'pounce'],
      caster,
    );

    state.auras = ['form_cat'];
    controller.syncActiveForm();
    expect(controller.activeForm).toBe('cat');
    controller.replaceActions(wolf);
    controller.saveActions();

    state.auras = ['form_cat', 'stealth'];
    controller.syncActiveForm();
    expect(controller.activeForm).toBe('cat_stealth');
    expect(controller.actions).toEqual(bar());
    controller.replaceActions(stealthedWolf);
    controller.saveActions();

    state.auras = ['form_cat'];
    controller.syncActiveForm();
    expect(controller.actions).toEqual(wolf);
    state.auras = [];
    controller.syncActiveForm();
    expect(controller.actions).toEqual(caster);
    state.auras = ['form_cat', 'stealth'];
    controller.syncActiveForm();
    expect(controller.actions).toEqual(stealthedWolf);
  });

  it('migrates a legacy Wolf clone to blank', () => {
    const wolf = bar('claw', 'prowl', 'cat_form');
    const harness = makeHarness('druid', ['cat_form', 'claw', 'prowl', 'rake'], wolf);
    harness.storage.setItem('woc_hotbar_druid_ActionbarTester_cat', JSON.stringify(wolf));
    harness.storage.setItem('woc_hotbar_druid_ActionbarTester_cat_seeded', '1');
    harness.storage.setItem('woc_hotbar_druid_ActionbarTester_cat_stealth', JSON.stringify(wolf));
    harness.state.auras = ['form_cat'];
    harness.controller.syncActiveForm();
    harness.state.auras = ['form_cat', 'stealth'];
    harness.controller.syncActiveForm();

    expect(harness.controller.activeForm).toBe('cat_stealth');
    expect(harness.controller.actions).toEqual(bar());
  });

  it('keeps the sport page ahead of every class stealth page', () => {
    const rogue = makeHarness('rogue', ['stealth'], bar('stealth'));
    rogue.state.sportTeam = 0;
    rogue.state.auras = ['stealth'];
    const druid = makeHarness('druid', ['cat_form', 'prowl'], bar('cat_form'));
    druid.state.sportTeam = 1;
    druid.state.auras = ['form_cat', 'stealth'];

    expect(rogue.controller.resolveActiveForm()).toBe('sport');
    expect(druid.controller.resolveActiveForm()).toBe('sport');
  });

  it('isolates sport abilities from the saved class page', () => {
    const harness = makeHarness('rogue', ['sinister_strike'], bar('sinister_strike'));
    harness.controller.syncKnownAbilities();
    harness.state.known.push('sport_shoot', 'sport_pass');
    harness.controller.syncKnownAbilities();
    expect(harness.controller.actions).toEqual(bar('sinister_strike'));

    harness.state.sportTeam = 0;
    harness.controller.syncActiveForm();
    expect(harness.controller.actions).toEqual(bar('sport_shoot', 'sport_pass'));

    harness.state.sportTeam = null;
    harness.controller.syncActiveForm();
    expect(harness.controller.actions).toEqual(bar('sinister_strike'));
  });

  it('never seeds or auto-populates a stealth form kit', () => {
    const harness = makeHarness('druid', ['wrath', 'cat_form', 'prowl', 'pounce'], bar('wrath'));
    expect(harness.controller.formKitAbilityIds('cat_stealth')).toEqual([]);

    harness.state.auras = ['form_cat', 'stealth'];
    harness.controller.syncActiveForm();
    harness.controller.replaceActions(bar('prowl'));
    harness.controller.syncKnownAbilities();
    harness.state.known.push('moonfire');
    harness.controller.syncKnownAbilities();

    expect(harness.controller.actions).toEqual(bar('prowl'));
  });

  it('keeps a switched loadout layout until the target talent abilities arrive', () => {
    const harness = makeHarness('mage', ['frostbolt', 'ice_lance'], bar('frostbolt', 'ice_lance'));
    const fireLayout = bar();
    fireLayout[5] = { type: 'ability', id: 'pyroblast' };
    fireLayout[10] = { type: 'ability', id: 'fireball_form' };
    const fireKnown = new Set(['fireball', 'pyroblast', 'fireball_form']);

    harness.controller.replaceActionsForLoadout(fireLayout, fireKnown);
    harness.controller.syncKnownAbilities();

    expect(harness.controller.actions[5]).toEqual({ type: 'ability', id: 'pyroblast' });
    expect(harness.controller.actions[10]).toEqual({ type: 'ability', id: 'fireball_form' });

    harness.state.known = [...fireKnown];
    harness.controller.syncKnownAbilities();

    expect(harness.controller.actions).toEqual(fireLayout);
  });
});

describe('ActionBarController owned-class level 20 defaults', () => {
  const beastMasteryKnown = [
    'arcane_shot',
    'pack_command',
    'counter_shot',
    'trailbreak',
    'wildheart',
  ];
  const marksmanshipKnown = [
    'arcane_shot',
    'measured_shot',
    'aimed_shot',
    'rapid_fire',
    'counter_shot',
    'trailbreak',
    'wildheart',
  ];

  it('seeds a new level 20 character in the designed priority order', () => {
    const harness = makeHarness('hunter', beastMasteryKnown, bar());
    harness.state.spec = 'beast_mastery';

    harness.controller.init();
    harness.controller.syncKnownAbilities();

    expect(harness.controller.actions).toEqual(
      bar('pack_command', 'arcane_shot', 'counter_shot', 'trailbreak', 'wildheart'),
    );
  });

  it('replaces an untouched generated bar when the character changes spec', () => {
    const harness = makeHarness('hunter', beastMasteryKnown, bar());
    harness.state.spec = 'beast_mastery';
    harness.controller.init();
    harness.controller.syncKnownAbilities();

    harness.state.spec = 'marksmanship';
    harness.state.known = marksmanshipKnown;
    harness.controller.syncKnownAbilities();

    expect(harness.controller.actions).toEqual(
      bar(
        'measured_shot',
        'aimed_shot',
        'rapid_fire',
        'arcane_shot',
        'counter_shot',
        'trailbreak',
        'wildheart',
      ),
    );
  });

  it('preserves a customized bar through a spec change while removing invalid abilities', () => {
    const harness = makeHarness('hunter', beastMasteryKnown, bar());
    harness.state.spec = 'beast_mastery';
    harness.controller.init();
    harness.controller.syncKnownAbilities();
    harness.controller.replaceActions(
      bar('arcane_shot', 'pack_command', 'wildheart', 'counter_shot', 'trailbreak'),
    );
    harness.controller.saveActions();

    harness.state.spec = 'marksmanship';
    harness.state.known = marksmanshipKnown;
    harness.controller.syncKnownAbilities();

    expect(harness.controller.actions.slice(0, 7)).toEqual([
      { type: 'ability', id: 'arcane_shot' },
      { type: 'ability', id: 'measured_shot' },
      { type: 'ability', id: 'wildheart' },
      { type: 'ability', id: 'counter_shot' },
      { type: 'ability', id: 'trailbreak' },
      { type: 'ability', id: 'aimed_shot' },
      { type: 'ability', id: 'rapid_fire' },
    ]);
    expect(harness.controller.actions.some((action) => action?.id === 'pack_command')).toBe(false);
  });

  it('does not overwrite a stored custom or intentionally empty bar', () => {
    for (const storedBar of [bar('arcane_shot', 'pack_command'), bar()]) {
      const storage = new MemoryStorage();
      storage.setItem('woc_hotbar_hunter_ActionbarTester', JSON.stringify(storedBar));
      const harness = makeHarness('hunter', beastMasteryKnown, bar(), storage);
      harness.state.spec = 'beast_mastery';

      harness.controller.init();
      harness.controller.syncKnownAbilities();

      expect(harness.controller.actions).toEqual(storedBar);
    }
  });

  it('upgrades the untouched learned-order bar when the character reaches level 20', () => {
    const harness = makeHarness('hunter', beastMasteryKnown, bar());
    harness.state.spec = 'beast_mastery';
    harness.state.level = 19;
    harness.controller.init();
    harness.controller.syncKnownAbilities();
    expect(harness.controller.actions).toEqual(bar(...beastMasteryKnown));

    harness.state.level = 20;
    harness.controller.syncKnownAbilities();

    expect(harness.controller.actions).toEqual(
      bar('pack_command', 'arcane_shot', 'counter_shot', 'trailbreak', 'wildheart'),
    );
  });
});

describe('ActionBarController attack slot', () => {
  it('loads, hides, exposes, and removes the persisted freed-slot action', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'woc_hotbar_warrior_ActionbarTester:s0',
      JSON.stringify({ type: 'ability', id: 'strike' }),
    );
    const harness = makeHarness('warrior', ['strike'], bar('strike'), storage);
    harness.controller.init();

    expect(harness.controller.actionForSlot(0)).toBeNull();
    harness.state.showAttackButton = false;
    expect(harness.controller.actionForSlot(0)).toEqual({ type: 'ability', id: 'strike' });

    harness.controller.replaceAttackAction(null);
    harness.controller.saveAttackAction();
    expect(storage.getItem('woc_hotbar_warrior_ActionbarTester:s0')).toBeNull();
  });

  it('reloads a druid form-scoped attack slot on shapeshift instead of leaking the caster slot', () => {
    const harness = makeHarness('druid', ['bear_form', 'cat_form', 'claw', 'mangle'], bar());
    harness.state.showAttackButton = false;
    harness.controller.init();

    harness.controller.replaceAttackAction({ type: 'ability', id: 'mangle' });
    harness.controller.saveAttackAction();
    expect(harness.controller.actionForSlot(0)).toEqual({ type: 'ability', id: 'mangle' });

    harness.state.auras = ['form_bear'];
    harness.controller.syncActiveForm();
    expect(harness.controller.actionForSlot(0)).toBeNull();

    harness.controller.replaceAttackAction({ type: 'ability', id: 'claw' });
    harness.controller.saveAttackAction();
    expect(harness.controller.actionForSlot(0)).toEqual({ type: 'ability', id: 'claw' });
    expect(harness.storage.getItem('woc_hotbar_druid_ActionbarTester_bear:s0')).not.toBeNull();

    harness.state.auras = [];
    harness.controller.syncActiveForm();
    expect(harness.controller.actionForSlot(0)).toEqual({ type: 'ability', id: 'mangle' });

    harness.state.auras = ['form_bear'];
    harness.controller.syncActiveForm();
    expect(harness.controller.actionForSlot(0)).toEqual({ type: 'ability', id: 'claw' });
  });
});

describe('ActionBarController: passives never occupy an action slot', () => {
  it('rejects adding a passive ability (measured_fury), leaving the bar empty', () => {
    const { controller } = makeHarness('warrior', ['measured_fury'], bar());
    expect(controller.addAbility('measured_fury')).toBe(false);
    expect(controller.actions).toEqual(bar());
  });

  it('sweeps a passive left on the bar by an older build when abilities sync', () => {
    // sunder_armor is castable, measured_fury is passive: only the passive is cleared.
    const { controller } = makeHarness(
      'warrior',
      ['sunder_armor', 'measured_fury'],
      bar('sunder_armor', 'measured_fury'),
    );
    controller.syncKnownAbilities();
    expect(controller.actions).toEqual(bar('sunder_armor'));
  });

  it('rejects every warrior passive through direct normal-bar replacement', () => {
    const passives = [
      'diabolical_twinstrike',
      'cleaving_blows',
      'enrage_passive',
      'measured_fury',
      'seasoned_soldier',
      'sudden_death',
      'deep_wounds',
    ];
    const { controller } = makeHarness('warrior', passives, bar());

    controller.replaceActions(bar(...passives));

    expect(controller.actions).toEqual(bar());
  });

  it('cleans and persists a passive from an old saved normal bar during init', () => {
    const storage = new MemoryStorage();
    const key = 'woc_hotbar_warrior_ActionbarTester';
    storage.setItem(key, JSON.stringify(bar('sunder_armor', 'measured_fury')));
    const { controller } = makeHarness(
      'warrior',
      ['sunder_armor', 'measured_fury'],
      bar(),
      storage,
    );

    controller.init();

    expect(controller.actions).toEqual(bar('sunder_armor'));
    expect(JSON.parse(storage.getItem(key) ?? 'null')).toEqual(bar('sunder_armor'));
  });

  it('migrates removed Paladin abilities out of a persisted bar without moving valid slots', () => {
    const storage = new MemoryStorage();
    const key = 'woc_hotbar_paladin_ActionbarTester';
    storage.setItem(key, JSON.stringify(bar('holy_light', 'flash_of_light')));
    const { controller } = makeHarness('paladin', ['holy_light', 'flash_of_light'], bar(), storage);

    controller.init();

    expect(controller.actions).toEqual(bar('holy_light'));
    expect(JSON.parse(storage.getItem(key) ?? 'null')).toEqual(bar('holy_light'));
  });

  it('rejects direct slot 0 assignment of a passive', () => {
    const { controller } = makeHarness('warrior', ['measured_fury'], bar());

    controller.replaceAttackAction({ type: 'ability', id: 'measured_fury' });

    expect(controller.attackAction).toBeNull();
  });

  it('rejects passive drag payloads for both normal and configurable slot 0 drops', () => {
    const { controller } = makeHarness('warrior', ['measured_fury', 'sunder_armor'], bar());

    expect(controller.isAssignableAction({ type: 'ability', id: 'measured_fury' })).toBe(false);
    expect(controller.isAssignableAction({ type: 'ability', id: 'sunder_armor' })).toBe(true);
  });

  it('cleans a passive persisted in configurable slot 0 during init', () => {
    const storage = new MemoryStorage();
    const key = 'woc_hotbar_warrior_ActionbarTester:s0';
    storage.setItem(key, JSON.stringify({ type: 'ability', id: 'measured_fury' }));
    const { controller } = makeHarness('warrior', ['measured_fury'], bar(), storage);

    controller.init();

    expect(controller.attackAction).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });
});

describe('ActionBarController persistence seam', () => {
  function persistHarness(): {
    controller: ActionBarController;
    storage: MemoryStorage;
    persisted: ActionBarLayout[];
  } {
    const storage = new MemoryStorage();
    const persisted: ActionBarLayout[] = [];
    const controller = new ActionBarController({
      storage,
      playerClass: 'warrior',
      playerName: 'ActionbarTester',
      playerLevel: () => 20,
      talentSpec: () => null,
      knownAbilityIds: () => ['heroic_strike', 'sunder_armor'],
      hasAura: () => false,
      isInSportMatch: () => false,
      showAttackButton: () => true,
      persistLayout: (layout) => persisted.push(layout),
    });
    return { controller, storage, persisted };
  }

  it('does NOT persist while loading during init (only user changes upload)', () => {
    const { controller, persisted } = persistHarness();
    controller.init();
    expect(persisted).toEqual([]);
  });

  it('persists the full captured layout on a user-driven save after init', () => {
    const { controller, persisted } = persistHarness();
    controller.init();
    controller.replaceActions(bar('heroic_strike'));
    controller.saveActions();
    expect(persisted).toHaveLength(1);
    expect(persisted[0].forms.normal?.bar[0]).toEqual({ type: 'ability', id: 'heroic_strike' });
  });

  it('does NOT persist while re-seeding from storage in reload (server-wins restore)', () => {
    const { controller, storage, persisted } = persistHarness();
    controller.init();
    persisted.length = 0;
    // Simulate a server layout landing in the mirror, then a reload.
    storage.setItem('woc_hotbar_warrior_ActionbarTester', JSON.stringify(bar('sunder_armor')));
    controller.reload();
    expect(persisted).toEqual([]);
    expect(controller.actions[0]).toEqual({ type: 'ability', id: 'sunder_armor' });
  });

  it('keeps offline localStorage behavior byte-identical when no persistLayout is wired', () => {
    const storage = new MemoryStorage();
    const controller = new ActionBarController({
      storage,
      playerClass: 'warrior',
      playerName: 'ActionbarTester',
      playerLevel: () => 20,
      talentSpec: () => null,
      knownAbilityIds: () => ['heroic_strike'],
      hasAura: () => false,
      isInSportMatch: () => false,
      showAttackButton: () => true,
      // no persistLayout: offline arm
    });
    controller.init();
    controller.replaceActions(bar('heroic_strike'));
    expect(() => controller.saveActions()).not.toThrow();
    expect(JSON.parse(storage.getItem('woc_hotbar_warrior_ActionbarTester') ?? 'null')[0]).toEqual({
      type: 'ability',
      id: 'heroic_strike',
    });
  });
});

describe('isHotbarItemId: gathering implements are placeable (#2343)', () => {
  it('admits every gathering implement shape alongside the consumable kinds', () => {
    const { controller } = makeHarness('warrior', [], []);
    // Gathering tools (picks/axes/sickles) and the tiered rods are gatherTool
    // items; the simple pole rides the pre-existing use.type 'fishing' arm.
    expect(controller.isHotbarItemId('copper_mining_pick')).toBe(true);
    expect(controller.isHotbarItemId('silverstream_fishing_rod')).toBe(true);
    expect(controller.isHotbarItemId('simple_fishing_pole')).toBe(true);
    // Regression companions: the consumable arms and the non-usable negative.
    expect(controller.isHotbarItemId('lesser_healing_potion')).toBe(true);
    expect(controller.isHotbarItemId('copper_ore')).toBe(false);
  });
});

describe('isHotbarItemId: reins are placeable now that mounts are items', () => {
  // The mounts-as-items pivot made every reins item usable through the same
  // useItem dispatch a potion rides (src/sim/items.ts, kind 'mount' ->
  // summonMountItem), and that arm's own comment states reins are used from
  // "bags or an action-bar slot". isHotbarItemId was never widened to match, so
  // the bag drag never wrote a hotbar payload and the bar could not accept it.
  it('admits every kind:mount reins item in the shipped content tables', () => {
    const { controller } = makeHarness('warrior', [], []);
    const reins = Object.keys(ITEMS).filter((id) => ITEMS[id]?.kind === 'mount');
    // Guard the guard: if the content tables ever stop shipping mounts this test
    // must fail loudly rather than vacuously pass on an empty list.
    expect(reins.length).toBeGreaterThan(0);
    for (const id of reins) {
      expect(controller.isHotbarItemId(id), `${id} should be hotbar placeable`).toBe(true);
    }
  });

  it('routes a reins drag through the assignable-action path like a potion', () => {
    const { controller } = makeHarness('warrior', [], []);
    // isAssignableAction is what the drop target consults; a reins action must
    // survive it exactly as a potion action does.
    expect(controller.isAssignableAction({ type: 'item', id: 'reins_valorsteed' })).toBe(true);
    expect(controller.isAssignableAction({ type: 'item', id: 'lesser_healing_potion' })).toBe(true);
    // A non-usable material still must not be assignable.
    expect(controller.isAssignableAction({ type: 'item', id: 'copper_ore' })).toBe(false);
  });
});
