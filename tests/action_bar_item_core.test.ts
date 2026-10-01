import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { ItemDef } from '../src/sim/types';
import { ActionBarController } from '../src/ui/hud/action_bar/action_bar_controller';
import { isActionBarItem } from '../src/ui/hud/action_bar/action_bar_item_core';
import {
  placeItemOnSlot,
  readHotbarDragData,
  writeHotbarDragData,
} from '../src/ui/hud/action_bar/hotbar';

describe('action bar item eligibility', () => {
  it.each(['food', 'drink', 'potion', 'elixir', 'flask', 'scroll', 'mount', 'recipe'])(
    'accepts every shipped %s item',
    (kind) => {
      const items = Object.values(ITEMS).filter((item) => item.kind === kind);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) expect(isActionBarItem(item), item.id).toBe(true);
    },
  );

  it('accepts every shipped trinket with an active effect', () => {
    const items = Object.values(ITEMS).filter((item) => item.slot === 'trinket');
    expect(items.length).toBeGreaterThanOrEqual(13);
    for (const item of items) expect(isActionBarItem(item), item.id).toBe(true);
  });

  it('accepts usable quest items, containers, cosmetics, deployables, and tools', () => {
    const items = Object.values(ITEMS).filter(
      (item) => item.use !== undefined && item.use.type !== 'toolEffect',
    );
    expect(items.length).toBeGreaterThanOrEqual(20);
    for (const item of items) expect(isActionBarItem(item), item.id).toBe(true);
  });

  it('accepts placeable feasts even though they are junk without a use tag', () => {
    const feast = ITEMS.harvest_feast;
    expect(feast.kind).toBe('junk');
    expect(feast.use).toBeUndefined();
    expect('feast' in feast && feast.feast).toBeTruthy();
    expect(isActionBarItem(feast)).toBe(true);
    const items = Object.values(ITEMS).filter((item) => 'feast' in item && item.feast);
    expect(items.length).toBeGreaterThanOrEqual(4);
    for (const item of items) expect(isActionBarItem(item), item.id).toBe(true);
  });

  it.each(['copper_ore', 'wolf_fang', 'rusty_dagger'])('rejects inert item %s', (id) => {
    expect(ITEMS[id]).toBeDefined();
    expect(isActionBarItem(ITEMS[id])).toBe(false);
  });

  it('rejects profession charms that require slotting rather than item use', () => {
    const charms = Object.values(ITEMS).filter((item) => item.use?.type === 'toolEffect');
    expect(charms.length).toBeGreaterThan(0);
    for (const item of charms) expect(isActionBarItem(item), item.id).toBe(false);
    expect(isActionBarItem(undefined)).toBe(false);
  });

  it('allows a new directly usable item without extending a kind whitelist', () => {
    const item = {
      id: 'future_usable_item',
      name: 'Future usable item',
      kind: 'quest',
      quality: 'common',
      sellValue: 0,
      use: { type: 'container', container: 'emissary_cache' },
    } satisfies ItemDef;
    expect(isActionBarItem(item)).toBe(true);
    const { use: _use, ...inert } = item;
    expect(isActionBarItem(inert)).toBe(false);
  });
});

function controllerHarness() {
  const stored = new Map<string, string>();
  const controller = () =>
    new ActionBarController({
      storage: {
        getItem: (key) => stored.get(key) ?? null,
        setItem: (key, value) => void stored.set(key, value),
        removeItem: (key) => void stored.delete(key),
      },
      playerClass: 'warrior',
      playerName: 'ConsumableTester',
      playerLevel: () => 1,
      talentSpec: () => null,
      knownAbilityIds: () => [],
      hasAura: () => false,
      showAttackButton: () => false,
    });
  return controller;
}

const SHORTCUT_ITEMS = [
  'lesser_healing_potion',
  'stormjar',
  'ironhusk_flask',
  'silverleaf_scroll',
  'pattern_spiritweld_girdle',
  'dense_sharpening_stone',
  'emissary_cache',
  'harvest_feast',
];

describe('item shortcut placement and persistence', () => {
  it.each(SHORTCUT_ITEMS)('drops %s on any row and restores it after reload', (id) => {
    const makeController = controllerHarness();
    const controller = makeController();
    controller.init();
    expect(controller.isAssignableAction({ type: 'item', id })).toBe(true);

    const payload = new Map<string, string>();
    const transfer = {
      setData: (key: string, value: string) => void payload.set(key, value),
      getData: (key: string) => payload.get(key) ?? '',
    };
    writeHotbarDragData(transfer, { type: 'item', id });
    const dragged = readHotbarDragData(
      transfer,
      () => false,
      (itemId) => controller.isHotbarItemId(itemId),
    );
    expect(dragged).toEqual({ type: 'item', id });
    if (!dragged) throw new Error('Expected an accepted item drag');
    for (const index of [0, 11, 32]) {
      controller.replaceActions(placeItemOnSlot(controller.actions, dragged.id, index));
    }
    controller.saveActions();
    controller.replaceAttackAction(dragged);
    controller.saveAttackAction();

    const restored = makeController();
    restored.init();
    restored.syncKnownAbilities();
    for (const slot of [0, 1, 12, 33]) {
      expect(restored.actionForSlot(slot)).toEqual({ type: 'item', id });
    }
  });

  it.each(['missing_item', 'constructor', '__proto__', 'copper_ore', 'rusty_dagger'])(
    'refuses new placement of %s',
    (id) => {
      const controller = controllerHarness()();
      expect(controller.isHotbarItemId(id)).toBe(false);
      expect(controller.isAssignableAction({ type: 'item', id })).toBe(false);
    },
  );
});
