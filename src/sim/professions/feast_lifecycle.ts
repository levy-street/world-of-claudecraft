// Match feasts die with the instance where they were placed. Capture the
// mode and match id at placement: the owner can leave before the match ends,
// and that fighter's overworld table must not be mistaken for a match table.
import type { SimContext } from '../sim_context';

export interface FeastMatchScope {
  kind: 'arena' | 'battleground';
  id: number;
}

/** Keep the owner rather than its array: a room can replace its object roster. */
export interface FeastObjectOwner {
  readonly objectIds: number[];
}

export function feastMatchScope(ctx: SimContext, pid: number): FeastMatchScope | undefined {
  const arena = ctx.arenaMatches.get(pid);
  if (arena) return { kind: 'arena', id: arena.id };
  const battleground = ctx.bgMatches.get(pid);
  if (battleground) return { kind: 'battleground', id: battleground.id };
  return undefined;
}

/** Retire only this table, including stale ids whose entity already vanished.
 * The room lookup costs nothing in steady state; this roster walk runs only
 * on retirement, keeping the rift's existing per-tick lift roster bounded. */
export function removeFeast(ctx: SimContext, id: number): void {
  const roster = ctx.feasts.get(id)?.objectOwner?.objectIds;
  if (roster) {
    const index = roster.indexOf(id);
    if (index >= 0) roster.splice(index, 1);
  }
  ctx.feasts.delete(id);
  if (ctx.entities.has(id)) ctx.dropEntity(id);
}

/** Arena and battleground counters are separate numeric domains. Remove
 * both the entity and its owner slot at release, before the instance is reused. */
export function removeMatchFeasts(
  ctx: SimContext,
  kind: FeastMatchScope['kind'],
  matchId: number,
): void {
  for (const [id, feast] of ctx.feasts) {
    if (feast.match?.kind !== kind || feast.match.id !== matchId) continue;
    removeFeast(ctx, id);
  }
}
