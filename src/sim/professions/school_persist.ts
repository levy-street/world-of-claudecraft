// Persisting per-player profession-school task cooldowns across save/load,
// the exact node_persist.ts scheme (D6): `PlayerMeta.schoolTaskReadyAt` maps
// taskId to the ABSOLUTE sim.time at or after which that player may submit
// that task again (absent means ready; see schools.ts professionSchoolsView,
// whose per-task readySeconds reads this same map).
//
// The sim is clock-agnostic (no Date.now) and every host's sim.time starts at
// zero, so we persist REMAINING-time deltas, not absolute readiness: timers
// freeze for the duration of a logout and resume on load. Pure leaf, so a
// Vitest drives it without a live Sim.

import { schoolTaskById } from '../content/profession_schools';

const positive = (n: number): boolean => Number.isFinite(n) && n > 0;

/** Snapshot the live readiness map as remaining-time deltas. Returns
 *  undefined when no timer is still running (zero-default omission), so a
 *  character with every task ready serializes byte-identically to one saved
 *  before this field existed. KEY-SORTED so the serialized form stays stable
 *  and readable across saves. */
export function serializeSchoolTaskReadiness(
  schoolTaskReadyAt: Readonly<Record<string, number>>,
  now: number,
): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  let any = false;
  for (const [taskId, readyAt] of Object.entries(schoolTaskReadyAt).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const remaining = Math.round((readyAt - now) * 100) / 100;
    if (positive(remaining)) {
      out[taskId] = remaining;
      any = true;
    }
  }
  return any ? out : undefined;
}

/** Rebuild a saved remaining-deltas record into a fresh readiness map
 *  anchored at the current clock. Only LIVE task ids survive (a retired id
 *  self-heals out of the save on the next round trip), non-finite and
 *  non-positive entries drop defensively, and each remaining clamps to its
 *  task's own cooldownSeconds so a tampered save can never lock a task past
 *  one real cooldown. Always returns a fresh map (an absent field loads to
 *  the everything-ready default). */
export function applySchoolTaskReadiness(
  saved: Record<string, number> | undefined | null,
  now: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!saved) return out;
  for (const [taskId, remaining] of Object.entries(saved)) {
    const task = schoolTaskById(taskId);
    if (!task || !positive(remaining)) continue;
    out[taskId] = now + Math.min(remaining, task.cooldownSeconds);
  }
  return out;
}
