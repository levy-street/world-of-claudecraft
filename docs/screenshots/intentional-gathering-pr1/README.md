# Intentional gathering PR1 visual evidence

The before/after pairs below are Chromium captures of the real HUD controllers and CSS over a fixture world.
They verify the interface, not the complete 3D game or physical touch hardware.
The baseline uses unchanged PR3872 source at
0f53c92ff738ebebb6add787a61caecdf7e8e884 in the separate base worktree.
The new input flow is exercised by
[the browser regression](../../../tests/browser/intentional_gathering.browser.test.ts).

| Viewport | Before | After |
|---|---|---|
| Desktop, 1280 by 720 | [Corpse choice](before-corpse-choice-desktop.png) | [Corpse choice](corpse-choice-desktop.png) |
| Mobile landscape, 844 by 390 | [Corpse choice](before-corpse-choice-mobile-landscape.png) | [Corpse choice](corpse-choice-mobile-landscape.png) |
| Mobile portrait, 390 by 844 | [Corpse choice](before-corpse-choice-mobile-portrait.png) | [Corpse choice](corpse-choice-mobile-portrait.png) |

The Professions entry opens the nearby corpse's choices without gathering anything.
Close receives initial keyboard and pad focus. The ordinary interaction hint now
describes loot only. The mobile baseline also shows the corpse popup hidden beneath
the Professions sheet; the after captures show the reachable popup above it.

Crop collection now has a separate Harvest control in the existing bed window:
[desktop](crop-choice-desktop.png),
[mobile landscape](crop-choice-mobile-landscape.png),
[mobile portrait](crop-choice-mobile-portrait.png).
The baseline generic press collected the crop directly, so there was no equivalent
crop choice window to capture.

The existing small component checkbox rows remain an inherited mobile limitation
recorded in hud.mobile.css. Their replacement belongs to PR3's shared material
preference interface. These captures do not claim that limitation is resolved.

## Full-game walkthrough

Parent-reviewed captures from a fresh offline 3D world on the PR1 working tree:
[desktop](full-game-desktop.png) and
[emulated touch landscape](full-game-mobile-landscape.png).
The wolf corpse was staged through the development world hook with ordinary copper
loot and an unclaimed harvest; the actions used the real game input and HUD.

Repeated desktop F and the mobile Interact / Loot control collected 25 copper,
left the material inventory unchanged, and left the harvest unclaimed. A subsequent
ordinary interaction opened a nearby NPC dialogue, preserving the existing fallback.
Professions > Harvest a body opened the popup without granting anything. Explicit
Harvest then granted one Rough Hide and two Cracked Wolf Fangs and claimed once.
The mobile entry was reached through Quick Actions > Show more menus > Professions.
An expired corpse refused to open; a fresh staged corpse was used for the capture.

The full game intentionally blocks portrait play with Rotate to Landscape. The
portrait fixture images above test isolated layout only. No physical device or
physical gamepad claim is made. Local development telemetry calls had no backend;
missing preloaded NPC staff/training-dummy visuals were also observed, outside the
changed harvesting path. The reviewed popup and controls rendered successfully.
