# Phase 15: Power verification

### Starter Prompt
```
This is Phase 15 of the Masterwrought feature: power verification. R5 is the gate:
nothing merges beyond this point until the envelope is proven.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: yes (audit): drive the measured pass and the
adversarial audits as a Workflow.

Goal: prove the full kit (2 Perfected pieces + apex enchants + flask + food + feast)
lands at most 5 percent total throughput over pre-packet raid BiS (R5), record the
measurement so it is reproducible from the doc alone, and close every pin gap the
adversarial audit finds. Any breach is fixed by tuning numbers DOWN in this phase,
never by widening the envelope.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; then SYNC RELEASE: git fetch origin, merge the newest origin/release/**
  into feature/masterwrought, run the release-merge-audit skill on the merge.
- Memory scan: MEMORY.md entries on the test-pin trap index, mutation harness must prove
  tests RAN, spell-balance notes.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (R5, R14; Power placement: budgets and the
  throttle-proof rating surface), docs/prd/masterwrought/progress.md (phases 08 to 12
  ledger: every apex item, enchant, and consumable)
- docs/design/spell-balance-framework.md (the measurement method; follow it, do not
  invent one), tests/masterwrought_budget.test.ts (the sweep),
  tests/recipe_economy.test.ts, the exclusivity pins from phases 06/10, the rating pins
  from phases 08/09.
Return: the framework's measurement recipe, the full apex item list with stats, which
pins exist today and which items each covers.

STEP 2 - EXECUTE (ultracode Workflow; request the fan-out explicitly):
Arm 1 (measured pass): build the full-kit character per R5 (2 Perfected pieces, apex
enchants, flask, food, feast) and the pre-packet raid BiS baseline; measure both against
heroic raid and S-rift tuning targets per the framework; write every input, formula, and
result to docs/prd/masterwrought/power-verification.md with the explicit 5 percent
envelope verdict per measured kit. Heroic raid and S-rift clear difficulty is the
protected asset (R5).
Arm 2 (adversarial stat-shape audit): every apex item against the scarce-stat and
stat-light-slot rules (the Lionheart/Lariat rule; R14 for jewelry); flag any outlier.
Arm 3 (pin-completeness audit): rating pins (every apex piece pinned to its same-band
raid or heroic-vendor equivalent), exclusivity pins (scroll/flask/food/elixir families
exactly as state.md designs), and budget-sweep completeness: prove NO apex item is
missing from tests/masterwrought_budget.test.ts by enumerating masterwrought-flagged
defs and apex recipe outputs against the sweep's list.
Arm 4 (fix): any envelope breach or audit finding fixed by tuning numbers DOWN (content
values only), with the budget sweep and every affected pin updated in the same change.
NEVER widen the envelope, relax a pin, or edit the formulas.

INVARIANTS IN PLAY: R5 (the envelope is the contract; breaches tune DOWN); classic-era
formulas only (tune inputs, never invent curve math); ids frozen; content-only edits
(no sim logic changes).

Out of scope: any new content; ui/render work; loosening R14; re-litigating locked
rulings.

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
content matrix: npx tsc --noEmit; npx vitest run tests/progression.test.ts
tests/recipe_economy.test.ts tests/itemization_coverage.test.ts tests/item_level.test.ts
tests/masterwrought_budget.test.ts; plus every pin file the audit touched; npm run
ci:changed. Review Dispatch Matrix (implementation-plan.md): a tests + docs + content
diff skips the sim and frontend rows (pure data/test); dispatch test-coverage-auditor
over the new and changed pins (the purpose-built auditor, per the working-style fan-out
rule) and qa-checklist once the deliverable set is complete. COVERAGE prompts; apply ALL
findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- docs(prd): masterwrought power verification results
- fix(content): tune apex numbers down to the R5 envelope (only if a breach was found)
- test(sim): close the pin gaps the power audit found

STEP 5 - ACCEPTANCE:
- [ ] power-verification.md reproducible from the doc alone (inputs, method, numbers,
      verdict)
- [ ] Verdict INSIDE the 5 percent envelope for every measured kit (R5)
- [ ] No stat-shape outlier stands; rating, exclusivity, and budget-sweep pins complete
- [ ] Every fix tuned DOWN; no envelope widening, no pin relaxation, no formula edits
- [ ] Content matrix green; ci:changed clean

STEP 6 - DOCS: progress.md Phase 15 row; state.md ledger (final tuned numbers if any
changed, audit outcomes); memory note if anything surprised you.

STEP 7 - REPORT: phase status, the envelope verdict per kit, files, validation results,
reviewer verdicts, handoff line for Phase 15 QA.

STOPPING RULES: stop and ask if the envelope cannot be met by tuning down without
breaking a locked ruling (R13 skill placement, R14 stat shapes), or if the framework
cannot measure a kit (a tooling gap is a maintainer call, not a guess).
```
