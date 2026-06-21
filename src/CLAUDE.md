<!-- src/ — client + shared source. The architecture overview, invariants, and
     build commands live in the ROOT CLAUDE.md; this file only adds the
     cross-module dependency rules that span every subdirectory under src/.
     Each subdir has its own CLAUDE.md with stack-specific detail. -->

# src/ — client & shared simulation source

Everything the browser client needs plus the shared game core. Subdirectories
each have their own CLAUDE.md: `sim/` (+ `sim/content/`), `render/`
(+ `render/characters/`, `render/assets/`), `game/`, `ui/`, `net/`, `admin/`.

## Dependency direction — do not violate
Read "→" as *"is allowed to import from."* Keeping these one-directional is what
lets the same `sim/` run offline, on the server, and headless.

- `sim/` → nothing else in `src/` **at runtime** (it is the pure, host-agnostic
  core). The one allowed edge is a *type-only* import of a few `world_api.ts` shapes
  (e.g. `AccountCosmetics`, `LeaderboardEntry`) in `sim/sim.ts`; being `import type`
  it is erased at build and adds no runtime dependency.
- `world_api.ts` → `sim/` types only — it defines the `IWorld` seam.
- `render/`, `ui/`, `game/` → **`IWorld`** + their own area; **not** `net/`, **not**
  the server, **not** each other's mutable internals. Two narrow sanctioned exceptions
  to "not `sim/`": (a) `render/` imports the **pure, deterministic** geometry/data
  helpers from `sim/` (`sim/world`'s `terrainHeight`/`groundHeight`/`WATER_LEVEL`/
  `zoneBiomeAt`, plus `sim/data`/`sim/colliders`) so it *shares* the sim's terrain
  math instead of re-deriving it (reaching into mutable `Sim` state or `sim/sim.ts`
  logic stays forbidden); (b) `render`/`game` use `ui/`'s i18n + icon surface (`t`,
  `tEntity`, `ui/icons`).
- `net/` → `sim/` types + `world_api.ts` (`ClientWorld implements IWorld`).
- `main.ts` → wires it all together; the only module that knows *both* a concrete
  world (`Sim` or `ClientWorld`) *and* the renderer/HUD.
- `admin/` → standalone (its own `admin.html` entry); independent of the game client.

## When a presentation module needs new data or an action
Add it to **`IWorld` (`world_api.ts`) first**, then implement it in *both* the
offline `Sim` (`sim/sim.ts`) and the online `ClientWorld` (`net/online.ts`).
Never reach around `IWorld` into a concrete world from `render/` or `ui/`.
When the presentation logic itself grows, prefer the pure-core + thin-consumer split
(root Conventions; reference `ui/unit_portrait.ts`) over expanding a big single-file
module.

## i18n across the client tree
Every player-visible string in this tree resolves through `t()` (and the format
helpers `formatNumber`/`formatDateTime`/`formatMoney`/`tPlural`) from `ui/i18n.ts`,
or — for `sim/`/`server`-emitted English — through the client matchers
`ui/sim_i18n.ts` / `ui/server_i18n.ts`. `ui/` is the i18n home; the per-subdir
CLAUDE.md carries the detail.

- `world_api.ts` is a **string-free seam** (a pure interface — no `t()`, no literals).
- `main.ts` renders auth/error text via `t()`, disconnect/moderation reasons via
  `tServer()`, and numbers via `formatNumber`. It also owns the **lazy-locale
  bootstrap**: `await ensureLocaleLoaded(getLanguage())` before any localized paint
  and `await ensureLocaleLoaded(selected)` before `setLanguage(selected)` — only `en`
  is resident synchronously; the other 13 overlays load on demand.
