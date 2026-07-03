# SESSION T1 — De-brand comments / docs / README + realm copy

> Model: Fable 5 / Opus 4.8, xhigh effort. Harness: Claude Code. Branch: `feature/ip-pivot` (Text track worktree). Mode: PLAIN.
> READ FIRST: `00-SHARED-CONVENTIONS.md` (in this folder) — the two English source layers, the regen sequence, the contracts/gates, the standard session loop, the validation commands. And the LOCKED `NAME-MAP.md`. Do not re-derive them.

## What we are doing
We are stripping every player-visible Blizzard / World of Warcraft IP name out of the game and replacing it with original vocabulary, one self-contained slice per session, applying the locked NAME-MAP verbatim and freezing every code id. This slice (T1, the whole Text track, one session) does the NON-vocabulary cleanup: it removes explicit "WoW / World of Warcraft / Warcraft / Blizzard / vanilla" references and intent-to-copy language from `README.md` and from dev-channel code comments (lawyer P2, narrative / cumulative risk), and, per the operator option, may swap the player-visible "realm" copy to a generic word. It is the lowest-risk slice: mostly non-player-visible text, no gameplay, no ids.

## Goal
Reword the intent-to-copy language and named-franchise references in `README.md` + a `server/realm.ts` comment to describe the systems generically and as independently implemented; scrub named-franchise (WoW / Blizzard / vanilla) references from dev-channel code comments across `src/`; and handle the player-visible "realm" copy per the operator option (swap the display string to "world"/"shard" as a `t()` edit + regen, or leave it), while the infra id (`RealmType`, `server/realm.ts`, `npm run realms`) stays frozen.

## Scope (verified)
Confirm the exact CURRENT line numbers / matches with ONE Explore agent in THIS session before editing: the numbers below are audit-captured on v0.18.0 and may have drifted. Ask it to grep the tree for `WoW`, `World of Warcraft`, `Warcraft`, `Blizzard`, `vanilla`, and `Ironforge`, and to list the player-visible `realm` copy sites. Then edit:

- **`README.md`** — reword the intent-to-copy language. The audit flagged around **L165**: WoW spell names used as examples, an Ironforge example, and "the real vanilla ones"-style phrasing that reads as intent to copy. Reword to describe the systems GENERICALLY and as INDEPENDENTLY implemented (lawyer: reword, do NOT claim "the real vanilla ones"). Keep it truthful and generic: describe rage / hit-table / armor-DR / XP-curve math as real classic-era MMO formulas implemented from first principles, not as a clone of a named product. Replace the Ironforge example with one of the game's OWN original places (Eastbrook Vale, Mirefen Marsh, Thornpeak Heights). Replace any WoW spell-name example with a generic phrase or a NAME-MAP `new` name.
- **`server/realm.ts`** — around **L60**, a WoW-referencing COMMENT. Reword it to describe realm/shard behavior generically. Dev-channel; no regen.
- **Code COMMENTS across `src/`** that say classic-WoW / WoW-style / Blizzard: audit named `hud.ts`, `fct_painter.ts`, `nameplate_threat.ts`, `absorb_bar.ts`, `low_health.ts`, `keybinds.ts`, sim comments, and the guide altitude comments. These are DEV-CHANNEL (`//` comments), NOT player-visible, and OUT of i18n scope. Scrub the named-franchise references (WoW / Warcraft / Blizzard / vanilla) to a generic phrasing ("classic-era", "classic-style", "the reference client", "the original"). This is OPTIONAL / low priority: do the cheap, unambiguous ones and LIST any you leave in the QA handoff so Z1 can sweep the residual.
- **REALM COPY (operator option, per the locked scope decision)** — player-visible "realm" strings MAY swap to "world"/"shard": the `main.ts` `realmTypes.*` labels, the `guide.ts` "Join the realm" copy, and the shell copy. The INFRA id STAYS frozen: `RealmType`, `server/realm.ts`, `npm run realms`, and every code id. If the operator wants the swap, it is a `t()`-string DISPLAY edit (English catalog only) + the full regen sequence. If not, leave it entirely. Default to LEAVE unless the operator has said swap; do not decide unilaterally.

## The mapping (apply NAME-MAP verbatim)
- T1 does NOT introduce ability / talent / creature / item names, so it consumes the NAME-MAP only for any incidental `new` name it drops into `README.md` prose (e.g. replacing a WoW spell-name example): use the LOCKED `new` value from `NAME-MAP.md`, never an invented one. If a prose replacement needs a name the map does not carry, STOP and append a request row to `02-WORKING-MEMORY.md`.
- The "realm" copy swap word (`world` / `shard`) is an operator decision, NOT a NAME-MAP row (it is generic English, lawyer P2). Use exactly the word the operator picks; do not invent a third.
- Comment / doc rewording is generic English cleanup, not a mapped rename: no NAME-MAP row, no ip_scrub denylist entry.

## Slice-specific hazards
- **REGEN TRIPWIRE (the one real hazard):** comment and doc edits (`README.md`, `server/realm.ts`, `src/` `//` comments) are DEV-CHANNEL and need NO regen — they touch no `t()` string and no resolved table. But if you take the realm-copy option and change a player-visible `t()` string, you MUST run the full regen sequence (`i18n:gen` + `i18n:hash -- --write` + `wiki:content`) and keep `tests/i18n_resolved_equivalence` green. Do NOT commit a `t()` edit without the re-baselined SHA + regenerated artifacts.
- **REALM INFRA ID IS FROZEN:** swap DISPLAY copy only. Never touch `RealmType`, the `server/realm.ts` type/enum, the `npm run realms` script, or any `realm`-keyed id. A realm-copy edit is a label string, not a rename of the infra.
- **NEVER edit a locale overlay:** if you swap realm copy, edit ENGLISH only (the catalog / `t()` English source). Do not touch `src/ui/i18n.locales/<lang>.ts`; do not add a placeholder or `// TODO`. The 20-locale re-fill for a reworded English key is the Z1 / release-tier handoff (the reword-staleness trap).
- **REWORD-STALENESS (hand to Z1):** rewording an existing English `t()` key does NOT flip its locale rows to `pending`, so the 20 non-English overlays keep the OLD word and both CI tiers still pass. If you swap realm copy, LOG it in the Z1 reconciliation note so the maintainer re-fills every locale whose value did not also change.
- **`ip_scrub` is not keyed to comments:** the scanner (G0) reads the resolved English tables + sim content, so it will NOT flag a WoW word in a `//` comment. T1's comment/doc scrub is a narrative-risk cleanup, verified by grep + the QA handoff, not by the scanner. Do not expect ip_scrub rows to flip for T1 (except an incidental README `new`-name drop, which is covered by other slices anyway).
- **`src/sim/` purity:** if you scrub a comment inside `src/sim/`, it stays a comment — do not add an import, a `t()`, or anything DOM/Three. `tests/architecture.test.ts` must stay green.

## Gate / Parity (do BEFORE editing)
1. Confirm the working tree is clean (`git status`) and on the Text-track worktree of `feature/ip-pivot` (`git branch --show-current`, `git worktree list`); `npm ci` if `node_modules` is missing.
2. Establish the green baseline BEFORE touching a line: `npx vitest run tests/parity` (byte-identical goldens) and `npx tsc --noEmit`. T1 changes NO sim state, so every parity golden MUST stay byte-identical through this slice — a golden that shifts means you touched behavior or an id: STOP.
3. Grep-capture the current match set (WoW / World of Warcraft / Warcraft / Blizzard / vanilla / Ironforge, plus the player-visible `realm` copy sites) as your worklist; confirm the audit line numbers (README ~L165, `realm.ts` ~L60) against the live files.

## Invariants in play
- **RENAME DISPLAY, FREEZE IDS (PRIME DIRECTIVE):** T1 changes display prose + dev comments only; every code id (including `RealmType` and all realm infra) stays frozen. No sim state moves.
- **Behavior unchanged:** every existing `tests/parity` golden stays byte-identical (T1 is not a coined-id slice, so there is NO permitted golden delta at all).
- **Two English source layers:** a realm-copy swap is a player-visible `t()` string — edit the ENGLISH source only and re-run the full regen; a doc/comment reword is dev-channel and needs no regen. Keep the two straight.
- **Never touch the locale overlays;** contributors add English only.
- **`src/sim/` purity:** comment scrubs inside `src/sim/` add no imports and no DOM/Three; `tests/architecture.test.ts` stays green.
- **Truthful, generic framing:** the reworded README must not assert intent to copy a named product ("the real vanilla ones") and must not introduce a new false claim; describe systems as independently implemented from classic-era formulas.

## Out of scope
- Any gameplay, sim state, save format, wire protocol, or RL action space — untouched.
- The brand name "World of ClaudeCraft" — DEFERRED (operator + counsel decision, the lawyer's P0, a separate business track). Do NOT rename it here.
- Any code `id`, including `RealmType`, `server/realm.ts` internals, and the `npm run realms` script name.
- Ability / talent / creature / item / mob-mechanic display NAMES — owned by V1, V2, C1, C2, W1, W2. T1 only touches comments, docs, and the optional realm COPY.
- The 20 locale overlays and the release-tier re-fill (Z1 / maintainer).
- Any "improvement" beyond de-branding + the operator's realm-copy option: no doc restructure, no comment rewrite for style, no gratuitous prose changes.

## Verify
```
git status                                             # started clean, staging explicit paths only
npx vitest run tests/parity                            # goldens byte-identical (T1 changes no sim state)
npx tsc --noEmit                                       # types clean (no id/type touched)
# ONLY if the realm-copy option was taken (a player-visible t() string changed):
npm run i18n:gen                                        # rebuild resolved tables + status registry
npm run i18n:hash -- --write                            # re-baseline the SHA gate
npm run wiki:content                                    # regenerate guide content if a guide string moved
npx vitest run tests/i18n_resolved_equivalence.test.ts # SHA gate green after the re-baseline
npx vitest run tests/guide.test.ts                     # guide fresh (only if wiki:content re-ran)
# sanity that a comment scrub inside src/sim/ kept purity:
npx vitest run tests/architecture.test.ts
# final grep: zero residual WoW / World of Warcraft / Warcraft / Blizzard / vanilla in the files you owned
```

## Review
- Run a COVERAGE reviewer (the `code-reviewer` or `architecture-reviewer` agent) on the diff; prompt it for COVERAGE (report every residual named-franchise reference, every accidental id/behavior touch, every un-regenerated `t()` edit, with confidence + severity), NOT filtering — filtering is a later pass.
- Have the reviewer confirm: (a) README no longer states intent to copy a named product ("the real vanilla ones") and reads as generic + independently implemented; (b) no code `id` or `RealmType` moved; (c) if realm copy changed, the regen artifacts are present and the SHA gate is green; (d) list any dev comments left un-scrubbed (the low-priority residual for Z1).

## Acceptance criteria
- [ ] `README.md` reworded to generic / independently-implemented framing: no "the real vanilla ones", no WoW spell-name examples, the Ironforge example replaced with a game-original place; truthful and generic.
- [ ] `server/realm.ts` ~L60 comment reworded (no WoW reference); the `RealmType` id / infra untouched.
- [ ] Named-franchise references (WoW / World of Warcraft / Warcraft / Blizzard / vanilla) scrubbed from the cheap dev comments (`hud.ts`, `fct_painter.ts`, `nameplate_threat.ts`, `absorb_bar.ts`, `low_health.ts`, `keybinds.ts`, sim + guide-altitude comments), and any left un-scrubbed are LISTED in the QA handoff.
- [ ] Realm copy handled per the operator option: either swapped (player-visible `t()` English edited + full regen run + `i18n_resolved_equivalence` green + Z1 reword-staleness note logged) OR deliberately left, stated explicitly.
- [ ] No code `id` changed (`RealmType`, realm infra, all ids frozen); `npx tsc --noEmit` clean.
- [ ] Every `tests/parity` golden byte-identical; `tests/architecture.test.ts` green.
- [ ] Commits are Conventional + scoped (`docs: de-brand README`, `chore: scrub franchise refs in comments`, and if applicable `refactor(i18n): swap realm copy to world`), no attribution footer, no em/en dashes, no emojis; staged with explicit paths.

## QA handoff
Feed into `00-QA-TEMPLATE.md` for the paired QA session:
- Confirm the README no longer states intent to copy a named product: no "the real vanilla ones", no WoW spell-name examples, no Ironforge; the systems read as generic and independently implemented from classic-era formulas, and the prose stays truthful.
- Confirm `server/realm.ts` ~L60 no longer references WoW and the `RealmType` id / infra / `npm run realms` script are unchanged.
- Confirm the dev-comment scrub across the named files removed WoW / Blizzard / vanilla references; review the LIST of any left un-scrubbed and hand the residual to Z1.
- If realm copy was swapped: confirm the swapped LABEL renders in the app (the `main.ts` `realmTypes.*` label / `guide.ts` "Join the ..." copy / shell copy show the new word), the English `t()` source (not a locale overlay) was edited, the regen artifacts are committed, `tests/i18n_resolved_equivalence` is green, and the reword-staleness note is in the Z1 handoff so the 20 locales get re-filled at release. If realm copy was LEFT, confirm that was the operator's explicit choice.
- Confirm no code id / `RealmType` moved and every `tests/parity` golden is byte-identical (T1 permits NO golden delta).
