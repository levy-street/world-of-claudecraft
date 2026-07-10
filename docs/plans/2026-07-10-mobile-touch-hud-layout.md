# Implementation Plan: Mobile Touch HUD Layout

| | |
|---|---|
| Status | Implementation active; PR #1724 integrated, final verification in progress |
| Date | 2026-07-10 |
| Branch | `mobile-layout-adjustments` |
| Product spec | [Mobile Touch HUD Layout PRD](../prd/mobile-compact-landscape-hud.md) |
| Required base | [PR #1724: joystick autorun lock](https://github.com/levy-street/world-of-claudecraft/pull/1724) |

## Outcome

Replace the radial mobile action ring with the approved two-row action pad, preserve the contextual Jump/Use WIP, reserve a measurable canvas camera-start zone, move the minimap and compact menu to opposite top corners, place the automatic Consumables drawer beside the movement joystick, and validate the complete topology across touch tiers, orientations, handedness, safe areas, settings extremes, and populated HUD states.

The implementation must not change combat, targeting, ability paging, interaction priority, Consumables selection, desktop layout, or pointer-ownership semantics.

## Progress

- [x] T0: Create a recoverable pre-rebase checkpoint — pre-rebase SHA `fb473dc74`, 2026-07-10
- [x] T1: Rebase on integrated joystick Autorun — release merge `083856d8c`, 2026-07-10
- [x] T2-T23: Layout implementation and focused geometry checks prepared — 2026-07-10
- [ ] T24-T27: Populated/stress interaction rerun and final evidence review after integration
- [ ] T28: Run the contribution gate and report exact evidence

## Execution amendment: work before PR #1724 merge

On 2026-07-10 the user explicitly authorized layout implementation to proceed without waiting
for PR #1724 to merge. This amendment overrides the original T0 -> T1 start ordering:

- T2 through T27 may proceed immediately on `mobile-layout-adjustments`.
- Remove the standalone Autorun button, handler, label, and layout seat now.
- Do not add a temporary fallback or copy PR #1724's joystick behavior by hand.
- Do not rebase, commit, stage, or stash the dirty WIP without separate authorization.
- Defer T0/T1 until PR #1724 is available, then use them as the final integration gate before
  T28 and final readiness.

## Final integration condition and branch guard

PR #1724 is present in the branch base through release merge `083856d8c`. The integration session must:

1. Confirm the current branch is exactly `mobile-layout-adjustments`, with no `dev-td-` prefix.
2. Request explicit authorization for a local checkpoint commit containing only the current task-owned WIP. The present modified binary screenshots and untracked PRD/plan make a plain rebase unsafe and a normal `git rebase` will refuse the dirty tree.
3. Create and verify that recoverable checkpoint before any rebase. If checkpoint authorization is not granted, stop and ask for direction rather than stashing, discarding, or partially copying the dirty worktree.
4. Confirm PR #1724 has landed on the target release base.
5. Rebase `mobile-layout-adjustments` after that merge.
6. Resolve overlapping files by preserving both the integrated joystick Autorun implementation and the existing contextual Jump/Use WIP.
7. Compare the rebased tree with the checkpoint and stop if it contains a standalone Autorun button, handler, label, or CSS seat.

Do not add a temporary standalone Autorun fallback.

## Existing WIP that must survive the rebase

These changes already exist in the worktree and are part of the approved behavior. They are inputs to the implementation, not disposable experiments:

- `src/game/interactions.ts`: `findNearbyInteraction`, `hasNearbyInteraction`, `tryNearbyInteraction`, and `mobileAttackTapAction`.
- `src/game/mobile_controls.ts`: press-first Jump handling and compatibility-click suppression.
- `src/main.ts`: contextual interaction first, Jump fallback second.
- `src/ui/hud.ts`: dedicated Attack path and Jump/Use painter wiring.
- `src/ui/mobile_action_ring_painter.ts`: dynamic Jump/Use icon, label, title, and accessible name.
- `index.html` and `play.html`: dynamic Jump copy ownership.
- `src/styles/hud.mobile.css`: contextual Jump icon swap.
- `tests/interactions.test.ts`, `tests/mobile_controls.test.ts`, `tests/mobile_action_ring_painter.test.ts`, `tests/client_shell.test.ts`, and `tests/localization_coverage.test.ts`: current behavior coverage.
- `scripts/bank_mobile_buyrow_check.mjs` and `tests/bank_window.test.ts`: banker access through Jump/Use.
- `docs/solutions/2026-07-10-mobile-context-interact.md` and the three existing `mobile-context-interact-*` screenshots.

PR #1724 is expected to overlap `index.html`, `play.html`, `src/game/mobile_controls.ts`, `src/main.ts`, `src/styles/hud.mobile.css`, `tests/client_shell.test.ts`, and `tests/mobile_controls.test.ts`. Resolve these files deliberately and rerun their focused tests immediately after the rebase.

## Complete implementation file tree

### Create

- `scripts/mobile_hud_layout_shots.mjs`
  - Deterministic before/after capture harness using the existing Puppeteer and offline-game helpers.
- `docs/screenshots/mobile-hud-layout/before-740x360-rest.png`
- `docs/screenshots/mobile-hud-layout/after-740x360-rest.png`
- `docs/screenshots/mobile-hud-layout/before-740x360-consumables.png`
- `docs/screenshots/mobile-hud-layout/after-740x360-consumables.png`
- `docs/screenshots/mobile-hud-layout/before-844x390-target-party.png`
- `docs/screenshots/mobile-hud-layout/after-844x390-target-party.png`
- `docs/screenshots/mobile-hud-layout/before-740x360-left-handed.png`
- `docs/screenshots/mobile-hud-layout/after-740x360-left-handed.png`
- `docs/screenshots/mobile-hud-layout/before-390x844-portrait.png`
- `docs/screenshots/mobile-hud-layout/after-390x844-portrait.png`
- `docs/screenshots/mobile-hud-layout/before-1024x768-tablet.png`
- `docs/screenshots/mobile-hud-layout/after-1024x768-tablet.png`

### Modify for implementation

- `index.html`
- `play.html`
- `src/styles/hud.mobile.css`
- `src/ui/mobile_hud_layout.ts`
- `src/game/mobile_hud_layout_applier.ts`
- `src/game/interactions.ts`
- `src/game/mobile_controls.ts`
- `src/main.ts`
- `src/ui/hud.ts`
- `src/ui/mobile_action_ring_painter.ts`
- `tests/client_shell.test.ts`
- `tests/mobile_hud_layout.test.ts`
- `tests/mobile_hud_layout_applier.test.ts`
- `tests/interactions.test.ts`
- `tests/mobile_controls.test.ts`
- `tests/mobile_action_ring_painter.test.ts`
- `tests/touch_router.test.ts`
- `tests/browser/target_size.browser.test.ts`
- `tests/localization_coverage.test.ts`
- `tests/bank_window.test.ts`
- `scripts/bank_mobile_buyrow_check.mjs`
- `scripts/lib/overlap_geometry.mjs`
- `scripts/mobile_cluster_layout_check.mjs`
- `scripts/mobile_hud_overlap_audit.mjs`

### Preserve as existing evidence

- `docs/solutions/2026-07-10-mobile-context-interact.md`
- `docs/screenshots/mobile-context-interact-after.png`
- `docs/screenshots/mobile-context-interact-after-ring.png`
- `docs/screenshots/mobile-context-interact-after-npc-selected.png`

Update the solution note only if the rebase changes an already documented behavior. Do not overwrite or recapture the existing context-interaction evidence as part of the layout work.

### Consume unchanged

- `src/ui/mobile_action_page_view.ts`
  - `MOBILE_ACTIONS_PER_PAGE`, `mobilePageCount`, `sourceSlotForMobileButton`, `sourceSlotsForMobilePage`, `nextMobilePage`.
- `src/ui/consumable_bar_view.ts`
  - `CONSUMABLE_BAR_SLOTS`, `CONSUMABLE_KIND_ORDER`, `consumableBarItems`.
- `src/ui/action_bar_view.ts`
  - `createActionBarView`, `ActionBarState`, and `ActionBarSlotState.queued`.
- `src/ui/action_bar_painter.ts`
  - `ActionBarPainter` and the existing `queued` class write.
- `src/game/touch_router.ts`
  - `isInteractiveHudElement`, `isCameraDragAllowedAt`, `getTouchOwner`, `TouchOwnerLedger`.
- `src/ui/party_collapse.ts`, `src/ui/party_frames_painter.ts`
  - Existing persisted default-collapsed party behavior.
- PR #1724 integration surface
  - `#mobile-autorun-target`, `Input.setAutorun`, `MobileControls.syncAutorun`, and no `onAutorun` callback.

### Delete

No files.

## Stable identities and implementation choices

### Keep legacy internal names

Keep `#mobile-action-ring`, `MobileActionRingPainter`, `buildMobileActionRing`, and related field names for this contribution. They are stable integration identities used by handlers, tests, and scripts. Update comments that claim the geometry is radial, but do not combine a layout change with a broad rename.

### Markup and focus order

Both HTML entries use this logical DOM order inside `#mobile-action-ring`:

```text
A1, A2, Attack, Target, Page, A3, A4, A5, Jump/Use
```

CSS grid areas place them as:

```text
.     A1  A2  Attack  Target
Page  A3  A4  A5      Jump/Use
```

The five ability elements retain `data-mobile-index="0"` through `"4"`. `Hud` continues sorting by that index, so markup interleaving does not change source-slot mapping.

### Compact menu ownership

Extend `MobileHudLayout` with a placement decision:

```ts
export type MobileMenuPlacement = 'compact' | 'full';

export interface MobileHudLayout {
  tier: MobileHudTier;
  classes: string[];
  cssVars: Record<string, string>;
  menuPlacement: MobileMenuPlacement;
}
```

Rules:

- `compact` for every compact tier and every portrait touch viewport.
- `full` for standard/tablet landscape and for desktop/no-touch cleanup.
- Compact direct inventory is exactly Chat, Quests, More.
- The same `#mobile-social` and `#mobile-menu` nodes move to the start of `#mobile-extra-grid` in compact mode.
- Full mode restores Social before Quests and Settings before More in `#mobile-combat-controls`.
- Reparenting preserves listeners, state, accessible metadata, and unique IDs.

The applier owns a small idempotent DOM operation:

```ts
syncMobileMenuPlacement(doc: Document, placement: MobileMenuPlacement): void
```

It performs no viewport decision logic. `resolveMobileHudLayout` remains the only decision core.

### Camera-start zone

Do not add an interactive camera-zone element. Define its geometry with named CSS custom properties on `#mobile-controls` and expose the resolved rectangle through an invisible `#mobile-controls::before` probe with `content: ""`, absolute positioning, and `pointer-events: none`.

The browser gate reads `getComputedStyle(mobileControls, '::before')`, parses its left/top/width/height, and adds the real `mobileControls.getBoundingClientRect().left/top` to convert containing-block coordinates to viewport coordinates. It samples 0.5px inside each boundary, plus edge midpoints and center. At every point it requires both `document.elementFromPoint(...) === #game-canvas` and the dynamically imported `isCameraDragAllowedAt(target, false)` result. This proves the zone is contiguous, canvas-backed, router-eligible, and free from invisible HUD blockers without assuming `#mobile-controls` starts at viewport origin.

Required CSS variables:

```text
--mobile-action-hit
--mobile-action-face
--mobile-action-gap
--mobile-jump-hit
--mobile-pad-edge-inline
--mobile-pad-edge-bottom
--mobile-map-size
--mobile-camera-zone-left
--mobile-camera-zone-top
--mobile-camera-zone-width
--mobile-camera-zone-height
```

Landscape minimums are `min(30vw, 220px)` by `min(40vh, 140px)`. Portrait minimums are `min(42vw, 160px)` by `min(24vh, 200px)`.

### Hitbox and visual scaling

The button element owns the unscaled interactive target. The user's Button Size setting scales only inner visual content and decoration. Compact minimums:

- A1 through A5, Attack, Target, Page, Consumables toggle and slots, and compact menu: 48 x 48px.
- Jump/Use: 56 x 56px.
- Interactive edge gap: at least 4px.

Do not apply `transform: scale(var(--btn-scale))` to the hitbox element. Use an inner icon/face transform or size variables clamped independently from the target dimensions.

### Attack active state

Keep `ActionBarSlotState.queued` as the source for active auto-attack. `ActionBarPainter` continues toggling `.queued`. `MobileActionRingPainter` adds a write-elided `aria-pressed="true|false"` update on the fixed Attack button. CSS renders a non-color active marker from `.queued`, with an explicit forced-colors treatment. No attack behavior changes.

## Dependency graph

```text
T0 -> T1 -> T2
T1 -> T3 -> T4 -> T5
T1 -> T6 -> T9
T6 -> T7 -> T8 -> T12
T9 -> T10 -> T11 -> T12 -> T13 -> T14 -> T15 -> T16 -> T17 -> T18
T2 + T18 -> T19 -> T20 -> T21 -> T22 -> T23
T23 -> T24 -> T25 -> T26 -> T27 -> T28
```

T3 through T5 and T6 through T8 may be developed independently after T1, but integration and final verification stay in the main thread.

## Tasks

### T0. Create a recoverable pre-rebase checkpoint

- **Summary:** Make the dirty contextual-action WIP, binary screenshots, PRD, and plan recoverable before Git history changes.
- **Files:** Only the task-owned modified and untracked paths listed in this plan; exclude any unrelated user files discovered by a fresh status check.
- **Changes:** Ask the user for explicit commit authorization. After approval, stage only the reviewed task-owned paths and create a scoped Conventional Commit checkpoint on `mobile-layout-adjustments`. Do not push it. If authorization is withheld, stop before T1 and preserve the worktree exactly as-is.
- **Tests:** Run `git status --short` before staging; inspect `git diff --cached --stat` and `git diff --cached --check`; after commit run `git show --stat --oneline HEAD` and verify `git status --short` is clean. Record the checkpoint SHA for the post-rebase comparison.
- **Interfaces:** Produces one binary-safe local recovery point containing all approved WIP. T1 consumes its SHA to verify no work disappears during conflict resolution.
- **Dependencies:** Explicit user authorization to create a local commit.
- **Estimated time:** 3-5 minutes after authorization.

### T1. Rebase on integrated joystick Autorun

- **Summary:** Establish the only valid implementation base and preserve both dependency behavior and current WIP.
- **Files:** No intentional file additions; conflicts are limited to the overlapping files listed above.
- **Changes:** Verify PR #1724 is merged, rebase `mobile-layout-adjustments`, keep `#mobile-autorun-target` and `MobileControls.syncAutorun`, remove all standalone `#mobile-autorun` inventory, preserve Jump/Use changes, and confirm the branch name is exact. Compare every checkpoint path after conflict resolution.
- **Tests:** Run `git branch --show-current`; inspect PR #1724 merge state; compare `git diff <checkpoint-sha>..HEAD --` across the overlap inventory; run `rg -n "mobile-autorun|onAutorun" index.html play.html src tests scripts`; then run `npx vitest run tests/mobile_controls.test.ts tests/client_shell.test.ts tests/interactions.test.ts tests/mobile_action_ring_painter.test.ts`.
- **Interfaces:** Consumes PR #1724's joystick Autorun API. Produces a conflict-resolved baseline with no fallback seat.
- **Dependencies:** T0. Block the plan if PR #1724 is not in the base.
- **Estimated time:** 5-15 minutes after the dependency is available, depending on conflicts in the seven known overlap files.

### T2. Add the repeatable visual capture harness and capture the baseline

- **Summary:** Preserve an auditable before state at the exact six visual-QA profiles.
- **Files:** `scripts/mobile_hud_layout_shots.mjs`, six `before-*` files under `docs/screenshots/mobile-hud-layout/`.
- **Changes:** Reuse `BROWSER_PATH` and `enterOfflineGame`; accept `SHOT_PHASE=before|after`; create deterministic resting, Consumables-open, target/party, left-handed, portrait, and tablet states; fail on page errors or unexpected console errors.
- **Tests:** Start `npm run dev -- --host 127.0.0.1`; run `SHOT_PHASE=before URL=http://127.0.0.1:5173/ node scripts/mobile_hud_layout_shots.mjs`; inspect all six images at native size.
- **Interfaces:** Consumes existing offline-game and browser helpers. Produces six named baseline screenshots and the same capture path for T27.
- **Dependencies:** T1.
- **Estimated time:** 5 minutes.

### T3. Pin the contextual interaction and dedicated Attack behavior

- **Summary:** Finish the current WIP as a stable behavior seam before changing layout.
- **Files:** `tests/interactions.test.ts`, `src/game/interactions.ts`, `src/main.ts`.
- **Changes:** Keep tests for interaction priority, nearest-within-kind selection, corpse/delve/object/NPC/Spirit Healer dispatch, no-action fallback, and `mobileAttackTapAction`; keep keyboard and Jump/Use on `tryNearbyInteraction`; keep Attack on acquire-nearest or toggle only.
- **Tests:** Run `npx vitest run tests/interactions.test.ts` immediately after the rebase. Treat any missing-WIP failure as the red signal and restore the approved code through normal conflict resolution; do not deliberately remove or revert the WIP to manufacture a failure.
- **Interfaces:** Consumes `NearbyInteractionWorld` and `PickInteractionWorld`. Produces `tryNearbyInteraction(...): boolean` and `mobileAttackTapAction(...): 'toggle' | 'acquire-nearest'` for `main.ts` and `Hud`.
- **Dependencies:** T1.
- **Estimated time:** 3 minutes.

### T4. Pin Jump/Use painting and accessible Attack state

- **Summary:** Keep dynamic Jump/Use presentation and add explicit toggle semantics for Attack without changing the shared bar core.
- **Files:** `tests/mobile_action_ring_painter.test.ts`, `src/ui/mobile_action_ring_painter.ts`, `src/ui/hud.ts`.
- **Changes:** Test Jump/Use icon, short label, title, accessible name, locale refresh, and write elision. Add a cached `aria-pressed` write for the Attack element from `state.slots[0].queued`. Keep `MobileActionRingPainter` and `buildMobileActionRing` names, but update radial-only comments.
- **Tests:** Add the failing `aria-pressed` assertions, implement the smallest painter change, then run `npx vitest run tests/mobile_action_ring_painter.test.ts`.
- **Interfaces:** Consumes `ActionBarState.slots[0].queued` and the existing painter descriptor. Produces dynamic Jump/Use copy plus an accessible Attack toggle state.
- **Dependencies:** T3.
- **Estimated time:** 4 minutes.

### T5. Preserve press-first and multi-touch ownership

- **Summary:** Ensure Jump/Use and action buttons remain usable while movement owns another pointer.
- **Files:** `tests/mobile_controls.test.ts`, `src/game/mobile_controls.ts`, `src/main.ts`.
- **Changes:** Preserve pointerdown-first execution, long-hold compatibility-click suppression, pointercancel cleanup, and Jump fallback. Add or retain a regression with one movement pointer held while a second pointer triggers Jump/Use. Keep page switching tap-only.
- **Tests:** Add the failing two-pointer and long-hold cases, implement or restore the handler, then run `npx vitest run tests/mobile_controls.test.ts`.
- **Interfaces:** Consumes `bindButton(..., { pressFirst: true })` and the PR #1724 joystick pointer path. Produces one Jump/Use action per press without stealing movement ownership.
- **Dependencies:** T3 and PR #1724 behavior from T1.
- **Estimated time:** 4 minutes.

### T6. Define the final shell inventory and logical action order

- **Summary:** Make both HTML entries structurally identical and remove every standalone Autorun artifact.
- **Files:** `tests/client_shell.test.ts`, `index.html`, `play.html`.
- **Changes:** Add failing source-contract assertions for the exact logical action order, five indexed ability slots, one Attack, one Target, one Jump/Use, one Page, integrated `#mobile-autorun-target`, no standalone `#mobile-autorun`, and identical More-grid inventory. Reorder the existing nodes without changing IDs.
- **Tests:** Run `npx vitest run tests/client_shell.test.ts` before and after the markup edit.
- **Interfaces:** Produces stable DOM identities consumed by `Hud`, `MobileControls`, CSS, the layout applier, and browser scripts.
- **Dependencies:** T1.
- **Estimated time:** 5 minutes.

### T7. Extend the pure layout model with menu placement

- **Summary:** Keep responsive decisions testable and DOM-free.
- **Files:** `tests/mobile_hud_layout.test.ts`, `src/ui/mobile_hud_layout.ts`.
- **Changes:** Add the `MobileMenuPlacement` type and `menuPlacement` output. Cover all ten canonical viewports, threshold boundaries, portrait compact-menu behavior, desktop cleanup behavior, determinism, and existing safe-area CSS vars.
- **Tests:** Add failing table-driven expectations, implement the output, then run `npx vitest run tests/mobile_hud_layout.test.ts`.
- **Interfaces:** Consumes `MobileHudLayoutInput`. Produces `MobileHudLayout.menuPlacement` for the DOM applier.
- **Dependencies:** T6 for the target inventory.
- **Estimated time:** 4 minutes.

### T8. Reparent Social and Settings without duplicates

- **Summary:** Give compact layouts Chat, Quests, More directly while retaining one logical owner per action.
- **Files:** `tests/mobile_hud_layout_applier.test.ts`, `src/game/mobile_hud_layout_applier.ts`.
- **Changes:** Add fake-DOM tests for compact placement, full placement, repeated idempotent calls, compact-to-full restoration order, missing-node safety, and listener-preserving node identity. Implement `syncMobileMenuPlacement` and call it from `applyMobileHudLayout`.
- **Tests:** Run `npx vitest run tests/mobile_hud_layout_applier.test.ts` before and after implementation.
- **Interfaces:** Consumes `MobileHudLayout.menuPlacement`. Produces exactly one live `#mobile-social` and `#mobile-menu`, either in `#mobile-extra-grid` or `#mobile-combat-controls`.
- **Dependencies:** T7.
- **Estimated time:** 5 minutes.

### T9. Replace radial seat math with the base two-row grid

- **Summary:** Establish the approved topology without yet tuning every neighboring HUD surface.
- **Files:** `tests/client_shell.test.ts`, `src/styles/hud.mobile.css`.
- **Changes:** Add failing assertions for named grid areas and the absence of trigonometric `--mobile-ring-*` seat rules. Implement the right-handed base grid, keep `#mobile-action-ring` as a pointer-transparent wrapper, enable pointer events only on real buttons, and retain all cooldown/count/drag DOM descendants.
- **Tests:** Run `npx vitest run tests/client_shell.test.ts`; manually inspect the 740x360 resting layout before continuing.
- **Interfaces:** Consumes the T6 DOM order. Produces stable grid areas `a1`, `a2`, `attack`, `target`, `page`, `a3`, `a4`, `a5`, `jump`.
- **Dependencies:** T6.
- **Estimated time:** 5 minutes.

### T10. Separate hitboxes from visible scale and style Attack hierarchy

- **Summary:** Enforce the 48px gameplay floor while making Attack visually tertiary and Jump/Use primary.
- **Files:** `tests/client_shell.test.ts`, `src/styles/hud.mobile.css`, `src/ui/mobile_action_ring_painter.ts`.
- **Changes:** Introduce the named size/gap variables, keep button boxes unscaled, scale inner faces only, set Jump/Use to 56px in compact, add at least 4px gaps, render Attack's `.queued` marker without color alone, and add forced-colors and reduced-motion rules. Define measurable face variables so the rendered order is Jump/Use highest; abilities and Target next; Attack below them; Page lowest. Enumerate `.ui-icon`, `.icon-label`, `.mobile-label`, `.item-count`, `.cd-overlay`, `.cdtext`, `.keybind`, and the page indicator so no interactive ancestor receives `--btn-scale`.
- **Tests:** Add source-contract failures for unscaled hitboxes, complete descendant ownership, measurable face hierarchy, and active-state fallback; run `npx vitest run tests/client_shell.test.ts tests/mobile_action_ring_painter.test.ts`. T22 adds decisive computed-style comparisons across tiers and scales.
- **Interfaces:** Consumes `.queued` and `aria-pressed` from T4. Produces minimum hitbox and emphasis tokens for every tier.
- **Dependencies:** T4 and T9.
- **Estimated time:** 5 minutes.

### T11. Reflow minimap, target, and party as one top-corner system

- **Summary:** Put map above movement and keep target/party inward without entering the camera zone.
- **Files:** `tests/client_shell.test.ts`, `src/styles/hud.mobile.css`.
- **Changes:** Add named map/anchor variables; set compact map width to roughly 80-85px; place target immediately inward of the map; keep the existing Party chip default-collapsed; constrain expanded rows to grow inward/downward; preserve map zoom and target/party interaction.
- **Tests:** Add source-contract assertions for anchors and run `npx vitest run tests/client_shell.test.ts tests/party_collapse.test.ts tests/party_frames_painter.test.ts`.
- **Interfaces:** Consumes the existing `party-expanded`, `has-party-chip`, and `below-target` classes. Produces geometry that T24/T25 measure in both party states.
- **Dependencies:** T10.
- **Estimated time:** 5 minutes.

### T12. Place the top menu and recenter the player frame

- **Summary:** Put low-frequency navigation opposite the map and remove radial-layout compensation from bottom-center combat chrome.
- **Files:** `tests/client_shell.test.ts`, `src/styles/hud.mobile.css`, `src/game/mobile_hud_layout_applier.ts`.
- **Changes:** Position the direct menu in the opposite top corner; style both compact and full inventories after T8 reparenting; return the player frame, cast bar, and swing bar to one bottom-center anchor; remove the current ring-specific 15px and 44px compact nudges unless a later measured safe-area run proves a smaller offset is necessary.
- **Tests:** Run `npx vitest run tests/client_shell.test.ts tests/mobile_hud_layout_applier.test.ts`; inspect 740x360 and 1024x768.
- **Interfaces:** Consumes menu node ownership from T8 and tier classes from `resolveMobileHudLayout`. Produces menu and player-frame anchors for the browser geometry gates.
- **Dependencies:** T8 and T11.
- **Estimated time:** 5 minutes.

### T13. Move Consumables beside movement and render a stable 3 x 2 drawer

- **Summary:** Keep automatic item selection but change only placement and expansion geometry.
- **Files:** `tests/client_shell.test.ts`, `src/styles/hud.mobile.css`.
- **Changes:** Place the closed toggle immediately inward of the movement capture zone; convert the open row to a 3-column by 2-row grid growing upward/inward; collapse empty slots; preserve the stable open snapshot, live count/usability/cooldown painting, long-press inspection, and multi-touch button path.
- **Tests:** Add failing CSS/source assertions, implement the geometry, then run `npx vitest run tests/client_shell.test.ts tests/consumable_bar_view.test.ts`; manually open/close twice to verify stable order.
- **Interfaces:** Consumes the unchanged six-slot markup and `consumableBarItems`. Produces closed and open geometry for T22, T25, and T26.
- **Dependencies:** T12.
- **Estimated time:** 4 minutes.

### T14. Mirror the whole topology for left-handed play

- **Summary:** Mirror side ownership and internal pad proximity, not only the two joysticks.
- **Files:** `tests/client_shell.test.ts`, `src/styles/hud.mobile.css`.
- **Changes:** Move joystick/map to the right, target/party inward-left, Consumables inward-left, action pad and camera zone left, and menu right-to-left to the top-left. Pin the mirrored grid explicitly as `Target Attack A2 A1 . / Jump A5 A4 A3 Page`, so Jump/Use and Target are nearest the left thumb and Page remains farthest away. Do not change source-slot mapping or labels.
- **Tests:** Add source-contract assertions for all mirrored anchors; run `npx vitest run tests/client_shell.test.ts tests/settings.test.ts`; inspect the 740x360 left-handed state.
- **Interfaces:** Consumes `body.mobile-left-handed`. Produces a complete mirror for T21-T25, with no JS action remapping.
- **Dependencies:** T13.
- **Estimated time:** 5 minutes.

### T15. Add standard, tablet, and portrait tier geometry

- **Summary:** Preserve one action topology while tuning the three touch tiers and portrait reflow.
- **Files:** `tests/client_shell.test.ts`, `src/styles/hud.mobile.css`.
- **Changes:** Add tier-specific named size/gap/map variables; reflow portrait without changing source-slot or context-column order; keep portrait on the compact three-button menu through T7; retain the bottom-center player frame without the old radial nudge.
- **Tests:** Run `npx vitest run tests/client_shell.test.ts`; inspect 390x844, 768x1024, 1024x1366, and 1024x768 before adding stress-state rules.
- **Interfaces:** Consumes tier and orientation selectors. Produces baseline geometry for all ten canonical profiles.
- **Dependencies:** T14.
- **Estimated time:** 5 minutes.

### T16. Add safe-area, scale-extreme, and camera-joystick CSS constraints

- **Summary:** Keep controls reachable under settings extremes and device insets.
- **Files:** `tests/client_shell.test.ts`, `src/styles/hud.mobile.css`.
- **Changes:** Add left/right/top/bottom safe-area anchors, maximum joystick/button-scale clearance, minimum-scale hitbox floors, and optional camera-joystick clearance. Keep every anchor expressed through named variables so browser state runners can inspect it.
- **Tests:** Run `npx vitest run tests/client_shell.test.ts`; use browser devtools spot checks for minimum and maximum scales in 740x360 and portrait before automating the matrix.
- **Interfaces:** Consumes `--btn-scale`, `--joy-scale`, safe-area env values, handedness, and `mobile-camera-joystick-on`. Produces final stress-state CSS inputs for T20.
- **Dependencies:** T15.
- **Estimated time:** 5 minutes.

### T17. Define the non-intercepting camera probe and router contract

- **Summary:** Turn camera space into an explicit rectangle without adding an input owner.
- **Files:** `tests/client_shell.test.ts`, `tests/touch_router.test.ts`, `src/styles/hud.mobile.css`.
- **Changes:** Add the named camera rectangle variables. Define `#mobile-controls::before` with `content: ""`, `position: absolute`, explicit left/top/width/height, and `pointer-events: none`. Keep `#mobile-controls` and pad/utility wrappers pointer-transparent. Add router regressions proving canvas/noninteractive targets are camera eligible, action buttons are not, menus block starts, and pointer ownership remains fixed after pointerdown.
- **Tests:** Run `npx vitest run tests/client_shell.test.ts tests/touch_router.test.ts`.
- **Interfaces:** Consumes `isCameraDragAllowedAt` and the existing canvas pointer binding. Produces a computed pseudo-element box for T23 and no new interactive DOM node.
- **Dependencies:** T16.
- **Estimated time:** 5 minutes.

### T18. Raise rendered target-size browser coverage to 48px

- **Summary:** Measure real boxes at the minimum Button Size setting instead of relying on CSS text.
- **Files:** `tests/browser/target_size.browser.test.ts`, `src/styles/hud.mobile.css`.
- **Changes:** Replace the 40px gameplay expectation with 48px for the action pad, compact menu, and Consumables; mount the approved interleaved markup; set `--btn-scale` to its real minimum `0.8`; remove standalone Autorun expectations; keep unrelated desktop 24px checks and non-gameplay mobile checks at their existing contract where applicable.
- **Tests:** Run `npm run test:browser -- tests/browser/target_size.browser.test.ts`.
- **Interfaces:** Consumes final hitbox CSS. Produces rendered-size evidence independent of source assertions.
- **Dependencies:** T17.
- **Estimated time:** 4 minutes plus browser startup.

### T19. Define the canonical profile and bounded state matrix

- **Summary:** Give both geometry scripts one authoritative set of viewports, insets, and stress runs.
- **Files:** `scripts/lib/overlap_geometry.mjs`.
- **Changes:** Extend `PROFILES` to all ten PRD viewports; add orientation metadata; add the four exact `SAFE_AREA_VECTORS`; encode the six bounded state runs from the PRD; retain pure gap helpers but stop treating rectangular action-pad controls as radial circles.
- **Tests:** Run `node -e "import('./scripts/lib/overlap_geometry.mjs').then(({PROFILES,SAFE_AREA_VECTORS}) => { if (PROFILES.length !== 10 || Object.keys(SAFE_AREA_VECTORS).length !== 4) process.exit(1) })"`.
- **Interfaces:** Produces canonical `PROFILES`, `SAFE_AREA_VECTORS`, and state-run descriptors for T20-T25.
- **Dependencies:** T2 for matching screenshot profiles and T18 for the final floor.
- **Estimated time:** 4 minutes.

### T20. Build deterministic browser state and safe-area application helpers

- **Summary:** Make every matrix run start from a known state and make unsupported safe-area testing a blocker.
- **Files:** `scripts/mobile_cluster_layout_check.mjs`, `scripts/lib/overlap_geometry.mjs`.
- **Changes:** Add an idempotent state helper that resets handedness, scales, camera joystick, Consumables, party, pet, menu, and prior inset before applying one descriptor. Apply each inset with `Emulation.setSafeAreaInsetsOverride({ insets: { top, right, bottom, left } })`; wait for two animation frames; verify resolved env-driven geometry changed as expected; reset to zero in `finally` after every run. If the CDP method is unsupported or any requested vector cannot be observed, call the gate's `fail` path and exit nonzero. Do not log-and-skip.
- **Tests:** Run one no-inset state followed by notch-right, zero reset, notch-left, and zero reset at 740x360; assert the second zero run matches the first within subpixel tolerance.
- **Interfaces:** Produces `applyHudState(page, cdp, descriptor)` and `applySafeArea(cdp, vector)` for T21-T26.
- **Dependencies:** T19.
- **Estimated time:** 5 minutes for helper code plus 2-4 minutes for the focused browser run.

### T21. Gate control inventory, order, hitboxes, gaps, and viewport bounds

- **Summary:** Convert the old radial checker into a rectangular action-cluster gate before adding topology relations.
- **Files:** `scripts/mobile_cluster_layout_check.mjs`, `scripts/lib/overlap_geometry.mjs`.
- **Changes:** Remove standalone Autorun and ring-circle assumptions; measure all nine pad buttons, compact/full menu inventory, integrated joystick Autorun target, Consumables, and optional camera joystick; enforce on-screen boxes, the 48px floor, at least 4px gaps, right-handed approved order, and the exact left-handed `Target Attack A2 A1 . / Jump A5 A4 A3 Page` mirror.
- **Tests:** With the dev server running, execute right/left baselines for all ten profiles and the minimum/maximum 740x360 scale states. Require zero failures.
- **Interfaces:** Consumes T20 state setup and real `getBoundingClientRect` records. Produces base cluster evidence for AC 1, 6, 12, 13, and 14.
- **Dependencies:** T20.
- **Estimated time:** 5 minutes for assertions plus 4-8 minutes for the matrix run.

### T22. Gate rendered topology relations and action hierarchy

- **Summary:** Prove the approved layout relationships and emphasis in the rendered page, not only in CSS source.
- **Files:** `scripts/mobile_cluster_layout_check.mjs`, `scripts/lib/overlap_geometry.mjs`.
- **Changes:** Assert, with handedness-aware inequalities: camera probe is on the action side above the pad; map is above movement; target/party are inward of map; menu is on the opposite side; Consumables is immediately inward of movement and its six visible cells form three columns by two rows growing upward/inward; player frame center matches viewport center within tolerance. Collect computed face size/opacity/border tokens and assert Jump/Use > abilities and Target > Attack > Page at default, minimum, and maximum Button Size. Assert Attack's hitbox and visible face are never the largest in compact, standard, tablet, landscape, portrait, or either handedness.
- **Tests:** Run the relational pass on every profile in both handedness modes plus the strict minimum/maximum scale states. Print named relation failures with both rectangles/styles.
- **Interfaces:** Consumes T21 rectangles and T10 measurable face tokens. Produces decisive evidence for FR-1.5, AC 2, AC 8, AC 11, and AC 12.
- **Dependencies:** T21.
- **Estimated time:** 5 minutes for assertions plus 4-8 minutes for the matrix run.

### T23. Gate the camera rectangle and every 3 x 3 start point

- **Summary:** Prove the reserved camera surface is correctly measured and truly starts on canvas.
- **Files:** `scripts/mobile_cluster_layout_check.mjs`, `scripts/lib/overlap_geometry.mjs`.
- **Changes:** Read `getComputedStyle(mobileControls, '::before')`; parse left/top/width/height; convert containing-block coordinates to viewport coordinates by adding `mobileControls.getBoundingClientRect().left/top`; reject nonnumeric or undersized values. Sample x positions `left + 0.5`, midpoint, `right - 0.5` and the equivalent y positions so all nine points are boundary-safe but include the four corners, edge midpoints, and center. In a Vite-served page, dynamically import `/src/game/touch_router.ts`; for every point require `document.elementFromPoint(x, y) === document.getElementById('game-canvas')` and `isCameraDragAllowedAt(target, false) === true`. Also assert menus make the same classifier return false.
- **Tests:** Run all ten profiles, both handedness modes, and the strict inset/scale/camera-joystick states. Require the landscape and portrait PRD minimum dimensions before point sampling.
- **Interfaces:** Consumes the T17 pseudo-element contract and T20 state helper. Produces decisive AC 7 camera evidence.
- **Dependencies:** T22.
- **Estimated time:** 5 minutes for assertions plus 4-8 minutes for the matrix run.

### T24. Gate persistent populated HUD geometry

- **Summary:** Prove the control topology coexists with map, target, party, player, pet, and combat bars.
- **Files:** `scripts/mobile_hud_overlap_audit.mjs`, `scripts/lib/overlap_geometry.mjs`.
- **Changes:** Update control inventory and interactive classification; run every profile in right/left baseline; populate target, party, buffs/debuffs, pet, and player/cast/swing surfaces; assert forbidden overlap rules and the same handedness-aware relations from T22 rather than treating non-overlap as sufficient.
- **Tests:** Run `URL=http://127.0.0.1:5173/ node scripts/mobile_hud_overlap_audit.mjs --gate` in persistent-chrome-only mode; require zero failures.
- **Interfaces:** Consumes the T19 matrix and final layout rectangles. Produces populated persistent-HUD evidence for AC 8 and AC 12.
- **Dependencies:** T23.
- **Estimated time:** 5 minutes for code changes plus 5-10 minutes for the browser run.

### T25. Gate stress states and the window-open matrix

- **Summary:** Add the bounded maximum/minimum, inset, Consumables, party, pet, camera-joystick, and modal states after persistent geometry is green.
- **Files:** `scripts/mobile_hud_overlap_audit.mjs`, `scripts/lib/overlap_geometry.mjs`.
- **Changes:** Execute the exact six PRD state runs, including both notch directions and portrait notch; assert safe-area reachability, open 3 x 2 Consumables topology, party expansion direction, player alignment, and camera-joystick clearance. Preserve the existing intentional overlay exceptions. Run every window at the strict profile and the existing spot profiles; `MATRIX_ALL=1` remains the optional exhaustive window sweep, not a substitute for the required bounded states.
- **Tests:** Run the default `--gate` state/window matrix and then `MATRIX_ALL=1 URL=http://127.0.0.1:5173/ node scripts/mobile_hud_overlap_audit.mjs --gate` before final QA.
- **Interfaces:** Consumes T20 safe-area/state application and T24 persistent geometry. Produces strict AC 8, AC 11, and AC 14 evidence.
- **Dependencies:** T24.
- **Estimated time:** 5 minutes for code changes plus 10-20 minutes for browser runtime.

### T26. Gate compact More actions and two-finger Consumables use

- **Summary:** Prove the relocated actions and inward utility drawer are usable, not only present.
- **Files:** `scripts/mobile_cluster_layout_check.mjs`, `tests/client_shell.test.ts`.
- **Changes:** Add a compact hit-tested flow that opens `#mobile-more`, verifies `elementFromPoint` at the centers of `#mobile-social` and `#mobile-menu`, activates Social and asserts `#social-window` opens, closes it, then activates Settings and asserts `#options-menu` opens. Add a real-page two-pointer flow: hold pointer 1 on movement until the joystick is active; use non-primary pointer 2 to open Consumables; while pointer 1 remains held, use another non-primary tap on a populated slot and assert its count/state changes once; finally release movement. Keep shell assertions that both Consumables controls use `bindTouchTap` and that the compact nodes retain the same IDs.
- **Tests:** Run the interaction pass at 740x360 right-handed and left-handed. Require movement to remain active throughout each second-finger action and no duplicate compatibility click.
- **Interfaces:** Consumes the existing `bindTouchTap` wiring, T8 node reparenting, and T20 state helper. Produces decisive FR-6.6 and FR-8.7 evidence.
- **Dependencies:** T25.
- **Estimated time:** 5 minutes for assertions plus 3-5 minutes for the focused browser flows.

### T27. Capture and inspect final visual evidence

- **Summary:** Capture the six approved after states with the same setup as the baseline.
- **Files:** `scripts/mobile_hud_layout_shots.mjs` and the six `after-*` screenshots.
- **Changes:** Run `SHOT_PHASE=after`; compare every before/after pair at native size; inspect pad hierarchy, camera space, map/menu opposition, inward target/party and Consumables placement, player centering, left-handed mirror, and portrait/tablet continuity. Recapture only through the deterministic harness.
- **Tests:** Run `SHOT_PHASE=after URL=http://127.0.0.1:5173/ node scripts/mobile_hud_layout_shots.mjs`; fail on page/console errors; record manual visual pass/fail per pair.
- **Interfaces:** Consumes T26's validated layout. Produces twelve total visual artifacts for AC 17.
- **Dependencies:** T26.
- **Estimated time:** 3 minutes for command/inspection setup plus 5-10 minutes for browser capture and review.

### T28. Run the contribution gate and report exact evidence

- **Summary:** Close the implementation only after focused, browser, formatting, and canonical gates pass fresh.
- **Files:** No new files beyond task-owned fixes required by a failing check.
- **Changes:** Verify desktop 1280x720 without `mobile-touch`; update comments that still claim radial layout; inspect the final diff against the T0 checkpoint; do not stage, commit, or push without separate user authorization.
- **Tests:** Run, in order:
  1. `npx vitest run tests/interactions.test.ts tests/mobile_controls.test.ts tests/mobile_action_ring_painter.test.ts tests/mobile_hud_layout.test.ts tests/mobile_hud_layout_applier.test.ts tests/client_shell.test.ts tests/touch_router.test.ts tests/consumable_bar_view.test.ts tests/party_collapse.test.ts tests/party_frames_painter.test.ts tests/bank_window.test.ts tests/localization_coverage.test.ts`
  2. `npm run test:browser -- tests/browser/target_size.browser.test.ts`
  3. `URL=http://127.0.0.1:5173/ node scripts/mobile_cluster_layout_check.mjs`
  4. `URL=http://127.0.0.1:5173/ node scripts/mobile_hud_overlap_audit.mjs --gate`
  5. `npm run ci:changed`
  6. `npm run gate`
- **Interfaces:** Consumes every prior task. Produces the final diff and exact current command outcomes, including any unavailable check or remaining risk.
- **Dependencies:** T27.
- **Estimated time:** 2 minutes to launch and audit commands plus approximately 20-40 minutes of browser/full-gate runtime and any diagnosis.

## Acceptance criteria traceability

| AC | Implementation tasks | Decisive verification |
|---:|---|---|
| 1. Approved two-row order | T6, T9, T14, T15 | `client_shell.test.ts`; T21 right/left rendered order |
| 2. Explicit tertiary Attack, unchanged behavior | T3, T4, T10, T22 | interaction/painter tests; forced-colors contract; rendered hierarchy at every tier/scale |
| 3. Stable contextual Jump/Use while moving | T3, T4, T5 | interaction, painter, and two-pointer control tests |
| 4. Direct unchanged Target | T6, T9 | shell contract; existing `onCycleTarget` control tests; T21 inventory |
| 5. Pages map 1-5 and 6-10 | T6 | unchanged `mobile_action_page_view` tests plus shell inventory |
| 6. Page left of A3, tap-only | T5, T9, T14 | control tests; T21 right/left grid-order geometry |
| 7. Camera rectangle meets minimum and all 3 x 3 points drag | T17, T23 | router tests; containing-block-aware probe dimensions; canvas hit test and classifier at all nine points |
| 8. Full HUD has no forbidden overlaps and keeps approved relations | T11-T16, T22, T24, T25 | rendered relation gate plus persistent/stress overlap audits |
| 9. Compact menu is Chat, Quests, More; Social/Settings in More | T6-T8, T12, T26 | layout/applier tests; compact hit-tested Social/Settings flows |
| 10. Integrated Autorun only | T0, T1, T6 | checkpoint comparison; source scan; PR #1724 controls tests; no standalone geometry inventory |
| 11. Automatic stable 3 x 2 Consumables | T13, T22, T25, T26 | unchanged view tests; rendered expansion relation; open-state geometry; second-finger use flow |
| 12. Complete left-handed mirror | T14, T21-T25 | every-profile left/right order, relation, camera, and populated-state runs |
| 13. Every gameplay target is at least 48 x 48px | T10, T18, T21 | real browser target-size test and minimum-scale cluster run |
| 14. Safe areas and optional camera joystick remain reachable | T16, T20, T23, T25 | hard-fail inset protocol plus bounded scale/inset/camera-joystick matrix |
| 15. `index.html` and `play.html` parity | T6 | `client_shell.test.ts` structural comparison |
| 16. Desktop unchanged | T7, T8, T28 | no-touch layout output; desktop visual smoke; full gate |
| 17. Screenshots and gate pass | T2, T27, T28 | twelve images; browser scripts; `npm run test:browser`; `npm run gate` |

## Incremental correctness rules

- T0 must leave a clean tree and a recorded recovery SHA before T1 starts.
- After T1, compare the rebased overlap files to T0 and keep the focused rebase suite green before layout edits start.
- T3 through T8 must keep behavior tests green while geometry is still old.
- T9 through T17 may temporarily fail old literal CSS assertions only in the test changed by the same task. No task ends with typecheck or focused tests red.
- T18 establishes the rendered floor before geometry scripts depend on it.
- T19 defines one matrix before either browser script changes its loops.
- T20 must hard-fail unsupported safe-area emulation and reset all mutable state between runs.
- T21, T22, and T23 must pass in order before interpreting full-HUD overlap failures.
- T24 must pass before adding the T25 stress/window matrix, and both must pass before interaction flows.
- T28 is the only point at which completion may be claimed, and only with fresh gate output.

## Review focus

| Gate | Verdict | Required changes |
|---|---|---|
| Feasibility | Pass | None after checkpoint, safe-area, camera-probe, and task-splitting revisions |
| Product lens | Pass | None after rendered-relation, hierarchy, More-flow, and two-pointer Consumables revisions |

Both mandatory reviews passed on 2026-07-10. The plan has no unresolved product gap. The external PR #1724 and T0 checkpoint blockers were satisfied before final verification.

Feasibility review should pay special attention to PR #1724 conflict handling, DOM reparenting order, CSS hitbox scaling, pseudo-element camera measurement, and browser-matrix runtime.

Product review should verify that Attack is never presented as primary, Jump/Use and Target remain nearest the action thumb, Page remains farthest, the camera zone is truly usable rather than decorative, and compact menu/Consumables placement matches the approved topology.
