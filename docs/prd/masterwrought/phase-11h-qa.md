# Phase 11h QA: verify the provisioning supply line at the apex tier

### QA Starter Prompt
```
This is Phase 11h QA of the Masterwrought feature. Phase 11h put farm produce into the
bills the raid actually eats and drinks, differentiated three bills that were
byte-identical since Phase 10, and gave the two tier-4 fine twins their first endgame
consumer. IT MINTED ZERO NEW ITEM IDS: the three apex feasts were CUT from 11h on
2026-08-20 (11h-GATE-E) and belong to Phase 11k at cooking 125, and recipe_seasoned_stock
was dropped to 11g (11h-GATE-F, executed there as 11g-D-C). A diff that mints a feast, a
feast pattern, or any new item id is a BLOCKING finding in this audit, not a bonus. Two
things make it strict: the phase
edits SHIPPED rows rather than only appending new ones, so a slip changes content that
already has pins pointing at it; and the gear firewall it asserts is the one guardrail
standing between R17 and a wall-clock-gated input in front of the packet's pacing gate.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: prove the three plates are genuinely differentiated and every crop they name is
obtainable at the rung its recipe unlocks, that no herb or meat count was dropped anywhere,
that the fine twins now have a real consumer, that recipe_quickening_catalyst is untouched,
that the firewall sweep is derived and actually bites, that the economy pins were
recomputed rather than hand-merged, and that R5 was not moved.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT: git status clean (Phase 11h committed). SYNC RELEASE per the canonical
workflow (fetch, discover the newest origin/release/** by version sort, merge,
release-merge-audit). Memory scan: the test-pin trap index (READ it before judging ANY
pin), new-item-content-hidden-obligations, item-art-ownership-batch-xor-entries, the i18n
reword-staleness entry, the gate-env DATABASE_URL entry, and the "apply ALL findings"
standing rule.

STEP 1 - LOAD CONTEXT (Explore agent): docs/prd/masterwrought/state.md (R5, R8, R13, R14,
R15, R17 to R20, the naming registry, and the Phase 11h ledger as written),
farming/state.md (D11, D16, D21, D24, deviations (ad), (bo), (bz), (ca), and the OPEN
list), progress.md's Phase 11h row, phase-11h-supply-line-apex.md (what was promised,
including its six gates, its R5 block, and its explicit scope records), git diff against
the phase-start commit, and every file the diff touched. Also read the 11g ledger, because
this phase claims to continue one ladder authored bottom up and a contradiction between
the two halves is a finding here, not later.

STEP 2 - QA AUDIT (parallel agents; prompt for COVERAGE, not filtering):

Differentiation and obtainability agent: the three role plates carry three DISTINCT crop
ids, one per plate, and the differentiation is real rather than cosmetic (read the three
bills side by side and say what a player would see). Each crop matches its plate's role
flavor as far as the merged roster allows, and where the roster forced a compromise the
ledger says which gate default was taken and why. THE CHECK THAT MATTERS MOST: every crop
named is OBTAINABLE at the tier its recipe unlocks, proven against
farmCropSkillThreshold's derived 25-point band math (tier 1 at 0, tier 2 at 25, tier 3 at
50, tier 4 at 75) and against a live seed source, not against a ledger claim that one
exists. A tier-4 crop in a cooking-100 bill asks farming 75; farming's maxSkill is 100, so
confirm the reach. Confirm the GATE A header amendment landed in the same change, so the
uniform-bill rule as written no longer contradicts the rows beneath it, and that the
recorded cost spread across the three added rows is pinned rather than merely stated.

Guardrail agent (R17 and R18, the two rulings this phase is most able to breach): NO herb
or meat count dropped anywhere, asserted per touched bill as a before-and-after number
rather than argued (R18, and farming's D24 displacement guardrail: herbalism loses
nothing). Every farming row was ADDED beside its herb or meat row, never substituted for
one. Every produce id consumed stays kind 'junk' and market-listable, and nothing this
phase touched made any produce soulbound or unlistable. Then the firewall: the sweep
EXTENDS tests/provisioner_firewall.test.ts, the file 11f created (qr-R17-SWEEP, state.md
row 131), and a sibling R17 file anywhere else is a finding on its own; the sweep is
DERIVED from FARM_CROPS (seedItemId, produceItemId, fineProduceItemId per row) and not
hand-typed, so a crop 11e added is covered automatically; MUTATE IT to prove it bites (put
a produce id into a gear intermediate in scratch state and confirm the sweep reds, then
revert); it covers APEX_ARMOR_RECIPES, APEX_GEAR_RECIPES, every INTERMEDIATE_RECIPES row,
recipe_quickening_catalyst, and the three Perfecting materials (makers_ember,
sundered_essence, prismglass_setting); and the recipe_seasoned_stock carve-out is written
where the test can be read, naming the barred set, so it cannot widen by accident.
recipe_quickening_catalyst's diff is EMPTY and the reason is in state.md, not implied.

Fine-twin and capstone agent: fine_gilded_sunmelon and fine_evergarden_greens now have a
consumer at skillReq 125, and the ledger's CLAIM about what they had before is accurate
rather than loose (on the shipped tree each had exactly one cooking skillReq 50 trainer
dish and was structurally excluded from the hoe ladder under deviation (ad), so the true
statement is "no consumer at or above skillReq 75"; a ledger that says "no consumer at
all" is a finding, and the fix is the sentence, not the code). Every source comment the
phase falsified is corrected: the hoe-reagent-only notes beside the twins, and any farming
comment asserting a tier-4 twin can never have a consumer. The 3-plus-1 capstone counts
trace to the shipped showcase idiom (recipe_evergarden_harvest_platter and
recipe_evergarden_sunmelon_tart) rather than to a number someone liked. Neither capstone's
output, skillReq, acquisition, stationType or itemLevelBudget moved.

Zero-new-ids and power agent (the feast lane is RETIRED by 11h-GATE-E; this replaces it).
PROVE the phase minted nothing: sweep the diff against the pre-phase item list and expect
zero new ids, zero new patterns, zero new templateIds, and no edit anywhere in
src/sim/professions/feast.ts. harvest_feast's diff is EMPTY across def, recipe, charges,
dish and price; a change to its shipped charges 10 or durationTicks 3600 is out of scope
here and belongs to 11k under 11k-D-K5. NO new aura id anywhere; no new proc effect (R14);
no oncePerDay stamp added; no farming daily minted, and the rate limiter is the Wyrmfall
Core, outside the farm.
R5: CONFIRM the phase's statement, do not re-measure balance. The confirmation is
mechanical: sweep the diff for any change to foodHp, wellFed value or duration, elixir
value or duration, any stat, any rating, or any item budget, and expect zero hits; the kit
stays at flask 15 plus food 6 equals 21 stamina. Access versus power is no longer an open
carry: it is SETTLED at ip-15-ACCESS (R5 measures the geared individual at full food uptime,
never the raid aggregate, because ip-15-KIT already fixes the premise at "always on,
delivered by feast"), so confirm the phase recorded that reading rather than re-opening it.

Economy and derivation agent: BOTH sorted literals in tests/recipe_economy.test.ts were
RECOMPUTED from the merged ALL_RECIPES and never hand-merged (a resolution keeping one
side's literal goes green while deleting the other side's guard), and the non-vacuity floor
under the membership pin survived and moved with the set. Check the specific hazard this
phase creates: the tier-4 FINE twins carry a buyValue while the base crops do not, so a
bill's counterfactual-vendor-fed classification can flip on a fine-twin addition; confirm
the membership was re-derived rather than reasoned about. The INTERMEDIATE_RECIPES literal
bill table was edited deliberately and its key-set assertion still binds. Every touched row
is gold-negative with the arithmetic PRINTED and independently re-derivable from the merged
sellValue table, and every margin WIDENED rather than narrowed. The MATERIAL DEMAND
COVERAGE arm still passes with every material holding a consumer.

Test-decisiveness agent: every moved count pin has a PREDICTED value beside its observed
one (the APEX_CONSUMABLE_RECIPES length, the local APEX_CONSUMABLES table and the sweep
that walks it, HEROIC_VENDOR_STOCK, PATTERN_PRICES, the pattern id list in bag_filter, the
shipped-item-ids golden), and both stale test titles that name a count were reworded rather
than left lying. No constant-self-comparison: a pin that computes both sides from the same
expression proves nothing, and a pin re-derived from the same helper the code uses is not a
pin. Each new pin fails on the regression it names: mutate mentally, and where cheap,
mutate for real. THE SCOPED-PIN TRAP, checked explicitly: tests/farm_recipes.test.ts
asserts the three hoe twins are absent from farm DISHES only, so a hoe twin placed into an
APEX_CONSUMABLE_RECIPES bill would leave it green; confirm no gate default did that, and if
one did, that the cross-table arm landed in the same change. Watch the standing traps:
vitest -t is a regex, source-text pins are comment-gameable.

Content-obligations agent (dispatch content-obligations-reviewer): with ZERO new item ids
the obligation stack collapses to a WRITTEN NIL, and the audit's job is to confirm the nil was
PROVEN rather than skipped (11h-VERDICTS). No art and no ITEM_ART_PENDING row is owed, because
nothing was minted; no M16 fill is owed for the same reason; no new proper noun exists, so
11h's naming verdict reads "no coinage, nothing to verify" and is WRITTEN DOWN (11h-NAME, moot
under GATE E); the Reliquary sweep RAN and its verdict is recorded either way; nothing is owed
in src/ui/world_entity_i18n.ts. Catalog rows sit in the right tier of the three-tier ordering
rule. The ONE live obligation is the REWORD SET from the APEX_CONSUMABLE_RECIPES header
amendment, on the release-tier fill worklist BY KEY, because an edited English value with
filled locales is stale in every locale unless a worklist entry catches it. The wiki was
regenerated on the merged tree and tests/guide.test.ts freshness is green, with the new
reagent rows actually visible on the regenerated cooking and alchemy pages. The apex-feast
deed is a recorded POINTER to Phase 11k rather than an omission, with no half-built deed left
behind. A diff that carries art, an M16 fill, or a naming verdict for a NEW id is evidence the
phase minted something and is BLOCKING.

Scope and cleanup agent: the explicit scope records are present in state.md so none is
re-proposed (the 150 rung belonging to the apex tool family and Phase 11j, and not assumable
here under 11h-150; farming's own 75 and 100 rungs belonging to 11f, with nothing farming owns
reaching 125 under 11f-GATE-A; the deed and the player-visible R18 copy belonging to
11k, the fish belonging to 11i, and the four refusals). The 11i interlock is recorded, so
the phase that appends fish to recipe_sageleaf_chowder re-derives the economy arithmetic
from the merged row instead of carrying this phase's numbers. No dead code, no unused
imports, sim purity intact, no wall-clock or Math.random under src/sim/, no monolith
ceiling raised, no non-data file under src/sim/ touched (if one was, say why and whether it
should have been a stop).

Dispatch per the Review Dispatch Matrix: content-obligations-reviewer,
frontend-seam-reviewer (the i18n.catalog rows and the tooltip copy), architecture-reviewer
only if a non-data file under src/sim/ moved, cross-platform-sync only if a SimEvent, wire
field or matcher rule moved, plus qa-checklist as the phase-completion gate. Skip
privacy-security-review, migration-safety and database-performance-reviewer unless server/
or a SQL call site was touched.

STEP 3 - FIX: apply ALL findings (blocking, should-fix, and nits). Rerun the Phase 11h
validation set INCLUDING the full suite (npx vitest run --maxWorkers=5), plus
npm run ci:changed on the touched files. Separate fix commits with explicit paths and
bodies. The fix round is itself unreviewed code: have a FRESH reviewer pass over the fix
diff before closing. Read the gate LOG, not just its exit code: a printed FAIL marker
overrides a zero exit.

STEP 4 - DOCS: progress.md (the Phase 11h QA row), state.md drift (any count, crop
assignment, price, name or pin that moved during the fix round, plus any gate recorded
differently from how it was taken, and the zero-new-ids sweep result), farming/state.md's OPEN list if a row closed or opened here, and memory notes
for anything that surprised you.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, the
predicted-versus-observed pin table, a one-line verdict on each of the FOUR decisions as
taken (A, B, C, D) plus one line each for the two that are gone (E cut to 11k, F dropped to
11g), a one-line verdict on the zero-new-ids sweep,
a one-line verdict on the firewall sweep including whether the mutation proved it bites,
and the handoff to Phase 11i. Follow-ups are CUT-or-fix decisions, never future-PR items.
```
