# Toolchain Modernization: consolidated research record

This is the master record of the investigation behind this packet. Everything below was
established on 2026-07-14 by multi-agent research workflows (repo analysis agents, web
research agents, an empirical compiler probe, and adversarial verifiers that independently
re-reproduced every load-bearing claim). Timings and version numbers are dated snapshots
from that day; stable facts cite repo paths, exported symbols, or primary-source URLs.

Related issue: levy-street/world-of-claudecraft#1868 (TypeScript 7 investigation). The
no-go posted there on 2026-07-14 is overturned by these findings; see Workstream A.

## Vision

Three workstreams, one goal: a clean, scalable contributor experience.

- A. Move the repo to TypeScript 7 (the native Go compiler): typecheck drops from roughly
  30 seconds to roughly 2 seconds everywhere tsc runs (gate, CI, pre-push, editors).
- B. Eliminate the per-PR merge-conflict tax on generated i18n artifacts: today nearly
  every pair of concurrent PRs conflicts on two committed metadata files and forces a
  manual regenerate-and-repush cycle.
- C. Cut the "PR gate (English-only legal)" CI job from roughly 11 minutes to under 4
  minutes wall time on free standard runners.

The workstreams interlock: the TS7 blocker fix (Workstream A) creates a new generated
artifact whose conflict policy comes from Workstream B's findings, and Workstream A
shrinks the typecheck step that Workstream C parallelizes.

## Workstream A: TypeScript 7

### Release status (verified against npm registry and official announcements, 2026-07-14)

- TypeScript 7.0 reached GA on 2026-07-08. typescript@7.0.2 is the first and only stable
  7.x (7.0.1-rc was the RC; TS convention skips X.Y.0/X.Y.1). npm dist-tags: latest
  7.0.2, next 7.1.0-dev nightlies. Source:
  https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- TS 7 is the native Go port (codename Corsa; the JS codebase is Strada). Claimed 8x to
  12x full-build speedups, validated pre-GA at Bloomberg, Canva, Figma, Google, Linear,
  Notion, Slack, Vercel, and others.
- TypeScript 6.0.3 is the final JS-based line and the official bridge: everything 7.0
  removed was deprecated in 6.0. Source:
  https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
- The npm package ships 20 per-platform Go binaries under optionalDependencies; the bin
  is still named tsc. With --omit=optional the bin exists but fails at runtime, so
  presence probes (file stat) pass on broken installs; probe by executing tsc --version.
- TS 7.0 ships NO stable programmatic API (root export is a version stub; real surfaces
  sit under explicitly unstable subpaths). The new API is expected in TS 7.1, roughly
  October 2026 per press coverage. Tools needing the old JS API must use the 6.x line.

### Blocker 1: baseUrl removed (trivial, fully verified)

TS 7 rejects the repo config with TS5102 (Option 'baseUrl' has been removed). The fix is
deleting the single baseUrl line in tsconfig.json. Verified complete: the one paths alias
(#bot-detector) already uses ./-relative entries that resolve without baseUrl; TS 5.9.3,
6.0.3, and 7.0.2 all parse the config cleanly after deletion; no import anywhere relies
on baseUrl's bare-specifier fallback (three grep sweeps: static, dynamic import(), and
require); tsconfig.admin.json needs nothing; the golden test tests/server/new_endpoint.test.ts
(whose scaffolded config extends the root tsconfig) passes all its tests without it.
Vite and esbuild implement the alias independently (vite.config.ts resolve.alias,
scripts/build_server.mjs alias option) and are unaffected.

### Blocker 2: TS2590, root-caused precisely

With baseUrl removed, TS 7.0.2 fails with TS2590 (Expression produces a union type that
is too complex to represent) in 7 files at default parallelism: src/editor/app.ts,
src/editor/asset_browser.ts, src/main.ts, src/ui/char_window.ts, src/ui/chat_channels.ts,
src/ui/discord_role_tag.ts, src/ui/item_armor_type.ts. Byte-identical on the 7.1 nightly.

Root cause, established by a controlled probe matrix and verified twice independently:

- TranslationKey (src/ui/i18n.catalog/index.ts, defined as Leaves over the composed en
  catalog at depth 6) normalizes to a union of 5,654 members: 5,569 string literals plus
  85 template-literal patterns. The catalog has 6,118 runtime leaves (the issue comment's
  ~13,900 figure does not match any measurable number).
- The 85 patterns come from exactly four Record over string or number subtrees: ability
  entities (src/ui/i18n.catalog/abilities.ts), item sets (index.ts), quest objectives and
  zone POIs (src/ui/world_entity_i18n.ts). The entity ID unions the issue blamed are
  small (82 mobs, 33 NPCs, 77 quests, 3 zones) and harmless.
- The trigger is the literal-times-pattern subsumption product during union
  normalization, at any expression that forms a new union containing TranslationKey
  (ternaries yielding key or null/undefined). Pure-literal unions far larger pass fine.
- The mechanism is type ordering, not a smaller Go budget. The complexity budget is
  identical and hard-coded in both compilers (100k relationship checks, then error when
  the work estimate exceeds 1M; constants confirmed in typescript-go internal/checker
  source). Decisive experiments on this repo: TS 6.0.3 (the JS checker) with the
  stableTypeOrdering flag errors on 3 of the same files; TS 7.0.2 with --checkers 1
  errors on exactly those 3; --checkers 8 errors on 8 files, exactly reproducing the
  issue comment's count (their machine evidently ran 8 checkers). The error set is
  parallelism-sensitive by documented design.
- Waiting for upstream is not a strategy: a --generateTrace run measured this repo's work
  estimate at roughly 31.4 million against the 1 million cap (31x over, not marginal);
  there is no flag to raise the budget; stableTypeOrdering cannot be turned off in 7;
  ordering-induced TS2590 reports are closed not-planned (microsoft/typescript-go issues
  1100 and 2830), the still-open budget-adjacent reports get restructure-downstream
  guidance from maintainers (issue 4528, an OOM-loop report on the same Type Ordering
  family), and the exact TS2590 analog (issue 4631, filed 2026-07-14) is unanswered.

### The fix: a generated flat TranslationKey union (verified end to end, twice)

Replace the type-level computation with a build-generated flat union: a generated .ts
file containing the real dotted keys (the build already computes this exact flatten:
scripts/i18n_build.mjs executes the catalog through scripts/i18n_flatten.mjs), and a
one-line swap in src/ui/i18n.catalog/index.ts re-exporting it. Two agents independently
built this from scratch on isolated copies with identical results:

| Configuration | Result | Wall time (2026-07-14, dev laptop) |
|---|---|---|
| TS 5.9.3, status quo | clean | 26 to 35s (run-to-run variance) |
| TS 7.0.2, status quo | TS5102, then 7x TS2590 | fails |
| TS 5.9.3 with flat union | clean, zero new errors | ~12s |
| TS 7.0.2 with flat union + baseUrl removed | clean, zero new errors | ~1.8s |
| svelte-check on the swapped copy | 0 errors, 0 warnings | unchanged |

Soundness, adversarially checked:
- Strictly stronger checking, proven both directions: a bogus entity key compiles today
  (silently matched by a pattern member) and fails under the flat union; all flat
  literals are assignable to the old union so nothing legal is lost. The overlay header
  comment in src/ui/i18n.locales/es.ts concedes today's pattern leak; the flat union
  closes it at compile time, making tests/i18n_overlay_key_membership.test.ts redundant.
- The only Leaves instantiation in the entire repo is the TranslationKey line itself;
  the re-export in src/ui/i18n.ts has zero importers, so nothing re-triggers the
  computation.
- All dynamic key construction goes through as-TranslationKey casts, which remain valid
  against a literal union; the full-repo runs confirmed zero new errors everywhere.
- The admin scope is decoupled (src/admin never imports the game catalog) and passes TS7
  clean without any workaround.

### Ecosystem (exactly this repo's toolchain)

Exactly one tool consumes the TypeScript JS API: svelte-check (for src/admin, via
svelte2tsx and the language server). Verified empirically against this repo's admin SPA
(note: the verification harness resolved svelte-check 4.7.2, npm's newest, while the
repo lockfile pins 4.7.1 under the ^4.6.0 spec; Phase 5 either bumps to the verified
version or re-verifies on 4.7.1):
- Bare typescript@7 as node_modules/typescript hard-crashes svelte-check 4.7.2 on load
  (upstream: sveltejs/language-tools issue 3063, open).
- The officially documented dual-alias layout works: devDependencies
  "typescript": "npm:@typescript/typescript6@^6.0.2" plus
  "@typescript/native": "npm:typescript@^7.0.2". svelte-check passes (331 files, 0
  errors) and node_modules/.bin/tsc deterministically resolves to the TS7 Go binary
  (the typescript6 wrapper ships only a tsc6 bin, no collision). This is the pattern the
  TypeScript GA post documents verbatim; Nx and Next.js recommend the same.
- Provably indifferent to the installed typescript version: Vite 8 (Oxc transpile), 
  esbuild, tsx, Vitest 4 (no typescript dependency; typecheck mode unused here), Biome
  (own Rust checker), @types/node. Zero first-party imports of the typescript package.
- svelte-check 4.7.0+ has experimental native flags (--tsgo) but they require
  @typescript/native-preview, which is slated for discontinuation post-GA; do not build
  on them yet.

Re-evaluation triggers for dropping the dual alias: the TS 7.1 stable API,
sveltejs/language-tools issue 3063, and svelte-check releases after 4.7.2.

### Issue #1868 corrections (for the record)

The investigation comment's no-go is overturned. Corrections: 7 failing files at default
parallelism, not 8 (8 reproduces with --checkers 8); the catalog is ~6,100 leaves, not
~13,900; the quoted 0.46s TS7 timing was the TS5102 config-error bail, not a completed
typecheck (honest speedup is roughly 9x to 15x); the root cause is the
literal-times-pattern subsumption product, not the entity-ID unions; and the correct
workaround (generated flat union) strengthens static checking rather than weakening it
(the widening workaround the comment rejected was indeed bad, and also would not have
fixed the error).

## Workstream B: i18n generated-artifact merge conflicts

### The empirical distinction: aggregates versus line-item artifacts

Merge experiments in an isolated worktree (two branches each adding a key, regenerating
per the contributor workflow, then merging) proved:

- Different catalog domains: only src/ui/i18n.resolved.sha256 and
  src/ui/i18n.status.summary.json conflict. Every generated line-item file (the
  per-locale slices plus en_XA and pending) auto-merges, and a post-merge regeneration
  changes zero bytes (the textual merge is byte-perfect).
- Same domain, distant insertion points: same result.
- Same insertion point: the catalog source itself conflicts (a genuine conflict a human
  should see) plus its generated-file amplifications across the whole directory, all
  mechanically resolvable.
- The summary.json counts can also auto-merge to a silently wrong value (identical
  deltas on both sides), so a committed counts file is stale-or-conflicted under ANY
  concurrent key adds.

The load-bearing rule extracted: the two pain files are GLOBAL AGGREGATES of the whole
key universe (a hash line, counters). For two concurrent key-adding PRs the correct
merged value is a third value neither parent carries, so textual merge can never be
right. Line-item artifacts (the locale slices, pending.ts, and the future TranslationKey
union) merge cleanly and correctly. 90-day churn confirms: sha256 touched by 757 of
5,268 commits, summary.json 733, while the en slice (655 touches) merges fine.

### Consumer map (what must change when the two files stop being committed)

- src/ui/i18n.resolved.sha256: written ONLY by the manual scripts/i18n_resolved_hash.mjs
  --write (invoked as npm run i18n:hash -- --write; the bare npm script is print-only);
  NOT rewritten by i18n:gen, which is a documented trap
  (.claude/skills/release-merge-audit/SKILL.md) that has reddened the gate repeatedly.
  Only automated enforcement: the baseline block in tests/i18n_resolved_equivalence.test.ts.
  Not in the CI freshness diff, not in gate.mjs I18N_ARTIFACTS, no runtime consumer.
  Verdict: delete outright; it is redundant (the committed slices plus the CI freshness
  diff plus the determinism tests carry its entire guarantee).
- src/ui/i18n.status.summary.json: written by scripts/i18n_scan.mjs alongside the
  gitignored full registry; regenerated by i18n:gen, pretest, and build. Consumers: the
  tracked-and-fresh test block in tests/i18n_status_registry.test.ts (the cross-check and
  determinism blocks survive, since pretest regenerates the file before tests read it),
  the CI freshness diff in both ci.yml jobs, gate.mjs I18N_ARTIFACTS, a biome.json
  exclusion. No runtime consumer. Verdict: gitignore; keep generating it.
- The committed dense slices (src/ui/i18n.resolved.generated/) stay committed: they are a
  hard module-resolution dependency of every entry importing src/ui/i18n.ts (npm run dev
  is bare vite with no generation hook; bare vitest single-file runs; tsc; IDEs; the
  new_endpoint golden test), and PR reviewability of locale fills was a deliberate
  maintainer decision.

### Decisions this reopens (owner approved 2026-07-14)

docs/i18n-scaling/lazy-locales-and-contributor-workflow.md closed two decisions this
work reopens: shipping the committed summary as the audit trail, and the SHA baseline as
the determinism anchor. The owner approved proceeding on 2026-07-14 (this session),
with the audit trail replaced out-of-band: a CI step posting the scan counts to the job
summary, plus optionally a sticky PR comment (the repo already has
scripts/gh_sticky_comment.mjs for that pattern).

### Alternatives eliminated (with sources)

- Custom .gitattributes merge drivers: GitHub's server-side merge machinery does not
  honor user-defined merge attributes (custom drivers or merge=union), so the PR
  conflicts banner stays; drivers are also defined in git config, never shippable
  in-repo. Sources: https://github.com/orgs/community/discussions/9288,
  https://git-scm.com/docs/gitattributes
- merge=union would corrupt a single-line hash file (keeps both lines).
- Merge queue: ejects conflicted PRs; cannot run a regenerate-and-commit step.
- Regen-push bots (autofix.ci pattern): work, but every push that changes the diff
  dismisses approvals (diff-state based, no actor exemption), so they automate the
  annoyance rather than removing it.
- linguist-generated: cosmetic only (collapsed diffs); no effect on merges. The new
  union file should still carry it.
- Live probe finding: the repo currently has NO branch protection or rulesets enforcing
  required reviews or stale-approval dismissal (gh api, 2026-07-14); the re-approval
  step is process-level. The conflict fix stands regardless.

### One-time migration hazard

Deleting files that nearly every open PR touches produces one final modify/delete
conflict per open PR (git cannot auto-resolve modify/delete). Land the degit PR at a
release-branch cut, with an announced resolution rule: take the deletion, run
npm run i18n:gen.

## Workstream C: the PR gate

### Measured reality (medians over 10 successful runs, 2026-07-14)

The job named "PR gate (English-only legal)" costs ~658s. The i18n steps its name
suggests are trivial (i18n:gen 4s, freshness diff under 1s). The real costs: the vitest
step at 502s median (76 percent; roughly 1,100 test files on the sampled run, a dated
snapshot Phase 4 re-derives fresh; pretest ~5s inside it) and the Typecheck step at
66.5s median. The Typecheck internal split (tsc ~71s, svelte-check ~6s) comes from ONE
sampled run that was slower than the 10-run median, which is why its parts exceed
66.5s; treat the split as proportions, not absolutes. npm ci 15.5s, apt FFmpeg install
22s, malware gate 4s, builds ~10s. Parallel jobs (lint ~80s, browser ~80s) are off the
critical path. CI volume is high: 100 or more runs per day.

Slowest test files (from CI logs): tests/vale_cup.test.ts 58.5s,
tests/sfx_studio_server_security.test.ts 42.2s, tests/sfx_export_bundle.test.ts 30.8s,
tests/parity/parity.test.ts 21.9s, tests/localization_coverage.test.ts 15.6s. Top 20
files hold 324s of the 599s aggregate.

### The redesign

1. Shard the vitest step across a 4-job matrix using npm test -- --shard=i/4 (NOT bare
   vitest: pretest must run per shard so the S3 guard, guide freshness, and the
   git-subprocess suites pass). Sharding is safe: trivial global setup (temp dir), no
   setupFiles, no CI coverage, per-file fork isolation. Modeled worst shard ~159s plus
   ~41 to 62s fixed overhead per shard. Caveat: vitest's sha1-based shard assignment
   currently co-locates the three heaviest files for every N in 2..6; splitting
   tests/vale_cup.test.ts flattens the worst shard.
2. Move typecheck, the three builds, the freshness diff, and the malware gate into a
   parallel checks job (they do not depend on test results; they serialize ~90s onto the
   critical path today). Must preserve the merge-ref checkout property (the freshness
   diff runs against the PR merge result, which is what catches stale-but-cleanly-merged
   artifacts).
3. Replace the 22s apt FFmpeg install. PATH ffmpeg is needed by exactly the three
   sfx_studio suites (scripts/sfx_studio/audio_io.mjs and export_bundle.mjs hardcode
   PATH names); scripts/sfx_conform.mjs already uses the ffmpeg-static/ffprobe-static
   npm packages directly (devDependencies with allowlisted install scripts; a
   scripts-skipped install leaves the binaries missing, so always verify by execution).
   Preferred fix: repoint the two hardcoded spawns at ffmpeg-static with a PATH
   fallback (also fixes ffmpeg-less dev machines and can retire the gate.mjs
   preflight). Go/no-go check first: the studio suites assert loudness math (ebur128,
   loudnorm) that could shift across ffmpeg builds.
4. TS7 (Workstream A) later shrinks the checks job's typecheck to ~13 to 16s.

Projected steady state: ~3.5 minutes wall, $0 incremental cost (public repo, free
standard runners).

### Pinned tests and sync contracts a CI redesign must update coordinately

- tests/ci_workflow.test.ts: requires a job literally id'd pr-gate containing its three
  if-expression fragments and NOT containing the string I18N_RELEASE_TIER; requires
  exactly 2 occurrences of "run: npm run check:types" workflow-wide; forbids inline
  "npx tsc --noEmit" in ci.yml; pins the browser-gate install/test lines, the gate.mjs
  typecheck and browser entries, and the release-gate tier pins.
- tests/sfx_gate_preflight.test.ts: pins gate.mjs's PATH-ffmpeg preflight error text.
- ci.yml and scripts/gate.mjs carry keep-in-sync comments in both directions; gate.mjs
  stays serial locally, so the redesign must state what sync means post-shard.

### OPEN items

1. The vitest timing breakdown attributes a large "setup" aggregate (~351s across
   workers on the sampled run) despite zero setupFiles; explain it (vitest 4 reporter
   semantics vs per-fork prep) before finalizing the shard count. Phase 4 measures this
   first.
2. FFmpeg-static loudness go/no-go (Phase 3 first step; fallback is a CI-only symlink).
3. Timing of the Phase 1 merge (release-branch cut) plus the announcement of the
   take-the-deletion resolution rule: owner action.
4. Branch protection: none currently enforced (2026-07-14 probe); owner may want to
   confirm that is intentional. Nothing in this packet depends on it.
5. TS 7.1 API timing and svelte-check adoption (drop the dual alias when both land).
6. Whether a typescript 7.0.3+ patch exists at Phase 5 execution time: re-run the Phase
   2 probe against it first (the plan assumes 7.0.2 semantics).

## Primary sources

- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/
- https://github.com/microsoft/typescript-go (issues 1100, 2683, 2830, 3892, 4528, 4612, 4631; CHANGES.md)
- https://github.com/microsoft/TypeScript/issues/62207 (baseUrl removal rationale)
- https://github.com/sveltejs/language-tools/issues/3063 and pull 3036 (svelte-check vs TS7)
- https://www.npmjs.com/package/@typescript/typescript6
- https://vitest.dev/guide/improving-performance (sharding), https://vitest.dev/config/globalsetup
- https://docs.github.com/en/repositories/working-with-files/managing-files/customizing-how-changed-files-appear-on-github (linguist-generated)
- https://github.com/orgs/community/discussions/9288 (server-side merge attributes)
- https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request (stale-approval semantics)
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
- https://autofix.ci/ (regen-push prior art), https://docs.renovatebot.com/updating-rebasing/
- https://pnpm.io/git, https://doc.rust-lang.org/cargo/faq.html, https://github.com/rust-lang/cargo/pull/7070 (lockfile-conflict prior art)
