# Emberfall Phoenix token disposition

Keep `whistle_emberfall_phoenix` as a legacy item with its existing procedural icon;
do not commission a new companion painting or restore the companion in this task.

Evidence on the integration-45 task base:

- `src/sim/content/buddies.ts`: `BUDDIES` contains Horse, Crystal Lich, Forgemaw and
  Sapling. Emberfall Phoenix survives only in the historical key union.
- `src/sim/content/items.ts`: the old whistle definition is retained for existing inventories.
- `tests/buddy_retirement.test.ts`: Emberfall Phoenix is in `RETIRED_KEYS`; grants,
  summons and token use are refused without consuming saved tokens. Retired ownership
  and pending rewards are dropped during save restoration.
- `archived-features/buddies-and-cosmetics/README.md`: retired models and snapshots
  are archived outside the shipped runtime; historical tokens remain for old saves.
  Its roster text predates the restoration of Sapling, so current code/tests own the roster.

This resolves the audit row as an intentional retired-token exception, not as painted
art. The item remains explicitly in `BUDDY_ART_PENDING_ITEM_IDS`, and the item-art audit
continues to count it as pending. No save behavior, acquisition source or runtime model
is changed. Revisit its art if the companion is restored.
