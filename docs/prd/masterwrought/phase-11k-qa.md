# Phase 11k QA: verify the provisioning capstone and prestige

### QA Starter Prompt
```
This is Phase 11k QA of the Masterwrought feature. Phase 11k widened a shipped placement
action from one item to four, put three new placed entities in the world, added the packet's
top consumable, appended a deed to a table every 11-phase appended to, and shipped a new
public wiki page. Two things make this audit strict: the phase's central claim is that it
invented no machinery, which is only true if the widening genuinely reused every shipped
path, and it is the LAST append in the 11-block, so a row lost anywhere earlier surfaces
here or never.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: prove the feast lifecycle is correct in BOTH hosts including teardown, that the
dishItemId indirection genuinely re-tunes with the plate, that the two prestige seams work
and their boundary is recorded, that the deed is earnable and its totals were PREDICTED
before they were observed, and that no wire field and no golden moved except where the
phase said it would.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT: git status clean (Phase 11k committed). SYNC RELEASE per the canonical
workflow (fetch, discover the newest origin/release/** by version sort, merge,
release-merge-audit).
PRECONDITION, and it binds this audit's whole method (settled 2026-08-20, and the same
precondition binds 11f, 11h, 11i and 11j QA): every decision this packet delegated is written
into docs/prd/masterwrought/state.md under "Decisions closed 2026-08-20 (the full
delegation)" BEFORE this session starts. READ that record first and judge the code against
THE RECORDED ANSWERS, never against a phase file's old defaults. If the record is missing,
that is blocking on its own and the audit stops there. A code-versus-ruling mismatch is
blocking on its own too, even when the code is defensible: this audit is a comparison, not a
re-derivation. Memory scan: the test-pin trap index (READ before judging ANY pin),
new-item-content-hidden-obligations, item-art-ownership-batch-xor-entries, the i18n
reword-staleness entry, offline-iworld-live-array-aliasing (world doubles need a MUTATING
offline arm), and the "apply ALL findings" standing rule.

STEP 1 - LOAD CONTEXT (Explore agent): docs/prd/masterwrought/state.md ("Decisions closed
2026-08-20 (the full delegation)" FIRST, since it is what this audit judges against, then R8,
R13, R14, R15, R17, R18, R19, R20, the naming registry, and the Phase 11k ledger as written),
farming/state.md (D8, D11, D13, D16, D17, D24 and the OPEN list, whose delegated rows now
point at that record), progress.md's Phase 11k row, phase-11k-provisioning-capstone.md (what
was promised, including its five SETTLED decisions and its REJECTION LIST), git diff against
the phase-start commit, and every file the diff touched. Read src/sim/professions/feast.ts
WHOLE (not the diff alone: the widening's risk is in the paths it did NOT change) and
src/sim/content/profession_items.ts's harvest_feast def.

STEP 2 - QA AUDIT (parallel agents; prompt for COVERAGE, not filtering):

Lifecycle and teardown agent (the highest-value slice, and it audits behavior, never
comments): every apex feast reaches the ground through the SAME placeFeastAction path as
harvest_feast, with no forked branch. Prove the teardown class farming already found is
inherited rather than re-lost: an apex feast placed inside a claimed dungeon instance is
registered on that instance's objectIds and dies when the reaper frees the claim; an apex
feast placed inside a delve run is registered on the run's objectIds and dies with the room,
including at a module advance; in both cases the FeastState is reclaimed by the 1 Hz sweep's
entities.has leg AND the placer's one-active slot is freed, so the next placement is not
silently refused forever. Then the three inherited object contracts, each pinned on an APEX
feast and not only on harvest_feast: respawnTimer Infinity (a finite value re-arms the object
sweep and hands the interact press to the generic object arm), lootable false, objectItemId
null. Then the gate order and every refusal: dead, busy, swimming (placement refuses water,
because a spend that spawns an uneatable table burns the item and holds the slot), the
per-copy locked denial, the id-only lock-aware shortfall, and 'feast_active'. Confirm
decision K4 landed as ruled and is pinned in BOTH directions. Confirm the expiry stays
TICK-domain, with no wall-clock read anywhere on the path.

Both-hosts agent: the lifecycle is correct offline AND online. Offline: the Sim path end to
end through the real tick loop. Online: the server resolves placement and consumption and the
client mirrors, the entity rides the existing interest-scoped entity snapshot with no new wire
object, the placed entity's templateId reaches the client, and the client's render filter and
interact scan both accept the new templates. Drive the online arm with a MUTATING world double
rather than a static fixture (the live-array aliasing trap: a double that never mutates cannot
show a stale mirror). Confirm src/net/online.ts's bare place_feast still means harvest_feast
and that an apex feast reaches the ground only through the use_item path carrying its slot.
Confirm nothing new entered PlayerMeta, CharacterState, or any save blob: FeastState is
transient by design and must have stayed transient.

Indirection and power agent: each apex feast's feast.dishItemId points at its intended shipped
plate, and a serving mints an aura IDENTICAL to eating that plate from bags, asserted as a
whole record (id, kind, value, duration, name, school, sourceId) and driven through the real
tick path, because the defect class 11c found lives in what the BITE writes, not in what the
mint reads. Then prove the indirection is live and not decorative: change the plate's payload
in a scratch fixture and show the feast's serving moves with it, so re-tuning the plate really
does re-tune the feast. NO new aura id exists anywhere; no new proc effect (R14); no
oncePerDay stamp was added; no farming daily was minted, and the rate limiter is the Wyrmfall
Core, outside the farm (R19). Well Fed is still one aura id with last-eaten-wins, pinned for
the case this phase makes possible for the first time: two feasts of different tiers standing
in one room. R5's kit is unmoved and nothing here re-opened the ladder 11c settled.

Prestige and identity agent: the craft-signing threshold is asserted by a test rather than
assumed, and each apex feast def's quality actually clears it (decision K2). The placed entity
carries the placer's raw name as a VALUE and the client composes the localized title, so sim
and server stay language-agnostic (S3). Decision K1 is SETTLED at three templateIds, one per
role, so there is no shared-template branch to accept: each apex template resolves to its OWN
title and a raider can tell which plate is on the table before biting. Anything else is a
code-versus-ruling mismatch and blocking. All four templateId-keyed sites go through the ONE
exported helper, with no surviving bare string literal: grep for it, because a half-wired
fifth site is invisible to tsc. The crafter-signature-on-someone-else's-table boundary landed
as the SETTLED CUT with its reason, AND deliverable 3's prestige claim was narrowed in the
same change to what is true (the signature on the item instance, the placer's name on the
entity, the two coinciding when a cook places their own feast). A broad claim left standing
beside the CUT is a finding. The feast tooltip renders the plate's real effect and states its
limits (charges, duration, one bite per player) per docs/design/tooltip-writing.md.

Economy and derivation agent: every new recipe is gold-negative with the arithmetic PRINTED
and independently re-derivable from the merged sellValue table, using the shipped unit-value
convention (buyValue when finite and positive, else sellValue). The output sellValue sits
inside decision K2's SETTLED window and was derived rather than chosen: strictly above 250
(harvest_feast, the rare party rung), strictly below 380 (laden_hearth, the epic permanent
station), and a multiple of 10; a value outside that window is blocking even if the row is
gold-negative, and quality is 'epic'. Every count names the shipped
precedent it derives from, and the seasoned_stock count took the CAPSTONE idiom (3, the two
mobile stations) rather than the skill-100 consumable idiom (1, the three role plates); a
number with no stated precedent is a finding. The three bills are byte-identical to each
other. BOTH sorted literals in tests/recipe_economy.test.ts were RECOMPUTED from the merged
ALL_RECIPES, never hand-merged (a resolution that keeps one side's literal goes green while
deleting the other side's guard), and the non-vacuity floor under the membership pin survived
and moved with the set. R17 and R18 are asserted rather than asserted-about: no produce in
recipe_quickening_catalyst or any gear intermediate (billet, plating, cording, bolt, setting,
chassis); produce rows ADDED beside the herb and meat families rather than substituted for
them, so herbalism lost nothing (D24); every produce item still kind 'junk' and
market-listable, so a non-farmer can buy in. R20 re-run with these rows counted: fishing is
present at skillReq >= 100 through a bill that is NOT a fishing rod. The two tier-4 fine twins
now have a consumer, and their stale hoe-reagent-only comments were corrected BY 11h, which
owns that sentence (settled 2026-08-20): confirm the correction is on the tree and that 11k
did NOT re-correct it, because a second phase editing the same comment is the drift this
single-owner ruling exists to stop. harvest_feast's rung is 11f's (cooking 100, acquisition
['drop']) and 11k's diff on it is EMPTY; a 11k edit to that row is blocking.
Heroic Quartermaster: three rows at the skill-125 rung (16), both length pins re-derived, the
PATTERN_PRICES literal recomputed, and the count-naming test title reworded to state the rule
instead of a number that rots.

Deed and persistence agent: prog_field_to_feast is cosmetic, renown 5, no title, no border,
appended at the tail under the ordering rule, and the DEED_ORDER tail pin moved with it. Its
markId interpolation is BOUNDED by the authored recipe set, the craft_rare precedent. Its
namespace is REGISTERED in VISITED_MARK_NAMESPACES and its save/load SURVIVAL is pinned, not
merely its write: an unregistered namespace serializes fine and is dropped on load, which is
the exact bug written into that file's own comments twice. THE TOTALS ARE THE CENTERPIECE:
confirm the ledger records a PREDICTION (the preceding phase's recorded totals plus exactly
one deed and its renown) made BEFORE the run, and that the observed values were required to
equal it. A pasted observed number is a finding even when the number is right, because it is
the only method that can tell an append from a lost row. FROZEN_CATALOG_SHA256 was re-minted
only after reconstructing the pre-append row list and reproducing the prior digest exactly;
a bare re-mint is a finding. DEED_IMAGE_IDS, the deed_i18n manifest, and
BOOK_COMPLETE_REQUIREMENTS moved by the same method, and BOOK_COMPLETE_REQUIREMENTS grew by
one, which is correct because the deed is earnable. Prove EARNABILITY end to end rather than
arguing it: a character with the pattern learned, the skill, and the materials crafts the
feast and the deed fires, then a save/load round trip keeps it. Decision K3 landed as the
SETTLED CUT: no ACHIEVEMENT_MAP row in server/steam/ or server/epic/, the
tests/epic_achievement_map.test.ts pins unmoved at 84, no server/ file
touched by this deed, and the phase ledger POINTING at the packet-level CUT record (one
record covers every deed this packet adds). Silence is a finding, and so is a storefront row:
the exhaustive-coverage arm is scoped to col_reliquary_* deeds, so both errors go green.

Wire and golden agent: NOTHING moved that the phase did not say would move. Diff the command
schema counts, the delta keys, tests/snapshots.test.ts, tests/bandwidth.test.ts, and
tests/env_protocol.test.ts against the phase-start commit; a widened templateId VALUE set
rides the existing entity snapshot and must not have added a field. Run the parity suite and
confirm every golden is byte-identical except any the phase named in advance; a moved draw
count or a moved drawDigest in a scenario this phase never touched is a determinism
regression, not a re-record. Confirm the phase added ZERO rng draws: grep the diff for Rng
use and confirm feast.ts's stated zero-draw contract still holds after the widening. The RL
host: confirm headless/ and python/ are untouched, which is correct under the settled
2026-08-20 CUT (farming and its placement path stay OUT of the env action space because
farming growth resolves against ctx.lockoutNowMs(), so any episode that plants is
non-replayable and structurally outside the env's determinism contract; the written record
of that CUT is owed in headless/CLAUDE.md at Phase 16, not here). Say host three's status
explicitly rather than leaving it unstated.

Content-obligations agent (dispatch content-obligations-reviewer): all six new item ids PARK
on the MERGED ITEM_ART_PENDING allowlist with exactly ONE mapping.json owner (parking is
settled 2026-08-20 for this whole packet, so committed WebP art is not expected and its
absence is not a finding; a weapons-style batch entry plus a per-id entry double-owns, and
that IS a finding); wordy English names have their M16 non-Latin fills IN THIS CHANGE, and so
do the new placed-entity title keys; the wiki was regenerated on the merged tree and
tests/guide.test.ts freshness is green; the new /wiki/professions/provisioning page renders
from generated data and guide.* keys with no hand-listed reagents, names no drop table, boss,
or instance, and its GUIDE_PROF_PAGES pin is DERIVED rather than retyped; the three new proper
nouns went through R15 and D17 with verdicts in naming-audit.md and the accepted names in the
state.md registry (Grand Banquet is already on the rejected row); the Reliquary sweep RAN and
its verdict is written as the settled NO PAGE; every packet R-number written into src/,
server/ or tests/ reads "masterwrought R<n>" in full, because a bare R-number in those files
means the shipped Professions 2.0 series (a bare packet R-number in source is a finding, not
a nit); tests/shipped_item_ids.test.ts is append-only green; and every i18n.catalog append
sits in the right tier of the ordering rule.

Test-decisiveness agent: every moved pin has a predicted value beside its observed one. No
constant-self-comparison (a pin that computes both sides from the same expression, or
re-derives from the same helper the code uses, proves nothing). Each new pin fails on the
regression it names: mutate mentally, and where cheap, mutate for real, especially the
teardown arms (delete the instance roster push and the instance test must go red) and the
signing arm (drop the quality one rung and the signature pin must go red). Negative arms exist
per dimension (unlearned pattern, wrong station, missing reagent, locked copy, second
placement, second bite by the same player). Watch the known traps: vitest -t is a regex,
source-text pins are comment-gameable, and an assertion on "no throw" is not an assertion on
values.

Cleanup agent: no dead code, no unused imports, sim purity intact, no wall-clock or
Math.random anywhere under src/sim/, no monolith ceiling raised for this phase's code
(extraction first), harvest_feast's diff genuinely EMPTY across def, recipe, charges, dish, and
price, the APEX_CONSUMABLE_RECIPES header reworded so it no longer names a count that rots,
and the phase's REJECTION LIST present in state.md so none of its entries is re-proposed
(the list grew with the delegation: minting the apex feasts in 11h, and splitting the
storefront CUT into a per-deed decision, are both refusals now).

Dispatch per the Review Dispatch Matrix: content-obligations-reviewer, architecture-reviewer
(the feast.ts widening, the template family, the crafting.ts mark site), migration-safety (the
mark namespace touches the characters.state deserialize path), frontend-seam-reviewer
(entity_display_name.ts, farm_patches.ts, quest_objects.ts, feast_interact.ts, and the guide
page), cross-platform-sync (both hosts, and only skip it if no SimEvent, wire field, or matcher
rule moved), plus qa-checklist as the phase-completion gate. privacy-security-review is NOT
dispatched: decision K3 is settled as a CUT, so no server/ file is touched. Say the skip out
loud in the report; if the diff DOES touch server/, that is itself the finding and
privacy-security-review is dispatched on it.

STEP 3 - FIX: apply ALL findings (blocking, should-fix, and nits). Rerun the Phase 11k
validation set INCLUDING the full suite (npx vitest run --maxWorkers=5), the parity suite, and
npm run ci:changed on the touched files. Separate fix commits with explicit paths and bodies.
The fix round is itself unreviewed code: have a FRESH reviewer pass over the fix diff before
closing. Read the gate LOG, not just its exit code: a printed FAIL marker overrides a zero
exit.

STEP 4 - DOCS: progress.md (the Phase 11k QA row), state.md drift (any count, price, name, or
pin that moved during the fix round, plus any decision recorded differently from how it was
taken, plus the final predicted-versus-observed totals table), farming/state.md's OPEN list if
a row closed or opened here, and memory notes for anything that surprised you (the widening's
keyed-site set and the teardown inheritance are both good candidates).

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, the
predicted-versus-observed pin table, an explicit one-line verdict on each of the five things
this audit exists for (lifecycle in both hosts including teardown, the live dishItemId
indirection, signing, the deed's earnability and its predicted totals, and no unexpected wire
or golden movement), plus a one-line verdict on whether the code matches every RECORDED
2026-08-20 ruling this phase executed, and the handoff to Phase 12. Follow-ups are
CUT-or-fix decisions, never future-PR items.
```
