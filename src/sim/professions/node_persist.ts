// Persisting per-player gather-node readiness across save/load (D6).
//
// `PlayerMeta.nodeHarvestReadyAt` maps nodeId to the ABSOLUTE sim.time at or
// after which that player may harvest that node again (absent means ready; see
// gathering.ts isNodeHarvestableBy). It used to be session-only, so a logout
// dropped the whole map and a relog reset every node timer, letting a player
// bypass the 240-second respawn by reconnecting.
//
// The sim is clock-agnostic (no Date.now) and every host's sim.time starts at
// zero, so we persist REMAINING-time deltas, not absolute readiness: timers
// freeze for the duration of the logout and resume on load, the exact
// cooldown_persist.ts scheme (and the same shape the `ncd` wire field already
// ships per tick, so persistence adds zero wire changes). The freeze happens at
// the logout frame, where the character leaves the world through
// serializeCharacter. A linkdead drop's immediate safety-flush save freezes at
// drop time too, but the character stays in the world with its timers counting
// in live sim time, so the ~30 s autosave (which covers linkdead sessions) and
// then the grace-expiry save each overwrite that snapshot with a smaller
// remaining; a crash inside the grace window makes whichever save landed last
// durable. For every timer RUNNING at a save, the frozen remaining is never
// smaller than reality (modulo the two-decimal rounding below, which can
// shave under 5 ms), so the error direction is a longer wait. The one
// corner outside that guarantee: a gather cast still in flight at the drop
// resolves during grace and writes its timer to live memory, durable only at
// the next save (which a deed unlock on the same harvest can force
// immediately); a crash before that save loses the timer WITH the harvest's
// yield and proficiency grant. Yield, proficiency, and timer roll back
// together, value-neutral, never a free reset that keeps the loot.
//
// Readiness stays strictly per-player (one player's timer never touches
// another's; see the D6 ruling in docs/design/professions-tuning-packet.md).
// This is a pure leaf so a Vitest drives it without a live Sim.

import { GATHER_NODES } from '../content/gather_nodes';
import { NODE_HARVEST_TABLE } from './gathering';

// Live node ids with their respawn ceiling: the load filter (a retired or
// hand-edited id drops rather than persisting forever) and the clamp that
// keeps a corrupt remaining from locking a node past one real respawn.
const LIVE_NODE_RESPAWN: ReadonlyMap<string, number> = new Map(
  GATHER_NODES.map((node) => [node.id, NODE_HARVEST_TABLE[node.type].respawnSeconds]),
);

const positive = (n: number): boolean => Number.isFinite(n) && n > 0;

/** O(1) live-node membership off the map above: the countdown read
 *  (Sim.nodeRespawnSecondsFor) runs on the tooltip path and only needs
 *  existence, so it must not pay gatherNodeById's linear GATHER_NODES scan
 *  per call (the whole-branch review's note). */
export function isLiveGatherNodeId(nodeId: string): boolean {
  return LIVE_NODE_RESPAWN.has(nodeId);
}

/** Snapshot the live readiness map as remaining-time deltas. Returns undefined
 *  when no timer is still running (zero-default omission), so a character with
 *  every node ready serializes byte-identically to one saved before the field
 *  existed. Deliberately neither clamps nor filters keys: entries serialize
 *  verbatim, because the one live writer (gathering.ts resolveHarvest) only
 *  ever writes live node ids at exactly now + respawnSeconds, and BOTH
 *  anti-tamper arms (the live-id allowlist and the one-respawn clamp) live on
 *  the LOAD side (applyNodeReadiness below), where hand-edited rows enter.
 *  Write-side copies would only mask a writer bug; the trade is that the
 *  self-heal guarantee rests on resolveHarvest staying the only live writer. */
export function serializeNodeReadiness(
  nodeHarvestReadyAt: Readonly<Record<string, number>>,
  now: number,
): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  let any = false;
  // KEY-SORTED like the packet's other persisted maps (questedHobbies,
  // toolEffectSlots via the fixed id walk), so persisted blob diffs stay
  // readable instead of carrying per-player harvest insertion order. Readers
  // are keyed lookups; only the serialized text changes.
  for (const [nodeId, readyAt] of Object.entries(nodeHarvestReadyAt).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    // Two-decimal rounding, the ncd wire's round2 applied to persistence: a
    // remaining is (accumulated DT sum) minus (accumulated DT sum), so the
    // raw float serializes at up to 18 characters and an all-nodes record
    // doubles in size for precision no reader uses (sub-centisecond error on
    // a 240 second timer). Rounding is idempotent, so the round trip stays a
    // fixed point.
    const remaining = Math.round((readyAt - now) * 100) / 100;
    if (positive(remaining)) {
      out[nodeId] = remaining;
      any = true;
    }
  }
  return any ? out : undefined;
}

/** Rebuild a saved remaining-deltas record into a fresh readiness map anchored
 *  at the current clock. Only LIVE node ids survive (a retired id self-heals
 *  out of the save on the next round trip), non-finite and non-positive
 *  entries drop defensively, and each remaining clamps to its node's own
 *  respawnSeconds so a tampered save can never lock a node for longer than
 *  one real respawn. Always returns a fresh map (an absent field loads to the
 *  everything-ready default). */
export function applyNodeReadiness(
  saved: Record<string, number> | undefined | null,
  now: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!saved) return out;
  for (const [nodeId, remaining] of Object.entries(saved)) {
    const respawn = LIVE_NODE_RESPAWN.get(nodeId);
    if (respawn === undefined || !positive(remaining)) continue;
    out[nodeId] = now + Math.min(remaining, respawn);
  }
  return out;
}
