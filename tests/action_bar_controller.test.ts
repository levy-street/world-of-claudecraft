import { describe, expect, it } from 'vitest';
import type { PlayerClass } from '../src/sim/types';
import {
  ACTION_BAR_ABILITY_SLOTS,
  ActionBarController,
} from '../src/ui/hud/action_bar/action_bar_controller';
import type { HotbarAction } from '../src/ui/hud/action_bar/hotbar';

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
    auras: [],
    sportTeam: undefined,
    showAttackButton: true,
  };
  const controller = new ActionBarController({
    storage,
    playerClass,
    playerName: 'ActionbarTester',
    knownAbilityIds: () => state.known,
    hasAura: (kind) => state.auras.includes(kind),
    isInSportMatch: () => state.sportTeam !== undefined && state.sportTeam !== null,
    showAttackButton: () => state.showAttackButton,
  });
  controller.replaceActions(initialBar);
  return { controller, state, storage };
}

describe('ActionBarController form persistence', () => {
  it('keeps the public bar contract at one attack slot plus 22 configurable slots', () => {
    expect(ACTION_BAR_ABILITY_SLOTS).toBe(22);
  });

  it('round-trips source slot 20 through the existing 22-slot storage model', () => {
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
