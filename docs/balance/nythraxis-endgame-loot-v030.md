# Nythraxis Procedural Raid Loot v0.30

Status: implemented on the procedural-loot feature branch.

## Product contract

Nythraxis progression comes from loot drops only.

- Every eligible final-boss corpse adds one shared procedural equipment item.
- The item uses the existing party loot and Need/Greed flow.
- The corpse item is the complete progression reward added by this system.
- Natural drops have no pity counter.

## Difficulty profiles

| Difficulty | Shared item | Rare | Epic | Legendary | Item levels |
| --- | ---: | ---: | ---: | ---: | --- |
| Normal | 1 | 65% | 33% | 2% | 27 / 28 / 32 |
| Heroic | 1 | 40% | 55% | 5% | 31 / 32 / 36 |

The item-level column is ordered Rare / Epic / Legendary.

## Shared corpse behavior

The procedural item is appended to the boss corpse after the authored loot roll.
It is one item for the raid, not one personal roll per participant.

The permanent boss contribution roster supplies class context for smart-loot
weighting. This improves the chance that the generated base is useful to the
present raid without making off-class results impossible.

The generated copy keeps the standard procedural identity payload:

- unique persisted UID
- base family and item level
- rarity
- affix families, tiers, and values
- generated name data
- Legendary power identity, revision, and rolled magnitude when applicable
- source and drop context used by authoritative validation

## Legendary behavior

Normal and Heroic both draw compatible named powers from the Nythraxis signature
catalog and the global compatible catalog.

Heroic natural Legendary drops are marked Raid-forged. This is a property of the
dropped item, not a vendor or crafting operation. Raid-forged powers roll in the
upper half of their authored range and use the Ascendant art state.

Repeated copies can still differ in compatible base, affixes, affix values, and
Legendary magnitude. The system intentionally preserves natural roll variance.

## Authority and persistence

The authoritative simulation generates the complete item. Clients receive only
the public item projection and never submit item stats, affixes, rarity, power,
or value.

The exact procedural copy survives bags, equipment, bank, trade, mail, reconnect,
and persistence round trips. UID uniqueness and payload validation remain part of
the release gates.

## Lockouts

Normal and Heroic Nythraxis lockouts are difficulty-scoped and expire at the
realm reset boundary. The lockout roster includes the owning raid claim and the
wide boss room so a group cannot evade a lockout through positioning.

The lockout changes eligibility for another raid clear. It does not create a
currency receipt, personal payout, or reward mail.

## Verification

The natural-drop balance harness samples both difficulty profiles and checks:

- configured rarity rates
- fixed rarity item levels
- unique UIDs
- legal, non-duplicated affix families
- class-compatible signature selection
- Heroic Raid-forged state and upper-half power magnitude
- deterministic output for a fixed seed

Focused behavior coverage lives in:

- `tests/procedural_raid_loot.test.ts`
- `tests/procedural_raid_balance.test.ts`
- `tests/dungeons.test.ts`
- `tests/loot_roll.test.ts`
- `tests/procedural_persistence_integration.test.ts`

The release command remains:

```powershell
npm run gate
```
