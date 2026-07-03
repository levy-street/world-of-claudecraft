<!-- src/sim/professions/: professions subsystem contracts (types + stub IWorld
     read-surface). Don't repeat root / src/sim CLAUDE.md, reference them. -->

# src/sim/professions/: professions contracts

Shared skill/craft/recipe/node record shapes for the professions system
(mining, herbalism, alchemy, cooking, ...), settled ahead of content and
mechanics so later issues (#1119, #1120, #1125, #1126, #1140) build against
one contract instead of duplicating it. Content-as-code friendly per
`src/sim/content/` conventions: `ProfessionRecord`/`ProfessionNodeRecord`/
`ProfessionRecipeRecord` are declarative tables a future `src/sim/content/`
module will populate; this directory only defines the shapes, it holds no
game data itself.

## Files
- `types.ts`: `ProfessionRecord`, `ProfessionNodeRecord`, `ProfessionRecipeRecord`,
  `ProfessionReagent`, `ProfessionCraftRecord`, `PlayerProfessionSkill`. Zero
  DOM/browser/Three.js imports, no randomness (guarded by
  `tests/architecture.test.ts`).
- `index.ts`: barrel re-exporting the above. Import from here
  (`from '../sim/professions'`), never reach into `types.ts` directly.

## IWorld facet
The read-surface facet (`IWorldProfessions`) lives at `src/world_api/professions.ts`,
alongside the other 21 facets under `src/world_api/` (see the FACET MAP in
`src/world_api.ts`). It is a stub as of #1164: `professionsState` returns an
empty `PlayerProfessionsView` on both `Sim` and `ClientWorld` until #1119/#1120
land the real mechanics. Extend `IWorldProfessions` first, then implement in
BOTH worlds, per the root CLAUDE.md "IWorld is the only seam" rule.

## Settled contract names (for #1119/#1120/#1125/#1126/#1140)
- Wire/snapshot key: not wired yet (the facet getter is not part of the
  `ALL_DELTA_KEYS` snapshot-delta set). When a future issue wires it, use the
  terse token `prof` for `self.prof` on the WS snapshot, mapped to
  `professionsState` in `TERSE_TO_IWORLD` (see `tests/snapshots.test.ts`).
- Persistence JSONB key: `professions` on the character save row (parallel to
  the existing `delveDaily`/`companionUpgrades` keys persisted in
  `server/db.ts`).
