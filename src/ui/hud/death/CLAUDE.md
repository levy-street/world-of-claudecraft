# HUD domain: the death screens

What a dead player sees, behind the `index.ts` barrel:

- `death_prompt_view.ts`: the pure, DOM-free core (registered in `UI_PURE_CORES`).
  `updateDeathPromptView(out, ...)` decides, per frame and into a caller-owned
  view (allocation-light), which surfaces show: the Release overlay for a fresh
  corpse (not in an arena match), its PvP Resurrect button (only while the corpse
  carries `Entity.pvpResurrect`, `src/sim/pvp/pvp_resurrect.ts`), and for a ghost
  the greyscale spirit mode, the standing hint line and the Resurrect at Corpse
  prompt within `CORPSE_REZ_RANGE` (both suppressed in a battleground match),
  plus the ghost Death Recap button for the whole corpse run (also suppressed
  in a battleground match), since releasing hides the overlay's own Recap button.
- `death_screen_painter.ts`: the thin painter. `deathScreenEls(document)`
  resolves the static `#death-overlay` / `#pvp-resurrect-btn` / `#ghost-hint` /
  `#ghost-prompt` / `#ghost-recap-btn` markup (`index.html` and `play.html`)
  once; `paintDeathScreens(writers, els, view)` paints the view through the
  HUD's write-elided `setDisplay`. `Hud.update` (`src/ui/hud.ts`) calls it and
  keeps the `spirit-mode` body class. The buttons' clicks route to
  `IWorld.releaseSpirit`, `IWorld.pvpResurrect` and `IWorld.resurrectAtCorpse`
  (the server re-validates every one); both Recap buttons toggle the one
  `DeathRecapDialog`, which closes on revive.
- `#ghost-hint` and `#ghost-recap-btn` share one `#ghost-header` flex column,
  so the button follows a localized hint that wraps to two lines.
- `#ghost-recap-btn` deliberately sits OUTSIDE the `#ghost-prompt` pad-nav
  root: that root appears only in corpse reach, and a standing button inside
  it would take gamepad focus for the whole run. Like `#death-recap-btn` it is
  not in `DEATH_BUTTON_IDS` (no Confirm cap): it is a read-only aside, not a
  way back.

Pinned by `tests/pvp_resurrect.test.ts` and `tests/death_recap_ghost.test.ts`.
