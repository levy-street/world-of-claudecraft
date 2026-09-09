# Crucible professions integration

## Status and authority

Implementation and targeted balance measurements are complete. Draft PRs
[#3884](https://github.com/levy-street/world-of-claudecraft/pull/3884) and
[#3885](https://github.com/levy-street/world-of-claudecraft/pull/3885) are published;
CI repair and final shared QA are in progress. This is not a merge recommendation.
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

## Tuning and measured comparison

The [balance report](crucible-professions-balance-measurement.md) records all 11
profiles, all three slot pairs, base/Perfected comparisons, and signature-disabled
controls through real simulation rotations. Base mixed pairs improve the six
tested offensive profiles by 3.4 to 13.1 percent over old six-piece equipment.
The healer and tank findings depend on encounter pressure and are reported
separately, not as misleading damage-equivalent percentages. These controlled
measurements are not optimized best-in-slot rankings or full raid simulations.

CI integration exposed an illegal reference-kit selection: a third Masterwrought
piece was rejected at equip time, leaving its slot empty. Reference harnesses now
apply the existing class, spec, hand, unique-family, and crafted-item limits before
accepting each ordered candidate, and assert that the real equip succeeds. New
collection candidates also respect their authored role; legacy scoring is unchanged.
The corrected friendly Protection Warrior dummy reference is 1382 HP and 3265 armor.
This is a reference-fixture correction, not a relaxation of raid balance bounds.

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
- Last Flame's Zeal grants 50 Strength for 15 seconds and 200 healing,
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

### Serialized-size evidence, 2026-09-05

`tests/professions_blob_growth.test.ts` measures UTF-8 JSON produced by the real
serializer, then requires two further load/serialize passes to reach the same
fixed point. These are serialized bytes, not measurements of PostgreSQL storage,
compression, WAL, or query latency.

The corrected professions subset is **18,807 bytes**. Its tracking band remains
measurement minus 380 to measurement plus one; its separate structural ceiling
is now 20 KiB. The storage-rich whole-character fixture is **209,261 bytes**, with
the same narrow tracking discipline. The prior recorded whole-character figure
was 151,656 bytes; running its unchanged fixture against the current catalog
measured 156,144 bytes. Correcting the fixture accounts for the remaining 53,117
bytes, separately from catalog growth.

The exact per-field change from the recorded 151,656-byte baseline is:

| Field | UTF-8 byte change | Cause |
| --- | ---: | --- |
| `knownRecipes` | +1,221 | 33 collection recipes (+1,189), plus the learned Zeal id (+32) |
| `deedStats` | +1,328 | Discovery ids for 33 pieces, 11 manuals, and the formula |
| `reliquary` | +1,971 | 33 first-find/count records and the collection page |
| `equipment` | +115 | Actual slot-compatible equipped item ids |
| `equipmentInstance` | -10 | Real slot-compatible enchant payloads and collection provenance, replacing invented flat-stat rolls |
| `inventory` | +16,320 | 80 stored Perfected/promoted collection copies instead of plain signed copies |
| `bank` | +35,904 | The same correction across 176 storage slots |
| `vendorBuyback` | +756 | 12 unbound collection copies with minted bonus provenance |
| Total | +57,605 | 209,261 bytes |

The fixture respects the two-Masterwrought worn cap and one-promoted worn cap.
Stored copies have no equipment cap: their progress, full-width names, signer,
legal enchant, and production-width binding id survive the fixed point. Bound
copies cannot be sold, so buyback rows carry `perfectingBonus` but neither
`perfectingBound` nor progress/promotion. Their distinct full-width legal signers
keep the vendor's identical-payload merging from collapsing the 12 rows.
The new fields are named
`perfectingBonus` and `perfectingBound`; the fixture uses catalog-minted primary
profiles, not the loader's much larger anti-corruption numeric limits. Other
documented exclusions in the existing fixture, including Rift gear and optional
loadout gear snapshots, remain exclusions; this is a modeled storage-rich
character, not a proof of the largest possible JSON object across all game systems.

The assembled retainable recipe/formula set is tested as an exact load/serialize
set: 203 craft recipes plus Zeal, 204 ids total, strictly below the existing
512-id cap. Removing just the new fields from the settled fixture measures
11,880 bytes for `perfectingBonus` across 270 copies and 5,934 bytes for
`perfectingBound` across 258 progressed copies: 17,814 bytes combined. The rest
of the increase is catalog growth and correcting previously omitted legitimate
payload/identity state. No rank-exchange
ledger, new timer, or additional save/query path is introduced.

The database review approved the **229,376-byte (224 KiB)** warning threshold,
the next 32 KiB step above this measurement. It leaves 20,115 bytes of headroom
and remains one 32 KiB step below the 256 KiB guild-bank scale. The previous
163,840-byte threshold was below the corrected fixture by 45,421 bytes.
Independent literal/boundary tests and the whole-character relation pin the
new value. This remains a warning, never permission to truncate or reject a
character save; p99/high-water tracking, warning dampening, and save paths are
unchanged.

### Rollback compatibility

A rollback to the parent branch is not lossless after players acquire this
content. The old binary preserves unknown instance fields but does not enforce
the new permanent binding rule. Its item and Reliquary allowlists also do not
recognize new discoveries or pages and can discard that history on resave.
Prefer a forward fix. An older-binary rollback requires a compatibility backport
or a drained deployment with a verified character-state backup and recovery
plan; merely retaining unknown JSON fields is not a safe rollback guarantee.

## Vertical slices and acceptance

1. Acquisition and content: test valid/invalid manual learning, partial-known
   collections, exact selected-copy consumption, core discount exemption, actual
   drop/vendor reachability, role coverage, all three slot pairs, and honest budgets.
2. Combat: test each signature through real combat paths, old behavior with no new
   gear, pet/periodic/conversion cases, equipment loss, PvP/duel endings, and proc
   recursion. Verify Zeal speed rates, different-speed dual-wield weapons, refresh/stack
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
