# 03 - Commit & verification cadence

How to commit the renames and when to verify/playtest. Read with `02-WORKING-MEMORY.md`
(tracks/registries/merging) and `00-SHARED-CONVENTIONS.md` (the two English source layers, the
regen sequence, the per-slice gate, the four contracts you must not drift). This file does not
re-derive those; it only sets the cadence and calls out the one release-tier obligation these
renames create.

## Branch model
```
release/v0.18.0
  └─ feature/ip-pivot                       ← the INTEGRATION base; tracks merge here
       │  spine commits DIRECT:  G0  G1
       ├─ track/ip-vocab           V1  V2
       ├─ track/ip-creatures       C1  C2
       ├─ track/ip-world           W1  W2
       └─ track/ip-text            T1
       │  finale commits DIRECT:  Z1   (after every track merges back)
```
- `feature/ip-pivot` forks off `release/v0.18.0` and starts with **no rename commits**. The spine
  (G0 -> G1) commits directly on `feature/ip-pivot`. **G0 pins the gate; G1 locks the NAME-MAP;
  no rename track forks until the operator flips `NAME-MAP.md` to LOCKED.**
- **Fork a track branch per concurrent track only AFTER G1 locks.** The four tracks edit
  almost-disjoint SOURCE files (`classes.ts`/`talents_classic.ts` for Vocab, `types.ts`/`sim.ts`/
  `manifest.ts`/`zone*.ts`/`warlock_pets.ts` for Creatures, `items.ts`/`item_sets.ts`/`augments.ts`
  for World, docs/comments/`realm.ts` for Text), so they fan out cleanly. Their ONLY shared
  conflict surface is the regenerated i18n / guide artifacts, reconciled by re-running the
  generators (never a hand-merge; see `01-CONCURRENCY.md`).
- **Merge each track back to `feature/ip-pivot` after every slice** (not at the end).
- `feature/ip-pivot` must be green after every merge: the integrator re-runs `i18n:gen` +
  `i18n:hash -- --write` + `wiki:content`, then the relevant gate(s) + `npx tsc --noEmit`
  post-merge before forking or running the next slice off it.

## Commit cadence: per slice, green-only
Commit at **slice boundaries**, never with a half-renamed catalog (the two English copies out of
sync) or an un-regenerated artifact. **The SOURCE rename and its REGEN artifacts are ONE logical
change, committed TOGETHER:**
```
feat(content): rename warrior ability display names
  src/sim/content/classes.ts + src/ui/i18n.catalog/abilities.ts   # the English edit (BOTH copies)
  src/ui/i18n.resolved.generated/*                                 # regen: i18n:gen
  src/ui/i18n.resolved.sha256                                      # regen: i18n:hash -- --write
  src/guide/content.generated.ts                                   # regen: wiki:content
```
- **Do NOT split the source rename from the regen artifacts across two commits.** The
  `tests/i18n_resolved_equivalence.test.ts` SHA gate only passes when the resolved tables and the
  `.sha256` baseline reflect the SAME English edit; a source-only commit reds the gate and a
  regen-only commit is a meaningless delta. One green state, one commit.
- **Every commit is a green state:** `tests/parity` byte-identical, `i18n_resolved_equivalence`
  green (after `i18n:hash -- --write`), `tests/ip_scrub` clearing your slice's entries,
  `tests/guide` fresh, `npx tsc --noEmit` clean; W2/C1 also `tests/localization_fixes` (S3), C1
  also `tests/architecture`. Never commit a red or half-renamed tree.
- **The two English copies land byte-identical in the SAME commit** (abilities: `ABILITIES[id].name`
  in `classes.ts` AND `classAbilityNamesEn` in `i18n.catalog/abilities.ts`; items likewise). A
  commit that edits one copy and not the other diverges resolution and reds the equivalence gate.
- **Ids are frozen (prime directive).** Only the C1/C2 coined-id sweep renames a code id, and it
  does so ATOMICALLY across every file that keys off it in one commit (`refactor(sim): rename
  murloc mob-family id to mudfin`), with the parity golden changing by EXACTLY the renamed token
  and nothing else. Every other slice changes only `.name` strings; never an id.
- Conventional Commits, scoped (`feat(content):`, `refactor(sim):`, `refactor(i18n):`,
  `refactor(render):`, `docs:`). No attribution footer (disabled globally). No em dashes, no en
  dashes, no emojis in messages.
- **Explicit paths only, never `git add -A`.** The regen step writes many generated files across
  the whole `i18n.resolved.generated/` tree; stage only the ones your slice owns (its source edit
  plus the artifacts its rename produced). A shared checkout means another track's un-staged regen
  may be sitting in the tree.
- **Tag at track completion** (`git tag ip-vocab-done`, `ip-creatures-done`, ...) as cheap
  rollback points.

## Verification cadence (the gate is the safety net, not playtesting)
This is a display-only rename, so the proof is the **per-slice gate**, not a human eyeballing
tooltips. When `tests/parity` is byte-identical, `i18n_resolved_equivalence` is green,
`tests/ip_scrub` has cleared your slice's denylist entries, `tests/guide` is fresh, and
`npx tsc --noEmit` is clean (plus S3 for W2/C1 and `tests/architecture` for C1), the rename is
provably display-only and the sim did not move an inch. A human cannot catch resolution or id
drift better than the SHA gate, so **manual playtest per slice is redundant.** Layer it:

| Cadence | Run | Purpose |
|---------|-----|---------|
| **Per slice** | `tests/parity` (byte-identical baseline) + `tests/ip_scrub` (your denylist entries clearing) + `tests/i18n_resolved_equivalence` (after `i18n:hash -- --write`) + `tests/guide` + `npx tsc --noEmit`. W2/C1 also `tests/localization_fixes` (S3); C1 also `tests/architecture`; V2 also `tests/talents`. | display-only proof; parity + SHA gate are the safety net |
| **Per track merge** | full `npm test` + `npx tsc --noEmit` + `npm run build` | catches anything outside the slice's gates + that all four entries still build |
| **Manual playtest (spot-check)** | `npm run db:up && npm run server && npm run dev`, ~10 min | ONLY at: **after V1** and **after V2** (spot-check that ability/talent tooltips render the NEW names, not the old), and at **Z1** (whole tree, scanner-zero) |
| **Pre-deploy only** | full CI gate (`npm test && npx tsc --noEmit && npm run build`) + a real playtest | never deploy mid-refactor |

The `/run` and `/verify` skills automate "launch the game and confirm the names render": point
them at V1, V2, and Z1, not every slice.

## The release-tier locale-fill obligation (the reword-staleness trap)
**This is the single biggest gotcha of the whole job, and it does NOT show up in any PR gate.**
Read it as a hard handoff, not a footnote.

- Rewording an EXISTING English key (which is all a rename does) does **NOT** flip that key's 20
  non-English locale rows to `pending`. The registry only marks a row `pending` when the key is
  NEW or absent, never when its English VALUE changes under a stable key.
- Consequence: **PR-tier CI passes, and even `I18N_RELEASE_TIER=1` passes, while every one of the
  20 non-English overlays still renders the OLD WoW name.** The gates prove the English changed and
  the SHA rebaselined; they do not prove the overlays followed. A release shipped on green CI would
  put "Frostbolt" back in front of every non-English player.
- **Contributors do English ONLY** (per the repo invariant: never touch `src/ui/i18n.locales/
  <lang>.ts`). This job keeps that rule. The re-fill is the MAINTAINER's release-tier reconcile.
- **The reconcile (maintainer, at release):** diff `src/ui/i18n.resolved.generated/en.ts` between
  the merge-base and `HEAD` of `feature/ip-pivot`, isolate the keys that **existed-and-changed**
  (an English value edited under a stable key), and for each such key re-fill EVERY locale whose
  value did NOT also change in the same diff (a stale row still carrying the old WoW name). A locale
  row that already changed (a translator who happened to touch it) is left alone.
- **Z1 writes this handoff note** (the exact changed-key list, produced from that en.ts diff) into
  the release checklist. This doc RECORDS the obligation so no one downstream assumes English-only
  CI green means the renames shipped everywhere. English-only green ships the NEW name to English
  players and leaves 20 overlays stale by design; the re-fill closes it.

## Rules of thumb
- **RENAME DISPLAY, FREEZE IDS.** Every commit changes only `.name` strings and their regen
  artifacts; the sole id change is the C1/C2 coined-id sweep, atomic and golden-verified.
- **Source + regen = ONE commit.** Never split the English edit from `i18n.resolved.generated/*` +
  `i18n.resolved.sha256` + `content.generated.ts`; the equivalence gate only passes with both.
- **Both English copies, byte-identical, same commit** (abilities and items are duplicated in the
  sim record AND the catalog). Edit one and not the other and the SHA gate reds.
- **Green-only commits; explicit paths only, never `git add -A`.** Regen writes many files; stage
  only your slice's. Gate every slice; full `npm test` + `tsc` + `build` every track-merge.
- **Manual playtest only after V1, after V2, and at Z1** - plus before any deploy.
- **The overlays are stale by design after every rename.** English-only CI green is NOT "shipped";
  the release-tier locale re-fill (handed off in Z1) is what makes the renames real in all 21
  locales. Do not deploy mid-refactor.
