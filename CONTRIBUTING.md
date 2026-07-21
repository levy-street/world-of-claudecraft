<div align="center">

**English** · [Español](docs/i18n/CONTRIBUTING.es.md) · [Español (España)](docs/i18n/CONTRIBUTING.es_ES.md) · [Français](docs/i18n/CONTRIBUTING.fr_FR.md) · [Français (Canada)](docs/i18n/CONTRIBUTING.fr_CA.md) · [Italiano](docs/i18n/CONTRIBUTING.it_IT.md) · [Deutsch](docs/i18n/CONTRIBUTING.de_DE.md) · [简体中文](docs/i18n/CONTRIBUTING.zh_CN.md) · [繁體中文](docs/i18n/CONTRIBUTING.zh_TW.md) · [한국어](docs/i18n/CONTRIBUTING.ko_KR.md) · [日本語](docs/i18n/CONTRIBUTING.ja_JP.md) · [Português (Brasil)](docs/i18n/CONTRIBUTING.pt_BR.md) · [Русский](docs/i18n/CONTRIBUTING.ru_RU.md) · [Nederlands](docs/i18n/CONTRIBUTING.nl_NL.md) · [Polski](docs/i18n/CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](docs/i18n/CONTRIBUTING.id_ID.md) · [Türkçe](docs/i18n/CONTRIBUTING.tr_TR.md) · [Svenska](docs/i18n/CONTRIBUTING.sv_SE.md) · [Tiếng Việt](docs/i18n/CONTRIBUTING.vi_VN.md) · [Dansk](docs/i18n/CONTRIBUTING.da_DK.md)

</div>

# Contributing to World of ClaudeCraft

First off, thank you for being here. World of ClaudeCraft is built by a community
of people who love classic MMOs, and every contribution, big or small, makes it
better. Fixing a typo, translating the game, reporting a bug, building a whole new
dungeon: it all counts, and you're welcome here.

This guide will help you get set up and make your first contribution a smooth one.
You don't need to be an expert. If anything is unclear, ask on
[Discord](https://discord.com/invite/worldofclaudecraft) and someone will be happy to help.

By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

There's a place for everyone here:

- **Code.** Fix a bug, add a feature, or improve performance. Issues labeled
  [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  and [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  are good places to start.
- **Translations.** Help players around the world by improving or completing a
  language. See [Translating the game](#translating-the-game) below. This is one
  of the easiest and most impactful ways to start.
- **Bug reports and feature ideas.** Open an [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose).
  A clear bug report is a real contribution.
- **Documentation.** Guides like this one, the README, and the design docs in
  `docs/` can always be improved.
- **Playtesting and feedback.** Play the game, tell us what feels off, and share
  ideas on Discord.

## Getting started

You'll need [Node.js 22+](https://nodejs.org/) and npm. For the multiplayer server
you'll also want [Docker](https://www.docker.com/) to run Postgres.

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Install dependencies
npm ci

# 3. Run the offline client (no server or database needed)
npm run dev          # open the URL it prints (usually http://localhost:5173)
```

That's enough to play the offline world and work on most things. To run the full
online stack:

```bash
npm run db:up        # start Postgres 16 in Docker (dev DB on port 5433)
npm run server       # build and run the authoritative game server on :8787
npm run dev          # in another terminal; the client proxies to the server
```

The [README](README.md) has the full host, develop, and play guide, and the
`CLAUDE.md` files throughout the repo document the conventions for each area.

### TypeScript toolchain

Type checking runs on TypeScript 7, the native compiler: `npx tsc --noEmit` works
exactly as before and a full repo check now takes a few seconds instead of tens of
seconds. The install is the official dual alias: the `typescript` package resolves
the TypeScript 6 JS API (via the `@typescript/typescript6` wrapper) because
`svelte-check` still consumes that API, while `@typescript/native` provides the
`tsc` binary. Things to know:

- **Editors.** VS Code needs the "TypeScript 7" marketplace extension
  (`TypeScriptTeam.native-preview`) for native language service support until the
  built-in support ships; it toggles via the `js/ts.experimental.useTsgo` setting,
  and its "Disable TypeScript 7 Language Server" command is the sanctioned
  fallback to the TypeScript 6 tsserver. JetBrains IDEs auto-detect the native
  server only under the `@typescript/native-preview` package name, so they will
  not pick it up from this repo's `@typescript/native` alias; their bundled
  TypeScript 6 support works fine.
- **Useful tsc flags.** `--checkers N` sets the parallel type-checker worker count
  (default 4; results are identical at any count): lower it to cap memory on a
  constrained runner, raise it on a many-core machine, and measure either way,
  since more is not always faster. `--singleThreaded` disables all parallelism.
  Checking a single file ad hoc (`npx tsc somefile.ts`) errors when the directory
  has a `tsconfig.json`; pass `--ignoreConfig` for the old behavior.
- **Lockfile.** Regenerate `package-lock.json` only with
  `npx npm@10 install --package-lock-only`: the file uses npm-10 semantics (CI
  runs Node 22's bundled npm), and newer npm majors silently drop
  `svelte-check`'s nested optional-peer entries, which desyncs `npm ci` in CI.
  Plain `npm ci` is safe under any npm major. After regenerating, confirm
  `npm ci --dry-run` is in sync under both npm 10 and your workstation's npm.
- **When to revisit.** Collapse the dual alias back to a single `typescript`
  dependency once BOTH hold: the TypeScript 7.1 stable JS API has shipped
  (TypeScript 7.0 ships no JS API at all; the replacement is tracked in
  microsoft/typescript-go issue 2824), and sveltejs/language-tools issue 3063 has
  closed with a released `svelte-check` that adopts it. svelte-check's
  experimental `--tsgo` modes do not lift its TypeScript 6 API requirement, and
  its in-progress TypeScript 7 loading (language-tools PR 3073) reads the
  `@typescript/native` alias this repo already uses, so no rename is needed.

## Making your change

1. **Create a branch** from the current `release/vX.Y.Z` branch: `feature/<short-slug>`
   or `fix/<short-slug>`. Check the repository's active release branch instead of
   assuming `main`.
2. **Make focused commits.** Smaller, self-contained changes are easier to review
   and merge than large ones.
3. **Add or update tests** for any behavior you change in `src/sim/` or `server/`.
4. **Keep player-visible text translatable.** See [Localization](#localization)
   and [Translating the game](#translating-the-game).

### Things to keep in mind

These are the load-bearing rules of the codebase. The full detail lives in the
root [`CLAUDE.md`](CLAUDE.md), but the short version:

- **The simulation core (`src/sim/`) is the source of truth**, and it stays pure,
  with no DOM, browser, or Three.js imports, so the exact same code runs offline,
  on the server, and in the headless RL environment.
- **The simulation is deterministic.** It runs at a fixed 20 Hz tick, and all
  randomness goes through `Rng`, never `Math.random`, `Date.now`, or
  `performance.now` in sim logic. The same seed always produces the same world.
- **Gameplay math follows classic-era MMO formulas** (rage, hit tables, armor, XP
  curves). Please don't invent balance numbers. Cite the formula instead.
- **Don't hand-edit generated files** such as `*.generated.ts`. Regenerate them
  through the build.
- **Never commit secrets** or a `.env` file, and never enable `ALLOW_DEV_COMMANDS`
  in a production path, since it unlocks cheats.

## Before you open a pull request

Run the repository gate locally. It is the same contract CI enforces:

```bash
npm run gate
```

Use targeted tests and `npm run ci:changed` while iterating. `npm run gate` covers the
generated-artifact freshness check, malware scan, formatting, full tests, strict
typecheck, and client, server, and headless builds.

Then test your change on both desktop and mobile, including a phone-sized viewport
in portrait and landscape, if it touches anything players see. Touch targets
should stay at least 40x40px and form inputs at least 16px font. The UI standards
are documented in [`src/ui/CLAUDE.md`](src/ui/CLAUDE.md).

## Opening the pull request

Push your branch and open a PR against the active release branch. The
[pull request template](.github/PULL_REQUEST_TEMPLATE.md) will guide you through a
short checklist. Please fill it in:

- Describe **what** changed and **why**.
- Link any related issue (for example, "Closes #123").
- Add **screenshots or a clip for UI changes**, on desktop and mobile.
- Confirm `npm run gate` passes and new player-facing strings follow the English-first
  contributor policy below.

A green CI run and a complete checklist are what we look for before merging. A
maintainer may suggest changes. That's a normal, collaborative part of the
process, not a rejection. We aim to be kind and constructive in review, and we ask
the same of you.

> Commit messages and PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/)
> with a scope (`feat(talents): ...`, `fix(net): ...`).

<a id="localization"></a>

## Localization

World of ClaudeCraft ships in many languages. Every player-visible string must be a
translation key, while feature contributors normally add only the English source.

- All user-facing text is a `t()` key. Add new English copy to the matching
  per-domain module under [`src/ui/i18n.catalog/`](src/ui/i18n.catalog/) (new HUD
  chrome goes in `hud_chrome.ts`), then render it with `t('dotted.key', values)`.
  English-only is exactly right for a feature PR: the maintainer fills the other
  locales at release, so you do not edit the `src/ui/i18n.locales/` overlays and you
  never leave an English placeholder or a `// TODO` in one. The M16 exception is a new
  wordy English value, which also needs the five non-Latin fills described in
  [`src/ui/CLAUDE.md`](src/ui/CLAUDE.md).
- Numbers, money, dates, units, and percentages go through the formatters
  (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) rather than manual
  string building.
- Player-facing text emitted from `src/sim/` or `server/`, which stay
  language-agnostic, must be re-localized at the client boundary in the same
  change. The guard test `npx vitest run tests/localization_fixes.test.ts`
  enforces this.

So add your strings in English and open the PR; you do not need to translate them
yourself. If you would like to help with translations, see the next section.

<a id="translating-the-game"></a>

## Translating the game

Want to improve a language, or help bring the game to a new one? You don't need to
write any game code to do it:

1. Translations live in the per-language overlay files under
   [`src/ui/i18n.locales/`](src/ui/i18n.locales/) (one per locale); the English keys
   they mirror are defined in [`src/ui/i18n.catalog/`](src/ui/i18n.catalog/).
2. Improve existing translations, or fill in any that read awkwardly.
3. Run `npx tsc --noEmit` to confirm nothing is missing, then open a PR.

To propose a brand-new locale, or to discuss tone and terminology, start a thread
on [Discord](https://discord.com/invite/worldofclaudecraft) and we'll help you wire it up. Native
and fluent speakers are especially welcome. Good translations make the game feel
like home for players everywhere.

## Reporting bugs and requesting features

Please use the [issue templates](https://github.com/levy-street/world-of-claudecraft/issues/new/choose):

- **Bug report.** Search [existing issues](https://github.com/levy-street/world-of-claudecraft/issues)
  first to avoid duplicates, then include steps to reproduce, what you expected,
  what happened, and your environment (offline or online, browser, desktop or
  mobile).
- **Feature request.** Describe the problem you're trying to solve, not just the
  solution. Context helps us design the right thing.

## Getting help

Stuck, or just want to say hi? Join the
[community Discord](https://discord.com/invite/worldofclaudecraft). No question is too small, and
new contributors are always welcome.

## License

By contributing code, you agree that your code contributions will be licensed
under the project's [MIT License](LICENSE), the same license that covers the
project.

Original creative assets (sound recordings, music, art, and similar authored
works) are the exception. If you contribute an original asset you created, you
may instead keep copyright and contribute it under a license of your choice
(for example CC BY-NC 4.0), provided that:

- the license, the asset paths it covers, and your attribution are recorded in
  the license table in [CREDITS.md](CREDITS.md) as part of the same pull
  request, and
- it includes at minimum a perpetual, royalty-free grant to Levy Street to use
  the assets commercially in World of ClaudeCraft, including official releases
  and the in-game store.

For assets listed in the CREDITS.md table, that recorded license controls over
the project's default MIT license. Asset contributions without a CREDITS.md
entry are MIT like everything else.

---

Thank you for contributing to World of ClaudeCraft. We can't wait to see what you
build with us.
