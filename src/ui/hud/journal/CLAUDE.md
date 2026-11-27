# src/ui/hud/journal: the Adventure Journal

One window (`#adventure-journal-window`) for every five-player dungeon and raid boss
page, in the spirit of a classic encounter journal: a Dungeons and Raids list with
expandable instances, a boss page with an overview, Normal / Heroic / Mythic tabs,
Overview (Strategy by role), Abilities (collapsible phases and mechanics) and Loot.
The PAGES are not here: they are journal sources in `src/ui/boss_journal/` (the
dungeon pages, the Smith's Heart in `raids/`) and the shipped raid guide
(`raid_boss_guide_view.ts`). This directory only arranges and paints them.

| Module | Role |
|---|---|
| `journal_catalog.ts` | The instance list, its order, each instance's tiers (Mythic only where a raid has it), the dev gate (`released`), room-to-instance and mob-to-page lookups. |
| `journal_nav_view.ts` | Pure core (`UI_PURE_CORES`): the grouped list, page state from `IWorld.dungeonRun` / `IWorld.raidRun`, the landing page (engaged boss, else next standing), neighbours, tier clamping. |
| `journal_loot_view.ts` | Pure core: a page's drops per difficulty, read off the Loot Explorer's index (the roller's own gate). Never a second loot table. |
| `journal_page_html.ts` | Markup strings only (no DOM): nav, header, tabs, Overview, Abilities, Loot, Coming soon. |
| `adventure_journal_window.ts` | The cold window (`UI_DOM_MODULES`): state, events, focus, tooltips, the 3D model slot. |
| `journal_launchers.ts` | Binds the side rail button, the phone More-tray button and the target frame's book. |

## Rules
- Entry points: `#mm-journal`, `#mobile-journal`, the `adventureJournal` keybind (Shift+J,
  routed by `collection_actions_core.ts`), `#tf-journal` (shown by Hud's per-frame
  `has-journal` class through the allocation-free `covers()`), and the Dungeon Finder
  (`openJournal`, `journalHasPage`).
- `syncRun()` runs from the party-frames tick and must stay a no-op on an unchanged room
  and run: both run views are reference-stable (pinned by `tests/adventure_journal_window.test.ts`).
- Numbers come from the sources, which resolve them from live tuning. Never type a number here.
- A new instance is a source plus one catalog row; Mythic is a tier entry, never content.
