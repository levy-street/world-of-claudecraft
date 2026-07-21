# SESSION C1 — Blizzard-original creatures + the coined family-id sweep

> Model: Fable 5 / Opus 4.8, xhigh effort. Harness: Claude Code. Branch: `feature/ip-pivot` (Creatures worktree). Mode: ULTRACODE.
> READ FIRST: `00-SHARED-CONVENTIONS.md` (the two English source layers, the regen sequence, the contracts/gates, the standard session loop, validation commands) and the LOCKED `NAME-MAP.md` (every old -> new string; apply it VERBATIM, never invent a name off-map). Do not re-derive them.
> ULTRACODE: run this slice as an adversarial-verify workflow (add the `ultracode` keyword) — each id-freeze / behavior-unchanged / no-off-map-name claim independently refuted by a skeptic agent.

## What we are doing
We are stripping the player-visible Blizzard / WoW IP out of the game by renaming DISPLAY strings while FREEZING every code id (see `README.md`). This slice (C1, first on the Creatures track) is one of only TWO in the whole job that also changes CODE IDS, and the only place a `tests/parity` golden may legitimately change. It does three things atomically: (a) renames the Blizzard-coined `MobFamily` ids `murloc`/`kobold` to their NAME-MAP values (`mudfin`/`tunnelrat`) across every file that keys off the family string; (b) scrubs the player-visible Blizzard-coined FLAVOR (the word "murloc", the candle-headed-kobold trope); (c) renames the flagged terms Bristleback / Drakonid and (operator call) Mogger. Every OTHER id stays frozen. All creature GLB models stay (murloc = a generic frog, kobold = a generic goblin; no geometry change).

## Goal
Rename the coined `MobFamily` ids `murloc`/`kobold` atomically (types + all sim constants + render manifest keys + every content `family:` field), scrub the murloc/candle flavor prose, and rename Bristleback / Drakonid / (Mogger per decision) — with ZERO mechanic change and every model unchanged.

## Scope (verified)
Confirm every line number / id / call site below with ONE Explore agent this session BEFORE editing — the numbers are audit-captured on v0.18.0 and may have drifted. Never read `sim.ts` or a content file whole; section-scope reads.

The coined-id sweep is ALL-IN-LOCKSTEP: the union member, every literal that keys off the family string, the render manifest key, and every content `family:` field change together, or `tsc` reds and mobs desync from behavior/models.

**A. The `MobFamily` id (`murloc` -> `mudfin`, `kobold` -> `tunnelrat`):**
- `src/sim/types.ts`: the `MobFamily` union members `'murloc'` / `'kobold'` (audit ~L436-438). Rename the string literals in the union.
- `src/sim/sim.ts`: EVERY literal that keys off the family string — `FLEEING_FAMILIES` (~L326), `MOB_PULL_LIMITS` (~L411), the `canSwim` guard `family === 'murloc'` (~L2447). Grep the file for `'murloc'` and `'kobold'` and change every occurrence; miss one and behavior forks or `tsc` reds.
- `src/render/characters/manifest.ts`: the `FAMILY_KEYS` / `MOB_KEYS` map entries `'murloc' -> mob_murloc`, `'kobold' -> mob_kobold`. Rename the family KEY string only; KEEP the GLB target (frog / goblin) to avoid asset churn. The `mob_murloc` still-id may stay as-is; if the guide bakes a still keyed on the family, note `wiki:stills` (see Verify).
- Every content record `family:` field:
  - murloc mobs (`zone1.ts`, `zone2.ts`, `temple.ts`): Mudfin Skulker, Deepfen Snapper, Mirejaw, Sloomtooth, Glimmermere Wader, Moonspawn.
  - kobold mobs (`zone1.ts`, `zone3.ts`): Tunnel Rat Digger, Grix, Deeprock Tunneler, Ironvein Foreman, Ironvein Sapper.

**B. Player-visible prose scrub (edit the sim content `.name` / quest text; if the string is an EMIT literal, co-locate the `src/ui/sim_i18n.ts` matcher in THIS slice and run S3):**
- `zone1.ts` quest `q_murlocs`: "those gurgling fish-men", "where there is one murloc there are five" -> reworded, no "murloc".
- `zone2.ts`: "The Deepfen murlocs..." -> de-murloc'd.
- Foreman Odell greeting: "candle-headed vermin" -> de-candled.
- `zone3.ts` quest `q_kobold_tunnels`: "Strange Wax" / glowing candle-wax text -> de-candled.
- loot "Tallow Candle" flavor -> de-candled per NAME-MAP.

**C. Owned-here item + flagged terms:**
- Item `slimy_murloc_scale` "Slimy Murloc Scale" (`items.ts` ~L1036 + `src/ui/i18n.catalog/items.ts`) -> "Slimy Mudfin Scale". OWNED HERE, not W1. Edit BOTH the sim `ITEMS[id].name` and the catalog `itemNamesEn` entry byte-identical (the two-English-copies rule).
- Bristleback: "Bristleback Hides" quest (`zone1.ts` ~L663), "Bristleback Maul" item (`items.ts` ~L198), `removed_zone1_content` `elder_bristleback`, the `auto_attack.ts` comment. Apply the NAME-MAP `Bristleback` value (Bristlehide, or the per-row value the map records).
- "Sanctum Drakonid" (`dungeons.ts`) -> the NAME-MAP value (Sanctum Wyrmkin).
- Mogger / "Mogger Must Fall": apply the operator decision recorded in the NAME-MAP (keep as deliberate parody, or rename). Do NOT decide it yourself; if the map row is unresolved, STOP and surface it.

## The mapping (apply NAME-MAP verbatim)
From the LOCKED `NAME-MAP.md` "Creatures (C1)" table. Apply the `new` column exactly; the scanner is keyed to the `old` column.

| id (frozen unless coined-id) | old | new | flag |
|---|---|---|---|
| family `murloc` | code id + quest word "murloc" | `mudfin` (family id) | coined-id |
| quest prose | "where there is one murloc there are five" | reworded, no "murloc" | rename |
| item `slimy_murloc_scale` | Slimy Murloc Scale | Slimy Mudfin Scale | rename |
| family `kobold` | code id + candle flavor | `tunnelrat` (family id) | coined-id |
| loot `tallow_candle` + greeting | "candle-headed vermin" / Tallow Candle | de-candled flavor | rename |
| term `Bristleback` | Bristleback Hides / Bristleback Maul / elder_bristleback | Bristlehide (or per-row) | rename |
| mob `Sanctum Drakonid` | Sanctum Drakonid | Sanctum Wyrmkin | rename |
| quest `Mogger Must Fall` / Mogger | Mogger (Hogger parody) | operator call (keep parody, or rename) | rename? |

The `id` column is FROZEN except the two `coined-id` family rows. `slimy_murloc_scale`, `tallow_candle`, `elder_bristleback` ids stay frozen (display-only rename). If your slice needs a string this table does not cover, STOP and append a request row to `02-WORKING-MEMORY.md`; never invent one.

## Slice-specific hazards (ULTRACODE — refute each with a skeptic)
1. **ATOMICITY of the family-id rename.** The `MobFamily` union member, every `sim.ts` literal (`FLEEING_FAMILIES`, `MOB_PULL_LIMITS`, `canSwim`), every render manifest key, AND every content `family:` field must change in ONE change. Miss any one and the mob's family string no longer matches its behavior table or its model key: mobs stop fleeing / mis-pull / stop swimming, or `tsc` reds on the union. Grep `'murloc'` and `'kobold'` repo-wide (excluding locale overlays) and prove every occurrence is accounted for.
2. **BEHAVIOR IDENTICAL after the rename.** `FLEEING_FAMILIES` / `MOB_PULL_LIMITS` / `canSwim` do the same thing keyed on a new string — same set membership, same limits, same swim gate. A `tests/parity` golden may change ONLY IF the trace serializes the family string, and THEN ONLY by the exact token swap (`murloc` -> `mudfin`, `kobold` -> `tunnelrat`). First confirm whether `tests/parity` serializes the family field at all; if it does not, EVERY golden must stay byte-identical. If it does, the inspector diffs the golden delta and proves it is nothing but the renamed token.
3. **`src/sim` purity.** `types.ts` and `sim.ts` stay DOM / Three / rng-clean: string-literal renames only, no new import, no `Math.random` / `Date.now`. `tests/architecture.test.ts` guards it; run it after the edit.
4. **The render manifest family KEY must still resolve to a GLB.** After renaming the map key, `mudfin` / `tunnelrat` must resolve to the SAME frog / goblin GLB `murloc` / `kobold` did. Rename the key string, keep the target. No geometry change, no new asset.
5. **Two English copies for the item.** "Slimy Murloc Scale" lives in BOTH `items.ts` and `i18n.catalog/items.ts`; edit both byte-identical or `i18n_resolved_equivalence` reds.

## Gate / Parity (do this BEFORE editing)
1. Confirm the tree is green and capture the byte-identical baseline: `npx vitest run tests/parity` (goldens + any rng draw-order log). Save the baseline so the post-edit diff is exact.
2. Note this slice's current `tests/ip_scrub.test.ts` failures (your worklist): the `murloc`, `kobold`, `Bristleback`, `Drakonid`, `Mogger` denylist entries. Those are the rows this slice turns green.
3. Determine up front whether `tests/parity` serializes the mob `family` field (Hazard 2). Record the answer; it decides whether goldens must be byte-identical or token-only.

## Invariants in play
- **RENAME DISPLAY, FREEZE IDS (PRIME DIRECTIVE)** — with the ONE sanctioned exception this slice owns: the coined `MobFamily` ids `murloc`/`kobold` rename atomically. Every OTHER id (`slimy_murloc_scale`, `tallow_candle`, `elder_bristleback`, all mob `id`s / `templateId`s) stays frozen.
- **Parity goldens byte-identical, or token-only.** A display rename changes no sim state; the family-id rename changes no BEHAVIOR. Goldens stay byte-identical unless the trace serializes the family string, in which case they change ONLY by the exact renamed token (diff-verified). Any other golden shift means you changed behavior or another id: STOP.
- **`src/sim/` purity** (`tests/architecture.test.ts`): `types.ts` / `sim.ts` import nothing from render/ui/game/net; no DOM / Three / `Math.random` / `Date.now`.
- **Two English source layers.** Mobs / quests / zones: the SINGLE English source is the sim content `.name`; edit ONLY the content record (`world_entity_i18n.ts` re-derives `en`). The item `slimy_murloc_scale`: DUPLICATED English, edit sim record AND catalog byte-identical.
- **S3 co-location.** Any player-facing quest-prose string that is an EMIT literal updates its EXACT/RULE in `src/ui/sim_i18n.ts` in THIS slice; then run the S3 guard.
- **No off-map names.** Every new string comes from the LOCKED `NAME-MAP.md`.
- **No em/en dashes, no emojis** in any renamed string or prose (repo-wide rule; CI checks).

## Out of scope
- **Warlock demon pets** (Voidwalker / Felguard / ... ids and display) — that is C2.
- **Other ability names**, mob mechanic / aura names (Mortal Strike / War Stomp mob auras are W2), and non-flagged item names (W1).
- **Creature GEOMETRY.** No GLB / model / geometry change; `murloc` stays a frog, `kobold` stays a goblin. Only the family KEY string changes.
- **The 20 locale overlays** (`src/ui/i18n.locales/<lang>.ts`) — contributor rule is English only; the release-tier locale re-fill is handed off in Z1.
- Any "improvement", re-theme, or de-duplication beyond the NAME-MAP rows.

## Verify
```
npx vitest run tests/parity                            # goldens byte-identical OR family-token-only (diff-verified)
npx vitest run tests/architecture.test.ts              # src/sim purity (types.ts / sim.ts stay clean)
npx vitest run tests/ip_scrub.test.ts                  # murloc/kobold/Bristleback/Drakonid/Mogger entries GREEN
npx vitest run tests/i18n_resolved_equivalence.test.ts # SHA gate (run `npm run i18n:hash -- --write` first)
npx vitest run tests/localization_fixes.test.ts        # S3 (ONLY if a quest-prose emit literal moved)
npx vitest run tests/guide.test.ts                     # guide fresh (run `npm run wiki:content` first)
npx tsc --noEmit                                       # union + every family: keyed literal stays typed
# regen sequence (run after edits, before commit):
npm run i18n:gen
npm run i18n:hash -- --write
npm run wiki:content
# npm run wiki:stills                                  # ONLY if a still is family-keyed (Hazard 4 / manifest)
```

## Review
- Run the **cross-platform-sync** reviewer on the diff: focus on the entity / mob-family surface (`types.ts` union <-> `sim.ts` literals <-> `render/characters/manifest.ts` keys <-> every content `family:` field) plus the `entity_i18n` mob lists, so the family id stays consistent across sim + render + i18n.
- Prompt the reviewer for COVERAGE (report every correctness / coupling / requirement gap with confidence + severity), NOT filtering — filtering is a later pass.
- ULTRACODE: run the adversarial-verify pass (`ultracode` keyword) — every claim (family-id rename is atomic and complete, behavior identical, goldens byte-identical-or-token-only, models unchanged, no off-map name) independently refuted by a skeptic agent.

## Acceptance criteria
- [ ] `MobFamily` ids `murloc` -> `mudfin`, `kobold` -> `tunnelrat` renamed ATOMICALLY: `types.ts` union + every `sim.ts` literal (`FLEEING_FAMILIES`, `MOB_PULL_LIMITS`, `canSwim`) + `render/characters/manifest.ts` keys + EVERY content `family:` field.
- [ ] Every `family:` field on all 6 murloc mobs and all 5 kobold mobs updated (grep for residual `'murloc'`/`'kobold'` returns zero, excluding locale overlays).
- [ ] Player-visible flavor scrubbed: no "murloc", no candle-headed-kobold trope (quest `q_murlocs`, zone2 Deepfen line, Odell greeting, `q_kobold_tunnels` wax text, Tallow Candle flavor).
- [ ] "Slimy Murloc Scale" -> "Slimy Mudfin Scale" in BOTH `items.ts` and `i18n.catalog/items.ts` byte-identical; Bristleback, Sanctum Drakonid, and Mogger (per the recorded operator decision) renamed to their NAME-MAP values.
- [ ] All creature GLB models unchanged (frog / goblin); only the family KEY string changed; manifest key resolves to the same GLB.
- [ ] `tests/parity` green with goldens byte-identical, OR changed only by the exact family token (diff-verified nothing else moved).
- [ ] `tests/ip_scrub.test.ts` murloc / kobold / Bristleback / Drakonid / Mogger entries GREEN.
- [ ] `npx tsc --noEmit` clean; `tests/architecture.test.ts` green; `i18n_resolved_equivalence` re-baselined; `tests/guide.test.ts` fresh.

## QA handoff
Feed into `00-QA-TEMPLATE.md` for the paired QA session:
- Confirm the family-id rename is ATOMIC and complete: grep the tree for `'murloc'` / `'kobold'` (excluding the 20 locale overlays) returns zero; the union member, every `sim.ts` literal, the manifest key, and every content `family:` field all carry the new token.
- Confirm behavior is IDENTICAL: `FLEEING_FAMILIES`, `MOB_PULL_LIMITS`, and the `canSwim` gate produce the same membership / limits / swim result on the renamed family; the only `tests/parity` delta (if any) is the family token itself, verified by the inspector.
- Confirm the render manifest `mudfin` / `tunnelrat` keys resolve to the SAME frog / goblin GLB as before; no geometry / asset change.
- Confirm every player-visible flavor string is scrubbed (no "murloc", no candle-headed-kobold), and any moved quest-prose emit literal has its matching `src/ui/sim_i18n.ts` EXACT/RULE updated (S3 green).
- Confirm the "Slimy Murloc Scale" -> "Slimy Mudfin Scale" rename is byte-identical across the sim record and the catalog (equivalence gate green), and Bristleback / Drakonid / Mogger match the LOCKED NAME-MAP (Mogger per the recorded operator decision).
- Confirm no id other than the two coined family ids changed, and no off-map name was introduced.
