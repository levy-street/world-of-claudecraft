// Leader-owned difficulty selection and session-only deferred changes. A blocked
// request keeps the old claim safe, reports its reason, and retries through the
// same reset gates in the existing one-second instance phase. The queue lives on
// Sim; party or leader changes invalidate the original request's authority.
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import { type DungeonDifficulty, isDungeonDifficulty } from '../types';
import { claimDifficultyForDungeon } from './difficulty';
import { instanceClaimContains, resetDungeonInstances } from './dungeons';

export interface PendingDifficultyChange {
  key: string;
  difficulty: DungeonDifficulty;
  lastReason: string;
}

function applied(ctx: SimContext, pid: number, difficulty: DungeonDifficulty): void {
  ctx.error(
    pid,
    difficulty === 'heroic'
      ? 'Dungeon difficulty set to Heroic.'
      : 'Dungeon difficulty set to Normal.',
  );
}

/** The group's live claims keyed by owner key, built in ONE pass over the
 * fixed slot list. The server builds it once per broadcast pass so each
 * viewer's unappliedDungeonDifficulty read is a map lookup, not a slot scan. */
export function claimsByOwnerKey(instances: readonly InstanceSlot[]): Map<string, InstanceSlot[]> {
  const out = new Map<string, InstanceSlot[]>();
  for (const inst of instances) {
    if (inst.partyKey === null) continue;
    const list = out.get(inst.partyKey);
    if (list) list.push(inst);
    else out.set(inst.partyKey, [inst]);
  }
  return out;
}

/** The tier the group's existing instances still run on when the selection has
 * not reached them, else null. A refused or queued change keeps the selection
 * (it applies to new claims and to a later Reset), so the menu needs this to
 * avoid showing a tier the live instances are not on. Compares against the
 * per-dungeon clamped tier, the same rule Reset All uses. */
export function unappliedDungeonDifficulty(
  ctx: SimContext,
  pid: number,
  claims?: ReadonlyMap<string, readonly InstanceSlot[]>,
): DungeonDifficulty | null {
  const key = ctx.instanceKeyFor(pid);
  const owned = claims ? claims.get(key) : ctx.instances;
  if (!owned) return null;
  const selected = ctx.dungeonDifficulty(pid);
  for (const inst of owned) {
    // Re-checked even on the shared index: a command between a tick's index
    // build and a later broadcast can free or rekey a slot it listed.
    if (inst.partyKey !== key) continue;
    if (inst.difficulty !== claimDifficultyForDungeon(inst.dungeonId, selected)) {
      return inst.difficulty;
    }
  }
  return null;
}

export function cancelPendingDifficultyChange(ctx: SimContext, pid: number): void {
  if (ctx.pendingDifficultyChanges.delete(pid) && ctx.players.has(pid)) {
    ctx.error(pid, 'Queued difficulty change cancelled because the party or leader changed.');
  }
}

export function setDungeonDifficulty(
  ctx: SimContext,
  difficulty: DungeonDifficulty,
  pid?: number,
): void {
  if (!isDungeonDifficulty(difficulty)) return;
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  const party = ctx.partyOf(id);
  if (party && party.leader !== id) {
    ctx.error(id, 'You are not the party leader.');
    return;
  }
  ctx.pendingDifficultyChanges.delete(id);
  if (difficulty === 'normal') delete r.meta.dungeonDifficulty;
  else r.meta.dungeonDifficulty = difficulty;
  if (party) {
    if (difficulty === 'normal') delete party.dungeonDifficulty;
    else party.dungeonDifficulty = difficulty;
  }
  // Retry even when the preference already matches: an earlier reset may have
  // failed while the old claim stayed live.
  const result = resetDungeonInstances(ctx, id, { quiet: true, transitionOnly: true });
  if (result.status !== 'blocked') {
    applied(ctx, id, difficulty);
    return;
  }
  ctx.error(id, result.text);
  if (result.reason === 'occupancy') {
    ctx.pendingDifficultyChanges.set(id, {
      key: ctx.instanceKeyFor(id),
      difficulty,
      lastReason: result.text,
    });
    ctx.error(
      id,
      'Difficulty change queued because someone or their corpse is still inside. It will apply when the instances are clear.',
    );
  }
}

/** Called inside the existing instance 1 Hz phase, never scans while idle.
 * Build occupancy once across the pending groups' fixed-capacity claims. Each
 * retry reads the shared set rather than scanning the realm's players again. */
export function retryPendingDifficultyChanges(ctx: SimContext): void {
  if (ctx.pendingDifficultyChanges.size === 0) return;
  const keys = new Set<string>();
  for (const [pid, request] of ctx.pendingDifficultyChanges) {
    const party = ctx.partyOf(pid);
    if (
      !ctx.players.has(pid) ||
      ctx.players.get(pid)?.leaving ||
      ctx.instanceKeyFor(pid) !== request.key ||
      (party && party.leader !== pid) ||
      ctx.dungeonDifficulty(pid) !== request.difficulty
    ) {
      cancelPendingDifficultyChange(ctx, pid);
    } else keys.add(request.key);
  }
  if (keys.size === 0) return;
  const claims = ctx.instances.filter((inst) => inst.partyKey !== null && keys.has(inst.partyKey));
  const occupied = new Set<InstanceSlot>();
  for (const meta of ctx.players.values()) {
    const entity = ctx.entities.get(meta.entityId);
    if (!entity) continue;
    for (const claim of claims) {
      if (occupied.has(claim)) continue;
      if (
        instanceClaimContains(claim, entity.pos) ||
        (entity.ghost &&
          entity.corpsePos &&
          entity.corpseInstanceId === claim.exitId &&
          instanceClaimContains(claim, entity.corpsePos))
      )
        occupied.add(claim);
    }
  }
  for (const [pid, request] of ctx.pendingDifficultyChanges) {
    const result = resetDungeonInstances(ctx, pid, {
      quiet: true,
      occupied,
      transitionOnly: true,
    });
    if (result.status !== 'blocked') {
      ctx.pendingDifficultyChanges.delete(pid);
      applied(ctx, pid, request.difficulty);
    } else if (result.text !== request.lastReason) {
      request.lastReason = result.text;
      ctx.error(pid, result.text);
    }
  }
}
