// WHERE a profession pattern, formula, or crafting material actually comes from, in
// one place, for the wiki's professions pages.
//
// vendor_channel.mjs answers WHICH of five channels a recipe row belongs to
// (trainer / drop / vendor / both / known). That classification is pinned and
// stays, but on its own it left the wiki saying "From a found pattern" for a
// pattern that only drops in rifts, "or the Heroic Quartermaster" for the
// Crucible Quartermaster's whole stock, and "found" for the patterns a faction
// quartermaster sells. This module derives the concrete places from the same
// live tables, so the Source cells and the Materials page can name them.
//
// Spoiler policy, enforced here rather than at each page: an instanced source
// is named only by KIND (dungeon, Heroic dungeon, raid, rift), never by
// instance or boss, and an elite, boss, or world boss creature in the open
// world is named only by its zone: the same names the bestiary withholds
// (tests/guide.test.ts). Ordinary and rare overworld creatures are named, as the
// bestiary and the in-game gathering source panel name them. A quest-only loot
// row (questId) drops only while its quest is active, so it is kept apart
// (questDropPlacesFor) and never reads as an ordinary drop.
//
// Pure and host-agnostic on purpose (the vendor_channel.mjs precedent): it takes
// the tables as arguments and imports nothing, so the generator can hand it the
// esbuild-bundled sim tables and vitest can hand it the real ones or fakes.

/** The guide's own raid rule (the dungeons emit in build_content.mjs): an
 *  instance sized for ten or more is the raid, anything smaller a dungeon. */
export function instanceKind(dungeon) {
  return (dungeon.suggestedPlayers ?? 0) >= 10 ? 'raid' : 'dungeon';
}

/** A creature the wiki names only by zone: the elite, boss, and world boss
 *  encounters the bestiary withholds. A rare is named, as the bestiary names it.
 *  Exported so the generator's gathered arm applies the same rule. */
export function isWithheldCarrier(mob) {
  return Boolean(mob?.elite || mob?.boss || mob?.worldBoss);
}

// Display order for drop places: open world first, then the instanced ladder.
const DROP_PLACE_ORDER = ['world', 'dungeon', 'heroic', 'raid', 'rift'];
const byPlaceOrder = (a, b) => DROP_PLACE_ORDER.indexOf(a) - DROP_PLACE_ORDER.indexOf(b);

/**
 * Index every drop and vendor channel once.
 *
 * `overworldZonesOfMob(mobId)` returns the zone names a mob has a real
 * overworld camp in (empty when it only spawns inside instances); the
 * generator builds it from the same strict-containment predicate the in-game
 * source panel uses. `dungeons` carries each instance's static spawn list.
 */
export function buildSourceIndex({
  mobs,
  dungeons,
  overworldZonesOfMob,
  heroicBossLoot,
  riftItemIds,
  heroicVendorStock,
  crucibleVendorStock,
  factionVendorGates,
}) {
  const instanceKindsByMob = new Map();
  for (const d of dungeons) {
    const kind = instanceKind(d);
    for (const s of d.spawns ?? []) {
      if (!s.mobId) continue;
      const kinds = instanceKindsByMob.get(s.mobId) ?? new Set();
      kinds.add(kind);
      instanceKindsByMob.set(s.mobId, kinds);
    }
  }

  // item id -> Set of drop places, plus the named ordinary overworld droppers
  // and the zones of the unnamed elite or boss ones.
  const dropPlaces = new Map();
  const questDropPlaces = new Map();
  const namedDroppers = new Map();
  const eliteZones = new Map();
  const addTo = (map, id, value) => {
    const set = map.get(id) ?? new Set();
    set.add(value);
    map.set(id, set);
  };
  for (const [mobId, mob] of Object.entries(mobs)) {
    const zones = overworldZonesOfMob(mobId);
    const instanced = instanceKindsByMob.get(mobId) ?? new Set();
    for (const row of mob.loot ?? []) {
      if (!row.itemId || !row.questId) continue;
      for (const kind of instanced) addTo(questDropPlaces, row.itemId, kind);
      if (zones.length > 0) addTo(questDropPlaces, row.itemId, 'world');
    }
    const itemIds = (mob.loot ?? []).flatMap((row) =>
      row.itemId && !row.questId ? [row.itemId] : [],
    );
    if (itemIds.length === 0) continue;
    for (const itemId of itemIds) {
      for (const kind of instanced) addTo(dropPlaces, itemId, kind);
      if (zones.length === 0) continue;
      addTo(dropPlaces, itemId, 'world');
      if (isWithheldCarrier(mob)) {
        for (const zone of zones) addTo(eliteZones, itemId, zone);
      } else {
        for (const zone of zones) addTo(namedDroppers, itemId, `${mob.name}\u0000${zone}`);
      }
    }
  }
  // Heroic loot is keyed by the boss template. The raid bosses carry Heroic
  // tables too, and a raid boss's Heroic drop is a raid drop, not a Heroic
  // dungeon one, so the key's own instance decides the label.
  for (const [bossId, rows] of Object.entries(heroicBossLoot)) {
    const place = instanceKindsByMob.get(bossId)?.has('raid') ? 'raid' : 'heroic';
    for (const row of rows) {
      if (row.itemId && !row.questId) addTo(dropPlaces, row.itemId, place);
    }
  }
  for (const itemId of riftItemIds) addTo(dropPlaces, itemId, 'rift');

  // item id -> quartermaster offers, in a fixed order: Heroic, Crucible, faction.
  const offers = new Map();
  const addOffer = (itemId, offer) => {
    const list = offers.get(itemId) ?? [];
    list.push(offer);
    offers.set(itemId, list);
  };
  for (const o of heroicVendorStock) addOffer(o.itemId, { kind: 'heroic', marks: o.marks });
  for (const o of crucibleVendorStock) addOffer(o.itemId, { kind: 'crucible', sigilId: o.sigilId });
  for (const [itemId, gate] of Object.entries(factionVendorGates)) {
    addOffer(itemId, {
      kind: 'faction',
      factionId: gate.factionId ?? null,
      tier: gate.standingTier,
      marks: gate.currencyCost,
    });
  }

  return { dropPlaces, questDropPlaces, namedDroppers, eliteZones, offers };
}

/** Where an item drops, in display order. Empty when nothing drops it. */
export function dropPlacesFor(itemId, index) {
  return [...(index.dropPlaces.get(itemId) ?? [])].sort(byPlaceOrder);
}

/** Where an item drops only while a quest is active, in display order. */
export function questDropPlacesFor(itemId, index) {
  return [...(index.questDropPlaces.get(itemId) ?? [])].sort(byPlaceOrder);
}

/** The quartermasters that sell an item. Empty when none does. */
export function offersFor(itemId, index) {
  return [...(index.offers.get(itemId) ?? [])];
}

/** Ordinary overworld creatures that drop an item, as { name, zone }, sorted. */
export function namedDroppersFor(itemId, index) {
  return [...(index.namedDroppers.get(itemId) ?? [])]
    .map((key) => {
      const [name, zone] = key.split('\u0000');
      return { name, zone };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.zone.localeCompare(b.zone));
}

/** Zones where an elite or boss creature drops an item, sorted. */
export function eliteZonesFor(itemId, index) {
  return [...(index.eliteZones.get(itemId) ?? [])].sort();
}

/**
 * The concrete sources of the patterns (or formula items) that teach one
 * recipe or enchant: every place one drops and every quartermaster that sells
 * one. `patternIds` is the teaching item list (vendor_channel.mjs owns the
 * recipe-to-pattern mapping). Null when no table carries any of them.
 */
export function teachingSources(patternIds, index) {
  const drops = new Set();
  const offers = [];
  const seen = new Set();
  for (const id of patternIds) {
    for (const place of dropPlacesFor(id, index)) drops.add(place);
    for (const offer of offersFor(id, index)) {
      const key = [offer.kind, offer.factionId, offer.tier, offer.sigilId, offer.marks].join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      offers.push(offer);
    }
  }
  if (drops.size === 0 && offers.length === 0) return null;
  return { drops: [...drops].sort(byPlaceOrder), offers };
}
