# Dungeon objectives tracker evidence

The tracker at the top of the right tracker stack that names the group dungeon a player
stands in and counts each of its bosses 0 of 1 (`src/ui/hud/dungeon/dungeon_tracker_view.ts`
and `dungeon_tracker_painter.ts`, fed by `IWorld.dungeonRun`).

Captured from the offline client inside the Hollow Crypt, with the real GPU flags and the
lowest graphics preset. "Before" is the integration base (`a4cce65bca`) served from a
detached worktree; "after" is this branch. Both sides stage the same view: a level 20
warrior, three tracked quests (eight in the long-list shot), `/dev crypt enter`, and the
boss kills through `/dev crypt kill <boss>`. The finished run goes through `/dev crypt wyrm`
and the Knellwyrm that follows, because Morthen's row waits for the finale.

Desktop is 1920 x 1080 unless the name says otherwise. The phone shots are landscape:
the before at 874 x 402, and the after at 844 x 390 from the shot target below (software
rendering, so its camera sits differently; the HUD is what the pair compares).

| View | Before | After |
| --- | --- | --- |
| Desktop, on entry | [before](before-desktop.png) | [after](after-desktop-entry.png) |
| Landscape phone, one boss down, heroic | [before](before-mobile.png) | [after](after-mobile.png) |

After only (the base has nothing to show for these):

| State | Capture |
| --- | --- |
| One boss down (1 / 4) | [after-desktop-boss-down.png](after-desktop-boss-down.png) |
| Finished heroic run | [after-desktop-heroic-complete.png](after-desktop-heroic-complete.png) |
| Eight tracked quests beside it, heroic, two bosses down | [after-desktop-long-quest-list.png](after-desktop-long-quest-list.png) |
| Short viewport (1366 x 768), finished heroic run, eight quests: the plate keeps to the column the button rail leaves free, every boss on one line | [after-desktop-1366x768.png](after-desktop-1366x768.png) |
| UI scale 1.25 on 1920 x 1080, one boss down: the scaled rail climbs beside the plate, which narrows the same way | [after-desktop-1080p-ui-scale-125.png](after-desktop-1080p-ui-scale-125.png) |
| Russian, 1366 x 768, finished heroic run: the long chip and tally wrap inside the narrowed plate | [after-desktop-1366x768-ru-heroic-complete.png](after-desktop-1366x768-ru-heroic-complete.png) |

The plate is the one opaque box in the tracker stack, so it must not paint over the button
rail. Where the two meet depends on the viewport, the UI scale, a horizontal or moved rail
and a moved tracker, so the painter measures it (`dungeonPlateFraction` in
`dungeon_tracker_view.ts`) and the plate takes the rail-free share of its column; with the
rail below it, horizontal, or dragged elsewhere, it fills the column. The boss rows are text
and always span the column.

On the phone the right stack's seat sits on the action ring, so the plate stands down and
the run is a page of the top-band quest strip instead (the dungeon as the title, each boss
a counted line). The page sits after the tracked quests, so with three quests it is page
4 of 4, and stepping into the dungeon brings the strip to it.

To reshoot: `scripts/pr_shot_targets.mjs` carries the `dungeon-objectives-tracker` target
(entry, a boss down, a finished heroic run, and the phone), which `scripts/pr_screenshots.mjs`
selects for any change to the tracker pair or to `src/sim/instances/dungeon_run.ts`. The
long-list, short-viewport, UI-scale and Russian stills are the same staging by hand: the
viewport, the `uiScale` setting, and `?lang=ru_RU` on the URL.
