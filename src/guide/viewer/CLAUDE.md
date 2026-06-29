# src/guide/viewer/ : interactive 3D model viewer

A self-contained turntable that loads ONE game model (a GLB) on demand and lets the
reader drag to rotate it. Embedded on the class, bestiary, and warlock pages, and the
full `/guide/models` gallery.

## Why standalone (not the renderer's preview)
The renderer's `src/render/characters` pipeline (`CharacterVisual`, `CharacterPreview`)
preloads the entire ~23 MB character/creature GLB set at module import, fine for the
game, far too heavy for a docs page on mobile. So this viewer reuses ONLY the renderer's
pure GLB loader (`src/render/assets/loader` `loadGltf`, which also resolves dev/prod asset
URLs) and mirrors the small `assembleModel` logic (accessory allowlist, weapon attach,
orientation fixups, tint) itself. Net result: opening one class page fetches one ~1.2 MB
GLB, not the whole set.

## Data
Model specs are baked by `scripts/wiki/build_content.mjs` from the renderer's `VisualDef`
manifest into `GUIDE_MODELS` (`src/guide/content.generated.ts`), deduped by visual key.
Each class/creature/pet carries a `model` (visual key) and optional `tint` (hex). Do not
hand-edit the generated file; change the manifest or the generator and run `npm run
wiki:content`.

## Files (load order matters for code-splitting)
| File | In bundle | Imports three? |
|---|---|---|
| `embed.ts` | main Guide | no, pure markup (`modelViewerEmbed`) |
| `mount.ts` | main Guide | no, wiring + `hasWebGL`; dynamically `import('./scene')` |
| `index.ts` | main Guide | no, barrel (the only import surface for pages) |
| `scene.ts` | lazy chunk | yes, the `ModelViewer` turntable (scene/camera/loop/controls) |
| `model.ts` | lazy chunk | yes, `buildModel` (GLB assembly via `loadGltf`) |

**Keep three.js out of the main bundle:** never statically import `scene.ts`/`model.ts`
from `embed.ts`/`mount.ts`/`index.ts` or a page. The only path to three is the dynamic
`import('./scene')` inside `mount.ts`. `index.ts` re-exports `ModelViewer` as a *type
only*.

## Page contract
- `render()`: emit `modelViewerEmbed({ modelKey, tint, name, poster })` (poster = the
  page's existing 2D crest/icon, so there is always a graceful 2D fallback).
- `mount()`: call `wireModelViewers(root)` and return its cleanup. For the gallery, call
  `createViewer(stage, label)` and drive `load(spec, tint)` from the picker.

## Accessibility / performance
- Loads only on reader activation ("View in 3D"); no autoplay download.
- Respects `prefers-reduced-motion` (no auto-spin); drag + arrow keys still work.
- Pauses rendering while scrolled offscreen (IntersectionObserver).
- No WebGL -> the embed stays on its 2D poster (`data-state="nowebgl"`).
- The canvas carries `role="img"` + a localized `aria-label`; all copy is `guide.viewer.*`
  / `guide.models.*` `t()` keys.
