// Client-side display/targeting gate for quest-exclusive world entities. Two arms,
// one rule: an entity only this quest's taker can act on is hidden (no nameplate, no
// hp bar, no pick) for a player who is not on that quest.
//   MOB: a template declaring `requiresQuestId` (Broodmother eggs), so the clutch
//   reads as inert scenery. Pairs with the server-authoritative damage gate
//   (combat/quest_damage_gate.ts).
//   GROUND OBJECT: a collectable quest item lying in the world (the sparkle crates,
//   sigils, and caches of GROUND_OBJECTS), whose item def names the quest that wants
//   it. The server already REFUSES the pickup off-quest (interaction.ts pickUpObject),
//   so an off-quest sparkle was pure clutter: a shiny a player walks to and cannot
//   take. Hiding it makes the world show only what the player can actually collect,
//   and the pickup deny stays the authority. Objects that are merely INTERACTED with
//   (bells, huts, wardstones) stay visible: they are scenery in their own right, which
//   is why the arm keys on a `collect` objective for that exact itemId, not on the
//   item carrying a questId.
// Pure: no DOM, no rng, no clock.
import { ITEMS, MOBS, QUESTS } from './data';
import type { Entity, QuestProgress } from './types';

/** Active or ready: the two states in which a quest's own entities are shown, and the
 *  same pair `pickUpObject` accepts a quest-item pickup in. */
function onQuest(questLog: ReadonlyMap<string, QuestProgress>, questId: string): boolean {
  const qp = questLog.get(questId);
  return !!qp && (qp.state === 'active' || qp.state === 'ready');
}

/** The quest a ground object's item is COLLECTED for, or null when the object is not a
 *  quest collectable (plain loot, or an interact-only target such as a bell or a hut). */
function collectQuestForObject(entity: Entity): string | null {
  const itemId = entity.objectItemId;
  if (!itemId) return null;
  const questId = ITEMS[itemId]?.questId;
  if (!questId) return null;
  const quest = QUESTS[questId];
  if (!quest) return null;
  const collected = quest.objectives.some((o) => o.type === 'collect' && o.itemId === itemId);
  return collected ? questId : null;
}

/** The GROUND OBJECT arm on its own. Separate from the general predicate because the
 *  two arms want different treatment in the scene graph: a gated mob keeps its body
 *  (inert scenery), while a gated collectable is never built at all, so the renderer
 *  asks this one and the click/nameplate paths ask the general one below. */
export function isQuestGatedGroundObjectHidden(
  entity: Entity,
  questLog: ReadonlyMap<string, QuestProgress>,
): boolean {
  if (entity.kind !== 'object') return false;
  const questId = collectQuestForObject(entity);
  return questId !== null && !onQuest(questLog, questId);
}

export function isQuestGatedEntityHidden(
  entity: Entity,
  questLog: ReadonlyMap<string, QuestProgress>,
): boolean {
  if (entity.kind === 'object') return isQuestGatedGroundObjectHidden(entity, questLog);
  if (entity.kind !== 'mob') return false;
  const gate = MOBS[entity.templateId]?.requiresQuestId;
  if (!gate) return false;
  return !onQuest(questLog, gate);
}
