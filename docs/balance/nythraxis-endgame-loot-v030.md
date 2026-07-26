# Nythraxis Endgame Loot and Deathless Forge v0.30

Date: 2026-07-26

Release target: v0.30

Status: release-candidate contract for PR #2376

This document is the authoritative player, balance, and maintainer specification
for the Nythraxis endgame reward loop added by the procedural-loot release. It
answers what drops, how often it drops, why Normal and Heroic remain useful,
how deterministic progression coexists with random chase loot, how repeated
Legendaries vary, and how the implementation protects existing items.

The generic procedural item and named-power systems remain documented in:

- `docs/balance/procedural-loot-generator-v1.md`
- `docs/balance/procedural-legendary-v1.md`
- `docs/balance/procedural-loot-pr-evidence.md`

## Product goals

The raid reward loop is designed around five goals:

1. Every eligible Nythraxis kill produces an equipment decision for the raid.
2. Heroic has visibly and mechanically better rewards than Normal.
3. Natural drops preserve the excitement and variance of a long-term chase.
4. Repeated clears always advance a deterministic, player-selected reward path.
5. A first Legendary unlocks a build while later copies and tuning can still be
   meaningful upgrades.

The result is not a pure lottery and it is not a fixed vendor checklist. The
shared drop creates group excitement, personal currencies prevent a dry night
from being wasted, targeted signatures give Nythraxis a specific identity, and
the Deathless Forge provides a finite backstop without removing roll variance.

## Direct answers

### What drops from Nythraxis?

Every eligible kill appends exactly one shared procedural equipment item to
Nythraxis's corpse. This is additive to the raid's existing authored loot.

Every eligible participant also receives personal progression currency:

| Difficulty | Shared procedural item | Personal Deathless Fragments | Personal Heroic Marks |
| --- | --- | ---: | ---: |
| Normal | Exactly one | 1 | 0 |
| Heroic | Exactly one | 3 | 3 |

The procedural item is resolved through the existing loot mode. Need, Greed,
Pass, Round Robin, Group Loot, and Master Loot continue to use the same
authoritative settlement rules. The currencies are not placed on the shared
corpse and are not divided by raid size.

### What are the exact rarity chances?

The shared item always exists. Its rarity and item level are:

| Difficulty | Rare | Epic | Legendary |
| --- | ---: | ---: | ---: |
| Normal | 65% at item level 27 | 33% at item level 28 | 2% at item level 32 |
| Heroic | 40% at item level 31 | 55% at item level 32 | 5% at item level 36 |

Common and Magic cannot appear in the Nythraxis raid table. Heroic moves 25
percentage points from Rare into Epic or Legendary, raises each rarity by four
item levels, and raises the Legendary entry rate from 2% to 5%.

Expected natural Legendary intervals are 50 Normal kills or 20 Heroic kills.
Those are means, not guarantees.

### What is the chance of seeing a natural Legendary over time?

For independent kills with Legendary chance `p`, the chance of at least one
Legendary after `n` kills is `1 - (1 - p)^n`.

| Kills | Normal at 2% | Heroic at 5% |
| ---: | ---: | ---: |
| 1 | 2.000% | 5.000% |
| 5 | 9.608% | 22.622% |
| 10 | 18.293% | 40.126% |
| 14 | 24.636% | 51.233% |
| 20 | 33.239% | 64.151% |
| 25 | 39.654% | 72.261% |
| 45 | 59.712% | 90.056% |
| 50 | 63.583% | 92.306% |
| 59 | 69.637% | 95.151% |
| 90 | 83.769% | 99.011% |
| 100 | 86.738% | 99.408% |

Natural drops have no pity counter. The deterministic Forge is the protection
against an indefinitely unlucky acquisition path.

### Does Nythraxis have specific Legendaries?

Yes. Nythraxis strongly targets two signature powers:

| Signature | Compatible base | Class | Variable power range |
| --- | --- | --- | --- |
| Dawnward Signet | Gravecaller Ring | Paladin | 16% to 22% shield |
| Feral Moonclasp | Gravecaller Pendant | Druid | 4 to 7 resource |

When Nythraxis rolls a natural Legendary, generation first has an 80% branch
preference for a compatible signature base and then an 80% branch preference
for a compatible signature power. These are preferences, not exclusive loot
locks. The remaining branches preserve unexpected compatible Legendaries, and
the signatures can still appear from another compatible source.

Class-required powers are limited to classes represented in the eligible loot
roster. For example, a raid with no Paladin cannot receive a Dawnward Signet
as its class-required shared Legendary. This prevents a rare 2% or 5% event
from being consumed by a class that is not present.

The Deathless Forge can create an exact Nythraxis signature, so the targeted
boss identity remains meaningful even for a player who never wins the natural
version.

### Can two copies with the same Legendary name be different?

Yes. A name identifies the base and power identity, not a fixed stat line.
Two Dawnward Signets can differ in:

- their three or four affix families
- each affix tier and final value
- the Legendary shield magnitude
- their exact generated item name prefix and suffix
- their immutable source, seed, and item UID
- whether they are Normal or Heroic Raid-forged copies

A Normal Dawnward Signet can roll any quantized power value from 16% through
22%. A Heroic Raid-forged Dawnward Signet is remapped into the upper half of
that authored range and therefore rolls 19% through 22%. A Normal Feral
Moonclasp can roll 4 through 7 resource; a Heroic Raid-forged copy rolls 6 or
7 after midpoint quantization.

Example copies of the same identity:

| Copy | Source | Item level | Example power | Example affix direction |
| --- | --- | ---: | ---: | --- |
| Dawnward Signet A | Normal natural drop | 32 | 16% shield | Spirit and haste |
| Dawnward Signet B | Normal natural drop | 32 | 21% shield | Intellect and crit |
| Dawnward Signet C | Heroic natural or exact Forge | 36 | 22% shield | Spell power and stamina |

The examples illustrate legal variance rather than promising those exact
affixes from a particular seed. Persisted values are final and do not change
if balance tables are edited in a later release.

### Why does Heroic matter beyond a higher drop chance?

Heroic has four exclusive advantages:

1. Its shared items are four item levels above the same Normal rarity.
2. Its Legendary chance is 5% instead of 2%.
3. Its named Legendary magnitudes are guaranteed to the upper half of their
   authored ranges and use the Ascendant visual state.
4. Its clear awards Heroic Marks and unlocks Heroic Forge offers for the
   current reset.

This makes Heroic the best source of peak natural items and the gate to exact
endgame rewards. Normal remains useful for gearing, an independent natural
drop, and one additional Deathless Fragment each reset.

## Deathless Forge

The Heroic Quartermaster hosts the Deathless Forge. The server resolves every
offer from a closed allowlist. The client sends an offer ID, never arbitrary
item stats, rarity, power, or price.

### Offer and cost table

| Reward | Result | Cost | Heroic clear required this reset |
| --- | --- | ---: | --- |
| Chosen Normal procedural base | Epic, item level 28 | 20 Fragments | No |
| Chosen Heroic procedural base | Epic, item level 32 | 24 Fragments + 24 Marks | Yes |
| Chosen authored Heroic Epic | Exact authored item | 36 Fragments + 27 Marks | Yes |
| Chosen authored Heroic Legendary | Exact authored item | 60 Fragments + 45 Marks | Yes |
| Exact Nythraxis signature | Chosen compatible base and signature power, item level 36, Raid-forged | 60 Fragments + 45 Marks | Yes |
| Tune one exact Nythraxis Legendary | Same identity, best-of-two power improvement | 6 Fragments + 6 Marks | No additional clear gate |

All forged rewards bind to the purchaser. Procedural Forge rewards still roll
their affixes and legal values, so selecting the base or signature does not
turn the result into a fixed best-in-slot stat line.

The authored Heroic offer list is:

- Deathless Greatblade, Epic
- Scepter of the Deathless Court, Epic
- Stormcaller's Focus, Epic
- Heroic Deathless Heartwood, Legendary
- Heroic Kingsbane, Last Oath, Legendary

Only class-usable choices can be purchased. Invalid, retired, malformed, or
class-incompatible offer IDs fail before currency is spent.

### Deterministic acquisition timelines

Normal and Heroic have independent daily lockouts. A player can therefore
clear each difficulty once per reset and earn 4 Fragments plus 3 Marks per
day. The authoritative server resets raids at the next realm-local 03:00
boundary. Offline and headless hosts use their injected deterministic reset
seam.

The minimum reset counts below assume every relevant clear is successful:

| Goal | Normal only | Heroic only | Normal + Heroic each reset |
| --- | ---: | ---: | ---: |
| Normal procedural Epic, 20F | 20 | 7 | 5 |
| Heroic procedural Epic, 24F + 24M | Not possible | 8 | 8 |
| Authored Heroic Epic, 36F + 27M | Not possible | 12 | 9 |
| Authored Heroic Legendary, 60F + 45M | Not possible | 20 | 15 |
| Exact Raid-forged signature, 60F + 45M | Not possible | 20 | 15 |
| One Legendary tune, 6F + 6M | Not possible | 2 | 2 |

`F` means Deathless Fragments and `M` means Heroic Marks. These are finite
caps for a selected reward, not average natural-drop times. Currency spent on
one choice cannot also be spent on another, so a complete collection remains
a long-term raid objective.

### Exact-copy Legendary tuning

Legendary Tuning targets one exact bagged Nythraxis procedural Legendary by
its opaque UID. It does not target every item with the same display name.

For each stored Legendary roll key, tuning deterministically creates two legal
candidate rolls and keeps the maximum of:

- the current stored value
- candidate A
- candidate B

Tuning therefore never lowers a Legendary power. It can produce no numerical
change when the current value is already at least as high as both candidates.
That no-change chance is intentional and preserves a final optimization chase.

Tuning preserves:

- base and equipment slot
- rarity and item level
- Legendary power identity
- all affix families, tiers, and values
- generated name
- enchant and binding
- Raid-forged state
- source provenance

It mints a new UID and increments the reforge count, capped at 99. A stale UID,
spoofed UID, missing item, invalid payload, retired power definition, wrong
class, insufficient currency, death, distance failure, or full validation
failure spends nothing.

## Loot eligibility and raid fairness

### Need eligibility

Need is authoritative, not a cosmetic client choice. A player may Need only if
their class can equip the base. If a procedural Legendary power has a required
class, that class must also match. Invalid Need attempts are rejected before
the loot-roll RNG advances. Greed and Pass remain available.

The loot prompt carries a `canNeed` decision from the simulation so the UI can
disable Need and explain why, while the server remains the final authority.

### Present, absent, disconnected, and camping players

Reward and lockout settlement use one atomic roster decision:

- eligible credited players present at the kill receive currency directly
- an eligible participant who entered the instance but is absent at the kill
  receives the personal currency by the Nythraxis reward letter
- a raid member who never entered and did not participate receives no currency
- everyone in the owning raid or raid room is locked for that difficulty when
  the kill is credited, preventing an unlocked camper from reclaiming the raid
- a repeated settlement in the same reset cannot pay currency twice
- Normal and Heroic lockouts remain separate

The shared corpse item stays shared. Personal currency delivery does not clone
the equipment drop for each raider.

### Atomic transaction behavior

Forge and tuning operations validate access, item identity, class, reset gate,
cost, bag space, and payload before making an irreversible change. Currency is
removed only after every precondition succeeds. This blocks partial purchases,
stale-click losses, injected offer IDs, and tune-by-display-name ambiguity.

## Existing items and save compatibility

Existing items remain exactly as they are when this release is deployed.

- No authored item is converted into a procedural item.
- No existing affix, Legendary magnitude, enchant, signature, or binding is
  rerolled.
- Legacy quality, rolled-stat, and masterwork payloads remain valid.
- New `raidForged` and `reforgeCount` fields are optional and allowlisted.
- An old procedural item without those fields keeps its old behavior and art.
- Exact numeric rolls are persisted rather than recomputed from live tables.
- Corrupt payloads and duplicate procedural UIDs fail closed.

There is no destructive migration and no background normalization pass.

## Why this creates an endgame

The system supports several overlapping goals rather than one finish line:

1. Normal progression: obtain reliable Rare and Epic item-level 27 to 28 gear.
2. Heroic progression: replace it with item-level 31 to 32 gear.
3. Natural chase: pursue the 5% item-level 36 Raid-forged Legendary event.
4. Boss identity: target Dawnward Signet or Feral Moonclasp from Nythraxis.
5. Deterministic chase: bank 60 Fragments and 45 Marks for an exact signature
   or authored Heroic Legendary.
6. Roll optimization: compare affixes and upper-half Legendary magnitudes.
7. Tuning: spend repeat currency on the exact copy without risking a downgrade.
8. Collection: acquire multiple bases, class builds, authored items, and visual
   variants while the one-active-power cap prevents proc stacking.

Normal is useful but cannot complete the Heroic collection alone. Heroic is
both the peak random source and the required deterministic progression source.
Doing both difficulties shortens Fragment-limited goals without bypassing the
Heroic Mark gate.

## Balance and exploit controls

The raid layer inherits every generic generator control:

- no duplicate affix family on one item
- rarity-specific affix counts and roll floors
- item-level, slot, tag, equip, and tier gates
- a canonical normalized affix budget
- bounded and quantized Legendary magnitudes
- exact class and base compatibility
- one active Legendary power per character
- immutable persisted rolls and provenance

Raid-specific controls add:

- exactly one shared procedural entry per eligible kill
- fixed raid item levels rather than source-level drift
- closed rarity tables that sum to exactly 1
- absent-class exclusion for class-required powers
- Heroic upper-half power remapping
- difficulty-scoped daily lockouts
- personal currency deduplication
- closed Forge allowlists and authoritative prices
- soulbound deterministic rewards
- exact-UID tuning with no downgrade
- fail-closed validation and atomic spending

The release balance command and tests sample the live generator tables, not a
duplicated probability model. The final PR records the sample count, observed
rarity rates, power bounds, fingerprint, exact candidate SHA, and CI result.


### Recorded release-sized raid campaign

The live generator campaign completed on 2026-07-26 with seed `30037` and
100,000 items per difficulty, 200,000 total:

| Difficulty | Rare | Epic | Legendary | Maximum rate error |
| --- | ---: | ---: | ---: | ---: |
| Normal | 65,001, 65.001% | 32,968, 32.968% | 2,031, 2.031% | 0.032 points |
| Heroic | 39,818, 39.818% | 55,213, 55.213% | 4,969, 4.969% | 0.213 points |

The campaign also recorded:

- 200,000 unique UIDs
- zero missing guaranteed entries
- zero Common, Magic, or Mythic results
- zero wrong item levels
- zero duplicate affix families
- zero absent-class Legendary powers
- zero Raid-forged state errors
- every observed Normal power inside its full authored range
- every observed Heroic power inside its authored upper half
- verdict `READY`
- deterministic fingerprint `1d3acc91`

## Maintainer source map

| Concern | Authoritative source |
| --- | --- |
| Raid rarity, item level, currency, Forge prices | `src/sim/content/procedural_raid_loot.ts` |
| Live raid source routing | `src/sim/loot/procedural/live_drop.ts` |
| Generator forced levels, class roster, power floor | `src/sim/loot/procedural/generate.ts` |
| Boss signatures | `src/sim/content/procedural_legendary_sources.ts` |
| Reward and lockout settlement | `src/sim/encounters/nythraxis.ts` |
| Forge and exact-copy tuning | `src/sim/instances/nythraxis_forge.ts` |
| Need authority | `src/sim/loot/loot_roll.ts` |
| Raid-forged art resolution | `src/ui/procedural_item_art.ts` |
| Server reset boundary | `server/raid_reset.ts` |
| Transport command validation | `src/net/online.ts`, `server/game.ts` |

Primary focused tests:

- `tests/procedural_raid_loot.test.ts`
- `tests/procedural_raid_forge.test.ts`
- `tests/dungeons.test.ts`
- `tests/loot_roll.test.ts`
- `tests/loot_master_sim.test.ts`
- `tests/procedural_item_validation.test.ts`
- `tests/procedural_persistence_integration.test.ts`
- `tests/procedural_item_art.test.ts`
- `tests/item_icons.test.ts`
- `tests/world_api_parity.test.ts`
- `tests/snapshots.test.ts`

## Honest limitations

- Natural drops have no pity counter. The Forge is a deterministic purchase
  path, not a hidden forced natural drop.
- The equipment item is one shared raid roll, not one personal item roll per
  player.
- Signature targeting is strong but non-exclusive and compatibility-dependent.
- Exact signature forging controls identity, not affix perfection.
- Legendary tuning can make no numerical improvement on a given attempt.
- The Forge does not erase the time cost of collecting multiple rewards.
- Smart loot and roster filtering improve relevance but do not guarantee that
  every non-Legendary shared base is usable by every raider.
- Monte Carlo rarity and contribution reports are not a substitute for live
  encounter telemetry, economy telemetry, or future tuning.
- Screenshot review demonstrates the supported desktop flow but is not a full
  mobile, localization, screen-reader, or WCAG certification.

These limitations are deliberate and visible. They preserve a shared raid
moment, keep repeated clears valuable, and avoid representing a probability as
a guarantee.
