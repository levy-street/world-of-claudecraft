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
- **Saving is a three-way split, keep the layers apart**: `persist.ts` is the pure
  never-throws (de)serializer plus the local map store (parsing/validation is the
  SHARED sanitizer in `src/sim/map_doc.ts`, the same one the server applies to stored
  documents; one localStorage key per map so saving map B never rewrites map A's
  bytes); `file_io.ts` is the DOM download/pick wrapper kept apart so the serializer
  stays DOM-free; `map_io.ts` orchestrates saves, the per-map autosave draft slots
  (`woc_editor_draft:<id>`, so saving map B can never destroy map A's only autosave),
  and the server link, whose optimistic version is held IN MEMORY per tab and only
  seeded from localStorage on first resolve, so a stale tab gets the server 409
  instead of silently overwriting another tab's save. `save_lifecycle_core.ts` is the
  pure edit-generation compare that keeps a mid-save edit from being marked clean.
- **Bulk inserts clamp at the push site**: every paste/procgen/placement append goes
  through `edit_caps_core.ts` against the document caps in `src/sim/map_doc.ts`, so
  the sanitizer never has to silently truncate a saved document on the next load.
- **Player-uploaded assets resolve from the id alone**: `user_assets.ts` owns the
  `user/<sha256>` scheme; resolution is PURE (a map referencing another player's
  public upload renders with no registry entry), the session registry only labels
  the asset browser's Uploaded tab.
- **The tutorial can never block**: `tutorial.ts` drives the pure `TutorialModel`
  (`tutorial_core.ts`) over real UI anchors; Skip is always available, a
  missing/hidden anchor step is skipped, Esc bails, and a blocked localStorage
  reports "seen" so broken storage never loops the auto-start.

## Where a new editor tool lands (module-first)
Its own sibling module under `src/editor/`: a pure `*_core.ts` decision module
(DOM-free, deterministic; exemplars: `undo_core.ts`, `stamp_core.ts`,
`placement_transform_core.ts`) plus a thin DOM consumer that `app.ts` composes.
Never append tool logic to `app.ts`. Its test goes in `tests/editor_<name>.test.ts`
(enumerate the live suite with `ls tests/editor_*.test.ts`).

## i18n
Editor strings live under the `editor` namespace in `src/ui/i18n.catalog/editor.ts`
(English-only adds, no per-locale blocks); `main.ts` awaits `ensureLocaleLoaded`
before the first localized paint and stamps document language/direction/title.
