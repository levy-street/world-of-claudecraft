<!-- public/: static runtime assets (GLB models / textures / HDRIs / VFX / audio)
     served as-is, plus the standalone HTML pages. EVERYTHING in here ships
     verbatim to the live site, including this file. Root CLAUDE.md covers the
     repo. Don't duplicate it. -->

# public/: Static runtime assets

**PUBLIC: everything under `public/` ships verbatim to the live site.** `vite build`
copies the whole tree (there is no exclusion) into `dist/`, and the server serves
`dist/` statically, so every file here, **including this CLAUDE.md and the per-category
`models/<category>/CLAUDE.md` notes**, is world-readable at worldofclaudecraft.com.
Keep all of it safe-for-public: no secrets, no internal URLs or credentials, no
unannounced-feature or exploit detail.

Almost all files are CC0 art/audio packs (see `CREDITS.md`). **Most in-world
geometry/textures are NOT here**: the renderer generates them procedurally in
`src/render/`; these files are the imported KayKit/Quaternius/Kenney models plus
PBR/HDRI/sprite/audio assets.

## Layout
`ls public/` for the current set; the rows below carry the rules. Model/asset dirs
have their own `CLAUDE.md` with per-asset notes (public, see above).

| Path | Contents | Loaded by |
|---|---|---|
| `models/chars/players` | 9 playable-class `.glb` (knight, mage, rogue, ...) + `Mech/` | GLB |
| `models/chars/enemies` | humanoid enemy `.glb` (skeletons, necromancer, golem) | GLB |
| `models/creatures` | animated creature `.glb` (wolf, dragon, goblin, ...) | GLB |
| `models/dungeon` | modular dungeon `.glb` (walls, pillars, torches, chests, ...) | GLB |
| `models/biome` | biome pack `.glb` (built from `scripts/assets/specs/biome_packs.json`) | GLB |
| `models/foliage` | nature `.glb` (trees, bushes, rocks, mushrooms) | GLB |
| `models/props` | village/prop `.glb` (anvil, barrel, well, ...) | GLB |
| `models/quest` | quest-object `.glb` (sigils, grimoire, ward stone, ...) | GLB |
| `models/resources` | resource/loot `.glb` (ores, bars, gems, food, ...) | GLB |
| `models/tools` | tool `.glb` (hammer, pickaxe, fishing, lockpicks, ...) | GLB |
| `models/weapons` | weapon/shield `.glb` | GLB |
| `textures/terrain` | ambientCG PBR sets (`*_Color/NormalGL/Roughness/AmbientOcclusion.jpg`) | texture |
| `textures/water` | water normal maps (MIT, three.js) | texture |
| `textures/skins` | per-class skin texture dirs | texture |
| `env` | HDRIs (`*_1k.hdr` + `*_2k.hdr`) for IBL/sky + `*_backdrop(.webp/_4k.webp)` | RGBELoader / texture |
| `vfx` | particle sprites (`.png`) | texture |
| `audio` | music `.mp3` + `sfx/` (combat/ambient/footsteps, ...) + `voice/<npc>/` lines | `Audio()` / `src/game/sfx_manifest.generated.ts` / `src/game/voice_manifest.generated.ts` |
| `ui` | `skills/<class>/` (WebP ability icons) + `deeds/` (WebP deed crests, gated by `tests/deed_icons.test.ts`) + `mobs/` (prerendered WebP target portraits, one per mob template; regenerate with `node scripts/render_finder_portraits.mjs`; existence-gated BOTH directions by `tests/target_portrait_view.test.ts`) + `ranks/` (rank-frame emblem WebP, pinned by `tests/target_rank_view.test.ts`) + `cursors/` (PNG) + `emotes/` (PNG) + `weapons/` (JPG icons) | `<img>` / CSS cursor |
| `fonts` | self-hosted `.woff2` guide fonts (Alegreya, Alegreya Sans, Cinzel subsets) | CSS `@font-face` |
| `guide-stills` | committed WebP wiki stills; existence-gated BOTH directions by `tests/guide.test.ts`; regenerate with `npm run wiki:stills` (deterministic per machine, never diff-gated) | guide SPA |

Top level also holds favicons/PWA icons, `manifest.webmanifest`, `robots.txt`,
`sitemap.xml`, `llms.txt`, logos, the loading/homepage media, the press-kit
whitepaper PDF, and the standalone HTML pages (next section).

## How these are served
- **Runtime loading:** `src/render/assets/loader.ts` (`loadGltf` / HDR / texture,
  meshopt-decoded, promise-cached). URLs for `models/ textures/ env/ vfx/` resolve
  through `src/render/assets/media.ts` `assetUrl()`: logical path in **dev**
  (`/models/...`), content-hashed path in **prod**. `ui/`, music, and voice use raw
  logical paths. Sampled `audio/sfx/` files use the separate generated SFX
  manifest with content-versioned query URLs and immutable production caching.
  A generated `audio/sfx/runtime-pack.json` mirrors the compiled fallback. A
  deployed Studio artifact can replace that stable JSON with a strict,
  catalog-compatible pack that references immutable
  `audio/sfx/blobs/<sha256>.mp3` files.
  These categories remain outside the render media manifest.
- **Build:** `scripts/build_media_manifest.mjs` walks the `MEDIA_ROOTS`
  (`models/ textures/ env/ vfx/` only), content-hashes each file, writes
  `src/render/assets/manifest.generated.ts` (`generate`) and copies hashed files to
  `dist/media/` (`emit`). Both run inside `npm run build`.
- **Pretty URLs:** the standalone pages get extensionless aliases (`/press`, `/merch`,
  `/links`, ...) from `STATIC_PAGE_ALIASES`, which exists in TWO places that must stay
  mirrored: `server/main.ts` (prod) and `vite.config.ts` (dev). A new standalone page
  needs its alias added to BOTH.

## i18n: the standalone HTML pages
The **localized** pages (`server-unavailable.html`, `links.html`, `press.html`,
`merch.html`) carry **player-facing copy** but do **NOT** use the app's `t()` system:
they ship outside the bundle. Each page embeds its **own self-contained
`copy = { en, es, ..., ru_RU }` map (every locale in `supportedLanguages` inline)** plus a
`data-i18n*` loader that picks the language (`?lang=`, then `localStorage["locale"]`, then
`navigator.language`, then `en`), sets `document.documentElement.lang`/`document.title`,
and writes text via `data-i18n*` attributes (`data-i18n`/`-alt`/`-html`/`-aria`/`-content`
as each page needs). The inline set must match `supportedLanguages` exactly.
The legal pages (`privacy.html`, `terms.html`, `support.html`, `data-deletion.html`)
are deliberately English-only (no `data-i18n`).
- **Adding/changing any visible text on a localized page:** add the element with the right
  `data-i18n*` attribute AND add the key to the inline `copy` map **for every locale in
  `supportedLanguages` in the same change**: there is no build-time English-fill or
  `pending`-gate backstop here. The loader only overwrites when `strings[key]` exists, so
  a missing locale silently leaves the element's authored **English default** in place
  (English leaks to a translated visitor). This is the one place the contributor/maintainer
  English-only split does NOT apply.
- Money/numbers/dates would go through `Intl` here (none currently); never hand-build.
- Asset filenames, model dirs, and `console.*` are not player text, English only.

## Gotchas / never
- GLBs are **meshopt-compressed**; the loader sets the meshopt decoder. Raw
  uncompressed exports won't load, optimize via `scripts/assets/build_assets.mjs`.
- Only `models/ textures/ env/ vfx/` are in the manifest. A new asset category
  needs adding to `MEDIA_ROOTS` in the manifest script, or it won't ship to prod.
  (`audio/` and `ui/` are intentionally outside it. SFX uses its own generated
  manifest; the remaining files use raw paths.)
- **Don't add large binaries casually**: raw source packs aren't committed; keep
  only shipped, optimized assets. New art/audio: add an attribution row to `CREDITS.md`.
- **Class ability icons are WebP, committed directly** (`ui/skills/<class>/`): WebP is a fraction
  of PNG/JPG size at the same quality and decodes on every supported browser and native WebView.
  Drop a new icon into `ui/skills/<class>/` in any common format and run `npm run assets:skills`
  (`scripts/convert_skill_icons_webp.mjs`): it converts each non-webp image to WebP
  (`smartSubsample` on) and deletes the original. WebP is the source of truth, there is NO
  build-time conversion (the script is a pre-commit step; `tests/skill_icons.test.ts` fails if a
  non-webp image is committed under `ui/skills/`). This is the "keep only shipped, optimized
  assets" rule above: the lossless source is not committed. Only `ui/skills/` is auto-converted and
  gated; the existing `cursors/`/`emotes/` PNG and `weapons/` JPG icons are grandfathered. Prefer
  WebP for any new icon art.
- `src/game/voice_manifest.generated.ts` and `manifest.generated.ts` are generated;
  don't hand-edit (root invariant).
