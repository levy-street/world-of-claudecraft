// Client-side display/targeting gate for quest-exclusive mobs (Broodmother eggs).
// A mob whose template declares `requiresQuestId` is hidden (no nameplate or hp
// bar) and not targetable/interactable for a player who is not on that quest, so
// the clutch reads as inert scenery. Pairs with the server-authoritative damage
// gate (combat/quest_damage_gate.ts). Pure: no DOM, no rng, no clock.
import { MOBS } from './data';
import type { Entity, QuestProgress } from './types';

export function isQuestGatedEntityHidden(
  entity: Entity,
  questLog: Map<string, QuestProgress>,
): boolean {
  if (entity.kind !== 'mob') return false;
  const gate = MOBS[entity.templateId]?.requiresQuestId;
  if (!gate) return false;
  const qp = questLog.get(gate);
  return !qp || (qp.state !== 'active' && qp.state !== 'ready');
}
