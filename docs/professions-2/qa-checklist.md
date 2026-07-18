# Professions 2.0: whole-feature QA matrix

Verified once at packet completion (Phase 15 QA), on top of the per-phase QA
sessions. Every row must be checked with evidence (test name, command output,
or screenshot path), not vibes.

## Three-host parity
- [ ] Craft skills, archetype identity (title, majors, hobby, history), combo
      eligibility, masterwork results, station gating, node cooldowns, corpse
      claims, fishing proficiency, and known recipes read identically in the
      offline `Sim` and online `ClientWorld`; the headless env is unaffected or
      consistent where it reads professions state.
- [ ] `tests/world_api_parity.test.ts` pins every new member; no ClientWorld
      stub defaults remain for any surface this packet ships (the shape-only
      pin trap: verify liveness, not just member presence).
- [ ] Wire suites green: `npx vitest run tests/snapshots.test.ts tests/env_protocol.test.ts tests/bandwidth.test.ts`.

## Determinism
- [ ] All new randomness (masterwork proc, rare gather events, node rarity,
      fishing catches) draws through `Rng` with pinned draw-order tests; no
      `Math.random` / `Date.now` / `performance.now` anywhere in `src/sim/`.
- [ ] `npx vitest run tests/architecture.test.ts` green.
- [ ] Same-seed determinism test covers a full gather-craft-masterwork sequence.

## Server authority
- [ ] Every new command (train recipe, disenchant, enchant apply, salvage,
      quest advance) validates server-side; the client never decides craft
      outcomes, masterwork procs, harvest rewards, or quest credit.
- [ ] Invalid or replayed commands cannot duplicate rewards, recipes, or skill.

## Persistence
- [ ] Characters saved before this packet load cleanly: legacy `ArchetypeState`
      (no history), legacy craft skills, legacy known recipes (grandfathered),
      legacy instances (no masterwork flag) all default correctly.
- [ ] Save/load round-trip tests cover archetype history, fishing proficiency,
      known recipes, and masterwork instances.
- [ ] All DDL (if any) is additive and idempotent under the boot advisory lock.

## Economy invariants
- [ ] Pinned test: no recipe's output vendors for more than its inputs.
- [ ] Training fees, craft fees (#1301), and market cut are the sinks; NPC
      shops never buy crafted goods above trivial value.
- [ ] Masterwork power stays within the tuning bounds in `state.md` (below the
      raid floor); baseline crafted gear sits below dungeon best-in-slot.
- [ ] Recurring destruction is live: consumables at every cooking/alchemy
      tier, salvage and disenchant, and the cadence-capped work orders all
      consume materials or items in play; the Phase 15 faucet-vs-sink review
      is recorded with evidence.
- [ ] The masterwork signed-reagent term counts ANY player's signature
      (buying a gatherer's signed materials works; the count-1 case works).

## i18n completeness
- [ ] Every new player-visible string (window chrome, recipe rows, station
      badges, toasts, broadcasts, NPC names and dialogue, quest text, letters,
      deed names) is a `t()` key in ENGLISH in the matching
      `src/ui/i18n.catalog/<domain>.ts`; locale overlays untouched; M16 wordy
      strings carry their five non-Latin fills.
- [ ] Sim/server-origin player text has matcher rules in `src/ui/sim_i18n.ts`
      or `src/ui/server_i18n.ts` in the same change; the S3 guard
      (`npx vitest run tests/localization_fixes.test.ts`) is green AND the
      Phase 7 scanner-gap fix means `src/sim/quests/quest_commands.ts` is in
      scope.
- [ ] Numbers, money, and dates go through `formatNumber` / `formatMoney` /
      `formatDateTime`.

## Design language and UX (the deeds bar)
- [ ] The wheel window and crafting-window upgrades follow DESIGN.md tokens and
      chrome (no hardcoded colors, correct layer usage per `src/styles/CLAUDE.md`).
- [ ] Desktop and mobile screenshots captured (`scripts/mobile_*.mjs` family)
      and committed under `docs/screenshots`, referenced from the PR body.
- [ ] Tap targets comfortable; no hover-only information; safe areas respected.
- [ ] Graphics-settings fairness: no preset hides actionable profession info.
- [ ] The eight-step journey (the Phase 7 vertical-slice checkpoint)
      re-verified end to end on the finished packet, desktop and mobile.

## Content integrity
- [ ] Placement-safety test green: no profession NPC or station within
      aggro-plus-buffer of hostile spawns.
- [ ] Every deep craft has a full tier ladder; every recipe's materials are
      obtainable in-world; referential integrity tests green.
- [ ] Corpse component rewards no longer grant unrelated quest credit; every
      mapped tag yields a real item.
- [ ] Every gathering family has its rare-event fantasy and each fires,
      localizes, and celebrates: pristine vein (ore), ancient heartwood
      (wood), moonlit bloom (herb), the glimmerfin catch (fishing), the
      perfect specimen (corpse harvesting).
- [ ] The visible ladder holds end to end: locked Train rows name their tier
      requirement, the wheel window's next-unlock and switch-cost lines
      render, tier crossings toast (and mail for attuned majors), and a known
      recipe is NEVER use-gated (the no-admission-gate rule).
- [ ] All existing deeds remain earnable; new profession deeds registered and
      pinned in `tests/deeds_content.test.ts`; first attunement and first
      masterwork carry titles and marquee-tier renown and the pipeline fires
      (nameplate, banner, marquee broadcast).

## Classic fidelity and copy
- [ ] No invented balance formulas where a classic-era reference exists; XP and
      gray-out curves match the documented model.
- [ ] No em dashes, en dashes, or emojis in any player-facing text, code,
      comments, or docs from this packet.

## Build gate and cleanup
- [ ] `npm run gate` green on the release branch tier (run under Node 24 per
      memory: node25-breaks-jsdom-gate).
- [ ] No dead code from the replaced systems: five-way quality roll consumers,
      `trivialAt`, practitioner-title keys, placeholder junk table entries,
      stale test pins (tool no-op, one-recipe-per-craft) all removed or
      re-pinned.
- [ ] `asset-manifest.json` lists every placeholder asset shipped, with size,
      format, usage, and replacement notes for designers.
- [ ] Packet teardown offered (delete `docs/professions-2/` before the final PR)
      only on explicit maintainer confirmation.
