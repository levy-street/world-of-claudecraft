import { describe, expect, it } from 'vitest';
import {
  type KeyboardTurnArgs,
  newKeyboardTurnState,
  stepKeyboardTurnFacing,
} from '../src/game/keyboard_turn_facing';
import { TURN_SPEED } from '../src/sim/types';

const FRAME_60 = 1 / 60;

const args = (over: Partial<KeyboardTurnArgs> = {}): KeyboardTurnArgs => ({
  turnLeft: false,
  turnRight: false,
  turnAllowed: true,
  sentFacing: null,
  serverFacing: 0,
  echoMs: 0,
  frameDt: FRAME_60,
  ...over,
});

describe('stepKeyboardTurnFacing', () => {
  it('integrates a right turn as a DECREASING facing at TURN_SPEED', () => {
    const st = newKeyboardTurnState();
    const f = stepKeyboardTurnFacing(st, args({ turnRight: true, serverFacing: 1.0 }));
    expect(f).toBeCloseTo(1.0 - TURN_SPEED * FRAME_60, 6);
  });

  it('integrates a left turn as an INCREASING facing at TURN_SPEED', () => {
    const st = newKeyboardTurnState();
    const f = stepKeyboardTurnFacing(st, args({ turnLeft: true, serverFacing: -0.5 }));
    expect(f).toBeCloseTo(-0.5 + TURN_SPEED * FRAME_60, 6);
  });

  it('seeds from the server facing on engage (no first-frame jump)', () => {
    const st = newKeyboardTurnState();
    const f = stepKeyboardTurnFacing(st, args({ turnLeft: true, serverFacing: 2.4 }));
    // one frame of turning away from exactly where the model was displayed
    expect(Math.abs((f as number) - 2.4)).toBeLessThanOrEqual(TURN_SPEED * FRAME_60 + 1e-9);
  });

  it('ignores the stale server facing while a key is held (no mid-turn drag-back)', () => {
    const st = newKeyboardTurnState();
    let f = stepKeyboardTurnFacing(st, args({ turnLeft: true, serverFacing: 0 }));
    // server facing lags a round trip behind; local integration must not chase it
    f = stepKeyboardTurnFacing(st, args({ turnLeft: true, serverFacing: -1.0 }));
    expect(f).toBeCloseTo(2 * TURN_SPEED * FRAME_60, 6);
  });

  it('a non-null sentFacing (mouselook / click-move) clears the state and yields', () => {
    const st = newKeyboardTurnState();
    stepKeyboardTurnFacing(st, args({ turnLeft: true }));
    const f = stepKeyboardTurnFacing(st, args({ turnLeft: true, sentFacing: 1.2 }));
    expect(f).toBeNull();
    expect(st.facing).toBeNull();
  });

  it('NEVER rewinds toward the lagging server facing on release (the nausea bug)', () => {
    // Hold left for half a second, then release. The server facing is still a
    // round trip behind and converging toward us; the display must HOLD, not
    // step backwards at TURN_SPEED and then forward again.
    const st = newKeyboardTurnState();
    let serverFacing = 0;
    for (let i = 0; i < 30; i++) {
      stepKeyboardTurnFacing(st, args({ turnLeft: true, serverFacing }));
    }
    const held = st.facing as number;
    // a realistic echo: the server facing is ~150ms (9 frames) of turning behind
    serverFacing = held - 9 * TURN_SPEED * FRAME_60;
    let f: number | null = held;
    let minSeen = held;
    let frames = 0;
    while (f !== null && frames < 60) {
      serverFacing = Math.min(held, serverFacing + TURN_SPEED * FRAME_60);
      f = stepKeyboardTurnFacing(st, args({ serverFacing }));
      if (f !== null) minSeen = Math.min(minSeen, f);
      frames++;
    }
    expect(minSeen).toBeGreaterThanOrEqual(held - 1e-9); // no backward motion at all
    expect(frames).toBeLessThan(30); // handed off as soon as the server caught up
    expect(st.facing).toBeNull();
  });

  it('holds through a server-mirror excursion instead of riding it out and back', () => {
    // Robustness: if the mirrored facing transiently swings past the held
    // heading (a stray in-flight input, a snapshot burst), the display must
    // hold still through the whole excursion, not ride it out and back.
    const st = newKeyboardTurnState();
    for (let i = 0; i < 20; i++) {
      stepKeyboardTurnFacing(st, args({ turnLeft: true, serverFacing: 0 }));
    }
    const held = st.facing as number;
    // overshoot beyond eps, linger, then settle back to the latched heading
    const excursion = [0.08, 0.12, 0.12, 0.08, 0.0];
    for (const off of excursion.slice(0, 4)) {
      const f = stepKeyboardTurnFacing(st, args({ serverFacing: held + off }));
      expect(f).toBeCloseTo(held, 9); // held perfectly still, no ride-along
    }
    const f = stepKeyboardTurnFacing(st, args({ serverFacing: held }));
    expect(f).toBeCloseTo(held, 6); // bridged onto the settled server facing
    expect(st.facing).toBeNull(); // handed off at eps-arrival
  });

  it('holds a persistent residual through the grace window, then glides it out gently', () => {
    const st = newKeyboardTurnState();
    for (let i = 0; i < 30; i++) {
      stepKeyboardTurnFacing(st, args({ turnLeft: true, serverFacing: 0 }));
    }
    const held = st.facing as number;
    // the server never catches up (stun landed mid-turn): facing stays behind
    const serverFacing = held - 0.15;
    // during the grace window the display holds perfectly still
    for (let i = 0; i < 18; i++) {
      // 300ms < grace
      expect(stepKeyboardTurnFacing(st, args({ serverFacing }))).toBeCloseTo(held, 9);
    }
    // past the grace window it glides back, far slower than TURN_SPEED
    let prev = held;
    let f: number | null = held;
    let frames = 0;
    while (f !== null && frames < 600) {
      f = stepKeyboardTurnFacing(st, args({ serverFacing }));
      if (f !== null) {
        const step = Math.abs(f - prev);
        expect(step).toBeLessThan((TURN_SPEED / 2) * FRAME_60); // gentle, not a snap
        prev = f;
      }
      frames++;
    }
    expect(st.facing).toBeNull(); // eventually converged and handed off
  });

  it('seams the last wire-rounding fraction instead of stepping it in one frame', () => {
    const st = newKeyboardTurnState();
    for (let i = 0; i < 20; i++) {
      stepKeyboardTurnFacing(st, args({ turnLeft: true, serverFacing: 0 }));
    }
    const held = st.facing as number;
    // the mirror settles a wire-rounding away from the held heading (round2)
    const mirror = held - 0.015;
    let prev = held;
    let f: number | null = held;
    let frames = 0;
    while (f !== null && frames < 120) {
      f = stepKeyboardTurnFacing(st, args({ serverFacing: mirror }));
      if (f !== null) {
        // never more than one seam step per frame (~0.33deg at 60fps)
        expect(Math.abs(f - prev)).toBeLessThanOrEqual(0.35 * (1 / 60) + 1e-9);
        prev = f;
      }
      frames++;
    }
    expect(st.facing).toBeNull(); // converged and handed off
    expect(frames).toBeGreaterThan(2); // spread over frames, not a single jump
    expect(frames).toBeLessThan(40); // but still well under a second
  });

  it('holds instead of integrating while turning is not allowed (stun family)', () => {
    const st = newKeyboardTurnState();
    stepKeyboardTurnFacing(st, args({ turnLeft: true, serverFacing: 0 }));
    const engaged = st.facing as number;
    const f = stepKeyboardTurnFacing(
      st,
      args({ turnLeft: true, turnAllowed: false, serverFacing: 0 }),
    );
    // no further integration, and no immediate rewind either (grace window)
    expect(f).toBeCloseTo(engaged, 9);
  });

  it('credits held time through a hitch up to the main-loop frame clamp', () => {
    const st = newKeyboardTurnState();
    // a 200ms hitch frame: the full held duration is credited (the heading is
    // authoritative input; dropping time would slow low-fps hardware's turns)
    const f = stepKeyboardTurnFacing(st, args({ turnLeft: true, serverFacing: 0, frameDt: 0.2 }));
    expect(f).toBeCloseTo(TURN_SPEED * 0.2, 6);
    // but a pathological delta is still capped at the 0.25s main-loop clamp
    const g = stepKeyboardTurnFacing(st, args({ turnLeft: true, serverFacing: 0, frameDt: 9 }));
    expect(Math.abs((g as number) - (f as number))).toBeLessThanOrEqual(TURN_SPEED * 0.25 + 1e-9);
  });

  it('both keys held stays engaged with net-zero rotation', () => {
    const st = newKeyboardTurnState();
    const f = stepKeyboardTurnFacing(
      st,
      args({ turnLeft: true, turnRight: true, serverFacing: 0.8 }),
    );
    expect(f).toBeCloseTo(0.8, 6);
    expect(st.facing).not.toBeNull();
  });

  it('puts only input-derived headings on the wire, never corrections', () => {
    const st = newKeyboardTurnState();
    stepKeyboardTurnFacing(st, args({ turnLeft: true, serverFacing: 0 }));
    expect(st.wireFacing).toBeCloseTo(st.facing as number, 12); // turning: streamed
    // release with the mirror far behind: the pure hold streams the constant heading
    stepKeyboardTurnFacing(st, args({ serverFacing: -1 }));
    expect(st.wireFacing).toBeCloseTo(st.facing as number, 12);
    // seam band: mirror-derived correction motion, the wire goes silent
    const held = st.facing as number;
    stepKeyboardTurnFacing(st, args({ serverFacing: held - 0.015 }));
    expect(st.wireFacing).toBeNull();
  });

  it('cannot resonate through the server: converges against its own delayed echo', () => {
    // Reproduces the netem self-spin setup: the server applies whatever the
    // client streams, one RTT later, and the mirror feeds back as serverFacing.
    // With corrections kept OFF the wire the loop is open and must converge.
    const st = newKeyboardTurnState();
    for (let i = 0; i < 30; i++) {
      stepKeyboardTurnFacing(st, args({ turnLeft: true, serverFacing: 0 }));
    }
    const echoFrames = 17; // ~280ms at 60fps
    const wireLog: (number | null)[] = [];
    let lastApplied = (st.facing as number) - 0.6; // mirror far behind at release
    let f: number | null = st.facing;
    let prev = st.facing as number;
    let totalTravel = 0;
    for (let i = 0; i < 60 * 5 && f !== null; i++) {
      wireLog.push(st.wireFacing);
      const arrived = i >= echoFrames ? wireLog[i - echoFrames] : null;
      if (arrived !== null) lastApplied = arrived;
      f = stepKeyboardTurnFacing(st, args({ serverFacing: lastApplied, echoMs: 280 }));
      if (f !== null) {
        totalTravel += Math.abs(f - prev);
        prev = f;
      }
    }
    expect(st.facing).toBeNull(); // handed off, not spinning forever
    expect(totalTravel).toBeLessThan(Math.PI); // bounded settle, no full circles
  });

  it('scales the release grace with the measured echo', () => {
    const st = newKeyboardTurnState();
    for (let i = 0; i < 30; i++) {
      stepKeyboardTurnFacing(st, args({ turnLeft: true, serverFacing: 0 }));
    }
    const held = st.facing as number;
    const serverFacing = held - 0.3; // mirror never catches up
    // echo 400ms -> grace 720ms; at ~500ms the heading must still be held
    for (let i = 0; i < 30; i++) {
      stepKeyboardTurnFacing(st, args({ serverFacing, echoMs: 400 }));
    }
    expect(st.facing).toBeCloseTo(held, 9);
  });

  it('returns null and stays inactive when idle', () => {
    const st = newKeyboardTurnState();
    expect(stepKeyboardTurnFacing(st, args({ serverFacing: 1.0 }))).toBeNull();
    expect(st.facing).toBeNull();
  });

  it('wraps across +/-PI while integrating', () => {
    const st = newKeyboardTurnState();
    const f = stepKeyboardTurnFacing(
      st,
      args({ turnLeft: true, serverFacing: Math.PI - 0.01 }),
    ) as number;
    expect(f).toBeLessThan(Math.PI + 1e-9);
    expect(Math.abs(f)).toBeLessThanOrEqual(Math.PI);
  });
});

describe('suppressTurnFlags (wire turn-flag gating)', () => {
  it('lets the real flags through on the engage-edge frame only', () => {
    const st = newKeyboardTurnState();
    stepKeyboardTurnFacing(st, args({ turnLeft: true }));
    expect(st.suppressTurnFlags).toBe(false); // the edge: server sees a manual turn
    stepKeyboardTurnFacing(st, args({ turnLeft: true }));
    expect(st.suppressTurnFlags).toBe(true); // every held frame after: zeroed
    stepKeyboardTurnFacing(st, args({ turnLeft: true }));
    expect(st.suppressTurnFlags).toBe(true);
  });

  it('re-fires the edge on a fresh key press after release', () => {
    const st = newKeyboardTurnState();
    stepKeyboardTurnFacing(st, args({ turnLeft: true }));
    stepKeyboardTurnFacing(st, args({ turnLeft: true }));
    // release: the held heading still owns the channel, flags stay zeroed
    stepKeyboardTurnFacing(st, args({}));
    expect(st.suppressTurnFlags).toBe(true);
    // re-press: a new manual turn the server must see (breaks /follow again)
    stepKeyboardTurnFacing(st, args({ turnRight: true }));
    expect(st.suppressTurnFlags).toBe(false);
  });

  it('does not suppress while inactive or while a foreign path streams', () => {
    const st = newKeyboardTurnState();
    stepKeyboardTurnFacing(st, args({}));
    expect(st.suppressTurnFlags).toBe(false); // idle: flags are false anyway
    stepKeyboardTurnFacing(st, args({ turnLeft: true, sentFacing: 1.2 }));
    expect(st.suppressTurnFlags).toBe(false); // mouselook owns; module yields
  });

  it('KNOWN LIMIT: a continuous hold produces exactly one edge frame', () => {
    // The edge is a transition, so a /follow issued while the keys are already
    // held is never broken by a turn flag until the key is re-pressed (the
    // client cannot see follow state; followTargetId is not mirrored). This
    // pin exists so a future fix flips it deliberately, not by accident.
    const st = newKeyboardTurnState();
    let passthroughFrames = 0;
    for (let i = 0; i < 120; i++) {
      stepKeyboardTurnFacing(st, args({ turnLeft: true }));
      if (!st.suppressTurnFlags) passthroughFrames++;
    }
    expect(passthroughFrames).toBe(1);
  });
});
