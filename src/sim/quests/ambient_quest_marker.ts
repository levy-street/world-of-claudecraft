// Ambient discovery policy, separate from quest availability and dialogue.
// Profession offers remain in gossip; their first, repeat and cooldown '!'
// markers are hidden in the world, minimap and map. This is the standing
// rule for every profession onboarding quest in every zone on all three
// hosts (the trainers carry a subtitle instead, so a trade is discovered by
// reading the trainer, not a marker); it is not scoped to Eastbrook or to a
// rollout window. Reverting it is deleting the isProfessionQuest branch in
// ambientNpcQuestMarkerKind; nothing else depends on it.
// Resolve each quest before folding an NPC's markers so a hidden profession
// offer never removes a combat offer or a ready hand-in on the same giver.

import type { QuestDef, QuestState } from '../types';
import { npcQuestMarkerKind, type QuestMarkerKind } from './quest_marker_kind';

export function isProfessionQuest(quest: QuestDef): boolean {
  // Farming predates the q_prof naming convention. Its action objectives are
  // authoritative; a farmer's unrelated story quests must keep their offers.
  return quest.id.startsWith('q_prof_') || quest.objectives.some((o) => o.type === 'farm');
}

export function ambientNpcQuestMarkerKind(
  quest: QuestDef,
  npcTemplateId: string,
  state: QuestState,
  questsDone: ReadonlySet<string>,
  cadenceBlocked?: ReadonlySet<string>,
): QuestMarkerKind {
  const kind = npcQuestMarkerKind(quest, npcTemplateId, state, questsDone, cadenceBlocked);
  if (
    isProfessionQuest(quest) &&
    (kind === 'available' || kind === 'repeat' || kind === 'cooldown')
  ) {
    return 'none';
  }
  return kind;
}
