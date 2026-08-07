# Phase 02: Pattern items and recipe learning

### Starter Prompt
```
This is Phase 02 of the Masterwrought feature: recipes as tradable items, learned on use.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: not needed for this phase.

Goal: build the pattern-item machinery every later drop/vendor phase hangs recipes on: a
tradable item that teaches its recipe on use, gated, consumed, in both hosts, fully tested.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; then SYNC RELEASE: git fetch origin, merge the newest origin/release/**
  into feature/masterwrought, run the release-merge-audit skill on the merge.
- Memory scan: MEMORY.md entries on professions/recipes, frozen-id goldens, i18n matcher
  rules, test-pin traps.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (rulings R2, R8; delivery contract; "Key existing seams":
  acquireRecipe is plumbed with zero users, NO recipe item kind exists today)
- docs/prd/masterwrought/progress.md (Phase 02 row)
- src/sim/professions/crafting.ts (acquireRecipe, how known recipes are stored per player),
  src/sim/professions/types.ts (ProfessionRecipeRecord, the acquisition field, tier/skill
  helpers incl. tierForSkill), src/sim/content/recipes.ts (ALL_RECIPES shape),
  src/sim/types.ts (ItemDef, ItemKind), the item use path (locate where use-by-kind
  dispatches for consumables), the item tooltip composition arm in src/ui, sim_i18n.ts
  matcher shape, the market listability gate (noMarketList handling),
  src/sim/CLAUDE.md + src/ui/CLAUDE.md.
Return: where use-handling dispatches by item kind, how a player's known recipes persist,
where tooltips branch by kind, how noMarketList gates listing, where tierForSkill lives.

STEP 2 - EXECUTE (parallel fan-out, explicitly):
Agent 1 (sim + learn flow + tests):
- Decide the representation: a new ItemKind 'recipe' OR a use-handler item kind; record
  the decision and its rationale in state.md. Item defs carry teachesRecipeId.
- Use flow in the sim: profession gate, tier gate (tierForSkill(skill) >=
  tierForSkill(skillReq)), already-known refusal, then acquireRecipe(ctx, pid, id, 'drop');
  consumes the item on success. Bind on learn is automatic because the item is consumed
  (R8: patterns are tradable drops, bind on learn).
- Each refusal emits its own error line (English literal at the emit site); a refusal
  NEVER consumes the item.
- tests/recipe_pattern_items.test.ts: successful learn (recipe known after, item gone);
  profession-gate refusal; tier-gate refusal; already-known refusal; refusals leave the
  item intact; consume-on-learn consumes exactly one; patterns ARE market-listable.
Agent 2 (client + i18n + parity):
- sim_i18n.ts matcher rules for EVERY refusal line (same change as the emits; S3 guard).
- Tooltips as t() keys (English only): taught-item preview, profession + skill requirement
  lines, already-known state; rendered in both hosts via the existing tooltip arm.
- ClientWorld mirror: the use command round-trips, learned state and tooltip known-state
  reflect server truth; update tests/world_api_parity.test.ts ONLY if a facet member is
  added (prefer existing profession/recipe reads; record the decision in state.md).

INVARIANTS IN PLAY: the learn path draws NO rng; server authority (the server resolves
learning, the client only mirrors); i18n emit + matcher in the SAME change; any shipped
item id added here is append-only against the frozen-id golden; module-first (the learn
flow is a small module behind SimContext, not a new arm grown inside a coordinator).

Out of scope: authoring pattern items for apex recipes (phase 11 does that on this
machinery); loot tables and vendor rows (phase 11); market category/search polish
(phase 11); crafting-window UX (phase 14).

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
npx tsc --noEmit; npx vitest run tests/recipe_pattern_items.test.ts
tests/architecture.test.ts tests/localization_fixes.test.ts; tests/world_api_parity.test.ts
if a facet member was added; tests/shipped_item_ids.test.ts if any shipped id landed;
npm run ci:changed. Review Dispatch Matrix (implementation-plan.md): architecture-reviewer
+ cross-platform-sync (sim behavior + matchers + net touched); frontend-seam-reviewer for
the tooltip arm. COVERAGE prompts; apply ALL findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- feat(sim): pattern items that teach recipes on use
- feat(ui): pattern tooltips and learn refusal lines
- test(sim): pin pattern learning, refusals, and listability

STEP 5 - ACCEPTANCE:
- [ ] Representation decision + teachesRecipeId recorded in state.md; acquireRecipe gains
      its first real caller
- [ ] All three gates refuse with localized lines and never consume; success learns and
      consumes in BOTH hosts
- [ ] Tooltip preview, requirement lines, and known-state are t() keys in both hosts
- [ ] Patterns are market-listable; all listed suites green; ci:changed clean

STEP 6 - DOCS: progress.md Phase 02 row; state.md ledger (the kind decision, new i18n
keys + matcher rules, any facet member, new tests); memory note if anything surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, handoff line
for Phase 02 QA.

STOPPING RULES: stop and ask if consume-on-learn cannot be expressed through an existing
use-dispatch seam (inventing a new dispatch mechanism is a design decision), or if the
release merge conflicts inside crafting.ts or recipes.ts.
```
