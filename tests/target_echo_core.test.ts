// The pure pending-target echo core (src/net/target_echo.ts): the decision that
// keeps the online mirror's optimistic target on screen until a snapshot the
// server built AFTER the 'target' command, judged by the input ack rather than a
// snapshot count. The ClientWorld wiring (both write sites, the seq on the wire,
// spectate and reconnect) is pinned by tests/target_echo_client.test.ts.

import { describe, expect, it } from 'vitest';
import {
  armTargetEcho,
  type PendingTargetEcho,
  resolveSelfTarget,
  TARGET_ECHO_SNAPSHOT_BUDGET,
} from '../src/net/target_echo';

describe('resolveSelfTarget', () => {
  it('no hold: the server value applies and nothing is armed', () => {
    expect(resolveSelfTarget(null, 77, 0, true)).toEqual({ targetId: 77, pending: null });
  });

  it('REPRODUCTION: a stale snapshot (ack below the command seq) carrying the PREVIOUS target keeps the optimistic one', () => {
    // The bounce: A was targeted, the player clicks B, and every snapshot the
    // server built before the command still says A. On a slow link that is many
    // snapshots; none of them may show A again.
    let pending: PendingTargetEcho | null = armTargetEcho(88, 5);
    for (let i = 0; i < 12; i++) {
      const r = resolveSelfTarget(pending, 77, 4, true);
      expect(r.targetId).toBe(88);
      expect(r.pending).toMatchObject({ id: 88, seq: 5 });
      pending = r.pending;
    }
  });

  it('the first snapshot whose ack covers the seq releases: an echo confirms', () => {
    const pending = armTargetEcho(88, 5);
    expect(resolveSelfTarget(pending, 88, 5, true)).toEqual({ targetId: 88, pending: null });
  });

  it('the first snapshot whose ack covers the seq releases: a refusal reverts at once', () => {
    // The server refused (dead, invalid, or out of interest): its snapshot after
    // the command still says A, and A it is, without waiting out any budget.
    const pending = armTargetEcho(88, 5);
    expect(resolveSelfTarget(pending, 77, 5, true)).toEqual({ targetId: 77, pending: null });
  });

  it('an ack past the seq (later frames folded in the same snapshot) releases too', () => {
    const pending = armTargetEcho(88, 5);
    expect(resolveSelfTarget(pending, 88, 9, true)).toEqual({ targetId: 88, pending: null });
  });

  it('with a seq armed, a stale snapshot that happens to match the id does NOT release', () => {
    // A -> B -> A in quick succession: the stale pre-command snapshot says A, the
    // same as the live optimistic A. Releasing on that equality would let the
    // B snapshot (built between the two commands) show B, a bounce. The hold
    // waits for the ack of the LAST command instead.
    const pending = armTargetEcho(77, 6);
    expect(resolveSelfTarget(pending, 77, 4, true)).toMatchObject({
      targetId: 77,
      pending: { id: 77, seq: 6 },
    });
    expect(resolveSelfTarget(pending, 88, 5, true)).toMatchObject({ targetId: 77 });
    expect(resolveSelfTarget(pending, 77, 6, true)).toEqual({ targetId: 77, pending: null });
  });

  it('a deselect hold (id null) is confirmed by a null echo, not by the ack alone being absent', () => {
    const pending = armTargetEcho(null, 3);
    expect(resolveSelfTarget(pending, 77, 2, true).targetId).toBeNull();
    expect(resolveSelfTarget(pending, null, 3, true)).toEqual({ targetId: null, pending: null });
  });

  it('valve: with no ack ever covering the seq, the server wins after the budget', () => {
    let pending: PendingTargetEcho | null = armTargetEcho(88, 5);
    for (let i = 1; i < TARGET_ECHO_SNAPSHOT_BUDGET; i++) {
      const r = resolveSelfTarget(pending, 77, 0, true);
      expect(r.targetId).toBe(88);
      pending = r.pending;
    }
    expect(resolveSelfTarget(pending, 77, 0, true)).toEqual({ targetId: 77, pending: null });
  });

  it('is pure: a counted stale snapshot returns a fresh hold and leaves the input untouched', () => {
    const armed = armTargetEcho(88, 5);
    const r = resolveSelfTarget(armed, 77, 0, true);
    expect(armed.snapshotsLeft).toBe(TARGET_ECHO_SNAPSHOT_BUDGET);
    expect(r.pending).not.toBe(armed);
    expect(r.pending).toEqual({ id: 88, seq: 5, snapshotsLeft: TARGET_ECHO_SNAPSHOT_BUDGET - 1 });
  });

  it('the valve budget spans a couple of seconds of self snapshots, never a stuck target', () => {
    // Self snapshots broadcast once per 50 ms loop callback: 40 is about 2 s,
    // past any playable round trip, and only ever reached when nothing acks.
    expect(TARGET_ECHO_SNAPSHOT_BUDGET).toBe(40);
  });

  it('only the counting write site burns the budget', () => {
    let pending: PendingTargetEcho | null = armTargetEcho(88, 5);
    for (let i = 0; i < TARGET_ECHO_SNAPSHOT_BUDGET * 2; i++) {
      const r = resolveSelfTarget(pending, 77, 0, false);
      expect(r.targetId).toBe(88);
      pending = r.pending;
    }
    expect(pending?.snapshotsLeft).toBe(TARGET_ECHO_SNAPSHOT_BUDGET);
  });
});
