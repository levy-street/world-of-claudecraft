<!-- public/: static runtime assets (GLB models / textures / HDRIs / VFX / audio)
     served as-is, plus the standalone localized HTML pages.
     Area-scoped notes only; root CLAUDE.md covers the repo. Don't duplicate it. -->

# public/: Static runtime assets

Files served verbatim by Vite (dev) and bundled into `dist/` (prod). Almost all
are CC0 art/audio packs (see `CREDITS.md`). **Most in-world geometry/textures are NOT
here**: the renderer generates them procedurally in `src/render/`; these files
are the imported KayKit/Quaternius/Kenney models plus PBR/HDRI/sprite/audio assets.

## Layout
| Path | Contents | Loaded by |
|---|---|---|
| `models/chars/players` | 9 playable-class `.glb` (knight, mage, rogue, barbarian…) + `Mech/` | GLB |
| `models/chars/enemies` | 7 enemy `.glb` (skeletons, necromancer, golem) | GLB |
| `models/creatures` | animated creature `.glb` models (wolf, dragon, goblin…) | GLB |
| `models/dungeon` | 378 modular dungeon `.glb` (walls, pillars, torches, chests, banners…) | GLB |
| `models/foliage` | 23 nature `.glb` (trees, bushes, rocks, mushrooms) | GLB |
| `models/props` | 38 village/prop `.glb` (anvil, barrel, blacksmith, well…) | GLB |
| `models/quest` | 10 quest-object `.glb` (sigils, grimoire, ward stone…) | GLB |
| `models/resources` | ~132 resource/loot `.glb` (ores, bars, gems, food, crates…) | GLB |
| `models/tools` | ~69 tool `.glb` (hammer, pickaxe, fishing, lockpicks…) | GLB |
| `models/weapons` | 19 weapon/shield `.glb` | GLB |
| `textures/terrain` | ambientCG PBR sets (`*_Color/NormalGL/Roughness/AmbientOcclusion.jpg`) | texture |
| `textures/water` | 3 water normal maps (MIT, three.js) | texture |
| `textures/skins` | 7 per-class skin texture dirs | texture |
| `env` | 8 HDRIs (`*_1k.hdr` + `*_2k.hdr`) for IBL/sky + 6 `*_backdrop(.webp/_4k.webp)` | RGBELoader / texture |
| `vfx` | 16 particle sprites (`.png`) | texture |
| `audio` | `main-theme.mp3` + `sfx/` (combat/ambient/footsteps…) + `voice/<npc>/` lines | `Audio()` / `src/game/voice_manifest.generated.ts` |
| `ui` | `skills/<class>/` (WebP ability icons) + `cursors/` (PNG) + `emotes/` (PNG) + `weapons/` (JPG icons) | `<img>` / CSS cursor |

Top level also holds favicons/PWA icons, `manifest.webmanifest`, `robots.txt`,
`sitemap.xml`, `loading-screen.jpg`, `home-bg.{mp4,png}`, logos, and the two
standalone localized HTML pages `server-unavailable.html` (offline page) and
`links.html` (link-tree landing).

## How these are served
- **Runtime loading:** `src/render/assets/loader.ts` (`loadGltf` / HDR / texture,
  meshopt-decoded, promise-cached). URLs for `models/ textures/ env/ vfx/` resolve
  through `src/render/assets/media.ts` `assetUrl()`: logical path in **dev**
  (`/models/...`), content-hashed path in **prod**. `audio/` and `ui/` are referenced
  by **raw logical path** (`/audio/...`, `/ui/...`): NOT in the manifest, served
  unhashed (`assetUrl()` also falls back to `/${logical}` for these).
- **Build:** `scripts/build_media_manifest.mjs` walks the `MEDIA_ROOTS`
  (`models/ textures/ env/ vfx/` only), content-hashes each file, writes
  `src/render/assets/manifest.generated.ts` (`generate`) and copies hashed files to
  `dist/media/` (`emit`). Both run inside `npm run build`.

## i18n: the two standalone HTML pages
`server-unavailable.html` and `links.html` carry **player-facing copy** and are fully
localized, but they do **NOT** use the app's `t()` system: they ship outside the bundle.
Each page embeds its **own self-contained `copy = { en, es, …, ru_RU }` map (every locale in
`supportedLanguages` inline)** plus a `data-i18n*` loader that picks the language (`?lang=`, then
`localStorage["locale"]`, then `navigator.language`, then `en`), sets
`document.documentElement.lang`/`document.title`, and writes text via `data-i18n*`
attributes (`data-i18n`/`-alt` on both; `links.html` adds `-html`, `-aria`, `-content`).
The inline set must match `supportedLanguages` exactly.
- **Adding/changing any visible text here:** add the element with the right `data-i18n*`
  attribute AND add the key to the inline `copy` map **for every locale in
  `supportedLanguages` in the same change**: there is no build-time English-fill or `pending`-gate backstop here.
  The loader only overwrites when `strings[key]` exists, so a missing locale silently
  leaves the element's authored **English default** in place (English leaks to a translated
  visitor). This is the one place the contributor/maintainer English-only split does NOT apply.
- Money/numbers/dates would go through `Intl` here (none currently); never hand-build.
- Asset filenames, model dirs, and `console.*` are not player text, English only.

## Gotchas / never
- GLBs are **meshopt-compressed**; the loader sets the meshopt decoder. Raw
  uncompressed exports won't load, optimize via `scripts/assets/build_assets.mjs`.
- Only `models/ textures/ env/ vfx/` are in the manifest. A new asset category
  needs adding to `MEDIA_ROOTS` in the manifest script, or it won't ship to prod.
  (`audio/`/`ui/` are intentionally outside it, referenced by raw path.)
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
