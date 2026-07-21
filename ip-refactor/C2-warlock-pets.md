# SESSION C2 — Warlock demon-pet re-theme + pet-id sweep

> Model: Fable 5 / Opus 4.8, xhigh effort. Harness: Claude Code. Branch: feature/ip-pivot (Creatures track worktree, runs AFTER C1). Mode: ULTRACODE.
> READ FIRST: `00-SHARED-CONVENTIONS.md` (the standard loop, the two English source layers, the regen sequence, the contracts/gates, the prime directive) AND the LOCKED `NAME-MAP.md` (the C2 Warlock demon-pet section is the ONLY source of the new strings). Do not re-derive them; apply the map verbatim, never invent a name.
> ULTRACODE: run this slice as an adversarial-verify workflow (add the `ultracode` keyword). Every id-freeze / behavior-unchanged / no-off-map-name claim is independently refuted by a skeptic agent, and the two-golden token-only delta is inspector-confirmed.

## What we are doing
We are stripping the verbatim Blizzard demon-pet lineup out of the warlock. The exact WoW 7-slot roster (Imp, Voidwalker, Succubus, Felhunter, Felguard, Infernal, Doomguard) lives in `src/sim/content/warlock_pets.ts` as `id` + `name` records that merge into `MOBS` (family `demon`). This slice is the SECOND half of the Creatures track (after C1's `murloc`/`kobold` family-id sweep) and is the ONLY OTHER place in the whole job where a code `id` changes: the demon-pet ids are Blizzard-coined tokens, so per the operator-locked coined-id decision we rename them atomically across sim + render, not just the display. No mechanic, save format, wire message, or RL slot moves; a summoned demon still summons, tanks, nukes, and dismisses exactly as before.

## Goal
Re-theme all 7 warlock demon pets to the LOCKED NAME-MAP values (display `.name` AND the coined code `id`), applied atomically across the content def, the `summonDemon` ability mobId literals, the summon-ability description prose, and the render model map, then regenerate. Scrub the Warcraft-specific `Fel` prefix from every player-visible warlock string in scope.

## Precondition RESULT (verified this session, ULTRACODE) — the id rename is SAFE
The SPEC required proving whether a warlock's active demon type is persisted by id in `CharacterState` BEFORE renaming the id. Confirmed this session:
- `CharacterState.pet?: PetState | null` (`src/sim/sim.ts:760`) and `PetState.templateId: string` (`sim.ts:774`) DO carry a pet type by id, and `serializePet` writes `templateId: pet.templateId` (`src/sim/pet/pet_commands.ts:120`).
- BUT the save boundary drops demons: `serializeCharacter` sets `pet: isDemonPetState(petSnapshot) ? null : petSnapshot` (`sim.ts:1426`), and `isDemonPetState` is `MOBS[state.templateId]?.family === 'demon'` (`pet_commands.ts:139`). The in-code comment (`pet_commands.ts:127-138`) states classic warlocks re-summon their demon on login (paying cost + the 180s cooldown) rather than getting it back for free, so a demon snapshot is nulled at persistence.
- CONCLUSION: warlock demon pets are TRANSIENT, never saved to `CharacterState`, never crossing the persistence boundary by id. The coined-id rename is therefore SAFE (rename display AND id). Hunter pets (family `beast`/`spider`) DO persist, but they are NOT in this slice.
- Line numbers here are audit-captured this session and may drift: re-confirm every id / `.name` line / mobId literal / MOB_KEYS key / golden token via ONE Explore agent before editing (never read `classes.ts`, `sim.ts`, or `manifest.ts` whole).

## Scope (verified)
Apply the LOCKED NAME-MAP C2 table. Edit ONLY these; freeze every ability / talent / item id and every non-demon id.

1. **`src/sim/content/warlock_pets.ts`** (the SINGLE English source for the pet display; these are mob records, so the `en` slice re-derives from `.name` via `world_entity_i18n.ts` — do NOT also hand-edit a catalog). Rename BOTH `id` and `name` on all 7 defs:
   - `imp` (id 10, name 11), `voidwalker` (30/31), `succubus` (51/52), `felhunter` (71/72), `felguard` (92/93), `infernal` (112/113), `doomguard` (132/133).
2. **`src/sim/content/classes.ts`** summon-ability `mobId` string literals feeding `summonDemon` (these MUST change in lockstep with the def ids or the summon breaks): `mobId: 'imp'` (2704), `'voidwalker'` (2719), `'succubus'` (2734), `'felhunter'` (2749), `'felguard'` (2764), `'infernal'` (2779), `'doomguard'` (~2793). Do NOT touch the class ability-id list (`'summon_voidwalker'` etc. at 269-279) or the `summon_*` ability ids: those are FROZEN ability ids.
3. **`src/sim/content/classes.ts`** summon-ability DESCRIPTIONS (player-visible, DUPLICATED English: edit BOTH `ABILITIES[summon_*].description` here AND the matching `entities.abilities.<id>.description` in `src/ui/i18n.catalog/abilities.ts`, byte-identical). The `summon_*` description prose names each demon noun (e.g. `summon_voidwalker` desc 2721-2722: "Summons a Voidwalker ... The Voidwalker is a sturdy demon that ..."). Rewrite ONLY the demon-noun occurrences to the new display; scrub `Fel` from the Felhunter/Felguard prose.
4. **`src/sim/types.ts`** dev-comment (`1041-1042`, "warlock: summon a demon pet (imp/voidwalker)") is a `console`-tier comment: English-only, out of i18n scope, but scrub the WoW noun for hygiene.
5. **`src/render/characters/manifest.ts`** `MOB_KEYS` map: the KEY is the pet id, so rename each key that equals a renamed pet id and KEEP the generic model VALUE untouched: `imp: 'mob_demon'` (835), `voidwalker: 'mob_demon'` (836), `succubus: 'mob_demon'` (837), plus the `warlock_imp`/`warlock_voidwalker` alias keys (838-839) IF the Explore agent confirms they alias the same pet ids. The GLB targets (`mob_demon`/`mob_demonalt`/`mob_demon_flying` to `demonalt.glb`/`demon.glb`, ~596-612) stay generic and UNCHANGED. Scrub the WoW nouns from the manifest comment (594-595). This is a `src/render` edit: that is why C2 is ULTRACODE and pulls a cross-platform-sync review.
6. **`src/ui/entity_i18n.ts`**: audit this session found NO hardcoded pet-id enumeration here (pet display resolves by id through `world_entity_i18n` from the content `.name`). Confirm via Explore; if truly none, NO edit. Only touch it if the Explore agent surfaces a literal pet-id list.

Then run the regen sequence (`00-SHARED-CONVENTIONS.md`): `npm run i18n:gen`, `npm run i18n:hash -- --write`, `npm run wiki:content`.

## The mapping (apply NAME-MAP verbatim)
LOCKED `NAME-MAP.md` C2 section. The `old` column is the `ip_scrub` scanner key; the coined id is the lowercase-underscore slug of the new display (confirm the exact coined-id token against the LOCKED map before applying, and if the map gives only the display, coin the slug and record it in `02-WORKING-MEMORY.md`).

| old display (scanner key) | new display | old id (coined) | new id (coined) |
|---|---|---|---|
| Imp | Cinderling | `imp` | `cinderling` |
| Voidwalker | Voidbound | `voidwalker` | `voidbound` |
| Succubus | Temptress | `succubus` | `temptress` |
| Felhunter | Spellhound | `felhunter` | `spellhound` |
| Felguard | Dreadguard | `felguard` | `dreadguard` |
| Infernal | Cinder Colossus | `infernal` | `cinder_colossus` |
| Doomguard | Ruinlord | `doomguard` | `ruinlord` |

Every occurrence of an `old id` (def `id`, `mobId` literal, `MOB_KEYS` key, golden token) flips to the matching `new id` in the SAME commit; every `old display` in a `.name` or a summon description flips to the `new display`. Nothing off-map: if a demon noun appears in a string this slice does not list, STOP and append a request row to `02-WORKING-MEMORY.md`.

## Slice-specific hazards
- **Lockstep or the summon breaks.** The content def `id` and the `classes.ts` `mobId: '<id>'` literal are matched by string. If only one side changes, `summonDemon` (`effect_dispatch.ts:687` calls `ctx.summonPet(p, eff.mobId)`, then `summonPet`/`createDemonPet` looks up `MOBS[templateId]`) resolves nothing and the summon silently no-ops. Change BOTH in the same edit; `tsc` will NOT catch a stale string id, so a summon parity scenario is the real guard.
- **Two parity goldens shift by the token ONLY.** `tests/parity/golden/pet_ai.json` serializes `"imp"` (x2) and `"voidwalker"` (x2); `tests/parity/golden/warlock_pet.json` serializes `"voidwalker"` (x2). These are the ONLY goldens allowed to change in C2, and ONLY by the exact renamed tokens (`imp` to `cinderling`, `voidwalker` to `voidbound`) plus the paired display `name` token (`PetState.name` is serialized). Regenerate the two goldens and INSPECT the diff: it must be nothing but those token swaps. Any other line moving means you changed behavior or an id, STOP.
- **The `Fel` prefix is Warcraft-specific.** The map already de-`Fel`s the display (Felhunter to Spellhound, Felguard to Dreadguard), but sweep every player-visible warlock string in scope for a residual `Fel`/`fel` noun (descriptions, comments). Audit this session found no stray `fel*` strings in `warlock_pets.ts`/`classes.ts` beyond the two pet names; confirm via Explore, and leave item/set `Fel` strings to W1 (out of scope here, the scanner still covers them).
- **Description-vs-name ownership split with V1.** The summon-ability NAME ("Summon Voidwalker") is renamed by V1 (Vocab track, ability names). C2 owns ONLY the demon-NOUN scrub inside the `summon_*` DESCRIPTION. Both tracks read the same LOCKED map, so the noun agrees ("Summon Voidbound" name from V1, "Summons a Voidbound ..." body from C2). If a description also names a pet ABILITY (e.g. Firebolt, Shadow Bite), that ability name is V1's: use the map's new value if V1 applied it, else leave the ability token for V1 and surface it, do not coin one here.
- **Keep the generic model.** The demon GLBs (`demonalt.glb`/`demon.glb` behind `mob_demon`/`mob_demonalt`/`mob_demon_flying`) are generic external CC0/KayKit/Quaternius assets, not ripped. Only the `MOB_KEYS` KEY (the id) changes; never repoint or rename a model VALUE.
- **Duplicated-English trap for the descriptions.** The `summon_*` descriptions are DUPLICATED (sim record + `i18n.catalog/abilities.ts`). Edit BOTH copies byte-identical or `i18n_resolved_equivalence` reds. The pet `.name` is NOT duplicated (mob, single source), so do NOT add a catalog entry for it.

## Gate / Parity (do BEFORE editing)
1. `git status` clean; `npm ci` if the worktree lacks `node_modules`; read this brief + `00-SHARED-CONVENTIONS.md` + the LOCKED `NAME-MAP.md`; check the `02-WORKING-MEMORY.md` status board (C1 must be `done-on-track` first) and the scanner worklist; mark C2 `in-progress`.
2. Run `npx vitest run tests/parity` GREEN as the byte-identical baseline (full-state trace + rng draw-order log). Snapshot the current `pet_ai.json` + `warlock_pet.json` so you can prove the post-rename delta is token-only.
3. Note C2's current `tests/ip_scrub.test.ts` failures (your worklist): the denylist entries `Imp`, `Voidwalker`, `Succubus`, `Felhunter`, `Felguard`, `Infernal`, `Doomguard`. These are your done-condition.
4. Load exact CURRENT lines / ids / mobId literals / MOB_KEYS keys / golden tokens via ONE Explore agent (never whole-file reads) and confirm them against the NAME-MAP before touching a line.

## Invariants in play
- **RENAME DISPLAY, FREEZE IDS (prime directive), with the ONE C2 exception:** the 7 demon-pet ids ARE renamed (coined-id sweep), because the precondition proved they are transient (not persisted, not on the wire, not an RL slot). Every OTHER id stays frozen: the `summon_*` ability ids, the class ability-id list, all talent/item ids.
- **Behavior unchanged:** a display + coined-id rename moves no sim state. Every parity golden stays byte-identical EXCEPT `pet_ai.json` and `warlock_pet.json`, which change by the renamed token ONLY (inspector-verified). rng draw-order log byte-identical.
- **Determinism / purity:** the edits stay `src/sim`-pure (no DOM/Three/`Math.random`/`Date.now`); the `manifest.ts` edit is `src/render` and is display-only. `tests/architecture.test.ts` stays green.
- **Two English source layers:** pet `.name` is the SINGLE content source (mob family); summon descriptions are DUPLICATED (edit sim record + catalog, byte-identical).
- **Atomic lockstep:** def id, `mobId` literal, `MOB_KEYS` key, and golden token for a given demon all flip together in one commit; a half-renamed pet is never committed.

## Out of scope
- Creature families and the `murloc`/`kobold` `MobFamily` id sweep, plus Bristleback/Drakonid/Mogger and Slimy Murloc Scale: **C1** (runs before C2 on the same track).
- Warlock ability NAMES ("Summon Voidwalker" to "Summon Voidbound", and pet-ability names like Firebolt/Shadow Bite): **V1**. C2 owns ONLY the summon-description demon-NOUN scrub.
- Item/set/augment `Fel` strings: **W1**. Mob mechanic/aura names: **W2**. De-brand comments/docs/realm copy: **T1**.
- Hunter pets and any persisted (`beast`/`spider`) pet: NOT touched (they persist by id; renaming those WOULD be a save migration and is not done).
- The demon GLB geometry, class ids, class `.name`, the nine-class roster, the product brand name: all out of scope this pass.
- Any mechanic tweak, rebalance, or "improvement" to a demon: this is a rename only.

## Verify
```
npx vitest run tests/parity                            # goldens byte-identical EXCEPT pet_ai.json + warlock_pet.json (token-only delta, inspect)
npx vitest run tests/ip_scrub.test.ts                  # Imp/Voidwalker/Succubus/Felhunter/Felguard/Infernal/Doomguard entries now GREEN
npx vitest run tests/i18n_resolved_equivalence.test.ts # SHA gate (must run npm run i18n:hash -- --write first)
npx vitest run tests/guide.test.ts                     # guide content fresh (must run npm run wiki:content first)
npx vitest run tests/architecture.test.ts              # src/sim purity (coined-id sweep touches sim + render)
npx vitest run tests/threat.test.ts                    # anchor: Summon Imp/Voidwalker demon behavior (Firebolt / Growl)
npx tsc --noEmit                                        # the id renames must stay typed end to end
# pre-merge (mirror CI): npm test && npx tsc --noEmit && npm run build
```

## Review
- Run the **architecture-reviewer** agent on the diff prompted for COVERAGE (report every id-freeze / lockstep / requirement gap with confidence + severity, do NOT filter).
- Run the **cross-platform-sync** reviewer: the coined-id rename spans `src/sim` (content + summon literals) and `src/render` (`manifest.ts` `MOB_KEYS`); confirm the id renamed in EVERY host in lockstep and no host still keys off an old token.
- Do NOT run **migration-safety**: the precondition proved demons are transient (nulled at `serializeCharacter` sim.ts:1426), so there is no persisted-pet migration. Record that decision in the QA handoff.
- ULTRACODE adversarial-verify pass: a skeptic refutes each of (a) the 7 ids flipped atomically across all sites, (b) the two goldens changed by token ONLY, (c) no off-map name, (d) `Fel` fully scrubbed from in-scope strings, (e) no persisted-pet path exists.

## Acceptance criteria
- [ ] All 7 demon pets re-themed to the LOCKED NAME-MAP values: display `.name` AND coined code `id` (transient pets, so id renamed, not display-only).
- [ ] `summonDemon` mobId literals in `classes.ts` and the `warlock_pets.ts` def ids renamed in LOCKSTEP; a summon parity scenario proves a demon still summons.
- [ ] Summon-ability descriptions scrubbed of demon nouns, edited byte-identical in BOTH the sim record and `i18n.catalog/abilities.ts`.
- [ ] `MOB_KEYS` keys renamed to the new ids with the generic GLB model VALUES unchanged; manifest + types comments de-WoW'd.
- [ ] `Fel` prefix removed from every in-scope warlock player-visible string.
- [ ] `tests/parity` green; every golden byte-identical EXCEPT `pet_ai.json` + `warlock_pet.json`, which changed by the exact renamed tokens ONLY (inspector-confirmed).
- [ ] `tests/ip_scrub.test.ts` C2 denylist entries (Imp, Voidwalker, Succubus, Felhunter, Felguard, Infernal, Doomguard) now GREEN; no new flagged name added.
- [ ] `tests/i18n_resolved_equivalence` re-baselined (`i18n:hash -- --write`), `tests/guide.test` fresh (`wiki:content`), `tests/architecture.test` green, `npx tsc --noEmit` clean.
- [ ] `02-WORKING-MEMORY.md`: C2 flipped to `done-on-track`, the 7 scanner entries ticked, the coined new-id tokens recorded, and the generated-artifact touch logged.

## QA handoff
Feed into `00-QA-TEMPLATE.md` for the paired QA session:
- Confirm the persistence precondition INDEPENDENTLY: a warlock demon is dropped to null at `serializeCharacter` (sim.ts:1426 via `isDemonPetState`), so the id rename touches no saved state, wire message, or RL slot. Confirm hunter pets (beast/spider) were NOT touched and still persist by id.
- Confirm all 7 ids flipped atomically: def id, `classes.ts` `mobId` literal, `MOB_KEYS` key, and golden token for each demon match the new coined id, with NO orphaned old token anywhere (`grep` each old id across `src/` + `tests/` returns nothing player-facing).
- Confirm a live summon of each demon resolves (`summonDemon` finds `MOBS[newId]`, the pet spawns, and its display shows the new name) and that summoning a new demon still dismisses the current one.
- Confirm the `pet_ai.json` + `warlock_pet.json` golden delta is token-only (imp to cinderling, voidwalker to voidbound, plus the paired display name) and every other golden is byte-identical.
- Confirm the summon descriptions read cleanly with the new nouns, `Fel` is gone, and the sim-record vs catalog description copies are byte-identical (equivalence SHA green).
- Confirm the demon GLB models are unchanged (generic assets) and only `MOB_KEYS` keys moved.
- Confirm `tests/ip_scrub` C2 entries are green with zero residual and the scanner was never loosened or `.skip`ped.
