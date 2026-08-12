// Pins the HUD-boundary display-name resolvers extracted from hud.ts into
// src/ui/entity_display_core.ts (the monolith-ratchet move at the phase 07 QA
// release sync). The decisive surface is the ROUTING: which arm each resolver
// takes for known vs unknown ids, and which name channel an owned mob uses.
// The *FromSource reversal cases run under a real non-en locale (es): under
// en the resolved display name equals the sim's own English, so the known
// arm and the unknown passthrough are byte-identical and deleting the whole
// lookup would stay green (the phase 07 QA pin-audit catch). The es slice is
// loaded once up front (ensureLocaleLoaded is the one async surface), and
// every locale-flipped case carries a positive control proving the switch
// actually moved the value it pins.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DELVE_LIST, DUNGEON_LIST, ITEMS, MOBS, QUESTS, ZONES } from '../src/sim/data';
import type { Entity } from '../src/sim/types';
import {
  delveDisplayName,
  delveText,
  dungeonDisplayNameFromSource,
  dungeonText,
  entityDisplayName,
  itemDisplayNameFromSource,
  itemStackDisplayName,
  mobDisplayName,
  npcDisplayName,
  npcDisplayTitle,
  npcGreeting,
  questNarrative,
  questObjectiveLabel,
  questTitle,
  questTitleFromSource,
  zoneWelcome,
} from '../src/ui/entity_display_core';
import { dungeonDisplayName, itemDisplayName, tEntity } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

const mobEntity = (overrides: Partial<Entity>): Entity =>
  ({
    kind: 'mob',
    templateId: 'forest_wolf',
    ownerId: null,
    name: 'Forest Wolf',
    auras: [],
    ...overrides,
  }) as unknown as Entity;

beforeAll(async () => {
  await ensureLocaleLoaded('es');
});
afterEach(() => setLanguage('en'));

/** The first table row whose es display name differs from its sim English:
 *  the reversal pins need an id where the two arms are distinguishable, and
 *  throwing on none keeps the premise loud instead of silently vacuous.
 *  Rows whose English name a DIFFERENT earlier row shares are skipped: the
 *  *FromSource resolvers answer with the FIRST row carrying a name, so a
 *  duplicate-named later twin would red the pin for a reason unrelated to
 *  the routing it guards. */
function firstTranslated<T>(
  rows: T[],
  simName: (row: T) => string,
  display: (row: T) => string,
): T {
  const hit = rows.find(
    (row) =>
      display(row) !== simName(row) &&
      rows.find((candidate) => simName(candidate) === simName(row)) === row,
  );
  if (!hit) throw new Error('no es-translated row: the reversal pins would be vacuous');
  return hit;
}

describe('entity_display_core', () => {
  it('resolves a known sim item name to its display name and passes unknown names through', () => {
    setLanguage('es');
    const item = firstTranslated(
      Object.values(ITEMS),
      (i) => i.name,
      (i) => itemDisplayName(i),
    );
    expect(itemDisplayNameFromSource(item.name)).toBe(itemDisplayName(item));
    expect(itemDisplayNameFromSource(item.name)).not.toBe(item.name);
    expect(itemDisplayNameFromSource('No Such Item Ever')).toBe('No Such Item Ever');
  });

  it('appends the stack count through the localized count channel', () => {
    const item = ITEMS.iron_ore;
    const bare = itemStackDisplayName(item.name);
    expect(bare).toBe(itemDisplayName(item));
    // A four-digit count proves the suffix rides t() + formatNumber (en
    // groups: 'x1,234'), not a raw concatenation of the sim's ' x1234'.
    const stacked = itemStackDisplayName(item.name, ' x1234');
    expect(stacked).toBe(`${itemDisplayName(item)} x1,234`);
  });

  it('routes entityDisplayName by kind and ownership', () => {
    expect(MOBS.forest_wolf).toBeTruthy();
    // Wild mob: the template display name, never the wire name.
    expect(entityDisplayName(mobEntity({ name: 'ignored-wire-name' }))).toBe(
      tEntity({ kind: 'mob', id: 'forest_wolf', field: 'name' }),
    );
    // Owned non-necromancy mob with a player-authored name: the ?? fallback
    // keeps the per-entity name channel.
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

  it('an owned mob with a sim-authored name localizes through localizeSimAuraName', () => {
    // 'Bladed Echo' is a registered AURA_NAME_KEY row with an es override,
    // so the localizer answers non-null and differs from the raw wire name;
    // that difference is what proves the call happened (deleting the
    // localizeSimAuraName arm and keeping only the ?? fallback goes red
    // here, while under en the two are byte-identical).
    setLanguage('es');
    const localized = localizeSimAuraName('Bladed Echo');
    expect(localized).toBeTruthy();
    expect(localized).not.toBe('Bladed Echo');
    expect(entityDisplayName(mobEntity({ ownerId: 7, name: 'Bladed Echo' }))).toBe(localized);
  });

  it('reverses sim-emitted quest and dungeon names, passing unknown ones through', () => {
    setLanguage('es');
    const quest = firstTranslated(
      Object.values(QUESTS),
      (q) => q.name,
      (q) => questTitle(q.id),
    );
    expect(questTitleFromSource(quest.name)).toBe(questTitle(quest.id));
    expect(questTitleFromSource(quest.name)).not.toBe(quest.name);
    expect(questTitleFromSource('No Such Quest Ever')).toBe('No Such Quest Ever');
    const dungeon = firstTranslated(
      [...DUNGEON_LIST],
      (d) => d.name,
      (d) => dungeonDisplayName(d.id),
    );
    expect(dungeonDisplayNameFromSource(dungeon.name)).toBe(dungeonDisplayName(dungeon.id));
    expect(dungeonDisplayNameFromSource(dungeon.name)).not.toBe(dungeon.name);
    expect(dungeonDisplayNameFromSource('No Such Dungeon Ever')).toBe('No Such Dungeon Ever');
  });

  it('routes every remaining resolver to its hand-written kind/field pair', () => {
    // One arm per extracted export the cases above do not reach. Each
    // expectation writes the tEntity kind/field literals by hand, so a
    // copy-paste swap inside the core (say npcDisplayTitle returning the
    // name field) diverges from the pair pinned here.
    const npcId = 'stablemaster_marla';
    expect(npcDisplayTitle(npcId)).toBe(tEntity({ kind: 'npc', id: npcId, field: 'title' }));
    expect(npcGreeting(npcId, 'warrior', 'Ferny')).toBe(
      tEntity({
        kind: 'npc',
        id: npcId,
        field: 'greeting',
        values: { className: 'Warrior', classNameLower: 'warrior', playerName: 'Ferny' },
      }),
    );
    const quest = Object.values(QUESTS)[0];
    expect(questNarrative(quest.id, 'text', 'Ferny')).toBe(
      tEntity({ kind: 'quest', id: quest.id, field: 'text', values: { playerName: 'Ferny' } }),
    );
    const questWithObjectives = Object.values(QUESTS).find((q) => (q.objectives ?? []).length > 0);
    if (!questWithObjectives) throw new Error('no quest with objectives in QUESTS');
    expect(questObjectiveLabel(questWithObjectives.id, 0)).toBe(
      tEntity({
        kind: 'questObjective',
        questId: questWithObjectives.id,
        objectiveIndex: 0,
        field: 'label',
      }),
    );
    const zone = ZONES[0];
    expect(zone).toBeTruthy();
    expect(zoneWelcome(zone.id)).toBe(tEntity({ kind: 'zone', id: zone.id, field: 'welcome' }));
    const dungeon = DUNGEON_LIST[0];
    expect(dungeonText(dungeon.id, 'enterText')).toBe(
      tEntity({ kind: 'dungeon', id: dungeon.id, field: 'enterText' }),
    );
    const delve = DELVE_LIST[0];
    expect(delve).toBeTruthy();
    expect(delveText(delve.id, 'enterText')).toBe(
      tEntity({ kind: 'delve', id: delve.id, field: 'enterText' }),
    );
    expect(delveDisplayName(delve.id)).toBe(
      tEntity({ kind: 'delve', id: delve.id, field: 'name' }),
    );
  });
});
