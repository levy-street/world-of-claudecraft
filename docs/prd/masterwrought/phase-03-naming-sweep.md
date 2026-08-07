# Phase 03: IP naming sweep

### Starter Prompt
```
This is Phase 03 of the Masterwrought feature: the IP naming sweep.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: yes (audit workflow; the batch web sweep and
its adversarial verify run as a Workflow).

Goal: no shipped or new name reuses a coined term or full item name distinctive to another
game (R15; maintainer directive, its own phase). Audit every shipped player-visible proper
noun, rename confirmed collisions display-only, and confirm the packet's naming registry.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; then SYNC RELEASE: git fetch origin, merge the newest origin/release/**
  into feature/masterwrought, run the release-merge-audit skill on the merge.
- Memory scan: MEMORY.md entries on i18n traps (reword staleness, M16 wordy non-Latin
  fills), workflow gotchas (verify over-refutes: judge refuted findings yourself), wiki
  and guide freshness.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (ruling R15; the naming registry incl. the rejected
  list; delivery contract)
- docs/prd/masterwrought/progress.md (Phase 03 row)
- Where shipped display names live: src/sim/content/* name fields (items, materials,
  recipes, zones, and any other player-visible proper-noun surface the agent finds),
  the items domain of src/ui/i18n.catalog/, sim_i18n.ts matcher DICTs,
  tests/shipped_item_ids.test.ts (the frozen-id golden), the wiki regen path
  (npm run wiki:content + tests/guide.test.ts), src/ui/CLAUDE.md (M16 rule).
Return: the full inventory surface for proper nouns, where a display rename must land
(content def name, catalog row, matcher DICT), and how the wiki freshness gate works.

STEP 2 - EXECUTE (ultracode Workflow):
Stage A, sweep: enumerate EVERY shipped player-visible proper noun, shard the list, and
fan out web-verification agents per shard against the WoW, RuneScape, FFXIV, GW2, ESO,
Diablo, and PoE wikis (multi-modal: exact-name search plus coined-term search). Verdict
per name: CLEAR, GENERIC (shared fantasy English, not a collision), or COLLISION with an
evidence link.
Stage B, adversarial verify: a fresh verify pass re-judges every COLLISION and a sample
of CLEARs; only a coined term or a full distinctive item name counts (R15), generic words
never do. Judge refuted findings yourself before accepting the refutation.
Stage C, deliverables:
- docs/prd/masterwrought/naming-audit.md with per-name verdicts and evidence (the known
  collisions arcanite bar and silverleaf herb belong on the list; the audit decides the
  full list).
- Display-name-only renames for confirmed collisions. Ids NEVER change. Each rename lands
  as English catalog/content value + sim_i18n matcher update + wiki regen in the SAME
  change; M16 non-Latin fills for wordy renames.
- The new-name registry in state.md confirmed or amended per verdict.

INVARIANTS IN PLAY: ids are frozen and never change (display-name-only renames); every
rename's English value lands in the owning catalog/content module with its matcher rule in
the same change (S3 guard); never edit src/ui/i18n.locales/ overlays except M16 fills;
wiki regenerated via the owning build step, never hand-edited; no mechanical change of any
kind rides this phase.

Out of scope: any id change anywhere; any mechanical or balance change; verifying names
for THIS packet's new content (each content phase web-verifies its own names at authoring
time per R15); locale overlay work beyond the M16 fills.

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
npx tsc --noEmit; npx vitest run tests/shipped_item_ids.test.ts
tests/localization_fixes.test.ts tests/guide.test.ts; npm run wiki:content (then confirm
the freshness gate is green); npm run ci:changed. Review Dispatch Matrix
(implementation-plan.md): cross-platform-sync (sim_i18n matcher DICTs changed);
frontend-seam-reviewer only if src/ui beyond catalog data changed; architecture-reviewer
only if any src/sim logic (not display data) changed. COVERAGE prompts; apply ALL findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- docs(prd): masterwrought naming audit with per-name verdicts
- fix(content): display-name renames for confirmed IP collisions
- chore(guide): regenerate wiki content for the renamed items

STEP 5 - ACCEPTANCE:
- [ ] naming-audit.md covers every shipped player-visible proper noun with a verdict, and
      every COLLISION has evidence
- [ ] Confirmed collisions renamed display-only; no id changed anywhere;
      tests/shipped_item_ids.test.ts untouched-green
- [ ] S3 guard green; M16 fills present for wordy renames; wiki regenerated and the
      freshness gate green
- [ ] state.md naming registry confirmed or amended per verdicts

STEP 6 - DOCS: progress.md Phase 03 row; state.md ledger (renames applied, registry
amendments, new i18n keys + matcher rules); memory note if anything surprised you.

STEP 7 - REPORT: phase status, files, audit counts (checked / clear / generic /
collisions renamed), validation results, reviewer verdicts, handoff line for Phase 03 QA.

STOPPING RULES: stop and ask if a confirmed collision cannot be fixed display-only (the
name is baked into an id, a deed record, or quest mechanics), or if a borderline verdict
would rename a high-visibility zone: record borderlines in naming-audit.md for the
maintainer instead of guessing.
```
