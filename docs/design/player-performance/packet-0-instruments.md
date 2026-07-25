# Packet 0: Instruments

Program: Player Performance Overhaul (brainstorm.md revision 2; decisions resolved
2026-07-23). This packet repairs and extends the measurement stack so every later packet
tunes against real numbers. It is MEASUREMENT-ONLY: zero gameplay change, zero visual
change (one new informational toast is the sole player-visible addition), and the
render-budget governor's behavior is preserved bit-for-bit on every tier.

Worktree at authoring: /Users/fernando/Documents/wocc-player-perf, branch
feature/perf-instruments; SHIPPED combined with packet 3 on feature/input-cadence at
the maintainer's request (one PR off the latest release branch).
Deliverable: that combined gate-green PR, following the PR template, with baselines.md
and the Close-out record under this directory (the per-phase QA files were consolidated
into that record at the combined-branch close; full text in git history).
Cadence followed: each phase landed with its phase-NN-qa.md before the next began;
targeted vitest plus tsc while iterating; full npm run gate plus /qa at packet close.

Scope sources: brainstorm.md section 7 Packet 0 (all eight bullets) plus the scout
rulings below. Anchors cite paths and exported symbols per the docs anchor rule.

---

## Packet rulings (scout open questions, decided here)

R1. Draw-stats tier strategy: PER-TIER HYBRID. info.autoReset flips to false ONLY on
    composer tiers (high/ultra, where today's counts are garbage); low/medium keep
    three's per-render auto-reset so BOTH their governor input and their telemetry stay
    bit-identical to today. On composer tiers the governor receives a frozen
    legacy-equivalent constant (the observed final-pass value, confirmed live and pinned
    in the unit test), so the dead draw arm stays exactly as dead as it is today.
    Consequence: medium telemetry keeps excluding shadow-pass draws until Packet 5
    (which flips everything to accumulated counts WITH retuned caps). This resolves the
    tension between the brainstorm's global-flip wording and its measurement-only
    guarantee in favor of the guarantee.
R2. GFX_CONFIG_VERSION bumps 17 to 18 so fleet dashboards can segment the draw-count
    semantics change.
R3. Crowd bucket: pure module src/game/crowd_bucket.ts; labels
    lt10 | 10-24 | 25-49 | 50-99 | 100plus | unknown; bucketed on the renderer's
    activeViews (draw-band scoped, host-consistent across offline Sim and online
    ClientWorld); simEntities, activeViews, and visibleViews additionally ship raw.
    Legacy pre-column rows ('' bucket) fold to 'unknown' in the mapper at read time.
R4. Zone id is instance-aware: the provider emits the zoneAt(z) id in the overworld and
    a bounded instance-scoped id (for example dungeon:<id>, delve) inside instances,
    following the instance_music.ts pattern, so the crowded-town signal never mixes
    with raid interiors.
R5. Worst-10s window: worst-per-report-interval semantics. The tracker is drained by the
    REPORTER after a successful send (an explicit drain hook; PerfMonitor.snapshot()
    stays a pure read).
R6. PERF_REPORT_SCHEMA_VERSION bumps to 2; the intIn clamp already keeps old clients on 1.
R7. Worst-10s index: (worst_10s_frame_p95_ms DESC, created_at DESC), created via
    CONCURRENT_INDEX_MIGRATIONS (never boot DDL on this live table).
R8. Net stats module stays bucket-agnostic (src/net cannot import src/game); the report
    payload carries crowdBucket as its own field, dashboards join on it.
R9. Parse/apply spans are dev-trace-only (the unused 'external' DevPerfTraceSpan kind);
    the fleet story rides always-on aggregate counters. Bytes field is the UTF-16
    raw.length proxy, named approxBytes. Snapshots-per-rAF pending count resets on
    visibilitychange; histogram buckets 0/1/2/3plus.
R10. Heap sawtooth samples at 1 Hz from the ungated PerfMonitor.tick using the existing
    memorySnapshot source; quantization-tolerant thresholds; null-safe off Chromium.
R11. Stall-replay scope: server-keeps-ticking stall arms at 100/250/400/500 ms, PLUS one
    greater-than-500 ms arm pinning the deliberate 6 yd snap-reset boundary. The
    yaw-untouched claim is pinned via the zero-lateral-drift proxy on a straight run.
R12. Bench gates: one scripts/lib/bench_gate.mjs (+ .d.mts) serves both scripts. Join
    enforcement is UNCONDITIONAL (no escape-hatch env; exploratory runs lower
    CROWD_BATCHES). Jitter ceiling gates the OBSERVER p95 only, with refusal on a
    disabled observer or fewer than minGaps samples (minGaps = floor(DURATION_MS / 50
    * 0.5)). gapStats moves verbatim (floor nearest-rank pinned). perf_tour gains a
    frames summary field and an opt-in PERF_GPU=1 headed real-GPU mode; the retired
    frameP95 baseline rows are deleted outright. crowd_fps_bench gets a perf:crowd npm
    entry.
R13. Honest-gate baseline rows (frameLong50, tourMinFrames) are captured on the owner's
    Mac via PERF_GPU=1 during phase 04 (the test and its baseline land in one commit;
    refreshed at packet close if the close-out captures differ materially).
    Close-out amendment (2026-07-24, per the phase 07 instruction): the refresh clause
    was extended to the stale hudHotDomWrites anchor, which phase 04 had left
    byte-identical by contract and flagged as stale. The close-out captures differed
    materially (desktop 538/539, mobile 632/632 vs the committed 153), so the anchor
    was re-derived to 640 (worst viewport plus run-jitter headroom) with the
    byte-identical-across-viewports prose re-derived in the same commit. This
    supersedes the phase 04 "hudHotDomWrites ... stay byte-identical" line for the
    packet-close commit; the frame-gate rows themselves were KEPT (numbers in
    baselines.md and the Close-out record).
R14. Perf-doctor: suggestion ids are CLIENT-computed and ride the beacon; the server
    validates against a local allowlist (a cross-boundary parity test pins the two
    catalogs equal; server code cannot import src/game). Storage is a TEXT[] column.
    Admin surfacing is a suggestionCounts field on the perf summary via a SECOND
    bounded statement (the exactly-one-statement pin updates deliberately). No Svelte
    work.
R15. New analyzer rule id 'integrated-gpu': fires on bad frames + an integrated GPU
    classification + NOT the desktop shell (the shell already forces the dGPU, PR
    #1991); copy is phrased conditionally ("if this computer has a gaming GPU...").
    Mutually exclusive with 'hardware-acceleration' (software classification wins).
R16. Nudge toast is a SIBLING of the existing gpuNotice, one-per-install with persisted
    dismissal keyed by the shown id set (re-arms if the triggering ids change); its
    software arm is suppressed when the boot-time gpuNotice already showed. gpuNotice
    itself is not refactored in this packet.

---

## Phase 01: draw_stats accumulator (composer tiers)

Goal: real draw-call/triangle numbers on high/ultra everywhere downstream of
Renderer.perfStats, with the governor untouched on every tier (R1, R2).

Diff shape:
- NEW src/render/draw_stats_core.ts (pure core; register in RENDER_PURE_CORES in
  tests/architecture.test.ts in the same change). createDrawStatsAccumulator() with
  beginFrame(read) returning the previous frame's delta (clamped at zero, tracking
  calls/triangles/points/lines), noteOutOfBand(read) to exclude screenshot/prewarm
  renders, and governorDrawSignal(tier, frame) returning the frozen legacy constant on
  composer tiers and the passthrough elsewhere. LOCAL structural counter interface; no
  three import (forbiddenRenderCoreImport), no clocks, no DOM.
- src/render/renderer.ts (thin consumer edits only): set webgl.info.autoReset = false at
  construction WHEN GFX.composer; at sync() start (before updateAdaptiveResolution)
  snapshot-and-reset on composer tiers; perfStats() serves calls/triangles from the
  snapshot on composer tiers and the live info elsewhere (field names unchanged);
  updateAdaptiveResolution feeds governorDrawSignal; renderPrewarmPass and
  captureScreenshot call noteOutOfBand + reset on composer tiers.
- scripts/profiler/harness.mjs: the draws/tris row switches from raw webgl.info.render
  to the perfStats surface; scripts/prewarm_travel_bench.mjs's calls/triangles probe
  fields switch the same way (the two out-of-src consumers that would print monotonic
  counters otherwise; the bench forces ?gfx=ultra by default, a composer tier).
- src/render/gfx.ts: GFX_CONFIG_VERSION 17 to 18.
- Untouched by contract: render_budget.ts, its CAPS_BY_TIER, tests/render_budget.test.ts
  (staying green and unedited IS the neutrality proof), server ingest (validation cap
  1,000,000 holds), all i18n.
Tests: NEW tests/draw_stats_core.test.ts per the scout list: cross-pass accumulation
with disagreeing operands, out-of-band exclusion plus its guard-flip variant, per-tier
governor shim pins (composer constant pinned to the live-confirmed value and asserted
NOT equal to the input; low/medium passthrough), first-frame baseline discard,
backward-counter clamp. tests/architecture.test.ts gains the RENDER_PURE_CORES entry.
Gotchas honored: three r165 reset location is version-pinned (note in the module header
by symbol, not line); separate WebGLRenderer instances (portrait/preview/armory/guide/
editor) own their info and are untouched; memory/programs counters are never reset and
their consumers stay as-is.
Acceptance: on a local high/ultra run, the ?perf overlay draws row reports hundreds in
town (not 1); on low/medium the values are byte-identical to a pre-change control run;
targeted vitest green (draw_stats_core, render_budget untouched-green, perf_metrics_
sampler, perf_overlay_model, perf_reporter); tsc clean.
QA file: phase-01-qa.md (consolidated into the Close-out record at the combined-branch close; full text in git history).

## Phase 02: client net-pipeline instrumentation

Goal: the parse/apply blind spot closed with always-on counters (finding 20's net half;
R8, R9, R10).

Diff shape:
- NEW src/net/net_pipeline_stats.ts (clock-injected, bounded rings): recordSnapshot
  ({nowMs, approxBytes, parseMs, applyMs, entCount, keepCount, rawGapMs|null}),
  onAnimationFrame(nowMs) folding the applied-since-last-rAF count into the 0/1/2/3plus
  histogram, noteReset() for reconnects, summary() returning a small fixed-size record
  (p50/p95/max for parse/apply/gap plus totals).
- src/net/online.ts (~6 lines, lazy-init holder per the wireSeen bareClient pattern):
  time JSON.parse and applySnapshot, capture raw.length for snap frames, record the RAW
  inter-arrival gap before the (5,500) EWMA filter, noteReset in the 'hello' reconnect
  arm.
- src/game/perf.ts: UNGATED setNetPipeline(summary) into a nullable
  PerfSnapshot.netPipeline (deliberately not the enabled-gated setNetwork); optional
  recordExternalSpan on the unused 'external' span kind for dev traces.
- NEW src/game/heap_sawtooth.ts (injected reader + clock): gcDropCount/avgDropMb/
  allocRateMbPerSec/amplitudeMb from the 1 Hz used-heap series; sampled from
  PerfMonitor.tick; null-safe.
- src/main.ts (wiring only): per-frame drain next to the existing setNetwork call;
  visibilitychange reset hook.
- src/game/perf_reporter.ts: netPipeline + heap fields into rawSummary;
  server/perf_report.ts: add 'netPipeline' to the compactRawSummary truncation
  allowlist (no DDL; rawSummary is JSONB).
Tests: NEW tests/net_pipeline_stats.test.ts (hand-computed totals; the 900 ms gap
RETAINED in the raw ring is the load-bearing pin; histogram drain write-vs-read),
bareClient integration pin driving onMessage twice with computed byte sums, the
ungating pin (netPipeline present while network is null when disabled), NEW
tests/heap_sawtooth.test.ts (ramp-drop-ramp fixture; null reader arm),
tests/perf_reporter.test.ts and tests/perf_report.test.ts extended for the new
rawSummary key.
Gotchas honored: net/ never imports src/game (main.ts is the junction); bareClient
suites skip field initializers (lazy-init mandatory); do not touch the EWMA filter.
Acceptance: a local online session's perf report carries netPipeline with nonzero
parse/apply percentiles and the raw gap ring; targeted vitest green; tsc clean.
QA file: phase-02-qa.md (consolidated into the Close-out record at the combined-branch close; full text in git history).

## Phase 03: report dimensions end to end

Goal: zone, crowd, mainMs, and worst-10s land as queryable fleet dimensions (finding 20;
R3-R7).

Diff shape (client):
- NEW src/game/crowd_bucket.ts (label list per R3) + NEW src/game/worst_window.ts
  (rolling worst-10s tracker over PerfMonitor's existing frameWindow, evaluated at the
  1 Hz tick; reporter-drained per R5).
- src/game/perf.ts: ungate the four mainMs buckets in time() (bucket recording always
  on; overlay mount, markInput*, and traceEnabled spans stay gated); PerfSnapshot gains
  windows.worst10s.
- src/game/perf_reporter.ts: PerfReporterOptions gains worldTelemetryProvider
  (() => {zoneId, simEntities} | null); payloadFromSnapshot emits zoneOrScenario from
  the provider for gameplay sessions (benchmark ?perfScenario keeps priority),
  simEntities, activeViews, visibleViews (null-guarded lastFrame), crowdBucket,
  worst10sFrameP95Ms; schemaVersion 2.
- src/main.ts: the one-line provider closure using the in-scope world (zoneAt from
  ../sim/data, instance-aware per R4). No IWorld change (entities/player already
  IWORLD_MEMBERS; adding a zone member would be parity churn for nothing).
Diff shape (server):
- server/perf_report.ts: sanitizers for the five fields (choiceIn over the fixed crowd
  labels; clamps per scout).
- server/db.ts: five ALTER TABLE client_perf_reports ADD COLUMN IF NOT EXISTS lines
  (crowd_bucket TEXT NOT NULL DEFAULT '' preserving the GROUPING-bits contract);
  ClientPerfReportInsert + insertClientPerfReport renumbered carefully; the worst-10s
  index constants exported and appended to CONCURRENT_INDEX_MIGRATIONS (R7).
- server/client_perf_summary_shape.ts + server/admin_db.ts: byCrowd bucket set, g_crowd
  bit, sets list + tie-break + totals arm to sum = 6, PERF_SUMMARY_LIMITS.byCrowd (~8),
  clientPerfRaw + PerfRawRow columns; '' folds to 'unknown' in the mapper (R3). Zone
  needs no summary change (byScenario becomes zone-valued automatically).
Tests: per the scout list: zone flow-through (fails-first: today it is 'gameplay'),
benchmark priority preserved, crowd_bucket boundary pins, mainMs-ungated pin (count ===
N with enabled false, plus the preserved-gating assertions), worst-window dilution
repro, server sanitization pins, SQL text pins updated (grouping sets, sum = 6,
tie-break, cap arm), shape-test routing for g_crowd, admin fixtures gain byCrowd (tsc
forces), schema_wiring order pin appended, the opt-in PG roundtrip (the ONLY guard for
positional-param renumbering: run it).
Gotchas honored: dual-arm dispatch stays inside handlePerfReport; keepalive 60KB cap
(scalars only); rawSummary allowlist not used for these (they are top-level columns);
PerfMonitor tests stub browser globals.
Acceptance: a local report row carries real zone id, crowd bucket, populated mainMs,
and worst-10s; admin summary returns byCrowd; PG roundtrip green; targeted vitest green.
QA file: phase-03-qa.md (consolidated into the Close-out record at the combined-branch
close; full text in git history). NOTE: phases 03 and 05 edit the same files (payload, row build,
DDL block, summary SQL); they are sequenced (03 first) to keep diffs clean.

## Phase 04: honest gates (frame gate + bench scripts)

Goal: the crowd regime gets real, failable gates (finding 21; R12, R13).

Diff shape:
- NEW scripts/lib/bench_gate.mjs + bench_gate.d.mts (mob_stall_parse pattern):
  parseCeilingEnv (trimmed; whitespace never becomes zero), evaluateCrowdRun
  (unconditional exact-join enforcement; non-finite metrics = missing evidence;
  CROWD_MIN_FPS ceiling when set), gapStats moved verbatim (floor nearest-rank),
  evaluateJitterRun (observer-only ceiling with refusal per R12).
- scripts/crowd_fps_bench.mjs: thin orchestrator over the lib; ACTUAL join accounting
  (bots.length, not attempts); verdict routed to exit code; evidence written before
  exit. Optional composer-tier sanity: draws above the fullscreen floor once phase 01
  is in.
- scripts/server_load_jitter.mjs: lib imports; JITTER_MAX_P95; verdict in JSON_OUT;
  exit(ok ? 0 : 1); partial joins now fail.
- scripts/perf_tour.mjs: frames in summarizeResult; opt-in PERF_GPU=1 headed real-GPU
  mode (default stays headless swiftshader).
- tests/hud_perf_budget.test.ts ARM 3: delete readBaselineFrameP95 + its env override +
  the frameP95 it() in one commit; add readBaselineLongFrames + tourMinFrames readers
  (canonical-row regex style, never loose includes); new assertions: frames >=
  tourMinFrames (kills the inverted-saturation hole) AND frameLong50 <= the committed
  anchor (override env for other machines). hudHotDomWrites + fctBurst + ARMs 1-2 stay
  byte-identical.
- tests/hud_perf_budget.baseline.md: frameP95 rows deleted (including prose the old
  loose parser could bind to); frameLong50 + tourMinFrames rows added from a PERF_GPU=1
  capture on the owner's Mac (R13); capture-machine table refreshed.
- package.json: perf:crowd entry.
Tests: NEW tests/bench_gate.test.ts per the scout's eight decisive cases (join miss,
min-fps ceiling both arms, non-finite refusal, minGaps refusal, observer-missing
refusal, ceiling pass/fail, the floor-vs-ceil nearest-rank disagreement fixture, env
parsing). One-time local decisiveness check: strip the frameLong50 row, confirm bare
npm test fails loudly at collection, restore.
Gotchas honored: the 250 ms sample clamp and 0.25 s frameDt clamp STAY (they protect
dt across tab-hide; the gate metric changes, not the clamps); long50 is windowed by
MAX_SAMPLES (keep the tour short); scripts stay operator-run (ALLOW_DEV_COMMANDS +
rate-limit bypass make them dev-only by construction; never wire into CI).
Acceptance: a deliberately partial-join crowd run exits nonzero naming the counts; the
tour arm fails when fed a doctored low-frames artifact; bare npm test green.
QA file: phase-04-qa.md (consolidated into the Close-out record at the combined-branch close; full text in git history).

## Phase 05: perf-doctor wiring + the nudge toast

Goal: machine-local causes become visible in fleet data and to the affected player
(finding 16; R14, R15, R16).

Diff shape:
- src/game/perf_doctor.ts: export the id catalog (PERF_SUGGESTION_IDS + PerfSuggestionId)
  and PerfDoctorSnapshot; add the 'integrated-gpu' rule per R15; update the "no live
  importer" header comment.
- src/game/perf_reporter.ts: payload gains suggestionIds (client-computed, R14).
- server/perf_report.ts: KNOWN_PERF_SUGGESTION_IDS allowlist + suggestionIdsIn
  (filter/dedupe/cap 3); server/db.ts: suggestion_ids TEXT[] NOT NULL DEFAULT '{}'
  additive ALTER + insert wiring; admin: suggestionCounts via a second bounded
  statement under runWithStatementTimeout, shape in client_perf_summary_shape.ts, the
  exactly-one-statement pin updated deliberately (R14).
- NEW src/ui/perf_nudge_view.ts (pure view-core, UI_PURE_CORES registration): maps
  ({suggestionIds, softwareNoticeAlreadyShown, dismissedBefore, desktopShell}) to
  {shown, bodyKey}; NEW src/ui/perf_nudge_toast.ts modeled on gpu_notice_toast (own
  dismissal key, languagechange re-render, role=status); NEW src/game/perf_nudge.ts
  assembler modeled on software_render_notice (runs after real gameplay frames, since
  the non-software rules need a bad last10s window; one composition call from main.ts).
- i18n: perfNudge keys beside gpuNotice in src/ui/i18n.catalog/shell.ts, the five
  non-Latin overlay fills in the SAME change (M16), npm run i18n:gen with the
  regenerated artifacts committed (freshness gate); toast renders t() keys only, never
  PerfSuggestion.title/body (those stay English dev-diagnostics).
- src/styles/shell.css: a sibling section next to #gpu-notice.
Tests: per the scout list: perf_doctor catalog + iGPU rule + WARP mutual-exclusion pins;
payload suggestionIds pins (software fixture yields the id, healthy yields []); server
allowlist filter/dedupe/cap pins with hostile input; the cross-boundary
perf_suggestion_id_parity test; perf_nudge_view state-machine pins; assembler
fires-exactly-once pin; reports_telemetry RouteDef-arm ingest pin; summary shape/SQL
pins updated; css component test for the new section.
Gotchas honored: server cannot import the analyzer (R14 is the design, the parity test
is the drift guard); untrusted client ids are allowlisted before touching admin
aggregates; the double-toast hazard (R16 suppression); i18n freshness artifacts staged
in the same commit (re-baseline rule).
Acceptance: a simulated software-GL session stores ['hardware-acceleration'] on its row
and shows the nudge exactly once across reloads; a healthy session stores [] and never
shows it; i18n completeness green at PR tier; targeted vitest green.
QA file: phase-05-qa.md (consolidated into the Close-out record at the combined-branch close; full text in git history).

## Phase 06: predictor stall-replay coverage

Goal: the 100-500 ms broadcast-gap regime gets decisive regression coverage (R11).

Diff shape: test-only plus at most one export (LEASH_SLACK_YD if magic-number-free
assertions are preferred). Extend tests/self_motion.test.ts with the scripted-stall Lab
variant (server keeps ticking, mirror + lastSnapMs suppressed): it.each over
100/250/400/500 ms gaps asserting (a) leash containment every frame, (b) saturation
actually reached (non-vacuous), (c) no backward step on resume, (d) bounded forward
step (no snap; the anchor jump at 500 ms is under the 6 yd rule), (e) recovery to the
steady lead band within ~1 s, (f) zero lateral drift (the yaw proxy). One
greater-than-500 ms arm pinning the deliberate snap-reset. Optional companion pin in
tests/net_interp.test.ts: remote-entity continuity across a 400 ms gap (pose before
resume equals re-anchored pose after, with alpha having ridden the 1.25 cap so the
equality is non-trivial).
Gotchas honored: pure Node with the Lab's synthetic clock (no fake timers, no real-loop
polling); no parens in test names (vitest -t regex trap).
Acceptance: new arms green; a deliberate leash-budget mutation (local, reverted) flips
them red.
QA file: phase-06-qa.md (consolidated into the Close-out record at the combined-branch close; full text in git history).

## Phase 07: baselines + packet close-out

Goal: the numbers every later packet tunes against, captured with the repaired
instruments, committed as baselines.md in this directory.

Runbook:
1. Owner-Mac town session on the live site: ?perf overlay JSON copy plus one Chrome
   Performance trace during an arrow-key turn in the plaza (formally settles the
   CPU-bound presumption; brainstorm section 1). Close-out amendment (2026-07-24, per
   the phase 07 instruction): reassigned to the maintainer track alongside step 4
   (live-site owner session, do not attempt from an agent session); commands in
   baselines.md section 4. The CPU-bound presumption therefore stays formally
   unsettled until that capture lands.
2. Local crowd curve: perf:crowd with CROWD_BATCHES=20,40,60,80 against a local server
   (dev commands on), per-tier via CROWD_GFX for low/medium/high/ultra; record the
   FPS-vs-crowd curve and real high-tier draw counts (phase 01 makes them true).
3. Jitter soak: perf:load at BOTS=80 IDLE=1 with JSON_OUT committed as the baseline
   file for the Packet 6 gap-p99 comparison.
4. Production peak captures (maintainer-run, documented commands): POST
   /admin/api/perf/tick/capture during a busy evening + GET /admin/api/perf/summary
   after 48 h of the new dimensions, to seed the zone/crowd fleet view.
5. baselines.md: the committed record (machine table, commands, values), replacing
   nothing (new file); refresh the phase 04 baseline rows if these captures differ
   materially (R13).
Close-out: full npm run gate (release-tier auto on release branches does not apply on
this feature branch; run the standard tier), /qa fan-out with the named reviewers
(frontend-seam-reviewer for the render/ui touches, migration-safety +
database-performance-reviewer for the DDL/index/summary SQL, privacy-security-review
for the beacon field additions, test-coverage-auditor for the new pins), PR body with
the consequence ledger from brainstorm Packet 0 plus phase QA links.
QA file: phase-07-qa.md, the packet-level adversarial pass (consolidated into the Close-out record at the combined-branch close; full text in git history).

---

## Close-out record (all seven phases landed 2026-07-23 to 07-24; combined PR with packet 3)

The seven per-phase QA files were consolidated into this section when packets 0
and 3 were combined onto one branch at the maintainer's instruction; their full
text lives in git history (feature/perf-instruments through cf3412e66 and the
combine merge). What survives here is everything a future reader needs that the
rulings, code, tests, and baselines.md do not already carry.

- Landed, in order: real draw stats on composer tiers (draw_stats_core.ts, the
  governor kept bit-identical via the frozen legacy signal); the always-on
  net-pipeline and heap-sawtooth instruments riding the perf report; zone,
  crowd, mainMs, and worst-10s as fleet dimensions (schema version 2, the
  concurrent worst-10s index); honest failable bench gates
  (scripts/lib/bench_gate.mjs, exact-join enforcement, the frameLong50 and
  tourMinFrames rework); the perf-doctor nudge (the packet's one
  player-visible change: integrated-gpu rule, one-per-install toast, beacon
  suggestion ids with server allowlist and TEXT[] storage); the test-only
  broadcast-stall replay arms; and the committed baselines
  (baselines.md + jitter-soak-baseline.json) with the R13 anchor refresh.
- Two amendments were RATIFIED in the PR #2372 review (2026-07-24), both
  written into their ruling and runbook sites as "Close-out amendment
  (2026-07-24)": the R13 refresh-clause extension (the hudHotDomWrites anchor
  re-derived 153 to 640 at packet close, superseding the phase 04
  byte-identical contract for that commit; the frame-gate rows were KEPT),
  and the runbook step 1 reassignment of the owner-Mac live-site capture to
  the maintainer track (the CPU-bound presumption stays formally unsettled
  until that capture lands).
- Recorded deviations, all deliberate: the phase 01 spec-wording fix (the
  prewarm bench was a second raw-counter consumer; both moved to the
  perfStats surface) and its accepted small allocation on composer-tier
  frames; heapSawtooth joining netPipeline on the rawSummary allowlist (the
  reporter writes it as its own key); the phase 03 provider closure realized
  as src/game/world_telemetry.ts because main.ts is a firewall; the phase 06
  LEASH_SLACK_YD export DECLINED so the disagreeing test literal stays the
  stronger pin; the phase 05 R16 consequence that a prior-session gpuNotice
  dismissal still allows the software nudge exactly once; and the phase 07
  capture deviations recorded in baselines.md (ultra at 1600x900 after a
  reproducible tab crash; fresh server per tier because LINKDEAD_GRACE_MS
  holds dropped bots in-world).
- One superseded historical claim, kept as-is by design: phase 04's "biome
  zero errors" acceptance was falsified by close-out gate run 1 (a format
  drift); QA files record what was believed at their timestamp, and the
  correction lives in the gate history below.
- Follow-ups this record owns (found by the close-out reviews, deliberately
  not done in-packet): the worst-10s index ships reader-less per R7 and a
  future fleet-view reader must re-EXPLAIN its real query before relying on
  the column order (also noted at the index definition in
  server/client_perf_indexes.ts); the pre-existing worst_rank window lacks a
  final tie-break key (append gl_renderer_bucket ASC, mirroring vol_rank);
  the insertClientPerfReport 44-param positional map has NO in-CI guard (the
  opt-in PG roundtrip with TEST_DATABASE_URL is the only decisive test, so
  run it on any column change); and the three structurally identical shell
  toasts (desktop update, gpu notice, perf nudge) have hit the rule of three
  for a shared extraction in a later packet (R16 deliberately kept gpuNotice
  unrefactored here).
- Gate and review history: four full-gate runs to green (run 1 a bench-gate
  format drift, runs 2 and 3 a test-side young-worker negative-rewind bug,
  run 4 green end to end); the opt-in PG roundtrip and summary differential
  green on the final tree; six fresh reviewers (qa-checklist,
  frontend-seam, migration-safety, database-performance, privacy-security,
  test-coverage) with every finding applied or recorded; then a post-close
  18-agent sweep over the 181-item QA ledger (zero code changes, three
  record-level doc fixes, one claim left as superseded).
- Maintainer items stay PENDING by nature, commands in baselines.md section
  4: the live-site overlay JSON, the Chrome trace that settles the CPU-bound
  presumption, the production peak tick capture, and the 48 h schema-2 perf
  summary.

## Packet-level notes

- Consequence ledger (player-visible): the nudge toast (new, informational, i18n'd,
  once per install) and the telemetry discontinuity on composer-tier draw counts
  (segmented by GFX_CONFIG_VERSION 18). Nothing else: no gameplay, no visuals, no
  governor behavior change on any tier (R1), no fairness surface.
- Cross-phase file overlap: phases 03 and 05 both touch perf_reporter payload,
  perf_report row build, db.ts DDL block, and the summary SQL/shape/tests; they are
  strictly sequenced. Phase 02 and 03 both touch perf.ts (disjoint functions).
- Server import discipline: nothing in server/ imports src/game; all analysis is
  client-side; the parity test is the only cross-boundary coupling and it lives in
  tests/.
- Retention: no new tables; client_perf_reports columns ride the existing
  PERF_REPORT_RETENTION_DAYS sweep (14-day default bounds suggestion-count history;
  acceptable, noted for the admin reader).
- The scripts remain operator-run by design (they require ALLOW_DEV_COMMANDS and the
  loopback rate-limit bypass); the release-tier jitter soak baseline is an operator
  cadence, not CI.
- Biome on touched files only; no em/en dashes or emojis anywhere; Conventional
  Commits with scope and body; never a whole-repo --write.
