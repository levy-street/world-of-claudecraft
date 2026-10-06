// Leader-owned difficulty selection and session-only deferred changes. A blocked
// request keeps the old claim safe, reports its reason, and retries through the
// same reset gates in the existing one-second instance phase. The queue lives on
// Sim; party or leader changes invalidate the original request's authority.
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import { type DungeonDifficulty, isDungeonDifficulty } from '../types';
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
  const result = resetDungeonInstances(ctx, id, { quiet: true });
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
    const result = resetDungeonInstances(ctx, pid, { quiet: true, occupied });
    if (result.status !== 'blocked') {
      ctx.pendingDifficultyChanges.delete(pid);
      applied(ctx, pid, request.difficulty);
    } else if (result.text !== request.lastReason) {
      request.lastReason = result.text;
      ctx.error(pid, result.text);
    }
  }
}
