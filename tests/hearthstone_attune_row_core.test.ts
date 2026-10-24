// The quest dialog's Allied Hearthstone attune row decision
// (src/ui/hud/quest/hearthstone_attune_row_core.ts): offered only by a faction
// quartermaster, only to a viewer carrying the stone, and never when the stone
// is already bound to that quartermaster's hub.

import { describe, expect, it } from 'vitest';
import { hearthstoneAttuneRowFaction } from '../src/ui/hud/quest/hearthstone_attune_row_core';

const STONE = [
  { itemId: 'linen_cloth', count: 3 },
  { itemId: 'allied_hearthstone', count: 1 },
];

describe('hearthstoneAttuneRowFaction', () => {
  it('names each quartermaster hub for a viewer holding the stone', () => {
    expect(hearthstoneAttuneRowFaction('npc_automaton_quartermaster', null, STONE)).toBe(
      'automatons',
    );
    expect(hearthstoneAttuneRowFaction('npc_rift_watch_quartermaster', 'automatons', STONE)).toBe(
      'rift_watch',
    );
    expect(hearthstoneAttuneRowFaction('npc_church_order_quartermaster', null, STONE)).toBe(
      'church_order',
    );
  });

  it('hides the row when already bound to this hub', () => {
    expect(hearthstoneAttuneRowFaction('npc_automaton_quartermaster', 'automatons', STONE)).toBe(
      null,
    );
  });

  it('hides the row without the stone in the bags', () => {
    expect(
      hearthstoneAttuneRowFaction('npc_automaton_quartermaster', null, [
        { itemId: 'linen_cloth', count: 3 },
      ]),
    ).toBe(null);
  });

  it('hides the row at any NPC that is not a faction quartermaster', () => {
    // Quartermaster Sela keeps Wyrmwatch's garrison stores but is not the
    // Automatons quartermaster (the reporter tried her first).
    expect(hearthstoneAttuneRowFaction('quartermaster_sela', null, STONE)).toBe(null);
    expect(hearthstoneAttuneRowFaction(undefined, null, STONE)).toBe(null);
  });
});
