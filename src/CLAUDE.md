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

- `sim/` → nothing else in `src/` (it is the pure, host-agnostic core).
- `world_api.ts` → `sim/` types only — it defines the `IWorld` seam.
- `render/`, `ui/`, `game/` → **`IWorld`** + their own area. **Not** `sim/`
  internals, **not** `net/`, **not** the server, **not** each other's internals.
- `net/` → `sim/` types + `world_api.ts` (`ClientWorld implements IWorld`).
- `main.ts` → wires it all together; the only module that knows *both* a concrete
  world (`Sim` or `ClientWorld`) *and* the renderer/HUD.
- `admin/` → standalone (its own `admin.html` entry); independent of the game client.

## When a presentation module needs new data or an action
Add it to **`IWorld` (`world_api.ts`) first**, then implement it in *both* the
offline `Sim` (`sim/sim.ts`) and the online `ClientWorld` (`net/online.ts`).
Never reach around `IWorld` into a concrete world from `render/` or `ui/`.
