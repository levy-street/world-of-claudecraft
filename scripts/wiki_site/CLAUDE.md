# scripts/wiki_site: the static encyclopedia build

Turns the MediaWiki seed into one crawlable HTML page per article under `/wiki`. The full
story (serving, addresses, SEO checks, keeping it current, refreshing art) is
`docs/wiki-encyclopedia.md`.

| File | Role |
|---|---|
| `build.mjs` | CLI and `buildSite()`: renders every page through `mediawiki/reader/page_render.js` in happy-dom, writes pages, data, redirects and the sitemap. |
| `paths.mjs` | Addresses: sections, slugs, `assignPaths` (registry first), drift. |
| `head.mjs` | Per-page `<head>`: title, description, canonical, social cards, JSON-LD. |
| `links.mjs` | Rewrites reader `#Title` links and lazy pictures into static markup. |
| `seed.mjs` | Reads the seed XML into page records. |
| `sitemap.mjs` | `sitemap-wiki.xml`. |
| `art_coverage.mjs` | Lists pages still missing a captured picture. |
| `prune_native.mjs` | Removes the encyclopedia from a native `dist/`. |

Rules:
- The article markup has ONE source: `mediawiki/reader/page_render.js`. Never render
  article content here; change the renderer and both the static site and the offline
  reader follow.
- A published address never changes. New pages are pinned with `npm run wiki:paths`;
  a removed page becomes a redirect (`null` for gone, or a replacement title).
- A new section name must not be a Guide route's first segment (pinned by
  `tests/wiki_site_units.test.ts`).
- Each `.mjs` a test imports has a `.d.mts` type surface beside it.
- Tests: `tests/wiki_site_units.test.ts` (fast) and `tests/wiki_site_audit.test.ts` (builds
  the whole site, about a minute).
