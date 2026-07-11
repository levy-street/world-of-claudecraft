---
name: multibox-gravewyrm4-logout-ryzemage
description: ryzemage must be an authorized logout-whisper sender for the gravewyrm4 multibox fleet
metadata:
  type: feedback
---

On the gravewyrm4 fleet (`scripts/multibox.gravewyrm4.json`), whispering the `logout`
phrase from **ryzemage** to any bot must stop the fleet and exit gracefully (no
auto-reconnect, staggered per [[multibox-staggered-logout]]). The kill-switch is gated by
`cfg.control.from` in `multibox.mjs` (the WHISPER KILL-SWITCH block, ~line 426): only
characters in that list can trigger `gracefulLogout()`.

**Why:** ryzemage (account ryze5, see [[multibox-accounts]]) is an operator-controlled
character the user uses as the kill-switch sender for this fleet.

**How to apply:** keep `"control": { "logout": "logout", "from": [..., "ryzemage"] }` in
the gravewyrm4 config. On `extends` merge, objects deep-merge but arrays replace wholesale
(`multibox_config.mjs`), so the sender list must be listed explicitly in the gravewyrm4
config, not only in `multibox.world.json` (whose base list is swifter + ryze). A running
multibox process reads its config once at launch, so config edits only take effect on the
next restart.
