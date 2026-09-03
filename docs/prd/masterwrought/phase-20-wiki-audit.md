# Phase 20 wiki completeness audit (the lane that runs before the fill)

Appended 2026-09-03 under the maintainer's STEP 1 word ("all as recommended + the wiki work").
The guide's generated halves are current by construction (src/guide/content.generated.ts is
zero-diff at the tip; the MediaWiki seed regenerates in the fill lane). The hand-written
prose, 1,923 guide.* keys of which 639 are paragraphs of 120 characters or more (about 53,000
words over the 39 pages under src/guide/pages/), was corrected key by key where a phase changed
a fact and never read whole against the game as it stands after eleven release syncs. This
lane reads it whole. It runs BEFORE STEP 2 of phase-20-release-fill-and-reclose.md because every
correction it lands is a reworded key that mints pending rows, and an audit after the fill
would re-open the staleness the fill closes.

### Starter Prompt
```
STANDING DELIVERY RULE (unchanged): THIS LANE DOES NOT PUSH AND DOES NOT OPEN A PULL REQUEST.
LOCAL ONLY. It ends by naming the next file, never by asking for the push (the push question
belongs to the Phase 20 close, ruling D022).
This is the Masterwrought wiki completeness audit, the lane that runs before the Phase 20 fill.
Model: xhigh effort. ULTRACODE: yes (the audit fans out one fact-checker per guide page with an
adversarial refuter per finding; the execution units and the reviews run as Workflows).

WORKTREE GUARD (FIRST): run pwd. If not in /Users/fernando/Documents/wocc-masterwrought, switch
NOW with EnterWorktree (path: /Users/fernando/Documents/wocc-masterwrought). If it refuses, STOP.
Other sessions work in this worktree: check git status before EVERY commit, commit EXPLICIT paths
only (never git add -A), and treat any modification you did not make as another session's.

STEP 0 - PRE-FLIGHT: git status clean; the newest origin/release/** re-resolved by version sort
(git fetch origin --prune; git branch -r | grep origin/release/ | sort -V | tail -1) and merged
with the release-merge-audit skill if it moved (a moved release moves the prose too: re-inventory
after the merge). Read, in this order: docs/prd/masterwrought/phase-20-fill-package.md (the fill
package this lane feeds, class K in particular), the "maintainer's word at STEP 1" section of
phase-20-release-fill-and-reclose.md, src/guide/CLAUDE.md, the i18n rules in src/ui/CLAUDE.md
(the M16 wordy-copy rule, the contributor policy), docs/design/tooltip-writing.md (the
resolved-values rule applies to guide prose too), and the memory notes i18n-reword-staleness-
blind-spot, phased-packet-qa-cadence, shared-worktree-commit-care. Verify EVERY instruction in
this prompt against the tree before executing and amend defects in place, dated, citing pins by
TEST NAME.

STEP 1 - THE INVENTORY (a Workflow of read-only lanes, absolute paths only): for each of the 39
page modules under src/guide/pages/, the set of guide.* keys the page renders (follow the t()
calls, the bodyKey overrides, the FAQ_ANSWER_KEYS list and any indexed key), each key's live
English (src/ui/i18n.catalog/guide.ts), and the live facts the page's claims rest on (the sim
content tables under src/sim/content/, the profession and recipe rules, the deed and reliquary
catalogs, the mount and zone tables, the pins in tests/guide.test.ts). Return the inventory as
data: {page, keys[], factSources[]}. A key rendered by two pages is audited once and its pages
named.

STEP 2 - THE AUDIT (one fact-checker per page, COVERAGE prompts): every sentence of every prose
key is a claim; classify each claim TRUE (cite the table row, symbol or test that makes it
true), FALSE (the game contradicts it; quote both), INCOMPLETE (the game has something the
claim enumerates and omits: a supplier, a rung, a route, a count), STALE-BY-STYLE (true, could
read better: NOT a defect, record only), or UNVERIFIABLE (no source in the tree: a maintainer
read, never a guess). Numbers are derived from the live tables at audit time, never remembered
(the 19G lesson: a premise false in the direction that changes the menu). Then one adversarial
refuter per FALSE or INCOMPLETE finding, prompted to refute; a finding both agree on is
actionable, a disagreement is judged by you against the tree and recorded either way. The
19F/19G judged lists bind: a claim those phases ruled on is not re-opened here.

STEP 3 - THE EXECUTION (one commit per page unit, dependency order, whole-tree tsc between
units): a FALSE or INCOMPLETE claim in a key that has ever shipped is corrected under the
reword-is-a-new-key convention: the old key joins RETIRED_KEYS in scripts/i18n_retired_keys.mjs
WITH ITS REASON and keeps its reviewed overlay rows; the successor key carries the corrected
English, the page's bodyKey or key list moves to it, its five non-Latin fills ride the same
change (machine-authored under the i18n-locale-fill conventions, fact-checked against the live
sim BEFORE filling, verified by a second agent, registered translated because the registry has
no machine field, and FLAGGED by key in this lane's QA record for the maintainer's read), the
Latin rows are left pending for the fill (never hand-filled), a per-clause pin in
tests/guide.test.ts derives every number and name from the live tables (the 19G shape: an
exact narrowness transform or the whole literal per locale, each clause closed to the others'
items), the census gets its row (docs/prd/masterwrought/merge-deletion-list.md, parsed by
tests/merge_audit_symbol_census.test.ts), and TURBO_FORCE=1 npm run i18n:gen plus npm run
wiki:content are committed in the same change. A key that has never shipped is reworded in
place. Prose follows the game, never the reverse: a game defect the audit exposes is a
maintainer item recorded in the ledger, not a content edit. Headings that enumerate are
claims too (the inscription materialsHeading precedent). The retire-and-re-key trade is named
plainly in the record each time: the Latin locales that carried a translation of the old key
render English until the fill lands.

STEP 4 - REVIEWS AND VALIDATION: fresh typed reviewers over every unit (frontend-seam-reviewer,
content-obligations-reviewer, test-coverage-auditor; qa-checklist LAST over the whole lane),
via the Agent tool, one fresh reader per fix round, every finding applied or refused with the
reason recorded. Then: tsc 0; the guide suites (tests/guide.test.ts, tests/guide_key_coverage
.test.ts), tests/i18n_completeness.test.ts (M16), tests/localization_fixes.test.ts (S3),
tests/i18n_resolved_equivalence.test.ts, the census RESULT: PASS captured without a pipe, npm
run ci:changed exit 0 on the final tip; node scripts/gate_select.mjs on the committed tree,
pg-armed with TEST_DATABASE_URL only (postgres://eastbrook:change-me@localhost:5433/eastbrook;
never export DATABASE_URL), launched from a scratchpad script file in the background with a
done marker and judged by the real GATE_EXIT line; the full-suite reading measured ONCE on the
launch tip first (the art pass and the mount sync moved the 19G count), the lane's delta
PREDICTED from its pins and attributed after the closing gate. I18N_RELEASE_TIER is never set
in this lane.

STEP 5 - DOCS: this file gets its ledger (the inventory counts, every claim verdict by key, the
flagged-fills table for the maintainer's read, the stamps); a "wiki completeness ledger" section
in state.md; a progress.md row; and EVERY reworded key recorded BY KEY under class K of
phase-20-fill-package.md with its successor, so the fill session's worklist and commit-walk
audit find nothing this lane did not name.

STOPPING RULES: never hand-fill a Latin row; never edit a sim or content table to make prose
true; never guess a fact the tree cannot show (record UNVERIFIABLE); every judged list in
phase-19*-qa.md binds; R5 stays frozen; the D168 harvest stays escalated; any red gate step;
NO push, NO PR, NO teardown.

REPORT: the inventory (pages, keys, claims), the verdict counts by class, every reworded key
and its successor, the flagged fills, the review record, the stamps, the maintainer items, and
NEXT = docs/prd/masterwrought/phase-20-release-fill-and-reclose.md STEP 2 in a FRESH session,
which begins by regenerating the worklist and re-running the commit-walk staleness audit.
```

### Amendments at execution (2026-09-03, verified against the tree at f93217ccc8 before STEP 1 ran)

Each item corrects one line of the Starter Prompt above; the prompt stays as written and
these read with it.

1. STEP 0, the sync: origin/release/v0.42.0 is the newest release by version sort and its
   tip 1fdf0f55a3 is already an ancestor of HEAD (the Mech Bird mount sync 0fd5390dbb);
   `git fetch origin --prune` brought nothing. No merge, no release-merge-audit, no
   re-inventory: the no-op, the same shape as the Phase 20 doc's amendment 1.
2. STEP 0, the census at the launch tip reads RESULT: FAIL, before any change of this lane:
   one unexplained EXTRA, `gateMountSwapOnCompile` in src/render/mount_lifecycle.ts, a name
   present on NO parent because it was authored INSIDE the mount sync merge commit
   9ba72f3cb7 (the maintainer's art session, 2026-09-03 08:30; `git blame` attributes the
   line to the merge itself and `git log -S` finds no non-merge commit, the evil-merge
   shape the census exists to catch). It is live (tests/mount_lifecycle.test.ts imports and
   exercises it), so the repair is its explained-extras row in merge-deletion-list.md, a
   STEP 0 rider of this lane; STEP 4's 'the census RESULT: PASS' is measured against that
   rider. The row is parsed by tests/merge_audit_symbol_census.test.ts
   (`parseExplainedExtras`).
3. STEP 1, 'the 39 page modules under src/guide/pages/': 39 FILES, of which index.ts
   (the PAGES registry), types.ts and ui.ts (shared helpers) are not pages; 36 page
   modules (the 31 routed pages of `PAGES` plus the five professions_* sub-modules the
   professions page composes). The audit's unit is the RENDERED SURFACE, not the file: 59
   surfaces (31 routes, 9 class details, 18 profession sub-pages from `GUIDE_PROF_PAGES`,
   and the chrome: nav, head meta, search, breadcrumbs, TOC, placeholder, not-found), driven
   the way tests/guide_key_coverage.test.ts drives them ('renders every catalog key that is
   not explicitly retired or off-sweep'), with a wrapped t() recording the keys per surface.
4. STEP 1, the counts: 1,923 guide.* keys resolve in the English slice; 1,832 render on at
   least one surface and the remaining 91 are exactly RETIRED_KEYS (80 guide keys) plus
   LIVE_OFF_SWEEP_KEYS (12) minus their one overlap-free union as the coverage sweep
   allows them (verified: zero unrendered keys outside the two allowlists). 639 catalog
   keys are prose of 120+ characters (52,938 words); 624 of them render (the other 15 are
   retired). 491 rendered keys are shared by two or more surfaces: each is audited ONCE on
   its primary surface (the largest page that renders it) with the other surfaces named,
   the prompt's rule. Lanes: 48 (the nine class details, the classes chooser, the models
   page and the home page fold into one lane; the chrome lane keeps only the 47 keys no
   page renders; prof:logging and prof:herbalism keep two keys each because the shared
   gathering prose lands on the farming and mining lanes).
5. STEP 2, 'one fact-checker per page': one per LANE (48), and under ULTRACODE two finders
   per lane with different lenses (a claim-by-claim reader and a numbers-names-enumerations
   extractor), deduplicated by (key, claim) before the adversarial refuters.
6. STEP 4, the launch-tip measurement: taken at f93217ccc8 with the gate's own form (npm
   test -- --maxWorkers=8, WOC_SKIP_PRETEST=1 after the artifacts regenerated zero-diff,
   TEST_DATABASE_URL only). A first launch was stopped and restarted because a scratch
   inventory test under tests/ (deleted after one run, never committed) could have been
   globbed into the count; the reading recorded below is from the restart.
7. STEP 0 reads: `TURBO_FORCE=1 npm run i18n:gen` and `npm run wiki:content` are zero-diff
   at the launch tip; the registry reads 14,455 pending rows, the figure the Phase 20 doc's
   maintainer's-word section records.
8. STEP 2, the execution shape, amended mid-lane after two infrastructure failures (both
   recorded here because they changed how the audit ran, never what it checks):
   - The first fan-out died whole: 144 agents, every one refused at spawn by an
     authentication expiry, zero tokens spent and no findings lost. Relaunched after a
     single probe agent proved spawning worked again.
   - The second died on the account's rolling session limit: 755 agents spawned, 17
     returned, and the one-shot retry around every agent turned a single outage into a
     doubled spawn count. Every completed agent's result was harvested from the run
     journals (7 lanes with both lenses, 3 with one, 277 findings), so the work that
     finished was kept.
   - The audit therefore runs as SEPARATE bounded workflows: find batches of about ten
     lanes, then refute batches, harvesting to disk between them, so a limit costs one
     batch rather than the lane. The retry is dropped from the find batches, where a
     harvest-and-rerun of the named missing lanes is both cheaper and exact.
9. STEP 2, 'one adversarial refuter per FALSE or INCOMPLETE finding': amended to one
   refuter per SMALL SAME-LANE GROUP, four findings for a FALSE and eight for an
   INCOMPLETE or UNVERIFIABLE, with every finding judged independently and returning its
   own verdict, evidence, corrected verdict and severity. The measured finding rate (277
   over the first ten lanes, 1,234 projected over 48) puts one agent per finding beyond
   what the session limit will pass, and the findings-per-key mean of 1.6 means per-key
   batching saves nothing. Grouping by lane shares the table lookups the refuters would
   each repeat, not their verdicts; a group of four is still four independent
   re-derivations against the live tree.
