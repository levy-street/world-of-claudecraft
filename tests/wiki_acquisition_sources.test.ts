import { describe, expect, it } from 'vitest';
import {
  buildSourceIndex,
  dropPlacesFor,
  eliteZonesFor,
  instanceKind,
  isWithheldCarrier,
  namedDroppersFor,
  offersFor,
  questDropPlacesFor,
  type SourceTables,
  teachingSources,
} from '../scripts/wiki/acquisition_sources.mjs';

// The wiki's WHERE derivation (scripts/wiki/acquisition_sources.mjs), driven off
// SYNTHETIC tables so what each arm means is pinned independently of live content:
// a content edit can move an item between places, never change what a place is.
// The live-data accuracy pins are in tests/guide_prof_materials.test.ts.

const tables = (over: Partial<SourceTables> = {}): SourceTables => ({
  mobs: {},
  dungeons: [],
  overworldZonesOfMob: () => [],
  heroicBossLoot: {},
  riftItemIds: [],
  heroicVendorStock: [],
  crucibleVendorStock: [],
  factionVendorGates: {},
  ...over,
});

describe('wiki acquisition sources', () => {
  it('classifies an instance as a raid at ten players and a dungeon below', () => {
    expect(instanceKind({ suggestedPlayers: 10 })).toBe('raid');
    expect(instanceKind({ suggestedPlayers: 25 })).toBe('raid');
    expect(instanceKind({ suggestedPlayers: 5 })).toBe('dungeon');
    expect(instanceKind({ suggestedPlayers: 1 })).toBe('dungeon');
    expect(instanceKind({})).toBe('dungeon');
  });

  it('places a drop by where its carrier spawns, in display order', () => {
    const index = buildSourceIndex(
      tables({
        mobs: {
          wolf: { name: 'Wolf', loot: [{ itemId: 'fang' }] },
          crypt_rat: { name: 'Crypt Rat', loot: [{ itemId: 'fang' }, { itemId: 'tail' }] },
          raid_boss: { name: 'Big Bad', boss: true, loot: [{ itemId: 'core' }] },
        },
        dungeons: [
          { suggestedPlayers: 5, spawns: [{ mobId: 'crypt_rat' }] },
          { suggestedPlayers: 10, spawns: [{ mobId: 'raid_boss' }] },
        ],
        overworldZonesOfMob: (id) => (id === 'wolf' ? ['Vale'] : []),
        heroicBossLoot: { crypt: [{ itemId: 'fang' }, { itemId: undefined }] },
        riftItemIds: ['fang'],
      }),
    );
    // Order is world, dungeon, heroic, raid, rift regardless of discovery order.
    expect(dropPlacesFor('fang', index)).toEqual(['world', 'dungeon', 'heroic', 'rift']);
    expect(dropPlacesFor('tail', index)).toEqual(['dungeon']);
    expect(dropPlacesFor('core', index)).toEqual(['raid']);
    expect(dropPlacesFor('nothing', index)).toEqual([]);
  });

  it('names ordinary overworld carriers but only the zone of an elite or boss', () => {
    const index = buildSourceIndex(
      tables({
        mobs: {
          wolf: { name: 'Wolf', loot: [{ itemId: 'pelt' }] },
          alpha: { name: 'Old Alpha', elite: true, loot: [{ itemId: 'pelt' }] },
          titan: { name: 'Titan', boss: true, loot: [{ itemId: 'pelt' }] },
        },
        overworldZonesOfMob: (id) =>
          id === 'wolf' ? ['Vale', 'Marsh'] : id === 'alpha' ? ['Peaks'] : ['Drakelands'],
      }),
    );
    expect(namedDroppersFor('pelt', index)).toEqual([
      { name: 'Wolf', zone: 'Marsh' },
      { name: 'Wolf', zone: 'Vale' },
    ]);
    expect(eliteZonesFor('pelt', index)).toEqual(['Drakelands', 'Peaks']);
    // The withheld names never ride out through the named list.
    const named = JSON.stringify(namedDroppersFor('pelt', index));
    expect(named).not.toContain('Old Alpha');
    expect(named).not.toContain('Titan');
  });

  it('withholds a world boss like an elite, and names a rare as the bestiary does', () => {
    const index = buildSourceIndex(
      tables({
        mobs: {
          peak: { name: 'The Waking Peak', worldBoss: true, loot: [{ itemId: 'ore' }] },
          greyjaw: { name: 'Old Greyjaw', rare: true, loot: [{ itemId: 'ore' }] },
        },
        overworldZonesOfMob: (id) => (id === 'peak' ? ['Peaks'] : ['Vale']),
      }),
    );
    expect(namedDroppersFor('ore', index)).toEqual([{ name: 'Old Greyjaw', zone: 'Vale' }]);
    expect(eliteZonesFor('ore', index)).toEqual(['Peaks']);
    expect(isWithheldCarrier({ name: 'x', worldBoss: true })).toBe(true);
    expect(isWithheldCarrier({ name: 'x', rare: true })).toBe(false);
    expect(isWithheldCarrier(undefined)).toBe(false);
  });

  it('keeps quest-only loot rows apart from ordinary drops', () => {
    const index = buildSourceIndex(
      tables({
        mobs: {
          spider: { name: 'Spider', loot: [{ itemId: 'egg', questId: 'q_brood' }] },
          boss: { name: 'Brood Boss', loot: [{ itemId: 'egg' }] },
        },
        dungeons: [{ suggestedPlayers: 5, spawns: [{ mobId: 'boss' }] }],
        overworldZonesOfMob: (id) => (id === 'spider' ? ['Vale'] : []),
        heroicBossLoot: { boss: [{ itemId: 'sac', questId: 'q_brood' }] },
      }),
    );
    expect(dropPlacesFor('egg', index)).toEqual(['dungeon']);
    expect(namedDroppersFor('egg', index)).toEqual([]);
    expect(dropPlacesFor('sac', index)).toEqual([]);
    // The quest-only rows are kept apart, by kind only, so the page can say
    // "only while on its quest" rather than lose the source.
    expect(questDropPlacesFor('egg', index)).toEqual(['world']);
    expect(questDropPlacesFor('sac', index)).toEqual([]);
  });

  it('labels a raid boss Heroic drop as a raid drop, not a Heroic dungeon one', () => {
    const index = buildSourceIndex(
      tables({
        mobs: {},
        dungeons: [
          { suggestedPlayers: 10, spawns: [{ mobId: 'raid_boss' }] },
          { suggestedPlayers: 5, spawns: [{ mobId: 'five_boss' }] },
        ],
        heroicBossLoot: {
          raid_boss: [{ itemId: 'raid_pattern' }],
          five_boss: [{ itemId: 'five_pattern' }],
        },
      }),
    );
    expect(dropPlacesFor('raid_pattern', index)).toEqual(['raid']);
    expect(dropPlacesFor('five_pattern', index)).toEqual(['heroic']);
  });

  it('never names an instanced carrier, only its kind', () => {
    const index = buildSourceIndex(
      tables({
        mobs: { keeper: { name: 'The Keeper', loot: [{ itemId: 'relic' }] } },
        dungeons: [{ suggestedPlayers: 5, spawns: [{ mobId: 'keeper' }] }],
      }),
    );
    expect(namedDroppersFor('relic', index)).toEqual([]);
    expect(eliteZonesFor('relic', index)).toEqual([]);
    expect(dropPlacesFor('relic', index)).toEqual(['dungeon']);
  });

  it('lists every quartermaster offer with its own terms', () => {
    const index = buildSourceIndex(
      tables({
        heroicVendorStock: [{ itemId: 'pat', marks: 12 }],
        crucibleVendorStock: [{ itemId: 'pat', sigilId: 'sigil_a' }],
        factionVendorGates: {
          pat: { factionId: 'rift_watch', standingTier: 'proven', currencyCost: 50 },
          shared: { standingTier: 'trusted', currencyCost: 20 },
        },
      }),
    );
    expect(offersFor('pat', index)).toEqual([
      { kind: 'heroic', marks: 12 },
      { kind: 'crucible', sigilId: 'sigil_a' },
      { kind: 'faction', factionId: 'rift_watch', tier: 'proven', marks: 50 },
    ]);
    // An allied row (no factionId) is sold by every faction quartermaster.
    expect(offersFor('shared', index)).toEqual([
      { kind: 'faction', factionId: null, tier: 'trusted', marks: 20 },
    ]);
    expect(offersFor('nothing', index)).toEqual([]);
  });

  it('merges a recipe teaching items into one source set, deduping sellers', () => {
    const index = buildSourceIndex(
      tables({
        mobs: { rat: { name: 'Rat', loot: [{ itemId: 'manual_a' }] } },
        dungeons: [{ suggestedPlayers: 10, spawns: [{ mobId: 'rat' }] }],
        riftItemIds: ['manual_b'],
        crucibleVendorStock: [
          { itemId: 'manual_a', sigilId: 'sigil_a' },
          { itemId: 'manual_b', sigilId: 'sigil_a' },
        ],
      }),
    );
    expect(teachingSources(['manual_a', 'manual_b'], index)).toEqual({
      drops: ['raid', 'rift'],
      offers: [{ kind: 'crucible', sigilId: 'sigil_a' }],
    });
    // Two manuals priced in DIFFERENT sigils are two offers, not one: the dedupe
    // key carries the price, so neither price is hidden.
    const twoSigils = buildSourceIndex(
      tables({
        crucibleVendorStock: [
          { itemId: 'manual_a', sigilId: 'sigil_a' },
          { itemId: 'manual_b', sigilId: 'sigil_b' },
        ],
      }),
    );
    expect(teachingSources(['manual_a', 'manual_b'], twoSigils)?.offers).toEqual([
      { kind: 'crucible', sigilId: 'sigil_a' },
      { kind: 'crucible', sigilId: 'sigil_b' },
    ]);
    // No table carries it: null, so the page falls back to the channel string.
    expect(teachingSources(['orphan'], index)).toBeNull();
    expect(teachingSources([], index)).toBeNull();
  });
});
