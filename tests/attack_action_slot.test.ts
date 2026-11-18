// Attack as a placeable action-bar action. The basic Attack used to live only on
// bar slot 0 behind the "Show Attack Button" setting, so a player who wanted it on
// another key could not have it. It is now an `attack` slot action like a pet
// command: dragged from the spellbook onto any slot, it toggles auto-attack from
// that slot's key, survives a save, a reload, a build switch and the server
// layout round trip, and drags between slots like any other binding.

import { describe, expect, it } from 'vitest';
import type { PlayerClass } from '../src/sim/types';
import {
  ACTION_BAR_ABILITY_SLOTS,
  ActionBarController,
} from '../src/ui/hud/action_bar/action_bar_controller';
import {
  ATTACK_HOTBAR_ACTION,
  applyLoadoutBar,
  attackDragDisposition,
  barSlotRunsAttack,
  HOTBAR_ACTION_MIME,
  HOTBAR_ATTACK_MIME,
  type HotbarAction,
  parseHotbarAction,
  parseHotbarActions,
  placeCopiedActionOnSlot,
} from '../src/ui/hud/action_bar/hotbar';
import { readDraggedAction, writeDraggedAction } from '../src/ui/hud/action_bar/hotbar_drag';
import { crossHotbarSeedActions } from '../src/ui/hud/cross_hotbar/cross_hotbar_controller';
import { sanitizeActionBarLayout } from '../src/world_api/action_bar';

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

function emptyBar(): HotbarAction[] {
  return Array.from({ length: ACTION_BAR_ABILITY_SLOTS }, () => null);
}

// The press/paint rule the Hud runs, fed from the controller's own state.
function runsAttack(controller: ActionBarController, barSlot: number): boolean {
  return barSlotRunsAttack(
    barSlot === 0 && controller.isAttackSlotFixed(),
    controller.actionForSlot(barSlot),
  );
}

function makeController(
  playerClass: PlayerClass,
  known: string[],
  storage = new MemoryStorage(),
  showAttackButton = true,
) {
  const state = { showAttackButton };
  const controller = new ActionBarController({
    storage,
    playerClass,
    playerName: 'AttackPlacer',
    playerLevel: () => 20,
    talentSpec: () => null,
    talentAllocation: () => ({ spec: null, rows: {} }),
    knownAbilityIds: () => known,
    hasAura: () => false,
    showAttackButton: () => state.showAttackButton,
  });
  return { controller, storage, state };
}

const noAbility = () => false;
const noItem = () => false;

describe('the attack slot action', () => {
  it('parses only the one attack action, never an attack with another id', () => {
    expect(parseHotbarAction({ type: 'attack', id: 'attack' }, noAbility, noItem)).toEqual(
      ATTACK_HOTBAR_ACTION,
    );
    expect(parseHotbarAction({ type: 'attack', id: 'fireball' }, noAbility, noItem)).toBeNull();
    // A stored bar keeps it alongside abilities.
    const parsed = parseHotbarActions(
      [
        { type: 'ability', id: 'fireball' },
        { type: 'attack', id: 'attack' },
      ],
      3,
      (id) => id === 'fireball',
      noItem,
    );
    expect(parsed).toEqual([{ type: 'ability', id: 'fireball' }, ATTACK_HOTBAR_ACTION, null]);
  });

  it('copies onto a slot, so it can sit on more than one key', () => {
    const once = placeCopiedActionOnSlot(emptyBar(), ATTACK_HOTBAR_ACTION, 4);
    const twice = placeCopiedActionOnSlot(once, ATTACK_HOTBAR_ACTION, 9);
    expect(twice[4]).toEqual(ATTACK_HOTBAR_ACTION);
    expect(twice[9]).toEqual(ATTACK_HOTBAR_ACTION);
    expect(placeCopiedActionOnSlot(emptyBar(), ATTACK_HOTBAR_ACTION, 99)).toEqual(emptyBar());
  });

  it('survives a saved build switch like an item or pet command does', () => {
    const current = placeCopiedActionOnSlot(emptyBar(), ATTACK_HOTBAR_ACTION, 2);
    const next = applyLoadoutBar(
      current,
      Array(ACTION_BAR_ABILITY_SLOTS).fill(null),
      33,
      noAbility,
    );
    expect(next[2]).toEqual(ATTACK_HOTBAR_ACTION);
  });

  it('rides the server layout shape check (the wire save and the login restore)', () => {
    const layout = sanitizeActionBarLayout({
      v: 1,
      forms: {
        normal: {
          bar: [{ type: 'attack', id: 'attack' }, null],
          attack: { type: 'attack', id: 'attack' },
        },
      },
    });
    expect(layout?.forms.normal?.bar[0]).toEqual({ type: 'attack', id: 'attack' });
    expect(layout?.forms.normal?.attack).toEqual({ type: 'attack', id: 'attack' });
    // Still rejects a type nobody knows.
    const bad = sanitizeActionBarLayout({
      v: 1,
      forms: { normal: { bar: [{ type: 'macro', id: 'attack' }] } },
    });
    expect(bad?.forms.normal?.bar[0]).toBeNull();
  });
});

describe('barSlotRunsAttack (the per-frame paint and press rule)', () => {
  it('is true for the fixed slot 0 or any slot holding Attack, and nothing else', () => {
    expect(barSlotRunsAttack(true, null)).toBe(true);
    expect(barSlotRunsAttack(false, ATTACK_HOTBAR_ACTION)).toBe(true);
    expect(barSlotRunsAttack(false, null)).toBe(false);
    expect(barSlotRunsAttack(false, { type: 'ability', id: 'heroic_strike' })).toBe(false);
    expect(barSlotRunsAttack(false, { type: 'pet', id: 'attack' })).toBe(false);
  });
});

describe('ActionBarController with a placed attack', () => {
  it('accepts it as assignable and reports which slots run Attack', () => {
    const { controller } = makeController('warrior', ['heroic_strike']);
    controller.init();
    expect(controller.isAssignableAction(ATTACK_HOTBAR_ACTION)).toBe(true);
    controller.replaceActions(placeCopiedActionOnSlot(emptyBar(), ATTACK_HOTBAR_ACTION, 5));
    expect(runsAttack(controller, 6)).toBe(true); // bar slot 6 is configurable index 5
    expect(runsAttack(controller, 5)).toBe(false);
    // The fixed Attack button on slot 0 still counts while the setting is on.
    expect(runsAttack(controller, 0)).toBe(true);
  });

  it('frees slot 0 when the setting is off, and lets the freed slot hold Attack too', () => {
    const { controller, state } = makeController('warrior', ['heroic_strike']);
    state.showAttackButton = false;
    controller.init();
    expect(runsAttack(controller, 0)).toBe(false);
    controller.replaceAttackAction(ATTACK_HOTBAR_ACTION);
    expect(controller.actionForSlot(0)).toEqual(ATTACK_HOTBAR_ACTION);
    expect(runsAttack(controller, 0)).toBe(true);
  });

  it('keeps the placed attack across a save and a fresh load', () => {
    const storage = new MemoryStorage();
    const first = makeController('warrior', ['heroic_strike'], storage).controller;
    first.init();
    first.replaceActions(placeCopiedActionOnSlot(emptyBar(), ATTACK_HOTBAR_ACTION, 7));
    first.saveActions();
    const second = makeController('warrior', ['heroic_strike'], storage).controller;
    second.init();
    expect(second.actionForSlot(8)).toEqual(ATTACK_HOTBAR_ACTION);
    expect(runsAttack(second, 8)).toBe(true);
  });
});

describe('dragging Attack from the spellbook', () => {
  function fakeDataTransfer() {
    const data = new Map<string, string>();
    return {
      setData: (k: string, v: string) => void data.set(k, v),
      getData: (k: string) => data.get(k) ?? '',
      get types() {
        return [...data.keys()];
      },
    } as unknown as DataTransfer;
  }

  it('carries a placeable attack for any slot and still restores the button on slot 0', () => {
    const dt = fakeDataTransfer();
    dt.setData(HOTBAR_ATTACK_MIME, '1');
    writeDraggedAction(dt, ATTACK_HOTBAR_ACTION);
    expect(dt.types).toContain(HOTBAR_ACTION_MIME);
    expect(readDraggedAction(dt, { ability: noAbility, item: noItem })).toEqual(
      ATTACK_HOTBAR_ACTION,
    );
    // Slot 0 keeps its restore-the-button drop; every other slot takes the action.
    expect(attackDragDisposition(dt.types, 0, 'drop')).toBe('restore');
    expect(attackDragDisposition(dt.types, 4, 'drop')).toBe('ignore');
  });
});

describe('controller cross hotbar seed', () => {
  it('seeds an empty cell for a placed attack (the pad already gets Attack as an extra)', () => {
    const seed = crossHotbarSeedActions([ATTACK_HOTBAR_ACTION, { type: 'item', id: 'x' }], []);
    expect(seed.bar).toEqual([null, { type: 'item', id: 'x' }]);
    expect(seed.extras[0]).toBe('attack');
  });
});
