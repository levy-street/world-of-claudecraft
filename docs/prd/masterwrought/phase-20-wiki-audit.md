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
