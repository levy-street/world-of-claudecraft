import { DUNGEONS, MOBS } from '../../data';
import { VARKHUL_BOSS_ID } from '../../ignivar_raid_ids';
import { claimedInstanceForMob, instanceKeyFor } from '../../instances/dungeons';
import { claimedSlotOf } from '../../instances/instance_combat_hold';
import { isRaidRoom } from '../../raid_rooms';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { dist2d, type Entity, IGNIVAR_BOSS_ID, NYTHRAXIS_BOSS_ID } from '../../types';
import { VARKHUL_ENGAGE_RADIUS, varkhulEngagePulled } from '../../varkhul_engage';
import { BOSS_ENCOUNTER_COMBAT_RANGE } from '../engaged_combat';
import { resetSpiritBombProgress } from './spirit_bomb';
import { clearSpiritBombResidual } from './spirit_bomb_residual';

const SCRIPTED_RAID_BOSSES: ReadonlySet<string> = new Set([
  IGNIVAR_BOSS_ID,
  NYTHRAXIS_BOSS_ID,
  VARKHUL_BOSS_ID,
]);

function isRaidBoss(ctx: SimContext, boss: Entity): boolean {
  if (boss.kind !== 'mob' || boss.ownerId !== null) return false;
  if (MOBS[boss.templateId]?.boss !== true && !SCRIPTED_RAID_BOSSES.has(boss.templateId))
    return false;
  const slot = claimedInstanceForMob(ctx, boss.id);
  if (slot) {
    return (
      isRaidRoom(slot.dungeonId) &&
      MOBS[boss.templateId]?.boss === true &&
      DUNGEONS[slot.dungeonId]?.spawns.some((spawn) => spawn.mobId === boss.templateId) === true
    );
  }
  return SCRIPTED_RAID_BOSSES.has(boss.templateId);
}

function actualPullEligible(ctx: SimContext, boss: Entity, slot: InstanceSlot | null): boolean {
  if (
    boss.templateId !== VARKHUL_BOSS_ID ||
    (boss.varkhul !== undefined && boss.varkhul.engage.phase !== 'forging')
  )
    return true;
  if (varkhulEngagePulled(boss.pos, boss.hp / boss.maxHp, [])) return true;
  // Use his existing approach-or-damage gate, so ranged threat alone cannot
  // spend a bank while he is still working at the anvil.
  return ctx.grid.someInRadius(
    boss.pos.x,
    boss.pos.z,
    VARKHUL_ENGAGE_RADIUS,
    (player) =>
      player.kind === 'player' &&
      !player.dead &&
      (slot === null || claimedSlotOf(ctx, player) === slot) &&
      varkhulEngagePulled(boss.pos, boss.hp / boss.maxHp, [player.pos]),
  );
}

function belongsToPull(ctx: SimContext, player: Entity, boss: Entity, slot: InstanceSlot | null) {
  const playerSlot = claimedSlotOf(ctx, player);
  if (!slot)
    return playerSlot === null && dist2d(player.pos, boss.pos) <= BOSS_ENCOUNTER_COMBAT_RANGE;
  if (playerSlot === slot) return true;
  // Roster members outside the arena cannot preload a bank and join after the
  // pull. A member already in another claim is never part of this attempt.
  return (
    instanceKeyFor(ctx, player.id) === slot.partyKey &&
    (playerSlot === null ||
      (playerSlot.partyKey === slot.partyKey && playerSlot.dungeonId !== slot.dungeonId))
  );
}

/** Synchronous, once per real pull, before a preloaded cast can resolve. */
export function beginSpiritBombRaidPull(ctx: SimContext, boss: Entity): void {
  if (boss.dead || boss.spiritBombRaidPullStarted || !isRaidBoss(ctx, boss)) return;
  const slot = claimedInstanceForMob(ctx, boss.id);
  if (!actualPullEligible(ctx, boss, slot)) return;
  boss.spiritBombRaidPullStarted = true;
  for (const meta of ctx.players.values()) {
    const player = ctx.entities.get(meta.entityId);
    if (player?.kind === 'player' && belongsToPull(ctx, player, boss, slot)) {
      resetSpiritBombProgress(ctx, player);
      clearSpiritBombResidual(ctx, player.id);
    }
  }
}

/** A pre-existing region cannot start a raid boss when it enters the area. */
export function spiritBombResidualBlocked(ctx: SimContext, target: Entity): boolean {
  return !target.spiritBombRaidPullStarted && isRaidBoss(ctx, target);
}

/** Rearm the next attempt without spending progress gained outside the fight. */
export function resetSpiritBombRaidPull(boss: Entity): void {
  boss.spiritBombRaidPullStarted = undefined;
}

/** A bank prepared outside a raid cannot open its boss, including through splash. */
export function spiritBombBlockedByRaidPull(
  ctx: SimContext,
  priest: Entity,
  target: Entity,
  radius: number,
): boolean {
  const unstarted = (boss: Entity) =>
    !boss.dead && !boss.spiritBombRaidPullStarted && isRaidBoss(ctx, boss);
  if (unstarted(target)) return true;
  if (ctx.hostilesInRadius(priest, target.pos, radius).some(unstarted)) return true;
  // Scripted pulls may set combat directly. Deny completion during the gap
  // before their encounter update performs the synchronous reset.
  const slot = claimedSlotOf(ctx, priest);
  return (
    slot !== null &&
    isRaidRoom(slot.dungeonId) &&
    slot.mobIds.some((id) => {
      const boss = ctx.entities.get(id);
      return !!boss && boss.inCombat && unstarted(boss) && actualPullEligible(ctx, boss, slot);
    })
  );
}
