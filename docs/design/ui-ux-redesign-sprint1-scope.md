# Sprint 1 scope matrix: UI/UX redesign Phase 0 + Phase 1 pilot

Explicit required / not-required flags for every menu item, interface element,
HUD option, and setting, relative to THIS sprint's changes (design tokens,
component grammar, window_frame builder, vendor window pilot on branch
`feature/ui-aaa-redesign`). Reviewers verify categorization against this matrix
across every HUD variant in section 5.

Legend:
- REQUIRED: touched this sprint; must be verified in every applicable variant.
- DEP: not restyled, but shares state, a code path, or a cascade surface with
  the sprint's changes; regression-verify, do not restyle.
- NOT REQUIRED: untouched and independent; excluded from sprint verification
  except through the always-on test suite.

## 1. Windows (all 24)

| Window | Flag | Reason |
|---|---|---|
| vendor | REQUIRED | The pilot: frame builder + grammar end to end |
| heroic_vendor | DEP | Shares the `#vendor-window` root; isolation pinned by the open+close+takeover sequence test; verify visually |
| options | DEP | Theme picker applies the new theme knobs; graphics preset stamps `data-fx-level` which gates ornaments |
| bags | DEP | Docks beside the vendor in the sell flow; verify visual coexistence of restyled vendor next to legacy bags |
| arena | NOT REQUIRED | Untouched |
| bank | NOT REQUIRED | Untouched |
| calendar | NOT REQUIRED | Untouched |
| char | NOT REQUIRED | Untouched |
| chat | NOT REQUIRED | Untouched |
| corpse_harvest | NOT REQUIRED | Untouched |
| crafting | NOT REQUIRED | Untouched |
| daily_rewards | NOT REQUIRED | Untouched |
| leaderboard | NOT REQUIRED | Untouched |
| lockpick | NOT REQUIRED | Untouched |
| loot_settings | NOT REQUIRED | Untouched |
| mailbox | NOT REQUIRED | Untouched |
| market | NOT REQUIRED | Untouched |
| questlog | NOT REQUIRED | Untouched |
| rite | NOT REQUIRED | Untouched |
| social | NOT REQUIRED | Untouched |
| spellbook | NOT REQUIRED | Untouched |
| talents | NOT REQUIRED | Untouched |
| town_focus | NOT REQUIRED | Untouched |
| vale_cup | NOT REQUIRED | Untouched |

Window-opening menu surface (keybinds, existing HUD buttons, Esc options menu):
NOT REQUIRED; unchanged. The spec's future micro-menu rail, mobile bottom bar,
nav drawer, and bottom sheets are LATER PHASES: NOT REQUIRED this sprint.

## 2. HUD chrome elements

All per-frame chrome is untouched this sprint; `tests/hud_perf_budget.test.ts`
green is the standing guard. Every element below is NOT REQUIRED: unit frame,
party frames, target frame, cast bars, action bars (primary/secondary), auras,
minimap, compass, world map, delve map, XP bar, absorb bar, hotbar, swing
timer, meters, quest tracker, combat announcer, chat announcer, loot roll
status, FCT, tooltips (existing item/stat/mob paths), nameplates, clock,
coords, subzone, rest indicator, low-health/low-resource cues, reconnect
overlay, perf overlay, movable frames, player context menu, player card.

Exception rows:
| Element | Flag | Reason |
|---|---|---|
| Item tooltips opened from vendor rows | DEP | Existing path, but now triggered from restyled `.item-cell` nodes; smoke-check hover/focus trigger still fires |
| Focus ring (global) | REQUIRED | New shared `:focus-visible` rule + forced-colors variant landed; verify on vendor controls and confirm no regression on untouched controls |

## 3. New interface elements introduced this sprint (all REQUIRED)

- Token groups in `tokens.css`: z-scale, panel depths, window chrome, scrim,
  drawer/sheet (defined, unconsumed), urgency (defined, unconsumed), rarity,
  focus ring, tooltip, notification (defined, unconsumed), motion durations,
  density/type scale, parchment texture (fx high+; defined, unconsumed).
- Theme knobs (all four presets): panel-l0 bg, scrim, urgency pair,
  notify-critical, focus ring.
- Grammar classes (scoped under `.window-frame` where noted in
  `components.css`): `.panel-l0/l1/l2`, `.panel-header`, `.window-frame`
  family (titlebar/title/body/footer/close/ornaments), `.tab-rail`/`.tab`,
  `.btn` + `.btn.is-primary` / `.btn.is-danger` / `.btn-ghost` / `.is-loading`,
  `.icon-btn`, `.ui-badge`, `.card`, `.chip`, `.field`, `.search-field`,
  `.filter-row`, `.data-table`, `.list-rows`, `.item-cell` (+ `data-quality`
  rarity borders), `.bar`/`.bar-fill` (+ resource modifiers), `.empty-state`,
  `.loading-state`/`.skeleton-row`, `.error-banner`, shared focus rule,
  forced-colors block, `body.mobile-touch` variants.
- Modules: `window_frame_view.ts` (pure core), `window_frame.ts` (builder),
  restyled `vendor_window.ts` (builder-owned inner mount container).

Note: "defined, unconsumed" tokens are REQUIRED to exist and pass the token
tests but have no visual surface yet; verifying them means confirming they
cause NO visual delta anywhere this sprint.

## 4. Settings (every field in `src/game/settings.ts` plus the non-settings.ts controls)

DEP settings (regression-verify against sprint changes):
| Setting | Reason |
|---|---|
| graphicsPreset | Feeds `ui_effects_profile` -> `data-fx-level`; gates window-frame ornaments (absent at low) |
| effectsQuality | Same fx-tier resolution path; verify tier stamps still resolve identically |
| reduceMotion | `--motion-scale` factor; sprint ships no new animation, verify none sneaked in |
| highContrastText | Contrast interaction with new vendor chrome text |
| hudOpacity | Applies over HUD surfaces; verify restyled vendor honors it like the legacy window did |
| uiScale | Verify vendor frame at 0.8 and 1.15 extremes (no clipping/overflow) |
| interfaceMode | Tri-state (0 to 2) desktop/mobile presentation forcing; verify vendor under all three |
| frostedPanels | Toggles glass; new grammar uses ZERO backdrop-filter (verified), so verify the toggle produces no delta on the vendor frame |
| Theme preset (src/ui/theme.ts, not settings.ts) | REQUIRED, not just DEP: new knobs flow through applyTheme in all four presets |
| Language picker (i18n) | Vendor title/labels now flow through the typed builder keys; verify en renders and en_XA pseudo-locale does not leak raw keys |

NOT REQUIRED settings (untouched, independent; alphabetical):
actionButtonScale, attackMove, aurasOnPlayerFrame, brightness, browserEffects,
cameraFov, cameraSpeed, chatFontScale, chatOpacity, clickFeedback, clickToMove,
clickToMoveButton, compactChat, fctScale, filterProfanity, foliageDensity,
footstepSfx, fullscreen, gamepadCameraSpeed, gamepadEnabled, gamepadInvertY,
gamepadStickDeadzone, gamepadVibration, graphicsDefaultApplied (internal flag),
groundReticle, invertLookY, joystickDeadzone, joystickScale,
landingHighContrast, leftHandedTouch, lockCursorOnRotate, mobileCameraJoystick,
mouseCamera, musicVolume, playerFrameScale, questTrackerCollapsed, renderScale,
sfxVolume, shadowQuality, showDailyRewardsChest, showDevBadges, showFps,
showItemLevel, showOverflowXp, showOwnNameplate, showSecondaryActionBar,
showWalletOnCharacterScreen, showWalletOnPlayerCard, startAttackOnAbilityUse,
targetFrameScale, terrainDetail, tooltipScale, touchInvertLook, touchLookSpeed,
touchOpacity, voiceEnabled, voiceVolume, walkByAutoloot, weather.
Also NOT REQUIRED: keybind rebinding (unchanged dispatch), audio device
handling, account/auth settings.

## 5. HUD variant verification matrix

Verify every REQUIRED and DEP row above in each applicable variant:

| Variant | What to verify |
|---|---|
| Desktop full-screen, `index.html` | Vendor open/close/buy/buyback/sell-docked-with-bags; heroic takeover sequence; focus trap and return |
| Desktop full-screen, `play.html` | Same pass; the two entries are hand-maintained and must render identically (entry-parity tests plus eyes) |
| Mobile touch, portrait (`body.mobile-touch`) | Grammar touch variants: 44px controls, stacked footer, 16px input floor; vendor usable with thumb reach |
| Mobile touch, landscape | Same, plus no edge clipping (landscape phones gate on capability, not width) |
| Compact (uiScale 0.8; also check 1.15) | Vendor frame integrity, no clipping or overflow at both extremes |
| FX tier: low | Ornaments ABSENT, no backdrop-filter anywhere, zero information loss vs ultra (fairness invariant) |
| FX tier: medium / high / ultra | Ornaments present; parchment grain token defined but unconsumed, so NO visual delta beyond ornaments between medium and ultra this sprint |
| Theme: classic / midnight / parchment / highContrast | Vendor frame readable in all four; severity knobs exist but are unconsumed (no visual surface); parchment gets the closest look (light panels) |
| forced-colors: active | Borders + focus ring survive on vendor controls via system colors |
| Reduced motion (OS pref and reduceMotion setting) | No new animation shipped; confirm no transition regressions on vendor open/close |
| Combat vs non-combat | NOT REQUIRED to differ: this sprint ships zero combat-state coupling; verify the vendor renders identically in and out of combat and that no urgency token leaks a visual |
| Specialized HUDs (yumi match/grab, arena/fiesta, vale cup, delve map, spectate, tutorial, perf overlay) | NOT REQUIRED: untouched; standing guard is the always-on suite (hud_perf_budget, architecture) |

## 6. How reviews consume this matrix

- Task 3 (vendor pilot) review: verify the flags above are correct for every
  row the diff touches or neighbors; flag any item this matrix mislabels.
- Task 4 (final whole-branch review + gate + screenshots): screenshots cover
  the REQUIRED rows in the desktop and mobile variants; the DEP rows get a
  targeted regression pass; NOT REQUIRED rows are covered by `npm run gate`.
- Any reviewer finding that an item flagged NOT REQUIRED is actually affected
  by the diff is a Critical finding by definition (scope leak).
