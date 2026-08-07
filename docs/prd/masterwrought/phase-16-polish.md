# Phase 16: Polish and content surfaces

### Starter Prompt
```
This is Phase 16 of the Masterwrought feature: polish and content surfaces.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: yes (sweep): fan the icon, guide, and admin
batches out as a Workflow.

Goal: everything around the system shines: the orange visual identity, icons for every
new item, guide/wiki coverage, admin market metrics, and the PR screenshot set.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; then SYNC RELEASE: git fetch origin, merge the newest origin/release/**
  into feature/masterwrought, run the release-merge-audit skill on the merge.
- Memory scan: MEMORY.md entries on the guide freshness gate, admin Pick-no-spread, M16
  wordy fills, screenshot traps, cached-read busts.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (the ledger: the FULL new-item list from phases 04 to
  13), docs/prd/masterwrought/progress.md
- docs/design/graphics-settings-fairness.md + the src/ui/CLAUDE.md fairness exemplars,
  src/render/CLAUDE.md (the new-visual-system recipe, RENDER_PURE_CORES),
  src/game/ui_effects_profile.ts (the static preset seam)
- the icon-system row convention, src/guide/CLAUDE.md (guide.* prose keys, wiki regen,
  spoiler rules), src/admin/CLAUDE.md (the Svelte dashboard, admin i18n), server/CLAUDE.md
  "Hot paths" (cached reads), tests/guide.test.ts freshness gate, the pr-screenshots
  skill.
Return: the render module recipe for an item-quality visual, the icon row shape, the
guide key + regen loop, where admin market metrics live and their i18n pattern.

STEP 2 - EXECUTE (ultracode Workflow; request the fan-out explicitly):
Arm 1 (orange visual identity): a new src/render/<thing>.ts module the renderer calls
(never a method bank on renderer.ts) for the legendary crafted treatment (glow or
particle); graphics-settings-fairness compliant: COSMETIC ONLY, sheddable by preset,
never encoding information a player acts on; tier knobs read the static preset via
ui_effects_profile, never the FPS governor; the fairness tests stay the contract.
Arm 2 (icons): icon-system rows for EVERY new item in the packet ledger (materials,
intermediates, patterns, apex pieces, consumables, the Deed of Making); enumerate the
ledger against the icon table so none is missed.
Arm 3 (guide/wiki): guide content + guide.* prose keys for the whole system (patterns
and the three recipe channels, materials, the cap, Perfecting, the orange); npm run
wiki:content; the freshness gate green; spoiler-safe per src/guide/CLAUDE.md.
Arm 4 (admin): market metrics for cores, patterns, and essence on the admin dashboard
(operators are users: full admin i18n); any new server read follows the cached-read
hot-path seams, and any new stored series has a retention story.
Arm 5 (i18n fills + screenshots): M16 non-Latin fills for every wordy new English key in
the same change; before/after screenshots (desktop + mobile) committed under
docs/screenshots for the PR body per the pr-screenshots skill.

INVARIANTS IN PLAY: graphics settings stay gameplay-neutral (cosmetic only; the fairness
tests are the contract); module-first for the render treatment; every admin and guide
string localized; no generated-file hand-edits (regen via the owning build step only);
ids frozen; classic-era presentation.

Out of scope: any balance or content number (phase 15 sealed them); new gameplay
surfaces; HUD window work (phase 14 owned it).

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
npx tsc --noEmit; npx vitest run tests/guide.test.ts tests/architecture.test.ts (the
RENDER_PURE_CORES registration if a pure core landed) tests/localization_fixes.test.ts
plus the graphics-settings fairness tests; npm run wiki:content then confirm freshness;
npm run ci:changed; the screenshot scripts. Review Dispatch Matrix
(implementation-plan.md): frontend-seam-reviewer (render/ui), privacy-security-review
(src/admin/ touched, plus any new server read), database-performance-reviewer if the
metrics add SQL call sites. COVERAGE prompts; apply ALL findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- feat(render): orange visual identity module
- feat(ui): icons for the masterwrought item set
- feat(guide): wiki coverage for the masterwrought system
- feat(admin): market metrics for cores, patterns, and essence
- docs(screenshots): polish before and after captures

STEP 5 - ACCEPTANCE:
- [ ] Orange treatment cosmetic-only; fairness tests green; render module-first
- [ ] Every ledger item has an icon row (enumerated, not sampled)
- [ ] Guide regenerated, freshness gate green, prose keys added, spoiler-safe
- [ ] Admin metrics localized; hot-path and retention seams respected
- [ ] M16 fills done; screenshots committed (desktop + mobile) and referenced
- [ ] All listed suites green; ci:changed clean

STEP 6 - DOCS: progress.md Phase 16 row; state.md ledger (render module, icon rows,
guide keys, admin surfaces, fills); memory note if anything surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, screenshot
paths, handoff line for Phase 16 QA.

STOPPING RULES: stop and ask if the orange treatment cannot be made preset-sheddable
without leaking actionable information, or if an admin metric needs a new unbounded
table (a retention story comes first, not after).
```
