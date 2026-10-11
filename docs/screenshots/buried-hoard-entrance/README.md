# Buried Hoard entrance evidence

Captured from the offline game using the repository pr-screenshots entry flow and
`scripts/assets/hoard_entrance/capture_ingame.mjs`. Baseline is `27d31b4d29`
served from the detached `C:/tmp/woc-hoard-before` worktree on port 5183.
The feature worktree is served on port 5182. No PR or remote publication is needed.

Desktop uses 1600 x 900 and Ultra to show rarity light and dust. Landscape phone uses
844 x 390 and the lowest preset to verify the body remains legible without cosmetic
effects. Day and night use the game's `/daynight` command; environmental grading and
low-preset lighting remain the game's own behavior.

Each capture grants a map, reads it, teleports to its actual marked site, and uses
the map again. The capture fixture fixes only the map RNG roll so loading duration
cannot choose a different site. Camera framing is relative to the entrance in both versions. The Willowfen
camera looks downhill. Its after capture intentionally shows a different spawn
position: the placement check now rejects water and steep banks, trying nearby
dry ground up to 20 yards away when the normal five-yard spot is unsafe.
Captures use no-aggro; existing vegetation and wildlife remain visible.

| Map | Desktop day | Desktop night | Phone day | Phone night |
| --- | --- | --- | --- | --- |
| common | [before](before-common-day-desktop-ultra.png) / [after](after-common-day-desktop-ultra.png) | [before](before-common-night-desktop-ultra.png) / [after](after-common-night-desktop-ultra.png) | [before](before-common-day-landscape-phone-low.png) / [after](after-common-day-landscape-phone-low.png) | [before](before-common-night-landscape-phone-low.png) / [after](after-common-night-landscape-phone-low.png) |
| rare | [before](before-rare-day-desktop-ultra.png) / [after](after-rare-day-desktop-ultra.png) | [before](before-rare-night-desktop-ultra.png) / [after](after-rare-night-desktop-ultra.png) | [before](before-rare-day-landscape-phone-low.png) / [after](after-rare-day-landscape-phone-low.png) | [before](before-rare-night-landscape-phone-low.png) / [after](after-rare-night-landscape-phone-low.png) |
| epic | [before](before-epic-day-desktop-ultra.png) / [after](after-epic-day-desktop-ultra.png) | [before](before-epic-night-desktop-ultra.png) / [after](after-epic-night-desktop-ultra.png) | [before](before-epic-day-landscape-phone-low.png) / [after](after-epic-day-landscape-phone-low.png) | [before](before-epic-night-landscape-phone-low.png) / [after](after-epic-night-landscape-phone-low.png) |
| legendary | [before](before-legendary-day-desktop-ultra.png) / [after](after-legendary-day-desktop-ultra.png) | [before](before-legendary-night-desktop-ultra.png) / [after](after-legendary-night-desktop-ultra.png) | [before](before-legendary-day-landscape-phone-low.png) / [after](after-legendary-day-landscape-phone-low.png) | [before](before-legendary-night-landscape-phone-low.png) / [after](after-legendary-night-landscape-phone-low.png) |

The model and sound source provenance is in
`docs/design/buried-hoard-entrance/asset-provenance.md` and `CREDITS.md`.
See [QA.md](QA.md) for implementation files, exact validation commands, results
and remaining limits.
The dark opening is a shallow occluding mesh, with terrain-conforming earth and
light spill, rather than a destructive edit to the shared terrain.

