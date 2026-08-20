# The professions quality review

A standing, read-only audit of whether this packet actually delivers what it promises:
professions as one of the game's biggest features, fun rather than chore-like, with every
skill useful and populated at every level band. Run it in a FRESH session. It changes
nothing; it reports.

Run it now against the PLAN (phases 11b to 11o are authored, not built) to catch a hole
while it is still cheap to fix, and run it again after the block lands, against the code.

### Review Prompt

```
You are auditing the World of ClaudeCraft professions program for QUALITY, not for
correctness. Correctness has its own QA twins. Your question is the maintainer's question:

  "Is professions one of the biggest features of this game? Is every skill useful and fun,
   with real things to do at every level band? Is anything empty, useless, a chore, or
   capped out too early?"

The maintainer's framing, in their words, is the standard you audit against:
- Professions cap out too early. A player can skip them, run a dungeon or a raid, and get
  better gear anyway.
- Skills are either too easy to level or unreasonably hard, because drops are too generous
  or too scarce.
- The end goal is a feature that keeps being fun and innovative. NOTHING that is a chore.
  Something that helps the economy, the player, and the game as a whole.
- Farming was just absorbed into this packet and it is a huge addition. It must be
  fantastic, not merely present.

Model: xhigh effort. Harness: Claude Code. ULTRACODE: yes, this is a wide measured audit.

WORKTREE GUARD (do this FIRST; the maintainer runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into it
NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought). If
EnterWorktree is unavailable or refuses, STOP and ask to be relaunched there.

YOU ARE READ-ONLY. Do not edit, write, commit, merge, or run a mutating git command. Do not
run tests or builds. Read, measure, and report. If you want to compute something, compute it
in a throwaway script under the scratchpad, never in the repo.

MEASURE, NEVER ASSERT. Every claim in your report carries the number or the path behind it.
The planning docs are a claim, not evidence: where a doc and the code disagree, the code
wins and the disagreement is itself a finding. Perception is reliable about THAT something
is wrong and unreliable about WHY, and so are planning docs.

STEP 0 - ORIENT
- Read docs/prd/masterwrought/README.md and implementation-plan.md (the phase table, the
  rulings R17 to R23, the farming absorb, the player-pain block).
- Read docs/prd/masterwrought/state.md sections: "Locked design rulings" (R1 to R23) and
  "Decisions closed 2026-08-20 (the full delegation)".
- Note which phases are actually BUILT (docs/prd/masterwrought/progress.md). If 11b to 11o
  are pending, you are auditing the PLAN and must say so in every verdict.

STEP 1 - THE BASELINE MATRIX (measure the code as it stands today)
Build one table: FIFTEEN professions (gathering: mining, logging, herbalism, fishing,
farming; crafting: engineering, alchemy, cooking, leatherworking, tailoring, inscription,
enchanting, jewelcrafting, weaponcrafting, armorcrafting) against every 25-point skill band
up to each profession's own maxSkill (note fishing is 200, gathering is otherwise 100, the
ten crafts are 125).
For each cell record, from the code and not from a doc:
  - How many recipes or gatherable outputs exist at that band.
  - Whether the outputs at that band have a CONSUMER (something that uses them).
  - Whether the outputs at that band have a BUYER (something a player actually wants).
  - Where the inputs come from, and whether they are reachable at that band's level.
Sources: src/sim/content/recipes.ts, enchants.ts, professions.ts, items.ts, the zone files,
src/sim/professions/*.ts. Known starting points, which you must re-derive rather than trust:
the whole cooking tree uses 17 distinct reagents and none is a vegetable or grain; endgame
bills (skillReq >= 75) run mining 21, herbalism 15, skinning 11, logging 6, fishing 1; all
14 farming recipes are trainer-taught and stop at skillReq 50.
FLAG EVERY EMPTY CELL. An empty cell is a band where a player levelling that profession has
nothing to make, nothing worth making, or nothing to make it from.

STEP 2 - THE AFTER MATRIX (what the plan actually delivers)
Re-run STEP 1's table as it will be once 11b to 11o land. Read the phase files for what each
one adds. Then answer, per profession:
  - Does every band become non-empty? Name the phase and deliverable that fills each cell.
  - Does any band stay empty? That is a HOLE and it is the most valuable thing you can find.
  - Is any cell filled only on paper (a recipe exists, but its inputs are unreachable, or its
    output has no buyer)? That is a FALSE FILL and it counts as empty.

STEP 2b - THE COMPLETENESS CHECK (did the phases deliver what the packet promised?)
This step audits the PLAN against ITSELF, and it is where a missed thing shows up.
  a. EVERY RULING HAS AN OWNER. For each of R17 to R23, name the phase and the specific
     deliverable that implements it. A ruling nothing implements is a promise the packet
     made and did not keep. R21 (demand-side design) and R22 (no material geographically
     trapped) are the two most likely to be stated and never built, because both are
     invariants rather than content.
  b. EVERY PHASE HAS A QA TWIN, and the twin actually audits the phase's own risky part
     rather than restating its acceptance list. Spot-check three twins against their phases.
  c. EVERY DECISION IS SETTLED. state.md's "Decisions closed 2026-08-20 (the full
     delegation)" should have no gaps and no row that still reads as a question. Exactly one
     item is deliberately open (ip-17-PUSH, the maintainer's consent to push). If you find a
     second, that is a finding.
  d. THE CROSS-PHASE HANDOFFS HOLD. Where phase A says phase B will do something, open B and
     confirm it does. The known-fragile ones: 11e owns the seed bootstrap that 11f, 11g, 11h
     and 11k all depend on; 11c settles the food ladder that 11h and Phase 15 build on; 11d
     re-derives the pins every later phase cites; 11j's coverage tests are what 11m's audit
     reports against.
  e. NOTHING WAS DOUBLE-BUILT. Two phases authoring the same content is a real failure mode
     in this packet and it has already happened once and been caught. Sweep for a second
     instance: the same recipe row, vendor row, deed, or test written by two phases.
  f. THE ABSORBED FARMING WORK IS ACTUALLY CARRIED. Farming shipped 14 phases of content.
     Confirm the packet's plan preserves it rather than quietly re-deciding it, and that
     farming's own locked decisions (D1 to D24) are either honored or explicitly superseded
     with a reason.

STEP 3 - THE FUN AUDIT (the part no test can do)
For each profession, answer in plain language, with evidence:
  a. WHAT DO YOU DO? Describe the actual player activity at low, mid and high skill. If the
     answer at any tier is "click the same recipe several hundred times", say so.
  b. IS IT A CHORE? Chore markers: a required daily visit, a punishment for absence, a
     mandatory travel loop with no decision in it, a grind whose only variable is repetition
     count, an activity with no failure state and no choice. Farming's anti-chore contract
     (no daily reset, no decay, nothing rots, two visits per cycle, absence costs only
     opportunity) is the standard the whole feature should be held to, not just farming.
  c. WHERE IS THE DECISION? A fun profession has choices: which input, which risk, which
     market to serve, when to sell. Name the decision at each tier, or report that there
     isn't one.
  d. IS THE PAYOFF VISIBLE? Does the player SEE the skill improving in the world, or only in
     a number?
  e. WOULD SOMEONE DO THIS IF IT GAVE NO REWARD? If no, that is fine, but then the reward
     had better be real. Check that it is.

STEP 4 - THE MAINTAINER'S FOUR COMPLAINTS, each tested rather than assumed
  1. CAPPING OUT TOO EARLY. For each profession, find the skill level past which nothing new
     unlocks. Compare against its maxSkill. Report the gap.
  2. PROFESSIONS LOSE TO DUNGEONS AND RAIDS. Compare the best craftable gear at each level
     band against the best dungeon and raid drops available at that band. Is crafted gear
     ever the right choice? R5 caps the endgame at 5 percent over raid BiS, so the endgame
     answer is designed; audit the LEVELLING bands, where nobody designed it.
  3. LEVELLING IS TOO EASY OR TOO HARD. For each profession, estimate the actual effort to
     reach each band (crafts needed, materials needed, where those materials come from, how
     many mobs or nodes that implies). Report the outliers in BOTH directions. Known
     starting points to verify: tailoring is reported as easiest; silk comes from three mob
     templates in the whole game while hide comes from 33.
  4. DROPS ARE TOO EASY OR TOO SCARCE. Audit the drop and harvest geography: which materials
     have one source, which have thirty, and which force a leveled player back into a
     starter zone to compete with new players.

STEP 5 - THE FARMING VERDICT (it gets its own step because it is the big addition)
Farming was a complete 14-phase feature absorbed whole. Audit it as a player would:
  - Walk the loop end to end from the code: acquire seed, plant, choose knobs, leave, come
    back, harvest, use or sell the produce. Where does it stop being fun?
  - Is it genuinely the "check-in skill" it claims, or does it become an obligation?
  - Is the output worth the wall-clock wait, measured against what an hour of any other
    activity yields?
  - Does the plan's supply line (11g, 11h) actually make farm produce wanted, or does it
    just add rows to bills nobody makes?
  - Is the 100 cap the right stopping point now that it feeds the endgame?
  - Say plainly whether farming is FANTASTIC, FINE, or PRESENT. The maintainer asked for
    fantastic and deserves a straight answer.

STEP 6 - ADVERSARIAL PASS (do this last, and be hard on the work)
  - What did this packet ADD that no player will ever notice or use? Name it and say cut it.
  - What is the single weakest phase in 11b to 11o, and why?
  - Which of the packet's rulings (R17 to R23) will be the first to be regretted, and what
    would make it fail?
  - Where does the plan mistake MORE CONTENT for BETTER CONTENT?
  - If you had to delete one third of this program to make the rest better, what goes?
  - What is the most fun thing in the whole professions system today, and does the packet
    protect it or bury it?

STEP 7 - REPORT
Lead with the verdict, then the evidence. Structure:
  VERDICT            one paragraph: is professions a headline feature after this, yes or no
  EMPTY CELLS        the matrix holes, per profession per band, plan-aware
  FALSE FILLS        cells that look filled and are not
  CHORE FINDINGS     anything that reads as homework rather than play
  THE FOUR COMPLAINTS  one measured answer each
  FARMING            FANTASTIC / FINE / PRESENT, with the reasoning
  CUT LIST           what to remove
  TOP FIVE FIXES     ranked, each with its phase and its size
  WHAT IS ALREADY GREAT  name it, so it is protected rather than refactored away

Rank findings by player impact, not by how hard they were to find. A boring finding that
makes the feature better beats a clever one that does not. Be specific, be honest, and do
not soften a verdict to be agreeable: the maintainer asked for remarkable, and the only
useful audit is one that would say so if it were not.
```

## First-run record (2026-08-20, against the PLAN; ADOPTED IN FULL)

RUN: at feature/masterwrought tip eb1de37961, phases 01 to 11 built, 11b to 11n plan-only.
Method: both branches' content tables extracted and measured by script, eight audit lanes
(mechanics, gear versus drops, pain block, after-matrix, plan completeness, farming loop
walk, fun audit, completeness critic), the critic's residual spot-checks closed by hand.

VERDICT: yes-conditional. Executed as written, the plan makes professions a headline
feature; the audit found four things the plan did not own and a drift set that would have
halted or misdirected executing sessions. Farming: FINE as built, FANTASTIC conditional on
11e/11g/11h/11k, with the anti-chore contract verified in code arm by arm and 11e
load-bearing (the tier 3/4 seed faucet gap makes farming's practical cap 75 as shipped).

HEADLINE MEASUREMENTS (each verified in code before adoption): the required-level cliff
(every rung-50/75 crafted rare gated to character 20 by recipe.level, so crafting
contributes nothing wearable in levels 14 to 19, the longest band; no phase owned it);
the fishing tail (roughly 5000 casts and 11 hours for the last 50 points at 0.02 per
catch; untouched by all seventeen phases); the engineering on-ramp (nothing craftable
below skillReq 75; unattuned engineering cannot gain a point); 11l's arithmetic (its two
headline trophy adoptions impossible under its own economy rules, and no output named for
any of its rows); 11m breaking its own floor test the moment it maps horn and gills, and
unable to force a mid-band silk source; the R21 worked example wrong on both halves
(enchant-table-blind demand census; rare disenchants yield essence, not shards); the
ip-NAME-BORDERLINE drift (implementation-plan.md and decisions-index.md contradicting
state.md row 114); and the Perfecting cadence as the one unbounded design number.

ADOPTION: the maintainer adopted EVERY finding the same day ("I love this! I want to do
EVERYTHING you mentioned"). The adoption pass is recorded as state.md rows 117 to 133
(qr-*), and its edits landed in: implementation-plan.md, README.md, decisions-index.md,
progress.md, state.md, phase-11e, phase-11f, phase-11g-qa, phase-11h, phase-11i and its
QA twin, phase-11j, phase-11l, phase-11m and its QA twin, phase-11n (widened per row 127, its text
amended in place), phase-12, phase-15, phase-16, and the NEW
phase-11o-leveling-crafter.md + phase-11o-qa.md (the fourteenth inserted phase).

PROTECTED LIST (found great; do not refactor away): the farming loop engine and its
anti-chore contract; the placed Harvest Feast (the program's single most fun thing, and
the plan builds the R5 kit on it); the rung-25 leveling market (measured best-in-slot at
levels 8 to 13; the cliff fix must not touch it); the pattern-as-loot channel (all 28
patterns tradeable, the marks vendor the day-one valve); the no-admission-gate craft
design (now to be documented, row 133); the masterwork proc chain; fishing's bite-reel
minigame (the pacing fix keeps the loop); and the one-daily-gate shape (the Quickening
Catalyst stays the packet's ONLY daily-visit mechanic, recorded as a standing guardrail
in the adoption-pass preamble in state.md).

SECOND RUN: still owed after the block lands, against the code, per the instruction at
the top of this file.
