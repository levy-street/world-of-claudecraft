# Online Movement Latency: Problem, Options, and the "Never Predict" Question

Date: 2026-07-05

This report explains why moving your own character feels slower online than offline,
surveys the possible remedies in broad strokes, and frames the policy decision the team
has to make around the `src/net/` "never predict" rule before any of the remedies can be
built. It is a problem statement and an options survey, not a PRD; whichever direction is
chosen should get its own spec under `docs/prd/`.

File references were verified against the tree on the date above; per `docs/CLAUDE.md`,
trust the intent and re-find exact lines if they have drifted.

## Implementation note (what actually shipped)

Options 1 and 2 below, the movement-kernel extraction, and the rule amendment
shipped on the branch that carries this report; the "current state" the survey
describes is the tree BEFORE that branch. Play-testing (including under
simulated 140 to 280 ms RTT) drove several deviations from the survey, recorded
here so the survey is not read as the as-built spec:

- **Keyboard facing became INPUT, not display anticipation.** Option 1's
  "display-only local facing, blended back to the server value" cannot be
  reconciled invisibly at release (server tick quantization leaves a
  few-degree late re-aim, and any correction that feeds the wire resonates at
  high RTT). The shipped design (`src/game/keyboard_turn_facing.ts`) integrates
  the turn locally and STREAMS the heading on the client-authoritative facing
  channel mouselook has always owned, with the turn flags zeroed on the wire
  (engage-edge excepted for /follow and anti-AFK). Only input-derived headings
  ever go on the wire.
- **The position extrapolator's corrector is a delay-aligned servo**, not the
  simple blend the survey sketched: the authoritative pose is compared against
  the display's own pose one measured echo ago (history ring), with the gain
  bounded by the delay so the loop cannot ring, and the leash clamping the pose
  only. See the header of `src/render/self_motion.ts`.
- **The extrapolation cap landed at 350 ms**, not the surveyed 150 to 200:
  below the real RTT the display rides the leash and steering feels gluey.
- **The rule amendment has three parts**, not two (`src/net/CLAUDE.md`):
  outcome prediction still banned; display-layer pose extrapolation sanctioned
  under four constraints (applies to `src/render/self_motion.ts`); the heading
  reclassified as client-authoritative input, to which the "never sent"
  constraint deliberately does not apply.
- Also shipped: the adaptive render lead (`src/game/self_alpha_lead.ts`), the
  shared kernel (`src/sim/player_motion.ts`, bit-for-bit parity-tested), and
  hysteresis fixes for pre-existing animation flicker the smoother display made
  visible (`src/render/locomotion.ts`). Step 4 of the recommendation
  (re-measure before considering full reconciliation) still stands.

## Executive Read

Offline, a movement key produces visible motion in roughly 30 to 50 ms (one local sim
tick plus render interpolation). Online, the same key press takes roughly RTT + 45 to
75 ms, because the client sends only movement intent and then waits for the server's
authoritative snapshot before the avatar moves at all. With a 50 ms ping that is about
100 to 120 ms of input-to-motion delay; with 100 ms ping, 150 to 170 ms. This gap is
structural: no amount of tuning removes the network round trip from the loop as long as
the client refuses to move the avatar locally.

The standard industry answer is client-side prediction. This repo is unusually well
positioned for it, because the deterministic sim already runs in the browser (that is
what offline mode is), and the input protocol already carries sequence numbers and acks.
But full prediction with reconciliation is a large project with a notorious bug surface,
and a bounded, visual-only middle option exists that captures most of the perceived gain
for a fraction of the cost. The blocker for all of these is a deliberate policy question:
`src/net/CLAUDE.md` currently forbids prediction outright, and that rule protects real
invariants (server authority, sim purity, anti-cheat). The rule needs to be refined, not
just deleted.

## The Problem, Quantified

The online pipeline for the local player is a full round trip with no local anticipation:

1. **Input capture and send.** `Input.readMoveInput()` is polled per frame; the online
   client sends `{t:'input', seq, mi, facing?}` within 16 ms of any change and at 20 Hz
   otherwise (`src/net/online.ts`, `sendInput`). Cost: 0 to 16 ms.
2. **Uplink.** Half the RTT.
3. **Server queueing.** The intent is not applied on receipt. It is copied onto the
   session's held `moveInput` state and consumed by the next `sim.tick()`
   (`server/game.ts`, the `msg.t === 'input'` arm of `dispatchMessage`). The server runs
   a fixed-step 20 Hz loop, so this adds 0 to 50 ms, 25 ms on average. (Facing alone is
   applied immediately, outside the tick.)
4. **Snapshot.** `broadcastSnapshots()` runs after the tick, once per 50 ms timer fire.
   The player's own pose travels in the `self` record with position, facing, and the
   input `ack`.
5. **Downlink.** The other half of the RTT.
6. **Render interpolation.** The client interpolates the avatar from the previous server
   pose toward the new one over roughly one snapshot interval (~50 ms). A fixed
   "alpha lead" of 0.65 of an interval (`ONLINE_SELF_RENDER_ALPHA_LEAD`, `src/main.ts`)
   plus exponential smoothing (`updateSelfRenderPosition`, `src/render/renderer.ts`)
   claws back part of that, leaving roughly 20 to 30 ms of residual display delay.

Total: **RTT + ~45 to 75 ms** from key press to visible motion. Offline replaces steps
2 through 5 with a local `offlineSim.tick()`, which is why the two modes feel so
different even at low ping.

This is consistent with, and partly explains, the community feedback already recorded in
`docs/performance-feel-audit.md` ("online rotation being worse than offline", "instant
forward/back/strafe response"). That audit's P1 section also flagged the snapshot-cadence
feel issues and asked for a simulated-latency test harness, which none of the options
below can safely ship without.

## What the Codebase Already Has Going For It

These assets make the options below much cheaper here than in a typical engine:

- **The movement code is pure and already runs in the browser.**
  `updatePlayerMovement` (`src/sim/sim.ts`) depends only on deterministic, host-agnostic
  modules: terrain (`src/sim/world.ts`), collision (`src/sim/colliders.ts`), tuning
  constants (`src/sim/types.ts`). It is literally the code that animates offline mode.
  Most games must port server movement logic to the client; here it is a code-reuse
  problem, not a porting problem.
- **Sequence numbers and acks already exist.** Every input frame carries `seq`; the
  server folds it into `session.lastInputSeq` and echoes it back as `snap.self.ack`
  (`server/game.ts`). The client already converts acks into a round-trip latency EMA
  (`onlineInputEchoMs`, `src/main.ts`) used for click-to-move stop padding and the perf
  overlay. This is half the plumbing of a reconciliation system, today used only as
  telemetry.
- **Snapshots carry the server tick number**, giving a time anchor for any replay
  scheme.
- **A visual smoothing layer for the self avatar already exists** (alpha lead plus
  exponential smoothing in the renderer), so there is an established, tested place for
  display-only position adjustments that never touch game state.

## Options

Ordered by cost and risk. They are not mutually exclusive; 1 and 2 are natural
predecessors of 3.

### Option 1: Feel wins without prediction (days, near-zero risk)

- **Instant local facing.** The server already applies facing outside the tick, but the
  avatar still waits a round trip to visibly turn. Rotating the local model immediately
  (display-only, blended toward the server value) is safe: turning in place has no
  contestable gameplay outcome, and rotation lag is the single most cited feel complaint.
- **Adaptive alpha lead.** `ONLINE_SELF_RENDER_ALPHA_LEAD` is a fixed 0.65; driving it
  from the measured `onlineInputEchoMs` recovers 10 to 20 ms on typical connections.

Expected gain: roughly 20 to 40 ms of perceived delay, plus the rotation complaint.
Insufficient alone, because the RTT stays in the loop for translation.

### Option 2: Bounded intent-driven extrapolation (recommended next step)

While the player holds a movement intent, the client moves the avatar **visually** in the
intended direction at the correct speed (`RUN_SPEED * moveSpeedMult`), reusing the pure
sim movement math (terrain slope, static collision), with the extrapolation capped at
approximately the measured echo latency (hard cap on the order of 150 to 200 ms), and
continuously blended toward the authoritative server pose as snapshots arrive.

- Start, stop, and direction changes feel instant, which is where latency is most
  perceptible in a tab-target MMO. Long-run accuracy is unaffected because the server
  pose remains the blend target.
- No rollback, no input history, no protocol change. It is a display layer living where
  the self smoothing already lives. Server authority and anti-cheat are untouched.
- Mispredictions (a stun or root landing mid-press, collision with a moving entity)
  self-correct because the blend target is always the server pose, and the error is
  bounded by the cap. The visible artifact is a short corrective glide, not a teleport.
- Requires extracting the movement core out of `sim.ts` into a standalone host-agnostic
  module so the client can run just movement math. That extraction is aligned with the
  ongoing `SimContext` campaign and is reusable by Option 3, so it is not throwaway work.
- Must run static collision locally so the avatar does not visibly walk through walls
  during the extrapolated window.

Cost: a medium feature. Fully unit-testable in Vitest (pure math plus a blend policy).

### Option 3: Full client-side prediction with server reconciliation

The canonical solution: the client simulates its own movement ahead of the server, keeps
a history of its inputs per tick, and on each snapshot rewinds to the acked server pose,
replays the unacknowledged ticks, and smooths any correction.

What it specifically implies in this codebase:

- **The input model is not directly replayable today.** Inputs are level-triggered held
  booleans that the server consumes continuously, not discrete per-tick frames. Replay
  needs "what was my intent at tick N" and a firm mapping from input seq to the server
  tick that consumed it. The current `ack` is stamped at message receipt, not at tick
  consumption, so its semantics would need hardening.
- **The movement extraction from Option 2 is a prerequisite** (same module, so the work
  compounds).
- **Divergence sources need individual handling:** speed buffs arriving by snapshot,
  roots and stuns, the charge/follow/fear locomotion short-circuits, and collision
  against entities whose client-side positions are interpolated approximations. Every
  unsmoothed divergence is visible rubber-banding.
- **A simulated-latency/jitter test harness is mandatory** (already a TODO in
  `docs/performance-feel-audit.md`), plus determinism and cross-host parity coverage.

Cost: a multi-week project with a well-known feel-bug surface. The marginal gain over
Option 2 is accuracy at high latency and uncapped long extrapolations, which matters far
more in a shooter than in a tab-target MMO. Recommended only if Option 2 proves
insufficient above roughly 100 ms ping.

### Rejected options

- **Raising the tick rate (20 to 30 or 60 Hz).** Breaks the fixed `DT = 1/20` invariant
  that anchors determinism across the three hosts, and would not remove the RTT anyway.
  Not negotiable.
- **Client-authoritative movement** (the client sends its position, the server sanity
  checks it). Simplest path to good feel and historically common in MMOs, but it
  abandons "the server is authoritative", reopens the movement anti-cheat and bot
  surface the project just invested in, and contradicts the architecture's core premise.
  Not recommended.

## The "Never Predict" Question

`src/net/CLAUDE.md` states: never mutate game state authoritatively in the client and
never "predict" an outcome; `performance.now` and the interpolation clocks are for render
interpolation only, not logic. Every option above except the rejected ones lives in
tension with the letter of this rule, and Option 3 contradicts it directly.

The rule exists for good reasons, and those reasons should survive any amendment:

1. **Server authority.** The client must never decide outcomes (combat, loot, position
   as the server records it). Nothing in Options 1 to 3 changes what the server
   simulates or persists; they change only what the local screen shows between
   authoritative updates.
2. **Sim purity and determinism.** `src/sim/` stays host-agnostic and seeded; client
   code re-running sim math must not fork it or introduce wall-clock dependence into it.
3. **A hard line against outcome prediction.** Predicting combat results, resource
   costs, loot, or hit outcomes client-side is a different and far more dangerous
   category than predicting locomotion, and should remain forbidden.

The proposed reframing, to be decided before implementation starts: replace the blanket
"never predict" with a two-part rule.

- **Display-layer anticipation of the local player's locomotion is permitted**, under
  explicit constraints: bounded by measured latency with a hard cap, always blending
  toward the authoritative server pose, never written back into `ClientWorld` mirrored
  state or any `IWorld` read that logic consumes (targeting, range checks, quest
  triggers, and interest logic keep using authoritative positions), and never affecting
  what is sent to the server.
- **Authoritative-state prediction remains forbidden.** No client-side anticipation of
  combat, casts, resources, loot, aggro, or any outcome the server resolves.

Option 3 would additionally require permitting a client-side movement re-simulation with
an input history, which is a second, separate relaxation; it should only be granted if
and when Option 2 is measured to be insufficient.

This is a maintainer decision. Until the rule is amended in `src/net/CLAUDE.md` (and the
constraint list written down there), none of the options should be implemented, because
the current wording makes any such PR a rule violation on its face.

## Recommendation

1. Amend the `src/net/CLAUDE.md` rule per the reframing above (display-layer locomotion
   anticipation allowed under constraints; outcome prediction still forbidden).
2. Ship Option 1 (instant local facing, adaptive alpha lead). Small, safe, addresses
   documented community feedback.
3. Ship Option 2 (bounded intent-driven extrapolation), extracting the movement core as
   a pure module on the way. Best perceived-gain-to-risk ratio, and its plumbing is a
   prerequisite for Option 3 anyway.
4. Re-measure with the input echo telemetry that already exists. Only if feel remains
   poor above roughly 100 ms ping, spec Option 3 as its own PRD, including the
   per-tick input timeline, ack semantics hardening, and the simulated-latency test
   harness.

Each step is independently useful if the effort stops there.
