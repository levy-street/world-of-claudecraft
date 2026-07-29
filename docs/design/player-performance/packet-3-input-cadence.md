# Packet 3: Input cadence contract

Program: Player Performance Overhaul (brainstorm.md revision 2; decisions resolved
2026-07-23; Decision 3 RESOLVED: full contract redesign, do not re-open). This packet
replaces the server inbound message rate contract so a healthy-FPS client turning and
casting can never be silently starved, while the flood defense gets stronger, observable,
and honestly tested. It ships WITH OR BEFORE Packets 1 and 2: the drop regime needs
healthy FPS, so restoring FPS activates the defect fleet-wide (brainstorm section 1:
steady-state drop at offered rate r against the 40/s refill is (r - 40) / r once the
60-token burst drains, roughly 3 s of continuous turning; zero below roughly 30 fps
(at exactly 30 the unconditional timer arm makes the drop share timer-phase
dependent), 33 percent at 60 fps, 50 percent at 80 msg/s).

Worktree: worktree wocc-input-cadence, branch feature/input-cadence
(off release/v0.30.0; LOCAL ONLY: never pushed and no PR without the maintainer's
explicit go).
Deliverable: a PR off the latest release branch (when the maintainer okays it),
gate-green, following the PR template, with the soak artifacts and the Close-out
record under this directory (the per-phase QA files were consolidated into that
record at packet close, at the maintainer's instruction; full text in git history).
Cadence followed: each phase landed with its phase-NN-qa.md before the next began;
targeted vitest plus tsc while iterating; full npm run gate plus /qa at packet close.

Scope sources: brainstorm.md section 7 Packet 3 (all six bullets plus the consequence
ledger, including the final bullet's exclusion of client-side send coalescing),
section 9 Decision 3, section 1's input-drop math, and the section 4.4 limiter
findings. Anchors cite paths and exported symbols per the docs anchor rule.

---

## Packet rulings (scout open questions, decided here)

R1. Base and sequencing against the Packet 0 merge. At authoring time (2026-07-24)
    packet 0 (feature/perf-instruments, tip cf3412e66) is NOT merged; its PR awaits the
    maintainer's go, and the latest release branch is still release/v0.30.0. This packet
    therefore bases on origin/release/v0.30.0 directly and copies brainstorm.md
    (revision 2) and progress.md from cf3412e66 into this worktree. Sequencing: phases
    01 to 05 have ZERO packet 0 dependency; the limiter redesign and its server-side
    observability ride seams already on the release base (the game-signals counter slot
    in server/http/game_signals.ts, the exporter registration in
    server/http/game_metrics.ts, and the bearer-gated /metrics endpoint). Packet 0
    never touches server/game.ts or server/http/, so no textual collision exists
    either. Only two arms touch packet 0: (a) the jitter-soak comparison base is packet
    0's committed jitter-soak-baseline.json, whose observer numbers are quoted in phase
    06 so this branch does not need the file; and (b) the OPTIONAL client-side
    surfacing of drop counts through the perf-report beacon (packet 0's
    net_pipeline_stats / rawSummary plumbing is branch-only) is DEFERRED until packet 0
    merges (R9). If packet 0 merges into the release branch mid-packet, merge the
    release branch into this branch (run the release-merge-audit skill); the docs under
    docs/design/player-performance/ then collide add/add with our copies: resolve by
    taking the merged branch's files and re-applying only this packet's progress.md row
    and this plan doc. The same union resolution applies in the other order if this
    packet merges first.
R2. Pre-parse ceiling size, from the measured client cadence (not the documented
    20 Hz). src/net/online.ts sends input from two paths sharing one sendInput: an
    unconditional 50 ms interval timer (20/s, no signature check, no gate; the idle
    baseline is 20 identical frames per second) and a changed-only rAF flush
    (flushInput) gated at 16 ms since the last send from either path. A held turn
    changes facing every frame (src/game/keyboard_turn_facing.ts integrates TURN_SPEED
    per frame and streams the heading; mouselook, mobile look drag, and
    gamepad-in-Mouse-Camera turns do the same through camYaw), so the rAF arm sends at
    30/60/60/48/60 per second at 30/60/120/144/240 Hz displays (whole-frame gate
    quantization). Naive sums with the timer give 50/80/80/68/80 msg/s, but every
    timer send also resets the shared gate clock and suppresses the next flush inside
    16 ms, so measured steady rates sit around 60 to 64/s with an analytic hard cap
    of about 82.5/s (1000 divided by 16, plus 20). Commands, chat, and telemetry ride
    the same socket on top. Ruling: MSG_RATE_REFILL_PER_SECOND 40 to 120 (roughly
    1.45x the 82.5/s input-stream hard cap,
    leaving standing headroom for command mashing plus chat plus telemetry on top of a
    maxed input stream), MSG_RATE_BURST 60 to 180 (preserving today's
    burst-equals-1.5-seconds-of-refill shape for the reconnect catch-up spike; session
    resume deliberately keeps the existing bucket state, which the faster refill makes
    benign). The bucket stays pure state plus functions with injected nowSec
    (server/msg_rate_limit.ts keeps its unit-testability contract).
R3. Pre-parse placement is load-bearing and immovable, and nothing ever queues. The
    frame-rate ceiling and the new byte budget both verdict BEFORE JSON.parse in
    GameServer.handleMessage (server/game.ts): that placement is the flood defense (a
    flooder burns token math, never parse CPU). Nothing in this packet moves any check
    below JSON.parse; the per-class lanes are deliberately POST-parse (R5) because
    classification requires the parsed type, and they sit inside the ceiling's
    already-bounded budget. Additionally: every verdict in this contract is
    allow-or-DROP, never defer. Queueing a message and releasing it later would shift
    its server receive time, and the bot detector's timing strategies (action_cadence's
    stddev ring and batch floor, the trade and vendor floor constants) are calibrated
    against receive-time Date.now() at socket entry; deferred delivery would either
    re-batch deltas or synthesize regular spacing (a metronome false positive).
R4. Per-window byte budget. Beside the per-frame ws maxPayload cap
    (WS_MAX_PAYLOAD_BYTES, 16 KiB, server/main.ts), add a per-connection byte bucket at
    the same pre-parse gate: MSG_BYTE_REFILL_PER_SECOND 64 KiB, MSG_BYTE_BURST 128 KiB,
    measured on raw.length (the UTF-16 code-unit proxy, same convention as packet 0's
    approxBytes). Legitimate steady traffic is about 10 KB/s worst case (input frames
    measure 74 to 106 bytes serialized, so 80/s costs about 8.5 KB/s, plus chat at the
    ladder's sustained third-of-a-message per second), giving the budget roughly 6x
    headroom. Honesty on parse exposure, both directions: the higher frame ceiling
    raises burst parse exposure (180 frames x 16 KiB) and lets garbage that used to die
    at the 40/s ceiling reach JSON.parse and the protocol-anomaly channel at up to
    120/s. That garbage is bounded three ways: parsed non-input frames draw
    command-lane tokens (R5), so a garbage stream above the lane rate lane-drops into
    the abuse window and kicks; the byte budget cuts the SUSTAINED worst case from
    today's theoretical 640 KiB/s (40/s x 16 KiB) to 64 KiB/s, so sustained flood
    parse exposure drops on net; and protocol_conformance still scores what it sees
    (ring-bounded, and its 'protocol' evidence kind is enforcement-eligible under the
    detector's own gate when ANTIBOT_ENFORCE is on, not report-only).
R5. Per-class post-parse lanes (the reserved-lane requirement), with detector-safe
    placement. Classification happens at the existing dispatch seam
    (GameServer.dispatchMessage, the msg.t / msg.cmd switch):
    - movement lane, t 'input': refill 90/s, burst 120. The lane check sits at the TOP
      of the input arm, before the sim moveInput assignment and before
      botDetector.observeInput: a dropped movement frame reaches neither sim nor
      detector. This direction is FP-safe by construction: input_absence counts input
      frames only toward its ACTIVE-time accounting (losing frames suppresses its
      flag, never triggers it), and no registered strategy consumes position or
      movement.
    - command lane, t 'cmd' except the exemptions below: refill 30/s, burst 60. OS
      key repeat is filtered client-side (the keydown handler in src/game/input.ts
      returns on e.repeat), so the worst legitimate command rate is human mashing
      across keybinds and action-button clicks, realistically under 20/s; 30/s refill
      with a 60 burst gives comfortable headroom (casts, targeting, loot, vendor,
      trade, and the debounced hotbar save all ride here). The lane check sits at the
      command switch AFTER botDetector.observeCommand (which already fires before the
      switch), so command-lane drops are observe-then-drop: the detector keeps seeing
      the traffic shape even when the handler never runs.
    - chat lane, cmd 'chat': refill 4/s, burst 8, a pre-guard only, and its check is
      CO-LOCATED with consumeChatToken, not at the chat case entry: the chat handler
      deliberately runs the moderation command router and the ignore/block/filter
      management commands BEFORE the mute check and the ladder (a GM-silenced player
      must still manage their lists, and a list readout must not burn a chat token),
      and the lane must not throttle what the ladder deliberately exempts. The
      in-handler ladder (consumeChatToken: burst 5, refill one third per second, the
      cooldown ladder and its player-facing strings) remains the authoritative chat
      throttle and messaging and is untouched; the lane only bounds what a chat flood
      can burn, and because the lane is more generous than the ladder, the ladder's
      error messaging still fires on the passed subset.
    - parsed frames of any OTHER shape (unknown t, non-object JSON, unknown cmd)
      also draw a command-lane token, after their protocol-anomaly observation:
      that bounds sub-ceiling garbage to the lane rate and makes anything above it
      score-visible. Lane drops take NO protocol-anomaly arm of their own
      (protocol_conformance's semantics are "not our client", not "server shed
      load").
    - EXEMPT, never lane-dropped: t 'logout' (a clean leave must always process),
      cmd 'telemetry', and cmd 'challengeResponse'. Precision about why, corrected
      against the code at this tip: the observe-then-drop placement already
      guarantees the detector sees every parsed telemetry beat (input_absence and
      telemetry_absence consume it via observeCommand, and the handler itself is a
      no-op break), and the challenge flow is dormant end to end today (no server
      code sends t 'challenge', the client marks it WIP, the handler verifies and
      discards, no strategy consumes it). The exemptions are therefore defense in
      depth and token accounting (beats and challenge replies never compete for
      command-lane tokens, and stay safe if the placements ever move), NOT a live
      false-positive fix: the historical 44-account beat-starvation class was a
      TRANSPORT drop at the pre-parse limiter, and it is the RAISED CEILING (R2)
      that removes it. All three exempt classes are cheap, client-bounded, and still
      inside the pre-parse ceiling and byte budget.
    Lane drops are visible through the R8 counters and feed the abuse window (R6).
    Properties, pinned by tests: the movement refill (90) exceeds the 82.5/s
    input-stream hard cap; the command lane is reserved capacity movement can never
    consume (casts structurally cannot be starved by turning, and vice versa);
    worst-case simultaneous legitimate load (about 82 input plus human-rate commands
    plus chat, telemetry, and the hotbar save) stays under the 120/s ceiling.
R6. Windowed abuse score replacing the dead consecutive counter, shaped to survive
    the stall-then-flush burst. The current MSG_RATE_VIOLATIONS_FOR_KICK ladder resets
    on ANY allowed frame; with continuous refill the longest drop run at a steady
    100/s is 2, so the 200-consecutive kick is unreachable below roughly 8,000 offered
    frames per second and any refill increase widens that: it is dead code and is
    DELETED (with its tunables pin). Design constraint that rules out a plain decaying
    score: a network stall shorter than the keepalive termination window
    (WS_KEEPALIVE_PING_MS, 30 s, so up to roughly two intervals) has the client
    buffering sends at up to 80/s and TCP delivering the whole backlog in one burst on
    recovery, thousands of frames processed in about a second of receive time; any
    score that integrates total drops would kick that legitimate client (the same
    stall-then-flush shape that caused the detector's documented 44-account
    false-positive incident, and a burst today's consecutive counter accidentally
    survives because refill interleaves allows). Replacement, pure with injected time:
    per-second drop accounting. Drops of every cause (frame-rate, byte, or lane) tally
    into the current one-second bucket; a second is ABUSIVE when its tally reaches
    MSG_ABUSE_SECOND_DROP_FLOOR (30, meaning offered rate at least 25 percent over the
    refill for a full second); the verdict is kick when MSG_ABUSE_KICK_SECONDS (5) of
    the last MSG_ABUSE_WINDOW_SECONDS (10) were abusive. Allowed frames never reset
    anything: only time slides the window. Shape: any sustained offered rate at or
    above about 150/s kicks once its burst allowance drains plus five abusive
    seconds (about 5 to 6 s at 500/s, about 8 s at 200/s, about 12 s at the 150/s
    boundary); a slightly
    over-limit buggy client (under the floor) throttles forever but stays visible
    through the drop counters; a stall-then-flush burst concentrates in one or two
    receive-time seconds, far under the five-second requirement, so it can never kick;
    every legitimate live stream holds zero abusive seconds (pinned by the phase 05
    matrix, which includes a stall-flush arm). The kick still tears the session down
    through the existing kickSession path, so the bot detector's
    releaseTrackingContext lifecycle is unchanged.
R7. Stale 20 Hz premise: update every copy deliberately. Three places pin the stale
    premise: the server/msg_rate_limit.ts header comment ("never throttles legitimate
    20 Hz movement input"), the tests/msg_rate_limit.test.ts premise test ("never
    throttles a sustained legitimate 20 Hz input stream"), and the constants pin in
    tests/server/tunables.test.ts (60/40/200). Phase 01 rewrites the header around the
    real cadence model (R2), replaces the premise test with the measured-cadence
    equivalent (an 80/s stream stays drop-free indefinitely; a 20 Hz arm stays as the
    trivial lower bound), and updates the tunables pin to the new constant set. All
    pins compare exported constants against literal expected values (operands that
    disagree on regression, never constant-self comparisons).
R8. Observability lands in the game-signals seam, and wsMessage('in') keeps its
    placement. Today gameMetricsCounters().wsMessage('in') counts BEFORE the verdict in
    handleMessage, and tests/game_state_metrics.test.ts pins that every inbound frame
    is counted at the top of handleMessage: its meaning is frames RECEIVED, that
    meaning is KEPT, and the existing pin stays green unedited. The loss becomes
    visible through NEW methods on the GameMetricsCounters interface
    (server/http/game_signals.ts): wsMessageDropped(cause) with cause one of 'rate' |
    'bytes' | 'lane_movement' | 'lane_command' | 'lane_chat', wsRateKick(), and
    wsInputSeqGap(missed). Exporter side (registerGameStateMetrics in
    server/http/game_metrics.ts, each inc wrapped in the seam's never-throw contract):
    woc_ws_messages_dropped_total{cause}, woc_ws_rate_kicks_total,
    woc_input_frames_missed_total, with every label series pre-registered at zero at
    boot so dashboards see the series before the first increment (prom counters cannot
    backfill a scrape). Cardinality stays bounded per the seam's contract comment: the
    cause label is a fixed five-value set, nothing per-player. Reach ruling: the
    bearer-gated /metrics endpoint (process-local, resets on restart, scraped into the
    operator's Prometheus which persists history) IS the fleet surface for this packet;
    no admin SPA work, no DB persistence, and no durable moderation record for flood
    kicks (kickSession records nothing durable for ANY kick today; changing that is
    out of scope).
R9. Gap-aware echo accounting, resolved into a server-side seq-gap counter. The input
    ack is high-water (session.lastInputSeq is a max, echoed as ack in the self
    snapshot; the client credits every seq up to the ack as echoed in
    src/net/online.ts), so echo telemetry structurally cannot see drops, and a
    pre-parse drop never even parses the seq. But the server CAN see gaps post-parse:
    the client seq is a per-send increment on an ordered TCP socket, so a parsed input
    frame with seq greater than lastInputSeq + 1 proves the missing seqs were sent and
    never processed. Framed honestly: on TCP this counter is not an independent
    blind-spot detector, it is the INPUT-FRAME-ATTRIBUTED share of the server's own
    drops (pre-parse and movement-lane drops of input frames, which the R8 drop
    counters also count in aggregate, plus rare client-side send races), and that
    attribution is exactly its value: it isolates how much of the loss hit the
    movement stream, which the cause-labeled totals cannot say. Phase 03 counts the
    gap into wsInputSeqGap, guarded: only when session.lastInputSeq is positive (the
    server zeroes it on session resume and the client restarts seq on reconnect), and
    capped per observation by MSG_SEQ_GAP_SANITY (1,000) so a reset-mismatch edge
    never books a giant gap. The CLIENT-side surfacing of drops (a beacon field
    riding packet 0's net-pipeline plumbing) is DEFERRED until packet 0 merges; the
    server counter plus /metrics is the fleet visibility this packet ships.
R10. Dedicated kick reason with matcher lockstep, enforced by byte pins (the S3
    scanner cannot see this class). Today the limiter kick reuses the literal pair
    kickSession(session, 'rejected by server', 'moderation action'): the client
    matcher (userFacingApiError in src/ui/api_error_i18n.ts) maps 'rejected by server'
    to t('loading.connectionRejected'), so a flood kick renders as the generic "The
    server closed the connection." full-screen fatal overlay and is indistinguishable
    from the anti-bot kick, which sends the SAME literal. Phase 04:
    - New server literal (working value: 'message rate exceeded', lowercase byte-exact
      wire-contract style per the server/ws_auth.ts table comments), exported as a
      named constant beside the limiter constants. The ANTI-BOT kick deliberately
      keeps 'rejected by server' (vagueness toward bots is a feature); its pinned
      frame test stays green unedited.
    - A dedicated normalized-literal arm in userFacingApiError mapping to a new
      loading.* key in src/ui/i18n.catalog/shell.ts with actionable copy (the player
      was disconnected for sending actions too quickly). Key home ruling: the game
      catalog, NOT a server_i18n DICT row (a DICT row demands every locale at once
      per the H3 completeness check; the catalog needs exactly the five non-Latin
      fills per M16, which runs unconditionally and any realistic sentence is wordy).
      The five fills (zh_CN, zh_TW, ja_JP, ko_KR, ru_RU), the i18n:gen regenerated
      artifacts, and the resolved-bundle re-baseline land in the SAME commit.
    - The new literal stays session-fatal (no auto-reconnect: an immediately
      reconnecting flooder re-floods) and must not collide with the transient
      rejection matchers (isTransientReconnectRejection / isTransientTimeoutRejection
      match English literals; asserted in the tests).
    - Enforcement: the S3 guard (tests/localization_fixes.test.ts) is structurally
      BLIND here (kickSession sends { t: 'error', error } and the scanner matches
      only the type/text emit shapes), so the lockstep is pinned byte-exact instead:
      a tests/main_api_error.test.ts arm (userFacingApiError of the literal equals
      the t() key), a game_sessions-style server test pinning the exact frame at the
      limiter kick site, and a source-scan guard in the localization_fixes R1/R2
      style binding the server literal to its matcher arm so a future reword cannot
      ship raw English silently. src/net/CLAUDE.md's byte-identical disconnect
      literals note gains the new literal.
    - The kickSession leaveReason parameter is dead code (leave discards it); pass a
      distinct 'message flood' label for grep-ability, a zero-behavior change.
    - Observed adjacent defect, OUT of scope, for a separate issue: the in-game
      moderation kick's clientError 'moderation action' has no matcher arm and
      renders raw English in the fatal overlay in every locale today.
R11. Bot-detector verdict: no contract change, both copies untouched, coupling is
    positive, and the lane rules above are what keep it that way. Verified against
    BOTH copies (the private overlay at private/bot_detector/ in the main tree and
    worktree wocc-bot-protection; src trees byte-identical at
    authoring; this worktree carries only server/bot_detector/contract.ts plus stub,
    and the #bot-detector build alias resolves to the stub here, which nothing in
    this packet needs): the detector consumes only ALLOWED, parsed traffic
    (observeInput / observeCommand / observeProtocolAnomaly / observeEvent /
    handleTick), never the limiter's verdicts or violation counts (the violations
    field is read only inside consumeMsgToken), and its own gate kick is internal
    scoring. Per-strategy findings: action_cadence flags NEAR-ZERO variance in
    inter-command receive-time deltas (today's random drops INJECT variance, so
    delivering casts makes the tell sharper); input_absence judges received-vs-
    expected apm beats at a 0.25 ratio floor over a 5-minute epoch, which even
    today's 33 percent drop regime cannot trip, and its 2026-07-05 redesign note
    documents the rate limiter dropping queued beats as a REAL historical
    false-positive source (44 accounts in one run), a transport-drop class the
    RAISED CEILING (R2) removes at the root (R5's telemetry exemption is the
    defense-in-depth layer on top); input_accountability counts only deliberate
    commands, and delivering previously-dropped casts moves its two sides together.
    The raised ceiling changes detector inputs ADDITIVELY (previously dropped frames,
    beats, and anomalies become observations; nothing consumes a drops-count as
    signal). Obligations this ruling leaves behind: phase 02 must land the lane
    placements exactly as R5 states them (input drops before observeInput, command
    drops after observeCommand, telemetry and challengeResponse exempt), and phase 06
    QA re-diffs the two copies and re-checks this verdict against the overlay tip of
    record in case the private repo moved during the packet.
R12. Module shape. The pre-parse arm evolves server/msg_rate_limit.ts IN PLACE (it is
    already the pure seam module for exactly this contract): one gate state carrying
    the frame bucket, byte bucket, and abuse score, one consume function taking
    (state, nowSec, approxBytes) and returning the verdict with drop-cause detail.
    The post-parse lanes land as a NEW pure sibling server/msg_lanes.ts (same purity
    contract, injected time). server/game.ts stays a thin consumer: handleMessage
    calls the gate, dispatchMessage consults the lane at its existing classification
    switch. No new coordinator methods beyond those call edits plus the kick arm.
R13. Cadence-model lockstep with the real client. The client's two cadence constants
    (the 50 ms timer interval and the 16 ms flush gate) are currently inline literals
    in src/net/online.ts. Phase 05 extracts them into a tiny pure module,
    src/net/input_send_cadence.ts (constants plus the gate predicate), consumed by
    online.ts with zero behavior change, so the test-side cadence model imports the
    REAL constants instead of copying magic numbers, and a future client cadence
    change breaks the matrix loudly instead of silently invalidating it. Client-side
    send coalescing itself stays OUT of scope per brainstorm section 7 Packet 3's
    final bullet and Decision 3
    (the facing-feel cluster in src/game/ is interlocking: keyboard_turn_facing's
    release handoff and echo-scaled grace, the mouselook release latch main.ts
    consumes unconditionally each frame, the engage-edge turn-flag exception, and the
    echo EMA all assume the heading reaches the wire every frame the gate allows, and
    self-feel is client-authoritative); revisit only if the phase 06 soak demands it.
R14. Test matrix definition (phase 05). The model drives synthetic send timelines
    through the full chain (gate, byte budget, lanes, score) with injected time, no
    fake timers: refresh rates 30/60/120/144/240 Hz, timer-phase offsets (0, 7, 13,
    29, 41 ms) against the rAF grid, and mixed traffic per rate (pure held turn; turn
    plus GCD casts at one per 1.5 s; turn plus a 2 s castSlot mash burst at 30/s,
    above any human rate and still inside the lane burst; chat lines at the ladder's
    legal cadence; one apm telemetry beat per 10 s; a
    challengeResponse mid-stream; a final logout). Assertions: ZERO drops on every
    legitimate stream, zero abusive seconds ever, the telemetry beats and the
    challengeResponse always processed, and the logout always processed. A
    stall-then-flush arm: a 15 s send backlog (about 1,200 frames) delivered inside
    one receive-time second drops heavily but NEVER kicks (at most two abusive
    seconds), and drops return to zero within a second of live traffic resuming.
    Flood arms: a 500/s frame flood kicks in 5 to 10 s; a 120/s stream of 1 KiB
    frames exhausts the byte budget and kicks on the same window; a 60/s cast flood
    drains only the command lane (movement unaffected: the reserved-lane property in
    reverse); a 300/s movement flood never drops a single cast (THE core pin of the
    packet), asserted over the window UP TO the abuse-window kick verdict, which the
    same arm pins as arriving (a sustained 300/s flood is abusive and does get
    kicked; the reserved-capacity property must hold for every frame before that).
    The telemetry and challengeResponse arms pin the EXEMPTION CONTRACT (the frames
    always process regardless of lane pressure), not a live detector coupling (R5).
    No parens in test titles (the vitest -t regex trap).

---

## Phase 01: pre-parse gate redesign (ceiling, bytes, abuse score)

Goal: the sized ceiling, the byte budget, and the decaying abuse score replace the
stale bucket and the dead kick ladder, entirely inside the pure module (R2, R4, R6,
R7, R12).

Diff shape:
- server/msg_rate_limit.ts rewritten in place, keeping the pure state-plus-functions
  contract: MSG_RATE_REFILL_PER_SECOND 120, MSG_RATE_BURST 180,
  MSG_BYTE_REFILL_PER_SECOND (64 KiB), MSG_BYTE_BURST (128 KiB),
  MSG_ABUSE_WINDOW_SECONDS 10, MSG_ABUSE_KICK_SECONDS 5,
  MSG_ABUSE_SECOND_DROP_FLOOR 30. MsgRateBucketState grows the byte bucket and the
  per-second abuse window (current-second tally plus the bounded abusive-seconds
  ring); createMsgRateBucket seeds them; consumeMsgToken becomes
  consumeInboundFrame(state, nowSec, approxBytes) returning the verdict with
  drop-cause detail ('rate' | 'bytes') for the phase 03 counters.
  MSG_RATE_VIOLATIONS_FOR_KICK and the violations field are deleted. The header
  comment is rewritten around the measured cadence model (R2): the 20 Hz premise is
  gone deliberately, and the comment cites the client symbols (flushInput, the 50 ms
  timer) it is sized against, plus the stall-then-flush constraint that shaped R6.
- server/game.ts (thin consumer edit): handleMessage passes raw.length; the kick arm
  keeps its current literal this phase (the dedicated reason is phase 04). Session
  resume continues to carry the existing bucket (R2).
Tests: tests/msg_rate_limit.test.ts rewritten with the module: the premise test
becomes "an 80/s mixed stream stays drop-free indefinitely" (a 20 Hz arm stays as the
trivial lower bound), plus burst-drain and refill arms at the new constants, byte-arm
pins (a 16 KiB frame spends 16384 byte tokens; byte exhaustion drops while frame
tokens remain), abuse-window arms (a second under the drop floor is never abusive,
five abusive seconds in the window kick and four do not, allowed frames never reset
the window, a single-second thousand-drop burst never kicks, the window forgets after
ten quiet seconds), and tunables pins against disagreeing literals. tests/server/tunables.test.ts: the
60/40/200 row is replaced with the new constant set (the 200-kick row is deleted with
its constant). Time is injected nowSec everywhere, as today.
Gotchas honored: the gate stays ABOVE JSON.parse (R3); the header, premise-test, and
tunables-pin rewrites are the deliberate stale-pin update (R7); do not attempt a live
repro at the current town framerate (the defect is inactive below about 30 fps; the
tests are the proof).
Acceptance: npx vitest run tests/msg_rate_limit.test.ts tests/server/tunables.test.ts
green; one local mutation check (set refill back to 40, confirm the new premise test
fails, revert); npx tsc --noEmit clean.
QA file: phase-01-qa.md (consolidated into the Close-out record at packet close; full text in git history).

## Phase 02: per-class lanes

Goal: casts, chat, and movement stop sharing one budget; the reserved-lane
requirement is met post-parse with detector-safe placement (R5, R11, R12).

Diff shape:
- NEW server/msg_lanes.ts (pure, injected time): the lane classification mirroring
  the dispatch switch (movement / command / chat / exempt, with 'logout',
  'telemetry', and 'challengeResponse' exempt, and every other parsed shape,
  including unknown t, non-object JSON, and unknown cmd, classified into the command
  lane), per-lane token state, and consumeLaneToken(state, lane, nowSec) returning
  allow or drop. Constants: movement 90/120, command 30/60, chat 4/8 (refill per
  second / burst).
- server/game.ts (thin consumer edit): dispatchMessage consults the lane exactly at
  the R5 placements: the movement check at the top of the 'input' arm (before the
  sim moveInput assignment and before observeInput), the command check at the
  command switch (after observeCommand, and after each protocol-anomaly observation
  for the unknown shapes), the chat check CO-LOCATED with consumeChatToken (the
  moderation command router and the ignore/block/filter management commands stay
  upstream and unthrottled, exactly as the ladder exempts them today). Session state
  gains the lane buckets beside msgRate. Lane drops return early; the phase 03
  counters attach here next phase.
- The chat ladder (consumeChatToken and its player-facing strings) is untouched.
Tests: NEW tests/msg_lanes.test.ts: classification pins for every message type
(including the three exemptions and the unknown-shapes-to-command-lane rule),
per-lane budget arithmetic, and the two reserved-lane properties (a saturated
movement stream never consumes a command token; a command flood never consumes a
movement token). Integration-style pins at the GameServer seam (existing server-test
patterns, fake detector sink): a 300/s movement flood plus interleaved casts reaches
the sim with every cast intact; a 30/s cast mash never drops a telemetry beat or a
challengeResponse (the exemption-contract pins per R14); a burst of ignore-list and
moderation chat commands is never lane-dropped even with the chat lane exhausted;
observeCommand still sees a command the lane then drops (observe-then-drop pinned);
a dropped movement frame reaches neither sim nor observeInput (drop-before-observe
pinned).
Gotchas honored: lanes are post-parse by design (R3 stays intact); drops never
queue (R3); the placements are exactly R5's (the detector-coupling obligations from
R11); no new protocol-anomaly kind for lane drops.
Acceptance: npx vitest run tests/msg_lanes.test.ts plus the integration pins green;
tsc clean.
QA file: phase-02-qa.md (consolidated into the Close-out record at packet close; full text in git history).

## Phase 03: observability (drop, kick, and seq-gap counters)

Goal: the loss becomes visible fleet-wide through the game-signals seam and /metrics;
the high-water blind spot gets its server-side gap counter (R8, R9).

Diff shape:
- server/http/game_signals.ts: GameMetricsCounters gains wsMessageDropped(cause),
  wsRateKick(), wsInputSeqGap(missed); noopGameMetricsCounters extended; the
  cardinality contract comment updated (cause is a fixed five-value set).
- server/http/game_metrics.ts: registerGameStateMetrics registers the three new
  counters (woc_ws_messages_dropped_total{cause}, woc_ws_rate_kicks_total,
  woc_input_frames_missed_total), each inc wrapped per the seam's never-throw
  contract, every cause series pre-registered at zero at boot.
- server/game.ts: handleMessage counts gate drops with their cause and counts the
  kick; dispatchMessage counts lane drops per lane; the 'input' arm computes the
  parsed-seq gap per R9's guards (positive lastInputSeq, MSG_SEQ_GAP_SANITY cap,
  the constant exported beside the limiter constants) and feeds wsInputSeqGap.
Tests: recording-fake sink pins (the game_signals test pattern): one per counter
proving emission at the right site with the right cause; a handleMessage-level pin
that a dropped frame emits 'rate' while wsMessage('in') still counted it (the
existing count-at-top pin in tests/game_state_metrics.test.ts stays green unedited,
which IS the R8 kept-meaning proof); seq-gap arithmetic pins including the
resume-reset guard and the sanity bound; an exporter test pinning the zero-init
series in the exposition (the game_metrics test pattern).
Gotchas honored: observability writes must never throw (the seam's stated contract);
label sets stay closed; wsMessage('in') placement untouched (R8).
Acceptance: targeted vitest (tests/game_state_metrics.test.ts,
tests/server/http/game_metrics.test.ts, the new pins) green; tsc clean; a local
server run scrapes /metrics and shows the three families present at zero.
QA file: phase-03-qa.md (consolidated into the Close-out record at packet close; full text in git history).

## Phase 04: dedicated kick reason with matcher lockstep

Goal: a flood kick stops masquerading as the generic server rejection, with the
lockstep byte-pinned end to end (R10).

Diff shape:
- server/msg_rate_limit.ts (or a sibling constant beside the limiter constants): the
  exported reason literal; server/game.ts: the limiter kick arm passes it, plus the
  'message flood' leaveReason label (dead parameter, grep-ability only). The
  anti-bot kick site is untouched.
- src/ui/api_error_i18n.ts: the dedicated normalized-literal arm returning the new
  t('loading.*') key.
- src/ui/i18n.catalog/shell.ts: the new loading key with actionable English copy;
  the five non-Latin overlay fills (M16) in the same change; npm run i18n:gen with
  the regenerated artifacts and the resolved-bundle re-baseline staged in the SAME
  commit (the freshness gate needs staged artifacts).
- src/net/CLAUDE.md: the byte-identical disconnect-literals note gains the new
  literal.
- tests/localization_fixes.test.ts: a source-scan guard in the R1/R2 style binding
  the server literal to its matcher arm.
Tests: tests/main_api_error.test.ts arm (userFacingApiError of the literal equals
the t() key, and the literal is NOT matched by the transient-rejection helpers); a
game_sessions-style server pin driving handleMessage to the kick verdict and
asserting the exact frame bytes at the limiter site; the existing anti-bot frame pin
stays green unedited.
Gotchas honored: server code stays language-agnostic (English literal plus client
matcher, the byte-exact wire-contract model of ws_auth); the moderation and anti-bot
reason strings are untouched; no rewording of any EXISTING English value (the
reword-staleness trap); M16 fills land with the key, artifacts staged same commit.
Acceptance: npx vitest run tests/localization_fixes.test.ts
tests/main_api_error.test.ts plus the new server pin green; npm run i18n:gen leaves
a clean tree; tsc clean.
QA file: phase-04-qa.md (consolidated into the Close-out record at packet close; full text in git history).

## Phase 05: the cadence-model test matrix

Goal: the contract is proven against the REAL client send scheme across the refresh
range, with client-constant lockstep (R13, R14).

Diff shape:
- NEW src/net/input_send_cadence.ts: the 50 ms timer interval and 16 ms flush gate as
  exported named constants plus the gate predicate; src/net/online.ts consumes them
  (zero behavior change, the extraction is the whole client diff).
- NEW tests/input_cadence_model.test.ts: a deterministic timeline generator modeling
  the timer plus gated-rAF send scheme from the real constants (including the
  timer-resets-the-gate interaction), driven through the full server chain per R14's
  matrix (rates, phase offsets, traffic mixes, exemption arms, flood arms), with
  injected time only.
Tests: the matrix itself, plus a lockstep pin that the model's constants ARE the
src/net/input_send_cadence.ts exports (so a client cadence change flips the matrix).
Gotchas honored: no fake timers, no real-loop polling (synthetic clocks only); no
parens in test titles; the client extraction must be behavior-neutral (the existing
online/net suites stay green unedited, which IS the neutrality proof).
Acceptance: npx vitest run tests/input_cadence_model.test.ts green; one local
mutation check (halve the movement lane refill, confirm the zero-drop arm fails,
revert); the untouched online/net suites green; tsc clean.
QA file: phase-05-qa.md (consolidated into the Close-out record at packet close; full text in git history).

## Phase 06: soak, detector re-check, and packet close-out

Goal: the contract holds under the standing load scenario, the detector verdict is
re-confirmed, and the packet closes gate-green (R1, R11).

Runbook:
1. Jitter soak: scripts/server_load_jitter.mjs at BOTS=80 IDLE=1 with JSON_OUT,
   compared against packet 0's committed baseline (jitter-soak-baseline.json at
   cf3412e66: observer p50 51.3, p95 56.9, p99 61.2, max 65.8 ms, zero gaps over
   100 ms, avg snapshot 10.7 KB). Acceptance: gap p95 within the baseline band and
   zero drop-counter increments for the bot fleet (/metrics scraped before and
   after).
2. A 120 Hz-class turn soak arm: drive one scripted client at the 80/s cadence for
   several minutes against a local server; assert the drop counters stay at zero and
   the seq-gap counter stays flat (the brainstorm section 10 field-verification
   criterion, run locally).
3. Bot-detector re-check (R11): re-diff the two detector copies, re-confirm no
   strategy consumes limiter state, and record the overlay tip in the QA file.
4. Full npm run gate; /qa fan-out with the named reviewers: privacy-security-review
   (flood posture and the kick path), test-coverage-auditor (the matrix and pins),
   frontend-seam-reviewer (the phase 04 matcher and catalog touches plus the phase
   05 online.ts extraction), plus the qa-checklist gate itself.
   architecture-reviewer is not triggered (src/sim/ untouched); no DB surface, so
   migration-safety and database-performance-reviewer are not needed.
5. progress.md: packet 3 row to PHASES COMPLETE with the QA file list; the
   consequence ledger goes into the PR body when the maintainer okays a PR.
6. Maintainer track (post-deploy, the brainstorm section 10 field criterion,
   commands documented beside the soak artifacts and left PENDING in the progress
   row at packet close): scrape woc_ws_messages_dropped_total and
   woc_input_frames_missed_total on production during a healthy-FPS session and
   confirm both stay flat at zero.
Acceptance: gate green end to end; every phase QA file present; soak artifacts
recorded beside this doc.
QA file: phase-06-qa.md, the packet-level adversarial pass (consolidated into the Close-out record at packet close; full text in git history).

---

## Close-out record (all six phases landed 2026-07-24; branch local, gate green)

The six per-phase QA files were consolidated into this section at the
maintainer's instruction at packet close; their full text lives in git history
(the branch through e5e87c1d6). What survives here is everything a future
reader needs that the code, tests, and soak artifacts do not already carry.

- Landed, in order: the pre-parse gate rewrite (frame ceiling 120/180, byte
  budget 64/128 KiB, the windowed abuse score replacing the dead consecutive
  kick ladder), the post-parse lanes (movement 90/120, command 30/60, chat
  4/8), the R8 counters plus the R9 seq-gap read, the dedicated kick reason
  with byte-pinned matcher lockstep, the R13 client-constant extraction plus
  the R14 cadence-model matrix, and the phase 06 soaks plus close-out. Each
  implementation phase (01 to 05) passed targeted vitest, tsc, biome on
  touched files, and a fresh two-reviewer coverage fan-out with every finding
  applied or recorded (the close-out ran nine reviewers, next bullet);
  load-bearing pins were mutation-verified throughout.
- The three R14 deviations, settled during phase 05, do not re-litigate:
  (1) THE core pin is split into two honest halves because the constants tie
  exactly (MSG_ABUSE_SECOND_DROP_FLOOR 30 plus
  MSG_LANE_MOVEMENT_REFILL_PER_SECOND 90 equals MSG_RATE_REFILL_PER_SECOND
  120), so any kick-able sustained movement flood saturates the class-blind
  gate first: a gate-bounded 300/s burst arm delivers the literal
  not-one-cast-dropped property, and a sustained arm pins the lane guarantee
  (zero command-lane loss, every gate-admitted cast processed) up to the kick.
  (2) The stall-then-flush arm stalls 20 s, not 15: the honest measured send
  rate at 240 Hz is about 60/s (the timer suppresses gated flushes), so 20 s
  buffers the specced 1,200-frame magnitude. (3) The 500/s flood kick lands
  just past 4.1 s, band (4, 10]: tallyDrop marks a second abusive at the
  crossing drop, not at the second boundary.
- Phase 06 results: the 80-bot jitter soak matched the packet 0 baseline with
  zero drop-counter increments across 96,095 inbound frames (numbers and
  environment in soak-packet-3.md beside this file); the 5-minute 80/s turn
  soak acked all 24,000 frames with counters flat; the R11 detector re-check
  found both copies byte-identical with zero limiter symbols in the detector
  source, verdict re-confirmed at overlay tip
  d63425a6c1ec82e054582d9c686b9c9358019215 (2026-07-09).
- The close-out /qa fan-out ran nine fresh read-only reviewers (qa-checklist,
  privacy-security-review, test-coverage-auditor, frontend-seam-reviewer,
  cross-platform-sync, correctness, dead-code, then security and coverage
  again over the list-read addendum). No blocking finding anywhere; the one
  WARNING became the list-read guard (the ruling bullet in the packet-level
  notes below). Post-review additions: the chat-lane and mixed-cause kick
  arms, the resume-carry arm, and the msgRate field comment.
- The R10 lockstep pin proved itself during the addendum: the full gate
  failed on exactly the localization_fixes arm counting the kick sites when
  consumeListRead added a legitimate third, and the pin was consciously
  updated to three. That is the pin's designed behavior: a new kick site must
  join the count, the matcher, and the frame pins together.
- Durable homes for the architecture this packet added: the inbound flood
  defense contract is documented in server/CLAUDE.md (gate, lanes, guard, the
  shared abuse window, the detector placement rules, and the metered-DB-read
  rule); the client send-cadence model and the disconnect-literal lockstep
  are in src/net/CLAUDE.md.

## Packet-level notes

- Consequence ledger (carried from brainstorm section 7 Packet 3, verbatim in
  substance): casts stop being silently eaten during sustained turns at healthy FPS;
  other players see smoother remote headings; micro rubber-banding while running plus
  turning disappears. Flood posture changes shape: sustained moderate over-limit
  senders move from throttled-forever to score-kickable, while parse exposure rises
  with the higher ceiling and is bounded by the byte budget (sustained-flood parse
  exposure NET drops, from a theoretical 640 KiB/s to 64 KiB/s; short-burst exposure
  rises with the larger burst). No visual, balance, or determinism change: src/sim/
  is untouched, the client diff is a constant extraction, and movement authority is
  unchanged.
- Activation coupling: the defect this packet fixes is INACTIVE below about 30 fps,
  so it cannot be reproduced live at the current town framerate and the cadence tests
  are the proof, not a live repro. Packets 1 and 2 restore FPS and thereby ACTIVATE
  the defect fleet-wide, which is why this packet ships with or before them (the
  execution-order ruling in brainstorm section 7).
- Cross-phase file overlap: phases 01 to 04 all touch server/game.ts in disjoint
  arms of handleMessage / dispatchMessage; they are strictly sequenced.
- The wire and IWorld are untouched: no new fields cross the snapshot boundary in
  this packet (the deferred beacon surfacing would, and waits for packet 0 per R9),
  so no world_api parity work and no cross-platform sync surface.
- The bot-detector build alias (#bot-detector via scripts/build_server.mjs) resolves
  to the stub in this worktree (the private overlay is not copied); nothing in this
  packet needs the real detector, and the R11 verdict was reached against the
  overlay copies directly.
- Adjacent defects observed during scouting, deliberately OUT of scope (candidates
  for separate issues): the 'moderation action' kick reason renders raw English in
  the fatal overlay (no matcher arm); protocol_conformance's header comment in the
  private repo claims anomalies are not rate-limited on the wire, which the
  pre-parse gate contradicts (doc drift, both copies); frames rejected by the
  stale-session guard return before wsMessage('in') and stay uncounted; and a
  spectator's non-chat cmd hits the pre-existing spectating early return
  before any lane draw (found by the PR #2372 review), the one message class
  with no lane token: gate-bounded and benign (a spectator has no sim entity
  to starve), left as-is.
- Defect found by the phase 06 security review, RESOLVED IN-PACKET by the
  maintainer's ruling (2026-07-24): the ignore/block LIST-READ chat commands
  return from the chat case BEFORE the chat lane and the ladder (the R5
  ordering, deliberate so a silenced player can manage lists without burning
  chat tokens), and the reads are uncached per-call DB SELECTs, so a hostile
  authenticated client could sustain list-read frames at the full pre-parse
  ceiling with zero drops, unkickable by the abuse window, and this packet's
  ceiling raise (40 to 120 per second) tripled the reachable DB-read rate.
  The ruling chose a dedicated read guard: server/list_read_guard.ts (burst
  10, refill 1 per second, far above any human rate), drawn inside
  handleChatFilterCommand's read arm only, refusals dropped before the DB
  read and tallied into the shared R6 abuse window so a sustained read flood
  kicks like any other. R5's letter is intact (no chat token drawn, writes
  keep their ladder metering, the moderation router stays upstream), and the
  phase 02 ten-readout chat-exhaustion pin stays green at the guard burst.
  This AMENDS R8's cause vocabulary from five to six: WS_DROP_CAUSES gains
  'list_read', pre-registered at zero like the rest. Pins:
  tests/list_read_guard.test.ts, the two seam arms in tests/msg_lanes.test.ts,
  the cause arm in tests/game_state_metrics.test.ts, and the tunables row.
- Biome on touched files only; no em/en dashes or emojis anywhere; Conventional
  Commits with scope and body; never a whole-repo --write; the branch stays local
  until the maintainer's explicit go.
