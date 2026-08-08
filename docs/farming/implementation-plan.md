# Farming: implementation plan (TOC + canonical workflow)

Farming is the fifth gathering profession: OSRS-style patch farming with offline
wall-clock growth, front-loaded tending, and an anti-chore contract. The design
authority is `docs/farming/state.md` (locked decisions D1 to D24). This file is the
table of contents, the canonical per-phase workflow, and the one canonical copy of the
Review Dispatch Matrix. Each phase is a self-contained session prompt in its own file.

## Phase index

| Phase | File | One line | Live surface after merge |
|---|---|---|---|
| 1 | `phase-01-foundation.md` | Register farming as the fifth gathering profession; sweep every silent-miss site; icon; pins; deliberate full golden regen | Farming row visible at 0 skill; nothing gainable |
| 1 QA | `phase-01-qa.md` | Verify Phase 1 | |
| 2 | `phase-02-patches-and-plots.md` | FARM_PATCHES content + farming_zones side table + placement guard suite + PlayerMeta/CharacterState plot state + IWorldFarming facet reads + the fplot self key | Dormant (no commands yet) |
| 2 QA | `phase-02-qa.md` | Verify Phase 2 | |
| 3 | `phase-03-growth-engine.md` | Plant and harvest commands, pre-rolled growth script, survival and yield resolution, gain schedule, updateFarming driver, draw-count contract, farming_session parity scenario | Dormant online (no seeds obtainable); testable via dev commands |
| 3 QA | `phase-03-qa.md` | Verify Phase 3 | |
| 4 | `phase-04-knobs.md` | Compost, farmer's watch (produce fee), growth tonic application, withered husks, husk-to-compost conversion | Dormant: knob items exist with no faucet until Phase 9 |
| 4 QA | `phase-04-qa.md` | Verify Phase 4 | |
| 5 | `phase-05-crops-and-tools.md` | The eight crops (seed + produce + fine twin), hoe ladder, seed faucets, the farming rollout arms in R37 | Dormant by choice: seeds deliberately unstocked until Phase 9 |
| 5 QA | `phase-05-qa.md` | Verify Phase 5 | |
| 6 | `phase-06-economy-hooks.md` | Cooking dishes (plain), the alchemy tonic recipe, recipe economy and market conformance | Dormant: recipes visible but inputs unobtainable |
| 6 QA | `phase-06-qa.md` | Verify Phase 6 | |
| 7 | `phase-07-render-and-juice.md` | Procedural swap-ready beds and crop growth stages, plant and harvest VFX, placeholder SFX | Beds visible in the four hubs, decorative until go-live |
| 7 QA | `phase-07-qa.md` | Verify Phase 7 | |
| 8 | `phase-08-harvest-journal.md` | The Harvest Journal window (view core + painter), map and minimap pins, live countdowns, the login and online ready notices | The timer surface exists; empty states until go-live |
| 8 QA | `phase-08-qa.md` | Verify Phase 8 | |
| 9 | `phase-09-world-presence.md` | The farmer NPCs (Jessica at Eastbrook), the intro quest and its objective arm, vendor stock, work orders, the deliberate NPC golden regen | GO-LIVE: the full loop opens with visuals and timers already shipped |
| 9 QA | `phase-09-qa.md` | Verify Phase 9 | |
| 10 | `phase-10-celebrations.md` | golden_harvest rare event, farming deeds and the farming-100 title | LIVE |
| 10 QA | `phase-10-qa.md` | Verify Phase 10 | |
| 11 | `phase-11-well-fed-food.md` | The wellfed ItemDef arm, buff dishes per tier, aura naming and tooltips | LIVE |
| 11 QA | `phase-11-qa.md` | Verify Phase 11 | |
| 12 | `phase-12-shared-feast.md` | The placeable tier-4 feast entity: charges, per-player ledger, expiry, interaction | LIVE |
| 12 QA | `phase-12-qa.md` | Verify Phase 12 | |
| 13 | `phase-13-integration-polish.md` | Wiki prose, screenshots, the asset handoff manifest in docs/design, whole-feature QA sweep | LIVE, complete |
| 13 QA | `phase-13-qa.md` | Final QA; offers packet teardown | |

Dormancy rule: a phase may merge with its surface dormant (players cannot reach it)
but never half-reachable. Each phase file's Live-surface note is binding; the QA twin
verifies it.

Ordering rationale: visuals (Phase 7) and the timer surface (Phase 8) deliberately
land BEFORE go-live (Phase 9), deviating from the usual polish-last ordering, because
farming must never ship blind (invisible beds) or timerless (the OSRS third-party
timer lesson). Go-live is the moment seeds reach vendors and the intro quest exists,
and by then the experience is already beautiful and legible.

## Canonical per-phase workflow

Every phase runs as a fresh Claude Code session on Opus 4.8 at xhigh effort (1m
context variant where the file load demands it; add `ultracode` to the starter prompt
for the batch-heavy phases where the file says so).

- Step 0, pre-flight: work in `~/Documents/woc-farming-plan` ONLY (the persistent
  farming worktree; other sessions share the main checkout). `git status` must be
  clean. Re-resolve the NEWEST `release/**` branch by version sort (`git branch -r
  --list 'origin/release/*' | sort -V`), fetch, and branch this phase off its tip
  (`fix/farming-phase-NN-<slug>` or `feature/...` per the change). If the branch is
  long-lived and release moved mid-phase, merge release in and run the
  release-merge-audit skill. Scan Claude Code memory (`MEMORY.md` index, the
  farming-skill-program entry, and any domain-matching entries).
- Step 1, load context: spawn an Explore agent to read and summarize
  `docs/farming/state.md`, `docs/farming/progress.md`, this phase's file, and the
  phase-listed source files plus the relevant `CLAUDE.md` files. The orchestrator does
  not read large docs or coordinator monoliths directly.
- Step 2, execute: pick the lightest orchestration (Explore for recon, parallel Agent
  fan-out for independent vertical slices capped at about 5, an `ultracode` Workflow
  past that). Request fan-out explicitly; give each agent only the Explore summary and
  its own slice. Each agent owns a complete vertical slice including its tests.
- Step 3, validate + review: run the state.md validation matrix rows the diff demands.
  Then check `git diff --name-only` against the phase-start commit and spawn ONLY the
  review agents whose Dispatch Matrix row matches. Prompt every review agent for
  COVERAGE, not filtering ("report every issue including low-severity and uncertain
  ones; ranking happens later"), give each a hard 30-tool-call budget and
  report-first instructions, and resume a truncated agent with: "Stop reading more
  files. Output the full report now based on what you have already seen. No more tool
  calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT." Do not commit until
  no BLOCKING remains.
- Step 4, docs + memory: update `docs/farming/progress.md` and `docs/farming/state.md`
  (ledgers, deviations, drift notes; sweep the QA twin whenever a phase file is
  amended). Record surprises in Claude Code memory. Commit docs with the
  implementation using EXPLICIT paths, never `git add -A`.
- Delivery: gate with `node scripts/gate_select.mjs` (deep check: `npm run gate`;
  the armory browser red is the standing environmental exception, PR CI is the
  arbiter), push, open the PR against the release branch the phase was based on,
  following `.github/PULL_REQUEST_TEMPLATE.md`. Visual phases attach before/after
  screenshots via the pr-screenshots skill. No Claude attribution or session links in
  commits or PR text.

## Review Dispatch Matrix (the one canonical copy; starter prompts reference it)

Match the change surface to the agent. Spawn an agent ONLY when its row matches the
diff:

| Agent | Spawn ONLY when the diff touches | Skip it for |
|-------|----------------------------------|-------------|
| `privacy-security-review` | `server/`, `src/admin/`, `src/net/`, a deploy/secret file, OR introduces SQL / auth / a secret / `ALLOW_DEV_COMMANDS` / a new `Math.random`, `Date.now`, or `performance.now` in `src/sim/` | a pure `src/ui` / `src/render` / `src/game` / `src/sim/content` / docs / test change |
| `migration-safety` | `server/db.ts`, `server/social_db.ts`, a `server/*_db.ts`, or a `characters.state` JSONB serialize/deserialize path | any diff with no DDL and no persisted-state shape change |
| `database-performance-reviewer` | SQL or a database call site, schema/indexes, query cadence or cardinality, pool/lock/timeout behavior, scheduled database work, or stored-data growth | any diff that cannot change database work or growth |
| `cross-platform-sync` | `src/world_api.ts` or `src/world_api/**`, `src/sim/` behavior/`SimEvent`s, `src/net/online.ts`, `server/game.ts` wire/dispatch, the matchers `src/ui/sim_i18n.ts` / `src/ui/server_i18n.ts`, or the RL surface | a pure i18n catalog refactor with `t()` keys unchanged |
| `architecture-reviewer` | a `src/sim/` change: determinism, rng draw order, tick-phase order, the `SimContext` seam, or a relocation | a non-sim change, or a pure data/content/test change |
| `frontend-seam-reviewer` | `src/ui/`, `src/render/`, `src/game/`, or `src/styles/` | a diff with no frontend surface |
| `qa-checklist` | a phase / deliverable set is COMPLETE | per-commit or mid-phase work, or a docs/test-only change |

If NO row matches (docs-only, test-only, comments), spawn NO review agent. Do not
default to running `privacy-security-review` anyway.

## Agent scaling

The starter prompts suggest a default split; assess the real workload and scale.
Split when a single agent would own four or more independent concerns or ten or more
deliverables; merge when one side is one or two trivial changes; dedicated test agents
only for genuinely complex multi-suite coverage; past about five parallel agents,
write an `ultracode` Workflow (pipeline plus adversarial verify) instead of
hand-spawning. Split by domain (a slice plus its tests), never by file type. Use
`isolation: "worktree"` only when agents mutate overlapping files in parallel.

## Code hygiene (every phase)

Module-first behind existing seams; never grow a coordinator. Every new system,
command, IWorld member, endpoint, and behavior gets tests, including a same-seed
determinism pin for sim logic. Fix bugs test-first. Update or remove tests you break;
no orphaned tests, no dead code, no unused imports, no commented-out code, no
hand-edits to generated files (regenerate via the owning build step). The sim import
invariant holds: `src/sim/` imports nothing from render, ui, game, or net, and has no
DOM or Three imports.

## Persistence phases

Farming's persisted state is JSONB character state only (no DDL is planned). Any
phase that touches the save shape: fields are OPTIONAL with defaults so pre-farming
saves load cleanly; add a save-then-load round-trip test; loading must clamp and
sanitize (the `normalizeGatheringProficiency` pattern). If a phase ever does need
DDL, it is additive and idempotent (`IF NOT EXISTS`) in the inline schema, with
`migration-safety` dispatched.

## Mobile and performance (every client phase)

Touch controls and safe areas respected; verify with the mobile screenshot scripts
against a phone viewport. Comfortable tap targets; no hover-only information. Sim work
stays inside the 20 Hz budget with no per-tick allocation in hot paths; snapshots stay
interest-scoped and delta-guarded; per-frame painters are write-elided and sorted by
`tests/hud_perf_budget.test.ts`. Graphics settings stay gameplay-neutral: the Harvest
Journal timers and ready notices are actionable information and may never be shed by a
tier knob.

## Deploys

No phase deploys. Deploy is a deliberate separate step per `DEPLOY.md`, gated on a
green `npm run gate` (release-tier on a `release/**` branch) and never with
`ALLOW_DEV_COMMANDS=1`.

## Packet teardown

The final QA phase, once everything is green, surfaces every deferred item and then
asks explicitly: "All phases are complete and green. OK to delete `docs/farming/`
(the planning scaffolding) before the PR?" Delete only on explicit confirmation, only
that directory, with explicit paths. The asset handoff manifest lives in
`docs/design/farming-asset-manifest.json` precisely so it survives this teardown.
