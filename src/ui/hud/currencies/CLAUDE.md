# src/ui/hud/currencies/ - the Currencies tab

The character window's Currencies tab: every spendable balance that is not
coin, so none of them has to sit in the bags to be seen.

- `currencies_view.ts` is the pure core (`UI_PURE_CORES`): the activity rows
  (the Heroic Marks and Lantern Seals balances, Honor with its lifetime total, Delve
  Marks, the $WOC token) and one PENDING row per allied faction. Faction
  currency is a Stage 2 decision of the World Quests scope; standing is not a
  currency and lives on the Reputation tab.
- `currencies_tab_html.ts` is the thin painter: it injects the wallet reads
  (`src/ui/wallet_balance.ts`, host state) into the core and paints the rows
  with the committed currency art (`src/ui/currency_art.ts`). Names and notes
  are catalog keys under `hudChrome.currencies.*`; the Heroic Mark keeps its
  item name key.
- Heroic Marks are a currency counter (`IWorld.heroicMarks`, owned by
  `src/sim/heroic_marks.ts`), not a bag item; the tab and the Heroic
  Quartermaster window read the same balance.
- Lantern Seals are the same kind of counter (`src/sim/lantern_seals.ts`), read
  through `IWorld.guildContracts.seals`; the tab and the Guild Hall
  quartermaster read the same balance.
