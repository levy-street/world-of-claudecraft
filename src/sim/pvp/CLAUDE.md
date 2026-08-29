# src/sim/pvp - WARFARE progression and rating rules

Host-agnostic PvP progression: the honor currency, the combat ratings, and the
honor-vendor spawn. WARFARE is the player-facing umbrella name; internal `pvp*`
identifiers stay as descriptive compatibility names for the two mechanical
ratings.

- `honor.ts` owns currency grants, reward constants, UTC-day rollover, and the
  anti-farm diminishing returns. It must use `SimContext` state and the
  HOST-provided UTC day, never a wall clock.
- `honor_event.ts` owns the weekly Double Honor Weekend: the window decision
  (pure weekday arithmetic, no `Date`, on TWO host-provided keys: `resetDay`
  plus the `eventLeadDay` probe read `DOUBLE_HONOR_LEAD_HOURS` ahead of now,
  open when either reads a weekend day, so the window runs Friday 3 PM to
  Monday 3 AM realm time) and the event multiplier the four BATTLEGROUND
  award paths in `honor.ts` apply (result, kill, assist, first-win bonus;
  arena and Fiesta honor never read it, per the issue's 5v5-only scope).
  During the window a played-out loss or draw also pays the WIN base (the
  weekend loss boost in `awardBattlegroundHonor`). The event stays off only
  when BOTH keys are empty (no host calendar): a host feeds both keys or
  neither, never just one.
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
