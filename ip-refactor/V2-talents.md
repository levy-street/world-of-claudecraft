# SESSION V2 — Talent + spec/tree display rename (8 non-warrior classes)

> Model: Fable 5 / Opus 4.8, xhigh effort. Harness: Claude Code. Branch: `feature/ip-pivot` (Vocab track worktree, after V1). Mode: plain (verify).
> READ FIRST: `00-SHARED-CONVENTIONS.md` (in this folder) — the two English source layers, the regen sequence, the contracts/gates, the standard session loop, the validation commands. And the LOCKED `NAME-MAP.md` — the single source of truth for every old -> new string. Do not re-derive them; apply them.

## What we are doing
This is a rename job, not a MOVE: we rewrite player-visible talent and spec/tree display strings to their LOCKED NAME-MAP values and change NO game mechanic, save format, wire protocol, or RL action space. V2 is the second slice of the Vocab track (after V1, abilities). It renames all 27 verbatim spec/tree names and ~330 talent node/choice/mastery names across the 8 non-warrior classes to their original vocabulary. Talent allocation is sim state, but it keys off the node `id` (frozen), so this rename touches zero behavior. The warrior tree is ALREADY de-WoW'd (`talents_warrior.ts`) and is the style exemplar, not a target.

## Goal
Rename all 27 spec/tree names and ~330 talent node/choice/mastery names in the 8 non-warrior classes to their LOCKED NAME-MAP values; freeze every node/spec/choice id. Apply the talent-ability pairing (a talent that improves/grants an ability uses that ability's NEW name from the map).

## Scope (verified)
> Line numbers/ids below are audit-captured on v0.18.0 and may drift. CONFIRM the exact current `.name`/`.title` lines, node ids, and spec ids via ONE Explore agent this session (never read `talents_classic.ts` whole). Confirm each against the LOCKED NAME-MAP before editing.

Edit these, DISPLAY strings only, ids frozen:
- **`src/sim/content/talents_classic.ts`** — the 8 non-warrior classes (Mage, Rogue, Paladin, Hunter, Priest, Shaman, Warlock, Druid). Rename every `.name` / `.title` field (27 spec/tree names + ~330 node/choice/mastery names) to its LOCKED NAME-MAP `new` value. Leave every node/spec/choice `id` byte-identical. This is the SINGLE English source for talents; there is NO catalog mirror to keep in sync (unlike abilities/items).
- **`src/ui/talent_i18n.ts`** — ONLY where a talent needs an explicit per-locale title override. The rule (guarded by `tests/talents.test.ts`): a talent name must EQUAL an ability name OR carry an explicit override in `talent_i18n.ts`. If a renamed talent no longer equals its paired ability's new name, add/adjust its `en` title override here. Do NOT touch the non-English locale overlays (`src/ui/i18n.locales/*`) — those are the maintainer's release job.

DO NOT touch:
- **`src/sim/content/talents_warrior.ts`** — already de-WoW'd (Savagery, Weapon Mastery, Blademaster, Bulwark, Sharpened Blades, Kindred Spirits, Stormcaller). It is the STYLE EXEMPLAR; read it for tone, do not re-edit it.
- Any talent EFFECT / rank value / prerequisite / mechanic. Display `name`/`title` ONLY.

Then regen (deterministic, before commit): `npm run i18n:gen`, `npm run i18n:hash -- --write`, `npm run wiki:content`.

## The mapping (apply NAME-MAP verbatim)
Apply the LOCKED `NAME-MAP.md` **Talent trees + talents (V2)** section verbatim, all ~357 rows (27 tree + ~330 node/choice/mastery). Every spec/tree name is verbatim WoW and renames (sample from the map: `arcane` -> Aethermancy, `fire` -> Pyromancy, `frost` -> Cryomancy, paladin `holy` -> Radiance). Node samples: `blessing_of_sanctuary` -> Ward of Refuge, `ardent_defender` -> Stalwart Aegis. Never invent a name off-map: a talent needing a string the map does not cover STOPS and appends a request row to `02-WORKING-MEMORY.md` for the operator.

**Pairing (consumes V1):** a talent that improves/grants an ability (e.g. "Improved <ability>") MUST use that ability's NEW name from the map (the map lists the pair together, e.g. Improved Fireball -> Improved Cinderbolt). If V1 has already landed on the shared base, confirm the applied ability names match the map before renaming their paired talents. If V2 runs before V1 merges, rely on the LOCKED map (it already encodes the paired new name) — both slices read the same frozen contract, so they parallelize.

## Slice-specific hazards
- **Name-equality / title-override rule (the guard).** `tests/talents.test.ts` enforces that every talent name EQUALS an ability name OR carries an explicit per-locale title override in `talent_i18n.ts`. Rename a paired talent and its ability out of lockstep and this reds. After every batch, run `tests/talents.test.ts`; for each fail, either fix the pairing to match the ability's NEW map name or add the `en` override in `talent_i18n.ts`.
- **Ids are frozen; allocation keys off node id.** Talent allocation is sim state, but it is keyed by node `id`, which never changes here. So `tests/parity` goldens stay BYTE-IDENTICAL. Confirm this: a shifted golden means an id changed or an effect moved — STOP.
- **Talent build/export strings round-trip node ids**, not names. A rename cannot break an existing build-string import (the ids are untouched). Confirm at QA that a saved build-string still resolves and paints the renamed titles.
- **Single English source.** Talents have NO duplicated catalog English (unlike abilities/items). Edit only the content record; `talent_i18n.ts` overrides are the ONLY secondary English, and only where the equality rule requires one.

## Gate / Parity (do BEFORE editing)
1. `git status` clean; `npm ci` if `node_modules` is missing in this worktree.
2. Confirm the behavior-unchanged baseline is green BEFORE any edit: `npx vitest run tests/parity` (every existing golden byte-identical). Note this baseline — it must be identical after the rename.
3. Note your slice's current `tests/ip_scrub.test.ts` failures (the talent-name denylist entries) — that is your V2 worklist; each turns green as you rename.

## Invariants in play
- **RENAME DISPLAY, FREEZE IDS (PRIME DIRECTIVE):** change the `.name`/`.title` string; never change a node/spec/choice `id`. V2 is NOT part of the coined-id sweep (that is C1/C2 only); every id here stays frozen.
- **Parity goldens byte-identical.** A display rename changes no sim state; every existing `tests/parity` golden is unchanged. Any other shift means you moved behavior or an id.
- **Talent build-strings unaffected.** They round-trip node ids (frozen), so existing exports/imports resolve identically.
- **Name-equality / override contract.** Every talent name equals an ability name or carries an explicit `talent_i18n.ts` title override (`tests/talents.test.ts`).
- **i18n resolved-equivalence.** After the English edit, re-run `i18n:hash -- --write` or `tests/i18n_resolved_equivalence.test.ts` reds on the SHA gate.
- **src/sim purity.** `talents_classic.ts` stays DOM/Three-free, rng-only (`tests/architecture.test.ts`); a rename does not add an import.
- **Never touch the locale overlays** (`src/ui/i18n.locales/*`): contributors add English only; the release-tier locale fill is handed off in Z1.

## Out of scope
- **Ability names** — owned by V1. V2 only CONSUMES V1's applied ability names for the pairing rule.
- **Talent EFFECTS / mechanics / rank values / prerequisites** — display strings only.
- **The warrior tree** (`talents_warrior.ts`) — already done; style exemplar, do not re-touch.
- **Class names / class ids** — out of scope this whole pass (see README scope decisions).
- The non-English locale overlays (maintainer's release job).

## Verify
```
npx vitest run tests/parity                            # goldens byte-identical (behavior + ids unchanged)
npx vitest run tests/talents.test.ts                   # name-equality / title-override contract (the V2 guard)
npx vitest run tests/i18n_resolved_equivalence.test.ts # SHA gate (needs i18n:hash --write first)
npx vitest run tests/ip_scrub.test.ts                  # V2 denylist entries now green
npx vitest run tests/guide.test.ts                     # guide content fresh (needs wiki:content)
npx tsc --noEmit                                        # types clean
```

## Review
- Run the **architecture-reviewer** agent on the diff; prompt it for COVERAGE (report every correctness / requirement gap with confidence + severity), NOT filtering — filtering is a later pass. Focus: every id frozen, every renamed talent either equals its paired ability's new name or carries an override, no off-map name, no effect touched.
- Verify pass (V2 is plain-with-verify): spot-check a sample of paired talents against the LOCKED map to confirm the pairing matches V1's applied ability names, and confirm the `tests/parity` golden set is byte-for-byte the pre-edit baseline.

## Acceptance criteria
- [ ] All 27 spec/tree names renamed to their LOCKED NAME-MAP values (8 non-warrior classes).
- [ ] All ~330 talent node/choice/mastery names renamed per the map; zero off-map names.
- [ ] Pairing consistent: every "improves/grants an ability" talent uses that ability's NEW map name.
- [ ] Every node/spec/choice `id` frozen (byte-identical).
- [ ] `tests/talents.test.ts` green (name-equality or `talent_i18n.ts` override for every talent).
- [ ] `tests/parity` goldens byte-identical to the pre-edit baseline.
- [ ] `tests/ip_scrub.test.ts` V2 denylist entries green; no new flagged name introduced.
- [ ] Regen artifacts committed: `i18n:gen` + `i18n:hash -- --write` + `wiki:content`, `tsc --noEmit` clean, `tests/i18n_resolved_equivalence` + `tests/guide.test.ts` green.
- [ ] `talents_warrior.ts` untouched.

## QA handoff
Feed into `00-QA-TEMPLATE.md` for the paired QA session:
- Confirm the talent UI paints the renamed spec/tree tabs and node titles (open the talent window for each of the 8 non-warrior classes); no residual WoW name in a tooltip/title.
- Confirm a saved talent build-string (round-trips node ids) still IMPORTS and resolves to the renamed titles — proves ids stayed frozen.
- Confirm every paired talent title matches its ability's NEW name from the LOCKED map (spot-check across classes).
- Confirm the `tests/parity` golden set is byte-identical pre/post (allocation keyed by frozen id).
- Confirm `tests/talents.test.ts` passes: every talent name equals an ability name or has an explicit `talent_i18n.ts` override; no override was added where equality already held.
- Confirm the reword-staleness note for Z1: the 20 non-English overlays still render OLD talent names (release-tier obligation, NOT fixed in this track).
