// Shared "recently exited mid-combat" memory for instanced content (issue #2653).
//
// Walking out of a dungeon door or a rift beacon/portal mid-fight still scrubs the
// leaver (and anything they own) from every inside mob's hate table immediately:
// that is the #1955 anti-exit-kiting fix (instances/dungeons.ts, rift/runs.ts) and
// it stays load-bearing, so nobody can keep landing hits from just outside. But
// with nothing remembered, a party could walk its members out one by one (or the
// last survivor out) and get the whole pack back at full health and fully
// unengaged the moment anyone stepped back in: a free, instant, party-wide combat
// reset with none of the cost of an actual wipe.
//
// This module holds the eligibility-window bookkeeping both systems share: the
// exact threat dropped for a player who left a mob that was genuinely `inCombat`
// is snapshotted for a short window. Walking back into the SAME live claim before
// the window lapses reapplies that snapshot (the owning module forces the mob to
// reacquire), so the fight resumes instead of granting a fresh, unengaged pull.
// Waiting the window out earns a genuine classic-style zone-out reset. Session-only
// state: it lives on the owning InstanceSlot/RiftInstance record and is cleared
// whenever that claim is freed or replaced, never persisted.
//
// Pure leaf: no SimContext import, so a Vitest drives the map/window bookkeeping
// directly. The entity-facing snapshot (reading mob.threat before the scrub) and
// restore (reapplying it, forcing the mob to reacquire) stay in the owning modules,
// since only they can see SimContext/Entity state.

/** How long a mid-combat exit is remembered before it lapses into a genuine
 * reset. The issue leaves the exact policy to a design decision; this value is
 * flagged for maintainer tuning rather than pinned by the report. */
export const COMBAT_EXIT_MEMORY_SECONDS = 30;

/** One mob's threat value for the departing player, captured the instant they
 * left (before the scrub cleared it from the live hate table), plus the mob's
 * `evadeEpoch` at that instant. A live mob whose epoch has since moved on has
 * fully evaded home and been re-engaged as a DIFFERENT pull; the owning module
 * must skip restoring a snapshot that no longer belongs to it (otherwise the
 * remembered threat could rip a teammate's fresh, unrelated pull). */
export type CombatExitThreatEntry = readonly [mobId: number, threat: number, evadeEpoch: number];

export interface CombatExitRecord {
  expiresAt: number;
  mobThreat: readonly CombatExitThreatEntry[];
}

/** Keyed by the departing player's entity id; lives on the owning claim record. */
export type CombatExitMemory = Map<number, CombatExitRecord>;

/** Remember `pid`'s dropped threat for COMBAT_EXIT_MEMORY_SECONDS. A no-op when
 * there was nothing to remember (an out-of-combat exit never calls this with a
 * non-empty snapshot, so it never occupies a memory slot). */
export function recordCombatExit(
  memory: CombatExitMemory,
  pid: number,
  now: number,
  mobThreat: readonly CombatExitThreatEntry[],
): void {
  if (mobThreat.length === 0) return;
  memory.set(pid, { expiresAt: now + COMBAT_EXIT_MEMORY_SECONDS, mobThreat });
}

/** Consume `pid`'s remembered exit: it is removed from the map either way (a
 * lapsed record must never be read twice), and returned only while still inside
 * its window (null once lapsed, or when nothing was ever recorded). */
export function takeCombatExit(
  memory: CombatExitMemory,
  pid: number,
  now: number,
): CombatExitRecord | null {
  const rec = memory.get(pid);
  if (!rec) return null;
  memory.delete(pid);
  return rec.expiresAt > now ? rec : null;
}
