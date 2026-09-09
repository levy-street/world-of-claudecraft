import type { PlayerMeta } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import { healingTakenMult } from '../heal';
import { DOCTRINE_RANGE, isCurrentGroupMember } from './doctrine';

export const SCOURING_MERCY_RESCUE_RADIUS = 10;
export const SCOURING_MERCY_RESCUE_MAX_RECIPIENTS = 2;
export const SCOURING_MERCY_RESCUE_FRACTION = 0.5;

// Choose injured group allies near the primary target, visible to the priest.
// Lowest health fraction wins; entity id breaks ties deterministically.
export function selectScouringMercyRescueRecipients(
  ctx: SimContext,
  priest: Entity,
  primary: Entity,
  radius = SCOURING_MERCY_RESCUE_RADIUS,
  maxRecipients = SCOURING_MERCY_RESCUE_MAX_RECIPIENTS,
): Entity[] {
  const party = ctx.partyOf(priest.id);
  const memberIds = party?.members ?? [priest.id];
  const candidates: { entity: Entity; fraction: number }[] = [];
  for (const id of memberIds) {
    if (id === primary.id) continue;
    const entity = ctx.entities.get(id);
    if (!entity || !isCurrentGroupMember(ctx, priest, entity)) continue;
    if (entity.hp >= entity.maxHp) continue; // only currently injured allies
    const dx = entity.pos.x - primary.pos.x;
    const dz = entity.pos.z - primary.pos.z;
    if (dx * dx + dz * dz > radius * radius) continue;
    if (!ctx.hasLineOfSight(priest, entity)) continue;
    candidates.push({ entity, fraction: entity.maxHp > 0 ? entity.hp / entity.maxHp : 1 });
  }
  candidates.sort((a, b) => a.fraction - b.fraction || a.entity.id - b.entity.id);
  return candidates.slice(0, maxRecipients).map((c) => c.entity);
}

// Copies inherit the resolved source amount, but take each recipient's
// incoming-heal modifier once. applyHeal still handles absorbs and overheal.
export function applyScouringMercyRescueCopies(
  ctx: SimContext,
  priest: Entity,
  recipients: readonly Entity[],
  effectiveHeal: number,
): void {
  if (effectiveHeal <= 0) return;
  for (const ally of recipients) {
    const copyAmount = Math.max(
      0,
      Math.round(effectiveHeal * SCOURING_MERCY_RESCUE_FRACTION * healingTakenMult(ctx, ally)),
    );
    ctx.applyHeal(
      priest,
      ally,
      copyAmount,
      'Scouring Mercy',
      'scouring_mercy',
      false,
      false,
      false,
      true,
    );
  }
}

export function doctrineScouringMercyRescue(
  ctx: SimContext,
  priest: Entity,
  meta: PlayerMeta,
  primary: Entity,
  effectiveHeal: number,
): void {
  if (meta.cls !== 'priest' || meta.talents.spec !== 'discipline') return;
  if (effectiveHeal <= 0) return;
  if (!isCurrentGroupMember(ctx, priest, primary)) return;
  const dx = primary.pos.x - priest.pos.x;
  const dz = primary.pos.z - priest.pos.z;
  if (dx * dx + dz * dz > DOCTRINE_RANGE * DOCTRINE_RANGE) return;
  const recipients = selectScouringMercyRescueRecipients(ctx, priest, primary);
  applyScouringMercyRescueCopies(ctx, priest, recipients, effectiveHeal);
}
