// A trinket on the action bar (src/ui/hud/action_bar/trinket_slot_core.ts and its
// consumer, the item arm of action_bar_view.ts): usable while it is the worn
// trinket (never greyed or counted "0" for sitting in the paperdoll instead of the
// bags), its swipe and number driven by its own trinket:<id> cooldown, dimmed when
// it is only in the bags or gone. Plus the drag payload helpers the paperdoll's
// trinket drag and the bar share (hotbar.ts).
import { describe, expect, it } from 'vitest';
import { TRINKET_ITEMS, TRINKET_SPECS, trinketCooldownKey } from '../src/sim/content/trinkets';
import type { ItemDef } from '../src/sim/types';
import {
  type ActionBarDeps,
  type ActionBarWorldInput,
  createActionBarView,
} from '../src/ui/hud/action_bar/action_bar_view';
import {
  HOTBAR_ACTION_MIME,
  readHotbarDragData,
  writeHotbarDragData,
} from '../src/ui/hud/action_bar/hotbar';
import { itemInBagsLine } from '../src/ui/hud/action_bar/item_bags_line_core';
import { isUsableTrinketId, trinketSlotState } from '../src/ui/hud/action_bar/trinket_slot_core';

const ID = 'stormjar';
const KEY = trinketCooldownKey(ID);
const CD = TRINKET_SPECS[ID].cooldown;

describe('trinketSlotState', () => {
  it('is null for anything but a usable trinket', () => {
    expect(trinketSlotState('lesser_healing_potion', null, new Map())).toBeNull();
    expect(isUsableTrinketId('lesser_healing_potion')).toBe(false);
    for (const id of Object.keys(TRINKET_ITEMS)) expect(isUsableTrinketId(id)).toBe(true);
  });

  it('is worn only when it is the trinket in the slot', () => {
    expect(trinketSlotState(ID, ID, new Map())).toEqual({
      worn: true,
      cooldownRemaining: 0,
      cooldownTotal: 0,
    });
    expect(trinketSlotState(ID, 'echoing_lens', new Map())?.worn).toBe(false);
    expect(trinketSlotState(ID, null, new Map())?.worn).toBe(false);
  });

  it('reads its own trinket:<id> cooldown, full length from the spec', () => {
    const state = trinketSlotState(ID, ID, new Map([[KEY, 30]]));
    expect(state).toEqual({ worn: true, cooldownRemaining: 30, cooldownTotal: CD });
    // Another trinket's cooldown is not this one's.
    expect(trinketSlotState(ID, ID, new Map([[trinketCooldownKey('echoing_lens'), 30]]))).toEqual({
      worn: true,
      cooldownRemaining: 0,
      cooldownTotal: 0,
    });
  });
});

function deps(): ActionBarDeps {
  return {
    t: (key) => key,
    abilityName: (def) => def.id,
    itemName: (item) => item.id,
    slotLabel: (i) => String(i + 1),
    formatCount: (n) => String(n),
  };
}

function world(opts: {
  worn: string | null;
  cooldowns?: Map<string, number>;
  inventory?: { itemId: string; count: number }[];
  dead?: boolean;
}): ActionBarWorldInput {
  return {
    player: {
      id: 1,
      autoAttack: false,
      dead: opts.dead ?? false,
      resource: 100,
      resourceType: 'mana',
      savedMana: 0,
      cooldowns: opts.cooldowns ?? new Map(),
      gcdRemaining: 0,
      potionCdRemaining: 0,
      queuedOnSwing: null,
      pos: { x: 0, y: 0, z: 0 },
      auras: [],
    },
    target: null,
    inventory: opts.inventory ?? [],
    wornTrinketId: opts.worn,
    stealthed: false,
    fateThreads: 0,
    entities: [],
    activeAimSlot: null,
  };
}

function trinketSlot(w: ActionBarWorldInput) {
  const view = createActionBarView(
    {
      slots: [
        {
          slotIndex: 1,
          isAttack: () => false,
          hasAction: () => true,
          ability: () => null,
          item: () => TRINKET_ITEMS[ID] as ItemDef,
          keybindLabel: () => '1',
        },
      ],
    },
    deps(),
  );
  return view.tick(w).slots[0];
}

describe('a trinket on the action bar', () => {
  it('is usable with no bag count while worn, even with none in the bags', () => {
    const slot = trinketSlot(world({ worn: ID }));
    expect(slot.kind).toBe('item');
    expect(slot.usable).toBe(true);
    expect(slot.count).toBe('');
    expect(slot.cooldownPercent).toBe(0);
    expect(slot.cdText).toBe('');
  });

  it('paints the swipe and number from its own cooldown', () => {
    const slot = trinketSlot(world({ worn: ID, cooldowns: new Map([[KEY, 45]]) }));
    expect(slot.usable).toBe(true);
    expect(slot.cooldownRemaining).toBe(45);
    expect(slot.cooldownTotal).toBe(CD);
    expect(slot.cooldownPercent).toBeCloseTo((45 / CD) * 100, 5);
    expect(slot.cdText).toBe('45');
  });

  it('is dimmed when it only sits in the bags, and when it is gone', () => {
    const inBags = trinketSlot(world({ worn: null, inventory: [{ itemId: ID, count: 1 }] }));
    expect(inBags.usable).toBe(false);
    expect(inBags.count).toBe('1');
    const gone = trinketSlot(world({ worn: 'echoing_lens' }));
    expect(gone.usable).toBe(false);
    expect(gone.count).toBe('0');
  });

  it('is dimmed while the player is dead', () => {
    expect(trinketSlot(world({ worn: ID, dead: true })).usable).toBe(false);
  });

  it('the hover says Equipped instead of a bag count for the worn trinket', () => {
    expect(itemInBagsLine(0, true)).toContain('Equipped');
    expect(itemInBagsLine(0)).not.toContain('Equipped');
  });
});

describe('the shared hotbar drag payload', () => {
  it('round-trips an item action and ignores a drag without one', () => {
    const data = new Map<string, string>();
    const dt = {
      setData: (k: string, v: string) => void data.set(k, v),
      getData: (k: string) => data.get(k) ?? '',
    };
    writeHotbarDragData(dt, { type: 'item', id: ID });
    expect(data.get('text/plain')).toBe(ID);
    expect(data.has(HOTBAR_ACTION_MIME)).toBe(true);
    const yes = () => true;
    expect(readHotbarDragData(dt, yes, yes)).toEqual({ type: 'item', id: ID });
    expect(readHotbarDragData(dt, yes, () => false)).toBeNull();
    expect(readHotbarDragData({ getData: () => '' }, yes, yes)).toBeNull();
    expect(readHotbarDragData({ getData: () => '{not json' }, yes, yes)).toBeNull();
    expect(readHotbarDragData(null, yes, yes)).toBeNull();
  });
});
