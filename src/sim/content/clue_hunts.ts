// Clue Scrolls (world quests, Stage 3): the treasure hunts a Clue Scroll
// opens. A hunt is an ordered list of steps; each step is one clue family
// the player solves in the world, and the last step yields the casket.
//
// Data-as-code: every hunt here is authored against real zone landmarks
// (ZoneDef.pois ids), real NPCs (NpcDef ids) and real emotes. The engine
// (src/sim/clue_scrolls.ts) advances a hunt when the step's condition is met
// and never reads anything that is not on the def. Clue prose is a t() key
// per step (clues.<huntId>.<stepIndex> in src/ui/i18n.catalog/clues.ts); the
// sim never emits the prose itself.
//
// Scope rules from docs/design/clue-scrolls.md: only a level 16+ character who
// completes every zone slot of the day's board earns a scroll; scrolls stack
// to CLUE_SCROLL_STACK_MAX; one hunt is active at a time; a hunt survives the
// daily reset; abandoning returns nothing.

export const CLUE_SCROLL_ITEM_ID = 'clue_scroll';
export const TREASURE_CASKET_ITEM_ID = 'treasure_casket';
/** Scrolls a character can hold at once; a further entitlement is lost. */
export const CLUE_SCROLL_STACK_MAX = 3;
/** The level from which the daily slate can earn a scroll (the 16 to 20 bracket). */
export const CLUE_SCROLL_MIN_LEVEL = 16;
/** How close (yards) a landmark, dig or emote step must be to its spot. */
export const CLUE_STEP_RADIUS = 12;

export type ClueStepDef =
  /** Stand at a zone landmark (a ZoneDef.pois id). */
  | { kind: 'landmark'; zoneId: string; poiId: string }
  /** Talk to a named NPC (NpcDef id). */
  | { kind: 'npc'; npcId: string }
  /** Perform an emote (src/sim/social/chat.ts EMOTES key) at a landmark. */
  | { kind: 'emote'; emote: string; zoneId: string; poiId: string }
  /** Bring `count` of an item to a named NPC; the items are consumed. */
  | { kind: 'deliver'; npcId: string; itemId: string; count: number }
  /** Use the scroll while standing on a hidden spot (world coordinates). */
  | { kind: 'dig'; zoneId: string; x: number; z: number };

export interface ClueHuntDef {
  id: string;
  /** Steps in order; the last one completes the hunt and hands the casket. */
  steps: readonly ClueStepDef[];
}

/**
 * The authored starter pool. Ids are frozen once shipped (saves carry them).
 *
 * Authoring rules (pinned by tests/clue_hunts_content.test.ts): every
 * landmark and emote step names a real `pois[].id` of the zone it names,
 * every npc and deliver step names an open-world NpcDef id, every deliver
 * item is a cheap vendor item at a count of 1 to 3, every dig sits inside
 * its zone's rectangle near (but never on) a landmark, every hunt stays
 * inside at most two zones and ends with a dig. Titles and clue prose live
 * in src/ui/i18n.catalog/clues.ts. The directions in the prose read +z as
 * north and +x as east, the way the world map is drawn.
 */
export const CLUE_HUNTS: readonly ClueHuntDef[] = [
  // The Drakelands: from the Gatewood west of Wyrmwatch, out to the far-dune
  // scout, back to the garrison stores, and into the ash east of the dunes.
  {
    id: 'hunt_drakelands_gate_ashes',
    steps: [
      { kind: 'landmark', zoneId: 'drakelands', poiId: 'the_gatewood' },
      { kind: 'npc', npcId: 'scout_yerrin' },
      { kind: 'deliver', npcId: 'quartermaster_sela', itemId: 'baked_bread', count: 2 },
      { kind: 'dig', zoneId: 'drakelands', x: 350, z: 2085 },
    ],
  },
  // The Frostveil Reach: a kneel on the Aurora Steps, a word with the reader
  // of the lights, and a dig in the snow east of the Howling Terraces.
  {
    id: 'hunt_frostveil_aurora_vigil',
    steps: [
      { kind: 'emote', emote: 'kneel', zoneId: 'frostveil', poiId: 'the_aurora_steps' },
      { kind: 'npc', npcId: 'aurorist_veyla' },
      { kind: 'dig', zoneId: 'frostveil', x: 118, z: 1790 },
    ],
  },
  // The Amberfall: the ferrymaster, the Leaning Monolith, water for the
  // orchardist, and a dig northeast of Cindermaple Rise.
  {
    id: 'hunt_amberfall_lantern_ferry',
    steps: [
      { kind: 'npc', npcId: 'ferrymaster_caddow' },
      { kind: 'landmark', zoneId: 'amberfall', poiId: 'the_leaning_monolith' },
      { kind: 'deliver', npcId: 'orchardist_pomeline', itemId: 'spring_water', count: 3 },
      { kind: 'dig', zoneId: 'amberfall', x: -412, z: 2228 },
    ],
  },
  // The Willowfen: salt for the fen-witch, a sigh on the Drowsy Flats, and a
  // dig on the dry hummock southeast of Bogshine Pools.
  {
    id: 'hunt_willowfen_fenwitch_salt',
    steps: [
      { kind: 'deliver', npcId: 'mother_sedge', itemId: 'cooking_salt', count: 1 },
      { kind: 'emote', emote: 'sigh', zoneId: 'willowfen', poiId: 'the_drowsy_flats' },
      { kind: 'dig', zoneId: 'willowfen', x: -266, z: 268 },
    ],
  },
  // The Nightbloom: the Standing Vigil, the astronomer, a salute at the
  // Sleepless Barrow, and a dig southeast of Gloamfield.
  {
    id: 'hunt_nightbloom_sleepless_vigil',
    steps: [
      { kind: 'landmark', zoneId: 'nightbloom', poiId: 'the_standing_vigil' },
      { kind: 'npc', npcId: 'astronomer_cassian' },
      { kind: 'emote', emote: 'salute', zoneId: 'nightbloom', poiId: 'the_sleepless_barrow' },
      { kind: 'dig', zoneId: 'nightbloom', x: -424, z: 1478 },
    ],
  },
  // The Wraithwood: the candlewright, jerky for the vicar, the Hanging
  // Glade, and a dig southeast of the Huntsman's Clearing.
  {
    id: 'hunt_wraithwood_mournstone_candles',
    steps: [
      { kind: 'npc', npcId: 'widow_tansy' },
      { kind: 'deliver', npcId: 'vicar_creel', itemId: 'tough_jerky', count: 2 },
      { kind: 'landmark', zoneId: 'wraithwood', poiId: 'the_hanging_glade' },
      { kind: 'dig', zoneId: 'wraithwood', x: 398, z: 1662 },
    ],
  },
  // The Palmreach: the Vinefall, the hermit who went in, a cower before the
  // Sunken Idol, and a dig in the sand northeast of the Tanglemouth.
  {
    id: 'hunt_palmreach_sunken_idol',
    steps: [
      { kind: 'landmark', zoneId: 'palmreach', poiId: 'the_vinefall' },
      { kind: 'npc', npcId: 'hermit_okku' },
      { kind: 'emote', emote: 'cower', zoneId: 'palmreach', poiId: 'the_sunken_idol' },
      { kind: 'dig', zoneId: 'palmreach', x: -402, z: 750 },
    ],
  },
  // The Evergarden into the Galecrest (neighbours on the eastern column):
  // compost for the parterre gardener, the Old Mill, the keeper of the Old
  // Beacon over the border, and a dig northwest of the beacon.
  {
    id: 'hunt_evergarden_beacon_road',
    steps: [
      { kind: 'deliver', npcId: 'farmer_verbena', itemId: 'compost', count: 2 },
      { kind: 'landmark', zoneId: 'evergarden', poiId: 'the_old_mill' },
      { kind: 'npc', npcId: 'keeper_bram' },
      { kind: 'dig', zoneId: 'galecrest', x: 480, z: 326 },
    ],
  },
];

export const CLUE_HUNTS_BY_ID: Readonly<Record<string, ClueHuntDef>> = Object.freeze(
  Object.fromEntries(CLUE_HUNTS.map((hunt) => [hunt.id, hunt])),
);
