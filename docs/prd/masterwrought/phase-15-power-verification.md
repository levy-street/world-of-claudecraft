# Phase 15: Power verification

### Starter Prompt
```
This is Phase 15 of the Masterwrought feature: power verification. R5 is the gate:
nothing merges beyond this point until the envelope is proven.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: yes (audit): drive the measured pass and the
adversarial audits as a Workflow.

Goal: prove the full kit (2 Perfected pieces + apex enchants + flask + the best
available food, always on, delivered by feast) lands at most 5 percent total
throughput over pre-packet raid BiS (R5), record the measurement so it is
reproducible from the doc alone, and close every pin gap the adversarial audit
finds. Any breach is fixed by tuning numbers DOWN in this phase, never by widening
the envelope.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; then SYNC RELEASE: git fetch origin, merge the newest origin/release/**
  into feature/masterwrought, run the release-merge-audit skill on the merge.
- Memory scan: MEMORY.md entries on the test-pin trap index, mutation harness must prove
  tests RAN, spell-balance notes.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (R5, R14; Power placement: budgets and the
  throttle-proof rating surface), docs/prd/masterwrought/progress.md (phases 08 to 12
  ledger: every apex item, enchant, and consumable)
- docs/design/spell-balance-framework.md (the measurement method; follow it, do not
  invent one), tests/masterwrought_budget.test.ts (the sweep),
  tests/recipe_economy.test.ts, the exclusivity pins from phases 06/10, the rating pins
  from phases 08/09.
Return: the framework's measurement recipe, the full apex item list with stats, which
pins exist today and which items each covers.

STEP 2 - EXECUTE (ultracode Workflow; request the fan-out explicitly):
Arm 1 (measured pass): build the full-kit character per R5 (2 Perfected pieces, apex
enchants, flask, and the best available food always on, delivered by feast) and the
pre-packet raid BiS baseline; measure both against
heroic raid and S-rift tuning targets per the framework; write every input, formula, and
result to docs/prd/masterwrought/power-verification.md with the explicit 5 percent
envelope verdict per measured kit. Heroic raid and S-rift clear difficulty is the
protected asset (R5).
Arm 2 (adversarial stat-shape audit): every apex item against the scarce-stat and
stat-light-slot rules (the Lionheart/Lariat rule; R14 for jewelry); flag any outlier.
Arm 3 (pin-completeness audit): rating pins (every apex piece pinned to its same-band
raid or heroic-vendor equivalent), exclusivity pins (scroll/flask/food/elixir families
exactly as state.md designs), and budget-sweep completeness: prove NO apex item is
missing from tests/masterwrought_budget.test.ts by enumerating masterwrought-flagged
defs and apex recipe outputs against the sweep's list.
Arm 4 (fix): any envelope breach or audit finding fixed by tuning numbers DOWN (content
values only), with the budget sweep and every affected pin updated in the same change.
NEVER widen the envelope, relax a pin, or edit the formulas.

INVARIANTS IN PLAY: R5 (the envelope is the contract; breaches tune DOWN); classic-era
formulas only (tune inputs, never invent curve math); ids frozen; content-only edits
(no sim logic changes).

Out of scope: any new content; ui/render work; loosening R14; re-litigating locked
rulings.

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
content matrix: npx tsc --noEmit; npx vitest run tests/progression.test.ts
tests/recipe_economy.test.ts tests/itemization_coverage.test.ts tests/item_level.test.ts
tests/masterwrought_budget.test.ts; plus every pin file the audit touched; npm run
ci:changed. Review Dispatch Matrix (implementation-plan.md): a tests + docs + content
diff skips the sim and frontend rows (pure data/test); dispatch test-coverage-auditor
over the new and changed pins (the purpose-built auditor, per the working-style fan-out
rule) and qa-checklist once the deliverable set is complete. COVERAGE prompts; apply ALL
findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- docs(prd): masterwrought power verification results
- fix(content): tune apex numbers down to the R5 envelope (only if a breach was found)
- test(sim): close the pin gaps the power audit found

STEP 5 - ACCEPTANCE:
- [ ] power-verification.md reproducible from the doc alone (inputs, method, numbers,
      verdict)
- [ ] Verdict INSIDE the 5 percent envelope for every measured kit (R5)
- [ ] No stat-shape outlier stands; rating, exclusivity, and budget-sweep pins complete
- [ ] Every fix tuned DOWN; no envelope widening, no pin relaxation, no formula edits
- [ ] Content matrix green; ci:changed clean

STEP 6 - DOCS: progress.md Phase 15 row; state.md ledger (final tuned numbers if any
changed, audit outcomes); memory note if anything surprised you.

STEP 7 - REPORT: phase status, the envelope verdict per kit, files, validation results,
reviewer verdicts, handoff line for Phase 15 QA.

STOPPING RULES: stop and ask if the envelope cannot be met by tuning down without
breaking a locked ruling (R13 skill placement, R14 stat shapes), or if the framework
cannot measure a kit (a tooling gap is a maintainer call, not a guess).
```

### Farming arm (amended 2026-08-20)

Phase 11b absorbed `feature/farming-plan` into this packet: one branch, one PR, five
gathering professions and ten crafts shipping as one system. The prompt above is not
retracted and not rewritten, but TWO of its premises are falsified by the absorb and must
be re-authored BEFORE this phase runs. Read this section first.

**Premise 1, falsified: the "food" term in R5's kit doubles.** The kit above reads
"2 Perfected pieces + apex enchants + flask + food". After the merge, "food" names two
systems: masterwrought's three apex role foods and farming's four-rung dish ladder. The
kit definition must name the SPECIFIC aura and magnitude it measures, not the word
"food". Rewrite it before Arm 1 builds anything.

**Premise 2, falsified: the feast is un-dropped.** Deviation (e) recorded, with outcome
dated 2026-08-16, that the feast was dropped from the R5 full-kit premise per ruling (4)
of the Phase 10 QA, on the finding that there was no feast buff source to measure, and
that correction was applied to BOTH live copies: this file's Goal line and Arm 1, and
`implementation-plan.md`'s Phase 15 deliverable. Farming's `harvest_feast` and the apex
Harvest Feasts falsify that finding. (The apex feasts are 11k's, not 11e's; the label here
is stale and the content is right.) Revert both edits and re-record deviation (e) with
its new outcome in the state.md ledger, in the same change, before the measured pass
starts. R5's correct kit definition becomes "the best available food, always on,
delivered by feast", which is strictly stronger than what this phase was written to
measure.

**Premise 3, added 2026-08-20 (qr-11o-WEAR, state.md row 118): the crafted rare tier was
re-leveled before this phase runs.** Phase 11o moved recipe.level on the rung-50 gear
recipes (20 to 15) and the rung-75 grandfathered rares (20 to 17), so the crafted rares are
wearable mid-leveling. (Nineteen rows moved in all, two of them to 17; this line said
"three" and the tree and commit 08ba6cf61f both say two.) That change was ruled R5-safe by construction (it moves
WHEN gear can be worn, never any magnitude), and this phase VERIFIES the construction: the
level-20 shelf this phase measures against (raid, heroic, apex) must be shown UNMOVED by
11o (re-derive the shelf, do not assume it), and any 11o-side drift into the shelf is a
STOP, not a tuning input.

**The gray-grind record (qr-GRAY, state.md row 128), a new recorded measurement, not a
tune:** print, per craft, the crafts-to-cap count for the cheapest below-band spam path
beside the intended band-matched path. No gain-curve change lands in this packet (the 11e,
11f and 11i pacing models were all derived against the shipped multiplier); the record is
the judgment surface for the future-tier revisit brainstorm.md carries.
(NOTE 2026-09-02, qr-19-qr-gray-row-wording-false: the path this names is section
12.2's floor-spam column, renamed from "cheap path" that day; the premise sentence stands
as history, and row 128's dated amendment carries the measured read.)

**STEP 0 additions.**
- DECISION 2 (the well-fed unification and power ladder) IS SETTLED (2026-08-20, row
  11c-D-2). Nothing is confirmed here: READ its landed outcome from the 11c ledger and
  measure against it. The settled ladder: one aura id `'well_fed'`, masterwrought's
  `FoodItemDef.wellFed` field
  and `TimedStatBuffPayload`, masterwrought's clear-then-grant order, farming's
  `src/sim/wellfed.ts` module and tooltip view, and the ladder re-tuned to farming 2/3/4/5
  at 600 s with the apex role foods at 6/900. IF 11c landed exactly that, THIS PHASE'S
  ARITHMETIC IS UNCHANGED from what it was authored against: consumables stay at flask 15
  plus food 6 equals 21 stamina, roughly 3 percent of physical white DPS from consumables
  and 4.2 to 4.7 percent for the full physical kit against the 5 percent cap. That is the
  entire reason to prefer that ladder over any other.
  - **OUTCOME 2026-08-28: 11c landed exactly that ladder, and the premise above was then
    falsified by the MEASUREMENT, not by 11c.** The measured full physical kit read 5.86
    and 6.08 percent, outside the envelope, so the phase used its own named tune-down knob:
    the flask came to 13 and the shipped consumable sum is **flask 13 plus food 6 equals
    19 stamina**, not 21. No well-fed magnitude moved. Ruling 11c-D-2's outcome stands, but
    its arithmetic rationale (an apex food of 8 breaks "15 plus 6 equals 21") no longer
    carries it, because 13 plus 8 is exactly 21; what keeps 8 rejected is the ladder
    ordering, which the Well Fed band and dominance arms pin. Full record:
    `docs/prd/masterwrought/power-verification.md` sections 8.3 and 10.4.
    FINAL 2026-08-28: the phase then ESCALATED under this file's own stopping rule;
    the R5 verdict is SUSPENDED (power-verification.md Verdict, state.md Phase 15
    ledger).
    RESOLVED 2026-08-29: the maintainer ratified the priced rulings (1a, 2b, 3a,
    4-amend) at the Phase 16 gate and the verdict is CLOSED BY RULING; the closure
    ran as Phase 16 STEP 0.5 (state.md, "Maintainer rulings (2026-08-29)" and the
    R5 closure record).
- IF 11c landed anything else, that is a code-versus-ruling mismatch and it is blocking on
  its own. This phase then requires a fresh run of
  `docs/design/spell-balance-framework.md` from the top, and it trips its own stopping rule:
  the named tune-down knobs are flask 15 and well-fed 6, and the well-fed magnitudes are
  SETTLED at 11c-D-2. A breach closable only by moving them RE-OPENS 11c-D-2 in the packet
  record and is reported as such; it is never an in-phase re-tune of a settled magnitude.
- Confirm 11e landed before measuring: decision 1 (the tier 3 and 4 seed faucet at
  `farmer_hollis` and `farmer_verbena`) changes real-world tier 3 and 4 produce
  availability, which changes food uptime, which is an R5 INPUT; and ruling 11g-D-C
  (`marsh_rice` count 2 into `recipe_seasoned_stock`, landed in 11g) must be in the tree
  before this phase seals numbers, never after.
- ACCESS VERSUS POWER IS SETTLED (2026-08-20, row ip-15-ACCESS). R5 measures the GEARED
  INDIVIDUAL at full food uptime, never the raid aggregate. Every knob R5 names is a
  per-character stat (flask 15, well-fed 6, apex enchants, 2 Perfected pieces), and
  ip-15-KIT already re-authored the premise to "the best available food, ALWAYS ON, delivered
  by feast", which bakes 100 percent uptime into the individual measurement. A feast therefore
  moves DELIVERY, not the ceiling: it takes a raid from partial uptime to the uptime the
  measurement already assumed. That is access, and under masterwrought R21 and R18 it is the
  intended reward for preparation (prepared is meaningfully stronger, unprepared is behind and
  never locked out), so it does not enter the R5 arithmetic. STATE THE MODEL EXPLICITLY in
  `power-verification.md` and in the ledger, in those terms, so the number is reproducible
  from the doc alone and nobody re-litigates it by re-measuring a raid.

**STEP 1 additions (Explore agent).**
- The merged consumable set as shipped after 11c and 11e: the apex role foods, farming's
  four dishes, `harvest_feast`, the three apex Harvest Feasts, `ironhusk_flask`, and the
  elixir family.
- `src/sim/wellfed.ts` and `src/sim/combat/auras.ts` as merged, for the single mint site
  and the exclusivity rules 11c settled.
- The merged exclusivity pins from phases 06 and 10, which do not know the farming
  namespace existed.

**STEP 2 additions.**
- Arm 1 measures the merged kit: the named food aura at its named magnitude, delivered by
  feast at full uptime, plus the flask, plus apex enchants, plus 2 Perfected pieces.
  `power-verification.md` states the aura id and value it measured, so the number is
  reproducible from the doc alone.
- Arm 3 gains a NEW aura-exclusivity pin spanning `well_fed` and `elixir_<kind>`, and
  asserting that `wellfed_<kind>` no longer exists ANYWHERE in the tree. That last clause
  is the one that catches a bad 11c resolution, and it is a source scan, not a behavior
  test.
- Arm 3's budget-sweep enumeration is otherwise unaffected: no farming item is
  apex-flagged.
- Arm 4 tunes DOWN as before, with one added constraint: farming's ladder magnitudes are
  SETTLED at 11c-D-2, so a breach that can only be closed by moving them is a STOP that
  re-opens 11c-D-2 in the record, not an in-phase tune.

**STEP 5 additions (acceptance).**
- [ ] Deviation (e) re-recorded with its new outcome; both live copies reverted
- [ ] The kit definition names the specific food aura, its magnitude, and its delivery
- [ ] Aura-exclusivity pin spans `well_fed` and `elixir_<kind>` and asserts
      `wellfed_<kind>` is absent from the tree
- [ ] The access-versus-power model (individual or raid) stated and answered in the doc
- [ ] 11c's ladder and 11e's content confirmed in the tree before any number was sealed
