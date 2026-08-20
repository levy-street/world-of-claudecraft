# Phase 11m QA: verify the harvest geography and material sinks

### QA Starter Prompt
```
This is Phase 11m QA of the Masterwrought feature. Phase 11m spread scarce component tags,
mapped two orphan tags, and gave a dead-end reagent rung real consumers, all as data edits
over shipped content. The audit's centre of gravity is the concentration-bonus interaction:
tag membership is not a local edit, and a spread that looks correct per material can still
have re-tuned harvest payouts on every mixed template that carries the tag.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: prove the geography floor is genuinely met (not met on paper by tagging templates a
player cannot reasonably reach), prove the concentration movement was reported and is
within the shipped bound, prove the new invariants are decisive, and prove nothing outside
the authorized surface moved.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory.

STEP 0 - PRE-FLIGHT: git status clean (Phase 11m committed); SYNC RELEASE per the canonical
workflow. Memory scan: the test-pin trap index (READ before judging any pin), the
content-obligations cluster.

STEP 1 - LOAD CONTEXT (Explore agent): state.md (the Phase 11m ledger, decision 12 as
answered, the three censuses before and after, the per-template concentration deltas, the
reagent sweep), progress.md Phase 11m row, phase-11m-harvest-geography.md (what was
promised), git diff against the phase-start commit, plus
src/sim/content/professions.ts, src/sim/professions/gathering.ts
(harvestConcentrationBonus), and tests/mob_component_tags.test.ts.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):

Reachability agent (the finding most likely to be missed): the floor says every mapped
family reaches N templates across N zones and two level bands. Verify the floor is met by
templates a player at the relevant level can ACTUALLY reach and kill in normal play, not by
templates that happen to carry the tag in a raid, a dungeon boss, a one-off event spawn, or
a zone gated behind content most players have not opened. A floor met by unreachable
sources is the same bug with a green test. Walk each newly-tagged template: where does it
spawn, at what level, how many spawn points, is it a trash mob or a named or a boss.

Concentration agent: independently recompute harvestConcentrationBonus for every template
whose tag list changed, before and after, and compare against the deltas the phase
reported. Any unreported movement is a finding. Verify the shipped bound (a corpse never
out-pays the tag list it advertises) holds on every touched template, and that
tests/mob_component_tags.test.ts is genuinely exercising the changed templates rather than
passing on an unrelated subset.

Invariant-decisiveness agent: prove BOTH new tests fail on a real regression by MUTATION,
not by reading them. Remove one tag from one template and require the R22 suite to go red
naming that family; drop the LAST consumer of some material and require the demand-floor
arm to go red naming that material (corrected 2026-08-20, qr-11m-QA, state.md row 126: the
arm is presence-only, so dropping one arcane_shard consumer of twelve leaves it green and
the mutation as originally written yields a false not-decisive verdict; pick a material
with exactly one consumer, or remove all of one material's consumers in the scratch copy);
restore the tree after each. Then check the classic vacuous-pin
traps from the trap index: does the test assert against a constant derived from the same
source it is checking, does it pass on an empty set, does it check only one direction.

Sink-reality agent: the arcane_shard consumers added must be at the rung that PRODUCES the
material, which was the whole diagnosis. A consumer three rungs below (another skill-25
charm) would restate the original fault. Verify the rung, verify the recipes are reachable,
and recompute the demand ratio yourself rather than trusting the ledger. Then spot-check
the full reagent sweep: pick two materials the phase reported as needing no action and
verify that independently.

Scope agent: prove zero new mobs, zero new spawn points, zero drop-rate edits, and ZERO new
item ids of any kind, by diffing against the phase-start commit. ANY new item id is a
BLOCKING finding (corrected 2026-08-20, qr-11m-QA, state.md row 126: decision 12 as settled
REJECTED minting and maps both orphan tags to shipped ids, so the earlier "authorized
orphan material" tolerance here was stale; there is no authorized mint to verify
obligations for).

Dispatch per the Review Dispatch Matrix: content-obligations-reviewer,
test-coverage-auditor, then qa-checklist LAST. Do NOT dispatch cross-platform-sync or
architecture-reviewer unless the diff actually grew sim behavior, a facet member or a wire
field, in which case that is itself the finding.

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 11m
validation set; separate fix commits with explicit paths. The fix round is itself unreviewed
code: have a fresh reviewer pass over the fix diff.

STEP 4 - DOCS: progress.md (Phase 11m QA row), state.md drift (any census, delta or ratio
that moved under the fix round; the reachability verdict per newly-tagged template), memory
notes for any reusable trap found.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, the mutation
kill table itemized, the reachability verdict, and the handoff to the next phase.
Follow-ups are CUT-or-fix decisions, never future-PR items.
```
