// The Buried Hoard reward chest: the final boss falls, a chest appears, and each
// entrant who opens it is paid the map's table.
//
// It replaces the old silent payout at the moment of the kill with a reward a
// player walks up to and opens, without changing WHAT anyone is paid or who is
// eligible: eligibility is frozen at the kill (the same participant list the
// payout always used), the table is payTreasureVault's, and nobody can lose
// their share by walking off, because leaving the hoard, or the hoard being torn
// down, settles every unopened share automatically.
//
// One chest per run, ever: the spawn is idempotent on the run's own state, so a
// duplicated death event, a lingering slot or a second completion pass can never
// make a second one.

import { createGroundObject } from '../entity';
import type { SimContext } from '../sim_context';
import { payTreasureVault } from '../treasure_vault';
import { dist2d } from '../types';
import type { HoardRewardChestState, RiftInstance } from './types';

export type { HoardRewardChestState };

export const HOARD_REWARD_CHEST_TEMPLATE = 'hoard_reward_chest';
export const HOARD_REWARD_CHEST_OPEN_TEMPLATE = 'hoard_reward_chest_open';
/** Yards in front of the dais the chest stands: clear of the fallen boss. */
export const HOARD_REWARD_CHEST_DAIS_GAP = 7.5;
/** Yards from the chest within which it can be opened. */
export const HOARD_REWARD_CHEST_RANGE = 4;

export function isHoardRewardChestTemplate(templateId: string | undefined): boolean {
  return (
    templateId === HOARD_REWARD_CHEST_TEMPLATE || templateId === HOARD_REWARD_CHEST_OPEN_TEMPLATE
  );
}

/** Spawn the run's chest at `pos`. A no-op if this run already has one. */
export function spawnHoardRewardChest(
  ctx: SimContext,
  inst: RiftInstance,
  participants: readonly number[],
  pos: { x: number; z: number },
  bossTemplateId?: string,
  pendingSave = false,
): void {
  if (!inst.vault || inst.vault.chest) return;
  const chest = createGroundObject(ctx.nextId++, '', 'Hoard Chest', ctx.groundPos(pos.x, pos.z));
  chest.templateId = HOARD_REWARD_CHEST_TEMPLATE;
  chest.objectItemId = null;
  chest.lootable = !pendingSave;
  if (pendingSave) chest.respawnTimer = Number.MAX_SAFE_INTEGER;
  // Its clasp faces back down the room, toward the players walking up to it
  // (a hoard runs from its entrance at low z to the dais at high z).
  chest.facing = Math.PI;
  chest.prevFacing = Math.PI;
  // Render-only: the rarity colours the chest's light. Already on the wire.
  chest.vaultRarity = inst.vault.rarity;
  ctx.addEntity(chest);
  inst.vault.chest = {
    entityId: chest.id,
    eligible: [...participants],
    claimed: [],
    ...(pendingSave ? { pendingSave: true, claiming: [] } : {}),
    bossTemplateId,
  };
}

/** The host has durably frozen every reward claim; only now may the chest open. */
export function confirmHoardRewardChest(ctx: SimContext, attemptId: string): boolean {
  const inst = ctx.riftInstances.find((candidate) => candidate.vault?.attemptId === attemptId);
  const state = inst?.vault?.chest;
  if (!state || !state.pendingSave) return false;
  state.pendingSave = false;
  const chest = ctx.entities.get(state.entityId);
  if (chest) {
    chest.lootable = true;
    chest.respawnTimer = 0;
  }
  return true;
}

/** Release a failed in-flight direct claim so the player can click again. */
export function releaseHoardRewardClaim(ctx: SimContext, attemptId: string, pid: number): void {
  const state = ctx.riftInstances.find((candidate) => candidate.vault?.attemptId === attemptId)
    ?.vault?.chest;
  if (state?.claiming) state.claiming = state.claiming.filter((candidate) => candidate !== pid);
}

/** Mark a committed direct claim in the runtime chest, without rolling again. */
export function confirmHoardRewardClaim(ctx: SimContext, attemptId: string, pid: number): void {
  const state = ctx.riftInstances.find((candidate) => candidate.vault?.attemptId === attemptId)
    ?.vault?.chest;
  if (!state) return;
  releaseHoardRewardClaim(ctx, attemptId, pid);
  if (!state.claimed.includes(pid)) state.claimed.push(pid);
  const chest = ctx.entities.get(state.entityId);
  if (chest?.templateId === HOARD_REWARD_CHEST_TEMPLATE) {
    chest.templateId = HOARD_REWARD_CHEST_OPEN_TEMPLATE;
    chest.name = 'Opened Hoard Chest';
  }
  closeIfSpent(ctx, state);
}

function unclaimed(state: HoardRewardChestState, pid: number): boolean {
  return state.eligible.includes(pid) && !state.claimed.includes(pid);
}

function closeIfSpent(ctx: SimContext, state: HoardRewardChestState): void {
  if (state.eligible.some((pid) => !state.claimed.includes(pid))) return;
  const chest = ctx.entities.get(state.entityId);
  // Nothing left inside: it stays in the room, open, but is no longer a target.
  if (chest) chest.lootable = false;
}

/** A player opens the chest: their share, once. */
export function openHoardRewardChest(ctx: SimContext, objectId: number, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r || r.e.dead) return;
  const chest = ctx.entities.get(objectId);
  if (!chest || !isHoardRewardChestTemplate(chest.templateId)) return;
  const inst = ctx.riftInstances.find((candidate) => candidate.vault?.chest?.entityId === objectId);
  const state = inst?.vault?.chest;
  if (!inst?.vault || !state) return;
  const player = r.meta.entityId;
  if (dist2d(r.e.pos, chest.pos) > HOARD_REWARD_CHEST_RANGE) {
    ctx.error(player, 'Move closer to the chest.');
    return;
  }
  if (!unclaimed(state, player)) {
    ctx.error(player, 'There is nothing left to take.');
    return;
  }
  if (state.pendingSave) return;
  if (ctx.cfg.vaultRewardNeedsSave && inst.vault.attemptId && r.meta.characterId) {
    if (state.claiming?.includes(player)) return;
    if (!state.claiming) state.claiming = [];
    state.claiming.push(player);
    ctx.emit({
      type: 'treasureVaultClaimRequested',
      attemptId: inst.vault.attemptId,
      characterId: r.meta.characterId,
      pid: player,
    });
    return;
  }
  state.claimed.push(player);
  payTreasureVault(ctx, inst.vault, [player], state.bossTemplateId);
  // The first hand on it swings the lid open for everyone in the room.
  if (chest.templateId === HOARD_REWARD_CHEST_TEMPLATE) {
    chest.templateId = HOARD_REWARD_CHEST_OPEN_TEMPLATE;
    chest.name = 'Opened Hoard Chest';
  }
  closeIfSpent(ctx, state);
}

/** `pid` is leaving the hoard: pay a share they never opened, so walking out
 *  (or being thrown out) can never cost a player their reward. */
export function settleHoardRewardChest(ctx: SimContext, inst: RiftInstance, pid: number): void {
  const state = inst.vault?.chest;
  if (!inst.vault || !state || !unclaimed(state, pid)) return;
  if (ctx.cfg.vaultRewardNeedsSave && inst.vault.attemptId) return;
  state.claimed.push(pid);
  payTreasureVault(ctx, inst.vault, [pid], state.bossTemplateId);
  closeIfSpent(ctx, state);
}

/** The run is being torn down: settle everyone, remove the chest, forget it. */
export function clearHoardRewardChest(ctx: SimContext, inst: RiftInstance): void {
  const state = inst.vault?.chest;
  if (!inst.vault || !state) return;
  for (const pid of [...state.eligible]) settleHoardRewardChest(ctx, inst, pid);
  if (ctx.entities.has(state.entityId)) {
    for (const meta of ctx.players.values()) {
      const player = ctx.entities.get(meta.entityId);
      if (player?.targetId === state.entityId) player.targetId = null;
    }
    ctx.dropEntity(state.entityId);
  }
  delete inst.vault.chest;
}
