// Whether the renderer builds a scene view for a ground quest collectable.
//
// The sim owns the RULE (the ground-object arm of sim/quest_gated_entity: a collectable
// is hidden unless its quest is active or ready, and interact-only props such as huts,
// graves and monuments are never hidden because they are scenery in their own right).
// This core owns only the RENDERER's policy around that rule: whether this particular
// Renderer instance honours it at all.
//
// It exists because the two halves have different owners. A player must never see a
// sparkle they cannot pick up, so the game withholds the view entirely: no body, no
// glint, nothing to walk to. The EDITOR viewport composes the same Renderer over a
// questless authoring Sim, where honouring the rule would hide every authored crate and
// sigil from the person placing them, so it opts out through
// `showAllQuestObjects` and draws the whole set.
//
// Resolving the flag ONCE into a closure keeps the per-entity path a single call rather
// than a branch plus a predicate, and keeps the renderer coordinator down to the call
// sites. Pure: no Three, no DOM, no i18n, no clock, no rng.
import { isQuestGatedGroundObjectHidden } from '../sim/quest_gated_entity';
import type { Entity, QuestProgress } from '../sim/types';

export interface QuestObjectGateOptions {
  /** Draw every ground quest collectable regardless of the viewer's quest log. The
   *  editor viewport sets it; the game never does. */
  showAllQuestObjects?: boolean;
}

/** True when this viewer must not see the entity at all. */
export type QuestObjectGate = (entity: Entity, questLog: Map<string, QuestProgress>) => boolean;

export function makeQuestObjectGate(options: QuestObjectGateOptions): QuestObjectGate {
  if (options.showAllQuestObjects === true) return () => false;
  return isQuestGatedGroundObjectHidden;
}
