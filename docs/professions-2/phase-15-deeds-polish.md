# Phase 15: Deeds, tuning, and polish

This phase closes the Professions 2.0 packet. It registers the basic universal profession deeds
(cosmetic only, per the locked decision in `state.md`), replaces the placeholder tuning targets
with the maintainer's final numbers in named constants, rewrites the `/wiki` professions page so
the guide describes the system that actually shipped, finishes the `asset-manifest.json` designer
handoff, and then runs the whole-feature QA matrix plus the release gate. The 2026-07-20
amendments add the profession SFX completion sweep (the placeholder clips Phase 12b sanctioned
are replaced or explicitly re-filed on the help-wanted issue #2208), require the rare-fish deed
to celebrate through the Phase 12b bite moment, and point the legacy junk-recipe burn-down at
the Phase 13 typed-reagent consumers. It is its own slice
because every earlier phase must be landed before deeds can trigger on real behavior, tuning can
be judged against the live system, and the wiki can tell the truth.

The SECOND 2026-07-20 block (mastery and provenance; state.md is the authority) reshapes this
phase in four ways. (1) Deeds grow: fishing gets its FIRST deed, prog_master_gatherer counts
fishing, per-craft mastery deeds land at the RESOLVED caps (125 crafts, 100
mining/logging/herbalism, 200 fishing; no record may reference 300), and the titles scheme is
approved (Guildsworn, Masterwright, "Grandmaster {Craft}", Master Angler; wording veto in the
PR review). (2) The tuning sheet SHRINKS: the masterwork constants, specialization perks, and
rare-event cadence (one shared knob, no per-family split) are FINAL; the work-order formula,
unbind ladder, typed-reagent yields, and training-fee extension are resolved in state.md
Tuning targets; the discovery-credit item is closed; the 12c curve constants and time targets
arrive already landed and pinned. (3) The faucet-vs-sink review gains three named rows: the
market fee (#2156), the dust-vs-cheap-uncommon disenchant margin, and the live
gland-to-pristine ratio report (about 250 plain glands per 5 pristine). (4) The wiki rewrite
expands to the RuneScape-wiki bar as its OWN dedicated arm (see the guide agent below).

## Context pointers

- `docs/professions-2/state.md`: locked decisions, the "Tuning targets" section (the numbers this
  phase finalizes), the validation matrix, and the "New surfaces per phase" appendix that names
  where each tuning constant landed.
- `docs/professions-2/progress.md`: per-phase status and deliverable checklists.
- `docs/professions-2/qa-checklist.md`: the whole-feature integration matrix this phase runs end
  to end with evidence.
- `docs/professions-2/asset-manifest.json`: the designer-replaceable slot list to finish.
- `docs/professions-2/implementation-plan.md`: the review dispatch matrix and team workflow.
- `src/sim/content/deeds.ts` and `src/sim/deeds.ts`: the deed catalog and trigger system; author
  per `docs/design/deeds.md` and the 12-step deeds recipe summarized in `state.md`.
- `tests/deeds_content.test.ts` and `tests/deeds.test.ts`: the catalog pin (append-only proof)
  and trigger behavior suites.
- Tuning constant homes named in `state.md`: the masterwork proc constants (Phase 2), the
  rare-event cadence (Phase 4, one shared knob), the training fees (Phase 9), and the #1301 craft fee and
  throttle constants in the crafting resolver path.
- `src/guide/pages/professions.ts` plus the wiki content generator (`npm run wiki:content`,
  freshness-gated by `tests/guide.test.ts`); conventions in `src/guide/CLAUDE.md`.
- The 2026-07-20 additions: issue #2208 (the profession sound slot list and per-clip pipeline
  checklist), the PLACEHOLDER-marked catalog rows in `scripts/sfx/` from Phase 12b, the
  `LEGACY_GOLD_POSITIVE_RECIPE_IDS` burn-down list in `tests/recipe_economy.test.ts`, and the
  Phase 13 typed-reagent consumer recipes (the no-dead-materials referential pin).
- Local conventions: `src/sim/CLAUDE.md`, `src/guide/CLAUDE.md`, `tests/CLAUDE.md`.

## Starter Prompt

```
This is Phase 15 of the Professions 2.0 feature: Deeds, tuning, and polish.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: close the packet by registering the universal profession deeds, applying the maintainer's
tuning numbers to named constants, rewriting the wiki professions page to describe the shipped
system, finishing asset-manifest.json, and running the whole-feature QA matrix plus the gate.

STEP 0 - PRE-FLIGHT:
- Sync with the LATEST release branch FIRST: git fetch origin "+refs/heads/release/*:refs/remotes/origin/release/*"; pick
  the newest by version sort (git branch -r --list "origin/release/*" | sort -V | tail -1). If this phase
  starts a fresh branch or worktree, base it on that branch; if the feature branch already exists, merge
  that release branch into it NOW, resolve conflicts, and run the release-merge-audit skill on the merge
  before proceeding. Never base work on main or an older release branch than the newest.
- Run git status; the checkout must be clean (a concurrent session may share it). Stop if dirty.
- Record the current HEAD as the phase-start commit in docs/professions-2/progress.md.
- Scan Claude Code memory (the MEMORY.md index) for phase-relevant entries; at minimum read:
  node25-breaks-jsdom-gate (the gate MUST run under Node 24), design-language-program (no
  DESIGN.md phase vocabulary in any copy or styling this phase touches), and any professions /
  PR 2039 packet entries recorded by earlier phases.

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn one Explore agent to read and summarize:
- docs/professions-2/state.md, docs/professions-2/progress.md, and this phase file
  (docs/professions-2/phase-15-deeds-polish.md).
- docs/professions-2/qa-checklist.md and docs/professions-2/asset-manifest.json.
- docs/design/deeds.md, src/sim/content/deeds.ts, src/sim/deeds.ts,
  tests/deeds_content.test.ts, tests/deeds.test.ts.
- The tuning constant files named in state.md's "New surfaces per phase" appendix (masterwork
  proc, rare-event cadence, training fees, the #1301 fee and throttle).
- src/guide/pages/professions.ts and the wiki generator path, plus src/guide/CLAUDE.md,
  src/sim/CLAUDE.md, and tests/CLAUDE.md.
The summary must return: the locked deed scope and tuning targets verbatim from state.md; the
deed authoring rules (record shape, trigger wiring, i18n-by-id, category crest icon fallback,
catalog pin mechanics); the exact file and symbol for every tuning constant; how the guide page
is generated and freshness-gated; the current asset-manifest slot list; and the validation
matrix rows for deeds content, content-only, i18n keys added, and full-stack changes.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Fan out four parallel agents (deeds, tuning, guide, polish); each gets ONLY the Explore
summary, never the planning docs. Their file sets are disjoint, so no worktree isolation is
needed; if any overlap appears, serialize that overlap. After all four land, the main session
runs the QA matrix (see STEP 3).

Agent deeds deliverables:
- Register the basic universal profession deeds in src/sim/content/deeds.ts with triggers wired
  in src/sim/deeds.ts: first craft, first masterwork, first attunement, per-craft tier
  milestones (rare tier), the Specialist deed at the 75-skill specialization threshold, and
  the rare-find deeds for the Phase 4 event flavors (pristine vein, ancient heartwood,
  moonlit bloom) plus the Phase 10 perfect specimen. The rare fish deed already exists: verify
  it, do not duplicate it; and per the 2026-07-20 amendment, verify it celebrates THROUGH the
  Phase 12b bite moment (the col_glimmerfin credit lands on the reeled catch, so the deed
  banner follows the bite-and-reel beat rather than a silent timer; the scripted playthrough
  drives the bite flow, not a direct grant).
- The mastery additions (the second 2026-07-20 block): fishing's FIRST deed; fix
  prog_master_gatherer to count fishing (any 3 of 4 stays the accepted Phase 11 semantics
  or tightens to all 4 by explicit maintainer choice in review, never silently); per-craft
  mastery deeds at the RESOLVED caps carrying the approved titles ("Grandmaster {Craft}"
  at craft 125, Master Angler at fishing 200); Guildsworn on first attunement and
  Masterwright on first masterwork (these two carry the marquee-tier renown per the
  2026-07-17 ruling). NO deed may reference skill 300; every threshold is a resolved cap
  or below. All still cosmetic-only, append-only; deed triggers must no-op on re-crossings
  after the Phase 12c reset (the 12c re-crossing suite is the precedent to extend).
- Notability through the deeds pipeline (the 2026-07-17 ruling): first attunement and first
  masterwork carry TITLE rewards and marquee-tier renown (>= 25) so the existing pipeline
  fires in full: nameplate title, banner, fireworks gate, celebration sound,
  guild-and-friends marquee broadcast, Renown board. Deed titles are the nameplate surface
  (archetype titles do not render on nameplates; the Phase 1 QA drift note). Still
  cosmetic-only, still append-only.
- Icons via the category crest fallback (no bespoke art required; note any bespoke-worthy slot
  in asset-manifest.json instead).
- Deed i18n added English-only by deed id per the deeds recipe; catalog pins in
  tests/deeds_content.test.ts updated; the pin must prove the catalog is APPEND-ONLY so ALL
  existing deeds stay earnable.
- A scripted playthrough test (Vitest driving the real Sim) that unlocks every new deed.

Agent tuning deliverables:
- Review the tuning sheet against state.md Tuning targets, applying the resolved numbers.
  The second 2026-07-20 block settled most of it: the masterwork proc constants,
  specialization perks, and rare-event cadence (ONE shared knob; the per-family split is
  decided AGAINST for wave one) are FINAL and must not change; the work-order formula,
  unbind ladder, typed-reagent yields, and the training-fee extension are resolved rows to
  verify as-landed; the 12c curve constants, caps, and time-to-master targets arrive
  already pinned. What remains live here: the #1301 craft fee and throttle values against
  live data, and the time-to-master targets checked against real playthrough arithmetic
  (materials included). If any remaining constant lacks a maintainer number, stop and ask;
  never invent balance numbers.
- Every constant is a NAMED export in its owning module; none inline at a call site. Pin each
  final value in the matching test.
- Faucet-vs-sink review (the 2026-07-17 amendment): with live data, weigh the material and
  gold faucets (gathering, work-order rewards, quest gold) against the sinks (consumables,
  crafting inputs, salvage and disenchant destruction, the typed-reagent demand, training,
  craft, and unbind fees) and record the balance with evidence in the phase notes. Three
  named rows from the second 2026-07-20 block: the market fee (#2156) under the higher
  material volume the slower curve drives; the dust-vs-cheap-uncommon disenchant margin
  (arbitrage should be a profession, not a printer; note it destroys items, so a generous
  margin is tolerable); and the live gland-to-pristine ratio report (about 250 plain
  glands per 5 pristine, about 8 full stacks: check the per-corpse quantity and the
  specimen rate against how much plain volume the sinks can actually drink).
- The legacy junk-recipe burn-down (the 2026-07-20 amendment): work through
  LEGACY_GOLD_POSITIVE_RECIPE_IDS (tests/recipe_economy.test.ts pins it three ways as a
  burn-down target) and CROSS-CHECK each candidate fix against the Phase 13 typed-reagent
  consumers: a legacy recipe reworked to consume a typed material closes two flags at once
  (the gold-positive violation and a no-dead-materials consumer), so prefer that shape where
  it fits before plain price nerfs. Maintainer numbers only; never invent balance values.

Agent guide deliverables (EXPANDED to the RuneScape-wiki bar by the second 2026-07-20
block; this is its own dedicated arm of the phase, sized accordingly):
- The professions wiki becomes per-skill pages at genre-best detail, on one strategy:
  GENERATE the tables, WRITE the understanding. Generated from src/sim/ content (never
  hand-copied): full recipe tables per craft (name, skillReq, gain state at a glance,
  materials, output, acquisition, station), gathering node lists per zone with tiers,
  tool and rod ladders with vendor prices, band thresholds and what each band unlocks,
  fishing tables per zone and band, and the deed list. Written prose, focused on
  understanding: the wheel and archetype identity (majors, hobby, dormancy, make-amends),
  attunement, the four-state Mastery Curve and its colors, the caps and the
  more-with-new-zones promise, time-to-master expectations, provenance and signatures,
  masterwork, the enchanting materials ladder, and the economy (market, what sells,
  commissions once 14b lands). Page structure: one overview page, nine craft pages, four
  gathering pages, an enchanting page, an economy page, and an FAQ seeded from the real
  community questions (non-stacking signed items, common recipes and skill gain, loot
  versus harvest).
- TRANSPARENCY POLICY (resolved): publish the exact numbers, including skill
  requirements, gain states, band thresholds, cap values, and rare-event odds; the repo
  is public, so the wiki is the accurate source rather than a coy one. Narrative content
  (quest stories, letter text) stays spoiler-light per the guide's existing rule.
- i18n: every new guide.* prose key lands ENGLISH-ONLY; the locale fill is a release-time
  batch by the maintainer. Land the guide-scoped M16 exemption alongside (the wordy-value
  rule exists for HUD layout overflow; the guide is a document page, so scope the
  exemption to guide.* keys, narrowly, with the gate change reviewed in this PR).
- npm run wiki:content regenerated and the freshness gate (tests/guide.test.ts) green.
- Final asset-manifest.json pass: append every id that shipped procedurally across the packet,
  with purpose, size, format, and replacement notes.

Agent polish deliverables (the 2026-07-20 SFX completion sweep):
- Sweep every profession sound slot on issue #2208: the Phase 12b placeholder cues (gather
  cast/strike, the rare-strike variant, fish cast/bite/reel), craft success, and the five
  missing station ambiences beside amb_forge. For each slot, either a real clip replaces the
  placeholder (the full per-clip checklist on #2208: catalog row, asset, sfx:manifest,
  routing, gain map, sfx:check, docs row, CREDITS.md licensing for recordings) or the slot is
  explicitly re-filed on #2208 with a note; the packet does not close with an UNTRACKED
  placeholder.
- Per-craft success variants where the sound engineer delivered them (the craftResult payload
  already carries what a variant sting needs); never a second cue on grant lines the loot hub
  owns (the Phase 4 double-log trap).
- End state: no catalog row for a profession cue is still marked PLACEHOLDER, or every
  remaining one is listed on #2208 with the maintainer's sign-off recorded in progress.md.

Then, in the main session: run docs/professions-2/qa-checklist.md end to end, recording evidence
(test name, command output, or screenshot path) per row; then npm run gate under Node 24; then
offer packet teardown per the house rule (surface deferrals first, ask for explicit maintainer
confirmation before deleting docs/professions-2/; if the maintainer defers, the Phase 15 QA
session re-offers).

INVARIANTS THIS PHASE MUST KEEP:
- Deeds are cosmetic-only: titles and Renown, never power.
- Determinism: all sim randomness through Rng; deed triggers must not perturb existing Rng draw
  order; no Math.random, Date.now, or performance.now in src/sim/.
- IWorld both-worlds parity where relevant: any new read lands on a facet, implemented in BOTH
  Sim and ClientWorld, parity-pinned in the same change (verify liveness, not just shape).
- Server authority: deed credit and every tuned outcome resolve server-side.
- i18n: English-only catalog keys; sim/server-origin player text ships its matcher rule (the S3
  guard, tests/localization_fixes.test.ts) in the SAME change; M16 for wordy strings.
- Docs anchor rule: cite stable paths, exported symbols, and pinned tests; no literal counts or
  line numbers that rot.
- Prime directive: nothing existing breaks. All existing deeds stay earnable; never delete an
  ItemDef players may hold; no hand-edits to generated files.

Out of scope (do NOT do in this phase):
- Anything wave 2: market/mail instance carriage (the closed #1146's scope, re-homed to a
  named follow-up when picked up), the commission ORDER workflow
  (#1298; the binding primitive and the Maker's Bond landed in Phases 13 and 14b),
  Jack of All Trades (#1296), monster-harvest proficiency, batch salvage UI (single-item
  salvage landed in Phase 13), battlefield experience
  expansion, item biographies, tool effects (parked and dormant), jewelcrafting or inscription
  depth.
- No new deed UI systems; the deeds window and celebration pipeline already exist.
- No deletion of docs/professions-2/ without the explicit teardown confirmation.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
Run the state.md validation matrix rows for this change type:
- deeds content row: npx vitest run tests/deeds_content.test.ts tests/deeds.test.ts
- guide freshness: npx vitest run tests/guide.test.ts and npm run wiki:content
- i18n keys added row: npm run i18n:gen then npx vitest run tests/i18n_completeness.test.ts
  tests/localization_fixes.test.ts
- sim purity: npx vitest run tests/architecture.test.ts and npx tsc --noEmit
- any code change row: npm run ci:changed; format with a SCOPED
  npx @biomejs/biome check --write <file>
- full-stack row: the full docs/professions-2/qa-checklist.md matrix with evidence, then
  npm run gate under Node 24 (the known armory browser-test failure aborts the gate early;
  finish tsc and the builds manually; PR CI is the arbiter).
Then spawn review agents per the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md; check git diff --name-only and spawn ONLY matching
rows (qa-checklist always spawns here: the phase, and the packet, are complete). Prompt every
review agent for COVERAGE, not filtering: report every correctness or requirement gap with
confidence and severity; filtering happens in a later pass. If any agent's output comes back
truncated, re-prompt that agent to resume and finish its report before acting on it. No commit
while any BLOCKING finding stands.

STEP 4 - COMMIT CADENCE:
Commit in slices with explicit paths (never git add -A); every commit carries a body (1 to 4
sentences on what changed and why), Conventional Commits with a scope:
- feat(content): register universal profession deeds
- chore(professions): apply the Phase 15 tuning pass
- docs(guide): rewrite the professions wiki page for the shipped system
- docs(professions): finish asset-manifest and update packet status docs

STEP 5 - ACCEPTANCE CRITERIA (do not mark complete until all check):
- [ ] Every deed in the packet is unlockable in a scripted playthrough (the Vitest run proves
      first craft, first masterwork, first attunement, rare-tier milestones, the Specialist,
      the rare fish, and every rare-find deed all unlock).
- [ ] First attunement and first masterwork deeds carry titles and marquee-tier renown; the
      scripted playthrough proves the nameplate title, banner, and marquee broadcast fire.
- [ ] The faucet-vs-sink review is recorded with evidence in the phase notes.
- [ ] The legacy burn-down list shrank or every surviving member has a recorded maintainer
      disposition; candidates were cross-checked against the typed-reagent consumers first.
- [ ] Every profession sound slot on #2208 is either replaced (sfx:check green, licensing
      recorded) or explicitly re-filed; no untracked PLACEHOLDER catalog row remains.
- [ ] The rare-fish deed celebrates through the bite-and-reel flow in the scripted
      playthrough (no direct-grant shortcut).
- [ ] tests/deeds_content.test.ts pins the catalog append-only; all pre-packet deeds unchanged.
- [ ] Every tuning constant is named, exported, pinned, and matches the maintainer's numbers.
- [ ] The mastery deed additions land: fishing's first deed, prog_master_gatherer counts
      fishing, per-craft mastery deeds at the resolved caps with the approved titles, and
      no deed references skill 300; re-crossings after the 12c reset double-grant nothing.
- [ ] The wiki is per-skill pages at the resolved detail bar: tables generated from
      src/sim/ content, exact numbers published per the transparency policy, the FAQ
      seeded from the real community questions; npm run wiki:content freshness green.
- [ ] Every new guide.* key is English-only and the guide-scoped M16 exemption is in
      place; the release-tier gate still hard-fails pending rows (the release fill
      workflow is untouched).
- [ ] The faucet review covers the three named rows (market fee, disenchant margin, the
      gland-to-pristine ratio) with evidence.
- [ ] asset-manifest.json lists every procedurally shipped id from the packet.
- [ ] docs/professions-2/qa-checklist.md fully checked with evidence per row.
- [ ] npm run gate green (Node 24 rule respected).
- [ ] Packet teardown offered and answered (or explicitly deferred to the QA session).

STEP 6 - DOC UPDATES + MEMORY:
Update docs/professions-2/progress.md (Phase 15 status, deliverable checklist, phase-start and
phase-end commits) and docs/professions-2/state.md: the "Tuning targets" section becomes final
numbers with their constant names and files; "New surfaces per phase" gains the Phase 15 row
(deed ids registered, deed i18n namespace, scripted playthrough test path, guide page anchor,
asset-manifest final status); the "Current phase" pointer moves to "Phase 15 done, final QA
pending". Record any surprises to Claude Code memory.

STEP 7 - FINAL RESPONSE FORMAT:
Report: phase status; files touched; validation results (each command and its outcome,
including every qa-checklist row's evidence); review agent verdicts; deferrals; and a one-line
handoff for the Phase 15 QA session.

STOPPING RULES:
- Stop if any qa-checklist.md row cannot be evidenced; report the row and why instead of
  checking it on vibes.
- Stop and ask if any tuning constant lacks a maintainer-confirmed number; never invent balance
  numbers.
- Stop if a pre-existing deed pin would need weakening to pass; that signals a broken existing
  deed, not a re-pin.
- Never delete docs/professions-2/ without the explicit teardown confirmation.
```
