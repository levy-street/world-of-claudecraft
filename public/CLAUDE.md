<!-- public/: static runtime assets (GLB models / textures / HDRIs / VFX / audio)
     served as-is, plus the standalone HTML pages. EVERYTHING in here ships
     verbatim to the live site, including this file. Root CLAUDE.md covers the
     repo. Don't duplicate it. -->

# public/: Static runtime assets

**PUBLIC: everything under `public/` ships verbatim to the live site.** `vite build`
copies the whole tree (there is no exclusion) into `dist/`, and the server serves
`dist/` statically, so every file here, **including every CLAUDE.md and reviewer note
in this tree** (the model notes under `models/`, `claudium/ASSETS.md`,
`claudium/gallery.html`), is world-readable at worldofclaudecraft.com. Keep all of it
safe-for-public: no secrets, no internal URLs or credentials, no unannounced-feature
or exploit detail.

Almost all files are CC0 art/audio packs (see `CREDITS.md`). **Most in-world
geometry/textures are NOT here**: the renderer generates them procedurally in
`src/render/`; these files are the imported model packs plus PBR/HDRI/sprite/audio
assets.

## Layout: only the rule-bearing paths
`ls public/` for the current set; the rows below carry rules an agent needs, nothing
else. Model categories and their per-category wiring live in `public/models/CLAUDE.md`.

| Path | Rule |
|---|---|
| `basis/` | KTX2/Basis transcoder (`basis_transcoder.js`/`.wasm`, copied from three's addons), fetched by `src/render/assets/ktx2_support.ts`; deliberately NOT media-manifest hashed, served at the literal `/basis/` path |
| `ui/` | icon art loaded by raw logical path. `skills/<class>/` ability icons are committed WebP gated by `tests/skill_icons.test.ts` (pipeline below); `items/` inventory art follows the `woc-item-icon-v1` contract (below); `mobs/` target portraits are existence-gated BOTH directions by `tests/target_portrait_view.test.ts` (regen: `node scripts/render_finder_portraits.mjs`); `portraits/` holds reviewed static target art for procedural entities outside the deterministic mob-render ledger; `deeds/` crests gated by `tests/deed_icons.test.ts`; `ranks/` emblems pinned by `tests/target_rank_view.test.ts`; `cursors/`/`emotes/` PNG and legacy `weapons/` JPG previews are grandfathered |
| `env/` | HDRIs follow the `*_1k.hdr` + `*_2k.hdr` naming, plus `*_backdrop(.webp/_4k.webp)` skies |
| `guide-stills/` | committed WebP wiki stills; existence-gated BOTH directions by `tests/guide.test.ts`; regenerate with `npm run wiki:stills` (deterministic per machine, never diff-gated) |
| `map_art/`, `map_bg/` | zone map plates fetched at raw paths (`/map_art/<zoneId>.png` or `.webp` by `src/ui/map_art.ts`; `/map_bg/<zoneId>.webp` by `src/ui/map_bg.ts`); outside `MEDIA_ROOTS`, so never content-hashed; regen map_bg plates with `npm run assets:mapbg` |
| `claudium/` | Claudium storefront icon set, referenced at raw `/claudium/...` paths from the store UI (outside `MEDIA_ROOTS`); `gallery.html`, `ASSETS.md`, and `CLAUDIUM_VISUAL_ID.md` are reviewer references, not player pages: no `STATIC_PAGE_ALIASES` row and no inline-copy i18n map, but they ship world-readable |

## How these are served
- **Runtime loading:** `src/render/assets/loader.ts` (`loadGltf` / HDR / texture,
  meshopt-decoded, promise-cached). URLs for `models/ textures/ env/ vfx/` resolve
  through `src/render/assets/media.ts` `assetUrl()`: logical path in **dev**
  (`/models/...`), content-hashed path in **prod**. Everything else (`ui/`, music,
  voice, `map_art/`, `map_bg/`, `claudium/`, `guide-stills/`) uses raw logical paths.
  Sampled `audio/sfx/` files use the separate generated SFX manifest with
  content-versioned query URLs and immutable production caching. A generated
  `audio/sfx/runtime-pack.json` mirrors the compiled fallback; a deployed SFX Studio
  artifact can replace that stable JSON with a strict, catalog-compatible pack that
  references immutable `audio/sfx/blobs/<sha256>.mp3` files.
- **Build:** `scripts/build_media_manifest.mjs` walks `MEDIA_ROOTS`
  (`models/ textures/ env/ vfx/` exactly), content-hashes each file, writes
  `src/render/assets/manifest.generated.ts` (`generate`) and copies hashed files to
  `dist/media/` (`emit`). Both run inside `npm run build`. A new asset category must be
  added to `MEDIA_ROOTS` or it will not ship hashed to prod (`audio/` and `ui/` are
  intentionally outside it).
- **Pretty URLs:** the standalone pages get extensionless aliases (`/press`, `/merch`,
  `/links`, ...) from `STATIC_PAGE_ALIASES`, which exists in TWO places that must stay
  mirrored: `server/main.ts` (prod) and `vite.config.ts` (dev). A new standalone page
  needs its alias added to BOTH.

## The standalone HTML pages: three kinds
- **Localized pages** (`server-unavailable.html`, `links.html`, `press.html`,
  `merch.html`): player-facing copy with the inline-copy i18n contract below.
- **Legal pages** (`privacy.html`, `terms.html`, `support.html`,
  `data-deletion.html`): deliberately English-only (no `data-i18n`).
- **Machine/redirect pages** (`wallet-return.html` + `wallet-return.js`): noindex,
  script-only, no visible copy. Opened by full path from
  `src/net/mobile_wallet_deeplink.ts` during the mobile wallet round-trip, so it needs
  no `STATIC_PAGE_ALIASES` row and the inline-copy i18n obligation does NOT apply.

## i18n on the localized pages: the one exception
The localized pages carry **player-facing copy** but do **NOT** use the app's `t()`
system: they ship outside the bundle. Each page embeds its **own self-contained
`copy = { en, es, ..., ru_RU }` map (every locale in `supportedLanguages` inline)** plus
a `data-i18n*` loader that picks the language (`?lang=`, then `localStorage["locale"]`,
then `navigator.language`, then `en`), sets
`document.documentElement.lang`/`document.title`, and writes text via `data-i18n*`
attributes (`data-i18n`/`-alt`/`-html`/`-aria`/`-content` as each page needs).
- **Adding/changing any visible text on a localized page:** add the element with the
  right `data-i18n*` attribute AND add the key to the inline `copy` map **for every
  locale in `supportedLanguages` in the same change**: there is no build-time
  English-fill or `pending`-gate backstop here. The loader only overwrites when
  `strings[key]` exists, so a missing locale silently leaves the element's authored
  **English default** in place (English leaks to a translated visitor). This is the one
  place the contributor/maintainer English-only split does NOT apply.
- Money/numbers/dates would go through `Intl` here (none currently); never hand-build.
- Asset filenames, model dirs, and `console.*` are not player text, English only.

## Gotchas / never
- GLBs are **meshopt-compressed**; the loader sets the meshopt decoder. Raw
  uncompressed exports won't load, optimize via `scripts/assets/build_assets.mjs`.
- **Don't add large binaries casually**: raw source packs aren't committed; keep
  only shipped, optimized assets. New art/audio: add an attribution row to `CREDITS.md`.
- **Class ability icons are WebP, committed directly** (`ui/skills/<class>/`). Drop a
  new icon in any common format and run `npm run assets:skills`
  (`scripts/convert_skill_icons_webp.mjs`): it converts each non-webp image to WebP
  (`smartSubsample` on) and deletes the original. WebP is the source of truth, there is
  NO build-time conversion (the script is a pre-commit step; `tests/skill_icons.test.ts`
  fails a committed non-webp under `ui/skills/`). Every registered skill WebP is a
  distinct, valid, exact 128x128 sRGB shipping image under the catalog-wide 16 KiB
  ceiling; fresh converter outputs retain the stricter 15 KiB intake cap, and the gate
  also rejects missing, orphaned, duplicate, nearly invisible, or wrongly placed art.
  Only `ui/skills/` is auto-converted and gated. Prefer WebP for any new icon art;
  inventory weapons belong in `ui/items/` by item id.
- Every inventory-facing image under `ui/items/` follows the versioned
  `docs/design/item-icon-art-style.md` contract (`woc-item-icon-v1`). New source art
  must be a reviewed square, single-frame, fully opaque sRGB master at 512px or larger
  with exactly one current provenance owner before `npm run assets:items` will convert
  and delete it. The style contract also owns subject fill, lighting, family
  composition, small-size and circular-crop review, and historical supersession records.
