# Masterwrought: whole-feature closing QA matrix (phase 17)

- Three-host parity: offline `Sim`, online `ClientWorld`, and the headless env agree on
  every new surface (cap refusals, pattern learning, materials, Perfecting, orange).
  `tests/world_api_parity.test.ts` pins updated alongside every facet addition.
- Determinism: all new randomness through `Rng` at documented draw sites; parity goldens
  green including the new Perfecting scenario; no wall-clock in sim logic (weekly/daily
  gates ride the sim clock seams like raid lockouts do).
- Power (R5, the packet's defining gate): the recorded measurement in
  `power-verification.md` shows the full-kit delta at or under 5 percent vs pre-packet
  raid BiS; heroic raid and S-rift tuning targets unchanged; the apex budget sweep,
  rating pins, and aura-exclusivity pins all green.
- Economy: `tests/recipe_economy.test.ts` green with an EMPTY exception list; every new
  material has a consumer; every pattern's recipe exists and is obtainable; market
  listability matches the binding table in `state.md`.
- Persistence: pre-packet saves load clean (new fields optional with defaults); save/load
  round-trips for ember accrual, daily gates, Perfecting instance state; additive DDL only.
- i18n: every new player string is an English `t()` key in the matching catalog domain;
  sim/server emits have matcher rules (S3 guard green); M16 fills present for wordy keys;
  admin surfaces localized; no em dashes or emojis anywhere in player-facing copy.
- Naming: the phase 03 audit verdicts all resolved; no new name collides with another
  game's coined terms; ids unchanged (`tests/shipped_item_ids.test.ts` append-only green).
- UX: DESIGN.md compliance for every new surface; mobile layouts verified with the
  screenshot scripts; hud perf budget buckets green; graphics-settings fairness holds
  (orange visuals are cosmetic only).
- Deeds: new records appended to the END of `DEEDS`, cosmetic-only, zero Renown on
  luck-gated triggers; catalog pins green; wiki regenerated.
- Build gate: full `npm run gate` green (release-tier); `node scripts/gate_select.mjs`
  green on the final diff; changed-files biome clean.
- PR: template followed, screenshots linked, packet teardown offered and resolved.
