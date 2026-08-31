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

SOL, USDC, and WOC amounts must continue to be quoted by the economy service from the USD value.
The WOC rail should return the service-controlled discount (20 percent by default). Operators can
change that base discount in the internal dashboard without rebuilding the game. The game client
displays the returned discount and quote and does not calculate token prices. All three native
rails flow through the same native quote, confirm, and purchase endpoints proxied by the game
server (`server/claudium_proxy.ts`); the economy service decides which rails are offered via its
native rails response (`rails.sol`, `rails.usdc`, `rails.woc`), so enabling or disabling USDC is
an economy-service deployment change, not a game-repository change.

## Weapon cosmetic identifiers

The game mechanical registry is `src/sim/content/weapon_skins.ts`. It owns IDs, models, rarity,
and stable collection IDs, but no player copy or price. English names, looks, and lore live in
`src/ui/i18n.catalog/armory.ts`. The companion economy-service deployment catalog is
`catalogs/claudium_catalog.season1.json`; it is the sole authority for availability and Claudium
cost. A storefront product is purchasable only when the same `itemId` exists in both files and the
service returns a valid positive cost. A missing service row remains visible as unavailable and
the game does not synthesize a fallback price. Every weapon cosmetic row in the service catalog
must use `kind: "skin"`; legacy `kind: "item"` rows are not Season 1 Armory products and are
filtered out by the game client.

The current companion service catalog publishes these tier prices for the game registry's products:

| Collection | Claudium cost | Service `itemId` values |
|---|---:|---|
| Guildmark | 200 | `guildmark_arming_sword`, `brasscap_axe`, `tempered_flanged_mace`, `guildmark_dirk`, `brasscrown_staff`, `lacquered_wand`, `fletcher_s_guild_bow` |
| Emberwrought | 1,000 | `cinderbrand_sword`, `emberbite_axe`, `smoulderfall_mace`, `ashspark_dagger`, `forgeheart_staff`, `emberwrought_wand`, `cinderlatch_crossbow` |
| Hoarfrost | 3,000 | `ice_fang_sword`, `glaciersplit_axe`, `rimecrusher_mace`, `frostbite_dagger`, `hoarfrost_vigil_staff`, `everwinter_wand`, `winterbite` |
| Fallen Star | 5,000 | `solheim_sword`, `skyrender_axe`, `starfall_mace`, `astravyr_dagger`, `cosmarch_staff`, `emberwish_wand`, `encore_bow`, `meteorlatch_crossbow` |

Do not copy the retired placeholder `purple_*`, `redskull_*`, or `emberfang_sword` rows into the
weapon storefront. Keep product IDs in lockstep across both registries. Update Claudium costs only
in the companion service catalog. The initial category is `weapons`. Future `outfits` or `mounts`
require an explicit game registry, allowlist, and UI update plus matching service rows; adding a
service-only row does not make a new category purchasable.

## Bank storage products

Bank capacity is the second Claudium product family and the first that is not cosmetic. It
follows the weapon pattern. The game mechanical registry is
`src/sim/content/storage_charters.ts`: it owns ids and slot grants and carries no price, no
display name, and no store copy. Display names are `t()` keys in
`src/ui/i18n.catalog/hud_chrome.ts`. The companion economy-service deployment catalog
(`catalogs/claudium_catalog.season1.json`, rows with `kind: "storage"`) is the sole authority for
price and availability. A storage product is purchasable only when the same `itemId` exists in
both files and the service returns a valid positive cost, and `isKnownStorageSkuId` re-filters
every service row so the service cannot mint an id the game registry does not carry.

Two shapes ship. The bundle charters grant a fixed number of gold-ladder rungs:

| Service `itemId` | Grant | Sold as |
|---|---:|---|
| `strongbox_charter_1` | 2 rungs | Lesser Strongbox Charter |
| `strongbox_charter_2` | 4 rungs | Greater Strongbox Charter |
| `strongbox_charter_3` | 8 rungs | Grand Strongbox Charter |
| `strongbox_charter_complete` | the full ladder | Complete Strongbox Charter |

The single-rung SKUs are the `strongbox_rung_NN` family, one per index of
`BANK_EXPANSION_PRICES`, each granting one rung and carrying the `ladderIndex` it buys. They are
the second price tag on the banker's own button and never appear in the store grid. The bundles
carry no `ladderIndex` at all, which is the filter that keeps the two apart, and
`storageRungSkuForLadderIndex` is the registry answer to which SKU is a character's next rung, so
no surface spells a `strongbox_rung_NN` literal.

### The rules that keep bank storage fair

These are doctrine. A change that breaks one of them is a change to what this store is, not a
feature, and it should be refused at review unless the maintainer has decided otherwise.

**1. Full gold parity. Claudium never reaches a capacity gold cannot.** Both rails advance the
same counter, `meta.bank.purchasedSlots`, in the same whole rungs of `BANK_EXPANSION_SLOTS`.
`bankBuySlots` (gold) and `bankGrantStorageSlots` (Claudium) are its only two writers outside the
guild ladder, and that grep is the real enforcement: no test drives both rails through one
counter. The largest charter grant equals the full ladder rather than exceeding it, pinned by
`tests/storage_charters.test.ts`. Write the ceiling carefully: the purchasable ladder is
`BANK_EXPANSION_PRICES.length` rungs, and a full character holds `BANK_BASE_SLOTS` plus that
ladder plus up to `BANK_MAX_BONUS_SLOTS` of server-stamped bonus slots, which are not purchasable
on either rail.

**2. Grants are per character.** The Claudium balance is per account and weapon skins are
per-account entitlements, so storage is the one family whose product lands on a character. It is
enforced at three independent points: the applier writes into the resolved character's own bank
blob, the purchase refuses unless the account has exactly one live character session
(`no_live_character`), and both the in-flight mutex and the pending row are keyed on
`characterId`. The shipped player copy says so in every arm.

**3. Carried inventory is never a Claudium product.** **4. The guild bank is never a Claudium
product.** **5. Materials Vault caps are never a Claudium product.** All three hold structurally
rather than by a rule that names them, and no negative test asserts any of them. What holds the
line is that `STORAGE_SKUS` is the entire storage catalog and every entry grants bank ladder
slots only, that `isKnownStorageSkuId` gates both the store filter and the spend branch, and that
`bankGrantStorageSlots` is a single applier that writes nothing outside `meta.bank`. Selling bag
space, guild bank rungs, or vault ceilings would therefore take a registry row **and** a new
applier. That second half is the change a reviewer must refuse. The guild bank is separately
un-tunable as well: `GUILD_BANK_RUNG_PRICES` is deliberately outside the price seam.

**6. Storage SKUs are repeatable, so they carry no ownership.** A storage spend records no
service-side ownership entry and never reads `owned`. A storage row's `owned` is false forever and
must never be interpreted; visibility is fit gating only. Nothing in this repository writes or
reads an ownership record for a storage SKU, so a diff that starts to is the violation to refuse:
`isKnownStorageSkuId` is the whole admission gate. Do not describe these
purchases as deduplicated the way skins are. There is no ownership row to dedupe against: the
guarantee is exactly-once per idempotency **key**. `BankState.appliedStorageKeys` rejects a replay
inside the live character state, while `storage_purchase_applied_receipts` is the deletion-proof
durable authority if an older binary strips that blob field. The character blob, receipt, and
Claudium audit row commit together. The current cap is twelve purchased expansions (72 actual
`purchasedSlots`), so a character needs at most twelve successful receipts to fill it with
single-rung purchases. The same SKU can still be bought again under a new key while another rung
remains.

The operational authority is deliberately stricter than the UI mutex. PostgreSQL permits at most
one `pending` storage purchase per character, even across realm processes. A fresh request owns a
short database spend claim; an existing row never authorizes a second economy-service call, and a
recovery worker must acquire and revalidate its own opaque claim before it can delete, settle,
grant, or stage the atomic save. Claim expiry permits takeover after a crashed process, but never
authorizes a stale reply. Character and account deletion are database-refused while either a
`pending` or `unresolved` purchase still carries money-side uncertainty; support must let recovery
finish or resolve the case first.

**7. A charter is offered only when its full grant fits.** There is no partial clamping and no
prorating: `bankGrantStorageSlots` run with `{ dryRun: true }` answers `fits`, `does_not_fit` or
`not_next_rung` against the same body the real apply uses, so the request-time check and the
apply-time re-check cannot drift. The store hides a charter that cannot fit whole. Keep the
distinct silences distinct: the fit answer is unknown until the always-available ladder read
arrives, the ladder can be full so that nothing will ever fit again, and no charter fitting is
different from both, because gold can still sell the remainder.

**A chargeback never claws back granted slots.** There is no un-grant path anywhere in the tree
and there must not be one. A paid receipt that cannot be applied settles as `unresolved` for
operator attention: never a clawback, never a partial apply. The rule is stated at the code sites
in `server/storage_purchases.ts` and `server/storage_purchase_db.ts`, and the code-level half is
pinned by `tests/server/storage_purchases.test.ts`. Chargeback consequences stay service-side and
follow the existing weapon-skin policy, which this repository cannot test. Building an un-grant
path would be a doctrine change, not a feature.

**Personal storage prices are server-tunable on both rails, and no storage surface renders a
conversion rate.** The gold rail is one JSON environment variable, `STORAGE_PRICES`, covering
exactly the three personal-storage dimensions the seam declares (bank slot expansions, bank bag
sockets, and Materials Vault rungs); the guild bank rung ladder is deliberately excluded and
stays compiled-only, so do not write that every price in the game is tunable. It is boot-time
only, accepted per dimension at the exact compiled length, and a rejected dimension falls back to
its compiled default by itself and says so on the boot log. The Claudium rail is never computed
in the game at all: prices arrive only from the service catalog, go absent past their staleness
bound rather than serving a guess, and are re-validated at spend. No storage or Claudium store
surface prints a gold-to-Claudium equivalence, and none should. Scope that claim when you repeat
it: the $WOC rail deliberately quotes a USD-to-token rate on the trade and market windows, so the
rule is about the gold and Claudium pair, not about rates in general.
`tests/storage_price_guard.test.ts` catches a price table or resolver reaching a client surface,
but it cannot see prose, so new copy still needs a human read.
