# Groups sidebar review

These captures boot the real offline game, form a party through `Sim`, expand
the party header, click its member frame and open the shipping Groups window.
They are not isolated window fixtures or an authenticated multiplayer playtest.

The before server uses PR head `88f9e1ad96`; the after server uses this change.
Both use the same unchanged public assets and capture script. World timing and
procedural animation can differ between captures.

| Viewport | Before | After |
| --- | --- | --- |
| Desktop, 1600 x 900 | [HUD](before/desktop-hud.png) | [HUD](after/desktop-hud.png) |
| Desktop, 125% UI scale | [HUD](before/desktop-scaled-hud.png) | [HUD](after/desktop-scaled-hud.png) |
| Touch landscape, 844 x 390 | [HUD](before/mobile-landscape-hud.png) | [HUD](after/mobile-landscape-hud.png) |
| Touch landscape, 125% UI scale | [HUD](before/mobile-scaled-hud.png) | [HUD](after/mobile-scaled-hud.png) |

Each folder also contains the corresponding `*-groups.png` window capture and
`results.json` with selection, launcher placement and scale checks. Mobile pages
boot with touch emulation and an Android user agent. CDP safe-area overrides are
requested for mobile; their availability is recorded in the results.

The after run verifies that the actual party member receives the click, the
floating bell and desktop music shortcut are absent, and Groups opens through
the sidebar bell or the existing mobile More entry. The before run records its
original target selection without requiring the bug to be fixed.

The portrait hit reproduces the desktop bug at both scales: before, the target
stays null and Groups opens instead. After, the same hit selects Briar. The
before HUD image includes that unintended window; this is the captured behavior.

With Vite running, reproduce in PowerShell:

```powershell
$env:GAME_URL='http://127.0.0.1:5193'
$env:OUT='docs/screenshots/groups-review-feedback/after'
node scripts/groups_sidebar_hud_shot.mjs
```

Set `BASELINE=1` only against the unchanged before server. An optional `CASE`
selects one of the four named profiles. Desktop music remains accessible through
Options; mobile music remains in the existing mobile controls.
