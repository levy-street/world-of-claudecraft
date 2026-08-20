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

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

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

### Farming arm (amended 2026-08-20)

Phase 11b absorbed `feature/farming-plan` into this packet: one branch, one PR, five
gathering professions and ten crafts shipping as one system. The prompt above is not
retracted and not rewritten. This section is part of it. Read it after STEP 0 and fold
every item into the matching step.

**STEP 0 additions.**
- DECISION 1 (GATE 1, the tier 3 and 4 seed bootstrap) IS SETTLED (2026-08-20, rows
  11b-D-1 and state-GATE-7): FIX the faucet, by vendor-stocking every tier 3 and tier 4 seed
  at `farmer_hollis` and `farmer_verbena` on the D11 tier 1/2 pattern, executed ONCE in 11e,
  priced per 11e-D-D (32 and 64), at EIGHT rows once 11e-D-B grows the roster by four crops,
  not four. What this phase confirms is not the RULING but the CODE: read both farmers'
  merged `vendorItems` arrays and verify the eight rows are there, never a ledger row that
  claims them. This matters here because farming parked `prog_farming_100` and
  transitively `feat_book_complete` as UNEARNABLE deeds under its (bs) waiver pending
  that ruling. Phase 13 authors new deeds under a checklist row requiring deeds to be
  earnable and cosmetic-only; it must not inherit dormancy as normal. If 11e did not
  discharge GATE 1, stop and ask rather than appending a third dormant row.
- Memory scan gains: the deed-ordering rule for append-only tables, and the farming
  celebration beats.

**STEP 1 additions (Explore agent).**
- The three-tier ordering rule for every append-only table (integration plan, and
  `docs/prd/masterwrought/decisions-index.md` for the R / D / deviation namespaces):
  release rows first, masterwrought's committed rows next with positions frozen, then
  farming's block last, appended whole and contiguous. Phase 13's deed rows append AFTER
  farming's block.
- `src/sim/professions/feast.ts` and the merged `src/ui/i18n.catalog/items.ts` rows for
  farming's `"{name}'s Harvest Feast"` key, the second shipped player-name-bearing
  surface.
- The merged celebration set: farming's `golden_harvest` zone announcement and its
  appended ready-notice beat, alongside the masterwork event family this phase mirrors.
Return additionally: farming's deed block boundaries in `src/sim/content/deeds.ts`, the
merged `DEED_ART_PENDING` contents, and the full merged list of zone-broadcast producers.

**STEP 2 additions.**
- Agent 3, deeds: the new rows append after farming's block, against pins 11d already
  moved and 11e moved again. Predict each pin as base plus oursDelta plus theirsDelta
  from the merged literals and require the observed value to equal the prediction; never
  paste an observed number. The 11d/11e recorded baselines this phase moves from are
  `DEED_ORDER.length` 287 and total renown 3275 (11d re-derived 286 / 3270, then 11e
  appended `prog_field_to_feast` at renown 5), the `deed_i18n` manifest at 617, and
  `DEED_IMAGE_IDS.size` at 278. The promotion deed also joins the merged
  `DEED_ART_PENDING` list, which already carries eight farming rows plus the commissioned
  `prog_farming_100` crest brief.
- Agent 2, player-authored text: there are now TWO shipped patterns for the same hazard
  class, player-controlled text reaching a rendered string. Phase 13 mints a
  player-chosen item name rendered OUTSIDE `t()`; farming already ships
  `"{name}'s Harvest Feast"` as a `t()` key with the name as a VALUE. STATE WHICH IS
  CANONICAL in the state.md ledger and conform to it; do not mint a third plumbing. The
  `privacy-security-review` arm covers both paths, not just the new one.
- Agent 2, celebration: the celebration family is now SHARED. The zone broadcast, the
  personal event, and the Discord activity card must not double-announce alongside
  farming's `golden_harvest` beat, and serialize-once discipline applies to a broadcast
  set that grew on both sides. Hand Phase 16 the merged event list: `bot/logic.ts` has a
  closed activity-card kind union that already carries `masterwork` but has no farming
  member and no `golden_harvest` card, and Phase 16 owns that record.

**STEP 5 additions (acceptance).**
- [ ] Deed rows appended AFTER farming's block; every moved pin predicted then observed
- [ ] The canonical player-authored-text pattern named in state.md, and both shipped
      paths reviewed by `privacy-security-review`
- [ ] No double-announce: the merged broadcast set produces exactly one zone line per
      celebration, with the farming beats intact
- [ ] Promotion deed recorded in the merged `DEED_ART_PENDING` list
- [ ] No dormant deed added, and GATE 1 confirmed discharged

**Open item to RECORD, not decide.** Whether a player-named legendary INSTANCE triggers
the Reliquary same-change obligation is unaddressed in both packets (masterwrought's open
decision covers four crafted-primary epic tools; farming concluded no farming item
qualifies today). Record it as a row in `docs/prd/masterwrought/farming/state.md`, the
packet's open-item collection point, and let the content-obligations sweep run against
the merged Reliquary pins either way.
