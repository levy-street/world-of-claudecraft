# i18n Translation Workflow

Contributors add **English strings only**; the maintainer fills every locale
before release. This is the canonical roles reference; the root `CLAUDE.md` and
`src/ui/CLAUDE.md` i18n sections point here.

The reason for the split is practical: translating all 20 non-English locales on
every PR would drain the token budget of contributors on smaller Claude Code
plans and bloat each diff with machine translations the maintainer re-does at
release anyway. The sparse-overlay model plus the two-tier release gate make an
English-only PR correct and safe, so that is the contract.

## Roles at a glance

| Role | Does | Does NOT |
|---|---|---|
| **Contributor** (incl. small-plan Claude Code agents) | Add the key to `en` (a `src/ui/i18n.catalog/<domain>.ts` module, or `src/admin/i18n.en.ts` for the admin app); render it via `t()`. For text emitted from `src/sim/` or `server/`, register the matcher RULE in `src/ui/sim_i18n.ts` / `src/ui/server_i18n.ts` in the same change. Regenerate and commit the generated artifacts. | Touch the 20 `i18n.locales/<lang>.ts` overlays. Write any non-English translation. Put English copy, a placeholder, or `// TODO` into an overlay as a stand-in translation. Hand-edit `*.resolved.generated*` or `i18n.status.json`. |
| **Maintainer** (Fernando) | Fill all non-English overlays before release via `npm run i18n:worklist`; regenerate; update the SHA baseline; ship from a `release/**` branch. | n/a |

Translating your own locale is **permitted but never required** of a contributor.

## Adding a player-visible string (by origin)

Pick the recipe for where the string is emitted. In all four, add ENGLISH only,
then `npm run i18n:gen` (= `i18n:build` + `i18n:admin` + `i18n:scan`) and commit;
if the game resolved table changed, also `npm run i18n:hash -- --write`. Never
edit the `i18n.locales/<lang>.ts` overlays and never fake a translation in one.

1. **Client UI (`src/ui`, `src/render`, `src/game`, `index.html`).** Add the key
   to `en` and render via `t()` (numbers/dates via the formatters, below).
   - **Prefer the English-only catalog module `src/ui/i18n.catalog/hud_chrome.ts`**
     (namespace `hudChrome.*`) for new HUD chrome. It has no per-locale blocks, so
     an English add compiles on its own. `shell.ts` is the other English-only domain.
   - The catalog domains `hud`, `game`, `quests`, `items`, `abilities` carry
     tsc-ENFORCED inline per-locale blocks (via `merge.ts` cross-refs and
     `: typeof ...` consts). Adding a key to one of those en blocks red-fails `tsc`
     (TS2719) until you also add it to every inline non-en block. Avoid that by
     using `hud_chrome.ts`/`shell.ts` instead. **Never put `as const` on a catalog
     domain object** (it narrows the literal types and breaks the `en_XA` pseudo-locale).
   - `index.html` / `admin.html` static text uses `data-i18n` / `data-i18n-title` /
     `data-i18n-aria` attributes pointing at a key; the boot localizer fills them.
2. **`src/sim/` emit.** sim stays language-agnostic. Emit stable English, then in
   `src/ui/sim_i18n.ts` add the English to `baseEnTable` + all 21 `BASE_DICT` blocks
   and an `EXACT`/`RULES` matcher so `localizeSimText` re-renders it. `BASE_DICT` is
   `Record<SupportedLanguage, ...>` so `tsc` forces all 21 locales; fill dialects
   inline as **es_ES = es, fr_CA = fr_FR, en_CA = English**. The 7 newest locales
   (nl_NL, pl_PL, id_ID, tr_TR, sv_SE, vi_VN, da_DK) are spread in via
   `...BASE_NEW`/`...PET_NEW` from the generated `sim_i18n.newlocales.ts` (regenerated
   by the new-locale fill pipeline), so a new key must be English-filled in those
   blocks too or `tsc` red-fails on the missing locale. Broad `(.+)` RULES go
   LAST (after every more-specific form); the catch-all `unleashes` rule is the last
   entry by design.
3. **`server/` emit.** Same idea in `src/ui/server_i18n.ts`: add the English to the
   inline `DICT` (all 21 locales, same dialect rule) + an `EXACT`/`RULES` matcher so
   `localizeServerText` re-renders it. Numbers/durations spliced into a server
   message localize via a helper (see `localizeServerDuration`, which re-renders
   `formatDuration`'s `N second/minute/hour/day` output through `tServer`).
   - A sim/server string can alternatively be recognized by a **hud-local matcher**
     (`localizeErrorText` / `localizeSystemText` / `localizeLootText` in `hud.ts`,
     which map to `t()` keys in `main` scope). These run first at runtime; the S3
     guard accepts recognition by any of the three paths.
4. **Admin (`src/admin`).** Operators are users. Add the flat key to
   `src/admin/i18n.en.ts` and render via the admin `t()`. A server operator-error
   string surfaced in the dashboard needs both a key AND an `ADMIN_ERROR_KEYS`
   entry in `src/admin/i18n.ts` (lowercased server message -> key), like
   `error.moderationFailed`. Admin numbers/dates localize via `Intl.*` with
   `adminLanguage()` (see `fmtDate` / `fmtBytes` in `src/admin/format.ts`).

The PR is green at the PR-tier gate (no translations required), with one always-on
exception: a NEW *wordy* English value (a run of 4+ consecutive lowercase letters after
stripping `{tokens}`, i.e. most real prose) also needs its five non-Latin fills
(`zh_CN`/`zh_TW`/`ja_JP`/`ko_KR`/`ru_RU`) in the same change, or `tests/i18n_completeness.test.ts`
(the always-on M16 check) reds even at PR tier; the maintainer normally adds those five at
merge, and only brand/URL leaves may stay byte-identical. `tsc` and the `t()` untracked-key
throw still guarantee English completeness.

## Rewording an existing English value (the staleness blind spot)

Adding a NEW key is safe: the locale starts `pending` and the release gate forces a
fill. CHANGING the English of an EXISTING key is not, and it is the one i18n footgun
with no gate behind it. The status registry tracks whether a row HAS a translation,
not whether that translation still matches the current English, so a row that was
already translated stays `translated` (never `pending`) even after you reword its
English. Both gates pass: the PR tier never required translations, and the
release-tier empty-`pending` assertion only catches MISSING rows, not stale ones. The
20 overlays keep rendering a translation of the OLD wording, which for a prose reword
can now state a different fact than the English (a death mechanic, a creature trait, a
keybind), so non-English readers are shown something simply wrong with nothing red.

So when you reword existing English values, the reword is NOT a free English-only
change. Either:

- re-fill those keys' overlays in the same change (you are then acting as the
  maintainer for those rows, the one sanctioned reason to edit an overlay), or
- record the reworded keys so the next maintainer locale pass re-does them, since
  `npm run i18n:worklist` (which keys off `pending`) will not list them.

To find what a branch reworded, diff the resolved English against the base and keep
the keys that existed before and changed value (compare
`src/ui/i18n.resolved.generated/en.ts` at the merge base vs `HEAD`); every locale whose
value for one of those keys did not also change is now stale. A guard that hashes each
translated row's source English and re-marks a row `pending` when the hash drifts would
close this blind spot; until then it is a manual reconciliation.

## The S3 drift guard and its blind spots

`tests/localization_fixes.test.ts` (the S3 guard) parses `src/sim/sim.ts` AND
`server/game.ts` at test time and asserts every player-facing emit it can see is
recognized by a matcher (or is on a documented backstop). It scans: `emit({type:
'log'|'loot', text})` (literal and ternary), `this.error(id, lit)`,
`this.notice/stopFollow(id, lit)` (and their ternaries), `return 'Sentence.'`;
plus on the server `type:'log'|'error'|'loot', text:` (literal and ternary) and
`sendChatNotice(s, lit)`. It CANNOT see, so it will not catch:

- **Variable-routed emits** where the text is a variable, not an inline literal:
  `broadcastSystem(text)`, `chatMuteMessage()`, and `this.error(id, line)` looping
  over a built array (e.g. the `/help` `helpLines()` readout). Localize or
  backstop these by hand.
- **`?? 'English'` fallbacks** inside an emit argument (`this.error(id, def?.x ??
  'literal')`). Cover those with a targeted test (see `tests/sim_item_i18n.test.ts`).

## English-by-design backstops (`scripts/i18n_blocked_seed.mjs`)

- **`V07_SLASH`** is the allow-list of v0.7 slash-command / diagnostic readouts
  (`/pet`, `/quest`, `/bags`, `/who`, the `/help` command reference, ...) that ship
  ENGLISH by design. These are command-reference dumps full of `/command` tokens;
  do not translate them unless doing a dedicated pass. The S3 guard skips strings
  on this list. Interactive transactional feedback (channel join/leave, `/follow`,
  presence) was deliberately moved OFF this list and IS localized.
- **`COPIED_ALLOW_IDS`** allow-lists rows whose translation is byte-identical to
  English on purpose (true cognates / brand / units), e.g. French `time.minute` /
  `time.minutes`. Without it the release-tier copied-English guard (H3b) would flag
  them. Add a row here only for a genuine cognate, with a comment saying why.

## Formatting numbers, dates, money, durations

Never build a user-visible number/date/percent/coordinate by hand. Use
`formatNumber` / `formatDateTime` / `formatMoney` (`src/ui/i18n.ts`), or `Intl.*`
keyed off the active locale on the admin side. To keep English output
byte-identical to a historical hand-rolled form, pass `useGrouping: false` and the
matching fraction-digit options (see `coords.ts`, `meters.ts`, `xp_bar.ts`,
`clock.ts`). Units/separators that must reorder per locale belong in a `t()` key
with the digits spliced in as a `{placeholder}` (see `hudChrome.meters.*`,
`admin bytes.*`).

## Dev-channel text stays English

`console.*`, `throw new Error(...)`, assertion messages, and any string that only
reaches a developer log or support report are NOT localized and must stay English
so logs and the source match. If one string feeds both a log and the UI, split it.

## The two-tier gate

CI is split by git ref (`.github/workflows/ci.yml`):

- **PR-tier gate** (pull requests, pushes to `main` / `dev-*`): runs `npm test`
  without `I18N_RELEASE_TIER`. An English-only change is legal here. A key the
  active locale has not translated is English-filled and marked `pending`, which
  passes.
- **Release-tier gate** (pushes to `release/**`): sets `I18N_RELEASE_TIER=1`,
  which turns on the release-only checks, including the empty-`pending` assertion.
  A single untranslated row fails it.

Dry-run the release gate locally with `I18N_RELEASE_TIER=1 npm test`.

## The pending set and the en_XA pseudo-locale

- A `pending` key renders English on non-release builds (so dev / pre-release is
  fully usable) and **hard-fails on a release build** (`t()` throws when
  `import.meta.env.PROD` or `I18N_RELEASE=1`), so English can never silently ship
  to a translated player.
- `en_XA` is a dev-only pseudo-locale (accented + bracketed English with
  placeholders preserved). Select it with `?lang=en_XA` on a non-release build:
  any on-screen text that stays plain ASCII with no brackets is a hard-coded
  literal that never became a `t()` key. It is excluded from `supportedLanguages`
  and tree-shaken out of production.

## Maintainer release workflow

1. `npm run i18n:worklist` produces per-language fill batches (it ships the
   locked-terms glossary verbatim with every batch so terminology does not drift).
2. Fill the non-English overlays in `src/ui/i18n.locales/` (and
   `src/admin/i18n.locales/` for the admin app).
3. `npm run i18n:build && npm run i18n:admin && npm run i18n:scan` to regenerate
   the resolved tables and the status registry.
4. `npm run i18n:hash -- --write` to update the resolved-table SHA baseline.
5. Commit, then ship from a `release/**` branch where the release-tier gate
   enforces `pending = 0`.

## Admin parity

The admin dashboard has its own, independent sparse-overlay set
(`src/admin/i18n.en.ts` is flat dotted keys; overlays live in
`src/admin/i18n.locales/`). The same English-only contributor rule applies.
Regenerate the admin resolved table with `npm run i18n:admin`. The release-tier
gate also enforces no `pending` admin rows.

## Locked-terms glossary

`scripts/i18n_glossary.json` (hand-maintained) is the canonical list of brand /
proper-noun terms kept verbatim across locales (for example
"World of ClaudeCraft") plus category key-patterns (class names, ability names,
zone and dungeon names) whose established localized form must be reused rather
than re-coined. `npm run i18n:worklist` ships it verbatim with every per-language
batch. Edit this file to change which terms are locked; do not change tool logic.

## Adding a new locale

1. Create the overlay files (`src/ui/i18n.locales/<code>.ts` and
   `src/admin/i18n.locales/<code>.ts`).
2. Add the locale to the build's locale set and to the runtime `translations`
   map so it becomes selectable in `supportedLanguages`.
3. Regenerate with `npm run i18n:build && npm run i18n:admin && npm run i18n:scan`
   and update the SHA baseline.
