# Mobile Spellbook Slot Picker and Dynamic Action Pages Implementation Plan

**Status:** Ready for implementation  
**Branch:** `mobile-layout-adjustments`  
**Product spec:** [Mobile Touch HUD Layout PRD](../prd/mobile-compact-landscape-hud.md)  
**Execution default:** TDD, one task at a time

## Progress

- [x] T1: Normalize the page-count setting - 2026-07-11
- [x] T2: Model four supported pages and the effective page count - 2026-07-11
- [x] T3: Expose the discrete touch option - 2026-07-11
- [x] T3b: Wire touch gating through the Options painter - 2026-07-11
- [x] T4: Add a canonical mobile assignment command - 2026-07-11
- [x] T5: Build the pure picker state model - 2026-07-11
- [x] T6: Enrich Spellbook row assignment state - 2026-07-11
- [x] T7: Render and operate the inline picker - 2026-07-11
- [x] T8: Integrate assignment, staleness, and lifecycle in Hud - 2026-07-11
- [x] T9: Drive the HUD with the effective page count - 2026-07-11
- [x] T10: Style the picker for compact landscape and mirroring - 2026-07-11
- [x] T11: Extend mobile behavior and overlap audits - 2026-07-11
- [x] T12: Capture and inspect the compact reference - 2026-07-11
- [x] T13: Regenerate localization artifacts - 2026-07-11
- [x] T14: Update implementation evidence - 2026-07-11
- [ ] T15: Run scoped regression and the contribution gate (in progress)

## Outcome

Extend the already implemented compact landscape HUD from three fixed pages to two through four effective five-slot pages, and add a touch-only inline Spellbook picker for exact assignment to source slots 1 through 20. Attack and the automatic six-item Consumables drawer stay separate. The persisted 22-slot hotbar format and desktop behavior do not change.

## Complete file tree

### Create

- `docs/screenshots/mobile-hud-layout/after-compact-spellbook-picker.png`: compact-landscape evidence with the picker open.

### Modify

- `src/ui/mobile_action_page_view.ts`
- `tests/mobile_action_page_view.test.ts`
- `src/game/settings.ts`
- `tests/settings.test.ts`
- `src/ui/options_view.ts`
- `tests/options_view.test.ts`
- `src/ui/options_window.ts`
- `tests/options_window.test.ts`
- `src/ui/hotbar.ts`
- `tests/hotbar.test.ts`
- `src/ui/spellbook_view.ts`
- `tests/spellbook_view.test.ts`
- `src/ui/spellbook_window.ts`
- `tests/spellbook_window.test.ts`
- `tests/client_shell.test.ts`
- `src/ui/hud.ts`
- `tests/mobile_action_ring_painter.test.ts`
- `src/ui/i18n.catalog/hud_chrome.ts`
- `src/styles/hud.mobile.css`
- `tests/browser/target_size.browser.test.ts`
- `scripts/mobile_cluster_layout_check.mjs`
- `scripts/mobile_hud_overlap_audit.mjs`
- `scripts/mobile_hud_layout_shots.mjs`
- `docs/solutions/2026-07-11-mobile-touch-hud-layout.md`
- `docs/plans/_index.md`

### Regenerate, do not hand-edit

- `src/ui/i18n.resolved.generated/`
- `src/admin/i18n.resolved.generated/`
- `src/ui/i18n.status.summary.json`
- `src/ui/i18n.resolved.sha256`

`index.html` and `play.html` need no new picker markup: the picker is rendered inside the existing `#spellbook`, and the action pad retains five physical ability buttons.

## Interfaces and dependency flow

```text
Settings.mobileActionPageMinimum
        |
        v
mobile_action_page_view effective count <--- hotbar occupancy 1..20
        |                                      |
        v                                      v
Hud page cycle/painter              spellbook_view picker model
                                               |
                                               v
                                  SpellbookWindow -> Hud assignment seam
                                               |
                                               v
                                  existing 22-slot persistence
```

The pure mobile assignment command consumes an ability id, zero-based target index, and current 22-slot actions, and produces a canonical array plus a changed result. Hud separately validates the active character/form identity token and produces the stale result before it calls the pure command. The command must not reuse desktop `placeAbilityOnSlot`, because that helper intentionally swaps occupants.

## Task 1: Normalize the page-count setting

**Files:** `src/game/settings.ts`, `tests/settings.test.ts`  
**Changes:** Add numeric `mobileActionPageMinimum` with range 2 through 4 and default 2. Give this discrete setting explicit normalization: missing values, strings, and non-finite numbers use 2; finite numbers round to the nearest integer and clamp to 2 through 4. Preserve the existing `woc_settings` schema and all other numeric normalization.  
**Tests:** First add failing load/set/reset cases for 1.4, 2.6, 99, `NaN`, `Infinity`, strings, missing, and corrupt storage; then implement the minimum change.  
**Interfaces:** Consumes persisted unknown JSON. Produces `Settings.get('mobileActionPageMinimum'): number`.  
**Depends on:** None.  
**Estimated time:** 5 minutes.

## Task 2: Model four supported pages and the effective page count

**Files:** `src/ui/mobile_action_page_view.ts`, `tests/mobile_action_page_view.test.ts`  
**Changes:** Expand the reachable mobile span to source slots 1 through 20. Add a pure effective-count helper that returns the maximum of normalized configured minimum and the highest occupied page among slots 1 through 20, capped at four. Count both ability and item actions, keep pages contiguous, and make clamp/cycle accept the runtime count.  
**Tests:** Start with failing mappings for P4 slots 16 through 20, sparse occupancy, item occupancy, ignored slots 21/22, shrink-after-empty, and runtime wrap behavior.  
**Interfaces:** Consumes minimum count and read-only hotbar actions. Produces effective count 2 through 4 and stable source-slot mappings.  
**Depends on:** Task 1.  
**Estimated time:** 5 minutes.

## Task 3: Expose the discrete touch option

**Files:** `src/ui/options_view.ts`, `tests/options_view.test.ts`, `src/ui/i18n.catalog/hud_chrome.ts`  
**Changes:** Add a touch-only choice control with values 2, 3, and 4 to the Interface options panel. Keep it hidden on desktop and use localized label and option text. Do not present it as a continuous slider.  
**Tests:** Add a failing control-model test for touch visibility, desktop absence, current value, choice dispatch, and no unrelated panel rerender.  
**Interfaces:** Consumes `OptionsSettingsSource.num('mobileActionPageMinimum')`. Produces the existing `onSettingChange` choice dispatch.  
**Depends on:** Task 1.  
**Estimated time:** 4 minutes.

## Task 3b: Wire touch gating through the Options painter

**Files:** `src/ui/options_window.ts`, `tests/options_window.test.ts`  
**Changes:** Pass `OptionsEnv` into `buildInterfaceControls` from `renderInterface` and render the new choice through the existing choice primitive. Keep the control absent when touch is false and make its setting write flow through the existing generic `onSettingChange` path.  
**Tests:** Start with failing painter integration tests for touch presence, desktop absence, selected state, and dispatching a new value without reload.  
**Interfaces:** Consumes the existing runtime touch environment and Task 3's descriptor. Produces the live Interface-panel choice and generic setting callback.  
**Depends on:** Task 3.  
**Estimated time:** 4 minutes.

## Task 4: Add a canonical mobile assignment command

**Files:** `src/ui/hotbar.ts`, `tests/hotbar.test.ts`  
**Changes:** Add a helper dedicated to exact mobile assignment. Remove every existing copy of the selected ability, overwrite the requested target, never swap the displaced target into the old slot, preserve items and unrelated abilities, return a canonical no-op for the same sole slot, and reject targets outside indexes 0 through 19. Leave desktop placement and drag helpers unchanged.  
**Tests:** Write failing cases for empty assignment, occupied overwrite, relocation without swap, duplicate cleanup, same-slot no-op, item displacement, and invalid/mobile-overflow targets.  
**Interfaces:** Consumes 22 `HotbarAction`s, ability id, and target index. Produces `{ actions, changed }`.  
**Depends on:** Task 2.  
**Estimated time:** 5 minutes.

## Task 5: Build the pure picker state model

**Files:** `src/ui/spellbook_view.ts`, `tests/spellbook_view.test.ts`  
**Changes:** Extend the existing registered pure core to model four tabs, five destinations per selected page, current assignment (`P/page A/position`, Desktop, or unassigned), occupant presentation, `aria-current`, selected-tab roving tabindex, ArrowLeft/Right, Home/End transitions, deterministic initial selection, and an immutable form/character identity token. Keep raw item ids in the pure model; the painter resolves localized item names through an injected dependency.  
**Tests:** Begin with failing state-transition and projection tests covering all 20 mobile slots, slots 21/22 as Desktop, empty/item/ability occupants, stale token comparison, and opening-focus priority: current destination, otherwise first empty on the opening page, otherwise A1.  
**Interfaces:** Consumes the full `readonly HotbarAction[]`, selected ability, page, and bar token. Produces DOM-free picker rows including item occupants, accessibility state, and next-page/focus state.  
**Depends on:** Tasks 2 and 4.  
**Estimated time:** 5 minutes.

## Task 6: Enrich Spellbook row assignment state

**Files:** `src/ui/spellbook_view.ts`, `tests/spellbook_view.test.ts`  
**Changes:** Replace the current coarse on-bar/mobile-page projection with exact assignment state: unassigned, mobile page/position, or Desktop overflow. Keep desktop full-bar disabled behavior, but make touch Add available even when all 22 slots are full. Represent the visible check marker and chip as semantic data, not a raw glyph.  
**Tests:** Add failing row-model cases for slots 1, 5, 6, 20, 21, and 22, duplicate-corrupt input, touch-full versus desktop-full, and localized-value placeholders.  
**Interfaces:** Consumes ability ids by bar slot plus a touch-presentation flag. Produces row assignment and add/remove availability consumed by `SpellbookWindow`.  
**Depends on:** Task 5.  
**Estimated time:** 5 minutes.

## Task 7: Render and operate the inline picker

**Files:** `src/ui/spellbook_window.ts`, `tests/spellbook_window.test.ts`, `src/ui/i18n.catalog/hud_chrome.ts`  
**Changes:** Render the picker inside the existing Spellbook with `tablist`/`tab`, localized destination group, five 48px destination buttons, icon/empty states, check icon plus text, separate Remove, and a polite assignment live region. Wire Add and assignment chips to open it; same chip and explicit close close it; Escape remains owned by the existing `closeAll` path; outside click and platform Back gain no new behavior. Preserve scroll/focus during live row refresh and return focus deterministically on close/assignment.  
**Tests:** Replace the old +/- behavior with focused painter tests for callbacks, ARIA, keyboard commands, exact controls, full-bar Add, picker-first Escape/`closeAll`, and focus return. Assert destination names include page/A-position, empty or occupied state, and action name; assignment announcements include ability/page/A-position. Test whole-bar refresh focus returning to the same ability's new row control or the Spellbook close button when the row no longer exists. Keep only broad extraction guards in `client_shell`.  
**Interfaces:** Extends `SpellbookWindowDeps` with touch detection, current hotbar actions/token, localized item-name resolution, exact assignment, and active-page switch. Produces assignment requests, localized announcements, and a public `closePicker(): boolean` seam that returns true only when it closed the picker while leaving Spellbook open.  
**Depends on:** Tasks 5 and 6.  
**Estimated time:** 5 minutes.

## Task 8: Integrate assignment, staleness, and lifecycle in Hud

**Files:** `src/ui/hud.ts`, `tests/client_shell.test.ts`  
**Changes:** Supply the picker dependencies from the active form bar, apply the canonical assignment command, persist through the existing per-character/per-form path, switch to the assigned mobile page, and close the picker before form switch, loadout replacement, and reset. Capture a character plus active `HotbarForm` token when opening and reject stale writes. Make `closeAll()` close the inline picker before it closes the Spellbook. Keep automatic placement of newly learned abilities unchanged.  
**Tests:** Add integration guards for the exact helper, persistence, page switch, token validation, and all whole-bar replacement close points. Assert first Escape uses `closePicker()` and leaves Spellbook open, second Escape closes Spellbook, and reset/loadout/form synchronization calls `closePicker()` before replacing actions or changing the token. Verify open-picker chips and occupants refresh after Add/Remove, individual slot mutation, and desktop drag/drop; retain existing desktop and auto-placement guards.  
**Interfaces:** Consumes picker assignment request. Produces persisted active-form actions, selected HUD page, success/stale result, and picker close.  
**Depends on:** Tasks 4 and 7.  
**Estimated time:** 5 minutes.

## Task 9: Drive the HUD with the effective page count

**Files:** `src/ui/hud.ts`, `tests/mobile_action_ring_painter.test.ts`, `tests/client_shell.test.ts`  
**Changes:** Read the configured minimum through existing options hooks, derive effective count from active hotbar occupancy, clamp the current page after occupancy/form changes, and pass runtime count to page cycling and painter state. Ensure assigning to P3/P4 immediately selects and exposes that page. Keep five physical buttons and fixed Attack unchanged.  
**Tests:** Add failing integration/painter cases for 2, 3, and 4 indicators, P4 cycling, occupied-page retention, shrink/clamp, form-bar changes, unchanged fixed controls, and immediate live HUD count changes when the Interface option changes without reload.  
**Interfaces:** Consumes Tasks 1 and 2 outputs. Produces runtime painter page/count state.  
**Depends on:** Tasks 2 and 8.  
**Estimated time:** 5 minutes.

## Task 10: Style the picker for compact landscape and mirroring

**Files:** `src/styles/hud.mobile.css`, `tests/browser/target_size.browser.test.ts`, `tests/client_shell.test.ts`  
**Changes:** Add compact inline picker geometry, 48px hitboxes, 4px gaps, visible focus/current/occupied states, responsive wrapping/scroll containment, and left-handed mirroring consistent with the existing HUD. The Spellbook must remain usable at 740x360 without covering its close control or requiring portrait support.  
**Tests:** Add failing CSS/browser assertions for rendered target size, safe-area containment, selected/current differentiation, keyboard focus visibility, compact overflow, and mirrored order.  
**Interfaces:** Consumes picker classes and body touch/left-handed flags. Produces responsive visual geometry only.  
**Depends on:** Task 7.  
**Estimated time:** 5 minutes.

## Task 11: Extend mobile behavior and overlap audits

**Files:** `scripts/mobile_cluster_layout_check.mjs`, `scripts/mobile_hud_overlap_audit.mjs`, `scripts/mobile_hud_layout_shots.mjs`  
**Changes:** Change the fixed `1 -> 2 -> 3` assertion to runtime 2/3/4 scenarios; open the complete Spellbook picker, verify no protected-HUD overlap at canonical 740x360, 844x390, 915x412, and 932x430 profiles, and teach the existing shot harness to capture the compact picker state. Include left-handed coverage and ensure Attack/Consumables remain separate.  
**Tests:** Run real-page flows assigning on every page, overwriting an ability and an item, moving without swap, observing immediate chip and selected-HUD-page updates, using Add with all 22 slots full, refreshing an open picker after external slot mutation, and cancelling safely across form switch, loadout replacement, and reset. Run both scripts against the normal local test server and inspect the generated screenshot at full size.  
**Interfaces:** Consumes the live HUD test seam and DOM ids. Produces deterministic geometry/interaction evidence.  
**Depends on:** Tasks 8 through 10.  
**Estimated time:** 5 minutes.

## Task 12: Capture and inspect the compact reference

**Files:** `docs/screenshots/mobile-hud-layout/after-compact-spellbook-picker.png`  
**Changes:** Generate the reference through the audited shot harness with all relevant HUD surfaces visible, then inspect it at full size for clipping, overlap, readable assignment state, and a usable camera zone.  
**Tests:** Confirm the image is produced by the scripted 740x360 scenario and manually inspect the full-resolution artifact.  
**Interfaces:** Consumes Task 11's deterministic shot scenario. Produces reviewer-visible layout evidence.  
**Depends on:** Task 11.  
**Estimated time:** 3 minutes.

## Task 13: Regenerate localization artifacts

**Execution note:** Generation runs before the Task 11 browser flow because the development
runtime rejects newly referenced catalog keys until the resolved registry exists. Final
idempotency verification still remains in this task's original closeout position.

**Files:** `src/ui/i18n.catalog/hud_chrome.ts`, generated i18n outputs listed above  
**Changes:** Finalize English keys for setting labels, page/slot chips, Desktop, empty/occupied destinations, picker controls, and live announcements. Run the canonical generator; never edit resolved files by hand.  
**Tests:** Run `npm run i18n:gen`, then the i18n determinism/equivalence tests selected by the repository gate.  
**Interfaces:** Consumes catalog keys. Produces generated locale modules, pending registry summary, and hash.  
**Depends on:** Tasks 3 and 7.  
**Estimated time:** 5 minutes.

## Task 14: Update implementation evidence

**Files:** `docs/solutions/2026-07-11-mobile-touch-hud-layout.md`, `docs/prd/mobile-compact-landscape-hud.md`  
**Changes:** Record the final dynamic-page and exact-assignment architecture, verified commands, screenshot path, and any implementation deviation. Change the approved PRD only if implementation reveals a product-level deviation, and call that out explicitly rather than silently rewriting acceptance criteria.  
**Tests:** Run `git diff --check` and validate local Markdown links.  
**Interfaces:** Consumes final implementation evidence. Produces reviewer-ready documentation.  
**Depends on:** Tasks 12 and 13.  
**Estimated time:** 3 minutes.

## Task 15: Run scoped regression and the contribution gate

**Files:** No planned source edits; fixes return to the owning task files.  
**Changes:** Run focused tests after each task, then fresh final validation. Preserve unrelated dirty work and inspect the final diff before any commit.  
**Tests:** `npm run i18n:gen`; targeted Vitest suites for settings, options, mobile pages, hotbar, picker, Spellbook, painter, architecture, and client shell; browser target-size test; both mobile audit scripts; then the repository-required `npm run gate`.  
**Interfaces:** Consumes the complete change set. Produces current pass/fail evidence and a list of any checks that could not run.  
**Depends on:** Tasks 1 through 14.  
**Estimated time:** 5 minutes plus gate runtime.

## Acceptance traceability

- Four pages, stable mappings, separate Attack/Consumables: Tasks 2, 9, 11.
- Configured minimum, effective occupied-page expansion, normalization: Tasks 1 through 3 and 9.
- Exact assign/overwrite/move/no-duplicate behavior: Tasks 4, 5, 8.
- Mobile/desktop/full-bar and automatic-placement compatibility: Tasks 6 and 8.
- Inline picker lifecycle, stale-form safety, close behavior: Tasks 7 and 8.
- A11y, focus, localization, 48px compact geometry: Tasks 5, 7, 10, 13.
- Persistence and absence of storage/wire migration: Tasks 4 and 8.
- Responsive and left-handed evidence: Tasks 10 through 12.

## Sanity check

- Every created or modified production file has an owning task and a paired test or audit.
- Each task changes at most three hand-edited files, except the generated artifact task.
- The dependency chain establishes pure contracts before DOM/Hud integration.
- Desktop swap/drag behavior, automatic learned-skill placement, 22-slot persistence, fixed Attack, and six-item Consumables remain explicit regression boundaries.
- No portrait acceptance work, server migration, new modal, runtime dependency, or HTML shell duplication is introduced.
