<!-- Area-scoped: src/guide/ only. Root + src/ CLAUDE.md already loaded (the IWorld
     seam, dependency direction, the i18n model, the no-em-dash + strict-TS
     conventions). This file covers the public guide/wiki SPA; the lazy 3D model
     viewer has its own src/guide/viewer/CLAUDE.md. -->

# src/guide/ : the public guide / site wiki

A client-rendered docs SPA, the spoiler-safe public front of the game. Separate
Vite entry (`guide.html`), mounted at `GUIDE_BASE` (`/wiki`). Deep paths
(`/wiki/classes`) fall back to `guide.html` in BOTH `vite.config.ts` and
`server/main.ts`. The shell file is still named `guide.html` and the module tree still
lives here; only the public URL is `/wiki`. It is **read-only**: it imports pure
sim/render *data*, never the live world or `IWorld`.

## Layout
- `routes.ts`: the ONE route + nav list (pure data + helpers). A new page is a
  `GUIDE_ROUTES` entry (`id`, `sub`, `navKey`, `group`, optional `topbar`/`descKey`);
  the router, nav chrome, sitemap, and tests all derive from this list.
- `pages/*.ts`: one module per page, each rendering from `guide.*` `t()` keys plus the
  generated content; `pages/index.ts` holds the `PAGES` record mapping route id to page
  module. `app.ts` is the shell, `router.ts` the SPA router, `head.ts` the per-route
  `<title>`/meta, `search.ts` the client search, `chrome.ts` the nav frame,
  `class_view.ts` the per-class detail page.
- `class_meta.ts`: curated (NOT generated) class-chooser feel tags; authored presentation
  judgments, so a new class needs a hand-written entry here that no generator produces.
- `nav_aids.ts`: breadcrumbs, prev/next, and the scrollspy TOC, derived from
  `GUIDE_ROUTES` and page headings; pages stay free of nav chrome.
- `content.generated.ts`: GENERATED, do not hand-edit (see below).
- `viewer/`: the lazy 3D model turntable (its own CLAUDE.md; keeps three.js out of the
  main bundle).

**Module-first: where a new feature lands.** A new page or feature is its own
`pages/<x>.ts` module registered in the `PAGES` record (`pages/index.ts`) behind a
`GUIDE_ROUTES` entry, never markup appended to `app.ts`/`chrome.ts`; nav, search, head
meta, breadcrumbs, and the sitemap all derive from the route entry. Its test goes in
`tests/guide.test.ts`. Fix bugs test-first: a failing test that reproduces the bug, then
the smallest change that turns it green.

## Generated data: it never drifts from the game
`content.generated.ts` is built by `scripts/wiki/build_content.mjs` from the sim source
of truth (CLASSES, ABILITIES, TALENTS, ZONES, DUNGEONS, DELVES, DEEDS, the overworld +
warlock-pet bestiary, render VISUALS). Regenerate with `npm run wiki:content` (it also runs in
`pretest` and `build`). `tests/guide.test.ts` re-runs the generator and
`git diff --exit-code`s the output, so a stale committed file fails CI. Do not edit it
by hand; change the sim content or the generator, then regenerate.

**Spoiler policy (the generator enforces it):** only high-level, spoiler-safe facts
(names, roles, level bands, signature kits, point-of-interest labels). NEVER balance
numbers, mechanic names, loot, the raid boss name, or per-encounter scripts. Hidden
deeds are filtered structurally (the def's hidden flag) and never reach
`content.generated.ts`: no id, name, or desc; public deeds emit no trigger or desc
either (criteria stay in the in-game Book). Rich
localized spec/mastery prose resolves live through `src/ui/talent_i18n.ts`, not baked
here.

## i18n: English-only adds, like the rest of the client
Guide strings are `guide.*` `t()` keys; the English source lives in
`src/ui/i18n.catalog/guide.ts` (no per-locale blocks, so a new key compiles English-only).
The maintainer fills the locale overlays at release; never hand-edit them. Class/ability/
spec NAMES stay English on purpose (proper nouns from the sim).

## Keep the wiki in sync (YOU MUST, when you add wiki-worthy content)
The guide is the game's public reference, so new player-facing content should reach it
in the SAME change that adds it:
- **Content the generator already covers** (a class, ability, talent, zone, dungeon,
  mob, warlock pet, deed, or model): run `npm run wiki:content` and commit the regenerated
  `content.generated.ts`. Add a new descriptive `guide.*` prose key for any copy the
  generator does not derive. **A new (or retinted) model also needs its still rendered**:
  run `npm run wiki:stills` and commit the new `public/guide-stills/*.webp` (it needs a
  headless browser, so it is NOT in `build`/`pretest`; the `tests/guide.test.ts` asset guard
  fails (so CI fails) if a figure's baked still is missing on disk, plus a second guard fails
  on an orphan WebP that no figure references). The stills are deterministic on one machine
  but not byte-identical across machines/GPUs, so they are existence-gated, never diff-gated:
  re-render on the swiftshader path.
- **A brand-new content TYPE or system** (a new feature like delves, or a new page):
  extend `scripts/wiki/build_content.mjs` to emit it, add a `pages/<x>.ts` page,
  register it in the `PAGES` record in `pages/index.ts` (`tests/guide.test.ts` fails a
  `GUIDE_ROUTES` id with no registered page; an unregistered route renders the
  placeholder), add the `GUIDE_ROUTES` entry and its `guide.*` keys, then regenerate
  the sitemap (`npm run sitemap:build`, also wired into `build`).
- Confirm with `npx vitest run tests/guide.test.ts` (freshness, routes, and the sitemap
  entry are all gated there).
