// Lazy SimContext bindings: the host constructs ctx before assigning it, so
// callbacks must read the completed context when called, never during binding.
import type { SimContext } from './sim_context';
import {
  completeWorldQuestEscort,
  hasActiveWorldQuest,
  onMobKilledForWorldQuests,
  onNodeGatheredForWorldQuests,
  onObjectInteractedForWorldQuests,
} from './world_quests';

type CreditBindings = Pick<
  SimContext,
  | 'onMobKilledForWorldQuests'
  | 'onNodeGatheredForWorldQuests'
  | 'onObjectInteractedForWorldQuests'
  | 'hasActiveWorldQuest'
  | 'completeWorldQuestEscort'
>;

export function worldQuestCreditBindings(getContext: () => SimContext): CreditBindings {
  return {
    onMobKilledForWorldQuests: (mob, meta) => onMobKilledForWorldQuests(getContext(), mob, meta),
    onNodeGatheredForWorldQuests: (node, meta) =>
      onNodeGatheredForWorldQuests(getContext(), node, meta),
    onObjectInteractedForWorldQuests: (object, meta) =>
      onObjectInteractedForWorldQuests(getContext(), object, meta),
    hasActiveWorldQuest,
    completeWorldQuestEscort: (meta, questId, escortId, escortee) =>
      completeWorldQuestEscort(getContext(), meta, questId, escortId, escortee),
  };
}
