<!-- src/editor/: the map-editor SPA. Root + src/ CLAUDE.md carry the shared
     rules; this file covers the editor's own seams. -->

# src/editor/ : the map editor (`editor.html`, served at `/editor`)

A standalone entry (`editor.html` loads `src/editor/main.ts`) that reuses the real
engine: `app.ts` is the thin coordinator (layout, tool state, undo stack, event
routing); everything with a nameable responsibility is a sibling module (topbar,
toolbar, inspector, asset_browser, map_drawer, map_io, net, toasts, the 3D
viewport, the 2D canvas/view/model trio).

## Seams
- **`3d/viewport.ts` composes the REAL `Sim` + `Renderer`** over the working
  document: the app builds ONE `WorldContent` whose tables share references with
  the document and registers it via `setActiveWorldContent` (`sim/data`), so every
  terrain sample reads the live edits. Editing never mutates the imported builtin
  content (`main.ts` deep-clones it).
- **`net.ts` is the editor's ONLY fetch surface** (maps + uploaded-asset REST; the
  wire contract is documented at its head). Auth reuses the game's stored bearer
  session (`woc_session`); with no token the editor runs fully offline. Server
  error codes are stable snake_case, mapped to `t()` keys by `server_errors_core.ts`.
- **`playtest.ts` hands off to the game**: it stashes a `WorldContent` in
  sessionStorage (`EDITOR_PLAYTEST_KEY` from `src/game/editor_playtest.ts`) and
  navigates; the game boots OFFLINE into it. Playtest never talks to the server.

## Where a new editor tool lands (module-first)
Its own sibling module under `src/editor/`: a pure `*_core.ts` decision module
(DOM-free, deterministic; exemplars: `undo_core.ts`, `stamp_core.ts`,
`placement_transform_core.ts`) plus a thin DOM consumer that `app.ts` composes.
Never append tool logic to `app.ts`. Its test goes in `tests/editor_<name>.test.ts`
(enumerate the live suite with `ls tests/editor_*.test.ts`). Bug fix: reproduce
with a failing test first (extract the buried logic into a core if needed), then
the smallest change that turns it green.

## i18n
Editor strings live under the `editor` namespace in `src/ui/i18n.catalog/editor.ts`
(English-only adds, no per-locale blocks); `main.ts` awaits `ensureLocaleLoaded`
before the first localized paint and stamps document language/direction/title.
