# Permanent loot quality

An enemy-dropped equipment copy can have a permanent quality above Ordinary.
Quality is independent of its green, blue, purple or orange item rarity. It does
not change the item's identity, artwork, binding rules, required level or effects.

## Eligibility and rates

Only uncommon-or-better weapons, armor and held offhands with an equipment slot
qualify. Jewelry is included. Roll after the enemy's ordinary loot table and
difficulty selection have selected an item, before anyone can inspect or claim
the copy. A stack of equipment rolls once per copy. Quality does not increase
the number of items dropped or their underlying drop chance.

| Quality | Badge | Added item levels | Chance per eligible copy |
| --- | --- | --- | --- |
| Ordinary | None | 0 | 90% |
| Superior | I | 2 | 9% |
| Exceptional | II | 4 | 0.9% |
| Magnificent | III | 6 | 0.09% |
| Transcendent | IV | 8 | 0.01% |

These are mutually exclusive outcomes, with the same rates for every eligible
source. Outdoor enemies, dungeon and raid enemies, world bosses and Rift enemy
rewards use this rule. Quest rewards, quest-specific drops, vendor purchases,
profession creation and generic item grants do not. Materials, tools, bags,
currency and consumables cannot qualify. An enemy-dropped copy of an item also
sold by a vendor can qualify; the vendor's copies remain Ordinary.

## Power and variation

Tier `t` starts from the realized ordinary item and adds the proportional budget
increase through `2 * (t - 1)` item levels. Only the final two item levels of
primary-stat budget are allocated randomly among primary stats the item already
has. A Transcendent item therefore has the guaranteed proportional increase of
six item levels, with the last two distributed according to its fixed allocation.

Use the existing item-budget curves. Two item levels are a budget delta, not two
literal stat points. Preserve authored off-budget stats and never reduce an
existing stat. Weapon damage, armor, spell/healing throughput and ratings use
their respective lanes. Weapon speed, enchants, socketed gems and special effects
are unchanged. Final combat values and tooltip comparisons share the same helpers.
The fixed class wand-bolt profile is independent of equipped mainhand damage and
remains unchanged; wand-named equipment still gains its normal quality bonuses.

Store a versioned tier and five bounded integer allocation weights on the item
instance. Do not store a new catalogue item, a private RNG seed or cached bonus
totals. The descriptor remains separate from profession `rolled.quality` and
enchantment `rolled.stats`. Ordinary items carry no descriptor, preserving old
save and inventory behavior.

## Upgrades and custody

Tier and allocation weights survive equipping, bank storage, buyback, trading,
mail, market escrow and save/load. Need/Greed and master loot distribute the
specific rolled copy and retain it on every fallback or full-bag return path.
Existing binding and eligible-party trade windows compose with the descriptor.
Direct trade retains its existing item-id/count staging policy: the authoritative
preview identifies the selected copies, and confirmation pins those identities.
It does not add a new per-copy trade selection command.

Rift bands retain three separate contributions: their ordinary rank baseline,
zero to five Essence upgrades, and permanent quality. An S band at the last
Essence upgrade is item level 34, 36, 38, 40 or 42 depending on quality. Socket
count and each gem's 12 rating are unchanged. Rebuilding a band after an upgrade
or socket change preserves its descriptor, and no primary stat may decrease as
Essence upgrades advance.

## Presentation

Keep existing rarity colors and item artwork. Enhanced copies have an additional
ivory/gold Roman-numeral badge and a translated quality name. Ordinary copies are
unmarked. Tooltips show the resolved item level and final stats; quality remains
visually separate from Rift rank, Essence progress and gem bonuses. The badge
must not cover other meaningful slot indicators and must remain understandable
without color. Item receipt and loot-roll displays carry the actual instance;
an item-id-only catalogue link cannot imply a particular rolled copy.

## Persistence and authority

The descriptor is a small optional member of the existing instance JSONB. No new
table, per-drop database query or save cadence is required. Validate its version,
tier, exact field set and fixed-length bounded weights on load; reject malformed
quality atomically. Clone the weights at ownership boundaries. Public inspect
and market projections expose quality without exposing binding or custody state.
Client commands may select an existing owned copy, but cannot mint or change its
quality. The shared deterministic simulation owns every quality draw.

Once enhanced bands have been minted, deployment is forward-only with respect to
older Rift sanitizers: the prior binary rebuilds a band without this descriptor
and would permanently strip its quality on load/save. A rollback or mixed-version
deployment requires a preservation-only compatibility patch on that older binary.
Compatibility with ordinary existing saves does not imply that older binaries
can safely rewrite newly enhanced items.
