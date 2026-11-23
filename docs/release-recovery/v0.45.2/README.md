# v0.45.2 hotfix recovery audit

Historical audit of PR #4632, based on main `c223b64f3a2e` and recovery
commit `c6f458756f3`. The follow-up in this directory records the stronger
completeness pass and the additional Warfare confirmation fix it found.

## What the second pass established

- Every commit in `df38fa734f5d..0c8e1057848d` has a disposition in
  [ledger.json](ledger.json): 152 ordinary commits and 80 merges. The earlier
  feature ledger listed only 86 selected implementation commits.
- All eight v0.44.0 through v0.44.7 tag trees exactly match their release branch
  tips. Auditing branch contents did not omit a separate tagged release tree.
- Of the 80 merges, 69 reproduce with no resolution delta. Ten have explicit
  resolution reviews. One slow automatic remerge was replaced by a combined
  diff and two-parent review: `2a100baf188c` has only the generated pending
  translation registry in its dense combined diff. Its Warfare behavior was
  also checked through the source comparison and live HUD regression.
- The added-line comparison produced 162 substantive lines across 50 files
  needing explanation. The retained-deletion comparison produced 124 matches
  across 29 files. Each has a recorded review; matching a line somewhere in a
  file is a triage signal, not proof of equivalent behavior.
- A separate whole-file boundary check compared v0.43.3, v0.44.0 and the recovery
  candidate. It found no production source file reverted wholesale to its
  pre-v0.44 content. Five absent files have explicit later removals: the two
  old Harbormaster asset builders, the Gloamveil face veil, and the intentionally
  removed hoard guest-cap/rescaling modules.
- Newly imported bindings were checked for missing consumers. The only missing
  runtime connection found was the Warfare formatter below. Two unused PvP
  imports are redundant with newer inline/type-facet implementations.

## Additional confirmed omission

Source commit `079af25b284b` made Season 1 Warfare gear cost gold and changed
its purchase confirmation accordingly. The first recovery restored the
formatter but retained main's inline Honor-only HUD body while composing
companion purchases. As a result, a Furyforged Warhelm costing 17 gold displayed
"0 Honor" in the confirmation dialog.

The regression now drives the actual `Hud.requestWarfarePurchase` method through
`Hud.prototype`, captures the dialog, and checks gold, Honor and companion
offers. It also proves that no purchase command fires before acceptance.
The fix calls the shared formatter and extends it to preserve companion names
and their Honor price. No prices or charging behavior changed.

Verification:

- The live HUD test failed with the wrong currency before the fix.
- `npx vitest run tests/warfare_purchase_confirm.test.ts tests/monolith_budget.test.ts --experimental.fsModuleCache=false --maxWorkers=1`
  passed all 29 tests after the fix and fixture correction.
- `tests/warfare_vendor_window.test.ts` and `tests/vendor_buddy_purchase.test.ts`
  passed in the preceding focused run with the same production fix. Together
  the four suites cover 87 tests. The intermediate failure was an incorrect
  expected companion display name in the new fixture, corrected to the existing
  "Tug, the Warhorse" name.
- Focused Biome checks passed with warnings; `npx tsc --noEmit` passed.
- `npm run build:bundle` passed after the formatter fix.
- The screenshot-reference sparse-checkout guard passed after the audit files
  were added (one selected test; 26 unrelated tests skipped).

## Retained decisions

The recovery retains main's 3-hour hill recurrence, 45-minute duration,
10% flagged XP and no flagged reputation bonus. Hill bounty takes priority over
world bounty: a 20 Honor hill bounty pays 20. Newer account-based friendships,
atomic reward claims, queued difficulty changes, resurrection timing, companion
offers, dependency versions and asset provenance remain in place.

The ledger distinguishes original source content, deliberate supersession,
regeneration, restored changes and current test adaptations. Historical screenshot
changes use separate directory/file fields under their source commit; they are
an inventory, not new runtime or test dependencies on those image directories.

## Evidence boundaries

This closes the commit-accounting gap for the post-v0.44.0 hotfix graph. It does
not claim a fresh semantic audit of all 1,286 commits introduced between
v0.43.3 and v0.44.0, nor prove every runtime interaction correct.

Reuben confirmed that Crucible is not an issue. It is cleared from the recovery
scope; no Crucible gameplay change is required.

The local full gate remains blocked by the
bundled ffprobe architecture mismatch and the unchanged Studio missing-Git-object
lookup timeout. The earlier PR revision also had two CI long-simulation
timeouts, not assertion mismatches, in `eastbrook_gameplay_integration` and
`owned_class_raid_sustain_bands`. Full CI is still a separate acceptance bar.

The ledger's cached test evidence is suite-level and may include skipped opt-in
bodies. Named focused reruns and disposable PostgreSQL integration runs take
precedence. No merge or deployment is implied by this audit.

## Reproducing the inventory

```sh
git log --no-merges --format='%H %s' df38fa734f5d..0c8e1057848d
git log --merges --format='%H %P %s' df38fa734f5d..0c8e1057848d
git show --remerge-diff <merge>
git show --cc <merge>
git diff origin/release/v0.44.0 origin/release/v0.44.7 -- <path>
git diff origin/release/v0.44.7 <candidate> -- <path>
git ls-tree -r <revision>
```

For each historical fix, review its actual postimage and the candidate's live
consumer, not just ancestry, patch IDs or a matching helper definition. The
Warfare omission is the concrete reason this last step is required.
