<!-- src/world_api/: the IWorld seam, split into domain facets. The seam's role
     in the architecture lives in ROOT + src/ CLAUDE.md; this file covers the
     facet contract and the add-a-member recipe. -->

# src/world_api/ : the `IWorld` facet files

`IWorld` is one interface per domain facet (`combat.ts`, `inventory.ts`, `quests.ts`,
`bank.ts`, ...; the FACET MAP comment at the top of `src/world_api.ts` names them
all). The aggregate `src/world_api.ts` re-aggregates every facet via `extends` and
re-exports the aux types, so downstream `from '../world_api'` imports never change.

## The contract
- **Every `IWorld` member belongs to exactly ONE facet**; aux types travel with
  their facet. The aggregate and this prose stay count-free: the authoritative
  member list is `IWORLD_MEMBERS` in `tests/world_api_parity.test.ts` (W0c), which
  pins presence + same-kind on both `Sim` and `ClientWorld` and that the aggregate
  equals the disjoint union of the facets. Wire-command facet tags live in
  `COMMAND_FACETS` (`src/world_api.ts`), pinned by `tests/command_facets.test.ts`.
- **Deliberately NO `src/world_api/index.ts`.** The bare specifier `./world_api`
  must keep resolving to the aggregate FILE, never this directory; never create one.
- **String-free, host-free seam:** facets import only TYPES from `sim/`, nothing
  from `render/ui/game/net/server` or Three, no `t()`, no DOM. Enforced by the
  "src/world_api IWorld seam purity invariants" suite in `tests/architecture.test.ts`.
- **`render/` and `ui/` only ever import `IWorld`**, never `Sim` or `ClientWorld`
  concretely.

## Adding a member (all in the SAME change)
1. Add it to the owning facet file (a new facet file only for a genuinely new
  domain: add it to the FACET MAP comment and the `extends` chain in
  `src/world_api.ts`).
2. Implement it in BOTH worlds: the offline `Sim` (`src/sim/`, usually a
  `SimContext` module) and the online `ClientWorld` (`src/net/online.ts`).
3. Update the pins: `IWORLD_MEMBERS` (W0c); if it sends a wire command, also
  `COMMAND_NAMES` (append-only) + `COMMAND_FACETS` and the W0a/W0b gates listed in
  the `src/world_api.ts` header. The wire recipe is in `src/net/CLAUDE.md`.

Behavior tests go beside the implementing world (`tests/`, Vitest); the pin tests
above only guard the seam's shape.
