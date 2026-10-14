// Goldcrest Harbor, the capital city hub, crowning the map: the northernmost
// band of the central strip (full strip width, z 1960..2420), its top edge the
// world's own north edge. Like the Scorching Wastes,
// this zone is authored as a HYBRID: this module registers only the zone
// identity (so zoneAt, the terrain streamer, i18n, music and the map UI treat
// it as a first-class zone), while every placement, terrain stamps, buildings,
// NPCs, vendors, camps, paint, rides the map document (tmp/goldcrest/inject.ts
// builds it). The base world places nothing here, so the shipped game is
// visually unchanged except for the zone label.
//
// MOVED 2026-08-26, from the west grid square beside Eastbrook Vale
// (x -540..-180, z -180..180). Upstream v0.40's tutorial island, The Proving
// Shore, claimed that EXACT rectangle. Two zones on one rect is not a draw:
// zoneAt returns the first match and Goldcrest appends first, so the island was
// unreachable, while isOnProvingShore, a pure rect test that never consults
// ZONES, read true inside the capital and put the whole tutorial rail
// (arrival cinematic, island guidance, the island cue) on players walking
// Goldcrest's streets. Moving the FORK's zone rather than upstream's keeps the
// island's own file untouched, so the collision cannot come back on the next
// merge. The whole zone is a rigid translation of (+360, +2190), so every
// interior bearing the city map document was authored with still holds.
//
// WHY THE STRIP AND NOT A COLUMN: the grid's invariants (tests/progression.ts
// "zones tile the grid") are that the strip tiles gaplessly south to north and
// that every COLUMN zone shares some z with the strip, an isolated island past
// the strip's north end is called out as a bug. So the only rect that is both
// legal and at the top is the strip's own next band, starting exactly where the
// Frostveil ends. It also keeps WORLD_MAX_Z at 2420: the terrain's ocean margin
// (world.ts northEnd) is derived from that bound, so a zone pushed further north
// would have dragged the whole centre-east coastline north with it.

import type { NpcDef, ZoneDef } from '../types';

export const GOLDCREST_ZONE: ZoneDef = {
  id: 'goldcrest_harbor',
  name: 'Goldcrest Harbor',
  zMin: 1960,
  zMax: 2420,
  levelRange: [1, 60],
  biome: 'vale',
  hub: { x: -2, z: 2190, radius: 60, name: 'Goldcrest' },
  graveyard: { x: -54, z: 2306 },
  lakes: [],
  pois: [
    { x: 112, z: 2192, label: 'The Grand Gate', id: 'the_grand_gate' },
    { x: -2, z: 2190, label: 'Grand Plaza', id: 'grand_plaza' },
    { x: -22, z: 2222, label: 'The Goldcrest Exchange', id: 'the_goldcrest_exchange' },
    { x: 48, z: 2156, label: 'Market Ward', id: 'market_ward' },
    { x: 72, z: 2108, label: 'Harbor Ward', id: 'harbor_ward' },
    { x: -92, z: 2230, label: 'Highcrown Citadel', id: 'highcrown_citadel' },
    { x: -38, z: 2290, label: 'The Lightspire', id: 'the_lightspire' },
    { x: 104, z: 2040, label: 'The Gold Light', id: 'the_gold_light' },
    { x: 150, z: 2180, label: 'The Golden Span', id: 'the_golden_span' },
  ],
  welcome:
    'Goldcrest Harbor, seat of the World Market. Every road, tide and ledger in the realm meets here.',
};

/** Where the Deepglass steward keeps her berth: the Grand Plaza, beside the
 *  Exchange, where the harbour's crowds already gather. */
export const DEEPGLASS_STEWARD_POS = { x: 4, z: 2198 };

/**
 * The Goldcrest roster.
 *
 * `dynamic: true` on every entry, the Scorching Wastes rule: the base world
 * places nothing in this square (with no city map loaded it is still open sea),
 * so the generic surface-placement loop must skip them. The steward is instead
 * spawned at world init under a reserved id, onto the nearest dry ground ,
 * exactly how Groundskeeper Bram takes his post at the Sowfield gate.
 */
export const GOLDCREST_NPCS: Record<string, NpcDef> = {
  deepglass_steward: {
    id: 'deepglass_steward',
    name: 'Steward Aleyn Tidewell',
    title: 'Warden of the Deepglass',
    pos: { ...DEEPGLASS_STEWARD_POS },
    facing: Math.PI,
    color: 0x4fc3d9,
    questIds: [],
    dynamic: true,
    deepglassSteward: true,
    greeting:
      'The bell is full and the truce holds, $C. Say the word and the tide-lift will set you down inside it, brassgill, thrustpack and all.',
  },
};
