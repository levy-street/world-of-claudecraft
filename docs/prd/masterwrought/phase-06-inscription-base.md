# Phase 06: Inscription base catalog

### Starter Prompt
```
This is Phase 06 of the Masterwrought feature: the inscription base catalog.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: yes (content workflow; the rung batches run as
a Workflow after the serial station decision).

Goal: inscription exists, power-safe (R10): the 0/25/50 rungs of offhand tomes and buff
scrolls, with scrolls as an ALTERNATIVE source of the elixir aura families, never a stack.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; then SYNC RELEASE: git fetch origin, merge the newest origin/release/**
  into feature/masterwrought, run the release-merge-audit skill on the merge.
- Memory scan: MEMORY.md entries on exclusive-aura/consumable stacking, content
  authoring, workflow gotchas (workflow agents mutate the real worktree), test-pin traps.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (rulings R10, R14 and its corollary, R15; power
  placement numbers; the phase 05 station decision as precedent; the open inscription
  station decision this phase must record)
- docs/prd/masterwrought/progress.md (Phase 06 row)
- src/sim/exclusive_aura.ts (the family model: how flasks/scrolls share elixir families),
  the elixir content rows (which aura families exist and their same-band magnitudes), the
  consumable use path (how an elixir applies its aura), src/sim/content/recipes.ts (rung
  shape), src/sim/content/professions.ts (STATION_TYPE_BY_CRAFT, trainer tier table),
  src/sim/item_budget.ts + src/sim/item_level.ts (tome budget derivation),
  tests/recipe_economy.test.ts, the icon-system row shape, the items i18n catalog domain,
  the wiki regen path, src/sim/CLAUDE.md + src/ui/CLAUDE.md.
Return: how exclusive_aura families are declared and joined, the elixir families and
magnitudes per band, the offhand slot's budget treatment, what phase 05 recorded for
stations, trainer fee rows per tier.

STEP 2 - EXECUTE (ultracode Workflow):
Serial first: the station/training decision (new station type vs explicit stationType;
inscription has NO station today): decide, record in state.md with rationale (phase 05's
decision is the precedent), and wire it so every batch row agrees. Then the batches:
- Batch A (tomes): 0/25/50 offhand tomes (caster stat pieces), common/uncommon/rare,
  budgets EXACTLY formula-derived from recipe level + quality.
- Batch B (scrolls): 0/25/50 buff scrolls; each scroll JOINS an existing elixir aura
  family via exclusive_aura.ts so it is an alternative source, never a stack (R14
  corollary), with magnitudes at the same band as the family's elixir rung.
- Batch C (wiring): trainer rows + fees per the existing tier table; icon-system rows;
  English names in the items catalog (each web-verified per R15, recorded in the state.md
  registry); wiki regen.
- The exclusivity pin: a test proving a scroll and an elixir of the SAME family never
  both apply (apply one, the other refuses or replaces per the family rule; both orders).

INVARIANTS IN PLAY: NO glyph system and NO ability modifiers, explicitly out of scope for
the WHOLE packet; scroll application rides the existing consumable seam and
exclusive_aura families (no new stacking path, no contract change to exclusive_aura.ts);
tome budgets exactly formula-derived; the economy invariant green with an EMPTY exception
list; classic-era formulas only; new item ids append-only against the frozen-id golden;
any player-visible refusal line gets its sim_i18n matcher in the SAME change; wiki
regenerated, never hand-edited.

Out of scope: glyphs and ability modifiers (whole packet); the Voidbound Grimoire apex
tome (phase 09); the Deed of Making (phase 13); the Lucent Reagent (phase 07); anything
above skill 50.

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
npx tsc --noEmit; npx vitest run tests/progression.test.ts tests/recipe_economy.test.ts
tests/itemization_coverage.test.ts tests/item_level.test.ts tests/shipped_item_ids.test.ts
tests/architecture.test.ts plus the new exclusivity pin file;
tests/localization_fixes.test.ts if any refusal line landed; npm run wiki:content then
tests/guide.test.ts; npm run ci:changed. Review Dispatch Matrix (implementation-plan.md):
architecture-reviewer (sim touched via the aura family wiring); frontend-seam-reviewer
(icon/catalog surface); cross-platform-sync only if a SimEvent or wire surface changed.
COVERAGE prompts; apply ALL findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- feat(content): inscription base catalog, rungs 0 to 50
- feat(sim): scrolls join the elixir aura families
- test(sim): pin scroll and elixir exclusivity

STEP 5 - ACCEPTANCE:
- [ ] 0/25/50 tomes and scrolls exist; tome budgets exactly formula-derived
- [ ] Every scroll shares its elixir family via exclusive_aura.ts; the exclusivity pin is
      decisive in both application orders
- [ ] Station/training decision recorded; trainer rows, icons, web-verified names, wiki
      done as phase 05
- [ ] No glyph or ability-modifier surface anywhere; listed suites green; ci:changed clean

STEP 6 - DOCS: progress.md Phase 06 row; state.md ledger (station decision, new item
ids, family memberships, i18n keys, name verifications, new tests); memory note if
anything surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, handoff line
for Phase 06 QA.

STOPPING RULES: stop and ask if a scroll effect cannot be expressed inside an EXISTING
elixir aura family (adding a new family is a design decision), or if joining a family
would require modifying exclusive_aura.ts's contract rather than declaring membership.
```
