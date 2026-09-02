# Phase 19F QA (English i18n completeness: the sixth execution wave of the rulings gate)

VERDICT: **PASS-WITH-FINDINGS.** Ten units, one commit each, ONE escalation
(D149's premise was false and the maintainer took option 1 in session), the
pg-armed gate green (all 12 steps, GATE_EXIT=0, mode full) at `e58bff734a`. The
qualifier is what a completeness wave's QA has to be: the wave exists to stop
non-English readers being told things the English no longer says, and its own
review round found the English itself lying in three places (the tools note
counted three fenced starters where the set is four; the engineering materials
prose counted two rod recipes where there are three; the rare-finds note named
three windfalls where farming rolls a fourth), each of which the wave's fresh
fills had faithfully reproduced into five more languages before the reviewers
caught it. Every ruling survives every correction; three keys were re-keyed a
second time inside the wave, and the tools note a third time. One hundred
instruction defects amended in place before execution, four of them changing the
work (D148's backlog was 4,569 rows, not 7,971; D149's premise was false; D161
could not be retired, only deleted; D074's deferral arm was dead). Three arms
went to the maintainer in session, one premise was escalated, none guessed.
LOCAL ONLY: no push, no PR, no teardown.

Scope: the ten units of `phase-19f-english-i18n-completeness.md` (D070 D074
D085 D144 D148 D149 D150 D161 D169 D174), the Step 0 sync check, the fresh
typed reviews per unit (twenty reports plus one owed by an amendment and
dispatched at the fresh read), ten fix rounds, two coverage audits, a sim
review, and the fresh reads that followed each round. Commit span `c52b275854..HEAD`.

## Step 0: the sync check was a no-op

`origin/release/v0.42.0` had not moved since the 19E close (2ebe95e731 is
still the merge base's tip); no merge, no audit, recorded as the no-op the
phase asked for.

## Step 1: one hundred corrections, four that changed the work

Every unit's contract was read against the tree before execution and amended
in place, dated, with pins cited by test NAME. The four that changed the work:

- **D148**: the measured sim-scope backlog was **4,569** pending rows across the
  20 non-English locales (206 to 246 per locale, en_CA exempt by the dialect
  rule), not the 7,971 the row priced; the maintainer chose the honest scanner
  fix on that number.
- **D149**: the row's premise was FALSE (every rift cast id already carries real
  fills in every locale, and `BRAND_ALLOW` never reaches a sim-scope key), so
  the row was escalated; the maintainer took option 1, translated everywhere.
- **D161**: the every-locale placeholder pin read the FIRST `toolsNote` row of
  each resolved slice, so a retired predecessor would have been the row it
  read; the old key had to be DELETED outright (the a60aa9a4d7 shape).
- **D074**: the deferral arm was dead (D012 closed 2026-09-01), so the choice
  was binary and the maintainer took the status quo.

## What moved, per unit (ruling id, commit)

- **D070** `qr-19-flask-tooltip-spellgnaw-exception` (d7a5b5bc81): the judged
  omission stands; the record now states the retire-and-re-key price, quotes
  the ratified sentence, names the tooltip-writing item-7 exception, and a
  comment beside the key carries the id.
- **D085** `qr-19-materialsbody-onramp-bill-omission` (1af8e857ab, then
  a0ecd5344b): the altitude ratified; the review found the prose counted two
  rod recipes where `ROD_RECIPES` holds three, so it was re-keyed to
  `craftProse.engineering.materialsBodyThreeRods` with fresh fills and, at the
  second round, a pin deriving the count and every bill from `ROD_RECIPES`.
- **D150** (8b7a3969b6): the Drowned Temple deploy-window alias pinned through
  the `Hud.prototype` harness, the horizon restamped to release/v0.42.0, the
  arena three-dot twin pinned; the second round added a bundle-only read so a
  deleted catalog row cannot turn the pin into content-equals-content.
- **D144** `qr-19-crucible-gear-sundering-admission` (52c24404c0, e9d20d6f5a):
  option 4 with option 1 folded; `endgameMaterialsBodyAnyRaid` says what the
  predicate does (any raid tier, either difficulty, gear only); four fills had
  dropped the gear qualifier and were re-filled.
- **D161** `qr-19-toolsnote-stale-nonlatin-fills` (32e6e8fcf6, then
  31084b67ef): the tools note re-keyed to `toolsNoteFiveLadders` with fresh
  fills; the review found its English false (three fenced starters, four in
  `ITEMS`), misleading (the allotment farmer stands at Eastbrook) and
  incomplete (the rods' Marks route), so it was re-keyed once more to
  `toolsNoteFourStarters`, and a third time to `toolsNoteFishingPageMarks`
  when the fresh read found 'the fishing table below' true on one of the five
  pages the note renders on; the placeholder pin now reads the exact key with
  exactly one row per slice, and clause arms derive the fenced set from
  `ITEMS` and pin the cross-page phrase.
- **D074** `qr-19-growth-timer-prose-clause` (324d4fdc6f): the status quo, the
  spread stays a test pin, the declined arm priced and the re-open path named.
- **D174** `qr-19-prog-first-harvest-thirteen-catches` (ec5434ffc4): ratified
  as shipped; the rationale corrected (a fish is no more a `GATHER_NODES` node
  than a farm bed), the three guide `gatherDeeds` lines accepted with the desc,
  the five prescribed pointers quoting the heading.
- **D148** `qr-19-sim-scope-pending-is-unreachable` (4b0062dc5b): the scanner
  reads per-locale source presence through `simDictProvidedKeys`; the second
  round welded the export to the DICT literal's spread list and to the literal
  rows of the locale blocks (two source-text arms), routed the sim scope's
  `dialogue.*` and `lore.*` rows to humanRequired, and rewrote the skill's
  sim paragraph.
- **D169** `qr-19-rarebody-reword-landmine` (b1d693efed): `rareBodyFourFlavors`
  with the maintainer's wording, 'a golden harvest from a garden bed'; the
  packet record landed at the second round with a pin deriving the four
  flavors and their four deeds from the sim.
- **D149** `qr-19-rift-mechanic-names-translate-or-not` (f7d258beb8): the 52
  names filled in the five non-Latin blocks; thirteen rows retuned at the
  second round (the Chain Lightning collision with Skybranch in four locales,
  the zh_CN trade term, eight element-family ties).

## Machine-authored fills, FLAGGED for the maintainer's read

Every fill below was written by a model under the `i18n-locale-fill`
conventions (glossary, shipped entity names, placeholder parity), verified by
a second model against the English, and is registered `translated, by: human`
because the registry has no field for "machine-authored, unreviewed". None is
presented as a reviewed translation. Read them at the Phase 20 STEP 1 pass:

| key | locales | notes for the read |
|---|---|---|
| `guide.professions.endgameMaterialsBodyAnyRaid` | ja_JP ko_KR ru_RU zh_CN zh_TW | four re-filled for the gear qualifier; ru_RU's 'any difficulty' phrasing noted |
| `guide.profPages.toolsNoteFishingPageMarks` | the five | tool and rod names deliberately in Latin to match the tool table beneath (carried: the table renders English names in every locale); the delve name in each locale's shipped casing; the ja_JP, zh_CN and zh_TW Delve Marks terms restored to the overlays' established forms at the third round; ko_KR keeps the polite register its predecessor used |
| `guide.profPages.craftProse.engineering.materialsBodyThreeRods` | the five | the zh_CN gloss the English lacked was dropped and Highwatch localized at the third round; the ja_JP and zh_CN Delve Marks terms were restored to the overlays' established forms; the round-five per-clause arm holds every rod, fish, count and prior rod in each fill |
| `guide.profPages.rareBodyFourFlavors` | the five | ja_JP, ko_KR and ru_RU say 'four' where the English is count-free (a fifth flavor would stale them silently); col_golden_harvest has no localized deed name in any locale, so the crop flavor cannot match a shipped deed name; the coined forms to adopt when the deed is filled: 黄金の収穫, 황금빛 수확, золотой урожай, 金色丰收, 金色豐收 |
| `aura.rift*` and `mechanic.rift*` (52 keys) | the five, in `src/ui/sim_i18n.ts` | thirteen retuned at the review round; ja_JP and ko_KR split the Rime / Rimebite stem (each half a shipped mob name, judged defensible by the parity reviewer, left for the maintainer); zh_TW's Pact Rot now follows Void Rot's head word |

The predecessors' reviewed rows are kept where the keys were retired
(`endgameMaterialsBody`, `engineering.materialsBody`, `rareBody`) and gone where
the keys were deleted (`toolsNoteThreeRods`, `toolsNoteFiveLadders`, `toolsNoteFourStarters`).

## Reviews

Thirty-two fresh reviewers, auditors and readers in all: twenty fresh typed
reviewers over the ten units (cross-platform-sync, frontend-seam,
content-obligations, gate-integrity and qa-checklist as each contract named
them), plus the frontend-seam review D085's amendment owed, dispatched at the
fresh read. Round one (a0ecd5344b) applied the D085, D144 and D150 findings; its
fresh read returned four should-fix and seven nits, all applied in round two.
Round two (31084b67ef) applied every remaining finding, blocking, should-fix and
nit alike. Round three (9488022093) applied the frontend-seam review D085's
amendment owed and the items round two had recorded; round four (92aa815b6d)
applied the coverage audit of the round-two pins; round five (41f650418d)
applied the sim reviewer's belt finding on the gather-events refactor and the
coverage audit of rounds three and four; round six (10ddc1febc) applied the
fresh read of rounds three and four, including one edit round three had meant to
make and had not; round seven (911d70f424) applied the fresh read of rounds five
and six; round eight (64b866e420) applied the replacement fresh read of round
two (the tools note's third re-key); round nine (b0a171ff45) applied the fresh
read of round seven; round ten (5e6d6b5453) applied the fresh reads of rounds
eight and nine. Round seven (911d70f424) applied the fresh read of rounds five
and six; round eight (64b866e420) the replacement fresh read of round two, the
tools note's third re-key; round nine (b0a171ff45) the fresh read of round
seven; round ten (5e6d6b5453) the fresh reads of rounds eight and nine; round
eleven (e58bff734a) the one cosmetic nit the round-ten read returned. Every
round was read fresh; the last read returned nothing else.

Findings that moved a record or the code, chief among them:
- the tools note's English was false in one count, misleading in one place
  and incomplete in one (content-obligations and frontend-seam, D161);
- the engineering materials prose counted two rod recipes of three
  (qa-checklist, D085);
- four D144 fills had dropped the gear qualifier (content-obligations and
  qa-checklist, D144);
- the Chain Lightning rift mechanic collided with the Skybranch ability's
  localized name in four locales (cross-platform-sync and frontend-seam, D149);
- the registry pin was a self-comparison with respect to the export's own
  completeness (gate-integrity, cross-platform-sync and qa-checklist, D148),
  and the source-text anchor that closed it surfaced eight dead duplicate
  `BASE_NEW` rows, seven carrying different text from the rows that shadowed
  them;
- the i18n-locale-fill skill said the worklist never lists sim rows, and the
  worklist classified every sim row, boss dialogue and lore included, as
  machine-fillable chrome (qa-checklist, D148);
- D169's packet record had not landed (content-obligations and qa-checklist);
- D085's amended record attributed its precedent to Phase 11o where it was the
  11i fishing-page pass (the round-one fresh read).
- the rod-bill pin false-passed on a koi count swapped between two bills, then
  on a stem mentioned earlier in the prose, then on a false reagent; it now
  works per clause, anchored at the rod sentence, exactly once per stem, and
  closed to foreign items (the D085 frontend-seam review, then the coverage
  audits);
- the every-locale engineering materials arm was whole-body and name-only; it
  now cuts each fill at its own rod names and checks the fish, the count in the
  locale's numeral form and the prior rod per clause, with an explicit Russian
  stem per item (the two-letter strip had let a replaced head noun through);
- the flavor record that replaced the exhaustive switch inherited
  Object.prototype, so a prototype key answered with a function where the
  switch had answered undefined, opening the farming harvest's `!= null` belt
  (the sim reviewer); it is null-prototype and frozen now, and the module's own
  suite pins the contract;
- the fenced-starter arm had dropped the sentence's own qualifiers (land only,
  the price); it derives both now and carries a positive control;
- the recorded Latin-side regression of the engineering re-key counted eleven
  locales; tr_TR never carried the row, so it is ten plus five.

One refutation the fourth round recorded wrongly and the fifth corrected: the
per-locale identity anchor the coverage audit asked for cannot see a row moved
between two locale blocks (the runtime tables are built from the same text),
and the round-four record said the count anchor was equally blind; it is not.
The count anchor reds on that very mutation (four locales provide the key,
five rows spell it) and the rift script arm reds too; only a move into a
locale that never spelled the key is invisible to every source-text anchor,
and that class is a fill-quality defect for the maintainer's read.

## Refused, with the reason recorded

- Stripping the em dashes from the ru_RU overlay rows (frontend-seam, D150):
  native punctuation in `src/ui/i18n.locales/` is exempt by the repo's own copy
  scan, and the i18n-locale-fill skill forbids stripping it.
- Re-tying ja_JP and ko_KR's Rime / Rimebite stems (qa-checklist, D149): the
  parity reviewer judged the split defensible (each half is a shipped mob
  name), no natural same-stem pair exists in either language, and the fills
  are flagged for the maintainer's read anyway.

## Carried for the maintainer, not taken

- `Hud.localizeSystemText` extraction into a registered pure core (D150).
- The `error.sunderTarget` emit still says 'raid-won epics' without 'gear'
  (an S3 change with twenty locale rows).
- `BRAND_ALLOW`'s sixteen dead rift entries have no owner and no retirement
  condition.
- `src/sim/content/dungeons/temple.ts` comment dashes (pre-existing).
- The gathering tool table renders every tool name as untranslated English in
  all locales (`esc(tool.name)` in `professions_gathering.ts`) where the
  crafting page resolves `entities.items.<id>.name`; the note's fills keep
  Latin tool names to match it until it is fixed.
- The five per-locale `*_EXTRA` sim tables (arena, battleground, quest, item,
  raid) plus the arena min-level literal are tsc-forced dense and stay outside
  the registry (zero copied-English rows measured 2026-09-02); the sim scope
  has no copied-English guard (D148 arm 2, declined).
- `en_CA` carries 245 dead English rows in its `BASE_DICT` block.
- `log.arenaQueueAutoLeave1v1` has two carriers (several `BASE_DICT` blocks
  spell it; the literal wins).
- `guide.profPages.farm.tableBodyOneMeal`'s fills render Book of Deeds
  off-glossary in zh_CN, zh_TW and ko_KR and leave 'Golden Harvest' in Latin
  (a Phase 20 item).
- The generated `rareEvent.flavors` record keeps three members (ore, wood,
  herb) while the prose names four; no page consumes it (D169 option D was not
  chosen).
- D103's Phase 19 table rows still read 'new'.
- The five-locale lists hardcoded across about a dozen suites (a shared export
  some day).
- The registry suite's cosmetic `git pathspec` stderr line on the gitignored
  summary.
- The census WARN on `profPages.toolsNoteThreeRods` (a branch-authored key
  deleted on the branch: no parent carries it, so the rename row cannot match
  a missing name; RESULT stays PASS).
- Commit-message imprecisions that history keeps: ec5434ffc4 lumps the two
  fill channels as '36 overlay fills'; 633e6c233a's body names three extras
  rows and not the exports row it also carries; the D148 commit carried one
  D144 record line; the Phase 20 hand-carry for D149 landed in D148's commit.

Not taken, by the phase's own rule: 19E's five carried items, 19D's three,
19C's three, 19B's four; R5 stays frozen; every judged list binds.

## Validation

node scripts/gate_select.mjs on the committed tree e58bff734a, pg-armed with
TEST_DATABASE_URL only (DATABASE_URL never exported; the arming proved by
contrast first: tests/account_wealth_db.pg.test.ts skipped unarmed, 3 passed
armed; zero pg suites skipped in the gate), launched in the background with a
marker file and judged by the real GATE_EXIT=0 line: PASS, all 12 steps green,
mode full (a broad change set: 2148 paths against origin/release/v0.42.0), 8
workers, 12 minutes; the malware scan PASS (7930 files, 442 flags, 0 high after
priors); the real-browser suite 38 files, 332 passed. tsc 0 at every one of the
24 commits; npm run ci:changed exit 0 after the LAST code commit and again after
the close-out; the census RESULT: PASS captured without a pipe at every commit
(one pre-existing WARN: the rename row for the branch-authored
toolsNoteThreeRods matches no missing name, by construction); the guard suites
green throughout (architecture, monolith, world_api parity, the S3 guard
tests/localization_fixes.test.ts, tests/i18n_completeness.test.ts,
tests/guide.test.ts, tests/guide_key_coverage.test.ts,
tests/i18n_resolved_equivalence.test.ts on every committed tip);
I18N_RELEASE_TIER never set (the release-i18n red on 14,275 pending rows is
Phase 20's contract, not this wave's regression).

## Drift

PREDICTED before the gate and re-derived after each round: files 3670 passed / 1
skipped = 3671 (no new test file); cases +9 exact over the 19E close of 54,533 /
9 / 28 = 54,570 (the D150 alias pin, the arena twin pin, the D148
SOURCE-presence arm, the D149 rift arm, the rare-finds four-flavor arm, the two
registry source-text arms, the every-locale engineering materials arm, the
gather-events source-list arm). MEASURED at the gate: Test Files 3670 passed | 1
skipped (3671); Tests 54,542 passed | 9 expected fail | 28 skipped (54,579).
Prediction exact in both.

## Every new pin, mutated and watched fail alone

| pin (test name) | mutation, applied ALONE and restored from a disk copy | mutated run | restored run |
|---|---|---|---|
| 'the shared tools note is TRUE of farming, not only of the node trades' (tests/guide.test.ts) | en slice: 'four 20-copper land starters' to 'three' | 1 failed | 1 passed / 123 skipped |
| same | en slice: 'Garden Hoe' dropped from the list | 1 failed | 1 passed |
| same | en slice: '20-copper' to '25-copper' (round 4) | 1 failed | 1 passed |
| 'publishes the tool-gate thresholds through placeholders in EVERY locale' (tests/guide.test.ts) | ja_JP slice: a second toolsNote row inserted | 1 failed | 1 passed |
| 'the rare-finds note names every gather windfall flavor and its zero-Renown deed' (tests/guide.test.ts) | en slice: 'a golden harvest' reworded | 1 failed | 1 passed |
| same | gather_events.ts: a fifth source 'reef' in the flavor record (round 4) | 1 failed | 1 passed |
| 'resolves the new professions keys in English' (tests/guide.test.ts), the rod-bill arm | en slice: 'The three rod recipes' to 'two' | 1 failed | 1 passed |
| same | en slice: 'ten Raw Hollowgill Sturgeon' to 'nine' | 1 failed | 1 passed |
| same, per clause (round 3) | en slice: koi counts swapped between the Stormreel and Tidewrought clauses | 1 failed ('the Stormreel clause states four Sunglint Koi') | 1 passed |
| same, prior rod (round 4) | en slice: the Clockreel re-based on the Stormreel | 1 failed ('the Clockreel clause names its prior rod Tidewrought') | 1 passed |
| 'the engineering materials fills name every rod and fish in their own locale' (tests/guide.test.ts, round 3) | ja_JP slice: the Clockreel renamed | 1 failed ('ja_JP names clockreel_fishing_rod') | 125 passed |
| 'simDictProvidedKeys enumerates exactly the sources the DICT literal spreads' (tests/i18n_status_registry.test.ts) | sim_i18n.ts: IGNIVAR_DICT dropped from the DICT literal | 1 failed | 1 passed / 22 skipped |
| 'every provided sim row is a literal row of some locale block (source-text anchor)' (same file) | sim_i18n.ts: the export over-provides pt_BR with the whole English table | 1 failed | 1 passed |
| same | sim_i18n.ts: IGNIVAR_DICT dropped from the export only | 1 failed (2 rows, 0 locales) | 1 passed |
| 'every rift name key carries a real translation in each of the five, from its own block' (tests/sim_i18n_rift_mechanics.test.ts) | sim_i18n.ts: ru_RU riftRime set to 'Raim' | 1 failed | 1 passed / 6 skipped |
| 'treats sim/server/admin DICT scopes as chrome, except the sim scope's dialogue and lore rows' (tests/i18n_fill_worklist.test.ts) | i18n_fill_worklist.mjs: the sim prose branch removed | 1 failed | 1 passed / 13 skipped |
| '(b) routes a pending prose key to humanRequired ... end to end' (same file, round 4) | same mutation | 1 failed ('sim dialogue in humanRequired') | 14 passed |
| 'the Drowned Temple enterText reword keeps its deploy-window alias (D150)' (tests/localization_fixes.test.ts), the bundle-only read | en slice: the enterText row deleted (content fallback live) | 1 failed ('the English catalog carries the enterText row') | 4 passed / 48 skipped |
| 'non-Latin player surfaces ship no untranslated English' (tests/i18n_completeness.test.ts, round 3) | ko_KR slice: rift_frost_execution set to the English 'Glacial Grave' | 1 failed | 1 passed / 13 skipped |
| the D150 alias pin, the arena twin pin, the D148 SOURCE-presence arm, the D149 rift arm | proved at their units (d150_mutate.sh, d148_mutate.sh, d149_mutate.sh; the D148 proof listed exactly the 4,569 rows under the old read) | red | green |
| REFUTED: a per-locale identity arm (round 4 prototype) | sim_i18n.ts: a ja_JP row moved into the ko_KR block | 1 PASSED (the arm cannot see it) | dropped |
| 'resolves the new professions keys in English', anchored windows (round 5) | en slice: a sentence mentioning 'the Stormreel ' prepended | 1 failed | 1 passed |
| same, no foreign item (round 5) | en slice: eight Raw Slatefin Carp added to the Stormreel clause | 1 failed | 1 passed |
| 'the engineering materials fills name every rod and fish in their own locale', per clause (round 5) | zh_CN slice: Stormreel and Clockreel names swapped across clauses | 1 failed | 1 passed |
| same, counts | ru_RU slice: 'десять' to 'восемь' on the sturgeon | 1 failed | 1 passed |
| same, ru stems | ru_RU slice: each of nine names deleted in turn (the Silverstream inside its clause) | 1 failed x 9 | 1 passed |
| 'the runtime source list is every node type plus the crop, and answers no prototype key' (tests/gather_rare_events.test.ts) | gather_events.ts: the record back on a plain prototype | 1 failed | 1 passed |
| 'the shared tools note is TRUE of farming...', the land positive control | items.ts: the Silverstream rod fenced | 1 failed | 1 passed |
| 'every provided sim row is a literal row of some locale block' (record correction) | sim_i18n.ts: a ja_JP row moved into the ko_KR block | 1 failed ('4 locales provide it, 5 locale rows spell it') | 1 passed |
| the locale arm, count bound to its fish (round 7) | zh_CN / ru_RU / ja_JP slices: two counts swapped within one clause | 1 failed x 3 | 1 passed |
| the locale arm, foreign items (round 7) | zh_CN slice: the sturgeon added to the Stormreel clause | 1 failed | 1 passed |
| the locale arm, refined heads (round 7) | zh_CN slice: a stray earlier Stormreel mention plus a corrupted real bill | 1 failed (the stray mention alone stays green) | 1 passed |
| the English rod arm, short forms and reagent rods (round 7) | en slice: 'eight Carp' in the Stormreel clause; 'a Silverstream rod' in the Tidewrought clause | 1 failed x 2 | 1 passed |
| 'the shared tools note is TRUE of farming...', the cross-page clause (round 8) | en slice: 'the fishing table below' restored | 1 failed ('no cross-page below') | 2 passed |
| the locale arm, Russian per stem (round 9) | ru_RU slice: 'Сырых сланцеплавниковых карпов' to 'Сырых карпов' | 1 failed | 1 passed |
| the locale arm, Russian binding (round 9) | ru_RU slice: the numeral moved behind the carp's name | 1 failed ('binds 8') | 1 passed |
| the locale arm, Russian numeral bounded on the right (round 10) | ru_RU slice: 'два Кои' to 'двадцать Кои' | 1 failed ('binds 2 to glimmerfin_koi') | 1 passed |
