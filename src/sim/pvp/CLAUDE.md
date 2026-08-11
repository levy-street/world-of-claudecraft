# src/sim/pvp - WARFARE progression and rating rules

Host-agnostic PvP progression: the honor currency, the combat ratings, and the
honor-vendor spawn. WARFARE is the player-facing umbrella name; internal `pvp*`
identifiers stay as descriptive compatibility names for the two mechanical
ratings.

- `honor.ts` owns currency grants, reward constants, UTC-day rollover, and the
  anti-farm diminishing returns. It must use `SimContext` state and the
  HOST-provided UTC day, never a wall clock.
- `power.ts` owns rating conversion, the independent offense/defense caps, and
  the hostile-player damage multiplier. It must stay pure and deterministic.
- `warfare_quartermaster.ts` spawns Warmarshal Draven Kole, the Highwatch
  WARFARE honor vendor, under his RESERVED entity id
  (`WARFARE_QUARTERMASTER_ENTITY_ID`, `1_000_000_002`, the singleton band
  beside `VALE_CUP_BRAM_ID` and `FURY_ENTITY_ID`). His `NpcDef` lives in
  `content/zone3.ts` with `dynamic: true` so the generic world-init NPC loop
  skips him: creating him in table order would shift the entity id of every
  NPC, camp mob, and ground object created after him and red the parity
  goldens. The `Sim` ctor spawns him after the rng-drawing camp loop through
  the same rng-free `findSafePos` path the generic loop uses, so neither
  `nextId` nor the shared rng stream moves
  (`tests/warfare_vendor_npc.test.ts` asserts both). His stock is the one
  canonical `content/pvp_honor.ts` table, shared with FURY.
- Import the directory's public API through `src/sim/pvp/index.ts`, with ONE
  deliberate exception: `warfare_quartermaster.ts` is NOT re-exported there
  (see the comment in `index.ts`). It needs `createNpc` from `../entity` at
  runtime while `entity.ts` imports this barrel, so re-exporting it would
  close a value-level ESM cycle. Its single consumer is the Sim coordinator at
  world init; import it by path.
- Keep reward amounts and rating curves named and covered in
  `docs/design/warfare.md`.
- Cover changes in `tests/honor.test.ts` and `tests/pvp_honor_gear.test.ts`,
  including host parity, PvE non-interference, cap behavior, and exact reward
  accounting.
