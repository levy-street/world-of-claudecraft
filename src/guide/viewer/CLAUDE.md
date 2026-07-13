# src/guide/viewer/ : interactive 3D model viewer

A self-contained turntable that loads ONE game model (a GLB) on demand and lets the
reader drag to rotate it. Embedded on the class detail pages (including the warlock pet
section) and driving the full `/wiki/models` gallery; the bestiary uses static
pre-rendered stills and links to the gallery.

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
Each class/druid form/creature/pet carries a `model` (visual key) and optional `tint` (hex). Do not
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
| `framing.ts` | lazy chunk | no, pure camera-framing math (`frameTurntable`, Node-testable); reached only via `scene.ts` |

**Keep three.js out of the main bundle:** never statically import `scene.ts`/`model.ts`
from `embed.ts`/`mount.ts`/`index.ts` or a page. The only path to three is the dynamic
`import('./scene')` inside `mount.ts`. `index.ts` re-exports `ModelViewer` as a *type
only*.

**Module-first: where a new feature lands.** New behavior goes on the correct side of the
split above: pure math (like `framing.ts`) is its own Node-testable module in the lazy
chunk; markup/wiring goes in `embed.ts`/`mount.ts`; pages import only the `index.ts`
barrel. Tests live in `tests/guide_viewer_*.test.ts` (embed, mount, framing,
skin_bounds); fix viewer bugs test-first there (a failing test that reproduces the bug,
then the smallest green change).

## Page contract
- `render()`: emit `modelViewerEmbed({ modelKey, tint, name, poster, still, autoplay? })`. The
  pre-rendered `still` (a transparent WebP of this exact figure, baked by `npm run wiki:stills`)
  is the default poster when present; the page's 2D crest/icon `poster` is the fallback, so there
  is always a graceful 2D image. Pass `autoplay: true` for a hero portrait that should load + spin
  on its own (see Accessibility / performance for the gating).
- `mount()`: call `wireModelViewers(root)` and return its cleanup. For the gallery, call
  `createViewer(stage, label)` and drive `load(spec, tint)` from the picker.
- **Always return `mount()`'s cleanup and call it on navigate:** the viewer must hand the
  WebGL context back (`forceContextLoss`) and dispose the renderer, its tint-material
  clones, and the cloned skeletons' bone textures, including when `destroy()` races an
  in-flight `load()` (destroy is idempotent; a late-resolving load disposes its own
  build). Regression pins: `tests/guide_viewer_mount.test.ts` and
  `tests/guide_viewer_skin_bounds.test.ts`.

## Accessibility / performance
- Loads only on reader activation ("View in 3D"), with ONE scoped exception: an
  `autoplay` embed (the class hero portrait) auto-loads + spins when it scrolls into view,
  gated on WebGL support AND `prefers-reduced-motion: no-preference`. A one-shot
  IntersectionObserver in `mount.ts` keeps the GLB download deferred until the figure is on
  screen. No WebGL or reduced-motion -> the still poster + "View in 3D" button remain (the
  graceful 2D fallback); no other embed (the warlock pet cards) autoplays.
- Respects `prefers-reduced-motion` (no auto-spin, no autoplay); drag + arrow keys still work.
- Pauses rendering while scrolled offscreen (IntersectionObserver).
- No WebGL -> the embed stays on its 2D poster (`data-state="nowebgl"`).
- The canvas carries `role="img"` + a localized `aria-label`; all copy is `guide.viewer.*`
  / `guide.models.*` `t()` keys.
