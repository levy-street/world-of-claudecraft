# Professions 2.0: implementation plan

The canonical workflow and phase index. Each phase is a fresh Claude Code
session running its own starter prompt from `phase-NN-*.md`; each is followed
by its QA session (`phase-NN-qa.md`). Locked decisions live in `state.md`;
the vision lives in `brainstorm.md`.

## Team workflow (every phase)

Every phase runs on **Opus 4.8 at xhigh effort** (1m context variant where the
file load demands it; add `ultracode` where the phase file says so, for
Workflow-orchestrated batch or verify-heavy work).

1. **Step 0, pre-flight:** `git status` clean (a concurrent session may share
   the checkout); scan Claude Code memory (`MEMORY.md` index) for entries
   matching the phase domain (professions, design language, gate/Node quirks,
   PR 2039). Then **sync with the LATEST release branch**: fetch
   `refs/heads/release/*`, pick the newest by version sort (`git branch -r
   --list "origin/release/*" | sort -V | tail -1`; today that is
   release/v0.27.0, tomorrow v0.28.0 and onward), base fresh branches on it,
   and merge it into any existing feature branch at session start, running the
   `release-merge-audit` skill on every such merge. The packet never falls
   behind the active integration base.
2. **Step 1, load context:** spawn an Explore agent to read and summarize
   `state.md`, `progress.md`, this phase's file, and the phase-relevant source
   and CLAUDE.md files. The main session does NOT read planning docs or
   coordinator monoliths directly.
3. **Step 2, choose orchestration and execute:** lightest tool that fits;
   request fan-out explicitly; give agents only the Explore summary. Worktree
   isolation only when agents edit overlapping files in parallel.
4. **Step 3, validation and review dispatch:** run the validation matrix rows
   from `state.md` for the change type, then spawn ONLY the review agents
   whose row matches the diff (matrix below). Prompt every review agent for
   COVERAGE, not filtering. No commit while any BLOCKING finding stands.
5. **Step 4, docs and memory:** update `progress.md` and `state.md`; record
   surprises to memory; commit with explicit paths (never `git add -A`),
   Conventional Commits with a body, no em dashes or emojis.

### Review dispatch matrix (the one canonical copy)

| Agent | Spawn ONLY when the diff touches | Skip it for |
|-------|----------------------------------|-------------|
| `privacy-security-review` | `server/`, `src/admin/`, `src/net/`, a deploy/secret file, OR introduces SQL / auth / a secret / `ALLOW_DEV_COMMANDS` / a new `Math.random`\|`Date.now`\|`performance.now` in `src/sim/` | a pure `src/ui` / `src/render` / `src/game` / `src/sim/content` / docs / test change |
| `migration-safety` | `server/db.ts`, `server/social_db.ts`, a `server/*_db.ts`, or a `characters.state` JSONB serialize/deserialize path | any diff with no DDL and no persisted-state shape change |
| `database-performance-reviewer` | SQL or a database call site, schema/indexes, query cadence or cardinality, pool/lock/timeout behavior, scheduled database work, a database driver or Postgres engine/config change, or stored-data growth | any diff that cannot change database work or growth |
| `cross-platform-sync` | `src/world_api.ts` or `src/world_api/**`, `src/sim/` behavior/obs/`SimEvent`, `src/net/online.ts`, `server/game.ts` wire/dispatch, the matchers `src/ui/sim_i18n.ts`\|`src/ui/server_i18n.ts`, or the RL surface (`headless/`, `python/`) | a pure i18n catalog refactor with `t()` keys unchanged |
| `architecture-reviewer` | a `src/sim/` change: determinism, rng draw-order, tick-phase order, the `SimContext` seam, or a move-not-rewrite relocation | a non-sim change, or a pure data/content/test change |
| `frontend-seam-reviewer` | `src/ui/`, `src/render/`, `src/game/`, or `src/styles/` | a diff with no frontend surface |
| `qa-checklist` | a phase / deliverable set is COMPLETE | per-commit / mid-phase work, or a docs/test-only change |

If NO row matches, spawn NO review agent.

### Code hygiene (every phase)

- Module-first behind existing seams; never grow `sim.ts`, `hud.ts`,
  `renderer.ts`, or `main.ts`; fix bugs test-first (`extract-and-test` skill).
- Every new system, command, `IWorld` member, endpoint, and behavior gets
  tests; determinism tests for new sim logic; re-pin deliberately when
  changing pinned behavior; delete dead code and orphaned tests in the same
  change.
- `src/sim/` purity: no DOM/Three imports, no render/ui/game/net imports, all
  randomness through `Rng`.
- No hand-edits to generated files; regenerate via the owning build step.

### Design-language guardrails (every UI phase; from the 2026-07-16 recon)

DESIGN.md is the adopted standard but ZERO of its six rollout phases have
landed. Therefore every UI phase in this packet:

- Builds on TODAY'S tokens (`src/styles/tokens.css`) and the shared window
  shell (`.window.panel`, drag/resize/focus/closeAll/z-band), grammar-ready
  for the future DESIGN.md phase 5 restyle.
- MUST NOT introduce DESIGN.md phase vocabulary (new ramp/radius/duration
  tokens, retuned gold-edge recipe, font flips, self-hosted fonts, window
  grammar fragments): that is a PR-blocking piecemeal re-land (DESIGN.md 14,
  `src/styles/CLAUDE.md` dead-ends note). This guardrail is CONDITIONAL on the
  design-language program's rollout state: each UI phase checks at session
  start whether DESIGN.md phases have landed (does `src/styles/tokens.css`
  carry the ink/gold ramps and `--radius-window`? has `src/styles/CLAUDE.md`
  been updated to point at DESIGN.md?). Once a DESIGN.md phase HAS landed, its
  vocabulary is the baseline and new work consumes it. The maintainer intends
  the professions windows to be the first feature under the new design system,
  so the ideal sequencing is DESIGN.md phase 1 (tokens/theme/type) landing
  before packet Phase 5; either way, building grammar-ready means the windows
  inherit the restyle automatically.
- Zero hex literals outside `tokens.css`/`theme.ts`; themed-vs-static token
  split respected (preset-aware jobs go through `theme.ts` knobs); focus via
  the `--color-border-focus` outline mechanism only.
- New window body CSS lands as a ten-dash banner section in `components.css`
  inside `@layer components`; every new `.window` id gets a deliberate
  `body.mobile-touch` rule in `hud.mobile.css` (or a reasoned
  `MOBILE_WINDOW_EXCEPTIONS` entry); `left` re-pins re-declare `transform`;
  40px mobile tap floor; 16px input font floor.
- Every player string is a `t()` key (English only; M16 wordy strings carry
  five non-Latin fills); entity names via `tEntity`; keycaps via `keyLabel`.
- Every visual phase ships before/after screenshots (desktop AND mobile,
  `pr-screenshots` skill) committed under `docs/screenshots`.

## Phase summary

Phases 1 to 7 are the fun kernel; 8 to 15 are wave one. End of Phase 7 is
the vertical-slice checkpoint (see README). Phase 6 depends on Phases 2 and
4, not on Phase 5, and may run ahead of the wheel window if the
design-language rollout stalls Phase 5. The 2026-07-17 design-review
amendments in state.md bind their owning phases below. PR 2039 (open at
packet creation; 104 files; adds `craftingIdentity`/`cprof`, the shared
`combo_eligibility` rule with attunement-gated combos, `attunedPairs`
pair-level history, craft/gather quest objectives, quest-driven attunement
with selection, and an identity card view) merges as the foundation inside
Phase 1.

| # | Phase | One line | Primary surfaces |
|---|---|---|---|
| 1 | Ring and identity foundations | Merge-window amendments on PR 2039: adopt the blueprint ring, pair-named archetype titles, the 5 review items | sim content, i18n, tests |
| 2 | Masterwork model | Deterministic outputs + masterwork proc with stats via `item_budget`; retire the five-way roll and `trivialAt` | sim, wire event, tests |
| 3 | Host-parity bug fixes | Trade instance carriage; corpse claims on the wire | sim, net, server, tests |
| 4 | Node materials and pristine veins | Real per-rarity node yields, signed rare+ yields, per-node-type rare events, gather feedback | sim content, ui, render |
| 5 | The professions wheel window | The flagship window at deeds quality on the deeds recipe | ui, styles, i18n |
| 6 | Crafting window upgrades and celebrations | Skill display, combo/station legibility, masterwork toast + zone broadcast, tier-up toasts, maker's mark tooltips, inspectable instances | ui, i18n, net, sim |
| 7 | The Guild letter | Trend detection, the letter via mail, the first-attunement hook; S3 scanner gap closed | sim, content, tests |
| 8 | Stations and masters (sim/server) | Typed station registry, masters across the three zone hubs, placement-safety test, specialization-gated mobile station | sim, content, server |
| 9 | Station presence and training | Station props + masters rendered, skill-tier-gated training with a visible locked-row ladder, shops, hands-vs-stations live | render, ui, content |
| 10 | Recipe ladders and materials (ultracode) | Six deep crafts' tier ladders + material families + economy invariant tests + the materialTierBonus wire | content, sim, tests |
| 11 | Fishing joins the framework | Fishing proficiency + catch rarity ladder feeding cooking | sim, content, ui |
| 12 | Base tool tier gating | Node tiers; tool tier + skill gates; tools matter; effects stay parked | sim, content, tests |
| 13 | Enchanting reachable | Disenchant, enchant-apply, and salvage on IWorld/wire/UI in both hosts | world_api, net, server, ui |
| 14 | Attunement quests and nudges | Lore quests, work orders, and tier mail at the masters; nudges; celebration | content, sim, ui |
| 15 | Deeds, tuning, and polish | Universal profession deeds, economy tuning, wiki rewrite, final gate | content, docs, tests |

Wave 2+ (NOT this packet, tracked on epic #1866): market/mail instance
carriage (#1146), commissions and boundTo (#1298), Jack of All Trades
(#1296), monster-harvest proficiency, battlefield experience expansion,
item biographies, tool effects, jewelcrafting/inscription depth. (Salvage
wiring left this list on 2026-07-17; it joins Phase 13.)
