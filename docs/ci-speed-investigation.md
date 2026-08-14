# CI/CD speed investigation (2026-08-13)

**Author:** Grok 4.6, from a live read of `release/v0.38.0` plus GitHub Actions
logs on 2026-08-13.

**Second pass:** verified, corrected, and extended the same day (Claude). Every
cited run, log line, script, and doc was re-checked against the real sources:
the workflow and planner code, the raw shard logs of the cited runs, the live
ruleset API, the last 40 CI runs, the vitest 4.1.10 source, and the GitHub
docs. The measured numbers in the first pass were accurate. The mechanism
story and the headline recommendation were wrong, and both are replaced below.

**Question asked:** PRs feel like they take about 30 minutes. Is that the
translations? Would a faster translation library help? What would software
changes buy if we cannot upgrade runners?

**Short answer:** Translations are not the wall (confirmed: about 7 seconds of
generation, off the critical path). The wall is a handful of giant single test
files, led by `tests/owned_class_balance_harness.test.ts` at 13.1 minutes as
ONE file, which on a sim-deep PR runs inside whichever shard's `vitest
related` leg its hash lands in and pins one of that shard's two workers for
its whole duration. Splitting those files is the change that moves every
surface at once. The first pass blamed "two sequential legs with a badly
mixed second pack" and proposed merging the legs as most of the win; the logs
refute that (section 5). Separately: the merge queue has been dormant since
Aug 7 because its ruleset still targets only `release/v0.35.0`, and the
39-minute queue day was the account's own 20-concurrent-job cap, both fixable
outside the codebase (section 9).

---

## 1. What the second pass confirmed, corrected, and added

Confirmed (checked against the actual logs and code, exact matches):

- Every per-run, per-step, and per-leg number in sections 4 and 6 below:
  checkout times, leg durations, file counts, the `[ci-shard]` audit lines,
  the three files that forced the mount PR full, the 7s i18n generation step.
- The two-tier selective design, the fail-closed fallbacks, the 9-file
  long-sims lane list, the generated-i18n carve-out, the floor composition,
  `maxWorkers = availableParallelism()/2`, and the repo weight table.
- Full mode really was faster than selective on sim-deep PRs (14.5 vs 20 min).

Corrected:

- **The mechanism.** Full mode is faster because full mode EXCLUDES the 9
  long-sim lane files from the shards and runs them in the parallel lane
  jobs. Selective mode's related leg deliberately does not exclude them, and
  in selective mode the lane jobs do NOT cover them either (proof in 5.2), so
  the giant files run inside the shards and set the wall. It is not about
  pack mixing.
- **The headline fix.** Merging the floor and related legs saves roughly 1 to
  3 minutes (one vitest startup plus the floor leg wall), not 7 to 9. Any
  merged pack still contains the 13-minute harness on a sim-deep PR, and a
  single file cannot be parallelized across workers. The 8-to-10-minute
  estimate attributed to merge-legs does not survive contact with the logs.
- **The merge-queue framing.** The cited 39- and 29-minute merge-group runs
  are from Aug 7 and were caused by a saturated 20-concurrent-job account cap
  (measured: concurrency pinned at exactly 19 to 20 for about an hour). The
  queue has not run since: its ruleset still includes only
  `refs/heads/release/v0.35.0`. Today's time-to-merge has no queue leg at all.
- Smaller factual fixes are inline: 14 required check runs (not "about 13
  jobs"), the reversed 66/86 percentages, the harness range (8.8 to 14.0 min
  across the three recorded samples, only 842s on the slow runner), the
  broken reproduce command, and the sparse-checkout risk (9 floor suites DO
  read `docs/screenshots`).

Added by this pass:

- The measured per-shard anatomy of a sim-deep selective PR (5.1), including
  the lane-file CPU inside each related leg.
- A second tier of giant files outside the lane list, led by
  `tests/warlock_sustain_balance.test.ts` at 359s (5.3).
- A verified one-invocation union mechanism for the legs (vitest's related
  seeds select themselves; 8.4).
- The concurrency-cap evidence, the dormant-queue ruleset gap, and the
  GitHub-docs facts on runner specs, job limits, sparse checkout, and merge
  queue batching (section 9).

---

## 2. How to verify this brief

Re-check these sources. Do not trust remembered line counts.

| Claim area | Where to verify |
|---|---|
| PR job graph, bounds, i18n pretest note | `.github/workflows/ci.yml` |
| Selective PR tier, long-sim lanes, i18n artifact rule | `docs/qa-gate.md` (sections "Selective PR-tier CI", "Generated i18n artifacts", "The long-sims lanes") |
| Merge queue contract | `docs/merge-queue.md`; live ruleset conditions via `gh api repos/levy-street/world-of-claudecraft/rulesets/<id>` |
| Floor / related / generated-i18n planner | `scripts/lib/ci_shard_plan.mjs` (`CI_LONG_SUITES`, `buildShardPlan`, `buildLanePlan`), `scripts/lib/gate_select_plan.mjs` (`isGeneratedI18nArtifactPath`), `scripts/lib/ci_test_select.mjs`, `scripts/lib/test_visibility.mjs` |
| Shard entry, workers, the 4-worker trial note | `scripts/ci_shard_test.mjs` |
| Pretest regen and the skip flag | `scripts/pretest.mjs`, `scripts/lib/gate_artifact_skip.mjs` |
| i18n runtime / lazy flip | `src/ui/i18n.ts`, `docs/i18n-scaling/` |
| Local-gate baselines (i18n:gen 2.6s) | `docs/local-gate-perf/baselines.md` |
| Runner-noise samples (527s/739s/842s) | comments in `.github/workflows/ci.yml` near the lane and release-gate `timeout-minutes` |
| Pins | `tests/ci_workflow.test.ts`, `tests/ci_shard_plan.test.ts`, `tests/ci_test_select.test.ts`, `tests/ci_selection_pipeline.test.ts` |
| Vitest related/shard semantics | vitest 4.1.10 source: `packages/vitest/src/node/specifications.ts` (`filterTestsBySource`, `getAffectedModules`), `packages/vitest/src/node/sequencers/BaseSequencer.ts` |

Live runs used below (levy-street/world-of-claudecraft, workflow `ci.yml`).
All walls re-measured from the run/job API in the second pass:

| Run | Event | Title | Mode | Wall |
|---|---|---|---|---|
| [31699849730](https://github.com/levy-street/world-of-claudecraft/actions/runs/31699849730) | `pull_request` | feat(map): overhaul MMORPG map markers | selective (51 sources, 39 tests, 24 generated i18n artifacts) | 19m56s |
| [31690262106](https://github.com/levy-street/world-of-claudecraft/actions/runs/31690262106) | `pull_request` | fix(chronomancy): restore level 20 healing ranks | selective (8 combat sources, 13 tests) | 20m11s |
| [31688512610](https://github.com/levy-street/world-of-claudecraft/actions/runs/31688512610) | `pull_request` | feat(content): add Veil-Wraith Courser rideable mount | **full** (three non-i18n generated files) | 14m29s |
| [31685501359](https://github.com/levy-street/world-of-claudecraft/actions/runs/31685501359) | `pull_request` | chore: update OSSBrain changes for v0.38.0 | selective (31 sources + 24 i18n artifacts) | 16m46s |
| [31682295054](https://github.com/levy-street/world-of-claudecraft/actions/runs/31682295054) | `pull_request` | chore(release): merge release/v0.37.1 into main | release-gate full | 22m47s |
| [31155546199](https://github.com/levy-street/world-of-claudecraft/actions/runs/31155546199) | `merge_group` | CI | full (queue, Aug 7) | 38m56s, max job queue delay 28.4 min |
| [31161062552](https://github.com/levy-street/world-of-claudecraft/actions/runs/31161062552) | `merge_group` | CI | full (queue, Aug 7) | 28m55s, max job queue delay 14.3 min |

Reproduce a shard decision locally. CHANGED_FILES must be a valid JSON array
of strings; anything unparsable makes the planner fail closed and print a
FULL plan, which looks like broken selection but is the fallback working:

```bash
TEST_MODE=selective CHANGED_FILES='["src/sim/sim.ts"]' \
  node scripts/ci_shard_test.mjs --shard=1/8 --plan-only
```

Audit lines to grep in a job log: `[detect_code_changes]`, `[ci-shard]`,
`Test Files`, `Duration`. Per-file durations are on the vitest result lines
(strip ANSI escapes first).

---

## 3. What a PR actually runs

`ci.yml` is a two-tier, sharded gate. A code PR runs 7 jobs which report as
**14 required check runs** (the PR gate is an 8-way matrix), after a
classifier that takes a few seconds:

| Job | Typical wall | Sets the PR clock? |
|---|---|---|
| Detect code path changes | ~10s | No |
| Format + lint (Biome, changed files) | ~1.4 min | No |
| Browser regressions (Chromium) | ~2 min | No |
| PR checks (i18n gen + freshness, malware, types, builds) | **2 to 2.5 min** | No |
| PR gate long sims A / B | 5 to 14 min | Sometimes |
| **PR gate shards 1 to 8** | **8 to 20 min** | **Yes, almost always** |

Release lanes (`release-gate`, `release-i18n`, `release-checks`) run only on
`release/**` pushes and release-to-main PRs. The 21-locale fill is
`release-i18n` only; ordinary PRs never set `I18N_RELEASE_TIER`.

Docs-only PRs skip the expensive work at STEP level so all 14 contexts still
report (a job-level skip of a matrix job collapses to one unsuffixed check
and wedges required contexts; that bug was found and fixed in #3044).
`merge_group` events always classify `code=true`, `test_mode=full` by design
(`docs/merge-queue.md`), though see section 9 for the queue's actual status.

The repo already landed a CI/CD performance packet: 8 shards, long-sim lanes,
selective mode, vitest `experimental.fsModuleCache` (persisted per shard with
an exact cache key), docs-only skip, generated-i18n artifact carve-out,
checkout-stall reruns (`ci-stall-rerun.yml`, armed on main since the v0.37.1
merge), and the balance-harness lane diet. Those are why this is 15 to 20
minutes instead of an hour.

---

## 4. Measured walls (verified against the run API and raw logs)

Green PRs finish in about **14 to 24 minutes** when the change is
substantive. Across the 22 completed `pull_request` runs of 2026-08-13:
median **15.9 min**, range 6.0 to 24.3, plus one 287-minute outlier from the
known checkout-stall class (the stall reactor that auto-reruns those is now
armed on main). Light-change PRs finish in 6 to 7 minutes.

### 4.1 Map marker PR (run 31699849730), selective, 19m56s

Shard 1 (`PR gate (English-only legal) (1)`), all verified exact:

- Checkout **49s**; toolchain + install + cache **~19s**; test step **18.3 min**; job wall 19.6 min.
- `[ci-shard]`: suite 2699 files (1912 graph-visible, 249 blind, 538
  partial); floor 787 (plan floor 802 + related over 75 sources); workers=2;
  9 lane suites excluded.
- Floor leg: 101 files, **100.76s**. Related leg: 157 files, **925.88s**
  (transform 7.22s, setup 30.79s, import 124.68s, tests 1669.04s).
- Inside that related leg (from the raw log): `owned_class_balance_harness`
  **822s**, `druid_balance_probe` **272s**, `hunter_dps_balance` **192s**.
  Those three lane files are 1286s of the leg's 1669s of test time.
- PR checks job: 2.5 min total; `Generate i18n artifacts` step: **7s**.

### 4.2 Chronomancy PR (run 31690262106), selective, 20m11s

The load-bearing run. Full anatomy in section 5.1. Floor leg 100 files /
91.95s; related leg 205 files / 951.45s on shard 1. The related legs across
all 8 shards collected 1634 files total (summed from the logs; the first
pass inferred "~1,640" from 205 x 8, which the logs do not print).

### 4.3 Mount PR (run 31688512610), full, 14m29s

Forced full by three non-i18n generated files (`sfx_manifest.generated.ts`,
`content.generated.ts`, `assets/manifest.generated.ts`; mechanism: generated
trees are excluded from related sources, so they fall through to the
unclassified catch-all, which fails closed to full). Shard 1 ran ONE leg:
335 files, **427.85s**. The long-sim lanes set the wall: A 822s, B 840s.

Full mode was faster than the selective sim-deep PRs. Section 5 explains why,
and it is not the reason the first pass gave.

### 4.4 Release to main (run 31682295054), 22m47s

`release-gate` shard 1 test step **21.3 min** (337 files / 1267s). This job
runs raw `vitest run --shard` with no selection and no lane exclusion, by
documented design (`scripts/lib/ci_shard_plan.mjs`: the post-merge backstop
must not depend on the selection machinery). The giant files land in whatever
shard their hash draws, which is why one shard is at 21 minutes.

### 4.5 Setup cost that every test job pays

Checkout **50 to 70s**; toolchain + `pnpm install --frozen-lockfile` **20 to
30s**; vitest cache restore ~2s; pretest **~30s** (once per job, via the npm
`pretest` hook on the floor leg's `npm test`; the related leg invokes vitest
directly and does not re-trigger it).

Repo weight the checkout pays for (verified 2026-08-13): `docs/screenshots`
**794 MB**, `public/` **661 MB** (audio 183, models 155), `tests/` 42 MB,
i18n trees ~50 MB total. Every test job does a bare full checkout; only the
`changes` and `release-version-gate` jobs already use blobless sparse
checkouts.

---

## 5. The real mechanism: a few giant files own the wall

### 5.1 Anatomy of the chronomancy run, per shard

From the raw shard logs (leg walls in seconds; "lane CPU" is time spent
re-running long-sims-lane files inside that shard's related leg):

| Shard | Floor leg | Related leg | Lane files inside the related leg | Job wall |
|---|---|---|---|---|
| 1 | 92.0 | **951.5** | harness 788 + druid_probe 291 + hunter_dps 172 = **1251s** | **19.8 min** |
| 2 | 144.6 | 390.3 | none | 11.3 |
| 3 | 112.7 | 682.2 | none (`warlock_sustain_balance` 359s, see 5.3) | 15.9 |
| 4 | 217.2 | 703.9 | raid_harness 366 + eastbrook_integration 122 = 488s | 17.9 |
| 5 | 87.2 | 272.4 | none | 8.7 |
| 6 | 101.3 | 387.0 | audit_conservation 51s | 10.7 |
| 7 | 87.8 | 275.0 | none | 8.4 |
| 8 | 136.2 | 546.7 | chronomancy_balance 210 + battleground 17 = 228s | 14.2 |
| Lane A | | | (selective: ran only its floor members) | 6.6 |
| Lane B | | | | 5.2 |

The wall is shard 1, and shard 1 is slow because the sha1-contiguous shard
draw put three of the nine lane files into its slice of the related set,
including the 13.1-minute harness. With 2 workers, a 788s single file pins
one worker for 13 minutes no matter what else is in the pack. The next
slowest NON-giant file in that leg was 31s.

### 5.2 Why the related leg must keep lane files today

`scripts/lib/ci_shard_plan.mjs` filters lane files out of the FLOOR leg but
deliberately not out of the related leg ("duplicate work, never a gap"). The
second pass confirms that comment is load-bearing, not an oversight: on this
selective run the lane jobs finished in 6.6 and 5.2 minutes, so they did NOT
run the harness; the lanes in selective mode carry only their floor members
(changed tests, blind/partial). The shard related leg was the ONLY place the
harness ran. Filtering lane files out of the related leg without changing
lane selection would silently drop a genuinely related 13-minute suite from
the PR gate. Any fix here must move the coverage, not delete it.

(True duplication does exist but is small: a lane file that is also a floor
member runs in its lane AND in a shard's related leg. On this run that was
chronomancy_balance, eastbrook_integration, and audit_conservation, about
6 runner-minutes.)

### 5.3 The second tier: giants outside the lane list

Shard 3 had no lane files yet its related leg still took 682s, driven by
`tests/warlock_sustain_balance.test.ts` at **359s** as one file. The 9-file
`CI_LONG_SUITES` list is a static snapshot and has gone stale: at least one
multi-minute sim file now lives outside it. Slowest observed single files on
this run: harness 788s, raid_harness 366s, warlock_sustain 359s, druid_probe
291s, chronomancy_balance 210s, hunter_dps 172s, eastbrook_integration 122s.
Everything else was under 60s.

### 5.4 Why full mode beat selective

Full mode excludes the 9 lane files from the shards and runs them in the two
parallel lane jobs (which then take ~13 to 14 min but overlap the shards).
Selective mode runs the giants inside the shards. That, plus the floor leg
and a second vitest startup, is the whole 20-vs-14.5 gap. The first pass's
"well-mixed pack" explanation is wrong: adding cheap files to a pack never
shortens a 788s single-file chain.

### 5.5 The consequence

A single test file is the unit of worker scheduling. Whatever job contains a
788s file has a hard 13-minute floor: shard, lane, or release-gate shard
alike. No selection, packing, sharding, or leg-merging change can beat that
floor. Only splitting the file can, which is why it is recommendation 1.

---

## 6. Are translations the problem?

**No. Not the generator, not the runtime, not the 21-locale release job.**
Everything in this section was re-verified.

### 6.1 Generator cost

- `PR checks` / `Generate i18n artifacts`: **7 seconds** measured; the whole
  checks job is ~2 to 2.5 min and never sets the PR clock.
- Local full-gate packet baseline: i18n artifacts 2.6s, freshness 0.1s
  (`docs/local-gate-perf/baselines.md`).
- Pretest re-runs `i18n:gen` + `wiki:content` once per test JOB (~30s x ~10
  jobs). The per-shard regeneration is documented as BY DESIGN in `ci.yml`
  and `docs/qa-gate.md` (the S3 guard and freshness suites must see the
  artifacts on every shard). Local `scripts/gate.mjs` generates once and sets
  `WOC_SKIP_PRETEST=1`; CI deliberately does not.

### 6.2 What the i18n system already is

Custom compile-time tables, not a runtime catalog walk: English catalog
(`src/ui/i18n.catalog/`, 2.5 MB), 21 sparse overlays (22 MB), dense generated
slices (26 MB, 0.95 to 1.5 MB per locale), a thin sync `t()` over a resident
table, and the lazy locale flip (production ships English eagerly and
dynamic-imports the other 21 locales). PRs may be English-only; the
21-locale empty-`pending` bar is release-tier only.

### 6.3 Why a translation library would not help CI

i18next / Lingui / FormatJS would still need key scanning, locale files, a
compile step, and the same release bar, while being slower at runtime than a
typed object lookup and requiring a rewrite of every `t()` site, the
sim/server matchers, and the S3 guard. A product rewrite, not a CI win.

### 6.4 Where translations do leak into CI (indirectly)

Selection, not generation. Generated i18n artifacts have their own carve-out
(`isGeneratedI18nArtifactPath` in `scripts/lib/gate_select_plan.mjs`): they
do not widen to full (before the carve-out, 8 of 25 replayed PRs went full
solely on them); integrity is owned by the pr-checks freshness diff; coverage
is owned by feeding the changed artifact paths to `vitest related` (a single
resolved slice reaches about 240 suites; that measurement was taken against a
2296-file suite, today's is 2686). On a PR that also touches `sim.ts` /
`hud.ts` the 24 locale entries are redundant with those coordinators and add
roughly nothing to the wall. Other generated trees (SFX, wiki, render
manifests) still force full via the unclassified catch-all.

---

## 7. The real cost stack (re-ranked by the second pass)

1. **Giant single test files.** One 788 to 842s file plus a second tier of
   170 to 366s files. They set the wall of whichever job runs them (5.5).
2. **Selective mode runs those giants inside the shards** because lanes do
   not cover related-only lane files in selective mode (5.2). This is why an
   8-file combat PR (20.2 min) was slower than a full-suite mount PR (14.5).
3. **~2,690 test files on 2 workers per 4-vCPU shard.** The repo measured 4
   workers as a regression (run 31107474546: the four sims' aggregate CPU
   went 644s to 1027s from memory-bandwidth contention). Note: vitest's own
   sizing guidance implies 1 main thread + 3 workers on 4 cores; 3 was never
   trialed. A single measured run would settle it.
4. **The floor (~780 to 800 files) plus a second vitest startup** on every
   selective shard: about 1.5 to 4 minutes depending on the PR.
5. **Checkout 50 to 70s per job, about 10 jobs**, dominated by 1.5 GB of
   blobs (`docs/screenshots` 794 MB) that most jobs read almost none of.
6. **Pretest regen ~30s per job.** Small, and protected by a written ruling.
7. **Account-level runner concurrency** (section 9). Caused the 29 to 39
   minute merge-group day on Aug 7. Not currently binding, and the queue is
   currently dormant anyway.
8. **`i18n:gen` / translation runtime.** Seconds.

---

## 8. What would actually make PRs faster

Budget constraint from the owner: no larger runners, no paid runner pool.
16 shards stay out: more Actions minutes, worse queue contention, and after
recommendation 1 the shards converge anyway.

### 8.1 Split the giant test files (the main event)

Split `owned_class_balance_harness.test.ts` (18 tests, 788 to 842s) into
per-class files, and `owned_class_raid_balance_harness.test.ts` (3 tests,
366s) likewise. This was already identified as the highest-leverage cleanup
when the release-gate bounds were resized (PR #3306); the harness is why
`pr-long-sims-a` and release-gate shard 1 are what they are. Splitting is a
pure test refactor: no selection semantics, no gate machinery, no coverage
change. Once no single file exceeds ~2 to 3 minutes:

- the sha1 draw scatters the pieces across shards and both lane halves;
- shard and lane walls converge toward total-CPU / 16 workers;
- sim-deep selective PRs drop from ~20 to roughly 12 to 14 min, full/content
  PRs from 14.5 toward 10 to 11, and release-to-main from ~23 toward 15
  to 17 (its wall is the same harness in a raw full shard).

Guard it: add a per-file duration budget check (the vitest cache already
records per-file durations) so the lane list and the split discipline cannot
silently rot again. `warlock_sustain_balance` (359s), `druid_balance_probe`
(291s), and `chronomancy_balance` (210s) are the next splits or lane
additions, in that order (5.3).

### 8.2 Quick fallback while the splits land: route high-fanout PRs to full

Full-minus-lanes mode is the proven faster shape for sim-deep PRs today
(14.5 vs 20 min), because it lane-excludes the giants. The planner cannot
know the related set's size in advance (vitest computes it), but it can see
the changed SOURCES: a diff touching high-fanout roots (`src/sim/` non-content,
`src/ui/hud.ts`, `src/net/online.ts`, `src/world_api/`) reliably produces a
related set of 60 to 90 percent of the graph (chronomancy: 1634 of 1904 =
86%, summed from the shard logs; map: about 1256 = 66%, inferred from 157 x
8). Add a fanout-based mode decision that
fails toward full. Only ever runs more tests; pin it in
`tests/ci_test_select.test.ts`. Worth about 5.5 min on sim-deep PRs, days of
work, and it becomes mostly moot once 8.1 lands.

### 8.3 Merge the floor and related legs into one invocation (real, but 1 to 3 min)

The historical blocker is real: `vitest related` is a subcommand, not a flag,
so it cannot be combined with an explicit file list (recorded in
`scripts/lib/gate_select_plan.mjs`). But vitest 4.1.10's
`filterTestsBySource` seeds the affected set with the related paths
themselves (`const affected = new Set(related)` before the reverse-graph
walk), so a TEST file passed as a positional selects itself. One invocation:

```
vitest related <changed sources> <floor test files> --run --shard=i/8 ...
```

runs floor-union-related in a single startup. The floor leg already passes
all ~790 floor paths as argv today, so argv size is precedented. Keep
`--passWithNoTests` (already present; vitest hard-throws when shard count
exceeds the spec count otherwise), run `node scripts/pretest.mjs` explicitly
since the npm `pretest` hook no longer fires, and pin a floor file with zero
relation to the diff still running in the merged leg
(`tests/ci_shard_plan.test.ts`). Saves the floor leg wall plus one vitest
startup: roughly 1 to 3 min per PR, most visible on typical PRs. It does NOT
fix the giant-file wall (5.5).

### 8.4 Slim the checkout (25 to 40s per job, 10 jobs)

`actions/checkout` with the `sparse-checkout` input automatically fetches
blobless (`filter: blob:none` is applied when sparse-checkout is set; no
separate filter needed), so a sparse cone genuinely avoids downloading the
794 MB of screenshots, and the repo already does exactly this in the
`changes` and `release-version-gate` jobs. **But do not drop
`docs/screenshots` wholesale:** 9 always-run floor suites read files under it
(item_art_screenshot_evidence, eastbrook_town_evidence, eastbrook_town_assets,
eastbrook_polish_artifact_integrity, eastbrook_mailbox_asset,
eastbrook_noticeboard_asset, eastbrook_grand_armoury_capture,
fenbridge_town_assets, fenbridge_town_capture). The cone must include the
evidence subtrees those suites read, or those fixtures move first. Keep
`public/` (asset fingerprint tests and builds read it). A blobless clone
lazily fetches any blob a test actually reads, so a missed path degrades to
slow, not red. Longer term, `docs/screenshots` on Git LFS with the checkout
default `lfs: false` removes the sparse-list maintenance, at the cost of LFS
quotas and a history rewrite.

### 8.5 Smaller items, in honest order

- **Skip pretest on CI shards (~30s/job, ~5 runner-min/PR).** This reverses
  a written BY DESIGN ruling in two places (`ci.yml`, `docs/qa-gate.md`):
  shards regenerate so selected suites always assert over fresh artifacts
  regardless of which shard they hash into. If pursued, it needs the ruling
  updated, not just the env var set. Low priority.
- **Treat SFX / wiki / asset manifests like i18n artifacts** (freshness-diff
  proof, feed to related, stop forcing full). Only after 8.1 or 8.3: today
  full mode is the FASTER shape for exactly these PRs (4.3), so declassifying
  them alone makes content PRs slower, the bug this brief exists to prevent.
- **Feed one generated locale to related instead of all 24.** Coverage-
  equivalent, ~0 wall. Housekeeping, not a time win.
- **Floor shrink** (534 partial files include false friends). High care,
  silent-skip failure mode, tens of seconds. Do last, if at all.
- **maxWorkers=3 trial** (see cost stack item 3): one measured shard run.
  The standing rule (no worker raise without a measured green run) stays.

### 8.6 Do not do these for CI speed

- Replace the i18n system with a library (6.3).
- Raise shard workers without a measured run (the 4-worker trial regressed).
- Make the merge queue selective; the queue is the last full proof.
- Add a 16-shard matrix on the current pool.
- **Lane-split `release-gate`.** The first pass listed this as a free ~9-min
  win; it is actually a documented ruling reversal
  (`scripts/lib/ci_shard_plan.mjs`: the post-merge backstop deliberately does
  not depend on the selection machinery), and it changes the lane-cache
  seeding arithmetic recorded in `ci.yml`. 8.1 gets most of the same minutes
  without touching the backstop.
- **Filter lane files out of the related leg without moving their coverage**
  (5.2). That opens a real gap, not a theoretical one.
- **Tune merge-queue group sizes to save CI.** GitHub's docs are explicit
  that merge limits do not combine merge_group builds; N queued PRs are N
  builds. Group-size settings batch the MERGE, not the CI.

### 8.7 Cost-balanced sequencers: already tried

LPT and stripe sequencers were built (`scripts/ci_balanced_sequencer.mjs`),
measured, missed the balance bar, and deliberately left unwired (recorded in
`vite.config.ts`; `passWithNoTests: false` guards a future re-wire). The
sha1-contiguous draw is a settled decision. After 8.1 the imbalance they
targeted mostly disappears; revisit only with new measurements.

---

## 9. The queue and the concurrency cap (ops, not code)

Three findings from the run API and the live rulesets, all outside the
codebase:

1. **The merge queue is dormant.** The `green-tip: merge queue` ruleset
   (20533398) still includes only `refs/heads/release/v0.35.0`; the newest
   merge_group run is from Aug 7. The mint-time include update did not happen
   for v0.36 through v0.38, so current PRs merge with no queue leg (and
   without the green-tip protection the queue was built to provide). The
   companion `green-tip: required checks` ruleset (20533396) correctly
   targets `release/**`. Separately, the runbook's step of adding
   `refs/heads/main` to both rulesets was gated on the next release-to-main
   merge, which has now happened (v0.37.1). Both are GitHub settings changes
   for the maintainer. Re-arming the queue re-adds a full run per merge
   (~10 to 15 min post-8.1); that is the documented safety trade, not a bug.
2. **The 39-minute day was the account's own concurrency cap.** On Aug 7,
   across 429 measured job intervals, concurrent jobs pinned at exactly 19 to
   20 for about an hour while roughly twelve runs at ~13 jobs each were in
   flight; shard execution itself stayed at 5.8 to 9.2 min. 20 is precisely
   the Free-plan limit for standard GitHub-hosted runners (Free 20 / Team 60
   / Enterprise 500, per account, public repos included; "free minutes" on
   public repos is a billing statement, not a concurrency exemption). On Aug
   13 concurrency reached 30, so the cap has since moved; queue delays on
   today's PR runs were 8 to 20 seconds. Actions for the maintainer: read
   the org plan off the billing page, and note GitHub Support can raise the
   limit on request. If the queue is re-armed, its "build concurrency"
   setting is the supported throttle so speculative queue builds cannot
   starve PR runs.
3. **Runner facts, verified against the docs:** public-repo `ubuntu-latest`
   is 4 vCPU / 16 GB (private would be 2 vCPU, which would halve workers).
   `ubuntu-24.04-arm` is free for public repos at the same size on a separate
   capacity pool; a viable pressure valve if queueing returns, gated on the
   native-dependency story (sharp, ffmpeg-static) being arm64-clean.

"About 30 minutes a PR" was therefore three different things stacked: a real
15-to-24-minute PR gate, an Aug 7 queue leg that no longer runs, and
cap-induced queue waits that no longer bind. The PR gate is the part software
changes can move.

---

## 10. Revised estimates

Runner noise is about 1.6x fast-to-slow on the same commit (recorded samples
527s / 739s / 842s for the harness; `ci.yml` notes they are not controlled
against each other). Treat every number as +/- 2 to 3 min.

| Surface | Today (verified) | 8.2 fallback only | + 8.1 splits | + 8.3 merged leg + 8.4 checkout |
|---|---|---|---|---|
| Sim-deep selective PR | ~20 min | ~14.5 | **12 to 14** | **10 to 12** |
| Typical PR (median) | ~16 min | ~16 | 13 to 15 | **11 to 13** |
| Content PR forced full | ~14.5 min | ~14.5 | **10 to 11** | 9 to 11 |
| Fast leaf PR | 6 to 7 min | same | same | 5 to 6 |
| Release-to-main | ~23 min | n/a | **15 to 17** | 14 to 16 |
| Merge queue | dormant | | if re-armed: one full run at the content-PR shape | |

What this does not promise: sub-8-minute substantive PRs (setup + ~2,690
files on 16 total workers has a floor around total-CPU/16 plus ~2 min of
setup), any effect from the 24-locale related tweak, or big wins from floor
shrink. The first pass's "8 to 10 minutes off slow PRs" lands in the same
place, but via 8.1, not via merge-legs, and its "typical PR" gain was
overstated by a few minutes.

---

## 11. Suggested implementation order

1. **Split the two harnesses** (8.1) and add the per-file duration budget
   guard. Pure test refactor; verify with `node scripts/gate_select.mjs` and
   one shadow run against a chronomancy-shaped diff.
2. **Fanout-to-full fallback** (8.2) if a quick win is wanted before or while
   1 lands; measured thresholds, fails toward full, pinned in
   `tests/ci_test_select.test.ts`.
3. **Second-tier splits or lane additions** (warlock_sustain, druid_probe,
   chronomancy_balance) guided by the new duration guard.
4. **Merged leg via related seeds** (8.3), with the unrelated-floor-file pin
   and an explicit pretest call.
5. **Sparse checkout** (8.4) with the 9 evidence-suite subtrees enumerated in
   the cone, pinned in `tests/ci_workflow.test.ts`.
6. Optional tail: manifest declassification (only after 3 or 4), pretest
   ruling revisit, maxWorkers=3 measured trial, floor shrink.
7. **Maintainer, GitHub settings:** decide whether to re-arm the merge queue
   (ruleset include update + the main include from the runbook), and confirm
   the org's concurrency tier.

Selection changes belong to `gate-integrity-reviewer` and the pins in
`tests/ci_workflow.test.ts`, `tests/ci_shard_plan.test.ts`,
`tests/ci_selection_pipeline.test.ts`. Failing toward more tests is the only
safe direction; note that 8.1 and 8.4 do not touch selection at all, which is
part of why they lead.

---

## 12. Open questions for the next pass

1. The post-split wall estimates assume the pieces scatter roughly evenly
   under the sha1 draw. Verify with one shadow run after the split; the
   release-gate and lane `timeout-minutes` were sized for the pre-split
   world and can likely be re-tightened afterward (maintainer call).
2. The related-seeds union (8.3) is verified against vitest 4.1.10 source
   but not yet against a live run; the pin test should prove a blind floor
   file (no src imports) is still selected when passed as a seed.
3. The 9 evidence suites' exact `docs/screenshots` subpaths need enumerating
   before the sparse cone is written; a floor-file grep is the check.
4. Whether lane SELECTION should learn to cover related lane files (making a
   lane-filtered related leg safe) is a real design alternative to 8.2; it
   trades planner complexity for keeping selective mode on sim PRs. Not
   needed if 8.1 lands.
5. The org's actual concurrency tier, and whether the Aug 13 max of 30 was
   a raised cap or just demand under a higher one.

---

## 13. Bottom line

PRs take 15 to 24 minutes because a handful of giant single test files
dominate whichever job runs them, and on selective sim-deep PRs that job is a
2-worker shard whose related leg is the only place those files run. The
translations pipeline costs about 7 seconds and is not on the critical path;
a translation library would move nothing. Split the harnesses (and police
single-file duration from then on), optionally route high-fanout PRs to the
already-faster full shape while that lands, then take the 1-to-3-minute leg
merge and the checkout slim. That is roughly: slow sim PRs 20 to ~11,
typical PRs 16 to ~12, content PRs 14.5 to ~10, release-to-main 23 to ~15.
The queue and the 39-minute days are a GitHub settings conversation, not a
code one: the queue is currently dormant with a stale ruleset include, and
the historic waits were the account's 20-job concurrency cap.

## 14. Program outcome (2026-08-14, written at close-out)

Every lever from section 8 shipped, in eleven phases over 2026-08-13/14, all merged
into release/v0.38.0: harness splits (#3370), second-tier splits + lane rebalance
(#3371), the declared-duration ratchet (#3375), the merged selective leg (#3378),
blobless sparse checkout (#3380), the 3-worker trial (#3383, verdict: keep half-cores,
measured at both neighbors), bounds re-derived from mode-labeled walls (#3384),
manifest freshness + declassification (#3386), the clean-scheme context rename
(#3387, merged through the re-armed queue as its drill), and the release-mint
tooling (#3388).

Measured before/after, per surface (before figures from section 7's baselines):

| Surface | Before | After |
|---|---|---|
| Sim-deep selective PR | 20.2 min (worst shard 19.8) | worst healthy selective shard 13.2 to 14.2 min post-split (16.55 pre-sparse kept as the bound base) |
| Full/content PR | 14.5 min (lanes 13.7/14.0) | ~11.5 min walls (shards 8.8 to 11.5, lanes ~10/12.5); manifest-regen PRs now selective instead of full |
| Typical PR median | 15.9 min | roughly 10 to 12 min on healthy runners |
| Job timeout bounds | pr-gate 40, lanes 30, release 35 | 37 / 28 / 36, each from a mode-and-tree-labeled measured wall |
| Queue critical path | 8 + 40 = 48 min | 8 + 37 = 45 min, welded to the bounds table by a pin |

Reliability shipped alongside the speed: the merge queue is re-armed on main +
release/v0.38.0 and drilled (it had been silently dormant since 2026-08-07 on a
stale ruleset include; scripts/release_mint.mjs now makes the mint settings step one
audited command); the anti-whale duration ratchet blocks the next 13-minute test
file; the three build manifests are freshness-proven on every code PR; the sparse
cone halves the checkout payload that scaled the stall tail; and every check context
carries a clean name with the ruleset flip executed zero-stranding through a
temporary legacy-names ruleset (20838951) that collapses at the next release-to-main
merge.

Recorded follow-ups, deliberately not taken here: the local gate still runs two
selective legs (note in scripts/lib/gate_select_plan.mjs); shard 4 dominates every
sampled selective run, so a sha1-pack rebalance could honestly lower the pr-gate
bound; release-gate re-derives again when a post-split release-to-main run produces
a completed wall.
