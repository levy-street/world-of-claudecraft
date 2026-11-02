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
// pull_eligibility.ts keeps it from being dragged or knocked off its marker,
// the knockback half enforced inside knockback.ts applyKnockback; deeds.ts routes
// its damage to the practice counter instead of the real combat ledger). They
// carry zero damage, zero move speed and zero aggro radius on top of that, so the
// inertness holds even for a code path that reads the template numbers directly.

import type { CampDef, MobTemplate, NpcDef, PlayerClass, QuestDef } from '../types';
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

// The hub's second lesson, optional: a level-5 friendly healing target beside
// Hale's damage dummy, for the four classes that carry a genuine direct heal
// in their base kit. NEVER mage, even a build leaning into support tools
// (sim/tutorial/hub_healing_lesson.ts hubHealingAbilityId resolves the exact
// spell; this list is its single source of truth, imported from there rather
// than re-typed, since content/ is data and tutorial/ is the consumer).
export const HUB_HEALING_ELIGIBLE_CLASSES: readonly PlayerClass[] = [
  'druid',
  'shaman',
  'paladin',
  'priest',
];

// It begins injured and sheds healed HP back toward its resting mark on the
// SAME mechanics as this row's own friendly_player_dummy (mob/practice_dummies.ts,
// friendlyPracticeTarget): rest fraction and shed rate are read straight off
// that shared logic in sim/hub_practice.ts. What differs is the vitals
// themselves: this teaches the meter to a FRESH character, not a geared one,
// so it carries a plain level-5 pool of its own rather than borrowing the
// level-20 best-in-slot reference kit.
export const HUB_HEALING_DUMMY_ID = 'hub_healing_dummy';

// A level-5 humanoid's ordinary pool (comparable to a levelled zone mob at
// this level, e.g. zone1.ts's mogger_lackey at 44 + 18*4 = 116), not the
// dummy row's inert 999,999: a healer needs a pool small enough that a real
// cast is a meaningful fraction of it.
const HUB_HEALING_DUMMY_HP_BASE = 60;
const HUB_HEALING_DUMMY_HP_PER_LEVEL = 15;

// The hub's OWN damage dummy: a dedicated level-5 template, never the shared
// zone3.ts `training_dummy` (level 20, the Highwatch row's own body). Two
// reasons this is a separate id rather than a reuse: the hub is meant to be a
// fresh character's very first lesson, so its target should read as their
// own level, not the level-20 endgame measuring post; and dummy_drill.ts
// credit is scoped to THIS id specifically, so hitting the unrelated
// Highwatch row (which shares the family but not the id) never advances the
// hub quest. Same inert 999,999 pool as every dummy here: never felled for
// real regardless of its level.
export const HUB_TRAINING_DUMMY_ID = 'hub_training_dummy';

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
  // The hub's own friendly target, at a plain level-5 pool (never the
  // level-20 best-in-slot stamp above): sim/hub_practice.ts starts it injured
  // and the shared friendlyPracticeTarget mechanic sheds it back toward rest.
  [HUB_HEALING_DUMMY_ID]: {
    ...DUMMY_BASE,
    id: HUB_HEALING_DUMMY_ID,
    name: 'Healing Dummy',
    minLevel: 5,
    maxLevel: 5,
    hpBase: HUB_HEALING_DUMMY_HP_BASE,
    hpPerLevel: HUB_HEALING_DUMMY_HP_PER_LEVEL,
    attackSpeed: 2.0,
    armorPerLevel: 0, // never hit; armor is inert here
    color: 0x74c476, // ally green, the same family as the row's own ally
    friendlyPracticeTarget: true,
  },
  // The hub's own damage dummy: same inert body as the shared training_dummy,
  // stamped at the hub's own level-5 instead of that one's level-20.
  [HUB_TRAINING_DUMMY_ID]: {
    ...DUMMY_BASE,
    id: HUB_TRAINING_DUMMY_ID,
    name: 'Training Dummy',
    minLevel: 5,
    maxLevel: 5,
    attackSpeed: 2.0,
    armorPerLevel: 0,
    color: 0xb8924a, // same wood tan as the shared training_dummy
  },
};

// The Highwatch practice row, as the Studio town rework (#4593) stood it: a
// diagonal line on the shelf below Stalker Ridge, south-west of Highwatch,
// about 6 yards between marks. Along the row from the town side: ally, normal
// boss, heroic boss, then the original training dummy at the far end (zone3.ts
// owns that camp entry and the Wall Drills deed that names it). The row has no
// fire: an inert practice target builds no brazier (render/night_accents_core.ts).
export const PRACTICE_ROW_ORDER: readonly string[] = [
  FRIENDLY_PLAYER_DUMMY_ID,
  'training_dummy',
  NORMAL_BOSS_DUMMY_ID,
  HEROIC_BOSS_DUMMY_ID,
];

/** Each row dummy's mark. */
export const PRACTICE_ROW_MARKS: Readonly<Record<string, { x: number; z: number }>> = {
  [FRIENDLY_PLAYER_DUMMY_ID]: { x: -65.95, z: 611.4 },
  training_dummy: { x: -80.97, z: 599.53 },
  [NORMAL_BOSS_DUMMY_ID]: { x: -70.82, z: 606.36 },
  [HEROIC_BOSS_DUMMY_ID]: { x: -75.65, z: 602.33 },
};

// radius 0 / count 1, like the training dummy's own entry: a dummy camp is a
// fixed deterministic prop and the spawn loop gives it no scatter and draws no
// rng for it (sim.ts), so the row lands exactly on these marks.
export const PRACTICE_DUMMY_CAMPS: CampDef[] = PRACTICE_ROW_ORDER.flatMap((mobId) =>
  mobId === 'training_dummy'
    ? []
    : [{ mobId, center: { ...PRACTICE_ROW_MARKS[mobId] }, radius: 0, count: 1 }],
);

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

// East of Hale, mirroring the damage dummy on his other side: a few yards
// off, clear of the quay road (centreline x -92, halfWidth 1.5), Fisherman
// Brandt (-95, -50) and the pad's watchtower/crate cluster to the north (the
// same clearance rule as HUB_TRAINING_DUMMY_POS above).
// tests/hub_healing_dummy.test.ts pins the clearance and that findSafePos
// leaves it exactly here.
export const HUB_HEALING_DUMMY_POS = { x: -85, z: -44 } as const;

// NOT a CAMPS entry: the hub yard (both dummies + sparring master) spawns
// after the player in sim/hub_practice.ts so it consumes only trailing entity
// ids; a camp appended here shifted the player's id and re-minted every
// parity golden. The def stays as data for the spawn hook and its tests.
export const HUB_PRACTICE_DUMMY_CAMPS: CampDef[] = [
  { mobId: HUB_TRAINING_DUMMY_ID, center: { ...HUB_TRAINING_DUMMY_POS }, radius: 0, count: 1 },
];

// The quay's sparring master: the hub dummy's one-line tutorial, on the model
// of the Proving Shore's yard keepers. A dummy standing alone on the pad tells
// a newcomer nothing about WHY it is there, and the Damage Meters window (the
// meters keybind, Shift+H by default) is the least discoverable window in the
// HUD: nothing in the world names it. Hale's greeting and his one quest do.
//
// Placed a few yards SOUTH of the dummy (north is the pad's watchtower and
// crate edge), east of the quay-walk road (centreline x -92, halfWidth 1.5)
// and clear of Fisherman Brandt (-95, -50), facing the player arrival
// point at (-94, -58) so newcomers see his face rather than his back.
// tests/hub_dummy_drill.test.ts pins that findSafePos leaves him on his
// mark and that nothing else stands within arm's reach.
export const HUB_SPARRING_MASTER_ID = 'drillmaster_hale';
// Moved with the hub dummies to the Sableweb practice ground (Studio town
// rework, #4593).
export const HUB_SPARRING_MASTER_POS = { x: -95.38, z: -5.41 } as const;

export const HUB_PRACTICE_NPCS: Record<string, NpcDef> = {
  [HUB_SPARRING_MASTER_ID]: {
    id: HUB_SPARRING_MASTER_ID,
    name: 'Drillmaster Hale',
    title: 'Quay Sparring Master',
    pos: { ...HUB_SPARRING_MASTER_POS },
    facing: 2.788,
    color: 0x7a4a4a,
    questIds: ['q_hub_know_your_numbers', 'q_hub_healing_numbers'],
    // Spawned by sim/hub_practice.ts after the player (trailing ids), not by
    // the surface-placement loop; the def stays in NPCS so the online client
    // resolves his questIds and world_entity_i18n his strings.
    dynamic: true,
    greeting:
      'That dummy behind me never swings back and never goes down, $C. What matters is the tally: your Damage Meters count every blow you land on it. Target it and open the meters, and I will walk you through the rest.',
  },
};

// The dummy's one lesson. The objective is a sentinel 'interact' with no
// ground entity of its own (the ps_ability_drill idiom): tutorial/
// dummy_drill.ts credits it off every blow that lands on a training dummy,
// autoattacks included, because the lesson is the METER, not the button.
export const HUB_DUMMY_DRILL_OBJECT_ITEM_ID = 'hub_dummy_drill';
export const HUB_DUMMY_DRILL_QUEST_ID = 'q_hub_know_your_numbers';

// The optional second lesson's own sentinel objective, on the same idiom:
// tutorial/hub_healing_drill.ts credits it off every EFFECTIVE heal that
// lands on the hub healing dummy, because this lesson's meter is Healing, not
// Damage, and the button pressed to get there does not matter.
export const HUB_HEALING_DRILL_OBJECT_ITEM_ID = 'hub_healing_drill';
export const HUB_HEALING_DRILL_QUEST_ID = 'q_hub_healing_numbers';

export const HUB_PRACTICE_QUESTS: Record<string, QuestDef> = {
  [HUB_DUMMY_DRILL_QUEST_ID]: {
    id: HUB_DUMMY_DRILL_QUEST_ID,
    name: 'Know Your Numbers',
    giverNpcId: HUB_SPARRING_MASTER_ID,
    turnInNpcId: HUB_SPARRING_MASTER_ID,
    text: 'Strength you cannot measure is strength you cannot improve, $N. Target the training dummy, open your Damage Meters, and land ten blows on it, swings or spells, while you watch the window count what you deal. When the ten are in, come back and tell me the number.',
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
  // Optional: only offered once Know Your Numbers is done, and only to the
  // four classes carrying a real direct heal (requiredClass) that they have
  // actually learned by their current level (requiresUsableHealAbility,
  // resolved the same way the credit arm and the UI coach resolve it, via
  // sim/tutorial/hub_healing_lesson.ts hubHealingAbilityId). A mage never
  // sees this quest: it has nothing in its kit that qualifies.
  [HUB_HEALING_DRILL_QUEST_ID]: {
    id: HUB_HEALING_DRILL_QUEST_ID,
    name: 'Numbers That Heal',
    giverNpcId: HUB_SPARRING_MASTER_ID,
    turnInNpcId: HUB_SPARRING_MASTER_ID,
    requiresQuest: HUB_DUMMY_DRILL_QUEST_ID,
    requiredClass: [...HUB_HEALING_ELIGIBLE_CLASSES],
    requiresUsableHealAbility: true,
    text: 'A post is not the only thing worth measuring, $N. Target the Healing Dummy beside it, open your Damage Meters, and switch to the Healing tab. Land three heals that actually restore health while you watch the window count them the same way it counted blows.',
    completionText:
      'Healed numbers, not hurt ones, but numbers all the same, $N. A healer who never watches those meters is guessing at their own worth.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: HUB_HEALING_DRILL_OBJECT_ITEM_ID,
        count: 3,
        label: 'Effective heal landed on the Healing Dummy',
      },
    ],
    xpReward: 60,
    copperReward: 40,
    itemRewards: {},
  },
};

export const HUB_PRACTICE_QUEST_ORDER: string[] = [
  HUB_DUMMY_DRILL_QUEST_ID,
  HUB_HEALING_DRILL_QUEST_ID,
];
