# SESSION G1 — Generate + operator-lock the full NAME-MAP (the contract)
> Model: Fable 5 / Opus 4.8, xhigh effort. Harness: Claude Code. Branch: `feature/ip-pivot`. Mode: ULTRACODE.
> READ FIRST: `00-SHARED-CONVENTIONS.md` and `README.md` (the goal, the load-bearing display-only finding, the IP surface map, the session index, the scope decisions) and the current `NAME-MAP.md` (the contract skeleton, the house style, the hard IP constraints, the Coverage checklist). Do not re-derive them.
> ULTRACODE: run this as an adversarial-verify workflow (add the `ultracode` keyword). Every proposed name survives ONLY if a skeptic agent cannot refute it on the four IP grounds below.

## What we are doing
G1 is the second spine session, run AFTER G0 lands the gate and BEFORE any rename track forks. It does the one thing every later slice depends on: it fills `NAME-MAP.md` (the single operator-approved old -> new contract, the IP-job analog of the world-api `CommandName` table) with an original, IP-clean proposed name for EVERY row on the Coverage checklist, then STOPS for operator sign-off. No V/C/W/T track may start until the operator reviews the proposals and flips `NAME-MAP.md` STATUS from PROPOSED to LOCKED. G1 writes NO source and applies NO name; it authors the map and the operator-decision list, nothing else.

## Goal
Fill every Coverage-checklist row in `NAME-MAP.md` with an original, adversarially IP-cleared proposed name (talent-ability pairing resolved, generic verbs flagged), surface the operator-decision list, and leave `NAME-MAP.md` at STATUS PROPOSED awaiting LOCK.

## Scope (verified)
File edited: `NAME-MAP.md` ONLY (a job doc, not repo source). G1 produces ZERO diff under `src/`, `server/`, `tests/`. Enumerate the full old-name inventory by reading these audit sources (fan out ONE Explore agent PER DOMAIN, section-scope, never read a monolith whole). The counts are audit-captured on v0.18.0 and may drift; the Explore pass reconfirms exact current ids, `.name` lines, and catalog mirrors before you write a row.

| Domain (NAME-MAP section) | Enumerate from | To fill |
|---|---|---|
| Abilities (V1) | `src/sim/content/classes.ts` `ABILITIES` (id + `.name`), mirror `src/ui/i18n.catalog/abilities.ts` | all ~150 of 152 across the 9 classes |
| Talents (V2) | `src/sim/content/talents_classic.ts` (27 spec/tree names + node/choice/mastery `.name`), `src/ui/talent_i18n.ts`; `talents_warrior.ts` is the DONE style exemplar (already de-WoW'd) | all 27 tree names + ~330 nodes |
| Creatures (C1) | `src/sim/types.ts` `MobFamily`, `src/sim/sim.ts`, `render/characters/manifest.ts`, `content/zone*.ts`, `dungeons.ts`, `temple.ts` | murloc family (7 mobs) + kobold flavor (5 mobs) + Bristleback + Sanctum Drakonid + Mogger + "Slimy Murloc Scale" + murloc/candle prose |
| Warlock pets (C2) | `src/sim/content/warlock_pets.ts`, the `summonDemon` effect, `classes.ts` summon descriptions, `src/ui/entity_i18n.ts` | all 7 pets (display + provisional coined id) |
| Items (W1) | `src/sim/content/items.ts`, `item_sets.ts`, `augments.ts`, mirror `src/ui/i18n.catalog/items.ts` | ~16 flagged items/sets/augments |
| Mob-mechanic names (W2) | `content/dungeons.ts`, `zone2.ts`, `zone3.ts` inline `name`, matched in `src/ui/sim_i18n.ts` `AURA_NAME_KEY` | the 4 verbatim (Mortal Strike, Devour Magic, Mind Blast, War Stomp) |

Two structural verifications G1 MUST bake into the map (they set the blast radius later slices consume):
- **Warlock pet-id persistence check (C2 rows).** Grep `server/db.ts` `CharacterState` (JSONB) and the `summonDemon` effect for any place a warlock pet id is PERSISTED or wire-transmitted (active-pet id, saved summon slot). If a pet id is persisted, that row is NOT a coined-id sweep: mark it **display-only (freeze id)** in the map so C2 renames only the display string. If no pet id is persisted anywhere, the C2 rows stay `coined-id` per the locked scope decision. Record the grep result in the map so C2 does not re-litigate it.
- **Mob-family id blast radius (C1 rows).** For each coined `MobFamily` id (`murloc`, `kobold`), enumerate EVERY code site that keys off it so C1 has the complete atomic-swap list: the `src/sim/types.ts` `MobFamily` union member, `src/sim/sim.ts` `FLEEING_FAMILIES` / `MOB_PULL_LIMITS` / `canSwim` (and any other family-keyed set/table), `render/characters/manifest.ts` family entries, and every content record `family:` field. Put the file list in the map's C1 section as the sweep manifest.

## The mapping (you AUTHOR it; later slices apply it VERBATIM)
Apply the `NAME-MAP.md` house style to every row (do not invent a new style):
- **Anchor to the game's OWN grim grounded dark-fantasy vocabulary** already in the tree: zones (Eastbrook Vale, Mirefen Marsh, Thornpeak Heights), factions (Gravecallers, Wyrmcult, Pale Choir, Drowned Moon), bosses (Korzul the Gravewyrm, Voskar the Emberwing), and the already-shipped warrior talents (Savagery, Blademaster, Bulwark, Stormcaller).
- **Original + evocative + functional + concise.** 1 to 3 words, aim <= 22 chars (hard cap the longest existing UI budget), mechanic-legible (a fire nuke still reads as fire, a taunt still reads as a taunt).
- **Distinctive WoW names ALWAYS rename** (Heroic Strike, Mortal Strike, Sinister Strike, Judgement, Lay on Hands, Sunder Armor, Frostbolt, Pyroblast, Polymorph, Eviscerate, Slice and Dice, and every proposed-sample row already in the map).
- **Pure-generic combat verbs are FLAGGED `generic-keep?`, not decided by you.** Flag EACH of these as `generic-keep?` for the operator to keep or rename PER ROW, never silently keep or rename: Charge, Cleave, Execute, Taunt, Sprint, Stealth, Slam, Ambush, Blind, Sap, Rend, Gouge, Vanish (plus Kick, Parry if present). Still propose a `new` candidate in the row so a keep-or-rename call is one glance.
- **Talent-ability pairing (V2 <- V1).** A talent that improves or grants an ability MUST use that ability's NEW proposed name (e.g. `Improved <newFireball>`). List the pair together and mark `pairing`; V2 reads the map, so the paired name is already encoded and V1/V2 can still run in parallel.
- **Mob-mechanic names match the ability they mirror (W2).** A mob on-hit `Mortal Strike` takes the SAME new name as the `mortal_strike` ability row (the map keeps them consistent).
- **The Mogger (Hogger) parody is an operator call.** Do not decide it: propose both paths in the row (keep as a deliberate parody, or rename to an original) and flag `rename?` for the operator.

Fill each domain's table with the existing column shape (`id` frozen | `old` (scanner key) | `new` (PROPOSED) | `kind` | `flag`), flag values in {`rename`, `generic-keep?`, `coined-id`, `pairing`, `rename?`}. The `old` column is the `tests/ip_scrub.test.ts` scanner key: it MUST match the exact current display string so G0's denylist and the map line up one-to-one.

## Slice-specific hazards
- **Do NOT flip STATUS to LOCKED.** G1 leaves `NAME-MAP.md` at PROPOSED. Only the operator locks it. A LOCKED map you did not get signed off unblocks every track prematurely against unreviewed names. This is the single most important guardrail of the session.
- **Do NOT apply a single name.** G1 authors the contract; it edits no `classes.ts`, no catalog, no content record. Any source diff out of G1 is a bug.
- **The `old` column is a scanner key, not free text.** If `old` does not byte-match the live display string, `tests/ip_scrub.test.ts` and the map disagree and a track will "clear" a denylist entry that is still present. Reconfirm every `old` against the Explore pass, not the audit memo.
- **Generic verbs and Mogger are NOT yours to resolve.** Flagging them is the deliverable; deciding them is the operator's. Surfacing them in the operator-decision list is a hard acceptance item.
- **Pet-id and family-id verdicts are load-bearing for C1/C2.** A wrong "safe to rename the id" call turns a C1/C2 coined-id sweep into a save-data / wire migration the job explicitly forbids. If the persistence grep is ambiguous, mark the row display-only (freeze id) and add it to the operator-decision list; do not guess coined-id.
- **Talent title-override coupling.** `talent_i18n.ts` requires a talent name to EQUAL an ability name OR carry an explicit per-locale title override. If a paired talent name cannot equal its ability's new name for some row, note "needs title override" on that row so V2 knows.

## Gate / Parity (do BEFORE editing)
G1 edits no source, so the code gates are not RE-BASELINED here; they are the fixed backdrop the map targets. Before writing a single row, confirm G0 landed the gate and read its baseline:
```
git branch --show-current                          # feature/ip-pivot
npx vitest run tests/parity                         # green baseline (behavior unchanged; nothing renamed yet)
npx vitest run tests/ip_scrub.test.ts               # RED baseline: capture the seeded denylist = your row inventory
```
The `ip_scrub` RED failure list IS the enumeration cross-check: every verbatim name the scanner flags must have exactly one `old`-column row in the map, and every `old` row must correspond to a real live display string. G1's "gate" is that the map is COMPLETE against this denylist and every `new` passed the adversarial screen; there is no re-baseline (`i18n:hash --write`, `wiki:content`) in this session because no English changed.

## The adversarial IP screen (ULTRACODE, every proposed name)
Every `new` name survives only if a skeptic agent CANNOT refute it on any of these four grounds. Fan out skeptic passes across the domains (do not screen 500 names in one head):
- (a) **Residual WoW verbatim** — the name is not any current or classic WoW spell/talent/creature/item name.
- (b) **Other-franchise collision** — screen against RuneScape, Final Fantasy, Guild Wars, Diablo, League of Legends, Dota, EverQuest, ESO. Prefer common-language fantasy compounds no single franchise owns.
- (c) **Collision with the game's EXISTING original names** — do not reuse a zone/faction/boss/existing-ability word (Gravecallers, Wyrmcult, Korzul, Savagery, Blademaster, ...) as a new name.
- (d) **Internal duplicate** — no two rows across the whole map share one new name.
A name that any pass refutes is replaced and re-screened. Record the screen as passed per section so the operator sees the map was adversarially cleared, not hand-waved.

## Invariants in play
- **RENAME DISPLAY, FREEZE IDS (prime directive):** the `id` column is frozen for every row EXCEPT the explicit C1/C2 coined-id sweep (murloc/kobold `MobFamily`, warlock pet ids), and even those only if the persistence/blast-radius checks clear. G1 records the id verdict; it changes no id.
- **The map is THE contract, append-only after LOCK.** Every later slice applies it verbatim and a slice needing a missing string STOPS and appends a request row (never invents one). G1's job is to make that "missing string" case rare by filling every Coverage row now.
- **Behavior unchanged everywhere.** G1 touches no sim/server/wire/save/RL surface; all gates stay exactly as G0 left them.
- **No off-map names, no operator decisions pre-empted.** Generic-verb and Mogger rows stay flagged, not decided.
- **No em/en dashes, no emojis** in any proposed name or map prose (CI copy scan + the `Stop` hook enforce it).

## Out of scope
- **Applying any name** to any source file (V1/V2/C1/C2/W1/W2/T1 do that, each against the LOCKED map).
- **Deciding the `generic-keep?` rows or the Mogger parody** — operator calls; G1 only flags + proposes.
- **Locking the map** — operator only.
- **Class display names / class ids** (locked out of scope; the nine-class roster stays as-is).
- **The brand "World of ClaudeCraft"** and the "Realm" wording decision (T1 / separate business track).
- **Re-baselining i18n/guide artifacts** (`i18n:hash --write`, `wiki:content`) — nothing English changed in G1.

## Verify
```
git status                                          # ONLY NAME-MAP.md changed; zero diff under src/ server/ tests/
git diff --name-only                                # must list NAME-MAP.md and nothing else
npx vitest run tests/ip_scrub.test.ts               # unchanged RED baseline; confirm every flagged name maps 1:1 to an old-column row
npx vitest run tests/parity                         # still green (no behavior touched)
grep -n "STATUS" NAME-MAP.md                         # still PROPOSED (never LOCKED by G1)
```
(No `tsc`/regen here: G1 authors a doc, not code. The `tsc --noEmit` / `i18n:hash` / `wiki:content` gates belong to the slices that actually apply the map.)

## Review
- Run a COVERAGE reviewer on the filled `NAME-MAP.md`: its job is to report every gap (a Coverage-checklist row with no proposal, an `old` string that does not byte-match live source, a `new` that fails the adversarial screen, an unresolved pairing, an unflagged generic verb, a missing operator-decision entry) with confidence + severity, NOT to filter.
- ULTRACODE adversarial-verify pass (`ultracode` keyword): a skeptic independently attempts to refute each `new` on grounds (a) to (d) above, and independently re-checks the two structural verdicts (pet-id persistence, mob-family blast radius). A row is done only when the skeptic cannot break it.

## Acceptance criteria
- [ ] Every Coverage-checklist row in `NAME-MAP.md` is filled: all ~150 abilities (9 classes), all 27 spec/tree names + ~330 talent nodes (pairing resolved), the C1 creature set (murloc + kobold families + prose + Bristleback + Sanctum Drakonid + Mogger + Slimy Murloc Scale), all 7 warlock pets, the ~16 flagged items/sets/augments, and the 4 mob-mechanic names.
- [ ] Every proposed `new` name passed the four-ground adversarial IP screen (no WoW verbatim, no other-franchise collision, no existing-original-name collision, no internal duplicate).
- [ ] Every `old` column byte-matches the live display string and maps 1:1 to a `tests/ip_scrub.test.ts` denylist entry.
- [ ] Talent-ability pairing resolved (each mirroring talent carries its ability's new name, `pairing` flag; title-override needs noted).
- [ ] The two structural verdicts are recorded in the map: warlock pet-id persistence checked (each C2 row marked `coined-id` or `display-only` accordingly), and the murloc/kobold family-id blast-radius file list captured for C1.
- [ ] Every pure-generic combat verb is flagged `generic-keep?` (with a candidate) and the Mogger parody flagged `rename?`; none silently decided.
- [ ] The "operator decisions needed" list is surfaced (every `generic-keep?` row + Mogger + any ambiguous id verdict).
- [ ] `NAME-MAP.md` STATUS is still PROPOSED; no source file changed; no rename started.

## QA handoff
Feed into `00-QA-TEMPLATE.md` for the paired QA session (a review-of-the-contract QA, since no code moved):
- Confirm G1 produced ZERO source diff (only `NAME-MAP.md` changed) and left STATUS PROPOSED.
- Spot-check 10+ proposed names across domains against the four adversarial grounds; confirm the skeptic pass is real, not asserted.
- Confirm the `old` column is complete against the `ip_scrub` RED baseline: no denylist entry lacks a row, no row invents a string not in the tree.
- Confirm the talent-ability pairing is internally consistent (V2 rows reuse V1 `new` names) and no two rows share a `new`.
- Confirm the operator-decision list captures every `generic-keep?` and the Mogger call, and that the warlock pet-id and mob-family verdicts are stated with their grep/blast-radius evidence.
- Confirm the map is ready for the operator to LOCK: complete, IP-clean, and append-only from here (later slices consume it verbatim, the world-api `CommandName`-table spine model).
