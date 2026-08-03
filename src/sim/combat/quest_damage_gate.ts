// Quest-gated destructible damage gate. A mob whose template declares
// `requiresQuestId` may only be harmed by a player (or that player's pet) who has
// the named quest active or ready. Everyone else's hit is a silent no-op, so a
// quest-exclusive object like a Broodmother egg cannot be griefed by passers-by.
// Pure and host-agnostic (no ctx, no rng, no clock) so it unit-tests directly.
import { MOBS } from '../data';
import type { PlayerMeta } from '../sim';
import type { Entity } from '../types';

export function questGateBlocksDamage(
  players: Map<number, PlayerMeta>,
  source: Entity | null,
  target: Entity,
): boolean {
  if (target.kind !== 'mob' || !source) return false;
  const gateQuest = MOBS[target.templateId]?.requiresQuestId;
  if (!gateQuest) return false;
  const attackerPid = source.kind === 'player' ? source.id : source.ownerId;
  const attacker = attackerPid !== null ? players.get(attackerPid) : undefined;
  const qp = attacker?.questLog.get(gateQuest);
  return !qp || (qp.state !== 'active' && qp.state !== 'ready');
}
