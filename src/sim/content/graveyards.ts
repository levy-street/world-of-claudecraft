// Graveyards + the Spirit Healer (the "angel"). Data-as-code for the WoW-style
// death loop: when a player releases their spirit they become a ghost at the
// nearest graveyard, where a Spirit Healer hovers. They run their ghost back to
// their corpse to resurrect with no penalty, or accept the Spirit Healer's
// resurrection (instant, in place) at the cost of Resurrection Sickness.
//
// No engine logic here (data only). The behavior lives in src/sim/spirit.ts; the
// overworld healers are spawned from OVERWORLD_GRAVEYARDS in the Sim ctor and the
// per-instance dungeon/raid healers in instances/dungeons.ts (claimInstance).

import type { NpcDef } from '../types';

export interface GraveyardDef {
  id: string;
  // Internal label (zone-themed). Not player-visible: the angel's NAME is the only
  // player-facing string, and it is the shared SPIRIT_HEALER name, localized once.
  name: string;
  // Overworld world position the released spirit appears at (a Spirit Healer hovers
  // here). Dungeon/raid graveyards are NOT in this list: they live at the instance
  // entry and are resolved per-instance in spirit.ts / instances/dungeons.ts.
  x: number;
  z: number;
}

// One graveyard per existing headstone cluster (the ZonePropsDef.graveyards anchors
// across all three zones), so every visible graveyard on the map gets an angel and
// no overworld death is ever far from one.
export const OVERWORLD_GRAVEYARDS: GraveyardDef[] = [
  // Eastbrook Vale (zone 1)
  { id: 'gy_eastbrook', name: 'Eastbrook Rest', x: -14, z: -14 },
  { id: 'gy_vale_chapel', name: 'Vale Chapel Yard', x: 4, z: -56 },
  // Mirefen Marsh (zone 2)
  { id: 'gy_fenbridge', name: 'Fenbridge Barrow', x: -18, z: 286 },
  // Thornpeak Heights (zone 3)
  { id: 'gy_thornpeak', name: 'Thornpeak Cairns', x: 15, z: 645 },
  { id: 'gy_thornpeak_east', name: 'East Ridge Graves', x: 141, z: 712 },
  { id: 'gy_thornpeak_south', name: 'Sanctum Approach Graves', x: 138, z: 838 },
  { id: 'gy_thornpeak_west', name: 'West Spire Graves', x: -139, z: 787 },
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
