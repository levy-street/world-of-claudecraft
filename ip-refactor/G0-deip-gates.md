# SESSION G0 — De-IP gate + verbatim-name scanner (`tests/ip_scrub.test.ts`, baseline RED)
> Model: Fable 5 / Opus 4.8, xhigh effort. Harness: Claude Code. Branch: `feature/ip-pivot`. Mode: plain.
> READ FIRST: `00-SHARED-CONVENTIONS.md` (in this folder) and the LOCKED `NAME-MAP.md` — the two English source layers, the regen sequence, the contracts/gates, the standard session loop, the validation commands, and the prime directive. Do not re-derive them.

## What we are doing
We are stripping every player-visible Blizzard / WoW IP name out of the game by rewriting DISPLAY strings while freezing every code id, one self-contained slice per session. This slice (G0, built FIRST) is the "set in stone" layer: it builds the committed verbatim-name scanner (`tests/ip_scrub.test.ts`) that FAILS if any curated Blizzard-coined name appears in a player-visible field, and confirms the behavior-unchanged gate baseline is green today. It is the IP analog of the sim refactor's S0a parity harness and the world-api W0a/W0b/W0c gates: the net every later rename track (V/C/W/T) runs against. It lands RED on purpose (today's violations ARE the worklist); the tracks turn it green; Z1 requires it fully green with zero residual. This is a NEW-TEST slice, not a rename: G0 changes no `.name` and no id.

## Goal
Create `tests/ip_scrub.test.ts`, a deterministic static scanner that reads the RESOLVED English i18n table and the sim content and asserts NONE of a curated verbatim-WoW / Blizzard-coined DENYLIST appears in a player-visible field. Land it RED, record the current violations as the baseline worklist, seed that worklist into `02-WORKING-MEMORY.md`, and confirm the existing behavior-unchanged gates are green as the baseline the tracks must preserve.

## Scope (verified)
New file only: **`tests/ip_scrub.test.ts`**. NO `src/` edit, NO rename, NO id change. It reads existing sources, never writes them.

Before writing, confirm the CURRENT source paths, the resolved-table export shape, and the content-module export names via ONE Explore agent this session (the paths below are audit-captured on v0.18.0 and may drift; do not read `classes.ts`/`talents_classic.ts`/`sim.ts` whole). Have the agent return: the `en` export of `src/ui/i18n.resolved.generated/en.ts`, and how `ABILITIES` / `TALENTS` / `MOBS` / `ITEMS` `.name` are reachable (via `src/sim/data.ts` or the individual `src/sim/content/*` modules).

The scanner MUST:
- **Read the resolved English table** `src/ui/i18n.resolved.generated/en.ts` (the `entities.<kind>.<id>.name` values, plus ability/item/talent display names as resolved) and scan every player-visible NAME value.
- **Read the sim content** `.name` fields for `ABILITIES`, `TALENTS`, `MOBS`, `ITEMS` (via `src/sim/data.ts` or the `src/sim/content/*` modules the Explore agent confirms) — the source-of-truth display names, so a name is caught whether or not the resolved table has regenerated.
- **Assert exact whole-name matches on the NAME fields** against the denylist. Whole-value or whole-token match on the display-name field, NEVER a substring scan of prose (with the two documented prose exceptions below).
- **Prose-scan a small explicit set** (the specific coined WORDS C1 will scrub from flavor text): `murloc`, `bristleback`, and the candle flavor (`candle-headed`, `Tallow Candle`). These are case-insensitive word-boundary matches over quest/greeting prose fields, listed as PROSE-SCAN entries distinct from the NAME-field entries.
- **Be a pure data scan:** no wall-clock, no network, no `Math.random`/`Date.now`/`new Date`/`performance.now` (the determinism note in `00-SHARED-CONVENTIONS.md`). Static import of the tables + string comparison only.
- **Report each violation as `{ denylistEntry, field, id, value }`** so the failure output IS the worklist (which id / which field carries which banned name), and so a track can see exactly what it must clear.

Land it RED, capture the failing-violation list, and record the baseline COUNT. Then seed the **Scanner worklist registry** in `02-WORKING-MEMORY.md`: one row per denylist entry with its owning slice and an unchecked `cleared?` box (ownership map below). Commit the scanner RED (the commit lands the gate; the tracks turn it green).

## The mapping (denylist seed — NOT a rename)
G0 applies no NAME-MAP rename. It SEEDS the denylist from two sources and keys it to ownership:

1. **The `NAME-MAP.md` `old` column** (every string flagged `rename`, `coined-id`, or `pairing`). Skip rows flagged `generic-keep?` (Charge, Cleave, Execute, Taunt, Sprint, Stealth, Slam, Ambush, Blind, Sap, Rend, Gouge, Vanish, Kick, ...) — the scanner must NOT fail on a generic-keep name unless the operator has flipped that row to `rename` in the LOCKED map. Key the denylist to the map so an operator decision automatically arms or disarms a row.
2. **A hardcoded verbatim-WoW list** (belt-and-braces, independent of the map so a missed map row still fails): Heroic Strike, Mortal Strike, Sinister Strike, Sunder Armor, Frostbolt, Fireball, Pyroblast, Polymorph, Arcane Missiles, Judgement, Lay on Hands, Consecration, Mind Blast, Devour Magic, War Stomp, Slice and Dice, Eviscerate, Voidwalker, Felhunter, Felguard, Doomguard, Murloc, Bristleback, Drakonid, Shadowmeld, Lightwell (and the rest the audit and `NAME-MAP.md` enumerate).

Ownership of each denylist entry (seed the worklist registry with these owners):
| denylist entry(s) | owning slice |
|---|---|
| ability names (Heroic Strike, Mortal Strike, Sinister Strike, Sunder Armor, Frostbolt, Fireball, Pyroblast, Polymorph, Arcane Missiles, Judgement, Lay on Hands, Consecration, Slice and Dice, Eviscerate, ...) | V1 |
| talent + spec/tree names | V2 |
| Murloc / Kobold (candle flavor) / Bristleback / Drakonid / Mogger | C1 |
| Voidwalker / Felhunter / Felguard / Doomguard (+ the rest of the warlock demon-pet roster) | C2 |
| Shadowmeld / Lightwell (+ the flagged items) | W1 |
| mob-aura Mortal Strike / War Stomp / Devour Magic / Mind Blast (inline mechanic names) | W2 |

## Slice-specific hazards
- **Do NOT false-positive on the game's OWN original names.** The audit confirmed all zones/factions/quests/NPCs/bosses are original: Gravecaller, Wyrmcult, Nythraxis, Korzul the Gravewyrm, Voskar the Emberwing, Eastbrook Vale, Mirefen Marsh, Thornpeak Heights. The scanner keys to EXACT whole-name matches on the display-NAME field, never a substring on prose, so these never trip. Add a focused assertion that the scanner returns ZERO hits for a fixture list of these original names.
- **Do NOT substring-scan prose.** Generic English inside descriptions ("a bolt of fire", "strike the target") must not fail. Only the display-NAME fields get whole-name matching; only the two explicit PROSE-SCAN words (murloc, bristleback, candle flavor) touch prose, and only as word-boundary matches on the specific flavor fields C1 owns.
- **`generic-keep?` names are NOT violations.** Charge/Cleave/Taunt/Execute/... stay unless the operator marks the row `rename` in the LOCKED map. Key the denylist so a `generic-keep?` row is excluded by default; if the operator later flips one to `rename`, the scanner arms it automatically off the map.
- **Same string, two owners (Mortal Strike).** "Mortal Strike" is a V1 warrior ABILITY name AND a W2 mob-AURA inline mechanic name. Disambiguate by the FIELD the hit lands in: an ability-name hit is V1's worklist row, a mob-aura-name hit is W2's. Seed both rows; each track clears only its own field.
- **RED is the expected outcome.** This slice commits a failing test on purpose. Do NOT `.skip`, `.only`, or soften it to make the suite green. The RED baseline IS the deliverable; the worklist count is the acceptance number. (The `Stop` QA hook blocks a stray `.only(`; keep it out.)
- **Determinism.** No wall-clock, no network, no `Math.random`. A second run over an unchanged tree must produce the identical violation list (byte-identical), or the gate is not trustworthy.

## Gate / Parity (do this BEFORE editing)
G0 BUILDS the IP gate, so there is no "before moving" rename. Instead, confirm the behavior-unchanged baseline the tracks must preserve is GREEN today, and prove the new scanner has teeth:
1. Run the existing gates and confirm all green: `tests/parity` (goldens byte-identical), `tests/i18n_resolved_equivalence.test.ts` (SHA), `tests/guide.test.ts` (guide fresh), `tests/localization_fixes.test.ts` (S3), `tests/architecture.test.ts` (src/sim purity), `npx tsc --noEmit`. Record this as the baseline the whole job must keep green.
2. Write the scanner; run it; confirm it lands RED with a NON-ZERO violation list, and that the list contains the expected families (an ability name, a talent name, Murloc/Bristleback/Drakonid, a warlock pet, Shadowmeld/Lightwell, a mob-aura name).
3. **Teeth test:** confirm the scanner is not vacuously red. Point it at a tiny in-test fixture of only ORIGINAL names (Gravecaller, Nythraxis, Reaver Strike) and assert ZERO hits; then add one denylist name to the fixture and assert exactly one hit. This proves it fires on real IP and is silent on original vocabulary.
4. Seed the worklist registry in `02-WORKING-MEMORY.md` from the RED baseline and commit the scanner RED.

## Invariants in play
- **RENAME DISPLAY, FREEZE IDS (prime directive):** G0 renames nothing and changes no id. It is the net, not a move.
- **Behavior unchanged:** the scanner touches no `src/` code and no sim state, so `tests/parity` goldens stay byte-identical and every existing gate stays green. If any existing gate reds while you build G0, you touched something you should not have: STOP.
- **Determinism:** the scanner is a pure static data scan — no wall-clock, no network, no `Math.random`/`Date.now`/`performance.now`. Same tree gives the same violation list.
- **Do not loosen the gate:** a red scan is the worklist, not a bug in the test. Never widen the denylist match, `.skip`, or delete an entry to pass. The only legitimate way an entry goes green is a track actually renaming the display string.
- **i18n emit literals:** N/A — G0 changes no player-facing emit; `tests/localization_fixes.test.ts` (S3) is confirmed green as baseline, not modified.

## Out of scope
- **Any actual rename.** V1/V2 (abilities/talents), C1/C2 (creatures + coined-id sweep), W1/W2 (items + mob-mechanic names), T1 (de-brand text) own the renames. G0 only pins which names are banned.
- **The coined-id sweep.** No id changes here (that is C1/C2, the ONE deliberate id exception).
- **Editing `NAME-MAP.md` or locking it.** G1 fills and the operator locks the map; G0 only READS the `old` column to seed the denylist. If the map is still PROPOSED when G0 runs, seed the denylist from the hardcoded verbatim list plus the sample rows present, and note that G1's LOCK will finalize the `old`-column source.
- **Editing locale overlays** (`src/ui/i18n.locales/<lang>.ts`) or regenerating i18n/guide artifacts (no source `.name` changed).
- **Any "improvement" to the existing gates.** Confirm them green; do not modify them.

## Verify
```
npx vitest run tests/ip_scrub.test.ts               # the NEW scanner: RED with a documented non-zero violation list
npx vitest run tests/parity                         # existing goldens byte-identical (behavior unchanged baseline)
npx vitest run tests/i18n_resolved_equivalence.test.ts # SHA gate green (no English edit)
npx vitest run tests/guide.test.ts                  # guide content fresh (no content rename)
npx vitest run tests/localization_fixes.test.ts     # S3 green (no emit literal moved)
npx vitest run tests/architecture.test.ts           # src/sim purity green (no src edit)
npx tsc --noEmit                                     # types clean (the scanner is well-typed)
```
The scanner run is EXPECTED red; every other command is EXPECTED green. Record the `tests/ip_scrub` violation count as the baseline worklist number.

## Review
- Run a COVERAGE reviewer (the `qa-checklist` gate, or an ad-hoc reviewer) on the diff. Prompt it for COVERAGE, not filtering: report every gap with confidence + severity. Specifically confirm (a) the scanner reads BOTH the resolved English table AND the sim content `.name` fields; (b) the denylist is seeded from the `NAME-MAP.md` `old` column AND the hardcoded verbatim list, with `generic-keep?` rows excluded; (c) it whole-name-matches on NAME fields and only word-boundary-matches the two explicit prose words; (d) it does NOT flag the game's original names (Gravecaller/Wyrmcult/Nythraxis) via the teeth-test fixture; (e) it is deterministic (no wall-clock/network); (f) the worklist registry in `02-WORKING-MEMORY.md` covers every denylist entry with the correct owning slice.
- Confirm the "same string, two owners" case (Mortal Strike -> V1 ability field AND W2 aura field) is disambiguated by field and both worklist rows exist.

## Acceptance criteria
- [ ] `tests/ip_scrub.test.ts` exists and lands RED with a documented, NON-ZERO baseline violation count.
- [ ] The scanner reads the resolved English table (`src/ui/i18n.resolved.generated/en.ts`) AND the sim content `.name` fields (`ABILITIES`/`TALENTS`/`MOBS`/`ITEMS`), and reports each violation as `{ denylistEntry, field, id, value }`.
- [ ] The denylist is seeded from the `NAME-MAP.md` `old` column PLUS the hardcoded verbatim-WoW list; `generic-keep?` rows are excluded unless the operator flips them to `rename` in the LOCKED map.
- [ ] Whole-name matching on the display-NAME fields only; the two explicit PROSE-SCAN words (murloc, bristleback, candle flavor) are word-boundary matched on the C1-owned flavor fields; no substring scan of general prose.
- [ ] Teeth test proves it: ZERO hits on a fixture of the game's original names (Gravecaller, Wyrmcult, Nythraxis, Korzul the Gravewyrm), exactly one hit when a denylist name is added.
- [ ] The scanner is a pure data scan: no `Math.random`/`Date.now`/`new Date`/`performance.now`, no network; a second run gives the identical violation list.
- [ ] The **Scanner worklist registry** in `02-WORKING-MEMORY.md` is seeded: one row per denylist entry with its owning slice (abilities -> V1, talents -> V2, Murloc/Bristleback/Drakonid/Mogger/kobold-candle -> C1, warlock pets -> C2, Shadowmeld/Lightwell -> W1, mob-aura Mortal Strike/War Stomp/Devour Magic/Mind Blast -> W2) and an unchecked `cleared?` box; the "same string, two owners" Mortal Strike case has both a V1 and a W2 row.
- [ ] The existing behavior-unchanged gates are confirmed GREEN as the baseline: `tests/parity` (goldens byte-identical), `tests/i18n_resolved_equivalence.test.ts`, `tests/guide.test.ts`, `tests/localization_fixes.test.ts`, `tests/architecture.test.ts`, `npx tsc --noEmit`.
- [ ] The scanner is COMMITTED RED (green-only rule waived for THIS gate: the commit lands the gate, the tracks turn it green). No `.skip`/`.only`; the gate is never loosened to pass.
- [ ] No rename, no id change, no `src/` edit: the diff is `tests/ip_scrub.test.ts` plus the `02-WORKING-MEMORY.md` worklist seed only.

## QA handoff
Feed these into `00-QA-TEMPLATE.md` for the paired QA session:
- **Re-run the scanner cold** (`npx vitest run tests/ip_scrub.test.ts`) and confirm it is RED with the SAME violation list as the recorded baseline (deterministic). Then re-run the teeth test (original-names fixture -> zero hits; add one denylist name -> one hit) and confirm it fires on real IP and is silent on original vocabulary.
- **Audit denylist coverage:** every verbatim-WoW family the audit found is represented (ability, talent, creature family, warlock pet, item, mob-aura mechanic), and each entry maps to exactly the right owning slice in the worklist registry. Confirm no `generic-keep?` name is armed.
- **Audit for false positives:** confirm the game's original names (Gravecaller, Wyrmcult, Nythraxis, Korzul, Voskar, Eastbrook Vale, Mirefen Marsh, Thornpeak Heights) produce ZERO hits, and that general prose containing generic English (fire, strike, ground) does not trip the scanner.
- **Confirm the behavior-unchanged baseline is genuinely green** (not stale): `tests/parity` goldens byte-identical, `i18n_resolved_equivalence`, `guide`, S3, `architecture`, `tsc` all pass with no G0 edit to any of them.
- **Confirm determinism hygiene:** no wall-clock/network/`Math.random` anywhere in `tests/ip_scrub.test.ts`; the scanner is a pure static read of the resolved tables + sim content.
- **Confirm the worklist registry** in `02-WORKING-MEMORY.md` is the append-only seed the tracks will tick, the Mortal Strike dual-owner rows (V1 + W2) both exist, and Z1's scanner-zero requirement is traceable to it.
