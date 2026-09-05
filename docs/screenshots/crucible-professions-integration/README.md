# Crucible professions: live Perfecting exchange

Captured on 2026-09-05 from the integration branch in a real Chromium offline
world at the Eastbrook forge. These are before/after action-flow captures of
the new feature, not screenshots of the parent branch.

| State | Capture |
| --- | --- |
| Named Perfected chest, distinct belt copies and exchange preview | [Desktop preview](desktop-preview.png) |
| Explicit permanent-binding and enchant-dormancy confirmation | [Desktop confirmation](desktop-confirm.png) |
| Exchange completed: the worn belt is Perfected and the named chest is rank zero | [Desktop result](desktop-exchanged.png) |
| Russian confirmation at 852 by 393, with the long custom item name retained | [Landscape confirmation](landscape-confirm.png) |
| Existing portrait-play orientation gate at 393 by 852 | [Portrait gate](portrait-orientation-gate.png) |

Desktop captures use 1440 by 1000 CSS pixels. The narrow checks resize the
same live browser session and enable the game's `mobile-touch` CSS. They are
responsive Chromium checks, not physical-device or mobile Safari proof.

The capture used the real Perfecting window, real mouse clicks and Escape,
and the real simulation exchange. Assertions verified return of keyboard
focus after cancellation, unchanged bag count, retained custom name and
enchant, permanent binding on both pieces, and the resulting worn/bag ranks.
No page errors were recorded.

The Russian landscape prompt measured 340 by 283 pixels at y=12, entirely
inside the viewport. Both confirmation buttons were 48 pixels high and at
least 80 pixels wide, with their lower edges at y=279. Portrait gameplay
remains intentionally blocked by the existing orientation gate; the capture
does not hide or bypass it.

These captures do not establish a complete contribution-gate pass, online
transport behavior, or full raid balance. Unit/integration tests cover the
private wire, stale-copy and reconnect cases; the balance report lives in
`docs/design/crucible-professions-balance-measurement.md`.
