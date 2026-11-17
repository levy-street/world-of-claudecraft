// The Trinket spell on the action bar (src/ui/hud/action_bar/trinket_spell_core.ts
// and its action_bar_view.ts arm): the slot presents as the worn trinket, with
// that trinket's icon, name and cooldown, follows a swap, and dims with the
// spell's own icon when nothing usable is worn.
import { describe, expect, it } from 'vitest';
import { emptyAllocation } from '../src/sim/content/talents';
import { TRINKET_SPELL_ID } from '../src/sim/content/trinket_spell';
import { TRINKET_ITEMS, TRINKET_SPECS, trinketCooldownKey } from '../src/sim/content/trinkets';
import { withTrinketSpell } from '../src/sim/trinket_spell';
import {
  type ActionBarDeps,
  type ActionBarWorldInput,
  createActionBarView,
} from '../src/ui/hud/action_bar/action_bar_view';
import { loadoutKnownAbilityIds, syncHotbarActions } from '../src/ui/hud/action_bar/hotbar';
import { trinketSpellItem } from '../src/ui/hud/action_bar/trinket_spell_core';

const LODESTONE = 'wayfarers_lodestone';
const LENS = 'echoing_lens';

function deps(): ActionBarDeps {
  return {
    t: (key, params) => `${key} ${JSON.stringify(params ?? {})}`,
    abilityName: (def) => `ability:${def.id}`,
    itemName: (item) => `item:${item.id}`,
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

function spellView() {
  const [known] = withTrinketSpell([]);
  return createActionBarView(
    {
      slots: [
        {
          slotIndex: 1,
          isAttack: () => false,
          hasAction: () => true,
          ability: () => known,
          item: () => null,
          keybindLabel: () => '1',
        },
      ],
    },
    deps(),
  );
}

const spellSlot = (w: ActionBarWorldInput) => spellView().tick(w).slots[0];

describe('what the Trinket spell presents as', () => {
  it('is the worn trinket, for the Trinket spell only', () => {
    expect(trinketSpellItem(TRINKET_SPELL_ID, LODESTONE)).toBe(TRINKET_ITEMS[LODESTONE]);
    expect(trinketSpellItem(TRINKET_SPELL_ID, LENS)).toBe(TRINKET_ITEMS[LENS]);
    // Every other ability presents as itself, whatever is worn.
    expect(trinketSpellItem('heroic_strike', LODESTONE)).toBeNull();
    expect(trinketSpellItem(null, LODESTONE)).toBeNull();
    expect(trinketSpellItem(undefined, LODESTONE)).toBeNull();
  });

  it('is itself with an empty trinket slot or a non-trinket in it', () => {
    expect(trinketSpellItem(TRINKET_SPELL_ID, null)).toBeNull();
    expect(trinketSpellItem(TRINKET_SPELL_ID, undefined)).toBeNull();
    expect(trinketSpellItem(TRINKET_SPELL_ID, 'minor_healing_potion')).toBeNull();
  });
});

describe('the Trinket spell slot', () => {
  it('takes the worn trinket icon and name, usable, with no bag count', () => {
    const slot = spellSlot(world({ worn: LODESTONE }));
    // Still an ability slot (a press casts the spell, and the cooldown manager
    // tracks it), wearing the trinket's icon.
    expect(slot.kind).toBe('ability');
    expect(slot.abilityId).toBe(TRINKET_SPELL_ID);
    expect(slot.itemId).toBeNull();
    expect(slot.iconKey).toBe(`item:${LODESTONE}`);
    expect(slot.ariaLabel).toContain(`item:${LODESTONE}`);
    expect(slot.usable).toBe(true);
    // Worn, not carried: no "0" badge even with none in the bags.
    expect(slot.count).toBe('');
    expect(slot.cooldownPercent).toBe(0);
  });

  it("paints the swipe and number from the worn trinket's own cooldown", () => {
    const cd = TRINKET_SPECS[LODESTONE].cooldown;
    const slot = spellSlot(
      world({ worn: LODESTONE, cooldowns: new Map([[trinketCooldownKey(LODESTONE), 45]]) }),
    );
    expect(slot.cooldownRemaining).toBe(45);
    expect(slot.cooldownTotal).toBe(cd);
    expect(slot.cooldownPercent).toBeCloseTo((45 / cd) * 100, 5);
    expect(slot.cdText).toBe('45');
  });

  it('follows the trinket slot: a swap changes the icon and the cooldown read', () => {
    const view = spellView();
    const cooldowns = new Map([[trinketCooldownKey(LODESTONE), 45]]);
    const w = world({ worn: LODESTONE, cooldowns });
    expect(view.tick(w).slots[0].iconKey).toBe(`item:${LODESTONE}`);
    expect(view.tick(w).slots[0].cooldownRemaining).toBe(45);
    // Equip a different trinket: same slot, same view, the next frame.
    w.wornTrinketId = LENS;
    const swapped = view.tick(w).slots[0];
    expect(swapped.iconKey).toBe(`item:${LENS}`);
    expect(swapped.ariaLabel).toContain(`item:${LENS}`);
    // The trinket taken off still cools down, but that is not this slot's read.
    expect(swapped.cooldownRemaining).toBe(0);
    // Take it off entirely: back to the spell's own, dimmed icon.
    w.wornTrinketId = null;
    const bare = view.tick(w).slots[0];
    expect(bare.kind).toBe('ability');
    expect(bare.iconKey).toBe(`ability:${TRINKET_SPELL_ID}`);
    expect(bare.usable).toBe(false);
  });

  it('dims with its own icon while no usable trinket is worn', () => {
    const slot = spellSlot(world({ worn: null }));
    expect(slot.kind).toBe('ability');
    expect(slot.abilityId).toBe(TRINKET_SPELL_ID);
    expect(slot.itemId).toBeNull();
    expect(slot.iconKey).toBe(`ability:${TRINKET_SPELL_ID}`);
    expect(slot.usable).toBe(false);
    expect(slot.ariaLabel).toContain(`ability:${TRINKET_SPELL_ID}`);
    expect(slot.cooldownPercent).toBe(0);
  });

  it('dims for a dead player', () => {
    expect(spellSlot(world({ worn: LODESTONE, dead: true })).usable).toBe(false);
  });
});

describe('keeping the Trinket spell on the bar', () => {
  it('stays known through a talent loadout switch, for every build', () => {
    expect(loadoutKnownAbilityIds('warrior', emptyAllocation(), 20).has(TRINKET_SPELL_ID)).toBe(
      true,
    );
    expect(loadoutKnownAbilityIds('priest', emptyAllocation(), 1).has(TRINKET_SPELL_ID)).toBe(true);
  });

  it('a known-ability sync keeps a placed Trinket spell and never auto-places one', () => {
    const placed = [{ type: 'ability' as const, id: TRINKET_SPELL_ID }, null];
    const kept = syncHotbarActions(placed, [TRINKET_SPELL_ID], new Set());
    expect(kept.actions).toEqual(placed);
    expect(kept.changed).toBe(false);
    // Known but not in the auto-place set (the controller excludes it): the
    // bar stays as the player left it.
    const empty = syncHotbarActions([null, null], [TRINKET_SPELL_ID], new Set());
    expect(empty.actions).toEqual([null, null]);
  });
});
