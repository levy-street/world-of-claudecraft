// "Echo of You": the dynamic quest NPC spawned for a player who burned $WOC to
// clone their own voice (docs/prd/woc/voice-npc.md). The NpcDef/QuestDef below
// are the SHARED, static, i18n-governed content every player sees by default
// (name/title/greeting/quest text go through the normal world_entity_i18n.ts
// pipeline like any other NPC). A player's chosen display name and cloned
// voice audio are runtime-only overrides applied at spawn time
// (src/sim/voice_npc_spawn.ts), never baked into this static def: see the UGC
// exception documented in src/sim/content/CLAUDE.md.
//
// TODO(product): zone1 (the starting zone) is a placeholder spawn location for
// this draft, not a final placement decision; the real zone/quest text/reward
// tuning needs a product pass once the feature is signed off.
import type { NpcDef, QuestDef } from '../types';

export const VOICE_ECHO_NPC_ID = 'voice_echo_npc';
export const VOICE_ECHO_QUEST_ID = 'q_echo_of_you';

export const VOICE_ECHO_NPCS: Record<string, NpcDef> = {
  [VOICE_ECHO_NPC_ID]: {
    id: VOICE_ECHO_NPC_ID,
    name: 'Echo',
    title: 'A Voice Remembered',
    pos: { x: 0, z: 0 },
    facing: 0,
    color: 0x9fd8ff,
    questIds: [VOICE_ECHO_QUEST_ID],
    // Registered but not surface-placed at world init; spawnVoiceNpcEcho
    // instantiates one per grant near the owning player.
    dynamic: true,
    greeting: 'A voice from beyond the bonfire... yes, I remember sounding like that, once.',
  },
};

export const VOICE_ECHO_QUESTS: Record<string, QuestDef> = {
  [VOICE_ECHO_QUEST_ID]: {
    id: VOICE_ECHO_QUEST_ID,
    name: 'Echo of You',
    giverNpcId: VOICE_ECHO_NPC_ID,
    turnInNpcId: VOICE_ECHO_NPC_ID,
    text: 'Something of mine was lost nearby. Would you go and find it for me?',
    completionText: 'You found it. Thank you, truly, for hearing me out.',
    objectives: [
      {
        type: 'interact',
        targetNpcId: VOICE_ECHO_NPC_ID,
        count: 1,
        label: 'Speak with Echo again',
      },
    ],
    xpReward: 100,
    copperReward: 50,
    itemRewards: {},
  },
};
