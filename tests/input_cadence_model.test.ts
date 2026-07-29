// The cadence-model test matrix (packet-3-input-cadence.md, R13 + R14): a
// deterministic timeline generator models the REAL client input send scheme,
// the unconditional interval timer plus the changed-only gated rAF flush that
// share one gate clock in src/net/online.ts, built from the REAL constants in
// src/net/input_send_cadence.ts (the R13 lockstep: a client cadence change
// flips this matrix loudly instead of silently invalidating the server
// sizing). Every generated timeline is driven through the full server inbound
// chain, the pre-parse gate with its byte budget and shared abuse window
// (server/msg_rate_limit.ts) and the post-parse per-class lanes
// (server/msg_lanes.ts), composed in exactly the GameServer.handleMessage /
// dispatchMessage order pinned by the phase 02/03 seam tests. Injected time
// only: no fake timers, no real clocks, no polling.

import { describe, expect, it } from 'vitest';
import {
  classifyMsgLane,
  consumeLaneToken,
  createMsgLanes,
  MSG_LANE_MOVEMENT_REFILL_PER_SECOND,
} from '../server/msg_lanes';
import {
  consumeInboundFrame,
  createMsgRateBucket,
  MSG_RATE_REFILL_PER_SECOND,
  type MsgDropCause,
  tallyDrop,
} from '../server/msg_rate_limit';
import {
  INPUT_FLUSH_GATE_MS,
  INPUT_SEND_TIMER_INTERVAL_MS,
  inputFlushGateOpen,
} from '../src/net/input_send_cadence';
import { TURN_SPEED } from '../src/sim/types';

// ---------------------------------------------------------------------------
// Frame builders: the serialized shapes the real client puts on the wire, so
// raw.length reaching the byte budget is the honest UTF-16 code-unit measure
// of real traffic (input frames land in the measured 74 to 106 byte range).
// ---------------------------------------------------------------------------

type FrameKind = 'input' | 'cast' | 'chat' | 'telemetry' | 'challenge' | 'logout';

interface SendEvent {
  atMs: number; // receive time; equals send time except in the stall arm
  kind: FrameKind;
  raw: string;
}

// Mirrors online.ts sendInput for a held keyboard turn: forward held, turn
// flags zeroed on the wire (keyboard_turn_facing streams the heading on the
// facing channel), the raw double facing serialized as-is.
function inputRaw(seq: number, facing: number): string {
  return JSON.stringify({
    t: 'input',
    seq,
    mi: { f: 1, b: 0, tl: 0, tr: 0, sl: 0, sr: 0, j: 0 },
    facing,
  });
}

function castRaw(): string {
  return JSON.stringify({ t: 'cmd', cmd: 'castSlot', slot: 0 });
}

function chatRaw(line: number): string {
  return JSON.stringify({ t: 'cmd', cmd: 'chat', text: `cadence matrix check line ${line}` });
}

const TELEMETRY_RAW = JSON.stringify({ t: 'cmd', cmd: 'telemetry', apm: 42 });
const CHALLENGE_RAW = JSON.stringify({
  t: 'cmd',
  cmd: 'challengeResponse',
  nonce: 'model',
  sig: '0123456789abcdef',
});
const LOGOUT_RAW = JSON.stringify({ t: 'logout' });

// ---------------------------------------------------------------------------
// The client cadence model (R13): one merged walk over the timer grid and the
// rAF grid, reproducing the online.ts sendInput scheme from the REAL imported
// constants. The timer arm sends unconditionally and the flush arm sends only
// when the input signature changed AND the shared gate is open; EVERY send
// resets the shared gate clock, so a timer send suppresses the next flush
// inside the gate window (the timer-resets-the-gate interaction).
// ---------------------------------------------------------------------------

// A held turn integrates TURN_SPEED per rendered frame
// (src/game/keyboard_turn_facing.ts) and streams the heading, so the input
// signature (facing quantized to 1e-4 rad in online.ts inputSignature)
// changes every frame at every refresh rate in the matrix: even at 240 Hz one
// frame moves the heading about 131 quanta.
function advanceFacing(facing: number, frameMs: number): number {
  let next = facing + TURN_SPEED * (frameMs / 1000);
  if (next > Math.PI) next -= 2 * Math.PI;
  return next;
}

function facingSig(facing: number): string {
  return Math.round(facing * 10000).toString();
}

function heldTurnInputStream(hz: number, timerOffsetMs: number, durationMs: number): SendEvent[] {
  const frameMs = 1000 / hz;
  const events: SendEvent[] = [];
  let lastSentAtMs = Number.NEGATIVE_INFINITY;
  let lastSig = '';
  let facing = 0.1;
  let seq = 0;
  const send = (atMs: number) => {
    seq += 1;
    events.push({ atMs, kind: 'input', raw: inputRaw(seq, facing) });
    lastSentAtMs = atMs;
    lastSig = facingSig(facing);
  };
  let timerIndex = 1; // setInterval first fires one whole interval in
  let rafIndex = 0;
  for (;;) {
    const timerAt = timerOffsetMs + timerIndex * INPUT_SEND_TIMER_INTERVAL_MS;
    const rafAt = rafIndex * frameMs;
    const timerDue = timerAt <= durationMs;
    const rafDue = rafAt <= durationMs;
    if (!timerDue && !rafDue) break;
    if (timerDue && (!rafDue || timerAt <= rafAt)) {
      // Timer beat: unconditional send of the input state as of the LAST
      // rendered frame (ties process the timer first: at the same instant the
      // interval callback still sees the pre-frame facing, and the flush that
      // follows is gate-suppressed at zero elapsed).
      send(timerAt);
      timerIndex += 1;
    } else {
      // Rendered frame: the held turn moves the heading first, then
      // flushInput sends only through the REAL gate predicate.
      facing = advanceFacing(facing, frameMs);
      if (facingSig(facing) !== lastSig && inputFlushGateOpen(rafAt, lastSentAtMs)) send(rafAt);
      rafIndex += 1;
    }
  }
  return events;
}

function everyMs(
  startMs: number,
  stepMs: number,
  endMs: number,
  kind: FrameKind,
  raw: (index: number) => string,
): SendEvent[] {
  const events: SendEvent[] = [];
  for (let i = 0; ; i += 1) {
    const at = startMs + i * stepMs;
    if (at > endMs) break;
    events.push({ atMs: at, kind, raw: raw(i) });
  }
  return events;
}

function mergeStreams(...streams: SendEvent[][]): SendEvent[] {
  // Stable sort: same-instant events keep their stream order, deterministic.
  return streams.flat().sort((a, b) => a.atMs - b.atMs);
}

// ---------------------------------------------------------------------------
// The server chain harness: the pure modules composed in the exact
// handleMessage / dispatchMessage order (gate BEFORE parse per R3, lane after
// classification, lane drops tallying into the gate's shared abuse window per
// R6, exempt frames never lane-checked, a kick tearing the session down).
// ---------------------------------------------------------------------------

type DropCause = MsgDropCause | 'lane_movement' | 'lane_command' | 'lane_chat';

interface DropRecord {
  atMs: number;
  kind: FrameKind;
  cause: DropCause;
}

interface ChainOutcome {
  sent: Record<FrameKind, number>;
  processed: Record<FrameKind, number>;
  drops: DropRecord[];
  abusiveSecondCount: number;
  kickAtMs: number | null;
}

function zeroKindCounts(): Record<FrameKind, number> {
  return { input: 0, cast: 0, chat: 0, telemetry: 0, challenge: 0, logout: 0 };
}

// Receive-time epoch: an arbitrary real-world second, so the abuse window's
// floor(nowSec) buckets behave exactly as in production.
const EPOCH_SEC = 1_700_000_000;

function runChain(events: SendEvent[]): ChainOutcome {
  const rate = createMsgRateBucket(EPOCH_SEC);
  const lanes = createMsgLanes(EPOCH_SEC);
  const outcome: ChainOutcome = {
    sent: zeroKindCounts(),
    processed: zeroKindCounts(),
    drops: [],
    abusiveSecondCount: 0,
    kickAtMs: null,
  };
  // Abusive seconds EVER: union the ring after every drop, because the ring
  // itself prunes entries older than the window.
  const abusiveEver = new Set<number>();
  const noteAbusive = () => {
    for (const sec of rate.abusiveSeconds) abusiveEver.add(sec);
  };
  for (const ev of events) {
    outcome.sent[ev.kind] += 1;
    if (outcome.kickAtMs !== null) continue; // kickSession tore the session down
    const nowSec = EPOCH_SEC + ev.atMs / 1000;
    const gate = consumeInboundFrame(rate, nowSec, ev.raw.length);
    if (gate.verdict !== 'allow') {
      outcome.drops.push({ atMs: ev.atMs, kind: ev.kind, cause: gate.cause });
      if (gate.verdict === 'kick') outcome.kickAtMs = ev.atMs;
      noteAbusive();
      continue;
    }
    const msg = JSON.parse(ev.raw);
    const laneClass = classifyMsgLane(msg);
    if (laneClass !== 'exempt') {
      if (consumeLaneToken(lanes, laneClass, nowSec) === 'drop') {
        outcome.drops.push({ atMs: ev.atMs, kind: ev.kind, cause: `lane_${laneClass}` });
        if (tallyDrop(rate, nowSec) === 'kick') outcome.kickAtMs = ev.atMs;
        noteAbusive();
        continue;
      }
    }
    outcome.processed[ev.kind] += 1;
    if (ev.kind === 'logout') break; // leave() ends the session cleanly
  }
  outcome.abusiveSecondCount = abusiveEver.size;
  return outcome;
}

function dropsOfKind(outcome: ChainOutcome, kind: FrameKind): DropRecord[] {
  return outcome.drops.filter((d) => d.kind === kind);
}

function dropsOfCause(outcome: ChainOutcome, cause: DropCause): DropRecord[] {
  return outcome.drops.filter((d) => d.cause === cause);
}

// ---------------------------------------------------------------------------
// The R14 matrix axes.
// ---------------------------------------------------------------------------

const REFRESH_RATES_HZ = [30, 60, 120, 144, 240] as const;
const TIMER_PHASE_OFFSETS_MS = [0, 7, 13, 29, 41] as const;
const MATRIX_DURATION_MS = 30_000;

type MixName = 'pure turn' | 'turn with gcd casts' | 'turn with mash burst' | 'full mix';

function buildMix(mix: MixName, hz: number, offsetMs: number): SendEvent[] {
  const input = heldTurnInputStream(hz, offsetMs, MATRIX_DURATION_MS);
  // GCD casts: one castSlot per 1.5 s, the classic global-cooldown rhythm.
  const gcd = everyMs(750, 1500, MATRIX_DURATION_MS - 1, 'cast', castRaw);
  // Mash burst: 2 s of castSlot at 30/s mid-stream, above any human rate and
  // still inside the command lane burst.
  const mash = everyMs(10_000, 1000 / 30, 12_000, 'cast', castRaw);
  switch (mix) {
    case 'pure turn':
      return input;
    case 'turn with gcd casts':
      return mergeStreams(input, gcd);
    case 'turn with mash burst':
      return mergeStreams(input, mash);
    case 'full mix': {
      // Chat at the ladder's legal sustained cadence (one line per 3 s, the
      // consumeChatToken refill of a third of a message per second), one apm
      // telemetry beat per 10 s, a challengeResponse mid-stream, and a final
      // clean logout.
      const chat = everyMs(2000, 3000, MATRIX_DURATION_MS - 1, 'chat', (i) => chatRaw(i));
      const telemetry = everyMs(
        5000,
        10_000,
        MATRIX_DURATION_MS - 1,
        'telemetry',
        () => TELEMETRY_RAW,
      );
      const challenge: SendEvent[] = [{ atMs: 13_700, kind: 'challenge', raw: CHALLENGE_RAW }];
      const logout: SendEvent[] = [{ atMs: MATRIX_DURATION_MS, kind: 'logout', raw: LOGOUT_RAW }];
      return mergeStreams(input, gcd, mash, chat, telemetry, challenge, logout);
    }
  }
}

function describeCombo(hz: number, offsetMs: number): string {
  return `hz ${hz} offset ${offsetMs}`;
}

// The legitimate-stream contract of R14: not one drop of any cause, not one
// abusive second, every frame of every kind processed, at every refresh rate
// and timer phase.
function expectCleanRun(outcome: ChainOutcome, combo: string): void {
  expect(outcome.kickAtMs, `kick at ${combo}`).toBeNull();
  expect(outcome.drops, `drops at ${combo}`).toEqual([]);
  expect(outcome.abusiveSecondCount, `abusive seconds at ${combo}`).toBe(0);
  for (const kind of Object.keys(outcome.sent) as FrameKind[]) {
    expect(outcome.processed[kind], `processed ${kind} at ${combo}`).toBe(outcome.sent[kind]);
  }
}

// Model honesty: the generated input stream must be a REAL held-turn load,
// between the timer floor and the analytic hard cap of the send scheme, or a
// broken generator would pass the zero-drop arms vacuously.
function expectHonestInputLoad(events: SendEvent[], combo: string): void {
  const inputs = events.filter((e) => e.kind === 'input');
  const perSecond = new Map<number, number>();
  for (const e of inputs) {
    const sec = Math.floor(e.atMs / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
  }
  const analyticCap = 1000 / INPUT_FLUSH_GATE_MS + 1000 / INPUT_SEND_TIMER_INTERVAL_MS;
  const average = inputs.length / (MATRIX_DURATION_MS / 1000);
  // The floor sits under the measured 30 Hz steady rate of about 40/s (the
  // timer's 20/s plus the suppression-thinned flush arm), well above the
  // timer-only 20/s a broken flush arm would produce.
  expect(average, `average input rate at ${combo}`).toBeGreaterThanOrEqual(35);
  expect(average, `average input rate at ${combo}`).toBeLessThanOrEqual(analyticCap);
  for (const [sec, count] of perSecond) {
    // Whole-second binning can hold one frame more than the sustained cap.
    expect(count, `input sends in second ${sec} at ${combo}`).toBeLessThanOrEqual(
      Math.ceil(analyticCap) + 1,
    );
  }
}

// ---------------------------------------------------------------------------
// Client constant lockstep (R13).
// ---------------------------------------------------------------------------

describe('client cadence constant lockstep', () => {
  it('pins the model constants to the real client cadence exports', () => {
    // The matrix maths above derives from these two imports; if the client
    // cadence ever changes these pins flag the contract for deliberate
    // re-sizing instead of letting the matrix drift.
    expect(INPUT_SEND_TIMER_INTERVAL_MS).toBe(50);
    expect(INPUT_FLUSH_GATE_MS).toBe(16);
  });

  it('opens the flush gate exactly at the gate width', () => {
    expect(inputFlushGateOpen(1016, 1000)).toBe(true);
    expect(inputFlushGateOpen(1015.999, 1000)).toBe(false);
    expect(inputFlushGateOpen(1000, 1000)).toBe(false);
    expect(inputFlushGateOpen(1500, Number.NEGATIVE_INFINITY)).toBe(true);
  });

  it('keeps both server refills above the analytic input stream hard cap', () => {
    // The R5 sizing property, cross-pinned against the REAL client constants:
    // flush arm at most 1000 / gate, timer arm 1000 / interval on top.
    const analyticCap = 1000 / INPUT_FLUSH_GATE_MS + 1000 / INPUT_SEND_TIMER_INTERVAL_MS;
    expect(analyticCap).toBeCloseTo(82.5, 6);
    expect(MSG_LANE_MOVEMENT_REFILL_PER_SECOND).toBeGreaterThan(analyticCap);
    expect(MSG_RATE_REFILL_PER_SECOND).toBeGreaterThan(analyticCap);
  });

  it('ends the harness session at a clean logout and processes nothing after it', () => {
    // Pins the harness's leave semantics: after the logout the session is
    // gone, mirroring the real stale-session guard that returns before any
    // counting once leave marked the session left.
    const outcome = runChain([
      { atMs: 0, kind: 'logout', raw: LOGOUT_RAW },
      { atMs: 10, kind: 'cast', raw: castRaw() },
    ]);
    expect(outcome.processed.logout).toBe(1);
    expect(outcome.processed.cast).toBe(0);
    expect(outcome.drops).toEqual([]);
    expect(outcome.kickAtMs).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The legitimate cadence matrix (R14): 5 refresh rates x 5 timer phases per
// mix, 30 simulated seconds each, all through the full chain.
// ---------------------------------------------------------------------------

describe('legitimate traffic across the cadence matrix', () => {
  for (const hz of REFRESH_RATES_HZ) {
    it(`keeps a pure held turn clean at ${hz} hz across all timer phases`, () => {
      for (const offset of TIMER_PHASE_OFFSETS_MS) {
        const events = buildMix('pure turn', hz, offset);
        expectHonestInputLoad(events, describeCombo(hz, offset));
        expectCleanRun(runChain(events), describeCombo(hz, offset));
      }
    });
  }

  for (const hz of REFRESH_RATES_HZ) {
    it(`keeps a held turn with gcd casts clean at ${hz} hz across all timer phases`, () => {
      for (const offset of TIMER_PHASE_OFFSETS_MS) {
        const events = buildMix('turn with gcd casts', hz, offset);
        const outcome = runChain(events);
        expectCleanRun(outcome, describeCombo(hz, offset));
        expect(outcome.processed.cast, `casts at ${describeCombo(hz, offset)}`).toBe(20);
      }
    });
  }

  for (const hz of REFRESH_RATES_HZ) {
    it(`keeps a held turn with a mash burst clean at ${hz} hz across all timer phases`, () => {
      for (const offset of TIMER_PHASE_OFFSETS_MS) {
        const events = buildMix('turn with mash burst', hz, offset);
        const outcome = runChain(events);
        expectCleanRun(outcome, describeCombo(hz, offset));
        // 2 s of 30/s mash, inclusive of both endpoints on the 1000/30 grid.
        expect(outcome.processed.cast, `casts at ${describeCombo(hz, offset)}`).toBe(61);
      }
    });
  }

  for (const hz of REFRESH_RATES_HZ) {
    it(`processes every exempt and command frame of the full mix at ${hz} hz`, () => {
      for (const offset of TIMER_PHASE_OFFSETS_MS) {
        const combo = describeCombo(hz, offset);
        const outcome = runChain(buildMix('full mix', hz, offset));
        expectCleanRun(outcome, combo);
        // The exemption contract of R5/R14: the telemetry beats, the
        // challengeResponse, and the final logout always process.
        expect(outcome.processed.telemetry, `telemetry at ${combo}`).toBe(3);
        expect(outcome.processed.challenge, `challenge at ${combo}`).toBe(1);
        expect(outcome.processed.logout, `logout at ${combo}`).toBe(1);
        expect(outcome.processed.chat, `chat at ${combo}`).toBe(10);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Stall then flush (R6/R14): a keepalive-window stall buffers the client's
// sends and TCP delivers the whole backlog inside about one receive-time
// second on recovery. The burst drops heavily but concentrates in one or two
// abusive seconds, far under the kick requirement, and live traffic is clean
// again within a second.
// ---------------------------------------------------------------------------

describe('stall then flush burst', () => {
  it('sheds a stalled backlog of twelve hundred frames without ever kicking and recovers within a second', () => {
    const stallStartMs = 5000;
    const flushStartMs = 25_000;
    const flushEndMs = 26_000;
    const liveEndMs = 31_000;
    // A 240 Hz client stalls for 20 s, still inside the keepalive termination
    // window, buffering at the scheme's measured steady rate of about 60/s
    // (the timer replaces one grid flush and pushes the next outside the
    // gate, exactly R2's 60 to 64/s band): about 1,200 frames of backlog.
    const sends = heldTurnInputStream(240, 0, liveEndMs);
    const backlog = sends.filter((e) => e.atMs >= stallStartMs && e.atMs < flushStartMs);
    expect(backlog.length).toBeGreaterThanOrEqual(1150);
    expect(backlog.length).toBeLessThanOrEqual(1300);
    const backlogStart = sends.findIndex((s) => s.atMs >= stallStartMs);
    const events: SendEvent[] = sends.map((e, i) => {
      if (e.atMs < stallStartMs) return e;
      if (e.atMs < flushStartMs) {
        // The backlog lands in receive-time order, spread across one second.
        const index = i - backlogStart;
        return {
          ...e,
          atMs: flushStartMs + (index / backlog.length) * (flushEndMs - flushStartMs),
        };
      }
      // Sends issued after recovery queue behind the flushing backlog: the
      // whole live tail arrives shifted by the one-second flush.
      return { ...e, atMs: e.atMs + (flushEndMs - flushStartMs) };
    });
    const outcome = runChain(events);

    // Heavy shedding, but NEVER a kick: the burst can mark at most two
    // receive-time seconds abusive, far under the five the window requires.
    expect(outcome.kickAtMs).toBeNull();
    expect(outcome.drops.length).toBeGreaterThanOrEqual(800);
    expect(outcome.abusiveSecondCount).toBeGreaterThanOrEqual(1);
    expect(outcome.abusiveSecondCount).toBeLessThanOrEqual(2);

    // Drops return to zero within a second of live traffic resuming.
    const recoveredFromMs = flushEndMs + 1000;
    const tail = events.filter((e) => e.atMs >= recoveredFromMs);
    expect(tail.length).toBeGreaterThanOrEqual(250);
    expect(outcome.drops.filter((d) => d.atMs >= recoveredFromMs)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Flood arms (R14): sustained abuse crosses the shared window and kicks; the
// reserved-lane property holds in both directions all the way up to the kick.
// ---------------------------------------------------------------------------

describe('flood arms cross the abuse window', () => {
  it('kicks a sustained five hundred per second frame flood inside the window', () => {
    // 500/s input frames. The gate burst drains in about half a second, the
    // drop tally crosses the abusive floor in each following second, and the
    // kick verdict rides the drop that makes the fifth abusive second: just
    // past t = 4 s at this rate (R6's "about 5 to 6 s" band was a whole-second
    // approximation; the exactly-once-per-second push kicks on the crossing
    // drop early IN the fifth dropping second; the Close-out record in
    // docs/design/player-performance/packet-3-input-cadence.md settles it).
    let facing = 0.1;
    const flood = everyMs(0, 2, 12_000, 'input', (i) => {
      facing = advanceFacing(facing, 2);
      return inputRaw(i + 1, facing);
    });
    const outcome = runChain(flood);
    expect(outcome.kickAtMs).not.toBeNull();
    expect(outcome.kickAtMs as number).toBeGreaterThan(4000);
    expect(outcome.kickAtMs as number).toBeLessThanOrEqual(10_000);
    expect(outcome.abusiveSecondCount).toBeGreaterThanOrEqual(5);
    for (const drop of outcome.drops) {
      expect(['rate', 'lane_movement']).toContain(drop.cause);
    }
  });

  it('kicks a byte heavy stream through the byte budget on the same window', () => {
    // 120/s of 1 KiB frames: exactly the frame refill, so the frame bucket
    // never dries and every drop is the byte budget's. The frames are
    // lane-EXEMPT telemetry so the arm stays cause-pure, the same filler
    // trick as the phase 03 seam tests. Byte burst drains in about 2.3 s,
    // then about 56 drops per second cross the floor mid-second: the fifth
    // abusive second kicks around t = 6.5 s.
    const base = JSON.stringify({ t: 'cmd', cmd: 'telemetry', apm: 42, pad: '' });
    const padded = JSON.stringify({
      t: 'cmd',
      cmd: 'telemetry',
      apm: 42,
      pad: 'x'.repeat(1024 - base.length),
    });
    expect(padded.length).toBe(1024);
    const flood = everyMs(0, 1000 / 120, 12_000, 'telemetry', () => padded);
    const outcome = runChain(flood);
    expect(outcome.kickAtMs).not.toBeNull();
    expect(outcome.kickAtMs as number).toBeGreaterThan(5000);
    expect(outcome.kickAtMs as number).toBeLessThanOrEqual(10_000);
    expect(dropsOfCause(outcome, 'rate')).toEqual([]);
    expect(outcome.drops.length).toBeGreaterThan(0);
    for (const drop of outcome.drops) {
      expect(drop.cause).toBe('bytes');
    }
  });

  it('drains only the command lane under a cast flood and never touches movement', () => {
    // The reserved-lane property in reverse: 60/s of castSlot alongside a
    // normal 60 Hz held turn. The command lane burst drains in 2 s and sheds
    // about 30 casts per second; the movement stream never loses a frame and
    // the pre-parse gate never fires. Kept under five abusive seconds so the
    // arm pins lane isolation, not the kick (the kick paths get their own
    // arms; a longer cast flood kicking through this window is pinned at the
    // GameServer seam by tests/msg_lanes.test.ts).
    const durationMs = 6400;
    const input = heldTurnInputStream(60, 0, durationMs);
    const casts = everyMs(0, 1000 / 60, durationMs, 'cast', castRaw);
    const outcome = runChain(mergeStreams(input, casts));
    expect(outcome.kickAtMs).toBeNull();
    expect(dropsOfKind(outcome, 'input')).toEqual([]);
    expect(outcome.processed.input).toBe(outcome.sent.input);
    expect(dropsOfCause(outcome, 'rate')).toEqual([]);
    expect(dropsOfCause(outcome, 'bytes')).toEqual([]);
    expect(dropsOfCause(outcome, 'lane_movement')).toEqual([]);
    const commandDrops = dropsOfCause(outcome, 'lane_command');
    expect(commandDrops.length).toBeGreaterThanOrEqual(110);
    expect(outcome.processed.cast + commandDrops.length).toBe(outcome.sent.cast);
  });

  it('delivers every cast intact through a gate-bounded three hundred per second movement burst', () => {
    // THE core pin of the packet, the reserved-lane property in its literal
    // form: a 300/s movement flood burst sized inside the pre-parse gate's
    // budget sheds movement frames at the movement LANE while not one cast
    // drops, by any cause. This is the pure-module mirror of the phase 02
    // GameServer-seam pin with six interleaved casts. The burst is 0.8 s
    // (240 frames against the gate's 180 burst plus refill), then normal
    // held-turn traffic proves clean recovery.
    let facing = 0.1;
    const burst = everyMs(0, 1000 / 300, 799, 'input', (i) => {
      facing = advanceFacing(facing, 1000 / 300);
      return inputRaw(i + 1, facing);
    });
    const casts = everyMs(100, 133, 766, 'cast', castRaw);
    expect(casts.length).toBe(6);
    const after = heldTurnInputStream(60, 0, 3000).map((e) => ({ ...e, atMs: e.atMs + 810 }));
    const outcome = runChain(mergeStreams(burst, casts, after));

    // Not one cast dropped, by any cause; every cast processed.
    expect(dropsOfKind(outcome, 'cast')).toEqual([]);
    expect(outcome.processed.cast).toBe(6);
    // The shedding is entirely the movement lane's: the gate never fires.
    expect(dropsOfCause(outcome, 'rate')).toEqual([]);
    expect(dropsOfCause(outcome, 'bytes')).toEqual([]);
    expect(dropsOfCause(outcome, 'lane_movement').length).toBeGreaterThanOrEqual(30);
    // One abusive second tallies and the session survives, drop-free again
    // once the burst ends.
    expect(outcome.abusiveSecondCount).toBe(1);
    expect(outcome.kickAtMs).toBeNull();
    expect(outcome.drops.filter((d) => d.atMs >= 1000)).toEqual([]);
  });

  it('reserves command lane capacity for casts under a sustained movement flood until the kick lands', () => {
    // The sustained arm of the core pin, up to the abuse-window kick verdict,
    // which this arm pins as arriving. Honesty ruling recorded in
    // the plan doc's Close-out record: once a SUSTAINED super-ceiling flood saturates the
    // deliberately class-blind pre-parse gate (R3, the placement is the flood
    // defense), every frame on the socket shares the gate's loss, casts
    // included, and the constants make a kick without gate saturation
    // structurally impossible (abuse floor 30 plus movement refill 90 equals
    // the gate refill 120). What the lanes guarantee, and what this arm pins,
    // is that the flood consumes ZERO command-lane capacity: no cast is ever
    // lane-dropped, and every cast the gate admits is processed.
    let facing = 0.1;
    const flood = everyMs(0, 1000 / 300, 12_000, 'input', (i) => {
      facing = advanceFacing(facing, 1000 / 300);
      return inputRaw(i + 1, facing);
    });
    const gcd = everyMs(750, 1500, 12_000, 'cast', castRaw);
    const outcome = runChain(mergeStreams(flood, gcd));

    // The kick verdict arrives through the abuse window.
    expect(outcome.kickAtMs).not.toBeNull();
    const kickAtMs = outcome.kickAtMs as number;
    expect(kickAtMs).toBeGreaterThan(4000);
    expect(kickAtMs).toBeLessThanOrEqual(10_000);
    expect(outcome.abusiveSecondCount).toBeGreaterThanOrEqual(5);

    // The reserved-capacity property: zero command-lane drops ever, and any
    // cast loss before the kick is the class-blind gate's, never the lanes'.
    expect(dropsOfCause(outcome, 'lane_command')).toEqual([]);
    const castDrops = dropsOfKind(outcome, 'cast');
    for (const drop of castDrops) {
      expect(drop.cause).toBe('rate');
    }
    // Every gate-admitted cast reached the handler.
    const castsBeforeKick = gcd.filter((e) => e.atMs < kickAtMs).length;
    expect(castsBeforeKick).toBeGreaterThanOrEqual(3);
    expect(outcome.processed.cast).toBe(castsBeforeKick - castDrops.length);
    expect(outcome.processed.cast).toBeGreaterThanOrEqual(1);
  });
});
