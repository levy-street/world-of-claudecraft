// The Highwatch practice row: the target dummies on the hill above Highwatch that
// let a player measure a rotation against every profile the endgame actually asks
// for, without pulling anything real.
//
// zone3.ts already owns the original `training_dummy`, a level-20 non-elite with
// zero armor: the clean, unmitigated readout. That one number is not enough to
// plan around, because both of the things that move a rotation's realized output
// (target ARMOR and target LEVEL, which sets the melee/spell hit table) change
// between a normal boss and a heroic one. This module adds the three missing
// profiles beside it:
//
//   friendly_player_dummy  a level-20 ALLY carrying a best-in-slot epic kit's
//                          health pool and armor: the healing target, and the
//                          reference for what a geared player looks like.
//   normal_boss_dummy      normal Nythraxis's defensive profile (level 20,
//                          elite + boss, 42 armor per level).
//   heroic_boss_dummy      heroic Nythraxis's (level 22, and Nythraxis's armor
//                          scaled by the heroic arena's armorMultiplier).
//
// Both boss profiles are DERIVED from the live raid tables below rather than
// re-typed, so a Nythraxis retune moves the dummies with it instead of leaving
// them quietly stale.
//
// Behavior is the training dummy's, unchanged: every one of these carries
// `dummy: true`, which is the single flag the sim reads to hold a practice target
// inert (mob/locomotion.ts never lets it aggro, move, or swing; combat/
// pull_eligibility.ts keeps it from being dragged off its marker; deeds.ts routes
// its damage to the practice counter instead of the real combat ledger). They
// carry zero damage, zero move speed and zero aggro radius on top of that, so the
// inertness holds even for a code path that reads the template numbers directly.

import type { CampDef, MobTemplate, NpcDef, QuestDef } from '../types';
import { HEROIC_DUNGEON_TUNING } from './dungeon_difficulty';
import { DUNGEON_MOBS } from './dungeons';
import { NYTHRAXIS_RAID_BOSS_ID } from './heroic_loot';

// The raid boss the two boss dummies copy their defensive profile from, and the
// arena tuning record that turns its normal profile into its heroic one.
const NYTHRAXIS = DUNGEON_MOBS[NYTHRAXIS_RAID_BOSS_ID];
const NYTHRAXIS_HEROIC = HEROIC_DUNGEON_TUNING.nythraxis_boss_arena;

// A practice target is never felled for real, so its pool only has to be large
// enough that no rotation can empty it inside a measurement. Shared with the
// original training dummy's 999,999 for exactly that reason.
const DUMMY_HP = 999999;

// The player-cap level-20 ally profile. Health and armor are stamped at spawn
// from the best-in-slot epic kit (mob/practice_dummies.ts), so this template's
// own hp/armor numbers are placeholders that never reach a live entity; they are
// kept at the shared dummy values so a hypothetical spawn path that skipped the
// stamping still produces an inert target rather than a one-shot one.
export const FRIENDLY_PLAYER_DUMMY_ID = 'friendly_player_dummy';
export const NORMAL_BOSS_DUMMY_ID = 'normal_boss_dummy';
export const HEROIC_BOSS_DUMMY_ID = 'heroic_boss_dummy';

// Fields every dummy in the row shares: inert, undroppable, and wearing the same
// body as the original training dummy (render/characters/manifest.ts points all
// four ids at mob_training_dummy). Only the tint separates them on sight.
const DUMMY_BASE = {
  family: 'humanoid',
  hpBase: DUMMY_HP,
  hpPerLevel: 0,
  dmgBase: 0, // never fights back
  dmgPerLevel: 0,
  moveSpeed: 0, // never moves
  aggroRadius: 0, // never pulls
  loot: [], // a practice target: no drops
  scale: 1.4,
  dummy: true,
  respawnSeconds: 10,
} as const satisfies Partial<MobTemplate>;

export const PRACTICE_DUMMY_MOBS: Record<string, MobTemplate> = {
  // The healing target. Friendly rather than attackable (friendlyPracticeTarget
  // is what opens it to heals in sim.isFriendlyTo), so a healer can practice
  // solo without needing a body to stand in front of them.
  [FRIENDLY_PLAYER_DUMMY_ID]: {
    ...DUMMY_BASE,
    id: FRIENDLY_PLAYER_DUMMY_ID,
    name: 'Friendly Player Dummy',
    minLevel: 20,
    maxLevel: 20,
    attackSpeed: 2.0,
    armorPerLevel: 0, // replaced at spawn by the best-in-slot kit's armor
    color: 0x74c476, // ally green
    friendlyPracticeTarget: true,
  },
  // Normal Nythraxis's defensive profile. Level, elite/boss status and armor
  // per level are the raid boss's; damage, movement and aggro are zeroed by
  // DUMMY_BASE, because this is a target to measure against, not a fight.
  [NORMAL_BOSS_DUMMY_ID]: {
    ...DUMMY_BASE,
    id: NORMAL_BOSS_DUMMY_ID,
    name: 'Normal Boss Dummy',
    minLevel: NYTHRAXIS.minLevel,
    maxLevel: NYTHRAXIS.maxLevel,
    elite: true,
    boss: true,
    ccImmune: true,
    slowImmune: true,
    attackSpeed: NYTHRAXIS.attackSpeed,
    armorPerLevel: NYTHRAXIS.armorPerLevel,
    color: 0x8c5ac8, // raid violet
  },
  // Heroic Nythraxis's defensive profile: the SAME transform heroic instances
  // apply at spawn (instances/difficulty.ts mobTemplateForDungeonDifficulty),
  // reproduced here on the two fields that decide how much of a rotation lands.
  // Level 22 is what costs a level-20 attacker the heroic hit table; the armor
  // multiplier is what costs the physical share its mitigation.
  [HEROIC_BOSS_DUMMY_ID]: {
    ...DUMMY_BASE,
    id: HEROIC_BOSS_DUMMY_ID,
    name: 'Heroic Boss Dummy',
    minLevel: NYTHRAXIS_HEROIC.level,
    maxLevel: NYTHRAXIS_HEROIC.level,
    elite: true,
    boss: true,
    ccImmune: true,
    slowImmune: true,
    attackSpeed: NYTHRAXIS.attackSpeed,
    armorPerLevel: NYTHRAXIS.armorPerLevel * NYTHRAXIS_HEROIC.armorMultiplier,
    color: 0xc8503c, // heroic crimson
  },
};

// The row runs ACROSS the walk-up from Highwatch, not along it. The hub sits at
// (0, 660) and the row at x -40, so a player arrives travelling almost pure
// minus x: a row laid out along x is seen end-on, which stacks the four bodies
// and their nameplates into what reads as a single dummy. Running the row along
// z instead puts them side by side from that approach.
//
// The pitch is 6 yards: wide enough that each dummy owns its own ground and its
// own nameplate lane, tight enough that all four are still in frame from where a
// player stands to read one. It is also the only axis with room to spread at
// all: 6 yard steps along x would walk the heroic dummy to x -28, halfway back
// to the Highwatch hub boundary.
//
// Order along ascending z is what each represents: ally, normal trash, normal
// boss, heroic boss. The original training dummy holds its shipped spot at
// (-40, 648) (zone3.ts owns that camp entry and the deed that names it), so the
// row is anchored on it and the three new marks are measured off it rather than
// the dummies being re-placed around a new anchor.
export const PRACTICE_ROW_X = -40;
export const PRACTICE_ROW_SPACING = 6;
export const PRACTICE_ROW_TRAINING_DUMMY_Z = 648;

// Position in the row, ascending z. The training dummy is slot 1.
export const PRACTICE_ROW_ORDER: readonly string[] = [
  FRIENDLY_PLAYER_DUMMY_ID,
  'training_dummy',
  NORMAL_BOSS_DUMMY_ID,
  HEROIC_BOSS_DUMMY_ID,
];

const TRAINING_DUMMY_SLOT = PRACTICE_ROW_ORDER.indexOf('training_dummy');

/** The z of a row slot, measured off the training dummy's shipped position. */
export function practiceRowZ(slot: number): number {
  return PRACTICE_ROW_TRAINING_DUMMY_Z + (slot - TRAINING_DUMMY_SLOT) * PRACTICE_ROW_SPACING;
}

// radius 0 / count 1, like the training dummy's own entry: a dummy camp is a
// fixed deterministic prop and the spawn loop gives it no scatter and draws no
// rng for it (sim.ts), so the row lands exactly on these marks.
export const PRACTICE_DUMMY_CAMPS: CampDef[] = PRACTICE_ROW_ORDER.flatMap((mobId, slot) =>
  mobId === 'training_dummy'
    ? []
    : [{ mobId, center: { x: PRACTICE_ROW_X, z: practiceRowZ(slot) }, radius: 0, count: 1 }],
);

// The row's ONE fire, authored into ZONE3_PROPS.campfires.
//
// Every camp whose mob family builds fires and that no authored campfire
// already covers gets a procedural brazier of its own (render/camp_braziers.ts),
// and a dummy is family 'humanoid', so the row was lighting one fire per dummy:
// four inert practice targets each tending a campfire. The fix has two halves.
// An inert practice target now builds nothing (render/night_accents_core.ts),
// which removes all four, and this authored campfire puts a single one back in
// FRONT of the normal boss dummy. Front is plus x: the row faces the walk-up
// from Highwatch, which is the side a player stands on.
//
// The offset is 1.5 yards, not the 3 feet the fire LOOKS like it wants, and the
// reason is the campfire's own collider. A campfire is a solid circle of radius
// 0.85 (sim/colliders.ts) and a spawning mob keeps 0.65 of clearance, so a fire
// closer than their sum shoves the dummy off its camp mark: at 1 yard the boss
// dummy resolved to (-38.66, 652.54), two yards out of the row and visibly
// crooked beside its neighbours. 1.5 is the nearest the fire can stand with the
// dummy still exactly on its mark, which tests/practice_dummies.test.ts pins so
// a future clearance change fails loudly instead of bending the row again.
export const PRACTICE_ROW_CAMPFIRE_OFFSET = 1.5;
export const PRACTICE_ROW_CAMPFIRE: [number, number] = [
  PRACTICE_ROW_X + PRACTICE_ROW_CAMPFIRE_OFFSET,
  practiceRowZ(PRACTICE_ROW_ORDER.indexOf(NORMAL_BOSS_DUMMY_ID)),
];

// The Eastbrook hub dummy: a second `training_dummy` (zone3.ts owns the
// template) on the quay pad where every new character first stands, eleven
// yards inland of the player start (eastbrook_layout.ts services.playerStart,
// (-94, -58)). The Highwatch row is a level-20 measuring station; this one is
// the hub's, so a player can test a build, a new piece of gear or a rotation
// the moment they respec in town instead of riding to the hill above Highwatch.
//
// The mark sits on the dock's levelled shelf (zone1.ts levels it flat), six
// yards east of the quay-walk road centreline (x -92, halfWidth 1.5), clear of
// Fisherman Brandt (-95, -50), Foreman Odell (-84, -63) and the watchtower and
// crate colliders on the pad's north edge, so findSafePos never has to move it
// (tests/training_dummy.test.ts pins that it lands on its authored mark).
export const HUB_TRAINING_DUMMY_POS = { x: -86, z: -50 } as const;

// NOT a CAMPS entry: the hub yard (dummy + sparring master) spawns after the
// player in sim/hub_practice.ts so it consumes only trailing entity ids;
// a camp appended here shifted the player's id and re-minted every parity
// golden. The def stays as data for the spawn hook and its tests.
export const HUB_PRACTICE_DUMMY_CAMPS: CampDef[] = [
  { mobId: 'training_dummy', center: { ...HUB_TRAINING_DUMMY_POS }, radius: 0, count: 1 },
];

// The quay's sparring master: the hub dummy's one-line tutorial, on the model
// of the Proving Shore's yard keepers. A dummy standing alone on the pad tells
// a newcomer nothing about WHY it is there, and the Damage Meters window (the
// meters keybind, Shift+H by default) is the least discoverable window in the
// HUD: nothing in the world names it. Hale's greeting and his one quest do.
//
// Placed a few yards SOUTH of the dummy (north is the pad's watchtower and
// crate edge), east of the quay-walk road (centreline x -92, halfWidth 1.5)
// and clear of Fisherman Brandt (-95, -50), facing north-east across the
// dummy so a player walking up from the start sees him address it.
// tests/hub_dummy_drill.test.ts pins that findSafePos leaves him on his
// mark and that nothing else stands within arm's reach.
export const HUB_SPARRING_MASTER_ID = 'drillmaster_hale';
export const HUB_SPARRING_MASTER_POS = { x: -88, z: -45 } as const;

export const HUB_PRACTICE_NPCS: Record<string, NpcDef> = {
  [HUB_SPARRING_MASTER_ID]: {
    id: HUB_SPARRING_MASTER_ID,
    name: 'Drillmaster Hale',
    title: 'Quay Sparring Master',
    pos: { ...HUB_SPARRING_MASTER_POS },
    facing: -0.38,
    color: 0x7a4a4a,
    questIds: ['q_hub_know_your_numbers'],
    // Spawned by sim/hub_practice.ts after the player (trailing ids), not by
    // the surface-placement loop; the def stays in NPCS so the online client
    // resolves his questIds and world_entity_i18n his strings.
    dynamic: true,
    greeting:
      'That post behind me is a training dummy, $C: hit it as hard and as often as you like, it never swings back and it never goes down. What it is FOR is the tally. Hold Shift and press H to open your Damage Meters: every blow you land on it is counted there, per second and in total, and the practice strip beside it keeps your best run so you can tell whether a new weapon, a new talent or a new rotation actually made you stronger.',
  },
};

// The dummy's one lesson. The objective is a sentinel 'interact' with no
// ground entity of its own (the ps_ability_drill idiom): tutorial/
// dummy_drill.ts credits it off every blow that lands on a training dummy,
// autoattacks included, because the lesson is the METER, not the button.
export const HUB_DUMMY_DRILL_OBJECT_ITEM_ID = 'hub_dummy_drill';
export const HUB_DUMMY_DRILL_QUEST_ID = 'q_hub_know_your_numbers';

export const HUB_PRACTICE_QUESTS: Record<string, QuestDef> = {
  [HUB_DUMMY_DRILL_QUEST_ID]: {
    id: HUB_DUMMY_DRILL_QUEST_ID,
    name: 'Know Your Numbers',
    giverNpcId: HUB_SPARRING_MASTER_ID,
    turnInNpcId: HUB_SPARRING_MASTER_ID,
    text: 'Strength you cannot measure is strength you cannot improve, $N. Left-click the training dummy behind me to make it your target, then hold Shift and press H to open your Damage Meters before you swing. Now land ten blows on it, swings or spells, and watch the window while you do: it counts what you deal per second and in total, and the practice strip beside it remembers your best run. When the ten are in, come back and tell me the number.',
    completionText:
      'Ten blows, and now you know what they are worth. Every time you take a new weapon, a new talent or a new idea, $N, come back to this post and put a number on it. The meters are honest even when the vale is not.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: HUB_DUMMY_DRILL_OBJECT_ITEM_ID,
        count: 10,
        label: 'Blow landed on the Training Dummy',
      },
    ],
    // Sized with the Proving Shore drills (Strike True, Hone the Edge): one
    // lesson's worth, never a level's.
    xpReward: 60,
    copperReward: 40,
    itemRewards: {},
  },
};

export const HUB_PRACTICE_QUEST_ORDER: string[] = [HUB_DUMMY_DRILL_QUEST_ID];
