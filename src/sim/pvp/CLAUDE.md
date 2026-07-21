# PvP system

This directory owns host-agnostic PvP progression and combat-rating rules.

- Import its public API through `src/sim/pvp/index.ts`, not through leaf modules.
- `honor.ts` owns currency grants, reward constants, UTC rollover, and anti-farm
  diminishing returns. It must use `SimContext` state and the host-provided UTC day.
- `power.ts` owns WARFARE rating conversion, independent caps, and the hostile
  player damage multiplier. It must stay pure and deterministic.
- WARFARE is the player-facing umbrella name. Internal `pvp*` identifiers remain
  descriptive compatibility names for the two mechanical ratings.
- Keep reward amounts and rating curves named and covered in `docs/design/warfare.md`.
- Cover changes in `tests/honor.test.ts` and `tests/pvp_honor_gear.test.ts`, including
  host parity, PvE non-interference, cap behavior, and exact reward accounting.
