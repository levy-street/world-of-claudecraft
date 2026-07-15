# Phase 2: Generated flat TranslationKey union + baseUrl removal

One PR off the latest release/** branch. The TypeScript 7 prerequisite and an immediate
standalone win: swapping the recursive Leaves computation for a build-generated flat
literal union halves today's TS 5.9.3 typecheck (26 to 35s down to ~12s measured), makes
overlay key checking strictly stronger, and clears the TS2590 blocker that TypeScript 7
hard-errors on (evidence: brainstorm.md, Workstream A; the design was verified end to
end twice on isolated repo copies).

### Starter Prompt

```
This is Phase 2 of the Toolchain Modernization packet: Generated flat TranslationKey
union + baseUrl removal.

Model: Opus 4.8, xhigh effort (reserve max for genuinely frontier problems), 1m context variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: not required; this phase is a focused implementation, not batch work.

Goal: emit src/ui/i18n.catalog/translation_keys.generated.ts from the i18n build, swap
the TranslationKey definition to re-export it, delete baseUrl from tsconfig.json, and
wire the new artifact into every freshness/hygiene gate, with zero new type errors and
zero change to the resolved i18n output.

STEP 0 - PRE-FLIGHT:
- Create a worktree off the LATEST release/** branch named
  feature/flat-translationkey-union. Verify git status is clean there.
- Packet bootstrap: if docs/toolchain-modernization/ is absent in this worktree (Phase
  1's PR carries it to the release base), copy it from the main checkout at
  /home/fernandoramirez/Documents/world-of-claudecraft first.
- Memory scan (if you use Claude Code memory): i18n or typescript entries.

STEP 1 - LOAD CONTEXT (via an Explore agent, not directly):
- docs/toolchain-modernization/state.md (decisions D2, D3, D6; baselines; pinned tests)
- docs/toolchain-modernization/progress.md (Phase 2 checklist)
- docs/toolchain-modernization/phase-02-flat-translationkey-baseurl.md (this prompt)
- scripts/i18n_build.mjs and scripts/i18n_flatten.mjs (the existing flatten the
  generator reuses), src/ui/i18n.catalog/index.ts (the Leaves/Join/Prev types, the en
  composition, and the TranslationKey definition with its depth-6 comment),
  src/ui/i18n.ts (the type re-exports), tsconfig.json,
  tests/i18n_overlay_key_membership.test.ts (what it asserts, to confirm tsc now
  subsumes it), tests/i18n_resolved_equivalence.test.ts (the tracked+regen test shape to
  mirror for the new artifact), .gitattributes, biome.json, scripts/gate.mjs
  (I18N_ARTIFACTS), .github/workflows/ci.yml (the freshness diff lines)
- CLAUDE.md (root) + src/ui/CLAUDE.md
The agent should return: the exact flatten call shape in i18n_build.mjs, the current
TranslationKey definition and its comment, every re-export of Leaves/TranslationKey,
and the freshness-wiring points.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE (single implementation agent or inline; the
slices are tightly coupled, do not parallelize the type swap):

Deliverables:
- Generator: extend scripts/i18n_build.mjs to emit
  src/ui/i18n.catalog/translation_keys.generated.ts: a sorted, one-key-per-line union
  type (name it TranslationKeyFlat or similar) from the composed en object's leaf paths
  (reuse scripts/i18n_flatten.mjs). Decision D6 format rules: standard GENERATED header
  naming the owning script, NO key count, NO hash, NO timestamp anywhere in the file.
- Swap: in src/ui/i18n.catalog/index.ts, redefine
  export type TranslationKey = import('./translation_keys.generated').TranslationKeyFlat
  (or an equivalent type re-export). Keep the Leaves type exported and intact (zero
  other instantiations exist repo-wide, verified 2026-07-14; re-verify with a grep).
  Rewrite the depth-6 comment to explain the generated-union design and why (TS2590 on
  the native compiler; cite issue #1868 as the evidence pointer, since it outlives this
  packet).
- Hygiene wiring: add the new file's path to the ci.yml freshness git diff (BOTH jobs),
  scripts/gate.mjs I18N_ARTIFACTS, and .gitattributes (linguist-generated, next to the
  existing generated entries); VERIFY the existing biome.json !**/*.generated.ts glob
  already covers the new file (do not add a redundant entry). The generator must honor
  the same I18N_OUT_DIR-style output override the resolved-table emit honors, so the
  perturbed-env determinism harness (tests/helpers/i18n_determinism.ts) actually
  exercises it; then add or extend a test asserting the artifact is tracked AND
  regenerates byte-identically (mirror the slices block in
  tests/i18n_resolved_equivalence.test.ts) and appears in the determinism outFiles.
- Config: delete the baseUrl line from tsconfig.json; leave paths untouched.
- Retire tests/i18n_overlay_key_membership.test.ts (its guarantee is now enforced by
  tsc, strictly more strongly); remove any references to it.

INVARIANTS THIS PHASE MUST KEEP:
- Zero new type errors anywhere in src, headless, tests, server, private under the
  currently installed TypeScript. Zero change to the resolved i18n output (the swap is
  type-level only; the generated union is erased at build time).
- The generated file is LINE-ITEM per decision D6 (this is what keeps it merge-benign).
- The contributor flow stays: add an English key, run npm run i18n:gen, commit; the
  union regenerates in the same command.
- Pinned tests updated in the SAME commit as the surface they pin.
- No em dashes, en dashes, or emojis anywhere.

Out of scope (do NOT do in this phase):
- Installing or referencing typescript@7 in package.json (Phase 5). The forward probe
  below uses npx only.
- Touching the sha256/summary artifacts (Phase 1 owns those; if Phase 1 has not merged
  yet, do not resurrect them here).
- Any CI restructuring beyond the freshness-diff lines (Phases 3 and 4).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
- npx tsc --noEmit: green, and RECORD the wall time (expect roughly half the state.md
  baseline; update progress.md with the number).
- Forward probe: npx -y -p typescript@7.0.2 tsc --noEmit -p tsconfig.json: expect exit 0
  (this is the Phase 5 gate; if a newer 7.0.x exists, run it too and record).
- npm run i18n:gen twice: clean tree after the second run.
- npx vitest run tests/i18n_resolved_equivalence.test.ts
  tests/i18n_status_registry.test.ts tests/localization_fixes.test.ts
  tests/server/new_endpoint.test.ts tests/ci_workflow.test.ts; then npm run gate.
- Push the branch and open a DRAFT PR following .github/PULL_REQUEST_TEMPLATE.md (the
  QA session marks it ready after PASS).
- Negative probes (prove the stronger checking): a scratch file with a bogus overlay key
  (entities.itemSets.bogus_zzz.name) and a bogus t() literal must BOTH fail tsc; delete
  the scratch file after.
- Review dispatch per the matrix in implementation-plan.md: the diff touches src/ui/
  (frontend-seam-reviewer decides for itself) and ci.yml lines (privacy-security-review
  row); this is otherwise the canonical pure-catalog-refactor skip case for
  cross-platform-sync. COVERAGE not filtering; no commit with BLOCKING open.

STEP 4 - COMMIT CADENCE (Conventional Commits with scope; EXPLICIT paths):
- feat(i18n): generate the flat TranslationKey union from the catalog build
- chore(config): remove baseUrl from tsconfig (TS7-removed; paths already relative)
- test(i18n): pin the generated key union tracked and byte-identical; retire the
  overlay membership test
- docs(i18n): document the generated TranslationKey design (the rewritten index.ts
  design comment plus the matching src/ui/CLAUDE.md i18n-section update)

STEP 5 - ACCEPTANCE CRITERIA:
- [ ] npx tsc --noEmit green with wall time recorded (target ~12s local)
- [ ] npx -y -p typescript@7.0.2 tsc --noEmit -p tsconfig.json exits 0
- [ ] Both negative probes fail tsc (stronger checking proven)
- [ ] i18n:gen twice leaves a clean tree; resolved output byte-identical to base
- [ ] tests/server/new_endpoint.test.ts green (extends chain without baseUrl)
- [ ] npm run gate fully green
- [ ] The generated file contains no count, hash, or timestamp (D6 audit)

STEP 6 - DOC UPDATES + MEMORY: progress.md (checklist + measured timings), state.md
(new file recorded; any drift). Memory notes if surprising rules surfaced.

STEP 7 - FINAL RESPONSE FORMAT: phase status, files touched, validation results with
the two recorded timings, review verdicts, deferrals, one-line handoff for Phase 2 QA.

STOPPING RULES:
- Stop and report if ANY new tsc error appears outside the swapped type: it means real
  code depended on the 85 template-literal pattern members (the members the old
  recursive type derived from the four Record over string or number subtrees; see
  brainstorm.md Workstream A), which contradicts the verified research; do not widen
  types to silence it.
- Stop if the typescript@7.0.2 forward probe still reports TS2590 anywhere: the
  generated union did not reproduce the verified design; diff against the design in
  brainstorm.md before proceeding.
- Stop if the resolved i18n output changes at all.
```
