# Movement reconciliation (Option 3): per-tick input frames + client replay

Status: in development on `feature/movement-rework`. This document is the design
authority for the movement rework; `docs/online-movement-latency.md` describes the
history and the option analysis that selected this model. The acceptance bar is
`MOVEMENT_FEEL_TARGETS` (legitimate play) plus `MOVEMENT_FEEL_TARGETS_CC` (cells
where the server legitimately overrides the client) in
`tests/helpers/movement_metrics.ts`, enforced by
`tests/movement_latency_baseline.test.ts` (strict mode).

## Goal and non-goals

Goal: the local player's drawn movement is instant and correction-free for
legitimate play at any RTT the link sustains (certified through 400 ms RTT with
jitter), while the server remains fully authoritative over position. Corrections
exist only when the server genuinely overrides the client (crowd control, forced
movement, speed changes), and those are signaled explicitly and smoothed.

Non-goals: client-authoritative position (rejected in
`docs/online-movement-latency.md`); raising the 20 Hz tick; changing `IWorld`
reads (targeting, click-to-move, quest triggers keep reading the authoritative
mirror in v1 of this rework).

## Why the old model could not be fixed in place

The pre-rework client sent level-triggered held booleans on a timer, the server
overwrote one live `MoveInput` struct per player on arrival, and the sim sampled
whatever was in that struct at its own 20 Hz phase. Client and server therefore
integrated DIFFERENT intent timelines whenever intent changed between server
ticks, and the display-only extrapolator had to be leashed and servo-corrected
against the interpolated mirror to hide the divergence. The baseline suite
measures the consequences (speed wobble at every run start even at RTT 0, path
deviation on every curved steer, snap-backs under stalls). No amount of tuning
removes a divergence whose cause is that the two hosts never agreed on the
input sequence.

## The model

One principle: **client and server run the identical movement kernel over the
identical per-tick input sequence.** The kernel (`src/sim/player_motion.ts`,
`stepPlayerMotion`) is already shared and pinned bit-exact across hosts by
`tests/player_motion.test.ts`; the rework makes the INPUT sequence identical
too, which makes prediction exact rather than approximate.

### Client input ticks

The client runs a fixed 20 Hz input tick (an accumulator on the render loop,
the same discipline `SelfMotionPredictor` already uses). Each client tick k:

- samples the resolved `MoveInput` and wire facing at that instant;
- records frame k in the local input history ring;
- advances the local prediction by stepping the kernel once with frame k;
- sends frame k on the wire immediately.

### Wire protocol (movement v2)

Client to server, per input tick: the existing `t:'input'` message extended
with `ct` (the client tick index, monotone from join). The `seq` field remains
for telemetry. Intent between frames is undefined; the server never
extrapolates intent beyond holding the last consumed frame during starvation.

Server to client, in the self record of the ordinary snapshot: `ackCt` (the
highest client tick CONSUMED by the sim tick this snapshot reflects, stamped at
consumption, not receipt) and an `override` epoch counter (below). Version
negotiation rides join metadata like `timerWireVersion`; the legacy v1 arm
stays accepted so mid-deploy sessions degrade instead of breaking.

### Server consumption: the input timeline

Per session, a jitter buffer keyed by `ct` replaces the overwrite-latest
struct. Each server tick consumes EXACTLY ONE frame, the next `ct` in sequence:

- Frames are buffered on arrival, with exactly one consumed per server tick.
  The depth cap is 6 frames with drop-oldest overflow. Starvation extrapolates
  for up to 2 ticks before resynchronizing; a target-depth jitter window remains
  a possible future refinement.
- Starvation (next frame missing): extrapolate with debt. The tick consumes a
  SYNTHESIZED frame equal to the last consumed input, advancing both the cursor
  and the ack, so total travel stays one tick of movement per client tick; the
  real frame for an extrapolated tick is discarded on arrival. Without the debt,
  a starved tick re-applies the held input while the cursor waits, minting free
  distance from lag. If the late frame differed (a release during the starve),
  the client absorbs the one-tick divergence as a bounded replay correction.
  Extrapolation runs for at most the resync threshold, and the stale-input rule
  stays the runaway bound.
- Empty-buffer anchoring is load-bearing recovery behavior. Once starvation
  reaches the resync threshold with no buffered frames, the next valid frame
  is the anchor whatever its `ct`; the ordinary depth window does not reject
  it. An anchor ahead of the cursor moves the cursor and counts a resync. An
  anchor at the cursor buffers normally without counting a resync.
- The anchor rule retains an absolute sanity bound of 1,200 ticks ahead of the
  cursor. That is 60 seconds at 20 Hz, above the 30-second keepalive window, so
  a real gap that large reaches session resume rather than timeline recovery.
- Overflow (client burst or clock skew): consume forward, dropping the oldest
  frames past the depth cap, and count it.
- The anti-cheat posture is unchanged: the server accepts only intent and
  facing, never position or velocity; displacement is still computed
  server-side through the kernel and swept collision.

### Client reconciliation

The client keeps a ring of `{ct, input, predictedPose}` for unacked ticks. On
each snapshot:

- Read `ackCt`. Compare the snapshot's authoritative self pose against the
  stored `predictedPose[ackCt]`.
- Match (within a tight epsilon): discard history through `ackCt`. No
  correction of any kind. This is the steady state for legitimate play: both
  hosts ran the same kernel over the same frames, so the comparison is exact.
- Mismatch: adopt the authoritative pose at `ackCt`, replay the stored inputs
  for every tick after `ackCt` through the kernel, and carry the residual
  (old drawn pose minus replayed pose) as a display offset decayed over a
  short window. Replay cost is bounded by RTT (about 7 ticks at 400 ms) and
  the kernel is cheap.

The drawn pose is the predicted pose plus the decaying residual. The leash,
the divergence servo, and the measure-window machinery in
`src/render/self_motion.ts` are deleted for the predicted path; the fallback
interpolation remains for states where prediction is off (spectate, delves,
climbing, CC, and the `?nopredict` kill switch).

A stronger future refinement is to retain input history across prediction
suspension and resume by replaying unacknowledged frames from the authoritative
`ackCt`. The current resume anchors open-loop at the last snapshot pose and
absorbs the resulting catch-up glide in the display residual.

### Server overrides (the only legitimate corrections)

Any server-side effect that changes the player's motion outside their own
intent increments the session's `override` epoch: crowd control (stun, root,
fear), charge, follow, forced teleports, knockbacks, and speed-multiplier
changes (mount, snare, sprint, ghost). The self record carries the epoch and
the active override class. The client:

- suspends prediction on seeing a new epoch, adopts the authoritative pose
  (smoothed by the existing fallback rules), and drops its input history;
- resumes prediction from the first snapshot whose epoch is stable and whose
  `ackCt` acknowledges a frame sent after resumption.

Speed-multiplier changes need no suspension once mirrored: the client's kernel
deps read the same multiplier the server applies, and the mirror carries it;
the epoch covers the one-echo window where they disagree.

### Client input clock

The sampler runs on an absolute tick deadline, never a summed frame-dt
accumulator (float residue at 60 Hz emits every tick one render frame late and
lets the phase wander). Its phase relative to the server tick is set by when
negotiation completes and is deliberately NOT servo-locked to the server
cadence: the display is phase-independent by construction (prediction plus
sub-tick interpolation on the sampler's own clock), so a phase lock would only
reduce the time frames wait in the server timeline. That delay is observable as
the harness's inputToAuthorityMs metric; a phase lock is a deferred refinement
to be justified by that number, not assumed.

## Rollout inside the rework PR

Phase 2 lands the protocol and the server timeline behind negotiation, with
the old display path untouched (feel unchanged, wire ready). Phase 3 lands the
client prediction ring, reconciliation, and the override epochs; v2 sessions
route around the legacy servo/leash machinery, which remains intact for v1
sessions, gated states, and the kill switch, and is deleted only when v1 is
retired. Phase 4 makes strict targets the default in
`tests/movement_latency_baseline.test.ts` (all 40 cells green as of the flip),
re-pins the baseline table to the measured numbers, and updates
`docs/online-movement-latency.md` and `src/net/CLAUDE.md` to describe this
model as the sanctioned prediction.

## How this is verified

- `tests/movement_latency_baseline.test.ts`: the deterministic harness
  (real `GameServer`, real `ClientWorld`, TCP-semantics latency link, virtual
  clock) with ground truth from the wire-intent timeline. Strict mode is the
  merge bar after Phase 4.
- `tests/player_motion.test.ts`: kernel parity stays bit-exact.
- Protocol units: the jitter buffer's consume/starve/overflow rules and the
  reconciliation ring get their own paired test files.
