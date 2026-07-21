# 00 — Shared conventions (READ FIRST, every session)

Every brief in this folder assumes you have read this file and `README.md` (the goal, the
load-bearing "display-only" finding, the IP surface map, the session index, the scope
decisions). This file holds the rules identical across all sessions; the per-session briefs
carry only what is unique to their slice. Do not re-derive these.

## What the repo is (one sim, three hosts, one i18n seam)
World of ClaudeCraft is a classic-style micro-MMO AND a headless RL env, all driven by one
deterministic TypeScript sim core. The EXACT same `src/sim/` code runs offline (browser), on
the authoritative server (`server/`), and headless (`headless/`). Behavior is identical
everywhere and must stay so — this job changes NONE of it.
- **Content is data-as-code.** Every class/ability/talent/mob/item is a record in
  `src/sim/content/*` with a stable code `id` and a display `name`.
- **Display resolves by id through i18n, never off the raw `.name`.** `tEntity()`
  (`src/ui/entity_i18n.ts`) builds `entities.<kind>.<id>.name`; `tTalent()`
  (`src/ui/talent_i18n.ts`) localizes talent titles; classes map via `CLASS_NAME_KEYS`.
- **Server is authoritative; the client is a renderer + snapshot mirror.** Ids (not names)
  cross the wire and land in saved state. We never touch that path.

## Branch & checkout
- Branch: `feature/ip-pivot`, forked off `release/v0.18.0`. Confirm with
  `git branch --show-current` and `git worktree list` — this project uses many worktrees and
  paths shift between sessions. Base checkout: `world-of-claudecraft/world-of-claudecraft`.
- If `node_modules` is missing in a worktree, run `npm ci` FIRST.
- Shared checkout: commit with EXPLICIT paths, never `git add -A` (the regen step writes many
  generated files; stage only the ones your slice owns).

## THE PRIME DIRECTIVE: rename display, freeze ids
- **Change the player-visible `name` string. Never change the code `id`.** Ids are persisted
  (saved characters, action bars, talent build-strings), cross the wire, and index the RL
  action space — renaming one is a data migration and is OUT of scope.
- **Apply the locked `NAME-MAP.md` verbatim.** Never invent a name off-map. If your slice needs
  a string the map does not cover, STOP and surface it (the map is the single source of truth,
  the analog of the world-api `CommandName` table).
- **THE ONE EXCEPTION — the coined-id sweep (C1/C2 only).** The Blizzard-coined `MobFamily` ids
  `murloc`/`kobold` and the warlock demon-pet ids are renamed atomically across every file that
  keys off them. This is the ONLY id change in the whole job, and the ONLY place a parity golden
  may change (by exactly the renamed token, verified). Every other slice freezes every id.

## The two English source layers (the byte-identical rule)
Which English source is authoritative differs by family — get this wrong and the
`i18n_resolved_equivalence` gate or the `sim_i18n` matcher reddens:
- **Mobs / NPCs / quests / zones / dungeons / delves:** SINGLE source is the sim content record
  `.name`. `src/ui/world_entity_i18n.ts` (`makeEnglishWorldEntities`) re-derives the `en` slice.
  **Edit ONLY the content record.**
- **Abilities:** English is DUPLICATED in `ABILITIES[id].name`/`.description` (`src/sim/content/
  classes.ts`) AND `classAbilityNamesEn` in `src/ui/i18n.catalog/abilities.ts`
  (`entities.abilities.<id>.name`). **Edit BOTH, byte-identical.**
- **Items:** English is DUPLICATED in `ITEMS[id].name` (`src/sim/content/items.ts`, plus
  `ZONE{2,3}_ITEMS`, `temple.ts`) AND `itemNamesEn` in `src/ui/i18n.catalog/items.ts`. Item-set
  names live in `item_sets.ts` + the catalog. **Edit BOTH, byte-identical.**
- **Talents:** localized by `src/ui/talent_i18n.ts`, which requires a talent name to EQUAL an
  ability name or carry an explicit per-locale title override. Rename talents consistently with
  the abilities they mirror (the NAME-MAP encodes the pairing).
- **Mob mechanic / aura names** (a mob's inline `name:'Mortal Strike'` on `frenzyOnHit`/
  `mortalStrike`/`petSpell`/... ): the display is matched by the `AURA_NAME_KEY` reverse map in
  `src/ui/sim_i18n.ts`. **Edit the inline `name` AND its matcher entry in the SAME slice** (S3).

## NEVER touch the locale overlays
`src/ui/i18n.locales/<lang>.ts` (20 non-English overlays) are the maintainer's job at release.
Contributors add ENGLISH only. Do not edit an overlay, and do not add a placeholder or `// TODO`
to one. (The release-tier locale re-fill for these renames is handed off in Z1 — see below.)

## The regen sequence (run after your edits, before you commit)
```
npm run i18n:gen            # rebuild src/ui/i18n.resolved.generated/* + the status registry
npm run i18n:hash -- --write # rewrite src/ui/i18n.resolved.sha256 (or i18n_resolved_equivalence reds)
npm run wiki:content        # regenerate src/guide/content.generated.ts (names feed the /wiki guide)
```
Regen is deterministic and idempotent: a second `i18n:gen` must leave the tree clean. Generated
files conflict on merge; resolve by RE-RUNNING the generators, never a hand-edit. Commit the
regenerated artifacts your slice produced with explicit paths.

## The contracts you must not silently drift (the gates exist to catch these)
1. **Parity goldens stay byte-identical.** A display rename changes no sim state, so
   `npx vitest run tests/parity` stays green with EVERY existing golden unchanged. A modified
   existing golden means you changed behavior or an id — STOP. (C1/C2 coined-id sweep: a golden
   may change by EXACTLY the renamed token; the inspector diffs to confirm nothing else moved.)
2. **i18n resolved-equivalence.** `tests/i18n_resolved_equivalence.test.ts` is a SHA-256 gate
   over the 21-locale resolved table; it reds unless you re-ran `i18n:hash -- --write` after your
   English edit. The duplicated ability/item English (sim record vs catalog) MUST match byte for
   byte or resolution diverges.
3. **The verbatim-name scanner** (`tests/ip_scrub.test.ts`, built in G0). Your slice turns its
   denylist entries green; you never ADD a name that the scanner would flag. Never loosen or
   `.skip` the scanner to pass — that is the gate you are here to satisfy.
4. **Guide freshness.** `tests/guide.test.ts` reds if `src/guide/content.generated.ts` is stale;
   re-run `npm run wiki:content` and commit it.
5. **S3 localization guard.** `tests/localization_fixes.test.ts` parses `sim.ts`/`server` for
   player-facing emit literals. If your slice moves one (W2 mechanic names, C1 quest prose),
   update the matching EXACT/RULE in `src/ui/sim_i18n.ts` in the SAME slice, then run the guard.
6. **src/ purity.** `tests/architecture.test.ts` — `src/sim/` imports nothing from
   render/ui/game/net and has no DOM/Three/`Math.random`/`Date.now`. C1's coined-id sweep edits
   `src/sim/types.ts` + `src/sim/sim.ts`; keep them sim-pure.

## The standard session loop
0. **Pre-flight:** `git status` clean; `npm ci` if needed; read THIS file + your brief +
   `README.md` + the LOCKED `NAME-MAP.md`. If concurrent, read `02-WORKING-MEMORY.md`, check the
   Slice status board + the scanner worklist before you start, and mark your session in-progress.
1. **Load context** via ONE Explore agent (never read `classes.ts`/`talents_classic.ts`/`sim.ts`
   whole). Get the exact CURRENT ids, `.name` lines, catalog mirror lines, and call sites for
   your domain; confirm them against the NAME-MAP.
2. **Confirm the gate is green BEFORE editing:** run `tests/parity` (byte-identical baseline) and
   note your slice's current `ip_scrub` failures (your worklist).
3. **Do the slice:** apply the NAME-MAP (both English copies where duplicated), regenerate.
4. **Verify** (the subset your change touches — see commands).
5. **Review:** a COVERAGE reviewer on the diff (report every gap, do not filter). ULTRACODE
   slices additionally run an adversarial-verify pass (each id-freeze / behavior-unchanged claim
   refuted by a skeptic).
6. **QA handoff:** fill the items your brief lists for the paired QA (`00-QA-TEMPLATE.md`).
7. **Update working memory (concurrent runs):** flip your slice to `done-on-track`, tick the
   scanner-worklist entries you cleared, and log any generated-artifact touch. Append-only.

## Validation commands (run the subset your slice touches)
```
npx vitest run tests/parity                            # goldens byte-identical (behavior unchanged)
npx vitest run tests/i18n_resolved_equivalence.test.ts # SHA gate (needs i18n:hash --write first)
npx vitest run tests/ip_scrub.test.ts                  # the verbatim-name scanner (G0)
npx vitest run tests/guide.test.ts                     # guide content fresh (needs wiki:content)
npx vitest run tests/localization_fixes.test.ts        # S3 (W2 mechanic names / C1 prose)
npx vitest run tests/architecture.test.ts              # src/sim purity (C1 coined-id sweep)
npx vitest run tests/talents.test.ts                   # talent name/pairing (V2)
npx tsc --noEmit                                       # types (C1/C2 id renames must stay typed)
# pre-merge (mirror CI): npm test && npx tsc --noEmit && npm run build
```

## Commits & verification
Full detail in `03-COMMIT-AND-VERIFY.md`. In short: commit at slice boundaries, **green-only** —
never a half-renamed catalog (the two English copies out of sync) or an un-regenerated artifact.
Keep the SOURCE rename commit and the REGEN artifact commit as ONE logical change (the equivalence
gate only passes with both). Conventional Commits, scoped (`refactor(i18n): ...`,
`feat(content): rename ...`), no attribution footer, no em/en dashes, no emojis. The per-slice
gate IS the safety net; reserve manual playtest for after V1/V2 and at Z1.

## Execution mode
Plain = the standard loop + the relevant gates. ULTRACODE = run the slice as an adversarial-verify
workflow (each id-freeze / behavior-unchanged / no-off-map-name claim independently refuted by a
skeptic). ULTRACODE slices: **G1** (the mapping — every proposed name adversarially checked for
residual WoW AND other-game IP), **C1** and **C2** (the coined-id sweep touches sim + render +
persistence-adjacent code). The rest are plain, with a verify pass for V1/V2/W2.

## Determinism note for anything you add
No `Math.random`/`Date.now`/`new Date`/`performance.now` in anything you add under `src/`. The
`ip_scrub` scanner (G0) reads the resolved English tables + sim content statically; keep it a
pure data scan with no wall-clock and no network.
