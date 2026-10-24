# HUD domain: the death screens

What a dead player sees, behind the `index.ts` barrel:

- `death_prompt_view.ts`: the pure, DOM-free core (registered in `UI_PURE_CORES`).
  `updateDeathPromptView(out, ...)` decides, per frame and into a caller-owned
  view (allocation-light), which surfaces show: the Release overlay for a fresh
  corpse (not in an arena match), its PvP Resurrect button (only while the corpse
  carries `Entity.pvpResurrect`, `src/sim/pvp/pvp_resurrect.ts`), and for a ghost
  the greyscale spirit mode, the standing hint line and the Resurrect at Corpse
  prompt within `CORPSE_REZ_RANGE` (both suppressed in a battleground match).
  `pvpResurrectWait` carries the whole seconds left on the offer's wait
  (`PVP_RESURRECT_WAIT_SECONDS`), 0 once it may be taken.
- `pvp_resurrect_painter.ts`: the thin painter (`PvpResurrectPrompt`) over the
  static `#pvp-resurrect-btn` and `#pvp-resurrect-note`, through the PainterHost
  elided writers: while the wait runs the button is disabled and counts down and
  the note names the wait and the nearest graveyard; once it is over the button
  is plain and the note says it is ready. It binds the button's press.
- The rest of the painting stays in `Hud.update` (`src/ui/hud.ts`): write-elided
  `setDisplay` calls and the `spirit-mode` body class over the static
  `#death-overlay` / `#ghost-hint` / `#ghost-prompt` markup in `index.html`. The buttons' clicks route to `IWorld.releaseSpirit`,
  `IWorld.pvpResurrect` and `IWorld.resurrectAtCorpse`; the server re-validates
  every one.

Pinned by `tests/pvp_resurrect.test.ts` and `tests/pvp_resurrect_prompt.test.ts`.
