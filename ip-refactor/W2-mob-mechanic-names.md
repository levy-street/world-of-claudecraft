# SESSION W2 — Mob mechanic / aura name rename (+ the S3 matcher)

> Model: Fable 5 / Opus 4.8, xhigh effort. Harness: Claude Code. Branch: `feature/ip-pivot` (World track worktree, runs AFTER W1). Mode: plain (verify).
> READ FIRST: `00-SHARED-CONVENTIONS.md` (the two English source layers, the regen sequence, the contracts/gates, the standard session loop, the validation commands) AND the LOCKED `NAME-MAP.md` (apply it verbatim, never invent a name off-map). Do not re-derive them.

## What we are doing
We are stripping every player-visible Blizzard / WoW IP name out of the game, one self-contained rename slice per session, applying the locked `NAME-MAP.md` and proving the sim did not move (`RENAME DISPLAY, FREEZE IDS`). This slice (W2, last in the World track after W1) renames the 4 verbatim WoW mob-mechanic DISPLAY names carried inline on mob mechanic objects, and updates their `AURA_NAME_KEY` matcher in `src/ui/sim_i18n.ts` in the SAME slice. These mechanic names have NO stable content id: the matcher keys off the English STRING, so the inline `name` and its matcher entry MUST change together or `localizeSimText` ships raw English (the S3 guard, `tests/localization_fixes.test.ts`). No mechanic, value, or affix behavior changes.

## Goal
Rename the 4 verbatim WoW mob-mechanic display names and update their `sim_i18n` matcher entries in the same slice; change no mechanic.

## Scope (verified)
Edit the inline `name:` string on each mob mechanic object AND its matching `AURA_NAME_KEY` entry in `src/ui/sim_i18n.ts`, per the NAME-MAP. Confirm the CURRENT line numbers / surrounding mechanic keys with ONE Explore agent this session (the numbers below are audit-captured on v0.18.0 and may drift; never read `dungeons.ts`/`zone2.ts`/`zone3.ts`/`sim_i18n.ts` whole).
- `src/sim/content/dungeons.ts` — Bastion Revenant on-hit `mortalStrike` mechanic, `name:'Mortal Strike'` -> `Maiming Strike` (matches the V1 warrior ability rename for the shared string).
- `src/sim/content/zone2.ts` — Grubjaw purge mechanic, `name:'Devour Magic'` -> `Rend Enchantment`.
- `src/sim/content/zone3.ts` — Corrupted Priest `petSpell` mechanic, `name:'Mind Blast'` -> `Psychic Lash`.
- `src/sim/content/dungeons.ts` — Korgath stomp mechanic, `name:'War Stomp'` -> `Ground Slam` (peers already use Ground Slam / Skull Smash).
- `src/ui/sim_i18n.ts` — the 4 matching `AURA_NAME_KEY` entries: swap each `old` English string to the `new` string so `localizeSimText` still resolves the mechanic name to its key.

These are `src/sim/` content records: single English source is the inline `.name` (no catalog duplicate to keep byte-identical here). Then regen if the resolved table changes (`i18n:gen` + `i18n:hash -- --write` + `wiki:content`).

## The mapping (apply NAME-MAP verbatim)
| location | old | new | kind |
|---|---|---|---|
| `dungeons.ts` Bastion Revenant on-hit | Mortal Strike | Maiming Strike | aura |
| `zone2.ts` Grubjaw purge | Devour Magic | Rend Enchantment | aura |
| `zone3.ts` Corrupted Priest petSpell | Mind Blast | Psychic Lash | aura |
| `dungeons.ts` Korgath stomp | War Stomp | Ground Slam | aura |

If a mechanic here needs a string the map does not carry, STOP and surface it (the map is the single source of truth). Never coin one in-slice.

## Slice-specific hazards
- **S3 CO-LOCATION (the whole point of this slice):** the mechanic `name` is not id-resolved; `AURA_NAME_KEY` reverse-maps the English string to a key. Editing the inline `name` WITHOUT its `sim_i18n.ts` entry (or vice versa) ships raw English to non-English locales and reds `tests/localization_fixes.test.ts`. Both edits land in THIS slice, THIS commit.
- **SHARED-STRING CONSISTENCY (Mortal Strike, Mind Blast):** `Mortal Strike` is also a warrior ABILITY (renamed to `Maiming Strike` in V1); `Mind Blast` mirrors a priest ability surface. The NAME-MAP already pairs them, so use the map's `new` value verbatim (`Maiming Strike`, `Psychic Lash`) and the shared string resolves consistently across V1 and W2. Do not pick a different synonym for the mob copy.
- **PARITY GOLDENS (`mob_swing_affixes`):** these mechanic names are display-only; the affix / mechanic BEHAVIOR (mortalStrike debuff, purge, petSpell, stomp) is untouched, so every existing golden stays BYTE-IDENTICAL. A shifted golden means you changed a value or a branch: STOP.
- **DISPLAY-ONLY, do NOT invent mechanics:** rename the `name` string only. Do not touch the mechanic's numeric fields (cooldown, damage, chance, radius), its trigger, or its affix wiring.

## Gate / Parity (do BEFORE editing)
A display rename changes no sim state, so the baseline is byte-identical goldens. Run BEFORE touching a line:
```
npx vitest run tests/parity                     # green byte-identical baseline (behavior unchanged)
npx vitest run tests/ip_scrub.test.ts           # note this slice's 4 mob-mechanic failures = your worklist
```
Note the current `ip_scrub` failures for Mortal Strike / Devour Magic / Mind Blast / War Stomp in a mob-mechanic field; those are the entries you turn green.

## Invariants in play
- **RENAME DISPLAY, FREEZE IDS (PRIME DIRECTIVE):** change the inline `name` string only; no content id, mechanic key, or numeric field moves. This slice has NO coined-id exception (that is C1/C2 only).
- **S3 co-location:** the inline `name` and its `AURA_NAME_KEY` entry in `src/ui/sim_i18n.ts` change together, same slice, same commit; then run the S3 guard.
- **Parity byte-identical:** every existing `tests/parity` golden (including `mob_swing_affixes`) stays unchanged; the affix behavior is untouched.
- **Two English source layers:** mob mechanic names have a SINGLE English source (the inline sim `.name`); there is no catalog copy to mirror. Do not touch any `i18n.catalog/*`.
- **NEVER touch the locale overlays:** do not edit any `src/ui/i18n.locales/<lang>.ts`; the release re-fill is handed off in Z1.
- **src/sim purity:** the content edits stay DOM/Three/rng-free (`tests/architecture.test.ts`).

## Out of scope
- Any mechanic BEHAVIOR or value (cooldown, damage, chance, radius, trigger, affix wiring) — display string only.
- Player ABILITY names — those are V1 (`content/classes.ts` + `i18n.catalog/abilities.ts`). W2 touches only the mob-side inline mechanic `name` and its matcher.
- Talent names (V2), item names (W1), creature families / demon pets (C1/C2).
- The locale overlays and any "improvement" or reordering of the touched content records.

## Verify
```
npx vitest run tests/parity                            # goldens byte-identical (mob_swing_affixes unchanged)
npx vitest run tests/localization_fixes.test.ts        # S3: inline name + AURA_NAME_KEY co-updated
npx vitest run tests/ip_scrub.test.ts                  # the 4 mob-mechanic entries now GREEN
npx vitest run tests/i18n_resolved_equivalence.test.ts # SHA gate (needs i18n:hash -- --write first)
npx vitest run tests/guide.test.ts                     # guide fresh (needs wiki:content)
npx tsc --noEmit
# regen BEFORE the two SHA/guide gates:
#   npm run i18n:gen && npm run i18n:hash -- --write && npm run wiki:content
```

## Review
- Run the **architecture-reviewer** agent on the diff; prompt it for COVERAGE (report every correctness / requirement gap with confidence + severity), NOT filtering.
- Confirm all 4 pairs (inline `name` + `AURA_NAME_KEY` entry) moved together, no id/mechanic field changed, and the shared-string values match V1's applied ability names verbatim.

## Acceptance criteria
- [ ] 4 mob-mechanic `name` strings renamed per the NAME-MAP (Maiming Strike, Rend Enchantment, Psychic Lash, Ground Slam).
- [ ] The 4 matching `AURA_NAME_KEY` entries in `src/ui/sim_i18n.ts` updated in the SAME commit.
- [ ] `tests/localization_fixes.test.ts` (S3) green; matcher resolves each new string.
- [ ] `tests/parity` green with EVERY existing golden byte-identical (`mob_swing_affixes` unchanged).
- [ ] The 4 mob-mechanic entries in `tests/ip_scrub.test.ts` are GREEN (no verbatim WoW mechanic name in a player-visible field).
- [ ] `npx tsc --noEmit` clean; regen artifacts committed (`i18n:gen` + `i18n:hash -- --write` + `wiki:content`), `i18n_resolved_equivalence` + `guide.test` green.
- [ ] No content id, mechanic field, or locale overlay touched.

## QA handoff
Feed into `00-QA-TEMPLATE.md` for the paired QA session:
- Drive each of the 4 mob mechanics live (Bastion Revenant on-hit, Grubjaw purge, Corrupted Priest petSpell, Korgath stomp) and confirm the combat text / tooltip renders the NEW name.
- Confirm it renders the new name through a NON-English locale path (the `AURA_NAME_KEY` matcher resolves, so no raw English leaks); this is the S3 co-location check end to end.
- Confirm the shared strings (Maiming Strike, Psychic Lash) render consistently between the mob mechanic and the V1 player ability that mirrors them.
- Confirm no mechanic behavior changed: the affix / debuff / purge / petSpell / stomp still fire with identical values (spot-check against a pre-rename run and the byte-identical `mob_swing_affixes` golden).
- Confirm no residual verbatim mechanic name anywhere player-visible (`ip_scrub` green) and no locale overlay was edited.
