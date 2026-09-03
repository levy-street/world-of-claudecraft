# Phase 19G QA (the closeout wave of the rulings gate)

VERDICT: **PASS-WITH-FINDINGS.** Two units in dependency order, one commit each, ONE
escalation (D168, by the maintainer's word in session), the pg-armed gate green (all 12 steps, GATE_EXIT=0, mode full) at
`b039514caa`. The qualifier is the closeout wave's own: D171's fresh reviews found the
unit's new pins weaker than the precedent they cite (counts hardcoded in the five fills, a
narrowness the pin did not check, a clause window with two free regions, a sweep exemption
swapped for another) and two player surfaces silent on the new produce buyer, and the
rounds that repaired them were themselves read fresh until a read returned nothing above a
nit; D168's reads found the recorded recipe for the eventual harvest wrong in eleven places
(two arms red, not one; the coverage drift ran code-down, not docs-down; a retired
acceptance list with no replacement) and then the record's own bookkeeping wrong in
another eight. Every finding was applied or refused with its reason; the maintainer's
values were taken in session on a corrected menu, never guessed.
LOCAL ONLY: no push, no PR, no teardown.

Scope: the two units of `phase-19g-closeout.md` (D171 executed, D168 escalated), the Step 0
sync check, six fresh typed reviewers at the units, eight fix rounds (four per unit), and
eight fresh reads over them plus the close-out reader. Commit span 4da6b08401 (the Step 1
amendments) through b039514caa for the work, then the close-out record.

## Step 0: the sync check was a no-op

`origin/release/v0.42.0` had not moved since the 19F close (its tip da6458493f is still the
second parent of the 19E sync merge 2ebe95e731); no merge, no audit, recorded as the no-op
the phase asked for.

## Step 1: nineteen corrections before execution, one that corrected a premise

Every unit's contract was read against the tree and amended in place, dated, with pins
cited by test NAME, as their own docs commit (4da6b08401): D171 twelve, D168 seven. The
one that changed the question put to the maintainer: D171's 'the only reagent whose unit
value lands the repair exactly' is FALSE on the live catalog (every tier-3 crop lands unit
value 15 under the shipped rule, and so does chipped_tusk, a zone-4 poor drop that no
recipe consumes); the corrected menu was put to the maintainer before any value was taken,
and the gourd was chosen because it mirrors the elixir's own produce line. The others that
changed the work: the player-copy fix is a retire-and-re-key (never an in-place reword);
the file list gained the affinity pin and lost the gitignored status registry; the
accent-rule widening lands on the derived sweep, never the 11g literal table; both rows
live in phase-19-new-rows.md, so their ANSWERED and ESCALATED clauses sit there (the D169
shape), not in the gate table the prompt named; D168's counts were 3650 and 2938, not 3651
and 2939, and its handoff-row anchor was pipe-flattened. The review rounds added
thirty-nine more, every one dated on the contract (D171 thirty-two in all, D168 twenty-six).

## The maintainer's word, taken in session 2026-09-02

- **D168**: 'Escalate whole' (of: escalate whole; escalate the harvest but land the docs
  rider; push a delivery branch). The row is ESCALATED and not executed.
- **D171 (a)**: frost_gourd count 1 (of: frost_gourd; another tier-3 crop; ink-only, inexact).
- **D171 (b)**: rung 50 alone (of: rung 50; rung 50 plus rung 25; all three bands, the R5
  escalation).
- **D171 (c)**: the pin records the NUMBERS and the equality (of: numbers plus equality;
  equality only).

## What moved, per unit (ruling id, commits)

- **D171** `qr-19-scroll-elixir-15c-parity` (da5f89c51e; the rounds 7e8fc8257f,
  e582764fc2, fc676e2780, b039514caa): recipe_sunpetal_scroll takes frost_gourd count 1
  (second line, after the rung herb), so both rung-50 bills price at 229 through the
  shipped reagentUnitValue rule; the recipes.ts comment corrected (four pristine_venom_gland
  sinks; the rung-25 pair 90 against 106 and the rung-0 pair 26 against 36, recorded and
  not repaired; the tier-3 crops named as the only reagent family at 15, the tusk
  excepted); the inscription catalog literal re-cut and its standing note rewritten into the
  ruling; the parity pin in tests/recipe_economy.test.ts beside the rule, which now lives
  once in tests/helpers/reagent_unit_value.ts (five suites import it; the two that restate
  it on purpose are named in it); the accent sweep made craft-agnostic with a membership
  arm for the scroll row, its exclusion set pinned to the hoe ladder, its floor raised 17 to
  21; the affinity pin at three crafts (the fine twin stays cooking) and the tooltip's
  three-craft line pinned as a string; the player copy retired and re-keyed
  (`guide.profPages.craftProse.inscription.materialsBody` to `materialsBodyFrostGourd`),
  pinned per clause in English (an exact paragraph-two narrowness, the paragraph count) and
  per locale (every count derived from the live bills, looked up in a per-locale forms
  table welded to the shipped names and its numeral, each clause closed, an exact
  per-locale narrowness transform); the farm page's new sibling paragraph
  `guide.profPages.farm.bedsBodyScribeBuyer` naming the scribe as a produce buyer with no
  ordinal, pinned whole in English and per locale, anchored and ordered in the page arm;
  the wiki regenerated; the census rows and the Phase 20 hand-carry.
- **D168** `qr-19-ci-shard-weights-go-public-harvest` (dda61d91be; the rounds
  50620a909a, bb69f27dd9, a862523396, 410575a89b): ESCALATED, not executed. The
  precondition (a green FULL-MODE CI run of a PUSHED branch) is unreachable under the
  standing NO-push rule, and the dependency D009+D170 has been escalated and unexecuted
  since 19A, so the harvest could not be the LAST code-carrying change even if the run
  existed. No code or artifact in the harvest set moved; the handoff row stays
  handed-to-maintainer, unflipped; the ready-to-run recipe on the row is the reviewed one
  (see the reviews below).

## Machine-authored fills, FLAGGED for the maintainer's read

Every fill below was written by a model under the `i18n-locale-fill` conventions, verified
by a second model against the English and the live sim, fact-checked before filling (the
19F lesson), and is registered `translated, by: human` because the registry has no field
for "machine-authored, unreviewed". None is presented as a reviewed translation. Every one
is pinned as a SHAPE anchor in tests/guide.test.ts (a whole literal or an exact narrowness
transform, a gourd-mention count, a closing clause), so a re-cut at the Phase 20 re-read
re-cuts its anchor in the same change; the arms' comments say which fields. Read them at
the Phase 20 STEP 1 pass:

| key | locales | notes for the read |
|---|---|---|
| `guide.profPages.craftProse.inscription.materialsBodyFrostGourd` | ja_JP ko_KR ru_RU zh_CN zh_TW | paragraph one and the grimoire clause byte-identical to the reviewed predecessor in every locale; only the scroll clause and the closing sentence moved (the per-locale undo pairs in the arm ARE the diff); zh_TW's first draft made the gourd the grammatical subject of the parity ('it' then read as the gourd), corrected at verify; ja_JP's first draft rendered 'a garden bed' as a furrow (畝), corrected to the guide's own 畑; ko_KR and ru_RU coin the terrace phrase ('Highwatch 단구', 'террас Highwatch') because their reviewed cooking and alchemy fills predate the gourd and never render it |
| `guide.profPages.farm.bedsBodyScribeBuyer` | the five | one sentence; a first draft opened with 'a third craft' and was re-filled once the ordinal was dropped from the English (the hoe ladder takes fine produce as a tool reagent, and these readers' bedsBody fills name the kitchens only, so the ordinal had no antecedent); at the re-fill ja_JP, zh_CN and zh_TW also dropped a doubled scribe subject after the colon; each locale reuses its inscription prose's scribe and desk terms (銘文師の机, 필경대, стол начертателя, 铭文师的书案, 銘文師的書案); ko_KR and ru_RU keep a second scribe reference the English does not carry (not false; the five are not parallel) |

## Reviews

Fourteen fresh reviewers, auditors and readers at the units and the rounds, plus the
close-out reader. D171: four fresh typed reviewers over the unit (content-obligations,
frontend-seam, test-coverage, qa-checklist) at da5f89c51e; round one (7e8fc8257f) applied
the frontend-seam, coverage and qa-checklist findings whole; two fresh readers over round
one (coverage, frontend-seam) and the content review, which landed after the tree had
moved, fed round two (e582764fc2); two fresh readers over round two (coverage,
frontend-seam) fed round three (fc676e2780); a fresh coverage read over round three fed
round four (b039514caa), which its own read is folded into the close-out reader. D168: two
fresh typed reviewers over the escalation record (gate-integrity, qa-checklist) at
dda61d91be; round one (50620a909a) applied every item of both; a fresh reader over round
one fed round two (bb69f27dd9); a fresh reader over round two fed round three
(a862523396); a fresh reader over round three fed round four (410575a89b), read by the
close-out reader. Every round was read fresh; the last reads returned nothing above a nit.

Findings that moved a record or a pin, chief among them:
- D168's recorded recipe said one arm reds on a wholesale harvest; two do, and the second
  (the fabrication arm) throws on an empty carried map rather than asserting
  (gate-integrity, reproduced by simulation by three readers); the repair moves its two
  mutations onto a synthetic table, never behind a truthiness guard.
- D168's 'docs-drift rider' had the direction inverted: the release commit b38f38ba16
  lowered the partition test's coverage literal from 0.95 to 0.94 while docs/qa-gate.md
  (five sites) and the union tool kept 95 percent; the rider became 'reconcile toward 0.95'
  (gate-integrity).
- The 'CARRIED to Phase 20' block of docs/qa-gate.md is the only complete acceptance list;
  retiring it without a replacement carrying its items would have weakened the eventual
  harvest's bar (gate-integrity); the row's recipe carries the block's four items and the
  three procedural ones.
- The biome step on the weight table is a RED step, not a no-op (biome.json excludes the
  table; serializeWeightTable is its formatter), never to be repaired by un-ignoring the
  file (the D168 round-one reader).
- The five inscription fills hardcoded the count-of-one form and pinned only the clauses
  the repair added (frontend-seam, coverage); every count is now derived from the live
  bills and looked up in a per-locale forms table bound to its noun and its numeral.
- The five-locale arm windowed only the grimoire and scroll clauses, so a false count at
  the head of paragraph two and a sentence in the closing region both survived (two green
  mutants, the round-one coverage read's blocking finding); each locale now carries an
  exact narrowness transform and the paragraph must come back byte for byte; the round-two
  read then found a THIRD paragraph invisible to the English arm, closed by a paragraph
  count that splits the way the renderer does.
- The accent sweep's widening from a craft filter to a slot filter swapped one silent
  exemption for another (coverage, qa-checklist); the exclusion set is pinned to the hoe
  ladder, so a gear row taking a crop reds.
- The accent-governed floor stood at 17 against a derived set of 21, the slack its own
  docblock warns about (content-obligations); raised to 21, tight.
- The farm page named two produce-buying crafts and nowhere the scribe (frontend-seam,
  qa-checklist); a sibling paragraph was added, then its ordinal dropped (the hoe ladder
  buys fine produce as a tool reagent; the five reviewed bedsBody fills name the kitchens
  only, so 'a third craft' had no antecedent for those readers), its fills re-filled, the
  sentence and the fills pinned whole (a reinstated ordinal had survived the derived pins),
  the paragraph anchored and ordered in the page arm, and the key renamed to drop the
  ordinal it no longer carried.
- The Frost Gourd tooltip's three-craft line was claimed pinned and was not (qa-checklist,
  frontend-seam); pinned as an exact string with its fine twin.
- The unit-value rule had six restatements across the test tree (coverage, qa-checklist);
  four suites now import one helper, and the two that restate it on purpose are named in
  it.
- The weld tables could be silenced through the idiom list and substring tokens (coverage,
  rounds two and three); idioms must be count-of-one forms, tokens non-empty, no token of
  one count inside a form of another, and the guard skips nothing.
- R5: section 12.3 of power-verification takes this bill's reagent value as an input and no
  record had cleared it; re-derived by the content review, every printed claim survives
  (inscription's intended path 15525 to 15900, the ratio 0.7956 inside the printed 0.66 to
  0.88 band, 125 crafts reproduced); recorded, no doc edit owed.
- Three record claims were false and corrected: the re-fill was not byte-identical after
  its opening in three locales; the farm page 'nowhere named the third' when no third is
  claimed; the D168 round-one list credited itself for work it had not listed.

Two invalid mutants, recorded rather than hidden: the first pass of the locale mutation
script ran perl -CSD, which decodes the file but not a multibyte pattern literal, so every
substitution silently missed and every 'mutated' run was green (the grep count beside each
mutant caught it); and the first pass of the closing-region insertion mutant hit both the
predecessor and the successor rows of the resolved zh_CN slice (they share the closing text
on separate lines of one file), so the narrowness transform matched by construction. A
mutant is proven applied by a count beside it, never by the run alone.

## Refused, with the reason recorded

- Re-authoring the inscription page's lead sentence ('The desk runs on herbalism and the
  breaking bench') for the one crop the rung-50 scroll now takes (frontend-seam should-fix,
  round one; agreed by the round-one frontend read): the lead characterizes the craft and
  was already inexact before D171 (essence and dust are not herbs); paragraph two of the
  same body names the gourd, its terrace and its parity by name.
- Re-authoring the inscription materials heading ('Herbs, ink, and a vial to hold it',
  which IS an enumeration and now under-counts by the gourd): refused on COST (a heading
  re-key mints 15 pending rows and five fills for a section whose body names the gourd);
  flagged for the Phase 20 fill pass, where the Latin rows are filled anyway. The first
  reason recorded (the engineering precedent) was corrected at the round-one fresh read.
- Rewording 'takes a Frost Gourd off the Highwatch terraces' in the farm sentence
  (frontend-seam, round two: the seed also drops in endgame content and sells at the Heroic
  Quartermaster): the phrase is the page's own idiom for the tier-3 crops (bedsBody uses it
  for Hollis's mountain crops) and states where the gourd is GROWN, not where its seed is
  bought; the English arm now derives it (tier 3; Hollis stocks the seed).

## Carried for the maintainer, not taken

- The shipped `guide.profPages.farm.bedsBody` fills in ALL FIVE non-Latin locales render a
  pre-11g English (the kitchens as the only buyer; no Marlow's ladder, no elixirs, no
  terrace crops in the raid plates and apex flasks, no Evergarden capstones) while the
  registry marks them translated, the D126 reword-staleness class; the same five keep
  'Vale Wheat' and 'Marsh Rice' in English where both items have shipped localized names
  (the ja_JP verifier; confirmed for all five by the round-one frontend read).
- The inscription materials heading's under-count (above), for the Phase 20 fill pass.
- zh_CN renders Highwatch in Latin in the craft prose and as 高望 in the ladder prose of
  the same page (pre-existing; the fills chose the predecessor's side); every guide overlay
  keeps zone names in Latin where src/guide/CLAUDE.md documents the carve-out only for
  class, ability and spec names.
- The harvester (scripts/ci_shard_weights_harvest.mjs) accepts a log with no mode line at
  all; only mode=(unset) and a non-full mode red (pre-existing, backstopped by the
  row-count floors).
- The union tool's 0.95 coverage floor (scripts/merge_audit/shard_weight_union.mjs) is
  asserted by no test.
- The coverage literal's three surfaces (0.94 in the test since the release commit
  b38f38ba16; 95 percent in docs/qa-gate.md and the union tool): reconcile at the harvest,
  recommendation 0.95 (recorded on the D168 row; the maintainer's call).
- The escalation commit's body says its dated line 'closes' the sixteenth-absorb entry
  where the handoff row stays open (a commit-message imprecision history keeps).
- The bodyKey override in src/guide/pages/professions_craft.ts is at its third re-keyed
  body (cooking identity, engineering materials, inscription materials): the rule of three
  says a craft-and-slot map would take the next one without a ternary rung.
- The recipe comment's corrected clauses (four sinks, 90 against 106, 26 against 36) are
  unpinned prose; pinning the unruled bands' numbers would ratify their drift, so they stay
  prose by the ruling's own scope.
- ko_KR and ru_RU's farm fills keep a second scribe reference the English does not carry;
  the five are not parallel (not false).
- D009+D170 stays escalated from 19A (the carrier assignment), and D168 waits on it and on
  the push ruling D022.

Not taken, by the phase's own rule: 19F's twenty carried items, 19E's seven, 19D's four,
19C's three, 19B's four; R5 stays frozen; every judged list binds.

## Deviations from the contracts, recorded

- The prompt placed both rows' ANSWERED clauses in phase-19-rulings-gate.md; the rows live
  in phase-19-new-rows.md (D152 to D176), so the clauses sit there, the D169 shape, and the
  gate table carries only a dated dependency NOTE on the D022 push-consent row.
- The Step 1 amendments were committed as their own docs commit (4da6b08401) before the
  first unit, so each unit commit carries only its own work.
- The branch-new key `guide.profPages.farm.bedsBodyScribeBuyer` was reworded in place (and
  renamed) with its five fills replaced in the same commit, the stated exception to the
  retire-and-re-key convention for a key that has never shipped and has no reviewed row.
- D168's contract named gate-integrity-reviewer and qa-checklist; both were dispatched over
  the escalation record, and the gate-integrity read treated the recorded recipe as the
  future gate change it is.

## Validation

node scripts/gate_select.mjs on the committed code tip b039514caa, pg-armed with TEST_DATABASE_URL only (DATABASE_URL never exported; the arming proved by contrast first: tests/account_wealth_db.pg.test.ts 3 skipped unarmed, 3 passed armed; the porcelain clean at launch), launched in the background with a done marker and judged by the real GATE_EXIT=0 line: PASS, all 12 steps green, mode full (a broad change set: 2150 paths against origin/release/v0.42.0), 8 workers, 12 minutes (19:32:13 to 19:44:55); the malware scan PASS (7931 files, 442 flags, 0 high after priors); the real-browser suite 38 files, 332 passed.

tsc 0 at every one of the eleven commits (4da6b08401 through b039514caa); npm run
ci:changed exit 0 after the last code commit and after the close-out; the census RESULT:
PASS captured without a pipe at every commit; the guard suites green throughout
(architecture, monolith, world_api parity, the S3 guard tests/localization_fixes.test.ts,
tests/i18n_completeness.test.ts, tests/guide.test.ts, tests/guide_key_coverage.test.ts,
tests/i18n_resolved_equivalence.test.ts on every committed tip); I18N_RELEASE_TIER never
set (the release-i18n red on 14,290 pending rows is Phase 20's contract: 14,275 at the 19F
close plus the fifteen Latin rows of the second new key; the first new key's fifteen
replaced the retired key's fifteen).

## Drift

PREDICTED before the gate and re-derived after every round from the diff itself (eight `it`
declarations added, none removed, no new suite): files 3670 passed / 1 skipped = 3671
(unchanged); cases +8 over the 19F close of 54,542 / 9 / 28 = 54,579, so 54,550 / 9 / 28 =
54,587. MEASURED at the gate: Test Files 3670 passed | 1 skipped (3671); Tests 54,550 passed | 9 expected fail | 28 skipped (54,587). Prediction exact in both.

## Every new pin, mutated and watched fail alone

Sixty-two mutants across six suites, each applied ALONE and restored from a disk copy
(never git checkout), restoration proven by cmp; the two invalid first passes above are
recorded in place. The full table, by round, with the failing test name and the counts:

| pin (test name) | mutation | mutated run | restored run |
|---|---|---|---|
| 'the inscription materials prose states the live scroll bill and its parity with the serpent elixir (D171)' (tests/guide.test.ts) | en slice: 'a Frost Gourd off' to 'two Frost Gourds off' | 1 failed / 125 skipped ('the double scroll batch...' does not contain 'and a Frost Gourd off the Highwatch t...') | 1 passed / 125 skipped |
| same | en slice: parity clause 'which prices it even with' to 'a touch under' | 1 failed | 1 passed |
| same | recipes.ts: the scroll's frost_gourd line removed (214 vs 229) | 1 failed ('expected +0 to be 1', the gourd count) | 1 passed |
| same | en slice: closing sentence drops 'the gourd' and 'a garden bed' | 1 failed | 1 passed |
| same | en slice: successor paragraph 1 reworded ('herb patches and gardens') | 1 failed (narrowness: paragraph 1 != predecessor's) | 1 passed |
| same | scripts/i18n_retired_keys.mjs: the inscription materialsBody row removed | 1 failed (RETIRED_KEYS does not include the key) | 1 passed |
| 'the rung-50 scroll and the serpent elixir bill at exact input parity (229 each, through the shipped unit-value rule)' (tests/recipe_economy.test.ts) | recipes.ts: the scroll gourd removed | 1 failed ('the scroll bill: expected 214 to be 229') / 28 skipped | 1 passed |
| same | recipes.ts: the elixir gourd count 2 | 1 failed ('the elixir bill: expected 244 to be 229') | 1 passed |
| same | items.ts: frost_gourd sellValue 15 to 16 (both bills 230: equal, not 229; proves the NUMBERS half) | 1 failed ('the scroll bill: expected 230 to be 229') | 1 passed |
| 'the sweep is craft-agnostic: the rung-50 scroll row (D171) is governed, and clears both readings' (tests/provisioning_supply_line.test.ts) | the sweep filter reverted to cooking-or-alchemy | 1 failed ('the scroll row is governed: ... to include recipe_sunpetal_scroll') / 39 skipped | 1 passed |
| same | recipes.ts: the scroll gourd removed | 1 failed (same message) | 1 passed |
| 'five crops name ALCHEMY as a consumer (Masterwrought phases 11g and 11h)' (tests/material_profession_affinity.test.ts), the D171 arms | recipes.ts: the scroll gourd removed | 1 failed (['alchemy','cooking'] vs ['alchemy','cooking','inscription']) / 16 skipped | 1 passed |
| 'consumes EXACTLY the shipped reagent table, every line of every recipe' (tests/inscription_catalog.test.ts) | recipes.ts: the scroll gourd removed | 1 failed (toStrictEqual, 3 vs 4 lines beside the herb) / 13 skipped | 1 passed |

Restoration proven by cmp against the disk copies after every script: 0 0 0.

| 'the inscription materials fills name the gourd, the serpent elixir and the parity in their own locale' (tests/guide.test.ts) | ja_JP slice: 霜瓜ひとつ to 霜瓜ふたつ (count doubled) | 1 failed ('ja_JP binds one gourd: expected +0 to be 1') / 126 skipped | 1 passed / 126 skipped |
| same | ko_KR slice: the elixir renamed in the clause (뱀의 비약 to 독사의 비약) | 1 failed ('ko_KR names the serpent elixir') | 1 passed |
| same | ru_RU slice: a word added to paragraph one (narrowness) | 1 failed ('ru_RU keeps the predecessor's first paragraph') | 1 passed |
| same | zh_CN slice: the parity word 持平 to 相近 | 1 failed ('zh_CN states the parity') | 1 passed |
| same | zh_TW slice: 一方田畦 dropped from the sources | 1 failed ('zh_TW sources the garden bed') | 1 passed |
| same | ja_JP slice: the SHIPPED gourd name under the table changed (entities 霜瓜 to 霜の瓜) | 1 failed ('ja_JP gourd form carries the shipped name') | 1 passed |
| same | ko_KR slice: 박도 dropped from the never-sold sentence | 1 failed ('ko_KR closes with the never-sold sentence: expected -1 > 357') | 1 passed |
| same | ru_RU slice: 'с террас Highwatch' dropped from the clause | 1 failed ('ru_RU names the terraces') | 1 passed |

Restoration proven by cmp against the five disk copies: 0 0 0 0 0. RECORDED TRAP: the first pass of this script ran perl -CSD, which decodes the file but not a multibyte pattern literal, so every substitution silently missed and every 'mutated' run was green; the grep -c line beside each mutant (0 = not applied) caught it, and the script was re-run in byte mode.

## Round 1 (the frontend-seam and coverage reviews applied), each mutant alone, restored from disk copies (0 x7)
| pin (test name) | mutation | mutated run | restored run |
|---|---|---|---|
| the five-locale arm (tests/guide.test.ts) | ja_JP slice: a second UNBOUND gourd mention in the scroll clause (the audit's M5) | 1 failed ('ja_JP names the gourd 2 time(s)...: expected 3 to be 2') | 1 passed |
| same | ko_KR slice: grimoire goldleaf 두 장 to 세 장 | 1 failed ('ko_KR grimoire clause binds goldleaf_herb') | 1 passed |
| same | zh_CN slice: 多取一份精华 to 多取两份精华 | 1 failed ('zh_CN scroll clause binds arcane_essence') | 1 passed |
| same | ru_RU slice: щепотью пыли to двумя щепотями пыли | 1 failed ('ru_RU scroll clause binds arcane_dust') | 1 passed |
| same | recipes.ts: the grimoire's goldleaf 2 to 3 | 1 failed ('zh_CN has a form for goldleaf_herb at count 3: expected undefined to be defined'); the English arm also red ('expected 3 to be 2') | 1 passed |
| same | zh_TW slice: 一株金葉 named inside the scroll clause (foreign item) | 1 failed ('zh_TW scroll clause does not name goldleaf_herb') | 1 passed |
| same | ja_JP slice: the elixir named a second time (in paragraph one) | 1 failed (narrowness: 'ja_JP keeps the predecessor's first paragraph') | 1 passed |
| the English arm (tests/guide.test.ts) | en slice: 'and a Frost Gourd more besides' (the audit's M4) | 1 failed ('expected 2 to be 1', the gourd named once) | 1 passed |
| same | en slice: an unrelated sentence appended to paragraph two (the audit's M7) | 1 failed (the paragraph-two narrowness transform) | 1 passed |
| same | recipes.ts: the scroll's essence 2 to 3 | 1 failed ('expected 3 to be 2', the absolute pin) | 1 passed |
| 'the rows the sweep EXCLUDES are exactly the hoe ladder: a gear row that takes a crop reds here' (tests/provisioning_supply_line.test.ts) | recipes.ts: frost_gourd count 7 on recipe_sootscale_mantle (the audit's M6) | 1 failed ('recipe_sootscale_mantle consumes produce outside the sweep and is not a gathering tool') | 1 passed |
| 'the Frost Gourd reads three crafts in ring order since D171; its fine twin stays cooking-only' (tests/material_profession_hint_view.test.ts) | recipes.ts: the scroll gourd removed | 1 failed ('Used by Alchemy and Cooking.' vs the three-craft line) | 1 passed |

## Round 1, the farm-page third-craft paragraph (the frontend-seam review), each mutant alone, restored (0 0)
| pin (test name) | mutation | mutated run | restored run |
|---|---|---|---|
| 'the farm beds prose names every craft that buys produce: the third one is the scribe (D171)' (tests/guide.test.ts) | recipes.ts: the scroll gourd removed (two buying crafts) | 1 failed (['alchemy','cooking'] vs the three) / 127 skipped | 1 passed |
| same | en slice: 'A third craft' to 'A fourth craft' | 1 failed | 1 passed |
| same | en slice: 'takes a Frost Gourd' to 'takes two Frost Gourds' | 1 failed | 1 passed |
| same | en slice: 'even' to 'nearly even' | 1 failed | 1 passed |
| the five-locale arm, the closing anchor (round 1) | ja_JP slice: a sentence appended after the vial-only clause (the audit's M7, per locale) | 1 failed ('ja_JP ends on the vial-only clause: expected false to be true') | 1 passed |

## Round 2 (the content review applied)
| pin (test name) | mutation | mutated run | restored run |
|---|---|---|---|
| 'the accent rule governs a real, non-empty set of rows' (tests/provisioning_supply_line.test.ts), the floor raised 17 to 21 | recipes.ts: the scroll gourd removed (the set falls to 20) | 1 failed ('the accent-governed sweep: expected 20 to be greater than or equal to 21') | 1 passed |

## Round 2 (the round-one reads applied: the exact per-locale transform, the farm re-fill, the render anchor, the carve-out pinned), each mutant alone, restored (0 x7)
| pin (test name) | mutation | mutated run | restored run |
|---|---|---|---|
| the five-locale inscription arm, the exact narrowness transform | zh_CN slice: a false sentence at the HEAD of paragraph two (the coverage read's green mutant 1) | 1 failed ('zh_CN paragraph two is the predecessor's plus the two repairs') / 128 skipped | 1 passed |
| same | zh_CN slice: a sentence in the CLOSING region before the vial clause (the coverage read's green mutant 2; a first pass hit both the predecessor and the successor rows and was green by construction, re-run on the successor row alone) | 1 failed (same message) | 1 passed |
| same | zh_CN slice: the closing sentence duplicated (the coverage read's nit) | 1 failed (same message) | 1 passed |
| 'the farm beds fills name the scribe, the scroll, one gourd, the elixir and the parity in their own locale' (tests/guide.test.ts) | zh_CN farm fill: 一个 to 两个 | 1 failed ('zh_CN binds one gourd: expected +0 to be 1') | 1 passed |
| same | ja_JP farm fill: an ordinal restored (三つ目の職) | 1 failed ('ja_JP carries no ordinal') | 1 passed |
| same | ru_RU farm fill: the elixir renamed (Эликсир гадюки) | 1 failed ('ru_RU names the elixir once: expected +0 to be 1') | 1 passed |
| same | ko_KR farm fill: the rung 50 to 25 | 1 failed ('ko_KR states the live rung ... to contain 50 단') | 1 passed |
| 'the farm beds prose names the scribe as a produce buyer, and every craft that buys produce is accounted for (D171)' (tests/guide.test.ts) | en slice: the ordinal restored ('A third craft buys from the beds too') | 1 failed | 1 passed |
| same, the carve-out pinned | recipes.ts: vale_wheat on recipe_sootscale_mantle (an armorcrafting gear row buys produce) | 1 failed (['alchemy','armorcrafting',...] vs the four) | 1 passed |
| 'renders farming with its tool ladder, no node prose, and length-guards empty tables' (tests/guide.test.ts), the render anchor | professions_gathering.ts: the sibling paras() call deleted (the first run used a wrong -t filter and ran nothing, 129 skipped; re-run with the arm's title) | 1 failed ('... to contain takes a Frost Gourd off the Highwatch...') | 1 passed |

## Round 3 (the round-two reads applied: paragraph counts, whole-fill pins, weld-table constraints, the render order, the key rename), each mutant alone, restored (0 x6)
| pin (test name) | mutation | mutated run | restored run |
|---|---|---|---|
| the English inscription arm, the paragraph count | en slice: a third paragraph appended (the coverage read's blocking mutant) | 1 failed ('the successor is two paragraphs: ... got 3') | 1 passed |
| the five-locale inscription arm, the paragraph count | ja_JP slice: a third paragraph appended | 1 failed ('ja_JP successor is two paragraphs') | 1 passed |
| the English farm arm, the whole-literal pin | en slice: 'Engineering buys the fine crops for its hoes.' appended (the frontend read's mutant) | 1 failed (literal equality) | 1 passed |
| the five-locale farm arm, the whole-fill pin | ja_JP slice: a sentence prepended | 1 failed ('ja_JP is the verified fill') | 1 passed |
| same | zh_CN slice: an ordinal in an unlisted form inserted (三样手艺里的最后一个) | 1 failed ('zh_CN is the verified fill') | 1 passed |
| the weld-table constraints (the test's own table) | tests/guide.test.ts: a count-of-two form listed as a ja_JP idiom | 1 failed ('ja_JP idiom ... is a count-of-one form of this locale') | 1 passed |
| same | tests/guide.test.ts: a zh_CN count-1 token ('株') that sits inside the count-2 goldleaf form | 1 failed ('zh_CN token 株 (count 1) is not inside 两株金叶 (count 2)') | 1 passed |
| the page arm's render-order pin | professions_gathering.ts: the sibling paragraph moved before bedsBody | 1 failed ('the scribe paragraph renders after bedsBody: expected 1306 > 1877') | 1 passed |
| the English farm arm, the terraces derivation | zone3.ts: frost_gourd_seed removed from Hollis's stock | 1 failed ('Hollis stocks the gourd seed') | 1 passed |

## Round 4 (the round-three read applied), each mutant alone, restored (0 0 0)
| pin (test name) | mutation | mutated run | restored run |
|---|---|---|---|
| the weld-table constraints, the substring guard without the idiom escape | tests/guide.test.ts: the zh_CN goldleaf form re-keyed to count 1 and listed as an idiom (the reader's green mutant) | 1 failed ("zh_CN token '两' (count 2) is not inside '两株金叶' (count 1)") | 1 passed |
| the English inscription arm, the paragraph count on the renderer's splitter | en slice: a third paragraph joined by newline-space-newline | 1 failed ('the successor is two paragraphs: ... got 3') | 1 passed |
| the page arm's render-order pin, the upper bound | professions_gathering.ts: the sibling paragraph moved into the table section | 1 failed ('the scribe paragraph renders before the table section: expected 4857 < 3956') | 1 passed |
| the fine-twin weld in both five-locale arms (the close-out reader: a new pin with no mutant) | ja_JP slice: the shipped fine twin name 上質な霜瓜 to 上質なウリ (no longer contains the base name) | 2 failed ('ja_JP fine twin name contains the base name: expected 上質なウリ to contain 霜瓜', one per arm) / 127 skipped | 129 passed |
