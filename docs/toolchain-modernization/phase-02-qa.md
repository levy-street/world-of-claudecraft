# Phase 2 QA: Verify the flat TranslationKey union + baseUrl removal

### QA Starter Prompt

```
This is Phase 2 QA of the Toolchain Modernization packet: Verify the generated flat
TranslationKey union and the baseUrl removal.

Model: Opus 4.8, xhigh effort (reserve max for genuinely frontier problems), 1m context variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: recommended; the type-safety equivalence claims deserve an adversarial-verify
Workflow (each claim refuted-or-confirmed by an independent skeptic agent).

Goal: audit Phase 2 for type-safety equivalence (nothing weaker anywhere), generator
determinism, freshness wiring completeness, and the TS7 forward probe.

STEP 0 - PRE-FLIGHT: work in the feature/flat-translationkey-union worktree; git status
clean (packet bootstrap: if docs/toolchain-modernization/ is absent, copy it from the
main checkout). Memory scan for i18n/typescript entries.

STEP 1 - LOAD CONTEXT (via an Explore agent): state.md (D2, D3, D6), progress.md
(Phase 2 checklist + recorded timings), phase-02-flat-translationkey-baseurl.md, the
full Phase 2 diff, CLAUDE.md (root), and src/ui/CLAUDE.md. Return: deliverables,
touched files, the recorded timings.

STEP 2 - QA AUDIT (parallel agents; COVERAGE not filtering; report every issue
including low-severity and uncertain ones):

Type-safety agent (the core audit):
- Independently regenerate the union and diff against the committed file (byte-equal).
- Prove nothing got WEAKER: sample 20 real t() call sites across src/ (including the
  seven files the TS2590 research flagged: src/editor/app.ts, src/editor/asset_browser.ts,
  src/main.ts, src/ui/char_window.ts, src/ui/chat_channels.ts, src/ui/discord_role_tag.ts,
  src/ui/item_armor_type.ts) plus 5 overlay rows and 5 as-TranslationKey casts; verify
  each still typechecks, and that deliberately corrupting each category fails tsc.
- Verify the retired overlay-membership guarantee is genuinely subsumed via the
  canonical probe pair (the same pair Phase 2 and qa-checklist.md use): a bogus overlay
  key entities.itemSets.bogus_zzz.name and a bogus t() literal must BOTH fail tsc;
  delete the scratch probes after.
- Grep-verify Leaves still has zero instantiations besides its own definition.

Wiring agent:
- The new artifact appears in: ci.yml freshness diffs (BOTH jobs), gate.mjs
  I18N_ARTIFACTS, .gitattributes, biome.json exclusions, the tracked+byte-identical
  test, and the perturbed-env determinism coverage. A deliberately staled union file
  (add a fake key to the catalog without regenerating) turns the freshness step red.
- D6 audit: no count, hash, or timestamp anywhere in the generated file.
- Stale-union failure mode on the pre-push hook path: with the union file stale, bare
  npx tsc --noEmit fails with a comprehensible missing-key error (record what the
  contributor sees; if it is cryptic, add a hint comment to the generated header).

Behavior agent:
- Resolved i18n output byte-identical across the phase (regenerate on base and branch
  from the same catalog state; diff slices).
- Re-run npx tsc --noEmit yourself, record the wall time, and compare it against both
  the state.md baseline (26 to 35s) and the number Phase 2 recorded (~12s expected).
- tests/server/new_endpoint.test.ts green; the forward probe (typescript@7.0.2, and the
  newest 7.0.x if newer exists) exits 0; record both.

Multi-agent review dispatch per the matrix in implementation-plan.md, plus qa-checklist.
Resume truncating agents with the standard "Stop reading. Output verdict now." message.

STEP 3 - FIX: apply BLOCKING and SHOULD-FIX; re-run the Phase 2 validation rows plus
npm run gate; commit with EXPLICIT paths.

STEP 4 - UPDATE DOCS + MEMORY: progress.md, state.md. Memory notes as warranted.

STEP 5 - PACKET TEARDOWN: skip (not the final phase).

STEP 6 - FINAL RESPONSE FORMAT: QA verdict, counts found/fixed, deferred items,
one-line handoff for Phase 3.

STOPPING RULES:
- Stop and surface if type-safety is weaker at ANY audited site; widening is never the
  fix (see the phase's stopping rules).
```
