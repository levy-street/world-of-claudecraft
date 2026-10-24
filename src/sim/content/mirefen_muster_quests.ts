// The Mirefen muster's three quests: the way a player is walked into the Balgath fight.
//
// Data only. The chain hangs on the Muster Commander (content/mirefen_muster.ts, raised
// with the army at the command camp) and is merged into Mirefen's quest table and quest
// order by content/zone2.ts, beside Maben Skerrit's own pike quest:
//
//   1. The Muster's Summons: Warden Fenwick in Fenbridge sends the player up to the
//      command camp, and the Commander's turn-in text is the briefing (the pike to the
//      eye blinds him, that is the window where the raid's damage lands, and he marches
//      picket to picket).
//   2. Pikes First: the tutorial. Take a Shardpike off the rack, brace it at the Straw
//      Foreman (the training effigy) while the drillmaster's mallet shakes the ground the
//      way a real slam does, put the lantern in its eye out, then feel the plank hide come
//      off under your own weapon. src/sim/muster_effigy.ts runs every part of it.
//      Level 19 and under only (QuestDef.maxLevel): the rack lends its pikes to no one older.
//   3. A Chip Off the Foreman: the weekly, open straight from the briefing so a level 20
//      who skips the drill still has it. Help a raid bring Balgath down, then report
//      to the Commander, once per weekly reset (QuestDef.weeklyReset). The kill counts
//      for every contributor with the weekly in their log, not just the tagging party
//      (src/sim/muster_trophy.ts).
//
// Skerrit's "The Socketwright's Due" is untouched and stays the chain's natural sequel:
// the drill teaches the trick on straw, Skerrit pays for doing it to the real eye.
//
// Rewards are the zone's own curve (docs/design/master-spec.md, the Mirefen table): the
// courier pays the courier's rate (q_fenbridge_muster, 300 xp / 200c), the drill pays a
// level-6 errand's (q_prowlers, 800 / 300), and the weekly pays the boss-quest XP this
// same boss already pays (q_socketwrights_due, 900) with the zone's boss-quest purse
// (q_deacon, 1000c).

import { MUSTER_PIKE_MAX_LEVEL } from '../lance_balance_core';
import type { QuestDef } from '../types';
import { MUSTER_BOSS_TEMPLATE_ID, MUSTER_COMMANDER_NPC_ID } from './mirefen_muster';

/** Quest-event ids the drill's three moments credit (quests/quest_credit.ts 'event'). */
export const MUSTER_PIKE_DRAWN_EVENT = 'muster_pike_drawn';
export const MUSTER_EFFIGY_BLINDED_EVENT = 'muster_effigy_blinded';
export const MUSTER_EFFIGY_WINDOW_HIT_EVENT = 'muster_effigy_window_hit';

export const MUSTER_SUMMONS_QUEST_ID = 'q_muster_summons';
export const MUSTER_PIKE_DRILL_QUEST_ID = 'q_muster_pike_drill';
export const MUSTER_TROPHY_QUEST_ID = 'q_muster_trophy';

/** Blows the drill asks for while the effigy's plank hide is down. */
export const MUSTER_DRILL_WINDOW_HITS = 5;

export const MUSTER_QUESTS: Record<string, QuestDef> = {
  [MUSTER_SUMMONS_QUEST_ID]: {
    id: MUSTER_SUMMONS_QUEST_ID,
    name: "The Muster's Summons",
    giverNpcId: 'warden_fenwick',
    turnInNpcId: MUSTER_COMMANDER_NPC_ID,
    text: 'Every spear I could spare is dug in around the Starfall Crater, $N, ringing the thing that walks out of it. The Muster Commander holds the camp on the southern rise above the crater, south-east of here. Report to the Commander. You will be told how we fight him, and you will listen, because the ones who did not are in the reeds.',
    completionText:
      "Fenwick's runner, is it? Good. Listen, because I say this once and he never says it at all. Balgath walks our pickets: the crater rim, the west flats, the south rise, the gap on the south-west rim, and round again, and every post he stops at, he flattens. Steel does not bite him. His hide turns it, and a raid that hacks at him only dies tired. The one weakness is his eye. A braced pike through the Barrowglass blinds him, and while he is blind his hide sloughs off: that is when the whole raid hits him, and hits hard. Then it closes over and we wait for the next chance. The rack lends its pikes to recruits of level 19 or lower: the young ones put the eye out, the veterans make the window count. Pikes first, $N, then everyone.",
    objectives: [
      {
        type: 'interact',
        targetNpcId: MUSTER_COMMANDER_NPC_ID,
        count: 1,
        label: 'Report to the Muster Commander',
      },
    ],
    xpReward: 300,
    copperReward: 200,
    itemRewards: {},
    minLevel: 6,
  },
  [MUSTER_PIKE_DRILL_QUEST_ID]: {
    id: MUSTER_PIKE_DRILL_QUEST_ID,
    name: 'Pikes First',
    giverNpcId: MUSTER_COMMANDER_NPC_ID,
    turnInNpcId: MUSTER_COMMANDER_NPC_ID,
    text: 'Talk is cheap and pikes are not, and the rack lends them only to recruits of level 19 or lower. Take a Shardpike off the rack beside me, then walk to the Straw Foreman at the west end of camp: the lads built him out of planks and straw, half the size of the real one, with a lantern where the eye goes. Couch the pike and hold the point true while the drillmaster pounds the ground, because the real one shakes it harder. When your arms are sure, put the point through the lantern. His planks will come off: then hit him with your own weapon, $N, and feel the difference.',
    completionText:
      'You felt it bite, did you? On the real one that is fourteen breaths with the whole raid swinging, and then his hide closes over again. Keep the lesson. The Foreman will test it.',
    objectives: [
      {
        type: 'event',
        eventId: MUSTER_PIKE_DRAWN_EVENT,
        count: 1,
        label: 'Shardpike taken from the muster rack',
      },
      {
        type: 'event',
        eventId: MUSTER_EFFIGY_BLINDED_EVENT,
        count: 1,
        label: "Straw Foreman's lantern put out",
      },
      {
        type: 'event',
        eventId: MUSTER_EFFIGY_WINDOW_HIT_EVENT,
        count: MUSTER_DRILL_WINDOW_HITS,
        label: 'Blows landed while its planks are down',
      },
    ],
    xpReward: 800,
    copperReward: 300,
    itemRewards: {},
    requiresQuest: MUSTER_SUMMONS_QUEST_ID,
    minLevel: 6,
    // The rack lends its pikes to level 19 and below (muster_pike.ts), so a level 20 could
    // never finish the first step: the drill is offered only to those it can teach.
    maxLevel: MUSTER_PIKE_MAX_LEVEL,
  },
  [MUSTER_TROPHY_QUEST_ID]: {
    id: MUSTER_TROPHY_QUEST_ID,
    name: 'A Chip Off the Foreman',
    giverNpcId: MUSTER_COMMANDER_NPC_ID,
    turnInNpcId: MUSTER_COMMANDER_NPC_ID,
    text: 'Every week he stands back up, and every week we knock him down again. That takes a raid, and the muster cannot raise one on its own. Find the next raid that goes after Balgath and help bring him down, $N. Strike him, shield the ones who do, or mend them: every hand that fights him counts. When he falls, come back and report to me. The muster pays for every kill.',
    completionText:
      'Down again, and you were in the fight that did it. Fenbridge will have my report tonight. The purse is thin this far out, but it is yours. Come back when he is up again.',
    objectives: [
      {
        type: 'kill',
        targetMobId: MUSTER_BOSS_TEMPLATE_ID,
        count: 1,
        label: 'Balgath slain',
      },
    ],
    xpReward: 900,
    copperReward: 1000,
    itemRewards: {},
    // Behind the briefing rather than the drill: the drill is level 19 and under, and a
    // level 20 who can never take a pike is exactly who the raid needs on the kill.
    requiresQuest: MUSTER_SUMMONS_QUEST_ID,
    minLevel: 6,
    suggestedPlayers: 10,
    repeatable: true,
    weeklyReset: true,
  },
};

/** Where the chain sits in Mirefen's quest order: right before Skerrit's pike quest. */
export const MUSTER_QUEST_ORDER: readonly string[] = [
  MUSTER_SUMMONS_QUEST_ID,
  MUSTER_PIKE_DRILL_QUEST_ID,
  MUSTER_TROPHY_QUEST_ID,
];
