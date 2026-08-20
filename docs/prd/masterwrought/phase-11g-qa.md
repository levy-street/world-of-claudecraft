# Phase 11g QA: verify the provisioning supply line, leveling tier

### QA Starter Prompt
```
This is Phase 11g QA of the Masterwrought feature. Phase 11g was a wide, low-judgment content
edit with one high-judgment property: every change had to be an ADDITION. This audit is about
proving that nothing moved over, that every added row is reachable by a player who has never
farmed, and that the pins which would catch a mistake were recomputed rather than pasted.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: prove that no bill became gold-positive, that no herb, fish, meat, or salt count fell
anywhere in the tree, that every added reagent is market-listable and obtainable at the tier
where its recipe unlocks, that the economy literals were recomputed from the merged
ALL_RECIPES, and that a new player can still complete every rung of both ladders.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT: git status clean (Phase 11g committed); SYNC RELEASE per the canonical
workflow (fetch, merge the newest origin/release/**, run the release-merge-audit skill).
Memory scan: the test-pin trap index (READ it before judging any pin: predicted-then-observed,
constant-self-comparison, comment-gameable source pins, vitest -t is a regex), the i18n
reword-staleness entry, new-item-content-hidden-obligations, release-merge gate surprises.
Read the RECORDED ANSWERS to decisions A, B, and C in state.md FIRST. This audit judges the
code against the answers that were given, not against the recommended defaults, and a
code-versus-ruling mismatch is blocking on its own. In particular, if decision A came back as
reading 1 (the default), then a buyValue added to any produce def or a new row in any NPC's
vendorItems is a ruling violation, not a tuning choice. And check decision C both ways: if the
answer was "here", recipe_seasoned_stock must carry produce in this diff; if the answer was
"11h", it must carry none and the ledger must say so by name. Either state is correct, an
unrecorded one is not, and a row edited under an answer that says the other phase owns it is
blocking.

STEP 1 - LOAD CONTEXT (Explore agent): state.md (the Phase 11g ledger: the three decision
answers, the per-row table with derivations, the recomputed pin table, the band-literal
verdict, the reworded i18n keys), progress.md's Phase 11g row,
phase-11g-supply-line-leveling.md (what was promised, including the three RULES and the
VERIFIED NON-MOVERS list), farming/state.md (D9, D11, D24), the git diff against the
phase-start commit, and every file the diff touched. Also load the phase-start versions of
src/sim/content/recipes.ts and tests/recipe_economy.test.ts, because several arms below are
before-and-after comparisons rather than reads of the current tree.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):

Rule-conformance agent: walk every reagent this phase added and check all three RULES against
the live tables, not against the ledger. RULE 1, farmCropSkillThreshold(crop.tier) at or below
recipe.skillReq for EVERY produce-consuming recipe in merged ALL_RECIPES, including rows this
phase did not touch, since the pin is a sweep and a pre-existing violation would be this
phase's to surface. RULE 2, every produce count strictly below the row's largest non-produce
count. RULE 3 belongs to the displacement agent. Then the R17 exclusions: no produce id in
recipe_quickening_catalyst, in any gear intermediate (billet, plating, cording, bolt, setting,
chassis, lucent reagent, sablewax vellum), or in any Perfecting material, checked as a sweep
over the derived produce set rather than by reading the ids the ledger names. Confirm the
produce set is derived from the live FARM_CROPS table and not hand-listed, or the sweep goes
blind the day 11e's roster grows again.

Displacement agent (R18 and D24; this is the phase's promise and it gets a diff, not a read):
take the phase-start reagent arrays and the current ones for EVERY recipe the diff touched and
account for every entry. No herb count, no fish count, no meat count, and no salt count may
have fallen anywhere, and no reagent may have been removed. Then widen: diff the three herb
totals (silverleaf_herb, goldleaf_herb, sunpetal_herb) across all of ALL_RECIPES between the
two trees and confirm each is unchanged or higher. Confirm the totals pin in the new suite was
PREDICTED then observed rather than pasted from a run, and confirm the per-row herb literals
exist beside the totals, because totals alone can be gamed by moving an herb between rows.

Economy agent: recompute every touched bill's inputValue and outputValue from the live merged
tables using the recipe_economy unit basis (buyValue when above zero, else sellValue) and
confirm every one is strictly gold-negative with a wider margin than before. Confirm the
monotonicity claim is actually true in this diff, meaning no outputValue changed: grep the
diff for any sellValue, resultCount, foodHp, elixir, wellFed, or duration edit and require
zero hits. Confirm the counterfactually-vendor-fed membership is the same six ids under
decision A reading 1, that its non-vacuity floor is intact, and that the live-stock emptiness
arm is still green. Then MUTATE rather than read: change one count in recipe_seasoned_stock's
bill and confirm the INTERMEDIATE bill literal reds; a green run means the literal was
pasted from the new tree instead of recomputed, which is exactly the failure this phase was
warned about. Confirm no id was added to LEGACY_GOLD_POSITIVE_RECIPE_IDS.

Completability agent (the new-player arm, proven and not argued): for every rung this phase
touched in both crafts, name the obtaining route for every added reagent and PROVE it, one of
three and no others. (a) An NPC counter row: assert through Sim.buyItem that the item is
purchasable at its NPC with a positive buyValue, since D11's dead-row trap means a row without
one renders and then refuses. (b) A vendor-stocked seed whose crop tier the player clears at
that rung: assert the seed row, its positive buyValue, and farmCropSkillThreshold against the
recipe's skillReq (growth is wall-clock gated, so assert the gate and the counter, never a
timer). (c) Market-listable: assert kind 'junk' and the absence of noMarketList. Then drive the
craft itself through the real sim: grant the exact live reagent list, resolveCraft, assert ok.
If decision B allowed tier 3 produce at rung 50, verify GATE 1 in the CODE by reading
farmer_hollis's vendorItems, not by trusting the ledger; an unstocked tier-3 seed under a
tier-3 rung is blocking.

Test-decisiveness agent (mutate; a green suite after any of these is BLOCKING): delete one
added produce reagent from one touched row and require a red. Swap an herb for a crop on one
row, keeping the reagent count the same, and require a red from the displacement pin. Move a
tier-3 crop onto a rung-25 row and require a red from the tier-gate pin. Add a produce id to
recipe_quickening_catalyst and require a red from the exclusion sweep. Add a produce reagent to
a fish row until produce outnumbers fish and require a red from the fish-forward pin. Then
check the tier-gate pin is not a constant-self-comparison: it must call farmCropSkillThreshold
on one side, never re-type (tier - 1) * 25 on both. Confirm the rung-coverage arm cannot pass
vacuously (it must assert a non-empty set at each rung, and the outside-FARM_RECIPES arm must
be a separate assertion, not a filter that can empty).

Generated-artifact and i18n agent: confirm src/guide/content.generated.ts was produced by
npm run wiki:content and not hand-edited, and that tests/guide.test.ts freshness is green.
Read the reworked prose rows and check each against the shipped bills: the cooking materials
heading and body must name the third supplier, the alchemy materials body likewise, and
farming's farm.bedsBody sentence must say what the produce now feeds. Confirm the farm route
clause about "a later patch's deeper fields" was NOT touched here (it is 11e's). Confirm every
reworded key is on the release-tier fill worklist in state.md by key, since a filled row whose
English changed still reads as filled. Confirm no locale overlay under src/ui/i18n.locales/ was
edited, no key was minted without a catalog row, and the S3 guard is green.

Cleanup and boundary agent: no new item id and no new recipe id (tests/shipped_item_ids.test.ts
green, and the diff carries no ItemDef change at all). LADDER_RECIPES still 54 rows, nine per
craft, three per rung. INTERMEDIATE_RECIPES still 10 rows. No parity golden in the diff and the
parity suite unmoved. No file under src/sim outside content/ in the diff, or a stated reason if
one is. Then the boundaries: the three role plates still carry byte-identical bills (11h's to
change), no fish was added anywhere (11i's), no deed and no Reliquary page was minted (11k's),
and the Well Fed ladder is untouched (11c's, settled). Confirm the NIL obligation list is
PROVEN in the report rather than skipped: zero art rows, zero M16 fills, zero world_entity_i18n
rows, and a written verdict for deeds, Reliquary, and R15 naming.

Dispatch per the Review Dispatch Matrix: content-obligations-reviewer, frontend-seam-reviewer,
plus qa-checklist (phase-completion gate). Add architecture-reviewer only if a file under
src/sim outside content/ is in the diff. Confirm the phase report's stated review SKIPS
(privacy-security-review, migration-safety, database-performance-reviewer, cross-platform-sync)
are each justified by the diff rather than by the phase's expectation of the diff. COVERAGE
prompts.

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 11g validation
set including the full suite and the parity suite; separate fix commits with explicit paths.
The fix round is itself unreviewed code: have a fresh reviewer pass over the fix diff. A fix
that changes any OUTPUT value (foodHp, a wellFed payload, an elixir value or duration, a
resultCount, an output sellValue) reopens 11c and Phase 15 and STOPS the phase instead of
landing. A fix that adds a buyValue or a vendor row reopens decision A and stops the phase the
same way.

STEP 4 - DOCS: progress.md (the Phase 11g QA row), state.md drift (any row, count, derivation,
or pin that moved during the fix round, and the final recomputed pin table),
farming/state.md if a D24 or OPEN-row note needs correcting, memory notes for anything that
surprised you.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, the mutation
results stated one by one (which mutation redded which pin), the three obtaining routes named
per added reagent, and the handoff to Phase 11h. That handoff MUST restate decision C's answer
in one unambiguous sentence: THIS phase owns recipe_seasoned_stock (11g-D-C lands marsh_rice
2 plus bog_beet 2 there), and 11h's 75 rung is VERIFY ONLY, its former GATE F having been
dropped by 11h-GATE-F in the reconcile (corrected 2026-08-20, qr-DOC-DRIFT, state.md row
132: this paragraph formerly described 11h as still claiming the row, which was stale
against the settled record and would have handed the next session a dead premise). A
handoff that leaves the row ambiguous is a FAIL on its own,
since the failure mode is two phases editing one bill. Follow-ups are CUT-or-fix decisions,
never future-PR items.
```
