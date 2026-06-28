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
  generated content. `app.ts` is the shell, `router.ts` the SPA router, `head.ts` the
  per-route `<title>`/meta, `search.ts` the client search, `chrome.ts` the nav frame,
  `class_view.ts` the per-class detail page.
- `content.generated.ts`: GENERATED, do not hand-edit (see below).
- `viewer/`: the lazy 3D model turntable (its own CLAUDE.md; keeps three.js out of the
  main bundle).

## Generated data: it never drifts from the game
`content.generated.ts` is built by `scripts/wiki/build_content.mjs` from the sim source
of truth (CLASSES, ABILITIES, TALENTS, ZONES, DUNGEONS, the overworld + warlock-pet
bestiary, render VISUALS). Regenerate with `npm run wiki:content` (it also runs in
`pretest` and `build`). `tests/guide.test.ts` re-runs the generator and
`git diff --exit-code`s the output, so a stale committed file fails CI. Do not edit it
by hand; change the sim content or the generator, then regenerate.

**Spoiler policy (the generator enforces it):** only high-level, spoiler-safe facts
(names, roles, level bands, signature kits, point-of-interest labels). NEVER balance
numbers, mechanic names, loot, the raid boss name, or per-encounter scripts. Rich
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
  mob, warlock pet, or model): run `npm run wiki:content` and commit the regenerated
  `content.generated.ts`. Add a new descriptive `guide.*` prose key for any copy the
  generator does not derive.
- **A brand-new content TYPE or system** (a new feature like delves, or a new page):
  extend `scripts/wiki/build_content.mjs` to emit it, add a `pages/<x>.ts` page plus a
  `GUIDE_ROUTES` entry and its `guide.*` keys, then regenerate the sitemap
  (`npm run sitemap:build`, also wired into `build`).
- Confirm with `npx vitest run tests/guide.test.ts` (freshness, routes, and the sitemap
  entry are all gated there).
