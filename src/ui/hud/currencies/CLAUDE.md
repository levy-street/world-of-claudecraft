# src/ui/hud/currencies/ - the Currencies tab

The character window's Currencies tab: every spendable balance that is not
coin, so none of them has to sit in the bags to be seen.

- `currencies_view.ts` is the pure core (`UI_PURE_CORES`): the activity rows
  (Heroic Mark counted across the bags, Honor with its lifetime total, Delve
  Marks, the $WOC token) and one PENDING row per allied faction. Faction
  currency is a Stage 2 decision of the World Quests scope; standing is not a
  currency and lives on the Reputation tab.
- `currencies_tab_html.ts` is the thin painter: it injects the wallet reads
  (`src/ui/wallet_balance.ts`, host state) into the core and paints the rows
  with the committed currency art (`src/ui/currency_art.ts`). Names and notes
  are catalog keys under `hudChrome.currencies.*`; the Heroic Mark keeps its
  item name key.
- The Heroic Mark is still an inventory item (heroic_vendor_view.ts prices in
  it); this tab only counts it. Moving it out of the bags is a model change,
  not a tab change.
