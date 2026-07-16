<!-- src/ - client + shared source. The architecture overview, invariants, and
     build commands live in the ROOT CLAUDE.md; this file only adds the
     cross-module dependency rules that span every subdirectory under src/.
     Each subdir has its own CLAUDE.md with stack-specific detail. -->

# src/ - client & shared simulation source

Everything the browser client needs plus the shared game core. Directories with
their own CLAUDE.md: `sim/` (+ `sim/content/`, `sim/professions/`), `render/`
(+ `render/characters/`), `game/`, `ui/`, `styles/`, `net/`, `admin/`, `guide/`
(+ `guide/viewer/`), plus `world_api/` and `editor/` (below). Read the local one
before working in an area.

## Entries (what loads what)
- `index.html` AND `play.html` both load `src/main.ts`. Guard index-only DOM
  lookups with `?.`: `/play` lacks the marketing shell, and an unguarded lookup
  throws there (a bug class that has shipped before).
- `guide.html` loads `src/guide/main.ts`; `editor.html` loads `src/editor/main.ts`;
  `admin.html` is the standalone Svelte admin SPA (`src/admin/`).
- `music_editor.html` is a dev-only tool that writes `src/game/music_overrides.generated.ts`.

## Dependency direction: do not violate
Read "->" as *"is allowed to import from."* Keeping these one-directional is what
lets the same `sim/` run offline, on the server, and headless.

- `sim/` -> nothing else in `src/` **at runtime** (it is the pure, host-agnostic
  core). The one allowed edge is a *type-only* import of a few `world_api` shapes
  (e.g. `AccountCosmetics` in `sim/sim.ts`, `BankInfo` in `sim/bank.ts`); being
  `import type` it is erased at build and adds no runtime dependency.
- `world_api.ts` + the `world_api/` facets -> `sim/` types only; this is the
  `IWorld` seam (purity pinned by the "src/world_api IWorld seam purity
  invariants" suite in `tests/architecture.test.ts`). See `src/world_api/CLAUDE.md`.
- `render/`, `ui/`, `game/` -> **`IWorld`** + their own area; **not** `net/`, **not**
  the server, **not** each other's mutable internals. Two narrow sanctioned exceptions
  to "not `sim/`": (a) `render/` may import **pure, deterministic** sim geometry/data
  helpers so it shares the sim's terrain/movement math instead of re-deriving it
  (exemplars: `sim/world` terrain heights, `sim/player_motion` run by the
  display-only self extrapolator `render/self_motion.ts`, `sim/data`; enumerate the
  live set with `grep -rn "from '.*sim/" src/render`); reaching into mutable `Sim`
  state or `sim/sim.ts` logic stays forbidden. (b) `render`/`game` use `ui/`'s
  i18n + icon surface (`t`, `tEntity`, `ui/icons`).
- `net/` -> `sim/` (types plus **pure display helpers** such as `abilitiesKnownAt`/
  `computeQuestState`; the server re-validates everything) + `world_api.ts`
  (`ClientWorld implements IWorld`).
- `main.ts` -> wires it all together; the only game-client module that knows *both*
  a concrete world (`Sim` or `ClientWorld`) *and* the renderer/HUD. (The dev-only
  editor viewport `src/editor/3d/viewport.ts` also composes Sim + Renderer.)
- `runtime.ts` / `client_origin.ts` -> desktop/native runtime detection (the
  desktop bridge) and the shared asset/REST origin policy; presentation modules
  use `client_origin.ts` instead of importing `net/`. `site_presence.ts` is the
  standalone marketing-page heartbeat.
- `admin/` -> standalone (its own `admin.html` entry); independent of the game client.

## Where a new feature lands (module-first)
When a presentation module needs new data or an action: add the member to the owning
FACET under `src/world_api/<domain>.ts` (never the aggregate `src/world_api.ts`; there
is deliberately no `src/world_api/index.ts`), implement it in **both** the offline
`Sim` and the online `ClientWorld`, and update the pins (`IWORLD_MEMBERS` in
`tests/world_api_parity.test.ts`, plus `COMMAND_FACETS` in
`tests/command_facets.test.ts` when it sends a wire command) in the SAME change; full
recipe in `src/world_api/CLAUDE.md`. Never reach around `IWorld` into a concrete world
from `render/` or `ui/`. The presentation logic itself lands as a pure-core +
thin-consumer sibling module with its own test under `tests/` (reference
`ui/unit_portrait.ts`), never appended to a coordinator. Bug fix: reproduce with a
failing test first, then the smallest change that turns it green.

## i18n across the client tree
`ui/` is the i18n home; the per-subdir CLAUDE.md carries the detail, and the root
i18n invariant holds tree-wide. Two seam facts that live here:

- `world_api.ts` is a **string-free seam** (a pure interface, no `t()`, no literals).
- `main.ts` localizes auth/API/disconnect/moderation text through
  `ui/api_error_i18n.ts` (`userFacingApiError`, which applies `tServer` internally)
  and numbers via `formatNumber`. It also owns the **lazy-locale bootstrap**:
  `await ensureLocaleLoaded(getLanguage())` before any localized paint and
  `await ensureLocaleLoaded(selected)` before `setLanguage(selected)`: only `en`
  is resident synchronously; the other locale overlays load on demand.
