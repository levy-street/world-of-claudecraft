# Phase 11n: The vendor floor

### Starter Prompt
```
This is Phase 11n of the Masterwrought feature: the vendor floor. Vendors currently sell
near-substitutes for crafted consumables, which is why players report that leveling alchemy
to sell potions is pointless. This phase makes every vendor consumable visibly and
structurally worse than its crafted counterpart, so the market, trading, and the professions
themselves become the way players get the good version.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: not needed.

Goal: a vendor is a floor, never a competitor. Crafted output wins on magnitude at every
rung, and the margin WIDENS as the rungs climb.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; SYNC RELEASE (fetch, merge the newest origin/release/**, run the
  release-merge-audit skill on the merge).
- Memory scan: the test-pin trap index, and any entry on balance or the spell-balance
  framework.
- Phases 11b through 11m are merged and green.
- DECISION 13 IS SETTLED (2026-08-20, the full delegation), margins included. Nothing here is
  confirmed at STEP 0. Read the settled decision below and its record in state.md, section
  "Decisions closed 2026-08-20 (the full delegation)" (rows 11n-D-13 and 11n-BOTH), and
  execute it. A disagreement between this file and that record is doc drift to fix before any
  edit, never a licence to pick a margin.

THE REPORTED PAIN (player feedback, 2026-08-20): "There is little point to alchemy if you
sell mana potions at the store. You cannot sell any, it is not really a profit maker
considering you are undercut by the vendors." And: "Potions from vendors are cheap so it is
not worth leveling Alchemy and selling potions. It is fine for self, but people just buy
from vendors."

THE MEASURED FAULT (re-derive in STEP 1; this is the shape, not the authority). The crafted
line already beats the vendor line, but by a margin that SHRINKS as it climbs, which is
backwards:
    sunpetal_mana_draught     425 mana   vs  mana_potion            410   +3.7 percent
    sunpetal_healing_draught  335 hp     vs  healing_potion         320   +4.7 percent
    goldleaf_mana_draught     260 mana   vs  lesser_mana_potion     250   +4.0 percent
    goldleaf_healing_draught  200 hp     vs  lesser_healing_potion  190   +5.3 percent
    silverleaf_mana_draught   160 mana   vs  minor_mana_potion      145   +10.3 percent
    silverleaf_healing_draught 120 hp    vs  minor_healing_potion   110   +9.1 percent
The vendor sells its version at a fixed price in unlimited supply (buyValue 170 at the top
rung) while the crafted version carries sellValue 32. A rational player buys the vendor
potion. Nobody pays a crafter for 3.7 percent, and the effect is strongest exactly where
professions are supposed to matter most: the top.

DECISION 13 (how the floor is created). SETTLED 2026-08-20 under the full delegation.
Recorded in state.md, section "Decisions closed 2026-08-20 (the full delegation)", as rows
11n-D-13 and 11n-BOTH, and WIDENED the same day by the quality-review adoption pass
(qr-11n-WIDE, state.md row 127): the stock-row carve-out grows to five rows, the food
fault table gains four measured rungs, the margin ladder gets an explicit food-tier
mapping, and the no-counterpart exclusion set is the five vendor drinks. The amended text
below is the live instruction. The margins are no longer a STEP 0 call; they are stated
here and the magnitudes are arithmetic the phase computes from them.

- NERF THE VENDOR LINE, never buff the crafted line. This is the R5-safe direction: it
  lowers the baseline a player can buy while leaving the crafted ceiling exactly where the
  power envelope was measured, so Phase 15 needs no re-measurement. Buffing crafted would
  raise the ceiling and re-open R5.
- THE MARGIN LADDER IS 10 / 15 / 20 PERCENT BY RUNG, bottom to top. The vendor magnitudes
  are then derived, not chosen: vendor value at or below crafted divided by (1 plus the
  rung's margin), floored, with the computed value and its crafted counterpart in a comment
  at the definition. On the measured catalog that gives lesser_healing_potion 190 to 173,
  lesser_mana_potion 250 to 226, healing_potion 320 to 279, and mana_potion 410 to 354;
  minor_mana_potion at 145 already clears 10 percent against silverleaf_mana_draught's 160
  and does not move. Re-derive all of these from the merged tree rather than pasting them.
  WHY: the measured shape is inverted, 9.1 percent at the bottom shrinking to 3.7 percent at
  the top, so the crafted economy is weakest exactly where it is supposed to live. R23 says
  weight the nerf toward the TOP rungs because vendor consumables are a new player's floor
  and a top-rung player has options; a 10/15/20 ladder does that by construction while
  keeping every vendor tier above the tier below it and every vendor consumable still worth
  buying.
- THE FOOD LINE TAKES THE SAME LADDER, and it has the worse defect: roasted_boar (foodHp
  117, buyValue 100) currently EQUALS crafted hunters_game_skewer and herbed_marsh_pike at
  117, a zero margin, and brightwood_venison (foodHp 92) BEATS crafted pan_seared_perch at
  90, a negative one. A crafted food that is worse than a vendor food is not a competitor
  problem, it is a broken ladder, and it is the strongest case for acting at all.
  AMENDED 2026-08-20 (qr-11n-WIDE): the review measured FOUR MORE broken food rungs the
  fault table above missed, and all four are in scope: fenbridge_rye 243 equals two
  crafted foods, smoked_eel 432 equals frostgill_chowder, trail_hardtack 552 equals two
  crafted foods (all zero margin), and roast_mountain_goat 874 versus marlows_grand_roast
  980 is 12.1 percent against the 20 percent top-rung target. Re-derive the full pairing
  anyway; these four are the shape, not the whole.
  THE FOOD-TIER MAPPING IS EXPLICIT, never per-definition judgment: the crafted food line
  runs six magnitude tiers against the ladder's three margins, so the phase assigns each
  vendor food a rung by its magnitude TERCILE over the crafted food range (bottom tercile
  10 percent, middle 15, top 20), records the mapping in the ledger, and every changed
  definition cites its tercile in the comment.
- SCOPE IS EVERY VENDOR-SOLD CONSUMABLE, not only potions. The report named potions because
  potions are where players noticed; the audit covers the whole vendor inventory against
  every crafted counterpart.
- TWO EXCLUSIONS, both recorded rather than silent. (1) A vendor consumable with NO crafted
  counterpart is NOT nerfed: there is nothing to widen and the nerf would be pure player
  pain. AMENDED 2026-08-20 (qr-11n-WIDE): on the measured catalog that set is FIVE vendor
  DRINKS, not one: spring_water (Cold Well Water, drinkMana 76), marsh_mint_tea 288,
  silvermist_cordial 436, meltwater_flask 672 and glacier_melt 900. Zero crafted drinkMana
  items exist anywhere, so the entire mana-drink economy has no crafted arm; RECORD that
  as a masterwrought R21-shaped gap in the ledger (a crafted drink line is future content,
  never an 11n nerf), and note for the record that conjured mage food equalling the top
  crafted food at zero cost sits outside R23's vendor-sold scope by wording.
  (2) The both-sourced ids are exempt per 11n-BOTH below.
- SAME-CHANGE OBLIGATION: the combat-potion header in `src/sim/content/items.ts` states the
  target fractions ("potionHp around 80-90% and potionMana around 65-70% of the reference
  pool") and `tests/consumables.test.ts` asserts against them. Lowering the vendor line moves
  those fractions, so both the header and the test are re-derived in the same change. Neither
  is on the original blast list and both are owed.

11n-BOTH, THE BOTH-SOURCED IDS. The set is measured and is exactly THREE:
minor_healing_potion, elixir_of_the_bear, tough_jerky. All three are in live vendorItems
rows. NO SPLIT AND NO MAGNITUDE CHANGE for any of them: they are one item with two sources,
so a nerf hits the crafted arm too, and a split needing new art or new names is a STOP inside
a tuning phase. Pin the allowlist in tests/vendor_floor.test.ts so a future contributor
cannot create a fourth silently.
  ONE FURTHER RULING, and it is the sharpest R23 case in the catalog: REMOVE
  `elixir_of_the_bear` from `alchemist_verane`'s vendorItems row in
  `src/sim/content/zone3.ts`. Keep the item, keep its 7 percent Mirefen drop, keep its combo
  recipe, keep its buyValue. Only the stock row goes.
  WIDENED 2026-08-20 (qr-11n-WIDE, state.md row 127): FOUR MORE stock rows go with it, the
  same shape at the gear axis. smith_haldren (src/sim/content/zone1.ts) stocks four
  byte-identical crafted gear ids (eastbrook_arming_sword, eastbrook_chain_vest,
  eastbrook_wool_trousers, tanned_leather_jerkin): identical id, zero margin, unlimited
  restock, R23's purest competitor form, and the review found no recorded reasoning for
  leaving them. PULL all four from his vendorItems; the recipes, items, prices and drops
  all stay, and the smith keeps his non-crafted staples, so a no-crafter player still buys
  workable gear. The stock-row carve-out is therefore FIVE rows total, named here
  exhaustively; a sixth is still a STOP.
  WHY: elixir_of_the_bear is buff_sta 12 for 900s sold for 100 copper by Alchemist Verane,
  the alchemy master herself, and it exactly equals elixir_of_the_serpent, the alchemy-50
  crafted top elixir, at 12 for 900s. That is a zero-percent margin, worse than any potion
  rung, and it is R23's competitor in its purest form. It is also the one vendor-sold BUFF in
  the catalog: R23's floor protects what a new player needs, which is heals, mana and food,
  never a raid-tier stamina buff, so pulling the row costs the floor nothing and the master
  stops undercutting her own students.
  REJECTED: splitting any both-sourced id into a vendor variant and a crafted variant. It
  mints content (new id, art, name, M16, wiki) inside a tuning phase and the file's own
  stopping rule already forbids it.

R23, the ruling this phase enforces (its full text is in state.md's locked rulings): no
vendor-sold item may sit within the decided margin of a crafted equivalent on the axis that
matters (magnitude, duration, or both), and the margin widens by rung. Enforced by a test,
not by intention. The decided margins are now fixed at 10 / 15 / 20 percent by rung, per
decision 13 above.

WHY THIS IS NOT JUST A NUMBERS EDIT. Three interactions to respect:
- Vendor consumables are a NEW PLAYER'S floor. Nerfing the bottom rung hurts the people
  least able to route around it, so weight the nerf toward the TOP rungs where the crafted
  economy is supposed to live and the player has options.
- Some ids are BOTH vendor-sold and crafted. The set is measured and is exactly three
  (minor_healing_potion, elixir_of_the_bear, tough_jerky), and 11n-BOTH decides all three the
  same way: leave the magnitude alone, never split. Re-derive the set from the merged tree
  anyway; a fourth appearing is a finding, and the allowlist pin exists so it cannot appear
  silently. A consequence worth stating: minor_healing_potion is exempt, so the bottom hp rung
  keeps its 9.1 percent margin and is recorded as EXEMPT rather than as a miss. The 10/15/20
  ladder therefore binds at the lesser and standard rungs and on the food line, and this phase
  must not reach for the bottom hp rung.
- Potion magnitudes feed combat throughput. Lowering the vendor line lowers the floor of
  what an unprepared player brings to a fight, which touches encounter tuning at the low
  end. Sanity-check against the levelling curve rather than assuming a percentage is safe.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs or coordinator monoliths in
the main loop):
- Re-derive the full audit from the merged tree: every item with potionHp, potionMana,
  foodHp, drinkMana, an elixir record, or a wellFed record; whether it is vendor-sold
  (buyValue present, and which vendor stocks it), crafted (a recipe result), or both; and
  the magnitude pairing between each vendor item and its nearest crafted counterpart.
- src/sim/content/items.ts and profession_items.ts (the definitions), the vendor stock
  tables, src/sim/content/recipes.ts (the crafted line), docs/design/professions.md,
  docs/design/spell-balance-framework.md (the method for judging a throughput change).
Return: the pairing table, the both-sourced id list, and every pin that binds a consumable
magnitude.

STEP 2 - EXECUTE (parallel fan-out, explicitly):

Agent 1 (the vendor line):
- Apply the 10/15/20 ladder to every vendor consumable that pairs with a crafted item, potions
  and FOOD alike, computing each magnitude as crafted divided by (1 plus the rung's margin),
  floored. Every changed number carries a comment stating the crafted counterpart and the
  resulting margin, so the relationship is legible at the definition rather than only in a test.
- Leave the three both-sourced ids untouched on magnitude, with 11n-BOTH's reasoning at the row.
- Leave every vendor consumable with NO crafted counterpart untouched (the five drinks on
  the measured catalog, per the amended exclusion above), and record the exclusion list
  rather than leaving it implicit.
- Remove the FIVE stock rows per the widened 11n-BOTH: `elixir_of_the_bear` from
  `alchemist_verane` in `src/sim/content/zone3.ts`, and the four crafted gear ids from
  `smith_haldren` in `src/sim/content/zone1.ts`. Those five are the ONLY stock-row edits in
  the phase. Every item, drop, recipe and buyValue stays.

Agent 2 (the invariant):
- tests/vendor_floor.test.ts: for every vendor and crafted pair, the crafted magnitude
  exceeds the vendor magnitude by at least the rung's margin (10 / 15 / 20 bottom to top),
  and the margin is monotonically non-decreasing as the rungs climb. Failure messages name
  the pair, the actual margin, and the required one.
- Prove it decisive by mutation (raise one vendor value into the band, expect red; restore).
- Add the both-sourced arm: the allowlist is exactly minor_healing_potion, elixir_of_the_bear
  and tough_jerky, each with a comment, so a fourth cannot be created silently.
- Add the SECOND exclusion arm, which is new work this decision creates: a vendor consumable
  with no crafted counterpart is never nerfed, carried as its own literal set (the five
  drinks on the measured catalog, re-derived from the tree) with its own comment. Two
  exclusion lists, two arms; a single blanket skip would hide either one.
- Add the STOCK-ROW arm: the five pulled rows are gone, no OTHER vendor lost a row, and no
  pulled id lost anything but its stock (drop, recipe, buyValue intact), asserted per id.

Agent 3 (economy and copy):
- Re-check tests/recipe_economy.test.ts and any pin binding a changed magnitude; recompute,
  predicted before observed.
- Re-derive the combat-potion header's target fractions in `src/sim/content/items.ts` (the
  "80-90%" and "65-70% of the reference pool" clauses) from the new vendor line, and update
  `tests/consumables.test.ts` with them in the same change. This is owed and is easy to miss:
  the header is prose that asserts a measured relationship, so a moved magnitude staled it.
- Vendor and tooltip copy: no player-visible string asserts a magnitude that moved, and no
  string implies Verane still stocks the bear elixir.
- Wiki regen if any changed value renders in the guide.

INVARIANTS IN PLAY: no crafted magnitude rises in this phase (that is the whole R5-safe
premise, and a sweep must prove it); no consumable is deleted; NO NEW ITEM IDS AT ALL, because
decision 13 authorizes no split; and exactly FIVE stock rows are removed in the whole phase,
`elixir_of_the_bear` from `alchemist_verane` plus smith_haldren's four crafted gear ids
(the widened 11n-BOTH, qr-11n-WIDE), a named exhaustive carve-out from the
"no vendor stops stocking anything" rule and not a licence to prune a sixth row. Every heal,
mana and food row a new player relies on stays stocked.

NAMED REDS THIS PHASE EXPECTS: any pin literal binding a vendor magnitude, until agent 3
recomputes; the new vendor-floor suite until agent 2 lands. Any OTHER red is a real finding.

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
- npx tsc --noEmit; npx vitest run tests/vendor_floor.test.ts tests/recipe_economy.test.ts
  tests/progression.test.ts tests/itemization_coverage.test.ts tests/guide.test.ts
  tests/localization_fixes.test.ts
- npm run ci:changed.
- Dispatch: content-obligations-reviewer, test-coverage-auditor, plus qa-checklist LAST.
  Prompt for COVERAGE, not filtering. Apply ALL findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers): one commit for the
vendor curve, one for the invariant, one for the economy and copy recompute.

STEP 5 - ACCEPTANCE:
- [ ] Decision 13 executed as settled (11n-D-13, 11n-BOTH), with the phase report citing the
      state.md record rather than re-deciding any margin
- [ ] The full audit was re-derived from the tree; drift from this file reported
- [ ] Every vendor and crafted pair meets its rung's margin on the 10 / 15 / 20 ladder, and
      the margin is monotonically non-decreasing as the rungs climb
- [ ] Every vendor magnitude was COMPUTED from crafted divided by (1 plus the margin), not
      chosen, with the arithmetic in a comment at the definition
- [ ] The food line is covered on the recorded tercile mapping: the roasted_boar zero
      margin, the brightwood_venison negative margin, and the four amended rungs
      (fenbridge_rye, smoked_eel, trail_hardtack, roast_mountain_goat) are all closed
- [ ] No crafted magnitude rose anywhere, proven by sweep
- [ ] The both-sourced set is exactly the three allowlisted ids, all three untouched on
      magnitude, and the allowlist is pinned
- [ ] The no-crafted-counterpart exclusion list (the five drinks, re-derived) is recorded
      and pinned as its own arm, and the missing-crafted-drink-line R21 gap is in the ledger
- [ ] The bottom hp rung is recorded as EXEMPT (minor_healing_potion is both-sourced), not as
      a miss
- [ ] All FIVE widened stock rows are gone (`elixir_of_the_bear` from `alchemist_verane`;
      the four crafted gear ids from `smith_haldren`) and nothing else lost
      a stock row; every pulled id keeps its item, drop, recipe and buyValue, pinned per id
- [ ] The combat-potion header fractions in items.ts and `tests/consumables.test.ts` are
      re-derived in the same change
- [ ] Zero new item ids
- [ ] R23 proven decisive by mutation, restored after
- [ ] Economy and magnitude pins recomputed, predicted before observed
- [ ] All listed suites green; ci:changed clean; only the NAMED reds above

STEP 6 - DOCS: progress.md Phase 11n row. state.md ledger: decision 13 as EXECUTED (cite the
settled rows rather than restating them), the pairing table before and after with margins, the
two exclusion lists, all FIVE stock-row removals with their R23 reasoning (Verane's elixir
and smith_haldren's four gear rows), the levelling-curve
sanity check, the re-derived potion-header fractions, and a note that R5's ceiling is untouched
by construction so Phase 15 inherits no new measurement.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, the mutation
kill table, and a one-line handoff for the QA session.

STOPPING RULES:
- Decision 13 is settled, margins included, so there is nothing to ask about the curve. STOP
  instead if this file and the state.md record disagree on 11n-D-13 or 11n-BOTH: that is doc
  drift, fixed before any edit and never resolved by picking a number.
- Stop if closing a gap would require RAISING a crafted magnitude. That re-opens R5 and is
  a Phase 15 conversation, not a tuning edit here.
- Stop if a vendor nerf would leave a levelling band with no workable consumable at all.
- Stop if the both-sourced set re-derives to anything other than the three allowlisted ids:
  a fourth means the catalog moved and the exemption reasoning has to be re-judged, not
  extended by analogy.
- Stop if a both-sourced id turns out to need a split with new art or new names: ledger it
  and ask, rather than minting content inside a tuning phase.
```

## Corrections found by the 11m session's merge audit (2026-08-25): read at STEP 0

Two premises above no longer hold on the tree the 11n session will inherit
(feature/masterwrought at or after the seventeenth release sync, 9f130d3b7c):

- **The both-sourced set re-derives to NINE ids, not three, so this file's own
  STOP rule fires at STEP 0.** vendorItems intersected with every
  ALL_RECIPES.resultItemId on the merged tree: eastbrook_arming_sword,
  eastbrook_chain_vest, eastbrook_wool_trousers, tanned_leather_jerkin (the
  four smith rows qr-11n-WIDE already names), elixir_of_the_bear,
  minor_healing_potion, tough_jerky, PLUS lesser_healing_potion (the 11l QA's
  re-picked potion row, recipe_lesser_healing_potion, sold by provisioner_hale
  and alchemist_verane) and linen_pouch (recipe_linen_pouch, sold by
  trader_wilkes and weaver_ottilie, and by the release's new island
  quartermaster). Branch-caused (11l and an earlier phase), not merge-caused.
  The 11n session re-judges the exemption over the nine as its STOP rule says,
  rather than extending the three-id reasoning by analogy.
- **elixir_of_the_bear's Mirefen drop is 0.8 percent, not 7 percent**
  (src/sim/content/zone2.ts, chance 0.008, unchanged since the classic-era
  loot-rate fix that predates the packet). The "keep its 7 percent Mirefen
  drop" instruction above reads 0.8 percent, and the pin-per-id arm asserts
  the real value.
