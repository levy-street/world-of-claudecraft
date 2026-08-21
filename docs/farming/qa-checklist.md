# Farming: whole-feature integration QA matrix

Verified once, at packet completion (Phase 13 QA), on top of the per-phase QA passes.
Every row gets a verdict with evidence (a test run, a probe transcript, or a
screenshot), never "looks done."

## The anti-chore audit (farming-specific; the design's load-bearing promise)

- Two visits per cycle: no code path requires or rewards a third visit between plant
  and harvest. No mid-growth interaction exists.
- Nothing rots: a fully grown crop waits indefinitely; a late harvest yields exactly
  what an on-time harvest would. No decay, no wither, no daily reset touches farming.
- Absence is never punished: logging out never worsens any farming outcome; growth
  continues on the wall clock; the login notice fires for finished crops.
- Risk is opt-in: survival below 100 percent only ever occurs at-band without full
  insurance; one band above the crop tier is always safe; failure yields husks.
- The timer UI exists and is honest: the Harvest Journal shows every plot, stage,
  remaining time, and applied knobs; map pins mark patch sites; ready states surface
  as banners while online and at login.

## Three-host parity

- The offline browser Sim, the online ClientWorld mirror, and the headless env agree
  on every farming read and command surface (IWorld facet implemented in BOTH worlds;
  parity pins updated; the farming_session parity scenario green).
- Offline growth degrades to session-local (the documented taster) without error.

## Determinism

- Same seed, same world: the farming draw-count contract (draws at plant, draws at
  harvest, zero on denial, zero at expiry/login/tick) is stated and pinned.
- No Math.random, Date.now, or performance.now anywhere in src/sim/; wall clock only
  via ctx.lockoutNowMs; tests/architecture.test.ts green.
- Parity goldens regenerated only in deliberate, isolated commits (the Phase 1 field
  add, the Phase 3 scenario addition, the Phase 5 seed-back re-record, the Phase 9
  NPC add, the Phase 10 rare-event re-record), never hand-edited.

## i18n completeness

- Every player-visible farming string is a t() key in English in the matching
  src/ui/i18n.catalog/ module; locale overlays untouched except M16 fills; aura names
  have AURA_NAME_KEY rows; sim/server emits are id-carrying events or have matcher
  rules; tests/localization_fixes.test.ts green; numbers and times go through
  formatNumber/formatDateTime/the t() clock tokens.

## Economy and fidelity

- No invented balance numbers presented as classic formulas; farming's own constants
  are flagged as tuning proposals in PR bodies.
- recipe_economy invariant green (nothing vendors above its cheapest achievable
  inputs); work-order payout arithmetic green; every new material has a consumer (the
  wolf_fang rule); EVERY stocked farming vendor row (seeds, compost, hoes, the
  starter fee vegetable brook_carrot) carries positive buyValue (no dead rows);
  crafted outputs carry none.
- Crop produce is market-listable and browses under the material filter; tier 3/4
  seeds reach the market via seed-back and rare events.

## Server authority and safety

- All plant/harvest/knob/feast outcomes resolve server-side; no client-supplied
  instance payloads; no new unbounded server state without a retention story; dev
  cheats stay behind ALLOW_DEV_COMMANDS.

## Persistence

- Pre-farming saves load cleanly (all new CharacterState fields optional with
  defaults); save-then-load round-trip pins green; load clamps and sanitizes
  (deadlines, skill, plot ids); no DDL landed (or, if any did, additive and
  idempotent with migration-safety dispatched).

## Performance and budgets

- updateFarming does no per-tick allocation and no rng; snapshot deltas for fplot
  fire only on real change; the Harvest Journal painter is write-elided or passes the
  cold-window contracts per tests/hud_perf_budget.test.ts; npm run asset:budget green
  after the props land; graphics tiers shed only cosmetics (timers and ready notices
  are actionable and never shed).

## Copy and content

- No em dashes, en dashes, or emojis anywhere; IP-safe names throughout (D17);
  deeds pins re-pinned deliberately; the wiki farming page regenerated and accurate;
  guide freshness gate green.

## Build gate and delivery

- node scripts/gate_select.mjs green per phase; npm run gate green at packet close
  (armory browser red is the standing environmental exception; PR CI is the arbiter);
  screenshots committed under docs/screenshots and referenced from PR bodies for the
  visual phases; the asset handoff manifest exists at
  docs/design/farming-asset-manifest.json and lists every swap-ready prop with
  footprint, pivot, and intent.
