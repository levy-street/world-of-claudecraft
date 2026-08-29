// The realm-global escrow in-flight bound (the escrow write-path rider):
// a counted cap with an immediate refusal, no queue, the leak ceiling (a
// hold past it is reclaimed, counted and loud), and IDENTITY-TOKENED holds
// since the qa-checklist round (a release retires its own stamp, so ages
// are exact, the reclaim hits only the wedged hold, and a reclaimed
// sequence's late release is a no-op). The custody suite proves the wiring
// (refusal kind, slot lifecycle against the real FIFO); this suite pins the
// gate's own arithmetic in isolation under an injected clock.
import { describe, expect, it, vi } from 'vitest';
import {
  createWocEscrowGate,
  WOC_ESCROW_GATE_HOLD_CEILING_MS,
  WOC_ESCROW_GATE_MAX_IN_FLIGHT,
  type WocEscrowHold,
} from '../../server/woc_market_escrow_gate';

function acquired(hold: WocEscrowHold | null): WocEscrowHold {
  if (!hold) throw new Error('expected an acquired hold');
  return hold;
}

describe('woc escrow gate', () => {
  it('admits up to the cap and refuses past it, counting refusals', () => {
    let nowMs = 1_000;
    const gate = createWocEscrowGate(2, { now: () => nowMs });
    expect(gate.tryAcquire()).not.toBeNull();
    expect(gate.tryAcquire()).not.toBeNull();
    // At cap: refused, and the refusal is COUNTED (the readout's lifetime
    // twin of the realm_refused counter kind).
    expect(gate.tryAcquire()).toBeNull();
    expect(gate.tryAcquire()).toBeNull();
    nowMs = 1_500;
    expect(gate.stats()).toEqual({
      inFlight: 2,
      max: 2,
      refused: 2,
      reclaimed: 0,
      // The oldest standing hold's age, off the injected clock.
      oldestHoldMs: 500,
    });
  });

  it('a release frees exactly its own slot', () => {
    const gate = createWocEscrowGate(1, { now: () => 0 });
    const hold = acquired(gate.tryAcquire());
    expect(gate.tryAcquire()).toBeNull();
    hold.release();
    expect(gate.stats().inFlight).toBe(0);
    expect(gate.stats().oldestHoldMs).toBe(0);
    expect(gate.tryAcquire()).not.toBeNull();
    expect(gate.stats()).toMatchObject({ inFlight: 1, max: 1, refused: 1, reclaimed: 0 });
  });

  it('a double release is a no-op and never mints capacity', () => {
    const gate = createWocEscrowGate(2, { now: () => 0 });
    const hold = acquired(gate.tryAcquire());
    hold.release();
    // The defensive extra release must not free anyone else's slot: after
    // it, the gate still admits exactly TWO acquisitions, not three.
    hold.release();
    expect(gate.stats().inFlight).toBe(0);
    expect(gate.tryAcquire()).not.toBeNull();
    expect(gate.tryAcquire()).not.toBeNull();
    expect(gate.tryAcquire()).toBeNull();
  });

  it('stats hands out a fresh snapshot a consumer cannot corrupt', () => {
    const gate = createWocEscrowGate(3, { now: () => 0 });
    gate.tryAcquire();
    const first = gate.stats();
    first.inFlight = 99;
    first.refused = 99;
    expect(gate.stats()).toEqual({
      inFlight: 1,
      max: 3,
      refused: 0,
      reclaimed: 0,
      oldestHoldMs: 0,
    });
  });

  it('reclaims a hold past the ceiling, counted and loud, at the next acquire', () => {
    // The leak arm: a sequence that never settles must not close the realm's
    // listing path for the process lifetime. One BELOW the ceiling still
    // holds; AT the ceiling it is reclaimed and the freed slot admits.
    let nowMs = 0;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const gate = createWocEscrowGate(1, { now: () => nowMs, holdCeilingMs: 10_000 });
      expect(gate.tryAcquire()).not.toBeNull();
      nowMs = 9_999;
      expect(gate.tryAcquire()).toBeNull();
      expect(gate.stats().reclaimed).toBe(0);
      nowMs = 10_000;
      expect(gate.tryAcquire()).not.toBeNull();
      const s = gate.stats();
      expect(s.reclaimed).toBe(1);
      expect(s.inFlight).toBe(1);
      expect(errors).toHaveBeenCalledTimes(1);
      expect(String(errors.mock.calls[0]?.[0])).toContain('escrow gate reclaimed a slot');
    } finally {
      errors.mockRestore();
    }
  });

  it('saturated() RECLAIMS before answering and COUNTS a true answer as a refusal', () => {
    // Two review rounds in one pin. The fix-round blocker: the service
    // consults this probe BEFORE any tryAcquire, so a bare stats read would
    // make a full wedge's saturation permanent (the reclaim, living only in
    // tryAcquire, could never run). The qa-checklist find: the pre-check
    // short-circuits tryAcquire, so an uncounted true answer would leave
    // the refused stat and the realm_refused twin flat during exactly the
    // sustained saturation they exist to surface.
    let nowMs = 0;
    const gate = createWocEscrowGate(2, { now: () => nowMs, holdCeilingMs: 10_000 });
    expect(gate.tryAcquire()).not.toBeNull();
    expect(gate.tryAcquire()).not.toBeNull();
    expect(gate.saturated()).toBe(true);
    expect(gate.saturated()).toBe(true);
    expect(gate.stats().refused).toBe(2);
    // The full wedge: both holds age past the ceiling with NOTHING calling
    // tryAcquire. The probe itself must reclaim, answer unsaturated, and
    // count nothing for the false answer.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      nowMs = 10_000;
      expect(gate.saturated()).toBe(false);
      expect(gate.stats()).toMatchObject({ inFlight: 0, reclaimed: 2, refused: 2 });
      expect(gate.tryAcquire()).not.toBeNull();
    } finally {
      errors.mockRestore();
    }
  });

  it('a release retires ITS OWN stamp: out-of-order settles keep every age exact', () => {
    // The qa-checklist S1 cure. Under the earlier FIFO retirement, a newer
    // sequence settling first removed the OLDEST stamp, so a wedged old
    // hold's age was UNDER-reported and the reclaim could fire late or
    // never under churn. Identity tokens make the surviving age exact.
    let nowMs = 0;
    const gate = createWocEscrowGate(2, { now: () => nowMs });
    acquired(gate.tryAcquire());
    nowMs = 5_000;
    const younger = acquired(gate.tryAcquire());
    nowMs = 6_000;
    younger.release();
    expect(gate.stats().inFlight).toBe(1);
    // The WEDGED older hold reports its true age, not the younger's.
    expect(gate.stats().oldestHoldMs).toBe(6_000);
  });

  it('churn cannot starve the reclaim: the wedged hold is reclaimed exactly at its ceiling', () => {
    // The under-report consequence the S1 finding named: with positional
    // retirement, steady churn kept replacing the oldest stamp and a
    // permanently wedged slot never aged past the ceiling. With identity
    // holds, churn touches only its own stamps.
    let nowMs = 0;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const gate = createWocEscrowGate(2, { now: () => nowMs, holdCeilingMs: 10_000 });
      expect(gate.tryAcquire()).not.toBeNull(); // the wedge, never released
      for (let i = 0; i < 20; i++) {
        nowMs += 1_000;
        const churn = acquired(gate.tryAcquire());
        churn.release();
      }
      // 20s of churn later the wedged hold is long past its 10s ceiling:
      // the next probe reclaims exactly one hold (the wedge), no churn
      // stamp ever masked it.
      expect(gate.saturated()).toBe(false);
      expect(gate.stats()).toMatchObject({ inFlight: 0, reclaimed: 1 });
    } finally {
      errors.mockRestore();
    }
  });

  it('a reclaimed hold releasing LATE is a no-op: no over-free window', () => {
    // The judgment the identity tokens retire: under positional retirement
    // a reclaimed sequence that later settled shifted a YOUNGER sequence's
    // stamp, transiently over-freeing capacity. Now the late release finds
    // its own token already gone and removes nothing.
    let nowMs = 0;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const gate = createWocEscrowGate(2, { now: () => nowMs, holdCeilingMs: 10_000 });
      const wedge = acquired(gate.tryAcquire());
      nowMs = 10_000;
      // The probe reclaims the wedge; a fresh sequence takes a slot.
      expect(gate.saturated()).toBe(false);
      expect(gate.tryAcquire()).not.toBeNull();
      expect(gate.stats().inFlight).toBe(1);
      // The reclaimed sequence finally settles: nothing moves.
      wedge.release();
      expect(gate.stats().inFlight).toBe(1);
      expect(gate.tryAcquire()).not.toBeNull();
      expect(gate.tryAcquire()).toBeNull();
    } finally {
      errors.mockRestore();
    }
  });

  it('defaults to the exported realm cap and hold ceiling', () => {
    const gate = createWocEscrowGate();
    for (let i = 0; i < WOC_ESCROW_GATE_MAX_IN_FLIGHT; i++) {
      expect(gate.tryAcquire()).not.toBeNull();
    }
    expect(gate.tryAcquire()).toBeNull();
    expect(gate.stats().max).toBe(WOC_ESCROW_GATE_MAX_IN_FLIGHT);
    // The ceiling constant itself: the tunables ladder pins its relation to
    // the honest sequence ceiling; here only the literal.
    expect(WOC_ESCROW_GATE_HOLD_CEILING_MS).toBe(400_000);
  });
});
