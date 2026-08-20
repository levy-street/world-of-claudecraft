# Phase 11l: The trophy economy

### Starter Prompt
```
This is Phase 11l of the Masterwrought feature: the trophy economy. Mob drops that are
vendor trash today become profession reagents, so a kill feeds the crafting economy at
every level instead of feeding a vendor.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: yes (batch content across ten professions).

Goal: every orphaned junk drop in shipped content gains a profession consumer matched to
its flavor, is protected from the Sell Junk sweep, and reads as a material rather than as
trash. Zero new item ids. This is the cheapest content in the whole program because every
item already ships with its name, its icon, its art and its locale fills.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; SYNC RELEASE (fetch, merge the newest origin/release/**, run the
  release-merge-audit skill on the merge).
- Memory scan: the new-item-content-hidden-obligations entry, the item-art ownership batch
  XOR entry, the test-pin trap index, and the reusable-gotchas cluster for content work.
- Phases 11b through 11k are merged and green. This phase authors recipe rows over a
  settled item table, so it runs after the supply-line phases and reuses their economy
  discipline.
- DECISION 11 IS SETTLED (2026-08-20, the full delegation). There is nothing to confirm at
  STEP 0. Read the settled decision below and its record in state.md, section "Decisions
  closed 2026-08-20 (the full delegation)" (rows 11l-D-11, 11l-HOLDOUT, 11l-SELL,
  11l-RUNG), and execute it. If this file and that record ever disagree, STOP: a disagreement
  is a doc-drift finding, not a licence to pick.

THE MEASURED OPPORTUNITY (established by the maintainer's census; re-derive it in STEP 1
rather than trusting these literals, but this is the shape):
- 25 junk-kind items appear in a drop table. Exactly 4 feed a recipe today
  (bone_fragments, linen_scrap, spider_leg, wolf_fang). The other 21 are pure vendor
  trash, which is 84 percent of what mobs drop as junk.
- The 21, with sell value and source file:
    bandit_bandana 6 (items)          bogiron_nugget 12 (zone2)
    briny_idol 32 (temple)            chipped_tusk 15 (zone2)
    cracked_fetish 14 (zone2)         cracked_ogre_tusk 42 (zone3)
    cracked_wyrm_scale 35 (zone3)     deepfen_pearl 600 (zone2)
    emberwing_cinderscale 320 (zone3) frayed_prayer_beads 30 (zone3)
    gleamstag_charm 2500 (realm)      guardian_core 180 (realm)
    inert_storm_shard 28 (zone3)      moonpale_scale 26 (temple)
    mudfin_scale 5 (items)            ogre_toe_ring 25 (zone3)
    old_cragmaws_pelt 300 (zone3)     pale_pearl 30 (temple)
    soggy_moccasin 9 (zone2)          tallow_candle 5 (items)
    tangled_weed 1 (items)
- The four already-consumed junk drops are the PRECEDENT. Read how bone_fragments,
  linen_scrap, spider_leg and wolf_fang are wired (def, MATERIAL_ITEM_IDS membership,
  quality, the recipes that consume them) and copy that shape exactly. Do not invent a
  new material class.

DECISION 11 (the trophy mapping and the quality promotion). SETTLED 2026-08-20 under the
full delegation. Recorded in state.md, section "Decisions closed 2026-08-20 (the full
delegation)", as rows 11l-D-11, 11l-HOLDOUT, 11l-SELL and 11l-RUNG. AMENDED the SAME DAY by
the quality-review adoption pass (state.md rows 122 qr-11l-OUT and 123 qr-11l-VALUE), which
found the original counts arithmetically impossible under the phase's own rules: 11l-OUT
below is NEW (the output doctrine the original file lacked entirely), 11l-RUNG now applies
to EVERY adopted id, and 11l-D-11's original counts are SUPERSEDED. The text below is the
amended, live instruction set. Five instructions, in execution order:

11l-D-11, THE MAPPING AND THE QUALITY PROMOTION (counts AMENDED 2026-08-20 by qr-11l-VALUE,
state.md row 123). ADOPT the flavor mapping below WHERE 11l-RUNG's arithmetic admits the id,
one profession per item, and promote every adopted reagent out of quality 'poor'. The rule is
"no adopted reagent stays quality 'poor'", NOT "set every one to common", and the COUNT is
DERIVED from the merged tree rather than pasted from here. The AMENDED prediction, measured
2026-08-20 against the catalog ceiling (highest crafted output sellValue 460, jewelcrafting's
320): FOURTEEN ids are adopted (21 minus the two 11l-HOLDOUT keeps minus the FIVE ids
11l-RUNG's arithmetic excludes: gleamstag_charm 2500, deepfen_pearl 600,
emberwing_cinderscale 320, old_cragmaws_pelt 300, guardian_core 180). All FOURTEEN adopted
ids ship quality 'poor', so FOURTEEN rows move to 'common' and no non-poor id needs a
quality-axis carve-out (the four non-poor ids are all in the excluded five). The original
reading (NINETEEN adopted, FIFTEEN move) assumed the high-value ids were adoptable; the
review proved they are not under 11l-SELL plus tests/recipe_economy.test.ts, so the original
counts are SUPERSEDED and any session observing them has mis-derived. Blast radius, so the
session sizes it up front: the owning content files for the fourteen (items.ts, zone2.ts,
zone3.ts, temple.ts) plus MATERIAL_ITEM_IDS, the "Material" label,
material_profession_hint_view, the two-arm junk-sweep pin, and the THREE
tests/material_taxonomy.test.ts arms enumerated under THE TRAP below.
  WHY: the promotion is mechanically FORCED, not a nicety. MATERIAL_ITEM_IDS is DERIVED by
  deriveMaterialItemIds from every recipe and enchant reagent filtered to kind 'junk', and
  tests/material_taxonomy.test.ts asserts of every member that its quality is not 'poor',
  so an adopted drop JOINS the set automatically and the shipped test goes red unless the
  quality moves. The player-facing reason is the same one: junkSellableSlot gates purely on
  def.quality === 'poor', so an unpromoted reagent is one-click destroyed at the first
  vendor. src/ui/bag_fine_mark_view.ts is the shipped precedent in its own words.
  The mapping, flavor-matched, each landing in a profession that needs the input (the five
  ids in brackets carry the PREDICTED arithmetic exclusion per the amended 11l-RUNG; each
  is re-derived at execution and recorded either way):
    jewelcrafting  pale_pearl, ogre_toe_ring [deepfen_pearl, gleamstag_charm excluded]
    inscription    briny_idol, cracked_fetish, frayed_prayer_beads, moonpale_scale
    leatherworking cracked_wyrm_scale, mudfin_scale [emberwing_cinderscale,
                   old_cragmaws_pelt excluded]
    armorcrafting  bogiron_nugget
    weaponcrafting cracked_ogre_tusk, chipped_tusk
    enchanting     inert_storm_shard
    engineering    [guardian_core excluded; engineering's lane goes EMPTY here on purpose:
                   its on-ramp is Phase 11o, state.md row 119, not a token trophy row]
    tailoring      bandit_bandana
    alchemy        tallow_candle
  JEWELCRAFTING AND INSCRIPTION ARE THE POINT. Both received their base catalogs inside
  this packet (phases 05 and 06) and both are the thinnest in distinctive inputs. These
  drops were authored as flavor and they fit those two catalogs better than anything new
  could. Note the amended shape narrows jewelcrafting's take to the two low-value pearls
  and rings; that is the honest outcome of the arithmetic, and the settled record says so
  rather than stretching a bill.
  DOWNSTREAM, and it is a hard input rather than a parallel edit: Phase 11m maps the orphan
  `gills` tag to mudfin_scale and READS this promotion in code, so 11l lands first and 11m
  verifies the promoted quality in the tree before it writes its row.

11l-HOLDOUT, THE TRASH THAT STAYS TRASH. BOTH tangled_weed AND soggy_moccasin stay trash.
Neither becomes a reagent, neither is promoted, and BOTH are named in the junk-sweep pin's
TRUE arm.
  WHY: src/sim/professions/fishing.ts says at FISHING_JUNK_GAIN_CUTOFF_PROFICIENCY that a
  seasoned angler learns nothing from dredging up weeds and boots, so the joke is a PAIR;
  keeping only the weed leaves half a gag and one stray boot. Two members also keep the
  TRUE arm non-vacuous, which the promoted-set exactness sweep needs. The mechanical
  corollary is automatic: a reagent joins MATERIAL_ITEM_IDS and must then not be poor, so
  "stays trash" and "never a reagent" are one statement rather than two.
  REJECTED: adopting soggy_moccasin as a leatherworking or tailoring scrap. It spends the
  joke on one 9-copper row and thins the pin's TRUE arm down to a single member.

11l-SELL, THE VENDOR SIDE. Every sellValue is FROZEN, gleamstag_charm (2500) and
deepfen_pearl (600) included. Decision 11 does not say otherwise for any id.
  WHY: tests/recipe_economy.test.ts uses sellValue as the value basis for every bill this
  phase writes, so moving a sellValue and adding a bill in one change makes the
  gold-negative arithmetic unverifiable. Freezing the vendor side is also what gives
  11l-RUNG's worth-more-than-the-inputs test its teeth: the vendor-versus-craft choice on
  the two high-value trophies stays a real player decision.

11l-OUT, THE OUTPUT DOCTRINE (NEW 2026-08-20, qr-11l-OUT, state.md row 122; the original
file named no output for any row, which made it unexecutable under the zero-new-ids rule).
Every consumer row this phase writes is a NEW recipe whose resultItemId is an EXISTING,
currently-uncrafted shipped item: the COMMON_RECIPES and COMBO_RECIPES precedent, whose
outputs reuse existing item ids exactly to avoid minting. The selection checklist, executed
and recorded per row:
  - the output has NO existing recipe (recipeForResultItem documents "no two recipes share
    a resultItemId, first match wins", and battlefield-XP attribution rides that
    uniqueness, so a collision is a live defect and not a style problem);
  - the output's quality is at or below the rung's ladder quality, and its flavor matches
    the profession (a leatherworker's row outputs leather-flavored goods);
  - the row's value arithmetic is printed in the row comment: output sellValue strictly
    ABOVE the trophy's sellValue (the amended 11l-RUNG) and strictly BELOW the bill's total
    input value (tests/recipe_economy.test.ts's locked rule), so the output sits in the
    open interval between them;
  - a mapping for which no defensible existing output exists is EXCLUDED and recorded,
    exactly like a value exclusion.
NO bill edit to any shipped recipe is permitted in this phase: new rows only, so no
shipped craft gets more expensive here.

11l-RUNG, WHERE EACH ROW LANDS, AND WHAT DECIDES MEMBERSHIP (GENERALIZED 2026-08-20 by
qr-11l-VALUE, state.md row 123: the rule below now applies to EVERY adopted trophy, not
only the two high-value ones). Each new row's rung matches
its input's DROP LEVEL: a zone1 drop feeds a low rung, a raid-tier drop feeds a high one.
EVERY adopted bill must produce an output worth strictly more than the vendored
trophy, with the arithmetic in the row comment. AND the rule decides MEMBERSHIP, not the
reverse: if no rung in the mapped profession can out-value an id's sellValue inside the
economy invariant's bound, that id is NOT adopted as a reagent, stays a pure vendor trophy,
and the exclusion is recorded explicitly with that arithmetic beside it. The PREDICTED
exclusions on the measured catalog (re-derived at execution, never pasted): gleamstag_charm
2500 and deepfen_pearl 600 (impossible outright: nothing craftable sells above 460),
emberwing_cinderscale 320, old_cragmaws_pelt 300 and guardian_core 180 (above every
realistic output in their mapped professions). Acceptance for this instruction is the
arithmetic, not the intent: either the row
comment shows output value strictly above input value, or the id appears on the recorded
exclusion list.
  WHY: a bill whose output is worth less than its vendored input is a trap that punishes
  the player for engaging with the system, which is the exact player pain this phase exists
  to remove, and the review measured that trap live on five of the nineteen originally
  planned adoptions. Letting the arithmetic decide membership, rather than forcing a bill
  to exist for a mapping's sake, keeps the mapping honest and costs nothing: the fourteen
  real adoptions carry the phase, and fourteen consumers a player actually crafts beat
  nineteen paper ones (masterwrought R21: a recipe nobody buys is still dead content).

THREE MORE PINS IN tests/material_taxonomy.test.ts, measured 2026-08-20 and named here
because none of them is on any other blast list and each goes red the moment agent 1 lands.
None is optional and none is fixed by regenerating anything.
- ALLOWED_UNCLASSIFIED_JUNK, the "completeness tripwire: unclassified non-poor junk" arm,
  is EXACT-SET equality over every kind 'junk' def that is not 'poor' and not in
  MATERIAL_ITEM_IDS. It currently carries SIX members (measured 2026-08-20 by the
  quality-review pass, correcting this file's earlier "four"): emberwing_cinderscale,
  gleamstag_charm, guardian_core, old_cragmaws_pelt, dawnhold_posy and last_keep_signet.
  Under the AMENDED exclusion prediction all four adopted-and-non-poor candidates are
  EXCLUDED by arithmetic, so the PREDICTED outcome is that this literal does not change at
  all. An id that 11l-RUNG excludes on arithmetic STAYS in it, so settle the exclusion list
  before touching this literal, and treat any needed edit here as a sign the exclusion
  derivation diverged from the prediction (report it, then follow the derivation).
- THE NON-VACUITY FLOOR in the "excludes every quality-poor item" arm reads
  expect(poor).toBeGreaterThan(15) with a comment saying "21 poor items at authoring time".
  The catalog holds exactly 21 poor items today, and under the AMENDED counts this phase
  promotes FOURTEEN of them, leaving SEVEN: amber_hide, deepfen_pearl (excluded, stays
  poor), soft_down, soggy_boot, soggy_moccasin,
  stag_antler, tangled_weed. THE FLOOR MUST BE RE-DERIVED DOWNWARD or the arm goes red on a
  correct change. Re-derive it, do not delete it: the arm exists so a rename of the 'poor'
  token cannot leave the sweep iterating nothing, and it still has that job over seven
  members. Predict the survivor list before observing it, and update the comment's count in
  the same edit so the next reader is not measuring against 2026-08-01.
- THE isMaterialItem ARM pins expect(isMaterialItem(ITEMS.guardian_core)).toBe(false) as its
  negative control. Under the AMENDED prediction guardian_core is EXCLUDED and never becomes
  a material, so the control STAYS VALID and needs no replacement; verify that against the
  executed exclusion list, and only if the derivation somehow admits guardian_core does the
  arm need a different control (chosen and named in the ledger rather than deleted).

THE TRAP, and it is the reason this phase exists as its own phase rather than as a batch
of recipe rows. src/sim/items.ts junkSellableSlot gates PURELY on def.quality === 'poor':

  return !!def && def.quality === 'poor' && def.kind !== 'quest' && !def.noVendorSell &&
    !def.soulbound && slot.instance?.boundTo === undefined && !isItemLocked(slot.instance)
    && slot.count > 0;

The HUD wires it to a Sell Junk button (hud.ts sellJunkButtonState and
sim.sellAllJunk) whose hint reads "Sells every gray item in your bags except quest items."
17 of the 21 candidates are quality 'poor' (measured; an earlier revision said 18). Promote
them to reagents without promoting
their quality and players one-click-destroy their own crafting materials at the first
vendor. The fix is SHIPPED PRECEDENT, not invention: src/ui/bag_fine_mark_view.ts records
that fine-grade materials are kind 'junk' but deliberately quality 'common' "so
sell-all-junk leaves them alone (junkSellableSlot keys off poor)". Follow it exactly.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs or coordinator monoliths in
the main loop):
- Re-derive the census from the merged tree: every kind 'junk' item id that appears in a
  drop table, minus every item id appearing in any recipe reagents array. Report the list
  and flag any drift from the 21 above. The census is the phase's own input; never trust
  this file over the tree.
- src/sim/items.ts (junkSellableSlot and its call sites), src/sim/material_taxonomy.ts
  (MATERIAL_ITEM_IDS and how membership is derived), src/ui/item_kind_label.ts (the
  "Material" label arm), src/ui/material_profession_hint_view.ts (the existing view that
  tells a player WHICH PROFESSION a material serves; this phase's items must light it up),
  src/ui/bag_fine_mark_view.ts (the quality precedent).
- The four precedent items end to end: their defs, their MATERIAL_ITEM_IDS rows, the
  recipes consuming them.
- The jewelcrafting and inscription base catalogs from phases 05 and 06 (state.md ledgers),
  so the new rows extend those ladders rather than sitting beside them.
- tests/material_taxonomy.test.ts, tests/material_taxonomy_bootstrap.test.ts,
  tests/recipe_economy.test.ts, tests/itemization_coverage.test.ts.
Return: the re-derived census, the precedent wiring in one paragraph, and every pin that
binds MATERIAL_ITEM_IDS or the junk sweep.

STEP 2 - EXECUTE (parallel fan-out, explicitly; one agent per slice, each owning its tests):

Agent 1 (the item promotions and the taxonomy):
- Promote each adopted item that ships quality 'poor' to 'common' in its owning content
  file (items.ts, zone2.ts, zone3.ts, temple.ts; realm.ts held only excluded ids on the
  amended prediction, so expect no edit there and report one if it appears). PREDICT the
  row count from the
  merged tree before touching anything, then observe: the AMENDED 2026-08-20 reading is
  FOURTEEN rows (qr-11l-VALUE), because all fourteen adopted ids ship 'poor' and the five
  arithmetic exclusions (gleamstag_charm, deepfen_pearl, emberwing_cinderscale,
  old_cragmaws_pelt, guardian_core) are not adopted at all and are untouched on every
  axis. Nothing else about any def changes: ids are frozen, names are frozen, and
  sellValue is FROZEN with no exceptions (11l-SELL).
- Add each to MATERIAL_ITEM_IDS in src/sim/material_taxonomy.ts so the tooltip reads
  "Material" and material_profession_hint_view names the profession it serves. Note the
  derivation: deriveMaterialItemIds reads every recipe and enchant reagent filtered to kind
  'junk', so an adopted id joins the set the moment its bill lands, and
  tests/material_taxonomy.test.ts then requires the quality move.
- Pin, decisively: junkSellableSlot returns FALSE for every promoted item (assert per id,
  not once over the set), and still returns TRUE for BOTH deliberate holdouts,
  tangled_weed and soggy_moccasin, named per 11l-HOLDOUT. Both arms, or the pin proves
  nothing, and the TRUE arm carries two members on purpose so it is not vacuous.
- Pin that the promoted set is exactly the adopted set: no shipped poor item was promoted
  by accident, swept by comparing against a frozen before-list.

Agent 2 (jewelcrafting and inscription rows):
- Recipe rows consuming the mapped drops, extending the phase 05 and 06 ladders at the
  rungs the inputs suit (11l-RUNG: the rung matches the input's drop level), with EVERY
  row's output chosen under 11l-OUT (an existing, currently-uncrafted shipped item, the
  full checklist executed and recorded per row). Follow those
  catalogs' station, trainer and budget conventions exactly; these are ordinary ladder
  recipes, not apex content, and they carry no masterwrought flag and no pattern.
- gleamstag_charm (sell 2500) and deepfen_pearl (sell 600) carry the PREDICTED arithmetic
  exclusion: nothing craftable sells above 460, so both are expected on the recorded
  exclusion list. Run the arithmetic anyway (the prediction is re-derived, never trusted),
  record it either way, and do not stretch a bill to make a mapping true.

Agent 3 (the other professions' rows):
- leatherworking, armorcrafting, weaponcrafting, enchanting, tailoring and
  alchemy rows per the amended mapping, at rungs matching each input's drop level (a zone1
  drop feeds a low rung; a raid-tier drop feeds a high one), every output under 11l-OUT.
  This is the phase's contribution
  to content at all levels: these drops span zone1 trash through the raid tier.
- emberwing_cinderscale, old_cragmaws_pelt and guardian_core carry the PREDICTED
  arithmetic exclusion (320, 300 and 180 against realistic output ceilings below them);
  run the arithmetic, record the verdicts, and note that engineering's lane going empty is
  the settled outcome (its on-ramp is Phase 11o, state.md row 119), not a gap to fill.

Agent 4 (economy, wiki, and the guide):
- tests/recipe_economy.test.ts: BOTH packets edit this file and it carries sorted literal
  pins. Recompute every pin from the merged ALL_RECIPES; never hand-merge and never paste
  an observed value without predicting it first.
- tests/material_taxonomy_bootstrap.test.ts IS A COUNT PIN (it asserts the exact
  MATERIAL_ITEM_IDS size, 66 on the pre-phase tree) and takes the predicted-then-observed
  treatment: predict the new size from the adopted set, then observe. Its sibling
  tests/material_taxonomy.test.ts is NOT a count pin: it is exact-set equality against a
  literal plus membership and class-exclusion arms, so it resolves by re-deriving the
  sorted literal from the merged tree. Both classifications are 11d's finding (11d-U4-MATTAX);
  this phase is the one that moves them.
- Every touched bill re-checks the gold-negative property.
- npm run wiki:content, plus guide prose for the new rows and any guide.* keys they need.
- The material hint copy for each newly-tagged material, English only per the i18n
  contract, with M16 non-Latin fills for any wordy new value.

INVARIANTS IN PLAY: no new item id anywhere in this phase (that is the whole point, and a
sweep must prove it); ids, names and icons are frozen; R17's gear firewall is untouched
because these are mob drops and not farm produce, but R18 still binds, so every promoted
material stays market-listable and no recipe becomes the only source of anything a player
needs; masterwrought R21 is this phase's governing demand ruling (every adoption exists to
give a drop a consumer someone actually crafts, which is why the arithmetic decides
membership); no recipe added here is pattern-gated or apex (this is leveling-tier economy
work);
determinism is not in play (no rng, no sim behavior change) and the phase should say so
plainly rather than have its QA twin hunt for a draw-order impact.

NAMED REDS THIS PHASE EXPECTS (listed, not fixed by regenerating early): the economy pins
until agent 4 recomputes them; the material taxonomy pins until agent 1 lands, INCLUDING the
three named above (the unclassified-junk tripwire, the non-vacuity floor, and the
isMaterialItem negative control); the guide freshness gate until the wiki regen commit. Any
OTHER red is a real finding.

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
- npx tsc --noEmit; npx vitest run tests/material_taxonomy.test.ts
  tests/material_taxonomy_bootstrap.test.ts tests/recipe_economy.test.ts
  tests/itemization_coverage.test.ts tests/item_level.test.ts tests/progression.test.ts
  tests/guide.test.ts tests/localization_fixes.test.ts tests/i18n_completeness.test.ts
- npm run ci:changed (Biome on changed files only; never a whole-tree write).
- Dispatch per the Review Dispatch Matrix: content-obligations-reviewer (a content diff,
  mandatory), frontend-seam-reviewer (the label and hint surfaces), test-coverage-auditor
  (the two-arm junk-sweep pin is exactly the class it exists to check). NO
  architecture-reviewer and NO cross-platform-sync: this diff adds no sim behavior, no
  facet member and no wire field, and the matrix says skip them. qa-checklist LAST.
- Prompt every reviewer for COVERAGE, not filtering. Apply ALL findings: blocking,
  should-fix, and nits.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers): one commit for the
promotions plus taxonomy, one per profession group, one for the economy recompute plus
wiki regen. Never git add -A.

STEP 5 - ACCEPTANCE:
- [ ] Decision 11 executed as settled AND amended (11l-D-11, 11l-HOLDOUT, 11l-SELL,
      11l-OUT, 11l-RUNG, with qr-11l-OUT and qr-11l-VALUE at state.md rows 122 and 123 as
      the amending authority), and the
      phase report cites the state.md record rather than re-deciding anything
- [ ] Every consumer row's output satisfies the 11l-OUT checklist: an existing uncrafted
      shipped item, recipeForResultItem uniqueness verified, flavor and quality matched,
      the open-interval value arithmetic in the row comment; and NO shipped recipe's bill
      was edited anywhere in the phase
- [ ] The census was re-derived from the merged tree, not copied from this file, and any
      drift from the 21 is reported
- [ ] Zero new item ids added, proven by a sweep against the pre-phase item list
- [ ] No adopted reagent is quality 'poor': the promoted rows are 'common', the count was
      PREDICTED before it was observed (FOURTEEN on the amended 2026-08-20 reading), and
      every excluded id (predicted: gleamstag_charm, deepfen_pearl, emberwing_cinderscale,
      old_cragmaws_pelt, guardian_core) is untouched on every axis
- [ ] Every adopted item is in MATERIAL_ITEM_IDS and reads "Material"
- [ ] junkSellableSlot returns FALSE for every promoted id and TRUE for BOTH holdouts
      (tangled_weed, soggy_moccasin), pinned per id in both directions
- [ ] Every adopted item is consumed by at least one recipe, and the consuming rung suits
      the level the item drops at
- [ ] material_profession_hint_view names the right profession for every new material
- [ ] EVERY mapped id EITHER carries a bill whose output value sits strictly between the
      trophy's sellValue and the bill's input value, with the arithmetic in a row comment,
      OR appears on the recorded exclusion list with the arithmetic that excluded it (the
      generalized 11l-RUNG); the five predicted exclusions were re-derived, not pasted
- [ ] Every sellValue in the diff is unchanged from the pre-phase tree, proven by sweep
- [ ] tangled_weed and soggy_moccasin are untouched and still sweep
- [ ] ALLOWED_UNCLASSIFIED_JUNK matches its re-derived set (PREDICTED unchanged at six
      members, since every non-poor candidate is excluded); any movement is reported as a
      divergence from the qr-11l-VALUE prediction before it is applied
- [ ] The quality-poor sweep's non-vacuity floor was re-derived DOWNWARD (not deleted) with
      the survivor list predicted before observed, and its inline count comment re-derived
- [ ] The isMaterialItem negative control was verified against the executed exclusion list
      (PREDICTED: guardian_core stays excluded and the shipped control stays valid; if the
      derivation admits it, a replacement control is chosen and named in the ledger)
- [ ] Economy pins recomputed from the merged ALL_RECIPES, predicted before observed, and
      the MATERIAL_ITEM_IDS size pin in tests/material_taxonomy_bootstrap.test.ts is
      predicted before it is observed
- [ ] Wiki regenerated fresh; guide freshness gate green
- [ ] All listed suites green; ci:changed clean; the only reds are the NAMED ones above

STEP 6 - DOCS: progress.md Phase 11l row. state.md ledger: decision 11 as EXECUTED (cite the
settled rows rather than restating them), the final mapping, any 11l-RUNG exclusion with its
arithmetic, the re-derived census with any drift, the two-item holdout list, the recomputed
economy pins with their predictions beside their observations, the promoted-quality list so
11m can read it, and the note that this phase closes the "junk drops feed nothing" gap the
demand audit in 11j measures.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, and a one-line
handoff for the QA session.

STOPPING RULES:
- Decision 11 is settled, so there is nothing to ask about the mapping. STOP instead if this
  file and the state.md record disagree on any of 11l-D-11, 11l-HOLDOUT, 11l-SELL or
  11l-RUNG: that is doc drift and it is fixed before any edit, never resolved by picking.
- Stop if the re-derived census differs materially from the 21 (it means a merge dropped or
  added content, which is an 11b or 11d finding, not something to absorb here).
- Stop if closing a high-value bill's arithmetic would need a sellValue change: 11l-SELL
  freezes them, and the answer to an unprofitable bill is exclusion (11l-RUNG), not a re-price.
- Stop if any item would need a new id, a renamed id, or an art commission. This phase is
  defined by using only what already ships.
- Stop if a promotion would change an item's drop rate, drop table membership, or binding.
```
