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
- Review masterwork proc bounds, training fees, teach tiers, work-order rewards, the
  rare-event cadence, and the #1301 craft fee
  and throttle against the state.md tuning targets, applying the maintainer's numbers. The
  rare-event cadence review decides per FAMILY: the Phase 4 shared knob may split into
  per-flavor cadences (vein, heartwood, bloom) with maintainer numbers if live data says
  the families need different rhythms. If a
  maintainer number is missing for any constant, stop and ask; never invent balance numbers.
- Every constant is a NAMED export in its owning module; none inline at a call site. Pin each
  final value in the matching test.
- Faucet-vs-sink review (the 2026-07-17 amendment): with live data, weigh the material and
  gold faucets (gathering, work-order rewards, quest gold) against the sinks (consumables,
  crafting inputs, salvage and disenchant destruction, the typed-reagent demand, training,
  craft, and unbind fees) and record the balance with evidence in the phase notes.
- The legacy junk-recipe burn-down (the 2026-07-20 amendment): work through
  LEGACY_GOLD_POSITIVE_RECIPE_IDS (tests/recipe_economy.test.ts pins it three ways as a
  burn-down target) and CROSS-CHECK each candidate fix against the Phase 13 typed-reagent
  consumers: a legacy recipe reworked to consume a typed material closes two flags at once
  (the gold-positive violation and a no-dead-materials consumer), so prefer that shape where
  it fits before plain price nerfs. Maintainer numbers only; never invent balance values.

Agent guide deliverables:
- Rewrite the guide/wiki professions page (src/guide/pages/professions.ts) to describe the
  SHIPPED system: archetypes and attunement, masterworks, stations and masters, training,
  gathering and the rare events, fishing, enchanting reach, salvage, and the deeds. Recipe and station
  data must feed the page from src/sim/ content, not hand-copied tables.
- npm run wiki:content regenerated and the freshness gate (tests/guide.test.ts) green; any new
  guide.* prose keys added English-only.
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
- [ ] The wiki professions page describes the shipped system; npm run wiki:content freshness
      green.
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
