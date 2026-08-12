// Pins the HUD-boundary display-name resolvers extracted from hud.ts into
// src/ui/entity_display_core.ts (the monolith-ratchet move at the phase 07 QA
// release sync). The decisive surface is the ROUTING: which arm each resolver
// takes for known vs unknown ids, and which name channel an owned mob uses.
import { describe, expect, it } from 'vitest';
import { DUNGEON_LIST, ITEMS, MOBS, QUESTS } from '../src/sim/data';
import type { Entity } from '../src/sim/types';
import {
  dungeonDisplayNameFromSource,
  entityDisplayName,
  itemDisplayNameFromSource,
  itemStackDisplayName,
  mobDisplayName,
  npcDisplayName,
  questTitle,
  questTitleFromSource,
} from '../src/ui/entity_display_core';
import { dungeonDisplayName, itemDisplayName, tEntity } from '../src/ui/entity_i18n';

const mobEntity = (overrides: Partial<Entity>): Entity =>
  ({
    kind: 'mob',
    templateId: 'forest_wolf',
    ownerId: null,
    name: 'Forest Wolf',
    auras: [],
    ...overrides,
  }) as unknown as Entity;

describe('entity_display_core', () => {
  it('resolves a known sim item name to its display name and passes unknown names through', () => {
    const item = ITEMS.iron_ore;
    expect(item).toBeTruthy();
    expect(itemDisplayNameFromSource(item.name)).toBe(itemDisplayName(item));
    expect(itemDisplayNameFromSource('No Such Item Ever')).toBe('No Such Item Ever');
  });

  it('appends the localized stack count only when a stack suffix is present', () => {
    const item = ITEMS.iron_ore;
    const bare = itemStackDisplayName(item.name);
    expect(bare).toBe(itemDisplayName(item));
    const stacked = itemStackDisplayName(item.name, ' x3');
    expect(stacked).toBe(`${itemDisplayName(item)} x3`);
  });

  it('routes entityDisplayName by kind and ownership', () => {
    expect(MOBS.forest_wolf).toBeTruthy();
    // Wild mob: the template display name, never the wire name.
    expect(entityDisplayName(mobEntity({ name: 'ignored-wire-name' }))).toBe(
      tEntity({ kind: 'mob', id: 'forest_wolf', field: 'name' }),
    );
    // Owned non-necromancy mob (a pet): the per-entity name channel.
    expect(entityDisplayName(mobEntity({ ownerId: 7, name: 'Fluffy' }))).toBe('Fluffy');
    // Owned necromancy undead: back on the template channel despite the owner.
    expect(
      entityDisplayName(mobEntity({ templateId: 'graveguard', ownerId: 7, name: 'Risen' })),
    ).toBe(mobDisplayName('graveguard'));
    // NPCs resolve their template, players keep their own name.
    expect(
      entityDisplayName(
        mobEntity({ kind: 'npc', templateId: 'stablemaster_marla' } as Partial<Entity>),
      ),
    ).toBe(npcDisplayName('stablemaster_marla'));
    expect(entityDisplayName(mobEntity({ kind: 'player', name: 'Ferny' } as Partial<Entity>))).toBe(
      'Ferny',
    );
  });

  it('reverses sim-emitted quest and dungeon names, passing unknown ones through', () => {
    const quest = Object.values(QUESTS)[0];
    expect(quest).toBeTruthy();
    expect(questTitleFromSource(quest.name)).toBe(questTitle(quest.id));
    expect(questTitleFromSource('No Such Quest Ever')).toBe('No Such Quest Ever');
    const dungeon = DUNGEON_LIST[0];
    expect(dungeon).toBeTruthy();
    expect(dungeonDisplayNameFromSource(dungeon.name)).toBe(dungeonDisplayName(dungeon.id));
    expect(dungeonDisplayNameFromSource('No Such Dungeon Ever')).toBe('No Such Dungeon Ever');
  });
});
