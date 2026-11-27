# src/ui/hud/journal: the Adventure Journal

One window (`#adventure-journal-window`) for every five-player dungeon and raid boss
page, in the owner-approved "clean modern" look (a calm dark panel, one amber accent,
the system sans at 15px and up, Cinzel only for the boss name, no letter-spaced
capitals): a Dungeons and Raids list with expandable instances and a status under each
boss (Defeated, Next up, Final boss), a banner (circular portrait, "raid, boss N of M",
a one-line summary, stat chips, the Normal / Heroic / Mythic selector), underline tabs
for Overview (the encounter beside its 3D model, Strategy by role), Abilities (phase
headers with a health pill; each row shows what to do and opens on the full text plus
damage and timer chips) and Loot. On a phone the list is a drawer behind a breadcrumb,
with a row of the instance's boss portraits.
A light MMO layer sits on top of that look, never a redesign: a thin bronze frame with
corner marks and a lozenge emblem in the title bar (desktop only; the phone sheet has no
edge to frame), a darkened picture of the boss's room behind the banner, ability icons in
the action bar's own `.ui-socket`, drops as `.ui-socket--bag` slots rimmed in their
quality colour (hover or long-press opens the real item tooltip), danger skulls over each
difficulty (1, 2, 3), a page turn on opening and a soft click on a new tab or difficulty
(the game's sampled UI cues through `GameAudio`, so the SFX volume applies). No open or
close animation (the owner's call).
The PAGES are not here: they are journal sources in `src/ui/boss_journal/` (the
dungeon pages, the Smith's Heart in `raids/`) and the shipped raid guide
(`raid_boss_guide_view.ts`). This directory only arranges and paints them.

| Module | Role |
|---|---|
| `journal_catalog.ts` | The instance list, its order, each instance's tiers (Mythic only where a raid has it), the dev gate (`released`), room-to-instance and mob-to-page lookups. |
| `journal_nav_view.ts` | Pure core (`UI_PURE_CORES`): the grouped list, page state from `IWorld.dungeonRun` / `IWorld.raidRun`, the landing page (engaged boss, else next standing), the Next up mark, neighbours, tier clamping. |
| `journal_banner_view.ts` | Pure core: the phase pill's shape, an opened ability's fact chips (read off the ENGLISH summary template, so a swing count never becomes a timer), the list's status line. |
| `journal_loot_view.ts` | Pure core: a page's drops per difficulty, read off the Loot Explorer's index (the roller's own gate). Never a second loot table. |
| `journal_backdrop_view.ts` | Pure core: which room picture a page's banner shows (per instance, or per boss), else null for the plain banner. The files are committed WebP under `public/ui/journal/`, pinned both ways by `tests/adventure_journal_backdrops.test.ts`. |
| `journal_hit_icons.ts` | Pure: the death recap's icon lookup, one index over every catalog page (both tiers) of (dealer's mob template, damage label) to the mechanic's `iconId`, from the pages' `hits` and `hitSources`. A label matches only on the page whose body dealt it. |
| `journal_progress_view.ts` | Pure core: the personal layer of a page. Kills per difficulty from `IWorld.bossKills` (a council reads the member the sim keys it under), and the lockout from `IWorld.raidLockouts` with the sim's own ids: each instance's rooms are its Finder activity's, each room's lock belongs to the page holding that room's final boss, the boundary is the room's (weekly or the realm day). An instance whose rooms the sim never locks (the Smith's Heart today) shows kills only. |
| `journal_progress_html.ts` | Markup strings only: the "Your kills" strip under the banner chips, the lockout line ("Saved on Heroic: 1 of 2 bosses", resets in, and when) and the kicker's "Defeated this week" chip. |
| `journal_page_html.ts` | Markup strings only (no DOM): head, nav, the phone's breadcrumb and strip, banner, tab bar, Overview, Abilities, Loot, Coming soon. |
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
- The kill counts and lockouts are the character's, read through `IWorld` only; the sim
  raises a count at the real kill (`src/sim/boss_kill_tally.ts`) and stamps the lockouts.
  `syncRun()` also repaints when the reference-stable `bossKills` record moves and once
  the soonest lockout read at render runs out (never by comparing the fresh
  `raidLockouts()` array); the countdown reads as of the render, beside its absolute time.
  A saved page reads Defeated in the list on the difficulty being read. A lockout is the
  sim's per ROOM, so a Heroic dungeon marks only its final boss page while the banner of
  every page says Saved; never invent a lockout for an instance the sim does not lock.
- The 3D model lives on the Overview tab (the encounter card); the banner portrait's eye
  button opens it. Abilities and Loot hold no WebGL context.
- The Raids list reads in catalog order (`RAID_INSTANCES`): Nythraxis, the Crucible, the
  Smith's Heart (pinned by `tests/adventure_journal_view.test.ts`).
- A new instance is a source plus one catalog row; Mythic is a tier entry, never content.
- A banner picture is a REAL in-game frame of the arena (offline world on a dev Vite,
  `/dev heart enter` and the boss's floor, UI and nameplates hidden, the player's body
  scaled away, real GPU), cropped to about 1240x480 with the boss in the right third
  (the portrait and the words sit left), scaled to 1280x496 and encoded as WebP at
  roughly 50 to 90 KB. One row in `journal_backdrop_view.ts`; never painted or generated art.
- The banner words keep 4.5:1 over any pixel of a picture: the picture's brightness
  filter and the `--color-aj-banner-scrim` veil are pinned together by
  `tests/adventure_journal_styles.test.ts`; the two dimmer inks (In combat, Mythic:
  coming soon) sit on the well. A picture is cosmetic and carries nothing a player acts on.
