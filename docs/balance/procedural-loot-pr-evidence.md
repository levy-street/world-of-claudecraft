# Procedural Loot PR Evidence

Date: 2026-07-26

Release target: v0.30

This is the PR-ready product and verification narrative for the procedural loot
feature. Detailed mechanics live in:

- `docs/balance/procedural-loot-generator-v1.md`
- `docs/balance/procedural-legendary-v1.md`

## What changes for players

Eligible enemies can now append one uniquely rolled equipment copy without
removing their authored loot. The item stores its exact rarity, item level,
affixes, ranges, source, seed, UID, and optional Legendary power. That exact
copy survives looting, party assignment, inventory, bank, trade, mail, vendor
buyback, reconnect, and save/load.

The launch catalog covers 34 equipment families, 12 affix families, five
active rarities, and 12 named Legendary powers. Smart loot makes usable bases
more likely without eliminating off-class or tradeable results.

## Direct answers

### How do items drop?

- Ordinary level 5 or higher outdoor mobs have a 5% chance to append an item.
- Outdoor rares and eligible non-world named bosses always append an item.
- Delve elites and rares have a 20% chance to append an item.
- Dungeon and delve bosses always append an item.
- Dungeon trash, ordinary delve trash, ordinary outdoor elites, world bosses,
  training dummies, summoned mobs, developer spawns, affix-spawned mobs, and
  unregistered sources do not use this layer.

Authored and Heroic loot rolls first. Procedural loot is additive.

### What are the exact Legendary chances?

- Ordinary outdoor mob: 0.001% per eligible kill, or 1 in 100,000.
- Outdoor rare or named boss: 0.2%, or 1 in 500.
- Delve elite or rare: 0.04%, or 1 in 2,500.
- Dungeon or delve boss: 2%, or a mean of 1 in 50.

At 2%, the chance of at least one boss Legendary is 39.654% by 25 kills,
63.583% by 50, 86.738% by 100, 95.072% by 149, and 99.001% by 228.
There is no pity counter, so none of those are guarantees.

### Do Legendaries drop from specific bosses?

Yes, as strong targets rather than exclusive lockouts.

| Boss | Target powers |
| --- | --- |
| Deacon Varric | Bell of the Ninth Peal |
| Morthen the Gravecaller | Greyjaw's Edge |
| Vael the Fogbinder | Hushwood Longbow; Boots of the Unbroken Road |
| Sister Nhalia, the Drowned Canticle | Nightglass Fang; Mantle of Stolen Hours |
| Ysolei, Avatar of the Drowned Moon | Ysolei's Vigil; Stormwake Idol |
| Korzul the Gravewyrm | Crown of the Last Pyre; Ashbinder's Seal |
| Nythraxis, Scourge of Thornpeak | Dawnward Signet; Feral Moonclasp |

When one of these bosses rolls a Legendary, generation first gives an 80%
branch preference to a compatible signature base, then an 80% branch
preference to a compatible signature power. Non-signature outcomes remain
possible, and the same power can occur from another compatible source.

### Can the same Legendary roll well or badly?

Yes. The name identifies the power, not one fixed stat line.

The same named Legendary can vary in item level, three or four affixes, affix
tiers, affix values, and power magnitude. Examples of power variance include:

- Crown of the Last Pyre: 29% to 34%
- Hushwood Longbow: 800 to 1200 ms
- Ashbinder's Seal: 15% to 20%
- Feral Moonclasp: 4 to 7 resource
- Boots of the Unbroken Road: 8% to 12%

Every power range and step is listed in
`docs/balance/procedural-legendary-v1.md`. Legendary affixes use a 50% roll
floor within their available tier, which prevents the weakest half of a tier
without eliminating meaningful variance.

### Why will players keep grinding?

The chase is layered:

1. Farm the boss that targets the desired power.
2. Get the 2% shared Legendary result.
3. Roll a base compatible with the power and class.
4. Compare item level and the three or four affix families.
5. Compare each affix tier and value.
6. Compare the bounded Legendary power roll.
7. Choose one active Legendary power for the build.

The first copy can unlock a build, while later copies can still be upgrades.
Bosses have a clear purpose because they are 10 times more likely to yield a
Legendary than an outdoor rare and 2,000 times more likely than an ordinary
outdoor mob.

### What happens to existing items and saves?

Existing items stay exactly as they are.

- No authored item is converted to a procedural item.
- No existing rolled stat is rerolled.
- Legacy quality, stats, and masterwork payloads remain supported.
- Authored definition stats, legacy rolled stats, enchants, signing, binding,
  and procedural fields coexist through explicit allowlisted payload fields.
- Existing numeric rolls remain final even if content tables change later.
- Corrupt new payloads and duplicate UIDs fail closed at load or grant.

This is an additive item format, not a destructive migration.

## Balance controls

Affix power is controlled by:

- item level derived from source level with `-1`, `0`, or `+1` variance
- `+1` item level for Epic and `+2` for Legendary
- rarity-specific affix counts and roll floors
- a canonical normalized budget based on item level, rarity, and slot
- tier gates at item levels 1, 4, 8, 12, and 18
- no duplicate affix family
- tag and equip compatibility
- a deterministic exact fallback when a random set cannot reach budget

Legendary combat power is controlled by:

- exact class and base compatibility
- revisioned, quantized roll ranges
- deterministic trigger cadence, chance, and internal cooldowns
- one active Legendary power per character
- a fail-closed 33,000,000-event contribution gate

## Reproduced generator evidence

Three current-table samples were rerun on 2026-07-26 with seed `13371337`,
100,000 generated entries per table.

| Table | Common | Magic | Rare | Epic | Legendary |
| --- | ---: | ---: | ---: | ---: | ---: |
| World | 69.976% | 24.498% | 5.020% | 0.485% | 0.021% |
| Rare | 0% | 60.108% | 35.921% | 3.757% | 0.214% |
| Dungeon boss | 0% | 24.908% | 59.910% | 13.157% | 2.025% |

Across 300,000 items:

- 0 duplicate UIDs
- 0 duplicate affix families
- 0 invalid persisted values
- 2,260 generated Legendaries

These results sample the configured rarity tables after an item entry exists.
The effective per-kill probabilities are the exact products documented above.

## Recorded Legendary contribution evidence

The most recently recorded release-sized campaign used:

- 12 powers
- all nine classes where compatible
- five build profiles
- 165 applicable rows
- 100,000 events at each persisted roll edge
- 33,000,000 total events

A complete campaign produced fingerprint `30e920f9`, full row coverage, and no
gate failures. Release acceptance reruns the same fail-closed command
at the exact candidate SHA:

```powershell
npm run loot:balance
```

This primary command always enforces. `npm run loot:balance:report` is the
explicit non-enforcing report command. Bell retains a persisted 25% to 29%
roll and applies a documented 2.2x Paladin hybrid coefficient, producing a
55% to 63.8% triggering-spell magnitude for Paladins.

Its five Paladin profiles measured 9.314% to 11.681% sustained contribution
and at most 14.802% in the 10-second burst window.

The PR records the exact candidate SHA and resulting fingerprint.

## Automated verification matrix

Focused loot command:

```powershell
npx vitest run `
  tests/procedural_loot_content.test.ts `
  tests/procedural_loot_generator.test.ts `
  tests/procedural_loot_distribution.test.ts `
  tests/procedural_loot_balance.test.ts `
  tests/procedural_smart_loot.test.ts `
  tests/procedural_live_drop.test.ts `
  tests/procedural_live_drop_integration.test.ts `
  tests/procedural_legendary_content.test.ts `
  tests/procedural_legendary_sources.test.ts `
  tests/procedural_legendary_balance.test.ts `
  tests/procedural_item_validation.test.ts `
  tests/procedural_persistence_integration.test.ts `
  tests/procedural_loot_transport_integration.test.ts `
  tests/equipment_effect_runtime.test.ts `
  tests/equipment_effect_property.test.ts `
  tests/equipment_effect_integration.test.ts
```

Pinned high-volume coverage includes:

- 160,000 distribution-suite generator executions
- 100,000 base-category generation samples
- 20,000 live world source sequences
- 56,000 boss-signature forced Legendaries
- 6,528 repeated base, rarity, and seed cases
- 288 class-specific forced Legendaries
- 6,000 live-source compatibility Legendaries
- more than 5,000 reachable budget generation cases
- 10,000 monotonic UID format cases
- 33,000,000 release balance events

Final acceptance commands:

```powershell
npm run loot:balance
npx tsc --noEmit
npm run ci:changed
npm run gate
```

The PR should report the exact command outcome and exact candidate SHA. A
previous green run is evidence, but it is not a substitute for final-SHA CI.

## Screenshot evidence contract

The checked-in gallery contains 25 reproducible 1440 by 900 captures:

- files 01 through 09 show cloth, leather, mail, melee, caster, ranged,
  jewelry, shield, and caster-offhand icon families at inventory scale
- file 10 is the complete 28-pixel icon contact sheet
- files 11 and 12 show all named Legendary icon variants
- files 13 and 14 show the same Spiritual Gravecaller Ring with different
  Spirit rolls in normal and Alt-range tooltip modes
- files 15 and 16 show boss-targeted Ashbinder's Seal and Dawnward Signet
- files 17 through 22 show Common, Rare, and Epic weapon, cloth, leather,
  jewelry, and staff examples in normal and Alt-range modes
- files 23 through 25 show three copies of Ashbinder's Seal with 15%, 17%,
  and 20% power rolls, distinct affixes, equipped comparison, and Alt ranges

The capture harness validates the exact 25-file manifest, nonzero dimensions,
unique content hashes, tooltip visibility, rarity coverage, roll variance,
advanced-range state, comparison state, icon loads, and absence of capture
overlays. It completed 173 assertions on the final source tree.

Screenshots are presentation evidence. They must be captured from the final
source after localization and icon integration. The PR body embeds all 25
tracked files from this manifest.

## Remaining limitations to disclose

- No pity or bad-luck protection in v1.
- Shared boss corpse, not one personal roll per player.
- Boss targeting is strong but not exclusive.
- Smart loot is a weight, not a guarantee.
- The contribution harness is not a full encounter or economy simulator.
- Current visuals use the launch icon catalog; a larger rarity-specific art
  expansion is a separate product scope.
- Visual review covers desktop at 1440 by 900 and device pixel ratio 1; it is
  not a formal screen-reader, mobile, localization, or WCAG certification.
