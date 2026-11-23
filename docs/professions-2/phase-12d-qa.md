# Phase 12d QA: Verify Provenance and the harvest loop

Audits the Phase 12d diff: the identical-payload merge at all four points, counted
instanced stacks across every consumer, the provenance surfaces, the unified
loot-and-harvest flow against the verified corpse lifecycle, mail expiry, and the two
companion bug fixes.

## QA Starter Prompt

```
This is Phase 12d QA of the Professions 2.0 feature: verify Provenance and the harvest
loop.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: audit the Phase 12d diff for correctness, missing tests, determinism, three-host
parity, i18n completeness, and inventory-integrity safety.

STEP 0 - PRE-FLIGHT: run git status; the tree must be clean; stop if dirty with work you
did not create. Memory scan (MEMORY.md index): node25-breaks-jsdom-gate, the professions
packet entries, big-diff-reviewer-turn-budgets (hard tool budgets + report-first for
every spawned reviewer).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly): spawn one Explore agent to
read and summarize: docs/professions-2/state.md (the provenance rulings and the as-landed
Phase 12d surfaces entry), docs/professions-2/progress.md,
docs/professions-2/phase-12d-provenance-stacking.md including its as-landed lifecycle
block, and git diff <phase-start>..HEAD. The summary must return: the deliverables and
acceptance criteria, the merge-rule symbols as landed, the verified corpse lifecycle as
recorded, every file touched, and the applicable validation rows.

STEP 2 - QA AUDIT: spawn parallel agents, each given ONLY the Explore summary, each with
a hard 30-tool-call budget and report-first framing:
- Inventory-integrity agent (the hardest charter): hunt dupes and losses around counted
  instanced stacks. Probe: partial-stack trades both directions; a trade where both sides
  offer same-payload stacks; removeItem end-backward consumption across a mixed
  plain/instanced inventory; enchant consumption from a counted stack; bank
  deposit-merge and withdraw-split; vendor sell of a counted stack; save/load and wire
  round trips; conservation must hold in every probe (count the items before and after).
- Lifecycle agent: drive loot-then-harvest, harvest-then-loot, denial of each half
  (tool tier, full bags), the town-focus default and picker override, claim races
  between two players, and respawn timing against the pinned state machine; a corpse
  that can strand or a respawn hostage to cleanup is BLOCKING.
- Provenance agent: Gathered by versus Crafted by across every signer source (node
  gather, corpse rare+, specimen, masterwork, enchant-carried); the marker on desktop
  and mobile shots; the downgrade notice fires on the exact full-bag boundary and never
  otherwise; the S3 guard.
- Companion-fix agent: reproduce the pre-fix #2139 overflow seed class and prove it
  fixed; force-rename a character with signed items everywhere (bags, bank, mail
  escrow, trade-received copies, equipped eqi) and prove every signer string, the
  self-signed discount, and battlefield attribution follow the new name.
- Mail agent: expiry at exactly the boundary, the single return cycle, deletion only
  after it, system-mail exemption by class (author a new system letter and prove it
  never expires without touching an id list), pre-existing mail clocks starting at
  deploy, and the full-mailbox return case.
Also spawn review agents per the Review Dispatch Matrix (cross-platform-sync for the
wire, privacy-security-review for the rename sweep, qa-checklist). COVERAGE, not
filtering; resume truncated agents.

STEP 3 - FIX: apply every BLOCKING and SHOULD-FIX finding test-first; rerun failed rows
until green; commit with explicit paths, Conventional Commits with a body.

STEP 4 - UPDATE DOCS + MEMORY: progress.md QA row and verdict; state.md drift
corrections; append the QA post-inventory to the phase file's as-landed block; record
surprises to memory.

STEP 5 - FINAL RESPONSE FORMAT: verdict PASS / PASS-WITH-FOLLOWUPS / FAIL; findings by
severity, fixed versus deferred; deferrals with reasons; a one-line handoff to Phase 13.

STOPPING RULES: stop if any probe shows item duplication or loss (conservation is
non-negotiable); stop if a fix would require re-opening a locked provenance ruling; stop
if the tree is dirty with work you did not create.
```
