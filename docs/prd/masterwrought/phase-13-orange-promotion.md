# Phase 13: Orange promotion

### Starter Prompt
```
This is Phase 13 of the Masterwrought feature: the orange promotion, the legendary
capstone as process and prestige (R3).

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: not needed for this phase.

Goal: the final Perfecting rank consumes a Deed of Making and promotes the INSTANCE to
legendary presentation: player-chosen name (moderated server-side), crafter signature,
celebration, deed credit. Prestige and process only: no unique combat effects (R3).

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; then SYNC RELEASE: git fetch origin, merge the newest origin/release/**
  into feature/masterwrought, run the release-merge-audit skill on the merge.
- Memory scan: MEMORY.md entries on deeds authoring, player-text handling, event
  serialize-once, the test-pin trap index.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (R3; the R1 rank track; naming registry: Deed of
  Making), docs/prd/masterwrought/progress.md (Phase 12 ledger: rank track, facet members)
- docs/design/deeds.md (the authoring rules) + src/sim/content/deeds.ts + the deedStats
  sites, src/sim/professions/perfecting.ts (the final-rank hook), the codex naming flow
  (grep codex: validation + profanity filtering, server side),
  src/sim/professions/commission.ts (crafter signature), the masterwork celebration
  event family (sim event + zone broadcast + Discord activity card path), tooltip
  rendering for item instances in both hosts, src/sim/content/recipes.ts inscription
  rows (Deed of Making lands at skill 125), tests/deeds_content.test.ts pin shape.
Return: how the codex flow validates and moderates a player-authored name; how
masterwork celebrations reach zone and Discord; how a rolled quality override flows to
tooltips; the deeds authoring constraints (append-only, Renown rules).

STEP 2 - EXECUTE (parallel fan-out, explicitly):
Agent 1 (sim promotion + recipe + tests):
- Deed of Making: inscription recipe at skill 125, authored HERE, consumed by the final
  Perfecting rank.
- Promotion in perfecting.ts: rolled quality override to legendary on the instance,
  presentation only (R3: stats unchanged, no new effects), crafter signature retained,
  and the phase 01 sub-cap now binds this instance (at most ONE legendary-quality
  crafted piece equipped inside the global cap).
- tests/orange_promotion.test.ts: promotion consumes the Deed; the quality override
  persists; sub-cap interplay (the promoted instance is counted by BOTH the existing
  quality-derived isUniqueEquipped rule AND the Masterwrought sub-cap); signature
  retained; stats byte-identical before and after promotion.
Agent 2 (naming + moderation + celebration):
- Unique player-chosen name via the codex flow: validated and profanity-filtered
  SERVER-SIDE (the client submits, the server decides; the moderation surface stays
  reachable for operators). The name persists on the instance and renders in tooltips
  in BOTH hosts as player-authored text: handled like every other player text surface,
  NEVER through t().
- Celebration: zone broadcast + personal event + Discord activity card at masterwork
  event family parity; serialize-once discipline for the broadcast payload.
Agent 3 (deeds):
- Append-only DEEDS entries + deedStats sites for the promotion per docs/design/deeds.md:
  cosmetic-only (titles, Renown), never power, and zero Renown for anything luck-gated.
  tests/deeds_content.test.ts pins the new rows.

INVARIANTS IN PLAY: R3 (the promotion changes presentation, name, signature, and deed
credit, nothing else; no unique combat effects); server authority over the name and the
promotion; player-authored text never enters t() or the i18n catalog; deeds append-only
and cosmetic-only; no shipped id changes; masterwork.ts untouched.

Out of scope: orange render visuals (phase 16); the Perfecting window UX (phase 14);
any v2 unique effect (future-tier intent in brainstorm.md, not a deliverable).

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
npx tsc --noEmit; npx vitest run tests/orange_promotion.test.ts tests/perfecting.test.ts
tests/masterwrought_cap.test.ts tests/deeds_content.test.ts tests/architecture.test.ts
tests/world_api_parity.test.ts tests/localization_fixes.test.ts; the wire set
(snapshots, env_protocol, bandwidth) if instance wire fields changed; npm run
ci:changed. Review Dispatch Matrix (implementation-plan.md): architecture-reviewer
(sim), cross-platform-sync (facet/wire/events), privacy-security-review (server-side
moderation of player-authored names), frontend-seam-reviewer (the tooltip/render arm).
COVERAGE prompts; apply ALL findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- feat(sim): orange promotion consuming the Deed of Making
- feat(server): moderated player naming and the promotion celebration
- feat(content): deed records for the orange promotion
- test(sim): promotion, naming, and sub-cap interplay pins

STEP 5 - ACCEPTANCE:
- [ ] Final rank consumes a Deed of Making; promotion is presentation-only (R3)
- [ ] Name validated and moderated server-side; renders in both hosts; never through t()
- [ ] Promoted legendary counted by BOTH the quality rule and the phase 01 sub-cap
- [ ] Celebration at masterwork parity (zone + personal + Discord)
- [ ] Deeds append-only, cosmetic-only, Renown per docs/design/deeds.md, pinned
- [ ] Stats identical across promotion; all listed suites green; ci:changed clean

STEP 6 - DOCS: progress.md Phase 13 row; state.md ledger (Deed of Making id, deed ids,
i18n keys, events, wire fields); memory note if anything surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, handoff
line for Phase 13 QA.

STOPPING RULES: stop and ask if no server-side profanity/moderation surface exists to
reuse (never invent a bespoke filter silently), or if legendary presentation cannot be
expressed as a rolled override without touching item defs or shipped ids.
```
