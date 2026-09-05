# Crucible professions integration

## Status and authority

Implementation in progress, not a balance verdict or merge recommendation.
The maintainer approved this direction on 2026-09-05. The integration PR targets
FernandoX7's `feature/masterwrought`, initially based on
`0f53c92ff738ebebb6add787a61caecdf7e8e884`. No change is merged into that branch
without review. A separate Forgebreaker quest PR follows this integration.

This supersedes the older Crucible professions PRD where explicitly stated below.
Do not merge the historical `feature/ignivar-professions` branch wholesale: its
extraction scaffolding removes raid loot that must remain live.

## Approved player contract

- New crafted collections offer chest, waist, and feet. Any two grant the only
  set bonus; there is no three-piece bonus. The bonus works before Perfecting.
- The intended transition is old raid four-piece plus crafted two-piece, then
  current Crucible four-piece plus crafted two-piece. Old six-piece equipment
  remains a comparison baseline, not an identity the new crafts inherit.
- Each item must be useful individually. Raid chest, waist, and feet remain
  possible choices because players choose which two crafted slots to wear.
- Preserve the global two-Masterwrought equipment limit and one promoted item
  limit. Crafted weapons and jewelry compete with the armor pair, not beside it.
- Cover native armor and gameplay roles, including cat and bear, Stonebound,
  melee/ranged hunters, pet builds, periodic healers, and conversion healers.
- Perfecting exchanges the ranks of two distinct, owned pieces of the same
  collection. Both items and the total earned ranks survive. Both become
  permanently bound, including a donor that returns to rank zero.
- Swapping is deterministic, free of Ember costs and new cooldowns, and requires
  a living, out-of-combat owner at the appropriate station with skill 125.
- Names and cosmetic promotion remain on their original items. Equipment limits
  still apply when a promoted item is no longer Perfected.
- An enchant requiring Perfected status becomes inactive while its item lacks
  that status and reactivates when it returns. Ordinary enchants are unchanged.
  The preview and confirmation explain the consequence before spending progress.
- Existing weekly Ember earning, four ranks, and 80 percent success remain.
- The separate legendary quest leads to the existing iLvl 55 Forgebreaker, not
  the historical iLvl 39 Requiem. The raid legendary is not Masterwrought-flagged.

## Initial tuning, subject to measurement

These are implementation candidates, not claims of measured raid balance.

- Eleven armor/stat profiles share physical, caster, tank, and healer signatures.
  Each profile offers all three slots. Generic proper names receive the normal
  originality screen before shipping.
- Base crafted equipment starts at iLvl 35, with primary budgets and role-specific
  ratings, armor, Spell Power, and Healing Power checked against actual Crucible
  alternatives. New collections Perfect to a primary budget three item levels
  higher. Existing Masterwrought items retain their prior behavior.
- Collection manuals teach all three recipes, with traded raid drops and an
  actual deterministic quartermaster fallback. Skill 100 learns the armor tier.
- A base armor craft consumes three existing Cores of the Last Flame plus
  ordinary high-grade materials. Core quantities are discount-exempt. No daily
  catalyst or Wyrmfall Core is layered onto these raid recipes.
- Last Flame's Zeal starts testing at 50 Strength for 15 seconds and 200 healing,
  using one nominal proc per minute based on the striking weapon's base speed.
  No internal cooldown; independent mainhand/offhand auras, same-hand refresh.
  Melee weapon attacks qualify, ranged shots do not borrow the melee enchant.
- Combat effects must have explicit trigger, scaling, cap, duration, and reset
  rules, and tooltips must describe the implemented result.

## Ownership and seams

- Content: `src/sim/content/crucible_collections.ts`, integrated through existing
  recipes, item-set, item, and loot tables. No content logic in coordinators.
- Combat: small modules behind `SimContext`, called from existing combat hubs.
  No new RNG draws for players not wearing new content. Existing set semantics
  remain unchanged. Generated healing and damage must not recursively trigger.
- Perfecting: `src/sim/professions/perfecting.ts` and sibling swap/state helpers.
  Exact reversible contributions preserve unrelated enchant and instance stats.
- Presentation and transport: the professions `IWorld` facet, both worlds, pinned
  command schema, server validation, and the existing Perfecting UI family.
- Main agent owns integration, shared type edits, checkpoint commits, localization,
  assets, cross-platform verification, balance measurements, and PR publication.

## Persistence and security checkpoint

The pre-implementation database review found no need for SQL, a new table, a
history ledger, an immediate save, a timer, or an extra database query. Both
items remain in the existing character JSONB save, updated synchronously before
the ordinary save machinery observes them. New metadata must be bounded per
copy, not grow with the number of exchanges.

Both selected copies need mandatory current identity/payload pins on the new
online command. Validate both before writing either. Reject replay, stale refs,
wrong collections, malformed ranks, locked copies, and denied player state without
mutation or RNG. Preserve signer, crafting provenance, name, and unknown payload
fields. Binding must remain permanent after rank-zero save/load and paid-unbind
attempts. A completed swap invalidates the owner once and recalculates worn stats
once. Repeated swaps must not accumulate power or serialized metadata.

The finished diff receives database-performance, persistence, security, parity,
sim-architecture, frontend, content-obligation, and test-coverage review as applicable.

## Vertical slices and acceptance

1. Acquisition and content: test valid/invalid manual learning, partial-known
   collections, exact selected-copy consumption, core discount exemption, actual
   drop/vendor reachability, role coverage, all three slot pairs, and honest budgets.
2. Combat: test each signature through real combat paths, old behavior with no new
   gear, pet/periodic/conversion cases, equipment loss, PvP/duel endings, and proc
   recursion. Verify Zeal speed rates, identical dual-wield weapons, refresh/stack
   limits, actual Strength scaling, healing, and enchant replacement.
3. Perfecting: test all rank pairs, double swaps, exact stat restoration, permanent
   binding, gated-enchant suspension/reactivation, promoted-but-unperfected pieces,
   both stale refs, replay, save/load, and unchanged weekly earning/failure behavior.
4. UI and parity: two-item preview and explicit confirmation, stale/pending handling,
   keyboard access and focus, mobile portrait/landscape, shared tooltips, offline and
   online behavior, wire validators and pinned member lists.
5. Balance and delivery: compare old-six, old-four plus crafted-two, Crucible-four
   plus crafted-two, all slot pairs, and competing Masterwrought configurations.
   Record measured findings without presenting old proxy fixtures as current raids.
   Complete names, art/provenance, localization, wiki, deeds, and Reliquary obligations.

Use focused Vitest targets for each RED/GREEN iteration, then `npm run ci:changed`,
`npx tsc --noEmit`, relevant domain guards, browser checks and screenshots, and
`npm run gate`. Record exact outcomes and any unavailable verification in the PR.
No implementation is complete merely because a focused test or reviewer passes.
