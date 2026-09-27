// Pending-target echo protection for the ONLINE mirror: the pure decision core.
//
// `ClientWorld.targetEntity` writes the optimistic targetId locally for a snappy
// target frame, then sends the 'target' wire command. A snapshot the server
// generated BEFORE processing that command is nearly always already in flight
// and still carries the OLD target; applied as-is it would show the previous
// target (or blank the frame) for a moment, then the echo would restore the new
// one: the select bounce. So while a command is in flight, every self targetId
// write from a snapshot routes through `resolveSelfTarget`, which keeps showing
// the optimistic value until a snapshot the server built AFTER the command.
//
// How the mirror knows a snapshot is post-command: the 'target' command rides the
// input sequence stream (`seq: ++inputSeq`, the same counter the movement frames
// draw from), the server folds it into `session.lastInputSeq` at receipt, and
// every self snapshot already echoes that high-water as `self.ack`. A snapshot
// whose ack covers the command's seq was built after the server processed it, so
// its target field is the verdict: the echo (same id) or a refusal (an invalid,
// dead, or out-of-interest target), and either way the server's value wins from
// that snapshot on. The earlier idiom released on a snapshot COUNT (three, about
// 150 ms of self snapshots), which on any link with a longer round trip
// reverted to the previous target before the echo arrived: the bounce. The count
// survives only as the last-resort valve below, for a seq nothing ever covers
// (the command never reached the server and no later input frame was sent; a
// server that predates the seq still covers it with the next input frame's ack,
// since the stream is ordered).
//
// Same display-only-optimism contract as `pendingQuestCommands` /
// quest_state_optimistic.ts: the server stays authoritative; this only changes
// which value the mirror DISPLAYS while the command is in flight. Pure: no world
// handle, no DOM, no clock (a snapshot count keeps the valve deterministic).

export interface PendingTargetEcho {
  /** The optimistic id the mirror keeps displaying (null for a deselect). */
  id: number | null;
  /** The input seq the 'target' command carried. */
  seq: number;
  /** Self snapshots left before the valve yields to the server value regardless. */
  snapshotsLeft: number;
}

/**
 * How many self snapshots a pending target echo may hold the optimistic value
 * when no ack ever covers its seq (the reconcile valve: a hold must never leave
 * a stuck target). Self snapshots broadcast once per 50 ms server loop callback,
 * so this spans about two seconds, well past any playable round trip; with the
 * ack in play the hold releases within one round trip and the valve never
 * fires. A snapshot COUNT rather than wall-clock keeps the valve deterministic
 * in tests (and needs no clock at all in the decode path).
 */
export const TARGET_ECHO_SNAPSHOT_BUDGET = 40;

/** Arm a hold for a 'target' command that was just sent (last write wins). */
export function armTargetEcho(id: number | null, seq: number): PendingTargetEcho {
  return { id, seq, snapshotsLeft: TARGET_ECHO_SNAPSHOT_BUDGET };
}

export interface SelfTargetResolution {
  /** The targetId the mirror should hold after this snapshot write. */
  targetId: number | null;
  /** The hold to keep (null once released). */
  pending: PendingTargetEcho | null;
}

/**
 * Resolve one self targetId write from a snapshot against the pending hold.
 *
 * `ackedInputSeq` is the mirror's folded `self.ack` at the time of the write.
 * The two snapshot sites that write the self targetId (the wireEntity `tgt`
 * decode and the precise `target` self decode) both route here; only the self
 * decode counts toward the valve (`countStale`), so one snapshot never burns two
 * units of the budget. The self decode also runs after the snapshot's ack has
 * been folded, so it is the site that sees the release.
 *
 * Deliberately no release on the id merely matching: A -> B -> A in quick
 * succession would release on the stale pre-command snapshot (A) and then show
 * the intermediate B echo, a bounce. Only the ack of the LAST command releases.
 */
export function resolveSelfTarget(
  pending: PendingTargetEcho | null,
  serverTarget: number | null,
  ackedInputSeq: number,
  countStale: boolean,
): SelfTargetResolution {
  if (!pending) return { targetId: serverTarget, pending: null };
  // The server has processed the command: this snapshot's value is its verdict
  // (the echo or a refusal). Resume normal mirroring so a LATER server-initiated
  // change (target death, out of interest) applies again.
  if (ackedInputSeq >= pending.seq) return { targetId: serverTarget, pending: null };
  if (countStale) {
    const snapshotsLeft = pending.snapshotsLeft - 1;
    // Reconciliation valve: nothing ever acked the command. Server authority wins.
    if (snapshotsLeft <= 0) return { targetId: serverTarget, pending: null };
    // A fresh record, never an in-place decrement: the caller adopts the returned
    // hold, and the input stays untouched (pure means pure).
    return { targetId: pending.id, pending: { ...pending, snapshotsLeft } };
  }
  // A stale pre-command snapshot: keep displaying the optimistic value. Assigned
  // (not merely skipped) so the wireEntity write earlier in the same snapshot
  // pass cannot leave a clobbered value behind.
  return { targetId: pending.id, pending };
}
