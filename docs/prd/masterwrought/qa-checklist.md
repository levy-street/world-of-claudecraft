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

### Farming arm (amended 2026-08-20)

Phase 11b absorbed `feature/farming-plan` into this packet: one branch, one PR, five
gathering professions and ten crafts shipping as one system. The matrix above stands; it
is farming-blind, so Phase 17 executes the UNION of it and
`docs/prd/masterwrought/farming/qa-checklist.md`. These rows are that union.

**Standing FAIL, and the packet's hardest blocker.** The Economy row above ("every
pattern's recipe exists and is obtainable") is a **FAIL today** and stays one until Phase
11e discharges GATE 1. Three trainer-visible farming recipes are uncompletable because
tier 3 and 4 produce has no first faucet: `highwatch_barley_porridge`,
`evergarden_braised_greens`, and `recipe_harvest_feast`. Two deeds ride the same ruling,
`prog_farming_100` and transitively `feat_book_complete`. Farming's local-only contract
allowed this to sit open; this packet's single-PR contract does not, and "ship dormant,
patch later" is a contract breach, not a ruling. The recommended discharge is the vendor
seed faucet at `farmer_hollis` and `farmer_verbena` in 11e. Do not mark Economy PASS
before that lands.

Rows added to the sections above:

- Three-host parity: the farming facet surface and the `farming_session` parity scenario;
  the pinned member list in `tests/world_api_parity.test.ts` is a UNION whose counts are
  re-derived on the merged tree by prediction (base plus oursDelta plus theirsDelta),
  never pasted. Add farming's own row: offline growth degrades to the documented
  session-local taster without error.
- Determinism: farming's draw-count contract holds (draws at plant, draws at harvest,
  ZERO on denial, expiry, login, and tick); the `farming_session` golden is unmoved from
  the merged value 11d recorded; goldens move ONLY in a deliberate isolated commit with
  the machine classification recorded.
- Power (R5): the kit names the specific food aura, its magnitude, and its delivery by
  feast; the aura-exclusivity row spans `well_fed` and `elixir_<kind>` and asserts
  `wellfed_<kind>` is absent from the tree.
- Economy: see the standing FAIL above. Plus farming's own rows: every stocked farming
  vendor row carries a positive buyValue and crafted outputs carry none; crop produce is
  market-listable and browses under the material filter.
- Persistence: the merged `characters.state` blob carries two writers. Farming's measured
  baseline is about 251 B raw per plot, 3261 B compressed for a fully planted character,
  TOAST past 2 KB, WAL plus 1.5 to 3 KB per 30 s autosave cycle; the Perfecting instance
  fields ride on top of it and the merged bound is stated. The revert direction is
  recorded: an older server reading a both-writers blob.
- i18n: the merged pending set from both packets; farming's `AURA_NAME_KEY` rows and its
  RETIRED_KEYS exclusion in the pending generator; the S3 guard over BOTH emit sets.
- Naming: farming's D17 audit result alongside `naming-audit.md`; the duplicate 'Well Fed'
  display name across two mechanics carries a registry row or one is renamed;
  `tests/shipped_item_ids.test.ts` append-only green over the UNION of both id sets.
- UX: DESIGN.md compliance covers farming's shipped windows, which have never been
  assessed against it (Phase 14 owns that pass); farming's fairness row is imported
  verbatim, "timers and ready notices are actionable and never shed".
- Deeds: the farming block appended whole and contiguous with masterwrought's rows frozen
  in place; the merged `DEED_ART_PENDING` set covered; no dormant deed ships.
- Build gate: green by exit code AND by log marker, a printed FAIL overriding a zero exit;
  farming's environmental exceptions (armory browser red, `druid_engines` contention)
  named rather than silently tolerated.
- PR: two doc trees, two screenshot subtrees with their cone rows and `ci_workflow`
  literals, one teardown decision, and `docs/design/farming-asset-manifest.json`
  preserved.

Rows NEITHER packet has today, added here:

- Well-fed unification: exactly one well-fed system ships and the exclusivity is PINNED,
  not described.
- Monolith ceilings: every ceiling literal either packet touched is re-derived ONCE on the
  merged tree, extraction-first, with Phase 14's `hud.ts` payback landed and the ceiling
  lowered.
- Export and symbol census: 11d's census re-run against the final tip as a delivery gate.
  Every exported symbol, content-table row id, i18n key, and `SimEvent` name present on
  either parent is present in the merged tree unless it is on a written deletion list.
  Without this row a green gate proves the tree is self-consistent, not that it is
  correct.
- Anti-chore audit (imported wholesale from farming's matrix, because nothing here
  protects it): at most two visits per growth cycle, nothing rots, absence is never
  punished, risk is opt-in, and the timer UI is honest.
- Offline-degradation parity and server authority for plant, harvest, knob, and feast.
