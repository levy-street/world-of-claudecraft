# Phase 11j QA: verify the coverage invariant, the audit, and the apex hoe

### QA Starter Prompt
```
This is Phase 11j QA of the Masterwrought feature. Phase 11j's headline deliverable is a
GUARD, and a guard is worth exactly what its failure mode is worth, so this audit is not
about whether the suite is green. A coverage test that cannot fail, an audit that reported
a clean sheet it did not earn, and a tool that merely resembles its family all look
identical to a passing gate. Prove each one instead.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: audit the R20 invariant for decisiveness, the band audit for honesty, the apex hoe
for family fidelity, and docs/design/professions.md for accuracy against the merged tree,
before 11k builds the capstone on top of a ladder this phase certified.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT: git status clean (all five 11j commits landed); SYNC RELEASE per the
canonical workflow (fetch, newest origin/release/** by version sort, merge,
release-merge-audit skill). A release absorb here can move recipe rows underneath the
coverage matrix, so if one lands, the audit matrix is RE-RUN and not patched. Confirm
`env | grep -c DATABASE_URL` prints 0 before any vitest run. Memory scan: the test-pin trap
index (READ it before judging any pin), the source-scan guard cluster (a discovery query
blind to named constants, a floor set above the flat value, self-audit blind spots),
"mutation harness must prove tests ran", new-item-content-hidden-obligations,
item-art-ownership-batch-xor-entries, release-merge-gate-surprises.

STEP 1 - LOAD CONTEXT (Explore agent): state.md's 11j ledger (the five decisions as taken,
the audit matrix with its BEFORE and AFTER columns and its stated predictions, the hoe rung
derivation and naming verdict, the re-derived pin table), progress.md's 11j row,
phase-11j-gathering-completion.md (what was promised), the five commits read individually
with git show, tests/gathering_supply_coverage.test.ts whole, and the diffs to
src/sim/content/recipes.ts, src/sim/content/items.ts, src/sim/content/delves/shop.ts,
docs/design/professions.md and brainstorm.md. Return the ledger's audit matrix and pin
table verbatim; do not summarize either.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):

Mutation agent (adversarial, and this is the highest-value lane; do not delegate its
judgment to the phase's own report). In a scratch copy of the tree, never over uncommitted
work:
- Remove one supply reagent from one band, once per family and once per band, and confirm
  the test reds EVERY time. A family or band that survives its own mutation is a hole in
  the guard and a blocking finding.
- Confirm the failure message names the profession AND the band AND the supply ids, and
  that a contributor reading it alone could fix the break.
- Confirm it reports EVERY hole in one run. Break two families at once; if the output names
  only the first, the band audit is a whack-a-mole loop and that is a finding.
- Attack the derivation, not only the assertions. Empty one supply source (a mistyped table
  reference, a filter that matches nothing, a fine-twin lookup that returns undefined) and
  confirm the anti-vacuity arms red rather than passing over an empty set. Confirm the band
  loop cannot run zero times. Confirm the file contains no literal 25 and no hand-written id
  list, and that the band math comes from tierForSkill.
- Attack the escape hatches: confirm there is no exemption list, no narrowed subject set,
  and that the subject list derives from GATHERING_PROFESSION_IDS so a sixth gathering
  profession joins automatically. Add a fake sixth profession id in scratch and confirm the
  guard picks it up.
- Confirm the self-feeding arm (decision D) is real: in scratch, make fishing's only
  100-plus consumer a fishing tool again and confirm the test reds.

Audit-honesty agent: the phase's own audit is the one artifact with the strongest incentive
to report a clean sheet.
- Re-run the derivation independently and compare cell by cell against the recorded matrix.
  A recorded cell that does not reproduce is a finding, not a rounding difference.
- Confirm every BEFORE column value matches the maintainer's measured audit as recorded in
  state.md (mining 21, herbalism 15, skinning 11, logging 6, fishing 1, farming 0 endgame
  bills at skillReq >= 75) and was not silently re-derived or contradicted.
- Confirm each stated prediction was recorded BEFORE the run, and that any mismatch was
  handled as a finding rather than a re-record. Logging is the one flagged at risk: confirm
  whether any of its endgame bills sits at 100 or above, from the merged tree, yourself.
- Confirm every gap was closed by an ADDED row (R18), never a substitution: diff each
  edited bill and check that no pre-existing reagent left it. Confirm no farm produce
  entered the gear chain, the Perfecting materials, or recipe_quickening_catalyst (R17).
- Confirm no gap was "filled" by moving a recipe's skillReq to a friendlier band. A band
  satisfied by re-banding an existing recipe rather than by adding a consumer is the
  cheapest possible cheat and it would pass the test.

Family-fidelity agent (the apex hoe):
- Compare the new item def field by field against arcanite_mining_pick, elderwood_axe,
  sunpetal_sickle and tidewrought_fishing_rod: kind, quality, use shape, tier, sellValue,
  the absence of buyValue, and the absence of the tier-1-only noVendorSell and noMarketList
  flags. Any deviation must be explained in the ledger or it is a finding.
- Confirm the rung is LEARNABLE, not merely plausible: teachTierMet with engineering at its
  cap admits it, and the pattern path would too. Re-derive tierForSkill(skillReq) against
  tierForSkill(craftMaxSkillFor('engineering')) yourself rather than trusting the ledger.
  Confirm PRE_TRAINING_RECIPE_IDS is untouched and still pinned at its frozen literal.
- Confirm the recipe satisfies the hoe ladder's own invariant with that invariant unchanged
  (the fine twin of a crop one tier below the result, plus exactly one hoe one rung down),
  and that it joined HOE_RECIPES rather than TOOL_RECIPES, which stays pinned at 6.
- Confirm the stale items.ts comment about a tier-4 twin never being a hoe reagent is gone
  and its replacement is true. A retired constraint left documented is a defect.
- Confirm the delve tripwire was re-decided in the open: the farming exclusion narrowed
  rather than widened, both exact per-tier arms re-derived, the at-least floor raised so it
  still has teeth, and the shop file's own "these eight" comment now correct.
- Confirm the wield gate needed no table change and that the tier-5 farming knife-edge is
  demonstrated against 11e's re-tuned FARMING_GAIN_SCHEDULE, not asserted.
- Confirm the two cross-surface pins exist and are real: the apex hoe cannot join the
  counterfactually-vendor-fed set, and its effect on the best-wieldable-any-profession tier
  changes nothing while every corpse family is tier 1.
- Confirm the naming verdict was obtained by web verification at authoring and recorded in
  the registry with evidence, not asserted after the fact.

Obligations agent: ITEM_IMAGE_IDS row present (arm H is exact equality over every
non-weapon item); art either committed with its mapping.json provenance or parked on the
MERGED allowlist with exactly one mapping owner (the batch-XOR rule); the shipped-id golden
re-minted with additions only, and no line removed; the M16 verdict obtained from the guard
rather than by eye; wiki regen fresh with tests/guide.test.ts green; deed and Reliquary
verdicts recorded either way. Re-run npm run wiki:content and require a zero diff.

Doc-accuracy agent: read docs/design/professions.md against the MERGED tree, not against
the phase's description of it. Every symbol it now cites must exist; every claim about
farming, the tool family, and the supply matrix must be true today. Confirm the file's own
head anchor rule is honored: no counts, no line numbers, nothing that rots. Confirm the
matrix names tests/gathering_supply_coverage.test.ts as the live authority. Confirm
masterwrought R17 to masterwrought R20 are stated as rules with the file that enforces each,
and that each is WRITTEN IN FULL as "masterwrought R<n>": docs/design/professions.md is the
Professions 2.0 series' OWN authority file and already cites bare R19, R20 and R22, so a bare
packet R-number there is a finding, not a nit. Confirm the reciprocal loop is
stated plainly and is accurate in both directions. Confirm brainstorm.md's scope line sits
in the existing future-tier block and reads like the orange-unique-effects line beside it,
so the record is a scope statement and not a promise. Confirm the Phase 16 boundary for the
crafting half is recorded in the ledger rather than left implied.

Cleanup agent: no dead code, no unused imports, no temporary logging left behind from the
audit run, no test left with .only, sim purity intact, and no generated artifact hand
edited.

Dispatch per the Review Dispatch Matrix: content-obligations-reviewer (the content diff),
plus qa-checklist (the phase-completion gate). Add frontend-seam-reviewer only if a src/ui/
surface moved and architecture-reviewer only if a src/sim/ behavior file changed; if
neither did, say so explicitly rather than dispatching for form.

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits). If a fix moves a pin, the
pin is RE-PREDICTED and then observed, never re-pasted. If a fix touches the coverage test,
the mutation proof is RE-RUN afterwards, because a fix to a guard is the one change most
likely to blunt it. Rerun the 11j validation set plus the full suite. Separate fix commits
with explicit paths. The fix round is itself unreviewed code: have a fresh reviewer pass
over the fix diff.

STEP 4 - DOCS: progress.md (Phase 11j QA row); state.md drift (any matrix cell or pin whose
value moved during the fix round, carrying its new prediction beside its new observation,
and any decision re-taken); farming/state.md open-item rows for anything found and not
settled here; docs/design/professions.md corrections; memory notes for anything that
surprised you, especially any way the coverage test could have passed while blind.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, the mutation
results in full (which family and band mutations reddened the test and which did not), the
independently reproduced audit matrix beside the recorded one, and a handoff to 11k naming
the pins 11k will move again (the deed totals, the economy literals, and the shipped-id
golden) and stating that 11k re-derives them by the same predicted-then-observed method.
Follow-ups are CUT-or-fix decisions, never future-PR items.
```
