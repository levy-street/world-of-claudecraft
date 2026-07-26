# Procedural Loot Generator v1

Date: 2026-07-26

Release target: v0.30

Generator payload version: 1

This document describes the implemented system. The source of truth is the
exported data and functions named below. Measurements are identified separately
from authored constants so a sampled result is never mistaken for a configured
drop rate.

## Product outcome

The v1 system adds one deterministic, uniquely identified equipment copy after
the existing authored loot roll. It does not replace normal, Heroic, quest, or
profession items. Ordinary enemies provide a very low-frequency chase, rare
enemies provide a reliable upgrade stream, and repeatable dungeon and delve
bosses provide the main Legendary path.

The launch catalog contains 34 base families:

- 9 weapon types: sword, axe, mace, dagger, staff, wand, polearm, bow, and
  crossbow
- 7 cloth, 7 leather, and 7 mail armor slots
- 1 shield and 1 caster focus
- 1 ring and 1 pendant

All live pools currently contain the complete catalog. Source level, equip
rules, smart-loot weighting, and Legendary compatibility narrow or weight the
available choices at generation time.

## Live source eligibility

`proceduralLootSourceEligible` in `src/sim/loot/loot_roll.ts` is the outer
fail-closed gate. `proceduralDropProfile` and `generateLiveProceduralDrop` in
`src/sim/loot/procedural/live_drop.ts` then choose the source profile and make
the deterministic entry roll.

A source must:

- be registered as a procedural loot source by the simulation
- be level 5 or higher
- have no player or pet owner
- not be a developer spawn
- not be spawned by a delve affix
- not be a world boss or training dummy

Source routing after those guards:

| Source | Procedural entry chance | Conditional rarity table |
| --- | ---: | --- |
| Ordinary outdoor mob | 5% | World |
| Outdoor rare or non-world named boss | 100% | Rare |
| Delve elite or rare | 20% | Rare |
| Dungeon boss | 100% | Dungeon boss |
| Delve boss | 100% | Dungeon boss |
| Ordinary outdoor elite | 0% | None |
| Dungeon trash | 0% | None |
| Ordinary delve trash | 0% | None |

World bosses remain on their existing personal-loot and daily-lockout system.
They do not receive this shared-corpse procedural layer.

`appendLiveProceduralDrop` runs after authored and Heroic loot. The integration
test `keeps authored, Heroic-only, and procedural loot together on a Heroic
final boss` pins the three layers on one corpse.

## Exact configured probabilities

The rarity weights live in `PROCEDURAL_RARITY_TABLES` in
`src/sim/content/procedural_loot/rarity.ts`.

### Conditional rarity after a procedural entry exists

| Table | Common | Magic | Rare | Epic | Legendary |
| --- | ---: | ---: | ---: | ---: | ---: |
| World | 70% | 24.5% | 5% | 0.48% | 0.02% |
| Rare | 0% | 60% | 36% | 3.8% | 0.2% |
| Dungeon or delve boss | 0% | 25% | 60% | 13% | 2% |

### Effective probability per eligible kill

These values multiply the entry chance by the conditional rarity weight.

| Source | No procedural item | Common | Magic | Rare | Epic | Legendary |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ordinary outdoor mob | 95% | 3.5% | 1.225% | 0.25% | 0.024% | 0.001% |
| Outdoor rare or named boss | 0% | 0% | 60% | 36% | 3.8% | 0.2% |
| Delve elite or rare | 80% | 0% | 12% | 7.2% | 0.76% | 0.04% |
| Dungeon or delve boss | 0% | 0% | 25% | 60% | 13% | 2% |

The effective Legendary expectations are therefore:

- ordinary outdoor mob: 1 in 100,000 eligible kills
- outdoor rare or named boss: 1 in 500 eligible kills
- delve elite or rare: 1 in 2,500 eligible kills
- dungeon or delve boss: 1 in 50 eligible kills

These are independent configured rolls. They are not guarantees.

## Boss-kill tails and grind expectations

For a repeatable boss with a 2% Legendary chance, the chance of seeing at least
one Legendary after `n` independent kills is:

`1 - 0.98^n`

| Boss kills | At least one Legendary |
| ---: | ---: |
| 1 | 2.000% |
| 10 | 18.293% |
| 25 | 39.654% |
| 35 | 50.693% |
| 50 | 63.583% |
| 75 | 78.024% |
| 100 | 86.738% |
| 114 | 90.005% |
| 149 | 95.072% |
| 200 | 98.241% |
| 228 | 99.001% |

This creates a meaningful long-tail chase while making bosses much more useful
than ordinary farming. It also means an unlucky player can exceed any of these
kill counts. V1 has no pity counter or bad-luck protection. Adding a per-player
pity system to a shared corpse would require an explicit ownership and party
policy, so it is intentionally not simulated by pretending the current shared
drop is personal.

Boss signature targeting makes the desired power substantially more likely
after a Legendary occurs. It does not alter the 2% Legendary entry rate. The
exact targeting map and two-stage selection are documented in
`docs/balance/procedural-legendary-v1.md`.

## Base selection and smart loot

Base selection is weighted, not exclusive.

For non-forced generation, a base is eligible when:

- it is present in the selected pool
- its `sourceLevel` is no higher than the source mob level
- for a Legendary, it can carry at least one compatible Legendary power

The authored launch weight totals are:

| Category | Weight | Approximate unbiased share |
| --- | ---: | ---: |
| Armor | 378 | 40.04% |
| Weapons | 378 | 40.04% |
| Jewelry | 94 | 9.96% |
| Offhands | 94 | 9.96% |

The smart-loot multiplier in
`src/sim/loot/procedural/smart_loot.ts` is:

`1 + 2 * (usable eligible recipients / all eligible recipients)`

The multiplier ranges from 1 to 3:

- no eligible recipient can equip the base: 1
- half can equip it: 2
- every eligible recipient can equip it: 3

Usability calls the real `canEquipItem` rule. Shared-loot recipients are sorted
by entity ID and deduplicated before their classes are passed to the generator,
so tap holder and array order cannot change the result. A base with multiplier
1 remains in the pool, preserving off-class, group, trade, and future-character
interest.

Affix selection can additionally apply a class bias if an affix authors one.
The current launch affixes do not use a class bias, so the live class bias is
currently at base selection only.

## Item level

`itemLevelFromSource` in `src/sim/loot/procedural/generate.ts` computes:

`floor(source level) + variance + rarity bonus`

Variance is one of `-1`, `0`, or `1`. The Epic rarity bonus is `+1`, the
Legendary bonus is `+2`, and all other rarities have no bonus. The result is
clamped to item level 1 through 40.

Live drops have an outer source-level gate of 5. Development-only forced item
levels are truncated and clamped to 1 through 40, but they still have to reach
a feasible affix budget.

Armor and block values scale from their base source level. Weapons use the
shared item-level DPS curve, with the existing two-hand multiplier. Tests pin
cloth at or below leather and leather below mail for the same slot, and pin
every procedural weapon to the shared one-hand or two-hand curve.

## Rarity, affix density, and roll floors

The current density and weighting are:

| Rarity | Affix count | Count weighting | Budget multiplier | Roll floor |
| --- | --- | --- | ---: | ---: |
| Common | 0 | 100% at 0 | 0 | 0% |
| Magic | 1 or 2 | 55% at 1, 45% at 2 | 0.70 | 0% |
| Rare | 3 or 4 | 65% at 3, 35% at 4 | 1.00 | 15% |
| Epic | 4 or 5 | 55% at 4, 45% at 5 | 1.25 | 35% |
| Legendary | 3 or 4 | 65% at 3, 35% at 4 | 1.20 | 50% |

The roll floor applies inside each authored tier range before quantization.
Consequently, two items with the same base and name can still differ in item
level, affix families, affix tiers, affix values, and, for Legendaries, power
magnitude. Higher rarity narrows away the weakest part of each affix range but
does not make every item identical or automatically best in slot.

Magic names use the highest-budget affix as a prefix or suffix. Rare and Epic
names use two deterministic name tokens. Legendaries use the power's unique
name. The name is an identity and presentation layer, not a promise that every
numeric roll is equal.

## Affix catalog

The launch set has 12 families. A base is eligible when its tags intersect an
affix's tags and do not intersect its excluded tags.

| Affix | Stat | Minimum item level | Applies to |
| --- | --- | ---: | --- |
| Mighty | Strength | 1 | Melee |
| Deft | Agility | 1 | Melee or ranged |
| Stalwart | Stamina | 1 | Armor, weapon, offhand, or jewelry |
| Sage's | Intellect | 1 | Caster |
| Spiritual | Spirit | 1 | Caster |
| of Focus | Spell power | 4 | Caster |
| of Striking | Critical rating | 4 | Armor, weapon, offhand, or jewelry |
| of Alacrity | Haste rating | 4 | Armor, weapon, offhand, or jewelry |
| of Precision | Hit rating | 10 | Armor, weapon, offhand, or jewelry |
| Warded | Armor | 1 | Armor excluding jewelry |
| of Reaping | Health on kill | 4 | Melee or ranged |
| of Remembrance | Mana on kill | 8 | Caster |

Selection is weighted without replacement. The generator rejects duplicate
families and any overlapping `exclusiveGroups`. No launch affix currently
authors an exclusive group, but both generation and persisted-item validation
enforce the field.

## Canonical stat budget

`calculateProceduralBudget` in `src/sim/loot/procedural/budget.ts` computes:

`B = item level * rarity budget multiplier * base slot multiplier`

The accepted total affix budget is within:

`B plus or minus max(1, 0.15 * B)`

The randomized target used to distribute budget among selected affixes ranges
from 95% to 105% of `B`. The final accepted total remains inside the canonical
tolerance above.

Stat costs convert unlike stats into one normalized budget:

| Stat | Cost per point |
| --- | ---: |
| Strength, Agility, Stamina, Intellect | 1.00 |
| Spirit | 0.85 |
| Spell power | 0.65 |
| Critical rating | 0.25 |
| Haste rating | 0.28 |
| Hit rating | 0.32 |
| Armor | 0.08 |
| Health on kill, Mana on kill | 0.50 |

Tier unlocks and normalized ceilings are:

| Tier | Minimum item level | Maximum normalized budget |
| ---: | ---: | ---: |
| 1 | 1 | 1.5 |
| 2 | 4 | 6 |
| 3 | 8 | 10 |
| 4 | 12 | 16 |
| 5 | 18 | 24 |

The allocator first attempts a deterministic greedy fit and local improvement.
If that misses the tolerance, it uses exact dynamic programming over quantized
budget candidates. If the randomly selected affix set cannot reach the
canonical budget, generation deterministically searches compatible affix sets
and retries with the already-consumed budget rolls. It never takes extra random
draws during fallback.

Persisted validation independently recomputes eligible tiers, authored ranges,
quantization, per-affix budget, duplicate families, exclusivity, and total
budget tolerance. A malformed item fails closed instead of being silently
retuned.

## Determinism and identity

The procedural child seed hashes:

- world seed
- source type
- source entity ID
- source respawn sequence
- loot slot index
- optional recipient ID

The entry chance uses a separate hash of that child seed. Procedural generation
does not consume the legacy shared simulation RNG. Identical source inputs
produce byte-identical item payloads, while a respawn-sequence change produces
a different seed and copy.

Generator draw order is fixed in `generateProceduralItem`. It consumes
`8 + 3 * affix count` calls to `Rng.next()`. Forced development values consume
their normal draw before overriding it.

A UID is allocated only after the entry chance succeeds. Every procedural copy
has one realm-scoped monotonic UID and remains one copy per inventory slot.
Corpse, need or greed, master loot, bag, bank, trade, mail, reconnect, and
vendor paths transport the exact payload. They do not regenerate a winning
copy or collapse distinct UIDs into a counted stack.

## Existing items and save compatibility

Existing authored and legacy items are not converted or rerolled.

- A static item with no `procedural` payload continues through its existing
  definition and legacy `rolled` path.
- Legacy `rolled.quality`, `rolled.stats`, and `rolled.masterwork` remain
  accepted within their validation bounds.
- Signer, charges, enchant, binding, bind-on-trade, legacy rolled data, and a
  procedural payload are independent allowlisted fields on one item instance.
- `resolvedItemStats` adds authored definition stats and legacy rolled stats,
  then resolves procedural base scaling and affixes when a procedural payload
  exists.
- Loading validates and deep-clones procedural payloads. Duplicate UIDs,
  corrupt ranges, unknown IDs, incompatible powers, invalid revisions, and
  multi-count procedural copies are rejected.
- Persisted numeric rolls remain final. Later table tuning does not reroll an
  existing copy.

This is additive migration behavior: old items remain old items, and newly
dropped procedural items carry the new versioned payload.

## Current deterministic measurements

The following samples were rerun against the implemented tables on 2026-07-26
with world seed `13371337`. Each row generated 100,000 item entries directly.
These are conditional generator samples, not per-kill results, so the 5% and
20% live entry gates are not applied in this table.

Reproduction commands:

```powershell
npx tsx scripts/procedural_loot_simulate.ts `
  --pool initial_world `
  --table initial_world `
  --level 18 `
  --count 100000 `
  --seed 13371337

npx tsx scripts/procedural_loot_simulate.ts `
  --pool initial_rare `
  --table initial_rare `
  --level 18 `
  --count 100000 `
  --seed 13371337

npx tsx scripts/procedural_loot_simulate.ts `
  --pool initial_dungeon_boss `
  --table initial_dungeon_boss `
  --level 20 `
  --count 100000 `
  --seed 13371337
```

| Table | Common | Magic | Rare | Epic | Legendary |
| --- | ---: | ---: | ---: | ---: | ---: |
| World | 69.976% | 24.498% | 5.020% | 0.485% | 0.021% |
| Rare | 0% | 60.108% | 35.921% | 3.757% | 0.214% |
| Dungeon boss | 0% | 24.908% | 59.910% | 13.157% | 2.025% |

All 300,000 generated entries had zero duplicate UIDs, zero duplicate affix
families, and zero values outside persisted ranges. The run generated 2,260
Legendaries through the normal rarity tables.

| Table | Affix slots | Average affix budget | Average item affix budget | Maximum item affix budget |
| --- | ---: | ---: | ---: | ---: |
| World | 54,513 | 6.845808 | 3.731855 | 33.50 |
| Rare | 224,929 | 6.045309 | 13.597654 | 33.59 |
| Dungeon boss | 302,123 | 5.843939 | 17.655884 | 37.27 |

The pinned 10,000-entry world digest in
`tests/procedural_loot_distribution.test.ts` currently reports average item
affix budget `3.662585` and maximum item affix budget `33.25`.

## Automated evidence and final QA

Focused deterministic checks:

```powershell
npx vitest run `
  tests/procedural_loot_content.test.ts `
  tests/procedural_loot_generator.test.ts `
  tests/procedural_loot_distribution.test.ts `
  tests/procedural_loot_balance.test.ts `
  tests/procedural_smart_loot.test.ts `
  tests/procedural_live_drop.test.ts `
  tests/procedural_live_drop_integration.test.ts `
  tests/procedural_legendary_sources.test.ts
```

Important workload sizes pinned by those tests:

- distribution suite: 155,000 configured sample entries and 160,000 generator
  executions because the 5,000-entry reproducibility case runs twice
- base category balance: 100,000 generated entries
- world live-entry envelope: 20,000 source sequences
- boss signature distributions: 56,000 forced Legendaries across seven bosses
- base, rarity, and seed matrix: 6,528 exact repeated scenarios
- class and compatible-power matrix: 288 forced class Legendaries
- live-source Legendary compatibility: 6,000 forced Legendaries
- reachable budget generation: more than 5,000 exact scenarios
- budget-feasible fallback catalog: more than 1,000 source scenarios and more
  than 2,000 affix-count witnesses
- UID format uniqueness: 10,000 monotonic serials

The release-sized Legendary contribution campaign is separate and documented
in `docs/balance/procedural-legendary-v1.md`.

Final exact-SHA acceptance commands:

```powershell
npm run loot:balance
npx tsc --noEmit
npm run ci:changed
npm run gate
```

The full gate remains the completion authority. A local sample or focused test
does not replace it.

## Known limitations

- V1 has no pity counter or bad-luck protection.
- Boss signatures improve targetability but are deliberately not exclusive.
- The three 100,000-entry reports measure generation, not combat encounter
  balance or player behavior.
- Smart loot improves equipability but preserves off-class drops.
- Item power can be compared numerically, but there is no automated optimizer
  that declares one multi-affix item universally best for every build.
- The item-level cap is 40 even though the v0.30 live content slice occupies a
  smaller band.
- Implicit affixes exist in the payload type for future versions but are not
  active in payload version 1.
