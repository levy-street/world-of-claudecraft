# Phase 11l QA: verify the trophy economy

### QA Starter Prompt
```
This is Phase 11l QA of the Masterwrought feature. Phase 11l turned 21 orphaned junk mob
drops into profession reagents without adding a single item id. The audit's centre of
gravity is the Sell Junk trap: if the quality promotion is wrong or incomplete, players
one-click-destroy their own crafting materials at the first vendor, and no ordinary
content test would catch it.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: prove the promotions are complete and correct in BOTH directions, that every adopted
drop has a real consumer at a sensible rung, that the economy pins were derived and not
pasted, and that nothing outside the adopted set moved.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory.

STEP 0 - PRE-FLIGHT: git status clean (Phase 11l committed); SYNC RELEASE per the canonical
workflow (fetch, merge newest origin/release/**, release-merge-audit). Memory scan: the
test-pin trap index (READ it before judging any pin), new-item-content-hidden-obligations,
and the content-obligations cluster.

STEP 1 - LOAD CONTEXT (Explore agent): state.md (the Phase 11l ledger, decision 11 as
answered, the recorded mapping and holdouts), progress.md Phase 11l row,
phase-11l-trophy-economy.md (what was promised), git diff against the phase-start commit,
and every file the diff touched. Also src/sim/items.ts junkSellableSlot,
src/sim/material_taxonomy.ts, src/ui/item_kind_label.ts,
src/ui/material_profession_hint_view.ts.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):

Sweep-safety agent (the phase's highest risk): independently re-derive the set of shipped
kind 'junk' items that appear in a drop table. For EVERY one, state whether it is adopted
or a holdout, and assert junkSellableSlot's return value matches the intent. Prove the pin
is decisive by MUTATION: flip one promoted item back to quality 'poor' and confirm a named
test goes red; restore the tree. A pin that only checks the promoted arm passes on an
empty set and proves nothing, so verify the holdout arm exists and is exercised too.
Then check the OTHER gates in junkSellableSlot that could be used as a lever (noVendorSell,
soulbound, kind 'quest'): the phase should have used quality alone, per the shipped fine
material precedent. If it reached for noVendorSell instead, that is a finding, because
noVendorSell also blocks ordinary vendor selling and would strand the item.

Consumer-reality agent: every adopted item is consumed by at least one recipe, and that
recipe is REACHABLE: its profession exists, its rung is trainable or obtainable, its other
reagents are obtainable at that level, and the rung suits the level the drop comes from. A
zone1 drop feeding a skill-125 capstone is a finding, not a design choice. Check the
reverse too: no recipe references an item id that does not exist.

Economy agent: recompute every pin in tests/recipe_economy.test.ts from the merged
ALL_RECIPES yourself and compare against what was committed. A pasted observed value is a
finding even when it is correct, because the method is what protects the next merge. Verify
the gold-negative property on every touched bill. Verify the gleamstag_charm (sell 2500)
and deepfen_pearl (sell 600) bills are worth more than their inputs, with the arithmetic
present in a row comment as the phase required.

No-new-content agent: prove zero new item ids by diffing the item id set against the
phase-start commit. Prove no id was renamed, no icon key moved, no drop rate or drop table
membership changed, and no binding or soulbound flag changed. This phase's entire value
rests on being a pure reuse of shipped content, so verify that claim rather than accept it.

Surfaces agent: the tooltip reads "Material" for every adopted item;
material_profession_hint_view names the correct profession for each; the bag and vendor
surfaces render sensibly at both desktop and a phone viewport; every new player-visible
string is a t() key with M16 non-Latin fills where the English is wordy; the guide and wiki
regenerated fresh and the freshness gate is green.

Dispatch per the Review Dispatch Matrix: content-obligations-reviewer,
frontend-seam-reviewer, test-coverage-auditor, then qa-checklist LAST. Do NOT dispatch
architecture-reviewer or cross-platform-sync unless the diff actually grew a sim behavior,
facet member or wire field, in which case that itself is the finding.

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 11l
validation set; separate fix commits with explicit paths. The fix round is itself
unreviewed code: have a fresh reviewer pass over the fix diff.

STEP 4 - DOCS: progress.md (Phase 11l QA row), state.md drift (any mapping or pin detail
that moved, the mutation results, the holdout list as verified), memory notes for any
reusable trap found.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, the mutation
kill table itemized, and the handoff to the next phase. Follow-ups are CUT-or-fix
decisions, never future-PR items.
```
