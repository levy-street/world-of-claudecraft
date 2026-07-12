# WOC Store and Claudium packs

The WOC Store reads cosmetic availability, Claudium costs, balances, and purchase results from
the economy service. The game client does not invent catalog entries or prices.

## Recommended USD packs

The previous ladder extended to USD 5,000 and USD 10,000. Those packs are not appropriate for a
consumer game store. The recommended replacement follows the familiar premium-currency range
used by established game storefronts while keeping the one Claudium equals USD 0.01 display peg.

| Pack key | USD price | Claudium credited | Bonus over peg |
|---|---:|---:|---:|
| `claudium_500` | $4.99 | 500 | 1 |
| `claudium_1050` | $9.99 | 1,050 | 51 |
| `claudium_2200` | $19.99 | 2,200 | 201 |
| `claudium_4000` | $34.99 | 4,000 | 501 |
| `claudium_6000` | $49.99 | 6,000 | 1,001 |
| `claudium_13000` | $99.99 | 13,000 | 3,001 |

The economy service should expose only these six SKU rows. Remove the old high-value rows rather
than hiding them in the client.

## Stripe configuration

Create one Stripe Price for each USD pack and configure the corresponding economy-service
variables. Suggested names are:

```text
STRIPE_PRICE_CLAUDIUM_500
STRIPE_PRICE_CLAUDIUM_1050
STRIPE_PRICE_CLAUDIUM_2200
STRIPE_PRICE_CLAUDIUM_4000
STRIPE_PRICE_CLAUDIUM_6000
STRIPE_PRICE_CLAUDIUM_13000
```

These names match the economy service implementation. Do not place Stripe secret keys or Price
IDs in the game-client repository.

SOL and WOC amounts must continue to be quoted by the economy service from the USD value. The WOC
rail should return the existing service-computed 20 percent discount. The game client displays
the returned quote and does not calculate token prices or discounts.

## Weapon cosmetic identifiers

The game registry is `src/sim/content/weapon_skins.ts`. The companion economy-service deployment
catalog is `catalogs/claudium_catalog.season1.json`. A storefront product is available only when
the same `itemId` exists in both files. Every weapon cosmetic row in the service catalog must use
`kind: "skin"`; legacy `kind: "item"` rows are not Season 1 Armory products and are filtered out
by the game client.

The current game and companion catalogs agree on these products and prices:

| Collection | Claudium cost | Service `itemId` values |
|---|---:|---|
| Guildmark | 200 | `guildmark_arming_sword`, `brasscap_axe`, `tempered_flanged_mace`, `guildmark_dirk`, `brasscrown_staff`, `lacquered_wand`, `fletcher_s_guild_bow` |
| Emberwrought | 1,000 | `cinderbrand_sword`, `emberbite_axe`, `smoulderfall_mace`, `ashspark_dagger`, `forgeheart_staff`, `emberwrought_wand`, `cinderlatch_crossbow` |
| Hoarfrost | 3,000 | `ice_fang_sword`, `glaciersplit_axe`, `rimecrusher_mace`, `frostbite_dagger`, `hoarfrost_vigil_staff`, `everwinter_wand`, `winterbite` |
| Fallen Star | 5,000 | `solheim_sword`, `skyrender_axe`, `starfall_mace`, `astravyr_dagger`, `cosmarch_staff`, `emberwish_wand`, `encore_bow`, `meteorlatch_crossbow` |

Do not copy the retired placeholder `purple_*`, `redskull_*`, or `emberfang_sword` rows into the
weapon storefront. Keep the two source files in lockstep whenever a product ID or Claudium cost
changes. The initial category is `weapons`; future catalog updates can add `outfits` and `mounts`
without changing the purchase flow.
