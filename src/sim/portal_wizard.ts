// Baldemar the Bald, Archmage of the Shining Pate: the portal wizard who keeps
// a post in every town square and a twin post at the Deepglass bell.
//
// The lore is the joke and the joke is the lore: hair anchors a soul to one
// place, so Baldemar shaved his centuries ago and has been everywhere at once
// ever since. Talking to any of his town selves has him cast a gate to the
// Deepglass arena; the self waiting at the bell casts the gate home again.
//
// Sim honesty, following deepglass/steward.ts to the letter: nothing in this
// module moves a body between worlds. The wizard is an ordinary talkable NPC
// and the gossip row only tells the CLIENT "the player asked for passage"; the
// portal itself is presentation (src/game/portal_travel.ts) and the world
// change is a page swap, exactly like the steward's berth.
//
// Every self spawns under a RESERVED entity id outside the nextId sequence,
// after the rng-drawing world roster, so world-gen determinism and the parity
// goldens' pinned id sequence both survive (see social/vale_cup.ts). The defs
// are registered dynamic in the global NPCS table because the gossip dialog
// resolves flags through NPCS[templateId], not through the world the entity is
// standing in.

// PURE DATA ONLY: this module is imported by data.ts, so it must not import
// entity.ts (which itself imports data.ts). The spawners live next door in
// portal_wizard_spawn.ts, mirroring the deepglass/world.ts + steward.ts split.

import type { NpcDef } from './types';

/** One town post: where a self of Baldemar stands, and which zone he serves. */
export interface PortalWizardStop {
  /** NpcDef id, also the templateId of the spawned entity. */
  npcId: string;
  /** Zone the town belongs to; the return trip aims back here. */
  zoneId: string;
  /** Town name, for authoring reference only (display names are i18n keys). */
  town: string;
  /** Where he stands, a few yards off the hub centre so he owns a corner of
   *  the square rather than its middle. findSafePos still gets the last word. */
  x: number;
  z: number;
}

/**
 * One self per town, hub coordinates from each zone's `hub` plus a fixed
 * offset. Order is FROZEN: the reserved entity id is base + index, so
 * reordering or inserting mid-list would reassign ids across saves.
 */
export const PORTAL_WIZARD_STOPS: readonly PortalWizardStop[] = [
  { npcId: 'portal_wizard_eastbrook', zoneId: 'eastbrook_vale', town: 'Eastbrook', x: 10, z: 8 },
  { npcId: 'portal_wizard_fenbridge', zoneId: 'mirefen_marsh', town: 'Fenbridge', x: 10, z: 308 },
  {
    npcId: 'portal_wizard_highwatch',
    zoneId: 'thornpeak_heights',
    town: 'Highwatch',
    x: 8,
    z: 666,
  },
  {
    npcId: 'portal_wizard_eldergleam',
    zoneId: 'veiled_hollow',
    town: 'Eldergleam',
    x: -30,
    z: 1038,
  },
  { npcId: 'portal_wizard_wyrmwatch', zoneId: 'drakelands', town: 'Wyrmwatch', x: 412, z: 1908 },
  { npcId: 'portal_wizard_icemantle', zoneId: 'frostveil', town: 'Icemantle', x: -22, z: 1567 },
  {
    npcId: 'portal_wizard_lanternmere',
    zoneId: 'amberfall',
    town: 'Lanternmere',
    x: -352,
    z: 2080,
  },
  { npcId: 'portal_wizard_bridgemere', zoneId: 'willowfen', town: 'Bridgemere', x: -352, z: 369 },
  { npcId: 'portal_wizard_moonrest', zoneId: 'nightbloom', town: 'Moonrest', x: -363, z: 1427 },
  { npcId: 'portal_wizard_gallowmere', zoneId: 'wraithwood', town: 'Gallowmere', x: 367, z: 1436 },
  { npcId: 'portal_wizard_drifthaven', zoneId: 'palmreach', town: 'Drifthaven', x: -294, z: 826 },
  { npcId: 'portal_wizard_hedgewick', zoneId: 'evergarden', town: 'Hedgewick', x: 326, z: 816 },
  { npcId: 'portal_wizard_wickharbor', zoneId: 'galecrest', town: 'Wickharbor', x: 426, z: 366 },
  { npcId: 'portal_wizard_gullhaven', zoneId: 'farshore_isle', town: 'Gullhaven', x: 311, z: 76 },
  {
    npcId: 'portal_wizard_goldcrest',
    zoneId: 'goldcrest_harbor',
    town: 'Goldcrest',
    x: -354,
    z: 8,
  },
] as const;

/**
 * Reserved entity ids. 000..004 are Bram, FURY, the Warmarshal, the Deepglass
 * marshal and the Deepglass steward; the wizard takes the 100 block so future
 * singletons never have to thread between his town selves.
 */
export const PORTAL_WIZARD_BASE_ENTITY_ID = 1_000_000_100;

/** The self waiting at the bell. */
export const DEEPGLASS_PORTAL_WIZARD_NPC_ID = 'portal_wizard_deepglass';
export const DEEPGLASS_PORTAL_WIZARD_ENTITY_ID = 1_000_000_150;

/** Hub centres, only for aiming his gaze back at the square he serves. */
const TOWN_GAZE: Record<string, { x: number; z: number }> = {
  portal_wizard_eastbrook: { x: 0, z: 0 },
  portal_wizard_fenbridge: { x: 0, z: 300 },
  portal_wizard_highwatch: { x: 0, z: 660 },
  portal_wizard_eldergleam: { x: -40, z: 1030 },
  portal_wizard_wyrmwatch: { x: 404, z: 1900 },
  portal_wizard_icemantle: { x: -30, z: 1560 },
  portal_wizard_lanternmere: { x: -360, z: 2072 },
  portal_wizard_bridgemere: { x: -360, z: 362 },
  portal_wizard_moonrest: { x: -370, z: 1420 },
  portal_wizard_gallowmere: { x: 360, z: 1430 },
  portal_wizard_drifthaven: { x: -300, z: 820 },
  portal_wizard_hedgewick: { x: 320, z: 810 },
  portal_wizard_wickharbor: { x: 420, z: 360 },
  portal_wizard_gullhaven: { x: 305, z: 70 },
  portal_wizard_goldcrest: { x: -2, z: 2190 },
};

/** Facing points along (sin f, cos f); aim each self at his own town square. */
function gazeFacing(npcId: string, x: number, z: number): number {
  const at = TOWN_GAZE[npcId];
  if (!at) return 0;
  return Math.atan2(at.x - x, at.z - z);
}

const TOWN_GREETING =
  'Yes, the pate is bare, and no, the mountain wind did not do it. Hair is an ' +
  'anchor, $C: every strand ties a soul to one patch of ground. I traded mine, ' +
  'all of it, for doors in the world. Ask, and I will open the way to the ' +
  'Deepglass. My other self is already there, polishing his head for luck.';

const DEEPGLASS_GREETING =
  'Told you I would be here first. Baldness travels light, $C. Enjoy the bell, ' +
  'mind the glass, and when you miss the grass of home, say the word: the way ' +
  'back is one shining thought away.';

function wizardDef(id: string, x: number, z: number, greeting: string): NpcDef {
  return {
    id,
    name: 'Baldemar the Bald',
    title: 'Archmage of the Shining Pate',
    pos: { x, z },
    facing: gazeFacing(id, x, z),
    // Pale amethyst, matching the arcane school his gates are cut from.
    color: 0xc9a6ff,
    questIds: [],
    portalWizard: true,
    // Registered but never surface-placed: every self spawns through the
    // reserved-id path in sim.ts, exactly like the steward and the marshal.
    dynamic: true,
    greeting,
  };
}

/** All of Baldemar's selves, keyed by NpcDef id, for the NPCS registry. */
export const PORTAL_WIZARD_NPCS: Record<string, NpcDef> = Object.fromEntries([
  ...PORTAL_WIZARD_STOPS.map((stop) => [
    stop.npcId,
    wizardDef(stop.npcId, stop.x, stop.z, TOWN_GREETING),
  ]),
  [
    DEEPGLASS_PORTAL_WIZARD_NPC_ID,
    // Position is overridden by the arena roster's own def; these coordinates
    // exist only so the registry entry is complete.
    wizardDef(DEEPGLASS_PORTAL_WIZARD_NPC_ID, 0, 0, DEEPGLASS_GREETING),
  ],
]);

/** The stop a wizard self serves, or null for the Deepglass self. */
export function portalWizardStop(npcId: string): PortalWizardStop | null {
  return PORTAL_WIZARD_STOPS.find((s) => s.npcId === npcId) ?? null;
}
