# The player encyclopedia (/wiki)

`/wiki` holds two things side by side:

- **The Guide** (`guide.html`, `src/guide/`): the translated how-to-play app. Its routes are
  `GUIDE_ROUTES` in `src/guide/routes.ts`, listed in `public/sitemap.xml`.
- **The encyclopedia**: one static, crawlable HTML page per game entity (items, creatures,
  NPCs, quests, zones, dungeons, abilities, classes, deeds, systems), home at
  `/wiki/encyclopedia`, listed in `sitemap-wiki.xml`. English only: the text is generated
  from the game data, not authored per locale.

Encyclopedia addresses always start with a section the Guide does not use (`SECTIONS` in
`scripts/wiki_site/paths.mjs`; `tests/wiki_site_units.test.ts` pins that they never collide),
so neither site can shadow the other.

## How a page is made

1. `scripts/mediawiki/build_seed.mjs` writes every article as wikitext from the game data
   (`src/sim/content/` through the `scripts/mediawiki/*_articles.ts` writers) into the seed
   (`mediawiki/seed/pages.xml` plus its hover cards).
2. `scripts/wiki_site/build.mjs` renders each article with the reader's own renderer
   (`mediawiki/reader/page_render.js`) in a server-side DOM and writes
   `wiki/<section>/<slug>/index.html` with its title, description, canonical address,
   social cards and schema.org data, plus the search index, hover cards, redirect table
   and `sitemap-wiki.xml`.
3. In the browser, `mediawiki/reader/wiki_page.js` adds what needs a script: tabs, item table
   sorting and filters, list filters, the picture viewer, hover cards and title search.
   Everything a reader or a crawler needs is already in the HTML.

`npm run build` runs both steps from the current game data
(`build.mjs --generate --template dist/encyclopedia.html --out dist`), so every deploy
publishes an encyclopedia that matches the game it ships with. Native builds drop it
(`scripts/wiki_site/prune_native.mjs`, and the desktop `build.files` excludes).

Serving: the game server answers `/wiki/<path>` from `dist/wiki/<path>/index.html`
(`server/wiki_site.ts`), 301s a trailing slash and any moved page, answers 410 for a
removed one, and gives a real 404 to any `/wiki` path that is neither a page nor a Guide
route (`server/static_fallback.ts`). `vite dev` serves `.wiki-site/` the same way.

## Working on it locally

- `npm run wiki:site`: build the pages from the committed seed into `.wiki-site/`, then
  `npm run dev` and open `/wiki/encyclopedia`.
- `npm run wiki:seed`: regenerate the committed seed from the game data.
- The offline single-file reader (`scripts/mediawiki/export_reader.mjs`) still uses the
  hash-routed `mediawiki/reader/reader.js` over the same renderer.

## Addresses never move

`mediawiki/site_paths.json` pins every published page's address. A new page gets
`/wiki/<section>/<slug>` the first time it is pinned; after that, changing how it is
classified does not move it. The registry is keyed by title, so a page whose title
changes is a new page: give the old address a redirect (below) in the same change.

**Every content change that adds, renames or removes a page runs `npm run wiki:paths`**
(regenerates the seed and updates the registry) and commits both files.
`tests/wiki_site_audit.test.ts` fails while the registry is out of date.

When a page goes away, `wiki:paths` moves its address to `redirects` with the value `null`
(the server answers 410 Gone). If the page was renamed or merged, replace `null` with the
title of the page that replaces it, and the server 301s the old address there.

## SEO checks

`tests/wiki_site_audit.test.ts` builds the whole site and checks every page the way the
Lighthouse SEO category does: one unique `<title>`, a meta description, `lang`, viewport,
a canonical that matches the page's own address, no `noindex`, links that are crawlable,
descriptive and resolve (to an encyclopedia page or a Guide route), alt text on every
picture, valid JSON-LD with a breadcrumb trail, and a sitemap that lists exactly the
built pages.

The audit builds from the committed seed. At PR tier that seed may lag the game data
(`tests/mediawiki_seed_freshness.test.ts` checks only its envelope there), so run
`npm run wiki:paths` in any content change. The release-tier CI job
(`MEDIAWIKI_SEED_RELEASE_TIER=1`) requires the committed seed to match a fresh build, so
the audit checks current data before a release ships. The deploy build itself never
ships a dead link: a link to a missing page renders as plain text, and it prints a
warning for each one and for any address not yet pinned.

To run real Lighthouse against a production build:

```powershell
npm run build
npx vite preview --port 4173
npx lighthouse http://localhost:4173/wiki/encyclopedia --only-categories=seo --quiet --chrome-flags="--headless"
```

## Keeping it current when the game changes

| What changes | What happens | Who does it |
|---|---|---|
| Text, stats, loot tables, odds, quests, links | Regenerated from the game data by every `npm run build`. | Automatic |
| A page is added, renamed or removed | `npm run wiki:paths`, commit `mediawiki/site_paths.json` and the seed; give a renamed page's old address a redirect target. | The content PR (the audit test fails until it is done) |
| A new creature, NPC or boss attack needs a picture | Shows its icon until captured. `npm run wiki:art-coverage` lists what is missing. | Whoever refreshes the art (below) |
| A Guide route is added | Pick a path outside `SECTIONS`; the units test checks it. | The Guide PR |

### Refreshing the pictures

The model renders, NPC portraits and boss attack frames are captured from the live game
in a real browser with a GPU (Chrome started from PowerShell on Windows), and committed as
WebP. Each run takes a while (about 25 minutes for a full set; rift bosses render one per
run), so they are refreshed in batches, not on every content change.

- Creature models: `node scripts/mediawiki/render_entity_stills.mjs` (writes
  `public/encyclopedia-stills/` and `scripts/mediawiki/entity_stills.json`).
- NPC and character portraits: `node scripts/wiki/render_character_stills.mjs`
  (`scripts/mediawiki/entity_stills_characters.json`).
- Boss attack frames: `node scripts/wiki/render_attack_snapshots.mjs` with `REAL_GPU=1`
  (`public/encyclopedia-attacks/` and `full/`, plus `scripts/wiki/attack_snapshots.json`).

Each script's header lists its options (it starts its own Vite client unless pointed at a
running one). Afterwards run `npm run wiki:seed`, then `npm run wiki:art-coverage` to
confirm the gap closed.
