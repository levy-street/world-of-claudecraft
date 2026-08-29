// Graveyards + the Spirit Healer (the "angel"). Data-as-code for the WoW-style
// death loop: when a player releases their spirit they become a ghost at the
// nearest graveyard, where a Spirit Healer hovers. They run their ghost back to
// their corpse to resurrect with no penalty, or accept the Spirit Healer's
// resurrection (instant, in place) at the cost of Resurrection Sickness.
//
// No engine logic here (data only). The behavior lives in src/sim/spirit.ts; the
// overworld healers are spawned from OVERWORLD_GRAVEYARDS in the Sim ctor and the
// per-instance dungeon/raid healers in instances/dungeons.ts (claimInstance).

import { EASTBROOK_LAYOUT } from '../eastbrook_layout';
import { FENBRIDGE_LAYOUT } from '../fenbridge_layout';
import type { GraveyardDef, NpcDef } from '../types';

export type { GraveyardDef } from '../types';

// One graveyard per existing headstone cluster (the ZonePropsDef.graveyards anchors
// across all three zones), so every visible graveyard on the map gets an angel and
// no overworld death is ever far from one.
export const OVERWORLD_GRAVEYARDS: GraveyardDef[] = [
  // Eastbrook Vale (zone 1)
  {
    id: 'gy_eastbrook',
    name: 'Eastbrook Rest',
    ...EASTBROOK_LAYOUT.services.graveyard.position,
  },
  // 'Vale Chapel Yard' (4,-56) retired 2026-08. It was the OLD town's yard, left
  // standing through the harbor move, and it ended up 15 yd from the rebuilt
  // Eastbrook Rest. Every record here spawns a Pale Keeper, so the pair read as
  // two angels over one churchyard, one of them outside the new railings.
  //
  // Eastbrook Rest sits at the Vale's far SOUTH end, and the zone runs
  // z -180..180, so the nearest-graveyard watershed against Fenbridge Barrow
  // (z 286) fell at about z 114: every death in the northern third of the zone
  // released into Mirefen Marsh, a zone the dead player has usually never seen.
  // That went unnoticed until the Copper Dig relocated from z -86 to z 144 and
  // took the level 1-7 mine content across the line with it. The yard below
  // covers the Vale's north and pushes the watershed past the zone border.
  { id: 'gy_vale_north', name: 'Dig Road Graves', x: -22, z: 118 },
  // Mirefen Marsh (zone 2)
  {
    id: FENBRIDGE_LAYOUT.services.graveyard.id,
    name: FENBRIDGE_LAYOUT.services.graveyard.name,
    ...FENBRIDGE_LAYOUT.services.graveyard.position,
  },
  // Thornpeak Heights (zone 3)
  { id: 'gy_thornpeak', name: 'Thornpeak Cairns', x: 15, z: 645 },
  { id: 'gy_thornpeak_east', name: 'East Ridge Graves', x: 141, z: 712 },
  { id: 'gy_thornpeak_south', name: 'Sanctum Approach Graves', x: 138, z: 838 },
  { id: 'gy_thornpeak_west', name: 'West Spire Graves', x: -139, z: 787 },
  // Grid-world realms: one graveyard per zone, placed at the zone's own graveyard
  // field (content/*.ts). Spirit healers spawn here and a released spirit picks
  // the nearest, so death in any new realm returns you locally, not to a far-off
  // strip graveyard across a sealed border.
  { id: 'gy_veiled_hollow', name: 'Eldergleam Rest', x: -60, z: 1004 },
  { id: 'gy_farshore', name: 'Gullhaven Rest', x: 290, z: 86 },
  // At the zone's own graveyard field (willowfen.ts): the old (-346, 338) spot
  // sits inside Bridgemere's moat ring, below WATER_LEVEL, and the Pale Keeper
  // spawned underwater there.
  { id: 'gy_willowfen', name: 'Willowfen Barrow', x: -344, z: 306 },
  { id: 'gy_galecrest', name: 'Galecrest Rest', x: 404, z: 344 },
  { id: 'gy_palmreach', name: 'Palmreach Rest', x: -318, z: 802 },
  // inside Hedgewick's churchyard, east of the chapel so the Pale Keeper
  // hovers over the headstones clear of the chapel's collider
  { id: 'gy_evergarden', name: 'Evergarden Rest', x: 309, z: 793 },
  { id: 'gy_nightbloom', name: 'Nightbloom Rest', x: -388, z: 1402 },
  { id: 'gy_wraithwood', name: 'Wraithwood Graves', x: 378, z: 1412 },
  { id: 'gy_frostveil', name: 'Frostveil Barrow', x: -34, z: 1576 },
  { id: 'gy_drakelands', name: 'Drakelands Cairns', x: 422, z: 1885 },
  { id: 'gy_amberfall', name: 'Amberfall Rest', x: -336, z: 2050 },
  // The Proving Shore (tutorial island). Appended LAST: spirit healers spawn
  // in this array's order, so a mid-array insert would renumber every later
  // healer's entity id for no reason (the camps append-last discipline).
  { id: 'gy_proving_shore', name: 'Dawnrest Graves', x: -324, z: 58 },
];

// The Spirit Healer NPC id (one shared template; every spawned angel carries this
// templateId, so the renderer keys one angelic visual off it and the interaction
// layer recognizes it with a single check). `dynamic: true` keeps the Sim ctor's
// surface-placement loop from spawning it at a single point: spirit.ts spawns a
// copy at every graveyard instead.
export const SPIRIT_HEALER_NPC_ID = 'spirit_healer';

export const SPIRIT_HEALER: NpcDef = {
  id: SPIRIT_HEALER_NPC_ID,
  name: 'The Pale Keeper',
  title: 'Warden of the Dead',
  // Placeholder position: never surface-placed (dynamic), spawned per-graveyard.
  pos: { x: 0, z: 0 },
  facing: Math.PI,
  // Pale, warm gold: angelic against the headstones, and the holy-school tint the
  // renderer adds for the floating glow keys off the spirit_healer templateId.
  color: 0xfff4d0,
  questIds: [],
  greeting:
    'Rest now, spirit. I can return you to your body, but the crossing back leaves you weak.',
  dynamic: true,
};
