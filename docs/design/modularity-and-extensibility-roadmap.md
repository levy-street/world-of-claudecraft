# Modularity and Extensibility Roadmap

Status: living architecture proposal for incremental adoption.

Base reviewed: `origin/release/v0.26.0` at commit
`0313a58f657c17bff66dd2d26c113ef6dfc00b4c`.

All source line references in this document are exact for that commit. A reference uses
`path:start-end` plus a symbol whenever possible. Later refactors will move line numbers, so the
symbol is the durable lookup key and the commit is the immutable source snapshot.

Audience: contributors changing the simulation, content, renderer, HUD, client shell,
online protocol, authoritative server, editor, guide, admin dashboard, or headless host.

## 1. Purpose

World of ClaudeCraft already has several strong architectural seams. The deterministic
simulation runs in three hosts, presentation reads through `IWorld`, simulation systems
are moving behind `SimContext`, REST endpoints are moving behind `RouteDef`, and many HUD
components use a pure-core plus thin-painter split.

The remaining problem is inconsistent application of those ideas. Some coordinators still
own multiple independent responsibilities. Some generic systems know concrete dungeon,
delve, raid, or minigame ids. Some interfaces are broad enough to behave like typed service
locators. Some runtime dependencies still point at concrete coordinators instead of narrow
consumer-owned contracts.

This document defines a practical target and an incremental roadmap. It is not permission
for a rewrite. Each implementation slice must preserve behavior, deterministic ordering,
server authority, wire compatibility, persistence compatibility, localization, and visual
fairness.

## 2. Architectural decision

World of ClaudeCraft should remain a modular monolith with ports and adapters.

It should not become a set of microservices, a dynamic plugin platform, or a framework built
around a dependency injection container. The game benefits from one repository, one shared
deterministic domain, static TypeScript composition, and explicit build-time registries.

The target shape is:

```text
content data and domain entities
              |
              v
pure domain policies and use cases
              |
              v
simulation systems through narrow SimContext capabilities
              |
              v
Sim composition root and IWorld facets
              |
       +------+-------+
       |              |
       v              v
offline adapter   server adapter
                      |
                      v
              typed wire contracts
                      |
                      v
                client adapter
                      |
                      v
          render, HUD, game input adapters
```

Dependencies point toward the domain. The domain never imports Three.js, DOM APIs, network
clients, databases, UI code, or host scheduling. Infrastructure and presentation adapt to
domain contracts, never the reverse.

## 3. Non-negotiable constraints

All roadmap work is subordinate to these existing contracts:

- The same `src/sim/` behavior runs offline, on the authoritative server, and headless.
- Simulation time and randomness remain deterministic. Tick phase order, entity iteration,
  event order, and RNG draw order are observable behavior.
- `IWorld` remains the presentation seam. No gameplay outcome moves into the client.
- The server validates every untrusted payload and remains authoritative for combat, loot,
  quests, economy, persistence, and social state.
- Renderer and collider geometry must continue to derive from the same layout data.
- Every visible string remains localized through the established client boundary.
- Persisted ids and JSONB fields remain backward compatible. Schema changes stay additive and
  idempotent.
- Graphics and performance settings remain gameplay-neutral.
- No implementation work sets `ALLOW_DEV_COMMANDS` in production or exposes secrets.

## 4. How the requested principles apply

### 4.1 SOLID

#### Single Responsibility Principle

A module should have one reason to change. A coordinator may coordinate, but it must not also
become the home of independent policies, formatting, protocol parsing, content selection, and
side-effect implementations.

Every multi-thousand-line logic coordinator is a mandatory extraction target:

- `src/sim/sim.ts`
- `src/render/renderer.ts`
- `src/ui/hud.ts`
- `src/main.ts`
- `server/game.ts`
- `server/main.ts`, subject to the dual HTTP pipeline exit criteria
- `src/net/online.ts`
- `src/editor/app.ts`

Large generated localization files and large declarative content tables are not logic
coordinators. They must not be split merely to satisfy a size target. Generated files are
changed through their generators, and cohesive data-as-code remains data-as-code.

Extraction success is measured by ownership and dependency reduction, not by moving lines
into arbitrary helper files.

#### Open Closed Principle

New standard dungeons, delves, render object types, commands, and HUD components should be
added through typed records or registries without editing unrelated generic algorithms.

Open Closed does not mean a universal plugin API. Static exhaustive registries are preferred
because TypeScript can validate them and bundlers can see every dependency.

#### Liskov Substitution Principle

`Sim` and `ClientWorld` must continue to satisfy their declared contracts without surprising
callers. A method that exists but silently does nothing is not behaviorally substitutable unless
the capability is explicitly documented as host-specific.

Parity should therefore be stated per capability:

- Shared gameplay capabilities require equivalent observable behavior.
- Online-only account and social capabilities require an explicit availability contract.
- Offline no-op behavior must be intentional, named, and tested.
- Headless capabilities remain defined by `src/sim/obs.ts`, not by browser or server adapters.

#### Interface Segregation Principle

Composition roots may hold aggregate interfaces. Leaf modules should receive only the facet or
`Pick` they consume.

The same rule applies inside the simulation. `SimContext` remains the one runtime context, but a
system should type its parameter as a narrow capability view. This improves test doubles and
makes dependencies visible without allocating additional wrapper objects.

#### Dependency Inversion Principle

Consumer-owned ports replace imports of concrete coordinators. Examples include:

- A HUD module depending on `HudRenderPort`, not the full `Renderer` class.
- A tutorial depending on a projection port, not `renderer.ts`.
- A server command handler depending on a narrow authoritative world port, not every
  `GameServer` method.
- A simulation system depending on the needed `SimContext` capabilities, not the `Sim` class.
- A persistence service depending on a repository interface, not raw SQL in domain logic.

### 4.2 Clean Architecture and hexagonal architecture

The repository should use the useful parts of Clean Architecture and ports and adapters:

- Entities are stable domain types and value objects under `src/sim/`.
- Use cases are named domain operations such as entering a dungeon, resolving a command,
  applying a loot decision, or saving a character.
- Ports are narrow TypeScript interfaces owned by the consumer.
- Adapters implement ports using Three.js, DOM, WebSocket, Postgres, filesystem, browser APIs,
  or process IO.
- Composition roots create concrete implementations and connect them.

The repository should not mirror textbook folder names mechanically. A use case may remain in a
domain-named module such as `instances/dungeons.ts`. Domain vocabulary is more valuable than a
generic `use_cases/` directory.

### 4.3 Dependency injection and inversion of control

Use constructor arguments, function parameters, and small dependency bags. Keep composition
explicit in `Sim`, `main.ts`, `GameServer`, editor viewport setup, and entry modules.

Do not add:

- A runtime dependency injection container.
- Decorator-based service discovery.
- A global service locator.
- Hidden module singletons for mutable gameplay state.
- Reflection or string-based implementation lookup.

Static inversion of control is sufficient: a composition root chooses implementations, typed
registries choose strategies, and the tick loop controls execution order.

### 4.4 DTOs, mappers, repositories, and services

DTOs are appropriate at real boundaries:

- WebSocket command payloads.
- Snapshot wire records.
- REST request and response envelopes.
- Persisted character state.
- Headless NDJSON requests and replies.

Domain entities must not double as unvalidated transport payloads. Boundary mappers should be
pure where possible and preserve explicit clearing, omission, and compatibility semantics.

Repository interfaces are appropriate for database-backed domain services such as social,
moderation, accounts, mail, and maps. SQL stays in `db.ts` and `*_db.ts`. A repository must
represent a cohesive transactional boundary, not wrap each query in a separate interface.

Domain services own rules that do not naturally belong to one entity. Application services
orchestrate domain operations with repositories and external providers. They must not move
authoritative gameplay out of `Sim`.

### 4.5 Value objects, aggregates, and factories

Use value objects when they validate a recurring domain concept and prevent invalid states, for
example a validated command payload, dungeon instance identity, money amount, or bounded
configuration value.

Use aggregates only around real consistency boundaries. Candidate aggregates include a party,
trade, dungeon instance, market transaction, or character persistence snapshot. Do not create
aggregate classes merely to rename existing records.

Factories are appropriate when construction has invariants, such as entity creation, a dungeon
content bundle, a render view, or normalized protocol state. A factory must centralize real
construction rules, not hide a trivial constructor.

### 4.6 CQRS, events, and event sourcing

CQRS is useful only in its lightweight form:

- Commands request authoritative state changes.
- Queries and snapshots expose read models.
- Command validation and query projection remain separate.

Do not introduce separate services, databases, or deployment units for CQRS.

`SimEvent` is already a domain event stream at the simulation boundary. Typed events are useful
when a completed domain fact must be observed by multiple adapters. Direct calls remain clearer
for synchronous rules whose ordering is load-bearing.

Do not introduce a generic event bus for all internal calls. Do not adopt event sourcing. Current
character JSONB and domain tables remain the persistence model.

## 5. Clean Code policy

The following practices are required for new code and extractions:

- Small methods with one named responsibility.
- Descriptive domain names.
- Guard clauses and early returns to reduce nesting.
- Pure functions for calculations, selection, normalization, and mapping.
- Explicit inputs instead of hidden global state.
- Immutable boundary values where practical.
- Composition over inheritance.
- Minimal public APIs, with implementation details unexported.
- Named constants beside their owning policy instead of magic numbers.
- Fail-fast validation at process and protocol boundaries.
- Defensive validation of all client and persistence input.
- Explicit behavior instead of implicit coordinate, string, or import-order conventions.
- Tests that assert decisions and outcomes, not implementation trivia.

DRY, KISS, and YAGNI must be balanced:

- Remove duplication when a third copy exists or one block has a single nameable responsibility.
- Do not merge similar code whose invariants or lifecycles differ.
- Do not create an abstraction for a hypothetical second implementation.
- Do not preserve duplication that can already drift across a real boundary.

Comments should explain invariants, ordering, compatibility, security, or non-obvious tradeoffs.
Comments that restate the code should be removed during the owning extraction.

Avoid boolean parameters when two booleans represent different modes or permit invalid
combinations. Prefer a discriminated option or separate named operation. A boolean remains fine
for a genuinely binary property whose call site is obvious.

## 6. Current architecture assessment

### 6.1 Strong foundations to preserve

- `src/sim/` is deterministic and host-agnostic.
- `SimContext` already enables module-first simulation systems.
- `src/world_api/` already splits `IWorld` into domain facets.
- `tests/parity/` protects state, events, and shared RNG draw order.
- HUD and renderer pure-core allowlists provide an enforceable extraction pattern.
- `server/http/` provides a typed request pipeline and route registry.
- `server/social.ts` demonstrates useful database and transport ports.
- `src/guide/` uses route and page registries without loading the live world.
- `src/admin/` is intentionally isolated as its own Svelte application.
- `src/editor/3d/viewport.ts` is a legitimate composition root over the real `Sim` and
  `Renderer`.
- `headless/protocol.ts` keeps transport validation separate from simulation behavior.

These should be reused, not replaced by a new architecture framework.

### 6.2 Critical dependency leak: active world content

`SimConfig.world` selects spawn content, while terrain, water, roads, and collision read the
mutable module-level world returned by `getActiveWorldContent()` in `src/sim/data.ts`.
`zoneAt` also reads the builtin zone table directly.

This is hidden global state inside the domain. Two `Sim` instances with different worlds cannot
be safely interleaved. Correctness depends on external setup order, and the editor has to mutate
global content before constructing the simulation and renderer.

Target:

- Bind a `WorldGeometryPort` or equivalent immutable world bundle to each `Sim`.
- Pass that dependency to terrain, water, collision, safe-spawn, and zone resolution kernels.
- Keep builtin convenience wrappers for renderer and legacy callers during migration.
- Remove runtime dependence on `setActiveWorldContent` from simulation behavior.
- Preserve the shared terrain formula used by rendering and collision.

Acceptance:

- Two interleaved simulations with different maps never affect each other.
- Builtin terrain and spawn parity remain byte-identical.
- Custom map parity remains green.
- Renderer and collider samples still agree.

### 6.3 `SimContext` is broad

`SimContextPrimitives` and `SimContextCallbacks` correctly invert dependencies away from `Sim`,
but every system can see every capability. Tests often cast a partial fake to the full context.
This hides dependencies and makes test setup expensive.

Target:

- Retain one composed `SimContext` runtime object.
- Define per-system capability interfaces with `Pick` or small extending interfaces.
- Make each system function accept only its capability view.
- Keep state owned by the `Sim` instance.
- Preserve direct imports of pure leaves where they are clearer than callbacks.

This is interface segregation without runtime wrappers or allocation.

### 6.4 Dungeon ownership is fragmented

Dungeon content and policy currently span:

- `src/sim/content/dungeons.ts`
- `src/sim/content/temple.ts`
- `src/sim/content/dungeon_difficulty.ts`
- `src/sim/dungeon_layout.ts`
- `src/sim/colliders.ts`
- `src/sim/instances/dungeons.ts`
- `src/render/dungeon.ts`
- `src/render/renderer.ts`
- dungeon music and localized entity catalogs

This distribution is not itself wrong because dependencies must remain layered. The problem is
that adding a dungeon requires editing unrelated switches and duplicate registries, while generic
code recognizes concrete ids.

Examples:

- `DungeonInteriors.variantFor` distinguishes Hollow Crypt from Sunken Bastion using an instance
  origin coordinate.
- `DungeonInteriors.buildInterior` and its placement methods branch on concrete visual variants.
- `Renderer.updateAmbience` selects dungeon-specific fog and lighting.
- `door_portal.ts` recognizes a concrete raid approach id.
- `instances/dungeons.ts` contains raid and visit policies tied to concrete ids.
- Generic mob locomotion and combat code contain Nythraxis and Drowned Litany exceptions.

Target:

```text
src/sim/content/dungeons/
  index.ts
  hollow_crypt.ts
  sunken_bastion.ts
  gravewyrm_sanctum.ts
  drowned_temple.ts
  nythraxis.ts

src/sim/instances/
  dungeon_registry.ts
  dungeons.ts
  nythraxis_instance.ts

src/render/dungeons/
  index.ts
  registry.ts
  shared_kit.ts
  hollow_crypt.ts
  sunken_bastion.ts
  gravewyrm_sanctum.ts
  drowned_temple.ts
  nythraxis.ts
```

These are aligned modules in separate layers, not one cross-layer feature directory. The sim
must never import render code.

Each standard dungeon content bundle should expose cohesive declarative data such as definition,
mob templates, spawns, and optional tuning references. Shared quests and persisted items remain in
their natural content domains when moving them would reduce cohesion or threaten stable ids.

A typed layout registry should be the single catalog from which collider and renderer layout
selection derive. Hollow Crypt and Sunken Bastion may continue to share the `crypt` geometry while
using different visual profiles.

A render profile keyed by dungeon id should select visual strategy, palette, dressing, portal,
fog, lighting, and music metadata explicitly. No profile may be inferred from coordinates.

Scripted encounters receive dedicated adapters only when they have real custom behavior.
Standard data-driven dungeons do not need classes or empty hook implementations.

Acceptance:

- Every dungeon definition resolves a layout and render profile exhaustively.
- A missing registration fails a test or typecheck instead of falling back silently.
- Hollow Crypt and Sunken Bastion resolve different presentation without coordinate inspection.
- Renderer and collider layout registries cannot drift.
- Standard dungeon addition does not require editing generic placement or ambience switches.
- Raid attunement, lockouts, nested approach behavior, corpse runs, and heroic behavior remain
  unchanged.

### 6.5 Delve and encounter scripts leak into generic systems

`src/sim/delves/runs.ts` imports Drowned Litany modules directly and branches on its id.
`src/sim/mob/locomotion.ts` recognizes encounter-specific templates and reset behavior.
`src/sim/mob_combat.ts` selects concrete encounter profiles by template id.

There is enough repeated evidence for a static typed script registry, but not for a dynamic
plugin system.

Target:

- A `DelveScript` registry with only proven lifecycle hooks.
- An encounter policy registry for concrete boss behavior that generic locomotion actually needs.
- Data-driven combat profiles where a profile is configuration rather than a scripted mechanic.
- Dedicated modules for scripted encounters.
- Explicit registration order when hooks can affect RNG or events.

Do not turn every mob or standard dungeon into a strategy object.

### 6.6 Remaining simulation coordinator work

`Sim` should retain world ownership, the fixed tick schedule, IWorld facade delegates, and shared
entry points required by multiple systems. Independent policies still embedded in it must move.

High-value extractions include:

- `updateBossMechanics` into `mob/mechanics.ts`.
- Shared mob mechanic state initialization and reset into one pure helper used by creation,
  evade reset, and respawn.
- Remaining world boss bodies into the existing `world_boss.ts` owner.
- Fishing lifecycle into a dedicated system module.
- Forced movement policies into focused modules where their ordering can be pinned.
- Domain state types imported from `sim.ts` into their owning system type modules, with compatible
  re-exports during migration.

No extraction may change tick phase order or regenerate parity goldens to conceal drift.

### 6.7 Renderer responsibilities

`Renderer` legitimately owns scene graph state, camera, and frame coordination. It should not
also remain the catalog of every feature.

Target extractions:

- `instance_environment_core.ts` for pure environment selection.
- `instance_scene_controller.ts` for lazy interior construction and disposal.
- A registered object-view factory with explicit precedence, fallback, and disposal contracts.
- Feature-owned effects controllers for Vale Cup, Fiesta, Yumi, and delves when their lifecycle is
  already cohesive.
- A diagnostics subsystem that reads renderer state through a narrow port.
- Pure decision cores for view creation priority and environment transitions.

`Renderer.sync` remains the ordered frame coordinator. Scene graph state should not be scattered
into unrelated singletons.

### 6.8 HUD responsibilities

`Hud` already composes many extracted windows and painters, but several large feature slices still
live inline.

Mandatory extraction candidates include:

- Delve board and shop.
- Fiesta HUD lifecycle.
- Quest dialog and gossip flow.
- Loot and master-loot windows.
- Chat tab and chat-window controller.
- Action-bar persistence and form selection.
- Skin event presentation.
- Player card flow.
- Remaining event routing by domain.
- Dungeon and encounter music selection.

Each component follows the existing pure view-core plus thin painter pattern. `Hud` keeps only
cross-window coordination, focus ownership, shared write-elision, and the ordered `update` and
`handleEvents` entry points.

### 6.9 Client composition and input

`src/main.ts` is the composition root, but it also contains independent shell controllers and
gameplay-adjacent policies.

Target extractions:

- Account portal controller.
- Character selection controller.
- Wallet, Discord, GitHub, recovery email, and desktop login controllers.
- Landing page and homepage audio controller.
- Loading and world-entry controller.
- A shared game action router for keyboard, gamepad, and mobile edge actions.
- An interaction target core shared by click picking and interaction-key selection.
- A per-session click-move controller.

`startGame` should assemble the session and drive the frame loop. It should not contain reusable
selection, navigation, or account workflow policy.

### 6.10 Presentation ports

Several UI and game modules import concrete frontend coordinators. Replace these with narrow
consumer-owned contracts:

- HUD rendering actions through `HudRenderPort`.
- Tutorial projection through a projection interface.
- Performance sampling through a metrics provider.
- Nameplate painting through a minimal renderable-view shape.
- Steam and account UI through small API contracts injected by `main.ts`.

These ports do not belong on `IWorld` because they are presentation or account capabilities, not
world behavior.

### 6.11 `IWorld` facets need real consumption

The facet split under `src/world_api/` is structurally sound, but many leaf consumers still accept
the aggregate `IWorld`.

Target:

- Composition roots may keep `IWorld`.
- Windows, painters, input helpers, and services accept their owning facet or a named intersection.
- Capability availability differences between offline and online hosts are documented and tested.
- Host-specific account or network services do not expand `IWorld`.

### 6.12 Protocol and online client

The command vocabulary is shared, but payload schemas are still assembled from open records and
validated in the server dispatch switch. Snapshot field shapes are duplicated between server
encoding and client decoding.

Target:

- Discriminated command DTO types grouped by domain facet.
- Exhaustive classification of gameplay commands, control messages, and server-only commands.
- Pure per-facet payload parsers that still accept `unknown` at the trust boundary.
- Server-side snapshot encoders and client-side snapshot decoders over shared neutral wire shapes.
- No shared codec that mixes server authority with client interpolation or mirror state.
- One end-to-end contract test that feeds the real server encoder into the real client decoder.

`ClientWorld` should remain the socket and mirror composition root. REST `Api`, transport
lifecycle, snapshot decoding, event adaptation, and command creation should become cohesive
sibling modules.

### 6.13 Authoritative server

`server/game.ts` is the highest-risk coordinator because it combines loop scheduling, sessions,
commands, snapshots, events, chat, persistence triggers, moderation integration, and live ops.

Extraction order:

1. Pure command payload parsers and normalizers by facet.
2. Per-facet command handlers with narrow ports and explicit player identity.
3. Snapshot projection and encoding modules.
4. Event routing and chat policy modules.
5. Session lifecycle and linkdead coordination.
6. Autosave and persistence orchestration.
7. Live-ops adapters.

`GameServer` remains the composition root over the authoritative `Sim`. It must not be hidden
behind a giant `GameServerDeps` interface.

The existing `docs/refactor/world-api-to-server-runtime-handoff.md` is historical evidence. New
work must use the current anchors and execution order recorded in this document, then refresh an
anchor in the PR that moves its symbol.

### 6.14 HTTP migration and server main

The dual legacy and `RouteDef` paths are an intentional migration state. Do not refactor the
legacy ladder independently or delete it before the documented exit criteria are met.

Near-term work should finish route migration and parity. Only then should `server/main.ts` and
large route modules be reduced further. Every interim behavior change remains a dual edit.

### 6.15 Persistence and database boundaries

`server/db.ts` can eventually separate account, character, world-state, lease, and play-session
repositories behind a compatibility facade.

Do not split transactional invariants:

- Character and market save atomicity where currently required.
- Character lease nonce fencing.
- Schema advisory-lock ordering.
- Backfill order.
- Save queue ordering.
- JSONB backward compatibility.

Repository extraction follows transaction boundaries, not table names alone.

### 6.16 Headless, editor, guide, and admin

Headless:

- Extract bounded episode configuration normalization.
- Extract pure reward, termination, and truncation decisions.
- Keep actions and observations owned by `src/sim/obs.ts`.

Editor:

- Extract controllers per tool and a document/save session from `src/editor/app.ts`.
- Keep `src/editor/3d/viewport.ts` as the explicit composition root.
- Prioritize removal of global active-world state before supporting simultaneous editor worlds.

Guide:

- Preserve route and page registries and the lazy Three.js viewer boundary.
- Do not reuse the full game renderer pipeline in the public guide bundle.

Admin:

- Preserve bundle isolation and server-side authorization.
- Continue extracting reusable Svelte components and pure view models inside `src/admin/` only.

## 7. Pattern applicability matrix

### Adopt now

- Adapter and Facade for stable external and coordinator boundaries.
- Strategy through static typed registries where multiple real policies already exist.
- Command for validated authoritative operations.
- State for explicit encounter, session, and UI lifecycles.
- Chain of Responsibility for the existing HTTP middleware pipeline.
- Factory Method or simple factory functions for invariant-heavy construction.
- Builder only for genuinely complex immutable DTO or render plans.
- Flyweight for shared immutable materials, geometry, textures, and icon recipes.
- Memento for editor undo snapshots.
- Iterator through standard iterable contracts where it improves traversal without allocation.

### Use conditionally

- Observer or domain events when multiple independent adapters consume a completed fact.
- Composite for scene graph or UI tree structures that are already hierarchical.
- Decorator for orthogonal adapter behavior such as metrics, validation, or caching.
- Proxy for remote or cached infrastructure where identity and failure semantics stay explicit.
- Bridge when two independently varying axes already exist.
- Mediator for a cohesive subsystem whose participants otherwise form cycles.
- Visitor only for a stable closed union with many independent operations.
- Template Method only when an invariant algorithm skeleton is proven across implementations.
- Abstract Factory only when related implementation families must be swapped together.
- Prototype only for explicit cloneable immutable templates.

### Avoid as a default

- Mutable Singleton. Existing unavoidable process services must expose explicit lifecycle and
  never own per-world gameplay state.
- Generic service locator.
- Dynamic plugin discovery.
- Repository per table or per query.
- Event bus for synchronous game rules.
- CQRS infrastructure with separate stores.
- Event sourcing.
- Microservices.
- Inheritance hierarchies for dungeons, mobs, windows, or render features.

## 8. Incremental implementation roadmap

Each item is a separate reviewable PR unless its acceptance tests require an inseparable pair.

### Phase A: architecture characterization

1. Add a multi-world isolation test demonstrating the active-world coupling.
2. Add dungeon registry completeness and renderer-to-collider layout parity tests.
3. Add protocol payload and command classification characterization.
4. Add narrow-context compile-time fixtures that do not cast partial fakes to full contexts.
5. Record current renderer environment and interaction priorities in pure decision tests.

This phase adds evidence before moving behavior.

### Phase B: remove hidden world state

1. Introduce a per-simulation world geometry capability.
2. Thread it through terrain, water, collision, zone resolution, and safe placement.
3. Adapt renderer and editor composition explicitly.
4. Retire simulation dependence on the global active world.

Parity goldens must remain unchanged for builtin content.

### Phase C: dungeon vertical slice

1. Create the typed layout registry.
2. Create the render profile registry keyed by dungeon id.
3. Remove `DungeonInteriors.variantFor` coordinate inference.
4. Move one standard dungeon into an aligned content and render module.
5. Move the remaining standard dungeons without changing shared layout reuse.
6. Extract Nythraxis instance policy and scripted encounter adapters.
7. Add authoring validation covering content, layout, render, deeds, localization, and guide data.

### Phase D: segregate internal and external interfaces

1. Introduce narrow capability views over `SimContext` for newly touched systems.
2. Convert existing system fakes away from full-context casts.
3. Type leaf presentation consumers against `IWorld` facets.
4. Introduce consumer-owned presentation ports and remove direct coordinator imports.
5. Add architecture guards that prevent the removed dependency edges from returning.

### Phase E: reduce simulation coordinator logic

1. Extract boss mechanics and shared reset policy.
2. Complete world boss ownership.
3. Extract fishing.
4. Extract forced movement policies one at a time.
5. Re-home domain state types with compatibility re-exports.

Every slice is a move with direct module tests and unchanged golden traces.

### Phase F: reduce renderer and HUD coordinators

1. Extract instance environment selection and scene lifecycle.
2. Extract the object-view factory.
3. Extract feature effects controllers.
4. Extract the remaining HUD windows and controllers listed above.
5. Split event routing by domain without changing order.

Visual slices require desktop and mobile before and after evidence.

### Phase G: reduce main and online coordinators

1. Extract shell and account controllers.
2. Unify edge-action routing across input devices.
3. Extract interaction selection and click-move control.
4. Split REST API, socket lifecycle, snapshot decoding, and command creation from `online.ts`.

### Phase H: authoritative server runtime

Follow the extraction order in the server assessment. Preserve field validation, jail policy,
dev-command gates, async session revalidation, bandwidth budgets, and snapshot delta semantics.

### Phase I: conditional infrastructure work

Proceed only after the earlier seams are stable:

- Remove the legacy HTTP ladder after its exit criteria are met.
- Split database repositories along transaction boundaries.
- Refine headless episode framing.
- Extract editor tool and save controllers.

## 9. Execution plan with exact source anchors

### 9.1 Reference inventory

These are the current logic coordinators that must lose independent responsibilities. The counts
are evidence for prioritization, not a target metric. A file is complete when its responsibilities
and dependencies are coherent, even if the composition root remains substantial.

| Current file | Exact size at the reviewed commit | Required end state |
| --- | ---: | --- |
| `src/ui/hud.ts` | 15,690 lines | Cross-window composition, focus ownership, ordered update and event entry points only. |
| `src/main.ts` | 8,540 lines | Browser composition root, session assembly, frame loop, and boot only. |
| `src/sim/sim.ts` | 8,252 lines | Deterministic state owner, tick schedule, context binding, and facade delegates only. |
| `server/game.ts` | 5,987 lines | Authoritative runtime composition, tick ownership, and stable public host facade only. |
| `src/render/renderer.ts` | 5,837 lines | Scene, camera, ordered frame coordination, and render subsystem composition only. |
| `src/net/online.ts` | 3,292 lines | Compatibility facade over REST, socket, mirror, codec, and command adapters. |
| `server/db.ts` | 3,357 lines | Compatibility facade and schema composition over domain repositories. |
| `server/main.ts` | 2,825 lines | Process boot, transport composition, shutdown, and temporary legacy dispatch only. |
| `src/editor/app.ts` | 2,569 lines | Editor composition, document session, and cross-tool coordination only. |

Generated localization outputs, generated status files, and declarative content catalogs are
excluded from the size rule. They are split only when their generator or domain ownership
requires it.

### 9.2 Execution rules

1. Execute the work packages below in dependency order. Packages marked parallel may proceed only
   when they do not edit the same coordinator.
2. The first commit of an extraction PR adds or strengthens characterization tests. The next
   commit moves one responsibility. The final commit adds architecture guards and deletes the old
   path.
3. A compatibility facade or re-export may exist for one migration wave. Its removal is an
   explicit exit item, not an open-ended deprecation.
4. No PR combines a behavior change with a physical extraction unless the behavior change has its
   own acceptance tests and is called out in the PR title and body.
5. Every PR updates this section when an anchor moves or a work package closes.
6. Line numbers are never used by implementation code. They are review coordinates for the fixed
   base commit only.

### 9.3 Wave 0: characterization and dependency guards

#### MOD-00: pin hidden world state and dungeon selection

Current evidence:

- Global world selection and builtin-only zone lookup: `src/sim/data.ts:346-380`, symbols
  `activeWorldContent`, `getActiveWorldContent`, `setActiveWorldContent`, and `zoneAt`.
- `Sim` construction mixes `cfg.world` with the global fallback: `src/sim/sim.ts:1422-1503` and
  player spawn repeats that choice at `src/sim/sim.ts:1846-1846`.
- Terrain and water resolve the global world: `src/sim/world.ts:29-168`, especially
  `terrainEditIndex` at `src/sim/world.ts:103-103`.
- Collider caches and fences resolve the global world: `src/sim/colliders.ts:89-108`,
  `src/sim/colliders.ts:321-340`, and `src/sim/colliders.ts:433-499`.
- Coordinate-based dungeon presentation inference is explicit at
  `src/render/dungeon.ts:904-914`, symbol `DungeonInteriors.variantFor`.

Write:

- Add `tests/multi_world_isolation.test.ts` with two differently configured `Sim` instances whose
  terrain, water, zones, collision, and safe spawn are sampled in alternating order.
- Add registry characterization to `tests/dungeons.test.ts` and `tests/delve_render.test.ts` for
  every current dungeon id, interior, layout, and visual variant.
- Add a forbidden-edge guard to `tests/architecture.test.ts` for new imports of
  `setActiveWorldContent` from simulation systems.

Exit: the new tests must fail against a deliberately global implementation or a missing dungeon
registration. This package changes no production behavior.

#### MOD-01: pin protocol and presentation decisions

Current evidence:

- Shared command names and facets: `src/world_api.ts:399-424` and
  `src/world_api.ts:433-636`.
- Client command envelope creation: `src/net/online.ts:1531-1553`.
- Server command interpretation: `server/game.ts:3453-4635`, especially
  `messageCommand`, `dispatchMessage`, and its exhaustive switch.
- Server snapshot projection: `server/game.ts:4639-5027`, especially
  `broadcastSnapshots`, `wireCacheFor`, and `selfWireJson`.
- Client snapshot decoding: `src/net/online.ts:1555-1702` and
  `src/net/online.ts:1715-2216`, symbols `onMessage` and `applySnapshot`.
- Renderer view priority and creation: `src/render/renderer.ts:2048-2146` and
  `src/render/renderer.ts:3334-3675`.
- Instance environment choice: `src/render/renderer.ts:3803-4080`.

Write:

- Extend `tests/command_schema.test.ts`, `tests/command_facets.test.ts`, and
  `tests/snapshots.test.ts` with real command DTO and server-encoder-to-client-decoder round trips.
- Add `tests/render_view_selection.test.ts` and `tests/instance_environment.test.ts` as pure
  decision tests before moving Three.js side effects.

Exit: unknown commands, omitted-vs-cleared fields, view precedence, and every current environment
transition have decisive assertions.

### 9.4 Wave 1: deterministic domain boundaries

#### MOD-02: bind world geometry per simulation

Depends on: MOD-00.

Modify current anchors:

- `src/sim/data.ts:346-380` for the temporary compatibility wrapper.
- `src/sim/world.ts:29-168` and `src/sim/world.ts:237-758` for water, terrain edits, biome,
  height, steepness, roads, and decoration selection.
- `src/sim/colliders.ts:89-108`, `src/sim/colliders.ts:321-340`, and
  `src/sim/colliders.ts:433-679` for content-keyed caches and collision queries.
- `src/sim/sim.ts:1287-1295`, `src/sim/sim.ts:1422-1503`,
  `src/sim/sim.ts:1846-1846`, and `src/sim/sim.ts:2954-2985` for ownership and safe position
  delegates.
- `src/editor/app.ts:383-403` and `src/editor/3d/viewport.ts:143-166` for explicit editor
  composition.
- Renderer-only global reads at `src/render/props.ts:673-1278` and
  `src/render/world_audio.ts:10-50`.

Create:

- `src/sim/world_geometry.ts` with immutable `WorldGeometry`, pure query functions, and the
  smallest capability type needed by consumers.
- `src/render/world_content_adapter.ts` only if renderer construction cannot consume
  `WorldContent` directly without widening the domain port.

Tests: `tests/multi_world_isolation.test.ts`, custom-map parity, `tests/world_audio.test.ts`,
`tests/editor_placements_alignment.test.ts`, and all `tests/parity/` scenarios.

Exit: `Sim` behavior never calls `getActiveWorldContent`; two interleaved worlds are isolated;
renderer and collider heights still agree; the compatibility wrapper has presentation-only
callers with an architecture allowlist.

#### MOD-03: segregate `SimContext` capabilities

May run after MOD-02 interfaces settle.

Current evidence:

- Broad primitive bag: `src/sim/sim_context.ts:64-214`, symbol `SimContextPrimitives`.
- Broad callback bag: `src/sim/sim_context.ts:215-748`, symbol `SimContextCallbacks`.
- Aggregate context aliases: `src/sim/sim_context.ts:749-754`.
- Runtime binding: `src/sim/sim.ts:3003-3564`, symbol `Sim.buildSimContext`.
- Unsafe partial fakes exist at `tests/chat.test.ts:1029-1029`,
  `tests/delves_runs.test.ts:95-139`, `tests/trade.test.ts:59-59`, and
  `tests/targeting.test.ts:58-58`.

Create `src/sim/context/` capability modules by proven domain, starting with dungeon, delve,
combat, inventory, party, and targeting views. Keep `SimContext` as their runtime intersection.

Tests: convert one domain at a time to exact typed fakes. Add a compile-time fixture to
`tests/sim_context.test.ts` proving that the system cannot access capabilities outside its view.

Exit: touched systems accept named narrow views, no new `as unknown as SimContext` appears, and
`buildSimContext` remains the only aggregate binding point.

### 9.5 Wave 2: dungeon and encounter modules

#### MOD-04: create exhaustive dungeon contracts and aligned registries

Depends on: MOD-00. May run in parallel with MOD-03 after shared types are agreed.

Current evidence:

- Standard definitions and Nythraxis approach/arena: `src/sim/content/dungeons.ts:1-770`, with
  concrete Nythraxis records at `src/sim/content/dungeons.ts:711-770`.
- Drowned Temple content: `src/sim/content/temple.ts:1-759`.
- Difficulty registry: `src/sim/content/dungeon_difficulty.ts:1-102`.
- Layout types and collider derivation: `src/sim/dungeon_layout.ts:1-247`, especially
  `layoutColliders` at `src/sim/dungeon_layout.ts:217-247`.
- Duplicate presentation variants and palettes: `src/render/dungeon.ts:61-123`.

Create:

- `src/sim/content/dungeons/index.ts` and one content module per dungeon.
- `src/sim/instances/dungeon_registry.ts` for exhaustive id-to-layout and id-to-instance-policy
  metadata.
- `src/render/dungeons/registry.ts`, `shared_kit.ts`, and one render-profile module per dungeon.

Tests: compile-time registry exhaustiveness, `layoutColliders` parity, stable ids, and a test that
fails when content has no layout or render profile.

Exit: one typed dungeon id set drives all completeness checks. No generic fallback silently
accepts an unregistered dungeon.

#### MOD-05: remove dungeon knowledge from generic rendering

Depends on: MOD-04.

Modify:

- `DungeonInteriors.buildInterior` at `src/render/dungeon.ts:661-767`.
- `DungeonInteriors.variantFor` at `src/render/dungeon.ts:904-914`, then delete it.
- Variant-sensitive placement at `src/render/dungeon.ts:1170-1949`.
- Lazy build and ambience switching at `src/render/renderer.ts:3803-4080`.
- Nythraxis door specialization at `src/render/door_portal.ts:54-160`.

Create `src/render/dungeons/profile.ts`, feature render modules, and
`src/render/instance_environment_core.ts`. Profiles explicitly carry palette, dressing,
portal, fog, light, music key, layout id, and strategy id. They never inspect an origin to infer
content identity.

Tests: `tests/delve_render.test.ts`, `tests/map_dungeon_portals.test.ts`, the MOD-01 environment
tests, plus desktop and mobile screenshots for each visual profile.

Exit: adding a standard dungeon modifies its content module and registrations only. Hollow Crypt
and Sunken Bastion choose different profiles with the same layout and no coordinate inspection.

#### MOD-06: isolate raid instance policy

Depends on: MOD-04.

Current evidence:

- Raid allow/require sets and entry rules: `src/sim/instances/dungeons.ts:42-188`.
- Corpse-run, visit, seal, nested approach, and backtracking policy:
  `src/sim/instances/dungeons.ts:260-372`.
- Raid occupancy semantics: `src/sim/instances/dungeons.ts:587-603`.
- Nythraxis control embedded in locomotion: `src/sim/mob/locomotion.ts:185-220`.
- Nythraxis combat profile selection: `src/sim/mob_combat.ts:52-70`.

Create `src/sim/instances/nythraxis_instance.ts` and keep generic slot allocation in
`src/sim/instances/dungeons.ts`. Move encounter-specific locomotion and combat decisions behind
static encounter policy records owned under `src/sim/encounters/`.

Tests: `tests/dungeons.test.ts`, `tests/dungeon_door_softlock_1894.test.ts`,
`tests/raid_lockout_world.test.ts`, Nythraxis suites, and dungeon parity goldens.

Exit: generic instance allocation and mob locomotion contain no Nythraxis ids; attunement,
lockout, sealing, corpse run, heroic mode, and RNG/event order remain unchanged.

#### MOD-07: introduce a proven delve script registry

Depends on: MOD-03.

Current evidence:

- Direct Drowned Litany imports: `src/sim/delves/runs.ts:47-88`.
- Baptistry and finale branches: `src/sim/delves/runs.ts:490-544`.
- Drowned Litany rite completion branch: `src/sim/delves/runs.ts:664-708`.
- Marks special case: `src/sim/delves/runs.ts:759-759`.
- Drowned Litany reset imported into generic locomotion:
  `src/sim/mob/locomotion.ts:33-33` and its reset call sites in that file.

Create `src/sim/delves/script.ts`, `src/sim/delves/script_registry.ts`, and
`src/sim/delves/drowned_litany_script.ts`. Only lifecycle hooks already required by these anchors
enter the contract.

Tests: existing delve run, lockpick, rite, reward, reset, and parity suites. Add an explicit hook
order test when two hooks can emit events or draw RNG.

Exit: `runs.ts` has no Drowned Litany imports or id branches. A standard delve supplies no empty
strategy object.

### 9.6 Wave 3: reduce the simulation coordinator

#### MOD-08: finish world boss ownership

Depends on: MOD-03.

Move `Sim.updateWorldBosses` and `Sim.spawnWorldBoss` from `src/sim/sim.ts:1752-1813` into the
existing `src/sim/world_boss.ts` owner. Keep only thin context-bound scheduling delegates in
`Sim`. Preserve the state fields at `src/sim/sim.ts:1416-1420` until their owner can be moved
without changing serialization or tick order.

Tests: `tests/world_boss.test.ts`, `tests/world_boss_cc.test.ts`, focused RNG draw assertions, and
parity. Exit: `tick` calls one world-boss system entry at the same phase currently anchored at
`src/sim/sim.ts:3754-3917`, with identical draws and events.

#### MOD-09: extract boss mechanics and shared reset state

Depends on: MOD-03 and MOD-06.

Current evidence:

- Generic boss mechanic body: `src/sim/sim.ts:5324-5645`, symbol
  `Sim.updateBossMechanics`.
- Nythraxis reset and add spawning: `src/sim/sim.ts:5646-5736`.
- Mob update and evade reset: `src/sim/sim.ts:5055-5098`.
- Context callbacks bind those private methods at `src/sim/sim.ts:3398-3398`.

Create `src/sim/mob/mechanics.ts` and a pure `src/sim/mob/mechanic_state.ts` used by creation,
evade, death, and respawn. Nythraxis remains in its encounter module.

Tests: boss-specific suites plus a new create-reset-respawn equivalence test that compares every
mechanic field and event ordering.

Exit: `sim.ts` owns no boss-specific mechanic body and duplicate state-reset lists are gone.

#### MOD-10: extract fishing and forced movement separately

Depends on: MOD-02 and MOD-03. Implement as two PRs if their tests do not share a seam.

Current evidence:

- Charge path and forced movement: `src/sim/sim.ts:4101-4159`.
- Follow movement: `src/sim/sim.ts:4166-4224`.
- Knockback policy: `src/sim/sim.ts:4518-4573`.
- Fishing location, start, and completion: `src/sim/sim.ts:5965-6069`.

Create `src/sim/movement/charge.ts`, `src/sim/movement/knockback.ts`, and
`src/sim/professions/fishing.ts`. Do not combine unrelated movement policies behind one large
service.

Tests: movement, collision, fishing distribution, zone selection, deeds, and parity. Pin exact RNG
draw counts for catches and exact phase placement for forced movement.

Exit: `sim.ts` delegates these use cases; no `Math.random`, host clock, or reordered draw enters
the domain.

### 9.7 Wave 4: renderer and HUD decomposition

#### MOD-11: extract renderer environment and scene lifecycle

Depends on: MOD-05.

Move lazy interior construction and disposal from `src/render/renderer.ts:3803-3896`, pure
environment choice from `src/render/renderer.ts:3897-4080`, and keep `Renderer.sync` at
`src/render/renderer.ts:4205-5130` as the ordered coordinator.

Create `src/render/instance_scene_controller.ts` and use the MOD-05
`instance_environment_core.ts`. Inject the dungeon registry and scene operations explicitly.

Tests: MOD-01 environment tests, `tests/delve_render.test.ts`, disposal idempotence, and visual
screenshots. Exit: `Renderer.updateAmbience` is removed; environment selection is pure; scene
mutation stays in one controller.

#### MOD-12: extract view creation and diagnostics

May run after MOD-11.

Current evidence:

- Diagnostics calculation: `src/render/renderer.ts:1722-2014`.
- Candidate priority and budget: `src/render/renderer.ts:2048-2146`.
- Pool decisions: `src/render/renderer.ts:2238-2308`.
- Concrete object-view factory: `src/render/renderer.ts:3334-3675`.

Create `src/render/view_factory.ts`, `view_selection_core.ts`, and
`render_diagnostics.ts`. Define explicit factory precedence, fallback, ownership, and disposal.

Tests: `tests/render_budget.test.ts`, `tests/render_asset_fallback.test.ts`,
`tests/electron_diagnostics.test.ts`, and exact precedence/disposal tests.

Exit: a new render object registers one factory; diagnostics consume a narrow renderer-state port;
`Renderer` no longer contains the concrete type catalog.

#### MOD-13: move cohesive render effects to feature owners

May run after MOD-12.

Move Vale Cup effects at `src/render/renderer.ts:3114-3206`, Fiesta effects at
`src/render/renderer.ts:3212-3319`, and their event routing at
`src/render/renderer.ts:2926-3113` into feature controllers. Preserve `handleEvent` as a small
ordered dispatcher if event order is observable.

Tests: `tests/vale_cup_render.test.ts`, `tests/fiesta.test.ts`, render budgets, cleanup, and visual
evidence. Exit: feature effect state and disposal are owned by feature modules, not Renderer.

#### MOD-14: extract HUD chat and action-bar controllers

This package may run in parallel with renderer work because it has a different coordinator.

Current evidence:

- Chat geometry and tabs: `src/ui/hud.ts:2451-3213`.
- Action-bar form, persistence, and casting policy: `src/ui/hud.ts:5109-6524`.
- Chat event presentation and localization: `src/ui/hud.ts:10267-10889`.

Create `src/ui/chat_window_controller.ts` and `src/ui/action_bar_controller.ts`, reusing existing
pure cores and painters. Storage and DOM remain adapters injected into the controllers.

Tests: chat tab/window/input suites, action-bar view/painter/loadout suites, i18n guards, and
mobile browser tests.

Exit: `Hud` coordinates open/focus/update only; it does not own chat geometry or action-bar
persistence algorithms.

#### MOD-15: extract HUD delve and Fiesta slices

Current evidence:

- Delve board, shop, lockpick, rite, and tracker: `src/ui/hud.ts:7819-8320`.
- Fiesta lifecycle and rendering: `src/ui/hud.ts:10949-11233`.

Create `src/ui/delve_window.ts` and `src/ui/fiesta_hud.ts` with pure view-model siblings. Split the
lockpick window only if its independent lifecycle remains cohesive after the first move.

Tests: delve UI, lockpick sync, Fiesta module and HUD view tests, desktop/mobile screenshots.

Exit: each slice owns setup, update, event handling, teardown, and localization. `Hud` exposes a
minimal facade for callers.

#### MOD-16: extract HUD quest and loot slices

Current evidence:

- Gossip and quest dialog: `src/ui/hud.ts:11234-11608`.
- Loot roll and master-loot flow: `src/ui/hud.ts:11609-11970`.
- Corpse loot and vendor flow: `src/ui/hud.ts:11971-12173`.

Create `src/ui/quest_dialog.ts`, `src/ui/loot_roll_window.ts`, and keep vendor separate unless a
shared inventory boundary is proven.

Tests: quest dialog/link/progress suites, loot roll/master/FFA suites, i18n, and mobile heroic loot
browser tests.

Exit: event order, focus restoration, timeout rendering, and server-authoritative actions remain
unchanged; `Hud.handleEvents` delegates by domain.

#### MOD-17: extract HUD cosmetics, player card, and music policy

Current evidence:

- Dungeon and encounter music decision block: `src/ui/hud.ts:7450-7501`.
- Skin event state and rendering: `src/ui/hud.ts:12739-13271`.
- Player card flow: `src/ui/hud.ts:13272-13631`.

Create `src/game/instance_music.ts`, `src/ui/skin_event_window.ts`, and
`src/ui/player_card_window.ts`. Music consumes the explicit dungeon render/domain profile key,
not concrete ids in HUD.

Tests: `tests/music.test.ts`, `tests/skin_event.test.ts`, player-card suites, localization, and
visual evidence. Exit: no dungeon-specific music switch remains in HUD.

### 9.8 Wave 5: presentation ports and client composition

#### MOD-18: consume `IWorld` facets and introduce presentation ports

May start once MOD-03 establishes the interface-segregation convention.

Current evidence:

- Aggregate `IWorld` declaration: `src/world_api.ts:189-229`.
- Renderer stores the aggregate: `src/render/renderer.ts:1035-1045`.
- HUD stores the aggregate: `src/ui/hud.ts:1468-1490`.
- Leaf consumers still using `IWorld`: `src/ui/bank_window.ts:143-143`,
  `src/ui/bags_window.ts:114-114`, `src/ui/market_window.ts:72-72`,
  `src/ui/mailbox_window.ts:53-53`, `src/render/nameplate_painter.ts:59-75`, and
  `src/ui/minimap_markers.ts:104-127`.
- Tutorial imports the concrete Renderer in `src/ui/tutorial.ts:19-19` and accepts it at
  `src/ui/tutorial.ts:109-109` and `src/ui/tutorial.ts:337-337`.

Modify leaf consumers one domain at a time to accept existing facets from `src/world_api/` or a
named intersection. Create consumer-owned `HudRenderPort`, `ProjectionPort`, and diagnostics port
only where the concrete coordinator edge exists today.

Tests: `tests/world_api_parity.test.ts`, component unit tests with exact fakes, and architecture
guards forbidding restored concrete imports.

Exit: composition roots may use aggregate `IWorld`; leaf modules cannot. Presentation ports do
not expand `IWorld`.

#### MOD-19: extract account and shell controllers from `main.ts`

Current evidence:

- Loading and world entry: `src/main.ts:743-859`.
- `startGame` mixes composition and session policy: `src/main.ts:860-3087`.
- Account portal: `src/main.ts:3625-4063`.
- Character directory, selection, deletion, and entry: `src/main.ts:4064-4616`.
- Homepage music: `src/main.ts:5352-5426` and `src/main.ts:8467-8507`.
- Wallet flow: `src/main.ts:5427-5950` and `src/main.ts:6619-6829`.
- Discord, GitHub, and recovery email: `src/main.ts:5950-6585`.
- Landing backdrop and start screens: `src/main.ts:6834-8466`.

Create controllers under `src/shell/` for account portal, character selection, external accounts,
landing, and world entry. Inject `Api`, storage, navigation, and DOM elements through small ports.

Tests: existing account, character, wallet, Discord, GitHub, recovery, landing, and localization
suites. Add controller tests without booting the game.

Exit: `main.ts` composes controllers and reacts to their typed outcomes. It contains no account
workflow state machine or provider-specific UI policy.

#### MOD-20: unify gameplay action routing and click movement

Depends on: MOD-18. May follow MOD-19 or proceed as a separate non-overlapping PR.

Current evidence:

- Keyboard action gate and dispatch inside `startGame`: `src/main.ts:1176-1301`.
- Mobile action mapping: `src/main.ts:1302-1335`.
- Gamepad action mapping: `src/main.ts:1353-1437`.
- Click target selection and path start: `src/main.ts:2110-2301`.
- Click-move state, reroute, and movement resolution: `src/main.ts:2302-2645`.

Create `src/game/action_router.ts`, `src/game/interaction_target.ts`, and a per-session
`src/game/click_move_controller.ts`. Use discriminated actions instead of boolean mode parameters.

Tests: `tests/interaction.test.ts`, `tests/interactions.test.ts`, `tests/click_move.test.ts`, input
device parity, latency, rooted/stunned, and mobile browser tests.

Exit: keyboard, gamepad, and mobile edges enter one action contract; click and interaction-key
selection share one pure target policy; state is session-local.

### 9.9 Wave 6: online boundary and authoritative server

#### MOD-21: split REST, socket lifecycle, mirror decoding, and command DTOs

Depends on: MOD-01 and MOD-18.

Current evidence:

- REST `Api`: `src/net/online.ts:242-1079`.
- `ClientWorld` construction and socket lifecycle: `src/net/online.ts:1080-1554`.
- Message and snapshot decoding: `src/net/online.ts:1555-2216`.
- Command send methods: `src/net/online.ts:2217-3292`.

Create `src/net/api.ts`, `socket_transport.ts`, `snapshot_decoder.ts`, `command_dtos.ts`, and
facet command adapters. Keep `ClientWorld` as a compatibility facade and mirror composition root.

Tests: command schema/facets, snapshots, online reconnect/visibility, all online facet tests, and
the real server encoder-to-decoder contract from MOD-01.

Exit: transport payloads enter as `unknown`, pure parsers produce validated DTOs, command creation
is exhaustive, and `ClientWorld` contains no giant decode or command-construction bodies.

#### MOD-22: extract authoritative command parsing and handlers

Depends on: MOD-01 and MOD-21 DTO contracts.

Current evidence:

- Trust-boundary parsing and dispatch: `server/game.ts:3453-4635`.
- The command switch begins at `server/game.ts:3585-3585` and spans gameplay, social, economy,
  dungeon, delve, and dev commands through `server/game.ts:4627-4634`.

Create `server/game/commands/` modules by existing world facet. Each contains a pure parser and a
handler that accepts player identity plus a narrow authoritative port. Keep jail, scope,
rate-limit, and dev-command gates before mutation.

Tests: command schema/facets, per-facet parser tables, invalid payloads, authority checks, jail
policy, `ALLOW_DEV_COMMANDS` denial, and server-to-sim integration.

Exit: `GameServer.dispatchMessage` classifies and delegates only; every command is exhaustively
owned once; no handler accepts the full `GameServer` when a narrow port suffices.

#### MOD-23: extract snapshot projection and event routing

Depends on: MOD-21. Can start in parallel with MOD-22 if file ownership is coordinated.

Current evidence:

- Snapshot broadcast and interest logic: `server/game.ts:4639-4824`.
- Self projection and delta semantics: `server/game.ts:4831-5027`.
- Party, marker, trade, and duel projections: `server/game.ts:5028-5103`.
- Activity detection and event routing: `server/game.ts:5126-5480`.
- Chat routing and policy: `server/game.ts:5480-5933`.

Create `server/game/snapshot_projector.ts`, `snapshot_encoder.ts`, `event_router.ts`, and
`chat_policy.ts`. Keep interest iteration and bandwidth budgets explicit. Do not introduce a
generic event bus.

Tests: `tests/snapshots.test.ts`, `tests/bandwidth.test.ts`, loot wire, chat, social, event order,
omission/clearing, and encoder-to-decoder integration.

Exit: snapshot shapes have one neutral contract, encoder and decoder are paired but host policy is
not shared, and `GameServer` delegates projection and routing.

#### MOD-24: extract session lifecycle and persistence orchestration

Depends on: MOD-22 and MOD-23 stable ports.

Current evidence:

- Loop and timers: `server/game.ts:1634-1822`.
- Join and resume: `server/game.ts:2334-2644`.
- Socket close, linkdead grace, leave, and lease release: `server/game.ts:2645-2810`.
- Character and aggregate saves: `server/game.ts:2811-2961`.
- Live operations and admin state: `server/game.ts:2985-3452`.

Create `server/game/session_manager.ts`, `persistence_coordinator.ts`, and focused live-ops
adapters. Keep `GameServer` as the explicit composition root and public facade.

Tests: session replacement, resume/linkdead, lease nonce fencing, save queue ordering, atomic
character/market saves, shutdown, moderation, and tick performance suites.

Exit: session cleanup is idempotent; async results revalidate the live session; save ordering and
transactions are unchanged; timers have explicit lifecycle ownership.

### 9.10 Wave 7: conditional infrastructure and tools

#### MOD-25: delete the legacy HTTP ladder only after its own exit gate

This package is blocked until all criteria at `docs/api-pipeline/state.md:1127-1217` are satisfied.

Current evidence:

- Legacy route ladder occupies `server/main.ts:879-2163`.
- Runtime injection and dispatcher composition occupy `server/main.ts:2164-2488`.
- Top-level prefix dispatch is `server/main.ts:2489-2560`.
- HTTP server construction and boot are `server/main.ts:2675-2825`.

When unblocked, delete legacy arms rather than extract them. Retain `RouteDef` modules,
`server/http/`, top-level security/CORS behavior, process boot, WS upgrade, and shutdown
composition.

Tests: the API pipeline completeness and dual-mode corpus must first prove the exit criteria. The
deletion PR then replaces dual-path parity with one-path endpoint, security, error-envelope, and
method tests.

Exit: `API_DISPATCH=legacy` and every legacy delegate are gone; no endpoint, auth guard, limiter,
security header, or envelope behavior is lost.

#### MOD-26: split database repositories by transaction boundary

May begin only after server application ports are stable. Do not move schema or transactional
code merely to reduce line count.

Current evidence:

- Schema composition and advisory-lock migration: `server/db.ts:84-944`, especially
  `ensureSchema` at `server/db.ts:848-944`.
- Account and token operations: `server/db.ts:1012-1784`.
- Character queries and mutations: `server/db.ts:2245-2534`.
- Atomic character/market save: `server/db.ts:2535-2578`.
- World-state persistence: `server/db.ts:3036-3050`.
- Play sessions: `server/db.ts:3143-3175`.
- Character leases: `server/db.ts:3217-3265`.

Create account, character, world-state, play-session, and lease repositories in sibling `*_db.ts`
modules. Keep `server/db.ts` as an import-compatible facade during migration and preserve
transaction boundaries that span domains.

Tests: live or fake Postgres transaction tests, migration idempotence, JSONB normalization,
atomic save rollback, lease fencing, schema lock ordering, and back-compat fixtures.

Exit: raw SQL remains in adapters; application services use cohesive repository ports; no
repository-per-query interfaces; compatibility re-exports have a scheduled deletion package.

#### MOD-27: extract editor tool controllers and document session

Depends on: MOD-02 for explicit per-world ownership.

Current evidence:

- Document and active-world composition: `src/editor/app.ts:122-436`.
- Tool selection and gesture dispatch: `src/editor/app.ts:514-717`.
- Terrain and paint tools: `src/editor/app.ts:730-958`.
- Blocker, placement, camp, spawn, region, scatter, and hills tools:
  `src/editor/app.ts:959-1679`.
- Undo and dirty state: `src/editor/app.ts:1680-1718`.
- Save, open, import, export, autosave, and document replacement:
  `src/editor/app.ts:1719-2055`.
- Input routing and 2D view composition: `src/editor/app.ts:2056-2569`.

Create `src/editor/document_session.ts` and controllers grouped by real tool state and gesture
lifecycle. Keep `src/editor/3d/viewport.ts:143-804` as the explicit 3D composition adapter.

Tests: editor undo, save lifecycle, drafts, persistence, edit caps, placement transform, blocker,
procgen, and editor view suites. Add a simultaneous-document isolation test.

Exit: `EditorApp` composes tools and document state; each tool owns begin/move/end, undo command
creation, and refresh intent; autosave never serializes a partial gesture.

#### MOD-28: separate headless episode framing

May run independently because it does not change sim behavior.

Current evidence:

- Configuration and defaults: `headless/env_server.ts:17-55`.
- `Env.reset`: `headless/env_server.ts:57-81`.
- Step, reward, termination, and truncation: `headless/env_server.ts:82-128`.
- NDJSON command boundary: `headless/env_server.ts:154-205`.

Create `headless/episode.ts` for pure config normalization and reward/termination decisions. Keep
`headless/env_server.ts` as the NDJSON adapter and `headless/protocol.ts:1-14` as the framing
utility. Actions and observations remain in `src/sim/obs.ts`.

Tests: extend `tests/env_protocol.test.ts` with invalid nested config, deterministic reward deltas,
termination vs truncation, line limit, and all-class shape parity.

Exit: transport and episode policy are separate; reset plus action sequence remains byte
reproducible for a fixed seed.

### 9.11 Program completion criteria

The roadmap is complete when all non-conditional packages are closed and:

- No multi-thousand-line logic coordinator retains an independent feature implementation listed
  in its package anchors.
- The mandatory coordinators have an explicit allowlist of composition responsibilities enforced
  in `tests/architecture.test.ts`.
- Standard dungeon, delve, UI window, render object, command, and repository additions each have a
  documented module path and compile-time or test-enforced registration point.
- Domain code has no framework, DOM, Three.js, transport, database, process, or host-clock import.
- Every compatibility facade and re-export has either been removed or has a named follow-up
  package with a concrete exit condition.
- Cross-host parity, server authority, persistence compatibility, localization, security, and
  visual fairness gates remain green.

## 10. Testing strategy

### Unit tests

Use direct tests for pure policies, parsers, registries, mappers, view models, value objects, and
state transitions. Prefer fakes with exact narrow interfaces. Use mocks and spies only when the
interaction itself is the contract.

Use Arrange, Act, Assert structure when it improves readability. Do not add comments merely to
label those three blocks.

### Integration tests

Required integration boundaries include:

- Simulation system through its real context binding.
- Dungeon content through instance creation and collision.
- Server command parser through authoritative dispatch.
- Snapshot encoder through client decoder.
- Repository through transaction and normalization boundaries.
- Editor world content through real simulation and renderer composition.

### End-to-end tests

Use E2E coverage for user journeys that depend on browser layout, input routing, network flow, or
visual lifecycle. Keep domain correctness in faster unit and integration suites.

### Test doubles

- Fake: preferred for repositories, clocks, transports, and narrow world ports.
- Stub: appropriate for one-way input or fixed decisions.
- Spy: appropriate when call order or exactly-once behavior is the requirement.
- Mock: use sparingly for a strict interaction protocol.

### TDD and extraction discipline

For defects, reproduce first. For extraction, characterize first. Then move the smallest cohesive
unit and keep behavior identical.

The following gates are load-bearing:

- `tests/architecture.test.ts`
- `tests/localization_fixes.test.ts`
- `tests/parity/`
- `tests/world_api_parity.test.ts`
- `tests/command_schema.test.ts`
- `tests/command_facets.test.ts`
- `tests/snapshots.test.ts`
- `tests/bandwidth.test.ts`
- domain-specific dungeon, delve, renderer, HUD, server, persistence, and editor suites
- `npx tsc --noEmit`
- `npm run gate`

A refactor does not regenerate parity goldens unless the PR deliberately changes behavior and is
reviewed as a behavior change.

## 11. Quality attributes and acceptance criteria

### Readability and maintainability

- A contributor can locate a rule by domain name.
- A module header states non-obvious invariants, not an inventory likely to drift.
- Public exports form a small intentional API.
- Tests identify the owning module directly.

### Extensibility

- A standard dungeon is added through aligned typed registrations, not unrelated switches.
- A new HUD window is composed without adding a method cluster to `Hud`.
- A new server command has one typed payload, one authoritative parser, one domain handler, and
  pinned encode/decode behavior where applicable.
- A new scripted encounter does not modify generic mob locomotion unless it adds a genuinely new
  generic capability.

### Testability

- Leaf tests construct narrow fakes without unsafe casts.
- Pure decisions run without DOM, Three.js, sockets, or Postgres.
- Cross-host behavior is tested by capability rather than assumed from method presence.

### Cohesion and coupling

- Feature policy stays with the owning feature module.
- Shared infrastructure contains no concrete content ids unless the mapping is its declared job.
- Cross-layer imports follow the dependency direction.
- No mutable per-world state lives in a module singleton.

### Robustness and fault tolerance

- Invalid external input fails before domain mutation.
- Async server work revalidates session and authority before applying results.
- Snapshot omission and clearing semantics remain explicit.
- Persistence normalization accepts previous save shapes.
- Cleanup and disposal are idempotent.

### Observability

- Metrics wrap stable boundaries and use bounded labels.
- Diagnostic collection does not alter simulation or rendering decisions.
- Errors preserve stable codes at API boundaries.
- Logs contain no secrets or unbounded player-controlled values.

### Simplicity

- Every abstraction names an existing responsibility or repeated variation.
- Static composition is preferred over runtime indirection.
- A smaller interface is preferred over an additional framework.
- Existing good seams are extended before a new seam is introduced.

## 12. Definition of done for each refactor PR

A refactor slice is complete only when:

- The old owner has less responsibility, not just fewer physical lines.
- The new module has a narrow dependency surface and minimal exports.
- Behavior-pinning tests existed before the move or were added first.
- Determinism and RNG draw order remain unchanged where behavior is unchanged.
- Offline, online, and headless implications were assessed.
- Server authority and validation remain intact.
- Persistence and localization implications were assessed.
- Architecture guards prevent the removed coupling from returning when practical.
- Typecheck, focused suites, guard suites, parity, and the repository gate pass.
- The PR documents remaining risk and any intentionally deferred extraction.

## 13. Final guidance

The goal is not maximum abstraction. The goal is explicit ownership, stable dependency direction,
small public contracts, deterministic behavior, and low-cost extension.

The repository should become easier to extend because generic systems stop knowing concrete
features, coordinators stop owning independent policies, and adapters depend on narrow domain
ports. It should remain easy to understand because composition stays static, behavior stays close
to domain vocabulary, and every abstraction must justify itself with current code and decisive
tests.
