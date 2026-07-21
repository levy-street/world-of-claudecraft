# SESSION V1 — Ability / spell display rename (9 classes)

> Model: Fable 5 / Opus 4.8, xhigh effort. Harness: Claude Code. Branch: `feature/ip-pivot` (Vocab track worktree). Mode: plain (verify pass).
> READ FIRST: `00-SHARED-CONVENTIONS.md` (in this folder) — the two English source layers, the byte-identical rule, the regen sequence, the contracts/gates, the standard session loop, the validation commands. AND the LOCKED `NAME-MAP.md` (the single source of truth for every old -> new string). Do not re-derive them.

## What we are doing
We are stripping every player-visible Blizzard / WoW IP name out of the game one self-contained slice at a time, applying the LOCKED `NAME-MAP.md` verbatim, changing DISPLAY only and freezing every code id. This slice (V1, first of the Vocab track) renames the ~150 verbatim WoW ability / spell display names across all nine classes to their mapped original names, and scrubs WoW proper nouns out of the ability descriptions. It is display-only: the sim does not move an inch, so every `tests/parity` golden stays byte-identical. Abilities are the heaviest verbatim surface (~150 of 152 records flagged), and V2 (talents) consumes the NEW ability names for its name-pairing constraint, so V1 sets the vocabulary the talent track pairs against.

## Goal
Rename the ~150 verbatim WoW ability display names to their LOCKED NAME-MAP values, scrub WoW proper nouns from ability descriptions, and freeze every ability id. No sim state changes.

## Scope (verified)
Confirm the CURRENT ids, `.name` lines, `.description` lines, and the catalog mirror lines with ONE Explore agent this session (never read `classes.ts` whole; the counts below are audit-captured on v0.18.0 and may drift). Edit BOTH English copies, byte-identical:

1. **`src/sim/content/classes.ts`** — the sim record, source copy 1.
   - `ABILITIES[id].name` for every ability the NAME-MAP marks `rename` (each of the 9 classes).
   - `ABILITIES[id].description` where it names a WoW proper noun: e.g. the mage polymorph description names a "sheep" (scrub to the mapped critter word); warlock summon descriptions name demons (rename the ABILITY name and its description text here; the demon PROPER NOUNS themselves are re-themed by C2, coordinate the demon token with the C2 row but apply the ability-name rename in THIS slice).
2. **`src/ui/i18n.catalog/abilities.ts`** — the `classAbilityNamesEn` entries (`entities.abilities.<id>.name`), source copy 2. Must match `classes.ts` **byte-for-byte** for every renamed id (a single-character drift reds `i18n_resolved_equivalence`).
3. **Regen** (deterministic; run after the edits, before commit):
   ```
   npm run i18n:gen
   npm run i18n:hash -- --write
   npm run wiki:content
   ```
   Commit the regenerated artifacts (`src/ui/i18n.resolved.generated/*`, `src/ui/i18n.resolved.sha256`, `src/guide/content.generated.ts`) with explicit paths in the SAME logical change as the source rename.

**Known leftover to clean (make druid form vocabulary self-consistent):** the druid ability id `cat_form` already renders "Wolf Form", but `tigers_fury` still renders "Tiger's Fury" and some descriptions still say "Wolf Form only". Apply the NAME-MAP so the druid shapeshift vocabulary is internally consistent end to end (the `tigers_fury` name and every "... Form only" description phrase align with the mapped form names). Ids (`cat_form`, `tigers_fury`, ...) stay frozen.

## The mapping (apply NAME-MAP verbatim)
Apply the `NAME-MAP.md` **Abilities (V1)** section verbatim, all ~150 rows across Warrior, Mage, Rogue, Paladin, Hunter, Priest, Shaman, Warlock, Druid.
- Rows flagged `rename` (Heroic Strike -> Reaver Strike, Frostbolt -> Rimelance, Judgement -> Verdict, Polymorph -> Ensorcel, ...): apply the NEW name.
- Rows flagged `generic-keep?` (Charge, Execute, Cleave, Taunt, Sprint, Stealth, ...): keep the OLD name UNLESS the operator marked that row `rename` in the LOCKED map. Honor the per-row operator decision exactly; do not decide it yourself.
- **Never invent an off-map name.** If any ability that reds the scanner is not on the map, STOP and append a request row to `02-WORKING-MEMORY.md` for the operator (the map is append-only after LOCK); do not coin a name.

## Slice-specific hazards
- **BYTE-IDENTICAL two-copy rule.** `classes.ts` `.name` and the `abilities.ts` catalog `entities.abilities.<id>.name` must be identical to the character (spacing, apostrophe glyph, capitalization). Any drift reds `tests/i18n_resolved_equivalence`. Edit them in lockstep, id by id.
- **Talent-ability pairing (V2 consumes your names).** A talent that mirrors/improves an ability must use that ability's NEW name (`talent_i18n.ts` requires a talent name to EQUAL an ability name or carry a title override). Apply the map's ability names EXACTLY as written so V2 can pair against them; do not paraphrase a mapped name.
- **Descriptions are player-visible too.** The `.description` field renders in tooltips and the /wiki guide. Scrub WoW proper nouns inside descriptions (the polymorph "sheep", any demon names in summon copy, any "Wolf Form only" style phrasing) per the map; a rename that leaves a WoW noun in the description still reds `ip_scrub`.
- **Warlock demon boundary.** Rename the warlock ability NAMES and scrub their descriptions here, but the demon PROPER-NOUN re-theme (Voidwalker/Felguard/... and the pet ids) is C2. Use the C2-mapped demon token when a V1 description references a demon, but do not touch `warlock_pets.ts`, `summonDemon`, or any pet id.
- **NO locale overlays.** Do not touch `src/ui/i18n.locales/<lang>.ts`. Contributors add English only; the release-tier locale re-fill is handed off in Z1.

## Gate / Parity (do BEFORE editing)
1. `npx vitest run tests/parity` -> green baseline. Abilities are DISPLAY-ONLY: the goldens (full-state trace) MUST NOT move. Confirm byte-identical green before you rename a single string; if parity is already red, STOP (something upstream is off).
2. `npx vitest run tests/ip_scrub.test.ts` -> note the CURRENT V1 failures (the ability names still flagged). That set is your worklist; each rename ticks one off. Do not `.skip` or loosen the scanner.
3. `git status` clean; `npm ci` if `node_modules` is missing in the worktree.

## Invariants in play
- **RENAME DISPLAY, FREEZE IDS (PRIME DIRECTIVE).** Change only the `.name` / `.description` display strings; every ability `id` stays frozen (ids are persisted on action bars + build strings and index the RL action space).
- **Behavior unchanged.** No sim state, no cast/effect logic, no numbers touched -> `tests/parity` goldens stay byte-identical. A shifted golden means you touched behavior or an id: STOP.
- **Two English copies identical.** `classes.ts` and `abilities.ts` match byte-for-byte for every renamed id.
- **Determinism untouched.** No `Math.random`/`Date.now`; `src/sim/` purity unchanged (this slice edits content records + a catalog, no logic).
- **Apply the map verbatim, invent nothing.** Off-map name -> STOP and ask.

## Out of scope
- **Ability ids** (frozen; renaming one is a save-data + build-string migration).
- **Talents + spec/tree names** (V2) — V1 only supplies the ability names V2 pairs against.
- **Warlock demon proper-noun re-theme + pet ids** (C2) — V1 renames the warlock ability names and scrubs descriptions only.
- **Items / mob-mechanic aura names** (W1 / W2), **class display names** (locked out of scope), **any mechanic, cast time, coefficient, or effect**.
- Any "improvement", reordering, or de-duplication of the content records beyond the mapped string edits.
- The 20 non-English locale overlays (Z1 / maintainer).

## Verify
```
npx vitest run tests/parity                            # goldens byte-identical (behavior unchanged)
npx vitest run tests/ip_scrub.test.ts                  # V1 denylist entries now GREEN
npx vitest run tests/i18n_resolved_equivalence.test.ts # SHA gate (after i18n:hash -- --write)
npx vitest run tests/guide.test.ts                     # guide content fresh (after wiki:content)
npx tsc --noEmit                                       # types clean
```

## Review
- Run a COVERAGE reviewer on the diff (the `architecture-reviewer` or a fresh subagent): prompt it for COVERAGE (report every rename gap, every off-map or leftover WoW noun in a name OR description, every byte-drift between the two English copies, with confidence + severity), NOT filtering — filtering is a later pass.
- Adversarial spot-check the two-copy invariant: diff the renamed `classes.ts` `.name` set against the `abilities.ts` catalog set id-by-id and confirm they match exactly.

## Acceptance criteria
- [ ] Every V1 ability on the NAME-MAP `rename` rows renamed in BOTH `classes.ts` and `abilities.ts`, byte-identical; every `generic-keep?` row honored per the operator's locked decision.
- [ ] All V1 `tests/ip_scrub.test.ts` scanner entries GREEN (no verbatim WoW ability name in any player-visible field).
- [ ] Ability `.description` fields scrubbed of WoW proper nouns (polymorph critter, warlock demon copy, druid form phrasing) per the map.
- [ ] Druid form vocabulary self-consistent: `tigers_fury` name + every "... Form only" description phrase aligned with the mapped form names.
- [ ] `tests/parity` green with EVERY existing golden byte-identical (no behavior/id change).
- [ ] `tests/i18n_resolved_equivalence` green (regenerated + `i18n:hash -- --write`); `tests/guide.test` fresh (`wiki:content`); `npx tsc --noEmit` clean.
- [ ] Every ability id frozen; no locale overlay touched; regenerated artifacts committed with explicit paths.

## QA handoff
Feed into `00-QA-TEMPLATE.md` for the paired QA session:
- Spot-check that an ability tooltip renders the NEW mapped name in the running client (a warrior, a mage, a paladin ability) and that the same name shows on the action bar, spellbook, and the /wiki guide.
- Confirm the two English copies are byte-identical for a sampled set of renamed ids (`classes.ts` `.name` vs `abilities.ts` catalog), and that the resolved-equivalence SHA gate passed only after `i18n:hash -- --write`.
- Confirm NO locale overlay (`src/ui/i18n.locales/<lang>.ts`) was touched, and log for Z1 that the 20 overlays still render the OLD name (the reword-staleness trap; release-tier re-fill is the maintainer's Z1 handoff).
- Confirm every ability id is unchanged (diff the id set pre/post) and `tests/parity` goldens are byte-identical.
- Confirm no residual WoW proper noun survives in any ability `.description` (polymorph critter, warlock demon copy, druid "... Form only" phrasing).
