# Phase 11n QA: verify the vendor floor

### QA Starter Prompt
```
This is Phase 11n QA of the Masterwrought feature. Phase 11n lowered the vendor consumable
line so crafted output wins by a margin that widens with rung. The audit has two centres of
gravity: that no crafted magnitude rose (the entire R5-safe premise), and that the nerf did
not strand a levelling band or a new player who has no access to a crafter.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: prove the floor exists, prove it is a floor and not a cliff, prove the ceiling did not
move, and prove the invariant would catch a regression.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory.

STEP 0 - PRE-FLIGHT: git status clean (Phase 11n committed); SYNC RELEASE per the canonical
workflow. Memory scan: the test-pin trap index (READ before judging any pin).

STEP 1 - LOAD CONTEXT (Explore agent): state.md (the Phase 11n ledger, decision 13 as
answered, the pairing table before and after, the both-sourced decisions, the levelling
sanity check), progress.md Phase 11n row, phase-11n-vendor-floor.md (what was promised),
git diff against the phase-start commit, and docs/design/spell-balance-framework.md.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):

Ceiling agent (the load-bearing claim): prove NO crafted magnitude rose anywhere in the
diff, by sweeping every potionHp, potionMana, foodHp, drinkMana, elixir and wellFed value
against the phase-start commit. The phase's whole claim to leaving R5 alone rests on this,
so verify it rather than accept it. Any crafted increase, however small, is BLOCKING and
hands the phase to Phase 15 rather than being absorbed here.

Floor-not-cliff agent: for every levelling band, confirm a player with no crafter, no gold
beyond vendor prices, and no market access can still buy a consumable that meaningfully
works at that level. Walk the bands, not just the top. Check that the nerf was weighted
toward the top rungs as the phase required, and that the bottom rung moved least. A vendor
line that is technically present but functionally useless at low level is the failure mode
here and no test will report it.

Invariant-decisiveness agent: prove tests/vendor_floor.test.ts fails on a real regression by
MUTATION (raise one vendor value into the band, expect red naming the pair; restore). Then
check the trap index classes: does it pass on an empty pairing set, does it derive the
required margin from the same source it is checking (constant-self-comparison), does it
verify the monotonic-widening claim or only the per-pair minimum. Verify the both-sourced
allowlist arm actually refuses a NEW both-sourced id rather than merely listing existing
ones.

Pairing-completeness agent: independently re-derive the vendor-to-crafted pairing table and
compare against the phase's. A pair the phase never noticed is a gap the invariant cannot
see, because the test only checks pairs it knows about. Pay particular attention to
consumables that are not potions: food, drink, elixirs, scrolls, anything with a magnitude
sold by any vendor.

Copy and surfaces agent: no player-visible string, tooltip, guide page or wiki row asserts a
magnitude that moved; the wiki regenerated where needed and the freshness gate is green;
every changed value that renders is localized through t().

Dispatch per the Review Dispatch Matrix: content-obligations-reviewer,
test-coverage-auditor, then qa-checklist LAST.

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 11n
validation set; separate fix commits with explicit paths. The fix round is itself unreviewed
code: have a fresh reviewer pass over the fix diff.

STEP 4 - DOCS: progress.md (Phase 11n QA row), state.md drift (any margin or pairing that
moved under the fix round; the band-by-band floor verdict), memory notes for any reusable
trap found.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, the mutation
kill table itemized, the explicit statement that no crafted magnitude rose (or the BLOCKING
finding that one did), and the handoff to the next phase. Follow-ups are CUT-or-fix
decisions, never future-PR items.
```
