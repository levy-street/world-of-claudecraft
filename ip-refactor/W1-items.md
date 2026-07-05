# SESSION W1 — Item / set / augment display rename

> Model: Fable 5 / Opus 4.8, xhigh effort. Harness: Claude Code. Branch: `feature/ip-pivot` (World track worktree). Mode: plain.
> READ FIRST: `00-SHARED-CONVENTIONS.md` (in this folder) — the two English source layers, the byte-identical rule for items, the regen sequence, the contracts/gates, the standard session loop, the validation commands. And the LOCKED `NAME-MAP.md` (the Items section is your only source of new strings; apply it verbatim, never invent a name). Do not re-derive them.

## What we are doing
We are stripping every player-visible Blizzard / WoW IP name out of the game and replacing it with the game's own original vocabulary, WITHOUT changing any mechanic, save format, wire protocol, or RL action space (a rename, not a rewrite). This slice (W1, the World track's first) renames the ~16 flagged verbatim item / set / augment DISPLAY names to their locked NAME-MAP values and FREEZES every item id. It is display-only: item ids are persisted in equipment / inventory / market listings, so a name change touches no saved state.

## Goal
Rename the ~16 flagged item / set / augment display names to their NAME-MAP values (both English copies byte-identical); freeze every item id; regenerate artifacts.

## Scope (verified)
Edit ONLY display `name` strings; NEVER an item `id`. Items are the DUPLICATED-English family, so every rename edits BOTH copies byte-identical (the sim record AND the catalog):
- **Sim records** (`ITEMS[id].name` and the zone/temple item tables):
  - `src/sim/content/items.ts` — base `ITEMS[id].name`.
  - `src/sim/content/zone2.ts` + `src/sim/content/zone3.ts` — `ZONE2_ITEMS` / `ZONE3_ITEMS` `.name`.
  - `src/sim/content/temple.ts` — temple item `.name`.
- **Set names:** `src/sim/content/item_sets.ts` — set display `name`. The 7 tier-sets are naming-convention-only (none verbatim WoW per the audit): apply ONLY the operator's `generic-keep?` decisions as recorded in the LOCKED NAME-MAP; if a tier-set row is `generic-keep?` and the operator kept it, leave it byte-identical.
- **Augments:** `src/sim/content/augments.ts` — rename the flagged augment (`lightwell` -> the NAME-MAP value).
- **Catalog English (the second copy, MUST match byte for byte):** `src/ui/i18n.catalog/items.ts` — `itemNamesEn` (`entities.items.<id>.name`) for every renamed item, plus any set / augment names surfaced there.
- Then REGEN (`i18n:gen`, `i18n:hash -- --write`, `wiki:content`) and commit the artifacts.

## The mapping (apply NAME-MAP verbatim)
Apply the `NAME-MAP.md` Items (W1) section verbatim, keyed by frozen `id`. Anchors from the locked map:
- `shadowmeld_tunic`: Shadowmeld Tunic -> Nightmeld Tunic.
- augment `lightwell`: Lightwell -> Radiant Font.
- Tier-set names (7 sets, naming-convention-only): apply ONLY the operator's per-row `generic-keep?` decision from the LOCKED map; keep any the operator kept byte-identical.
- The rest of the ~16 flagged item / set rows: exactly as the LOCKED map lists them, id-keyed.
If a flagged item is present in the tree but has NO row in the LOCKED NAME-MAP, STOP and append a request row to `02-WORKING-MEMORY.md` (the map is the single source of truth). Never coin a name here.

## Slice-specific hazards
- **Two English copies must match.** Items carry English in BOTH `ITEMS[id].name` (and the zone/temple tables) AND `itemNamesEn` in `src/ui/i18n.catalog/items.ts`. Edit BOTH byte-identical or `tests/i18n_resolved_equivalence` reds. A half-renamed catalog is the classic W1 failure.
- **Item ids are FROZEN (display-only).** Item ids are persisted in `CharacterState` JSONB (`server/db.ts`): equipped gear, inventory stacks, and market / auction listings all key off the item id. Renaming an id would be a save-data migration and is OUT of scope. Change `.name`; leave `id` untouched.
- **Set + augment ids frozen too.** Set membership and augment application resolve by id; rename only their display `name`.
- **`generic-keep?` is operator-owned.** Do not decide a tier-set keep/rename yourself; read the LOCKED map's resolved decision. If a row is still unresolved in the map, STOP and ask.
- **Explicit exclusion (avoid a double-edit / merge race):** `Slimy Murloc Scale` and `Bristleback Maul` are owned by C1 (the murloc / Bristleback coined sweep). Do NOT touch those two rows in W1. They stay on the C1 worklist; editing them here would collide with the Creatures track and split their rename across two slices.
- **Line numbers drift.** The ids / line numbers below are audit-captured on the v0.18.0 tree and MAY have drifted. Confirm CURRENT ids, `.name` lines, and the catalog mirror lines via ONE Explore agent in THIS session (never read `items.ts` or `classes.ts` whole); reconcile against the LOCKED NAME-MAP before editing.

## Gate / Parity (do BEFORE editing)
Items are display-only, so the sim does not move an inch. BEFORE renaming a single string:
1. Run `npx vitest run tests/parity` and confirm a byte-identical GREEN baseline. Every existing golden (the `inventory_vendor` golden in particular, which exercises item drops / vendor / listing) MUST stay unchanged after your rename. If any golden shifts, you changed behavior or an id: STOP.
2. Run `npx vitest run tests/ip_scrub.test.ts` and note THIS slice's current failures (your worklist): the `Shadowmeld` and `Lightwell` denylist entries (plus the other flagged item / set rows) are RED now and must go GREEN by end of slice. Do not touch C1's `Slimy Murloc Scale` / `Bristleback Maul` entries.
3. Check `02-WORKING-MEMORY.md`: confirm the NAME-MAP is LOCKED, mark W1 in-progress, and read the scanner worklist so you tick only your rows.

## Invariants in play
- **RENAME DISPLAY, FREEZE IDS (PRIME DIRECTIVE).** Change the player-visible `name` only; every item / set / augment id stays frozen. W1 has NO coined-id exception (that is C1/C2 only).
- **Two English copies byte-identical.** `ITEMS[id].name` (+ zone/temple tables) and `itemNamesEn` must match byte for byte, or resolution diverges and the SHA gate reds.
- **Parity goldens byte-identical.** A display rename changes no sim state: every existing golden, including `inventory_vendor`, stays unchanged. Any other movement means an id or behavior changed.
- **NEVER touch the locale overlays.** `src/ui/i18n.locales/<lang>.ts` (the 20 non-English overlays) are the maintainer's release job; English only here. No placeholder, no `// TODO`.
- **src/sim purity.** The content edits keep `src/sim/` DOM/Three/`Math.random`/`Date.now`-free (`tests/architecture.test.ts`); you are only editing data strings.
- **Regen is deterministic.** After editing, re-run the generators; a second `i18n:gen` must leave the tree clean. Never hand-edit a generated artifact.

## Out of scope
- **C1's two items:** `Slimy Murloc Scale` and `Bristleback Maul` (owned by the Creatures track). Leave them exactly as-is.
- **Item / set / augment IDS** — frozen. No id renames in W1.
- **Item STATS, drop tables, vendor prices, set bonuses, augment effects** — mechanics are untouched; this is a display rename only.
- **Any item NOT flagged by the scanner** (the ~118 already-original items). Do not "improve" a clean name.
- **The locale overlays and the release-tier locale fill** (handed off in Z1).
- **Abilities, talents, creatures, mob-mechanic names, de-brand text** — other slices (V1/V2/C1/C2/W2/T1).

## Verify
```
npx vitest run tests/parity                            # goldens byte-identical (inventory_vendor unchanged)
npx vitest run tests/ip_scrub.test.ts                  # Shadowmeld / Lightwell (+ W1 rows) now GREEN
npx vitest run tests/i18n_resolved_equivalence.test.ts # SHA gate (needs i18n:hash -- --write first)
npx vitest run tests/guide.test.ts                     # guide content fresh (needs wiki:content)
npx tsc --noEmit                                       # types clean
```
Regen order before the equivalence / guide checks:
```
npm run i18n:gen
npm run i18n:hash -- --write
npm run wiki:content
```

## Review
- Run a COVERAGE reviewer (the `code-reviewer` / domain reviewer) on the diff; prompt it for COVERAGE (report EVERY correctness / requirement gap with confidence + severity), NOT filtering — filtering is a later pass. Focus points: both English copies edited byte-identical for every renamed item; ZERO item id touched; `Slimy Murloc Scale` / `Bristleback Maul` untouched; every new name matches the LOCKED NAME-MAP exactly; tier-set decisions match the operator's `generic-keep?` calls.
- Confirm the diff is source-rename + regenerated artifacts ONLY (no locale overlay edits, no golden edits).

## Acceptance criteria
- [ ] Every flagged item / set / augment renamed to its LOCKED NAME-MAP value (`shadowmeld_tunic` -> Nightmeld Tunic, `lightwell` -> Radiant Font, plus the resolved tier-set decisions).
- [ ] Both English copies identical: `ITEMS[id].name` (+ `ZONE{2,3}_ITEMS`, `temple.ts`) and `itemNamesEn` in `src/ui/i18n.catalog/items.ts` match byte for byte.
- [ ] Every item / set / augment id FROZEN (no id changed).
- [ ] `Slimy Murloc Scale` and `Bristleback Maul` left untouched (owned by C1).
- [ ] `tests/parity` green with every existing golden byte-identical (`inventory_vendor` unmoved).
- [ ] `tests/ip_scrub.test.ts`: this slice's entries (Shadowmeld, Lightwell, + the W1 rows) now GREEN; no new flag introduced.
- [ ] `tests/i18n_resolved_equivalence.test.ts` green (re-baselined via `i18n:hash -- --write`).
- [ ] `tests/guide.test.ts` fresh (`wiki:content` re-run and committed).
- [ ] `npx tsc --noEmit` clean.
- [ ] Regenerated artifacts committed with explicit paths in the same logical change as the source rename; `02-WORKING-MEMORY.md` updated (W1 done-on-track, scanner rows ticked, artifact touch logged).

## QA handoff
Feed into `00-QA-TEMPLATE.md` for the paired QA session:
- Confirm an EQUIPPED item and a MARKET / auction listing still render the NEW display name AND resolve by their FROZEN id (a character saved before the rename loads with gear intact, and a live market listing keyed off the old id still shows and trades). Display changed; id did not.
- Confirm both English copies match byte-identical for every renamed item (spot-check `shadowmeld_tunic` and the `lightwell` augment in `ITEMS[id].name` vs `itemNamesEn`).
- Confirm `Slimy Murloc Scale` and `Bristleback Maul` were NOT touched here (they belong to C1); no double-edit / merge race.
- Confirm the `inventory_vendor` parity golden is byte-identical pre/post and no item id moved.
- Confirm the `ip_scrub` scanner shows the W1 rows green with zero residual verbatim item name in any player-visible field, and no new name trips the denylist.
