# Tracked items: per-copy UUIDs and provenance for epic and legendary gear

Every physical copy of an epic or legendary item carries a unique item ID
(a UUID) and a provenance record: who first obtained it, when, from what
source, where, and every character it has changed hands to since. The record
lives on the copy itself, so it follows the item through every container in
the game, and the authoritative server mirrors every mint and transfer into
an append-only ledger an operator can query by item ID.

## What is tracked

A copy is tracked when its effective quality (the copy's own rolled quality
over the def's, `effectiveQuality` in `src/sim/equipment_rules.ts`) is in
`TRACKED_ITEM_QUALITIES` (`src/sim/item_provenance.ts`: epic and legendary)
AND the def is one-per-slot (`stackSizeOf` is 1). Stackable epics (mount
reins, consumables) are not tracked: a tracked copy is one-per-slot by
construction, and a guid on a stackable would fragment its stack. Bags are
not tracked either: a bag is declared payload-free (`equipBag` in
`src/sim/bags.ts`, #2837), so a minted bag could never be worn.

Because every tracked copy now carries a payload, it travels the instanced
pipes (the single-copy market listing, the instanced mail parcel, the
instanced loot slot), never the plain fungible ones. Two consequences are
deliberate: a World Market buy order for a tracked def is refused at
placement (`src/sim/market_orders.ts`), since an order only fills from plain
fungible stock and could never be filled; and a payload-free tracked grant
keeps the plain arm's gear auto-equip (`autoEquipsInstanceGrant` in
`src/sim/auto_equip.ts`, the headless env's `autoEquip`).

## Where the data lives

`ItemInstancePayload` (`src/sim/types.ts`) gained two additive, optional
fields:

- `guid`: one canonical lowercase UUID per copy, minted once and never
  rewritten.
- `provenance`: an `ItemProvenance` record: the origin holder (`at`, `by`,
  `byId`), the `source` id (`mob:<templateId>`, `quest:<questId>`,
  `craft:<recipeId>`, `vendor`, `dev`, `world`, `legacy`, `promotion`,
  `guildBank`, `restore`, `boost`), the `zone` or dungeon id, the optional
  `derivedFrom` guid of the copy it was made from, the bounded `owners` chain
  (the most recent `MAX_ITEM_OWNER_HISTORY` hands, oldest first) and the true
  `transfers` count.

Both are owner-only on the wire: the peer inspect allowlist
(`server/equipped_instance_wire.ts`) and `publicInstanceView`
(`src/sim/item_instance_transfer.ts`) leave them out, so an inspecting player
or a market browse row never sees them.

## Where the stamps happen

- **The inventory hub** (`Sim.addItem` / `Sim.addItemInstance`, delegating to
  `src/sim/item_tracking.ts`): a tracked def granted with no payload takes
  the instanced arm; each copy is minted with its own guid and origin record.
  A grant flagged `movement` (trade, mail, market, commission delivery) of a
  copy that already carries a guid appends the recipient to the owner chain,
  unless the recipient is the holder the record last saw (a trade rollback,
  an enchant re-mint, a buyback), which records nothing. A plain
  pre-tracking copy first seen while changing hands is minted with source
  `legacy`.
- **Grant sources**: the corpse loot pickups and awards pass
  `mob:<templateId>` (`src/sim/loot/awarded_loot_hold.ts` `mobLootSource`),
  quest turn-ins pass `quest:<id>`, vendors `vendor`, `/dev give` `dev`. A
  crafted copy derives `craft:<recipeId>` from its craft marker. Anything
  unlabelled records `world`.
- **The legendary promotion** (`src/sim/professions/perfecting.ts`): a
  Perfected copy promoted in place is stamped then, source `promotion`.
- **The guild bank withdraw** (`src/sim/guild_bank.ts`): the move bypasses
  the hub, so the withdrawing character is appended there, source
  `guildBank`.

## Lineage: one guid, one live copy

The guid belongs to the physical copy for its whole life:

- **Changed in place** keeps the guid and writes a `modify` row: a
  Perfecting attempt (the new rank), the legendary promotion, a Perfecting
  swap (each side's row names the other copy in `related_guid`), an enchant
  apply or replace (Lucent infusion included), a Rift Forge upgrade or gem
  socket, a Maker's Bond unbind.
- **Ended** writes a final `consume` row naming what it became: sundering,
  salvage (Rift bands included), disenchant, destroying from the bags, falling
  off the end of the vendor buyback list (the sale itself is not the end: a
  buyback returns the same copy to the same holder), learning a pattern, being
  spent as a craft reagent, and the deletion of the holding character.
- **Became a different item** mints a NEW guid as a `derive` row whose
  `related_guid` and `provenance.derivedFrom` name the parent, while the
  parent's `consume` row names the child (an upgrade recipe such as
  `recipe_clockreel_fishing_rod`, which consumes a tracked rod).
- **Re-created**: an admin restore mints a new guid labelled `restore`
  (optionally a `derive` of the lost copy's guid, which support enters in the
  restore form), never the lost copy's own guid, since the "lost" copy may
  still exist somewhere. PBE boost kit gear is labelled `boost`.
- **Guarded**: `grantTrackedInstances` never lands two live copies with one
  guid; a payload that already carries one granted with `count > 1` keeps it
  on the first copy and mints the rest as `derive`s of it.

The `source` on these rows names the action: `perfecting`, `promotion`,
`perfectingSwap`, `enchant`, `riftForge`, `riftSocket` and `unbind` for a
`modify`; `sunder`, `salvage`, `disenchant`, `discard`, `vendor` (detail
`buybackExpired`), `pattern`, `craft:<recipeId>` and `characterDelete` for a
`consume`. Every crafted tracked copy is minted with `craft:<recipeId>`. The
`characterDelete` rows are written inside the delete's own transaction
(`server/character_delete_item_ledger.ts`), one per tracked copy the stored
character held, so they land exactly when the delete does.

The copy-choice walks that destroy "the least special copy first" (an
untargeted disenchant or sunder) read a copy whose payload is only its
tracked identity as plain (`isPlainCopy`, `src/sim/item_plain_copy.ts`), so
a Perfected copy is never spent while an ordinary one sits in the bags. The
same rule keeps the bag corner glyph off an ordinary epic and lets the
market's "lowest price of each" view collapse ordinary epic listings.

So a guid seen in any row after its `consume` row is a duplicated copy. The
change history lives in the ledger only; the copy's own payload stays small
(`derivedFrom` is the one lineage field on it).

## What the ledger cannot prove

- **Crash rollback.** Ledger rows are written as the events happen, but a
  character save lands up to `AUTOSAVE_SECONDS` (`server/game.ts`) later, so
  after a crash the ledger can hold mints, transfers and changes that never
  persisted. A transfer row read against a rolled-back save is not, on its
  own, proof of a duplicate: compare against the saves on both sides first.
- **Offline edits.** Scripts that edit stored character JSON directly (item
  moves, one-off migrations in the Rift Forge rollback style) bypass the
  inventory hub and write no rows. Such a script must either write its own
  ledger rows or be noted in the incident record, so a support lookup is not
  surprised by a copy that moved without a trace.

## The guid mint

The host supplies randomness through `SimConfig.mintItemGuid`: the server
binds `crypto.randomUUID` (`server/sim_boot_config.ts`), the offline client
its browser crypto (`src/game/item_guid_mint.ts`). With no host mint (tests,
headless), `deterministicItemGuid` derives a version 8 UUID from the world
seed, the tick, a per-Sim mint ordinal, the item and the recipient: no rng
draw either way, so the shared draw order (`tests/parity`) never moves.

## Persistence and load bounds

The fields ride the existing per-copy payload through every container save
(bags, bank, vault, buyback, equipment, guild bank, mail and market escrow).
`sanitizeItemInstancePayloadOnLoad` (`src/sim/item_instance_load.ts`) drops a
malformed `guid` alone and judges `provenance` atomically (the `partyTrade`
doctrine). The Rift band rebuild (`src/sim/rift/progression.ts`) passes both
through validated, since every band is epic.

## The server ledger

The sim emits the server-only `itemTracked` event per lifecycle step
(`ITEM_TRACKED_KINDS` in `src/sim/item_provenance.ts`: `mint`, `transfer`,
`modify`, `consume`, `derive`), with a short `detail` and the `related_guid`
a swap or derivation names. `server/event_record_observers.ts` routes it to
`server/item_ledger.ts`, which mirrors it fire-and-forget into `item_ledger`
(`server/item_ledger_db.ts`), indexed by guid, character and item. Retention:
`ITEM_LEDGER_RETENTION_DAYS` (0 keeps forever). Operators read it through the
admin dashboard's Item Tracking page (`GET /admin/api/item-ledger` for the
recent feed, `GET /admin/api/items/:guid` for one copy's history, its
`:guid` decoded by the operator loader `requireAdminGuidTarget`), gated on
`support.read`.

## The player surface

The item ID is never shown to a player: it is a server and operator fact.
Right-clicking a tracked copy in the bags offers "Item history"
(`src/ui/bag_item_context_menu.ts`), which opens a read-only prompt
(`src/ui/item_history_dialog.ts`, lines from `src/ui/item_history_view.ts`)
showing the origin line (looted by, quest reward to, or obtained by), one
row per later hand, and the count of earlier hands that rolled off the
bounded chain. The tooltip itself carries no tracking lines.

## Pins

`tests/item_provenance.test.ts` (the leaf), `tests/item_tracking.test.ts`
(the hub, the boundaries, the transfers, bags, auto-equip, derive and the
duplicate guard), `tests/item_lineage_modify.test.ts` (the in-place rows),
`tests/item_tracking_consume.test.ts` (the end-of-life and derive rows),
`tests/server/character_delete_item_ledger.test.ts` (the delete rows),
`tests/item_history_view.test.ts` and `tests/item_history_dialog_dom.test.ts`
(the right-click history), `tests/server/item_ledger.test.ts` (the ledger
and the event frame), `tests/server/admin_runtime_restore_lineage.test.ts`
(the restore derive), and the admin route cases in
`tests/server/admin.test.ts`.
