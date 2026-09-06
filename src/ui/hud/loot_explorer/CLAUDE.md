<!-- Area-scoped: src/ui/hud/loot_explorer/ only. src/ui/CLAUDE.md and
     src/ui/hud/CLAUDE.md stay canonical for the domain-extraction, painter,
     and i18n rules. -->

# src/ui/hud/loot_explorer/: the Loot Explorer window

A searchable, filterable catalog of every item and where it comes from,
browsable flat ("By Item") or grouped by encounter/difficulty ("By
Encounter"). Pure view core (`loot_explorer_view.ts`) + thin painter
(`loot_explorer_window.ts`), the deeds/reliquary/dungeon-finder family.

## Static content only, deliberately
A content browser, not live world state (mirrors the maintainer-facing
`scripts/export_loot_spreadsheet.mjs`), so per the Dungeon Finder precedent
(`src/ui/dungeon_finder_view.ts`) it needs **no `IWorld`/`world_api` facet**.
Do not add one speculatively.

## Source taxonomy
`LootExplorerCategory` mirrors `ReliquarySourceKind` (`src/sim/content/reliquary.ts`)
where they overlap: `raid`/`dungeon` classify off the Dungeon Finder's
authored `FinderActivity.kind`, never spawn lists; `delve` off each
`DelveDef.bosses` list; `open_world` is the fallback; `rift` reads the two
rank pool functions in `src/sim/rift/loot_pools.ts` (C = normal pool, B/A/S
share the heroic pool). Normal/heroic rows mirror the roller's own gate
(`lootEntryRollsOnClaim`) so a row never advertises a drop a kill cannot roll.

## Known scope gaps (documented, not silent)
- Delve trash and per-tier `DelveRewardTable` payouts are not catalogued,
  only authored boss drops (`DelveDef.bosses`): trash is procedural per run.
  Today's two delve bosses drop only copper, no `itemId`, so `delve` is
  currently empty; the classification is still correct.
- Rift legendary chase items (`RIFT_LEGENDARY_ITEM_IDS`) are not catalogued:
  their acquisition route was not confirmed as a chance roll during authoring.
