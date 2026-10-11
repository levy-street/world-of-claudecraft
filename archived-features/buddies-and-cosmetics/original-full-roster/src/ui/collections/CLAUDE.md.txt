<!-- Local conventions for src/ui/collections/. Keep it short and anchored on
     stable symbols and pinned tests, never on counts. -->

# Collections

The Collections window: every buddy, every mount and every epic-or-better armour
set in the game, with where each one comes from. Opened from the micro-menu
button beside the PvP launcher (`#mm-collections`) or the `collections` keybind.

| Module | What it is |
|---|---|
| `collection_sources.ts` | **The derivation.** For an item id: its vendors, its drop tables, its bind state and its vendor sell value. For a buddy key (`buddySourceFacts`): the per-player boss rolls, the deed, and the grant token's vendors (`src/sim/content/buddy_sources.ts`). For a look id (`buddyCosmeticFacts`): its challenges, deed, crafting recipe, token vendors, and whether it is a seasonal grant. All read from the live content tables. Pure, memoized per id. |
| `collections_view.ts` | The pure view model: the three tabs as rows (a buddy row carries its collection state, its pending boss-roll flag, its own sources and its looks), plus the set grouping (armour type, then primary stat). DOM-free, i18n-free, and free of any `src/render` import. |
| `collections_window.ts` | The thin DOM painter and the window's view-state (tab, selection, render-skip signature, focus return). The buddy pane's two commands (summon/dismiss, wear/remove a look) go out through `IWorldBuddies`; the server re-validates both. |
| `collections_host.ts` | The construction bag Hud hands the window, plus the two things that need the render and net layers: the visual-key maps and the Exchange price lookup. |

## The rules that keep this window honest

- **Never author a source twice.** A row's drop, vendor, price and binding are
  DERIVED in `collection_sources.ts`. If a source is wrong on screen, the
  content table is wrong, or the derivation missed a table; do not add a lookup
  table here to paper over it.
- **List what a player cannot get yet.** An entry with no source renders as a
  real, dimmed row saying so. That is the window's whole point for collectors;
  filtering those rows out is a regression, and `tests/collections_view.test.ts`
  pins it.
- **One preview canvas.** The idle preview mounts Hud's SHARED turntable through
  the `mountPreview` dep. Never construct a `CharacterPreview` here: that would
  be a second WebGL context on a cold window (`src/render/CLAUDE.md`, "GPU
  work"). Visual keys resolve through `mobVisualKey`, the same lookup the world
  draws with, so a preview can never drift from the follower.
- **Live prices are per-SELECTION.** The World Market figure rides the existing
  at-the-Merchant `marketSellPriceCheck`; the Exchange figure is ONE
  price-ascending browse for the selected set's pieces. A whole-catalog price
  sweep needs a bulk server read that does not exist; do not fake it with a
  per-row fetch loop.
- **Say which state you are in.** "No listings", "shown at the Merchant" and
  "not available on this client" are three different answers and the pane keeps
  them apart. A blank or a stale figure is never acceptable on a price row.

Buddies are a per-character collection, never an item (`src/sim/buddies.ts`; design: `docs/design/buddy-acquisition.md`): the buddy tab reads ownership, looks, and pending wins off `IWorldBuddies`, and names each row after the companion itself rather than its grant token.

Pinned by `tests/collections_sources.test.ts`, `tests/collections_view.test.ts`,
`tests/collections_window.test.ts` and `tests/collections_exchange_price.test.ts`.
Screenshots: `scripts/collections_window_shot.mjs`.
