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
construction, and a guid on a stackable would fragment its stack.

## Where the data lives

`ItemInstancePayload` (`src/sim/types.ts`) gained two additive, optional
fields:

- `guid`: one canonical lowercase UUID per copy, minted once and never
  rewritten.
- `provenance`: an `ItemProvenance` record: the origin holder (`at`, `by`,
  `byId`), the `source` id (`mob:<templateId>`, `quest:<questId>`,
  `craft:<recipeId>`, `vendor`, `dev`, `world`, `legacy`, `promotion`,
  `guildBank`), the `zone` or dungeon id, the bounded `owners` chain (the most
  recent `MAX_ITEM_OWNER_HISTORY` hands, oldest first) and the true
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

The sim emits the server-only `itemTracked` event per mint and per recorded
transfer. `server/event_record_observers.ts` routes it to
`server/item_ledger.ts`, which mirrors it fire-and-forget into `item_ledger`
(`server/item_ledger_db.ts`), indexed by guid, character and item. Retention:
`ITEM_LEDGER_RETENTION_DAYS` (0 keeps forever). Operators read it through the
admin dashboard's Item Tracking page (`GET /admin/api/item-ledger` for the
recent feed, `GET /admin/api/items/:guid` for one copy's history), gated on
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
(the hub, the boundaries, the transfers), `tests/item_history_view.test.ts` and `tests/item_history_dialog_dom.test.ts`
(the right-click history), `tests/server/item_ledger.test.ts` (the ledger and the event
frame), and the admin route cases in `tests/server/admin.test.ts`.
