<!-- Area-scoped: src/guide/ only. Root + src/ CLAUDE.md already loaded (the IWorld
     seam, dependency direction, the i18n model, the no-em-dash + strict-TS
     conventions). This file covers the public guide/wiki SPA; the lazy 3D model
     viewer has its own src/guide/viewer/CLAUDE.md. -->

# src/guide/ : the public guide / site wiki

A client-rendered docs SPA, the spoiler-safe public front of the game. Separate
Vite entry (`guide.html`), mounted at `GUIDE_BASE` (`/wiki`): the shell file and module
tree keep the `guide` name, only the public URL is `/wiki`. Deep paths (`/wiki/classes`)
fall back to `guide.html` in BOTH `vite.config.ts` and `server/main.ts`. The guide is
**read-only**: it imports pure sim/render *data*, never the live world or `IWorld`.

## Layout (only the non-obvious parts)
- `routes.ts`: the ONE route + nav list (pure data + helpers). A new page is a
  `GUIDE_ROUTES` entry (`id`, `sub`, `navKey`, `group`, optional `topbar`/`descKey`);
  the router, nav chrome, head meta, search, breadcrumbs, sitemap, and tests all
  derive from this list.
- `pages/*.ts`: one module per page; `pages/index.ts` holds the `PAGES` record mapping
  route id to page module. A new page is its own `pages/<x>.ts` registered there behind
  a `GUIDE_ROUTES` entry, never markup appended to `app.ts`/`chrome.ts`.
- `class_meta.ts`: curated (NOT generated) class-chooser feel tags; authored
  presentation judgments, so a new class needs a hand-written entry here that no
  generator produces.
- `nav_aids.ts`: breadcrumbs, prev/next, and the scrollspy TOC, derived from
  `GUIDE_ROUTES` and page headings so pages stay free of nav chrome.
- `content.generated.ts`: GENERATED, do not hand-edit (see below).
- `viewer/`: the lazy 3D model turntable (its own CLAUDE.md; keeps three.js out of the
  main bundle).

## Tests: one sibling suite per concern
`tests/guide.test.ts` is the gate suite: generator freshness, route/page registration,
the sitemap entry, still existence, and the catalog parity pins below. Page-shape and
behavior tests live in per-concern sibling suites (`tests/guide_*.test.ts`, for example
`guide_route_render`, `guide_search`, `guide_hash_nav`, `guide_still_key`,
`guide_class_view`). A new page's tests go in the matching sibling suite (or a new
one), not into `guide.test.ts`.

## Generated data: it never drifts from the game
`content.generated.ts` is built by `scripts/wiki/build_content.mjs` from the sim/render
sources of truth (classes, abilities, talents, zones, dungeons, delves, deeds,
professions, reliquary, mounts, the overworld + warlock-pet bestiary, render VISUALS;
the export block at the top of the generator is the authoritative list). Regenerate
with `npm run wiki:content` (it also runs in `pretest` and `build`).
`tests/guide.test.ts` re-runs the generator and `git diff --exit-code`s the output, so
a stale committed file fails CI (and the gate needs a committed tree). Do not edit it
by hand; change the sim content or the generator, then regenerate.

**Catalog parity pins:** guide pages derived from live sim catalogs are pinned against
those catalogs in `tests/guide.test.ts`: `GUIDE_RELIQUARY` must emit exactly the live
`RELIQUARY_PAGES` ids in catalog order (the Reliquary page renders its
conquerors/professions/horizons shelves from it), and `GUIDE_PROF_PAGES` derives from
the generated craft/gathering lists. Adding, removing, or reordering entries in such a
sim catalog is a same-change `npm run wiki:content` regen obligation beyond the generic
freshness gate.

**Spoiler policy (the generator enforces it):** only high-level, spoiler-safe facts
(names, roles, level bands, signature kits, point-of-interest labels). NEVER balance
numbers, mechanic names, loot, the raid boss name, or per-encounter scripts. Hidden
deeds are filtered structurally (the def's own hidden flag) before any id, name, desc,
or crest path is computed, so they never reach `content.generated.ts`; public deeds
emit no trigger or desc either (criteria stay in the in-game Book). The Reliquary page
lists shelves, pages, and relic names only: it never emits drop sources, firstFind,
clear counts, or personal progress. Rich localized spec/mastery prose resolves live through
`src/ui/talent_i18n.ts`, not baked here.

## i18n: the guide-specific deltas
Guide strings are `guide.*` `t()` keys; the English source lives in
`src/ui/i18n.catalog/guide.ts` with no per-locale blocks, so a new key compiles
English-only. Class/ability/spec NAMES stay English on purpose (proper nouns from the
sim).

## Keep the wiki in sync (YOU MUST, when you add wiki-worthy content)
The guide is the game's public reference, so new player-facing content reaches it in
the SAME change that adds it:
- **Content the generator already covers**: run `npm run wiki:content` and commit the
  regenerated `content.generated.ts`. Add a new descriptive `guide.*` prose key for any
  copy the generator does not derive. **A new (or retinted) model also needs its still
  rendered**: run `npm run wiki:stills` and commit the new `public/guide-stills/*.webp`.
  Stills need a headless browser, so the step is deliberately NOT in `build`/`pretest`;
  `tests/guide.test.ts` existence-gates them in BOTH directions (a figure whose baked
  still is missing on disk fails, and an orphan WebP no figure references fails). They
  are deterministic on one machine but not byte-identical across machines/GPUs, so they
  are existence-gated, never diff-gated: re-render on the swiftshader path.
- **A brand-new content TYPE or system** (a new feature like delves, or a new page):
  extend `scripts/wiki/build_content.mjs` to emit it, add a `pages/<x>.ts` page,
  register it in the `PAGES` record in `pages/index.ts` (`tests/guide.test.ts` fails a
  `GUIDE_ROUTES` id with no registered page; an unregistered route renders the
  placeholder), add the `GUIDE_ROUTES` entry and its `guide.*` keys, then regenerate
  the sitemap (`npm run sitemap:build`, also wired into `build`; the tests fail a
  missing sitemap `<loc>`).
- Confirm with `npx vitest run tests/guide.test.ts` (freshness, routes, and the sitemap
  entry are all gated there).
