# Implementation Plan: Mobile Touch HUD Layout

| | |
|---|---|
| Status | Verified; rightward compact Consumables follow-up and all nine canonical gate steps passed |
| Date | 2026-07-10 |
| Branch | `mobile-layout-adjustments` |
| Product spec | [Mobile Touch HUD Layout PRD](../prd/mobile-compact-landscape-hud.md) |
| Required base | [PR #1724: joystick autorun lock](https://github.com/levy-street/world-of-claudecraft/pull/1724) |

> Superseded follow-up: [Mobile HUD Readability Adjustments](2026-07-11-mobile-hud-readability-adjustments.md)
> replaces the historical compact 2 x 3 drawer and `0.62 / 0.9 / 1.0` frame constants recorded
> below. The current contract is 3 x 2 Consumables on every landscape tier, player scales
> `0.72 / 1 / 1.1`, Target ratio `0.9`, and transient mob details below the minimap. T29 through
> T34 remain as implementation history, not current layout requirements.

## Outcome

Replace the radial mobile action ring with the approved two-row action pad, preserve the contextual Jump/Use WIP, reserve a measurable canvas camera-start zone, move the minimap and compact menu to opposite top corners, place the automatic Consumables drawer beside the movement joystick, and validate the complete topology across landscape touch tiers, handedness, safe areas, settings extremes, and populated HUD states.

The implementation must not change combat, targeting, ability paging, interaction priority, Consumables selection, desktop layout, or pointer-ownership semantics.

## Progress

- [x] T0: Create a recoverable pre-rebase checkpoint - pre-rebase SHA `fb473dc74`, 2026-07-10
- [x] T1: Rebase on integrated joystick Autorun - release merge `083856d8c`, 2026-07-10
- [x] T2-T23: Layout implementation and focused geometry checks prepared - 2026-07-10
- [x] T24-T27: Populated/stress interaction rerun and landscape evidence review - 2026-07-10
- [x] T28: Run the contribution gate and report exact evidence - all nine canonical gate steps passed, 2026-07-10
- [x] T29: Redock landscape Party beside the map, safe-center Target, and enlarge player chrome, 2026-07-10
- [x] T30: Compact Party to an icon-only disclosure and dock pet commands above the action pad, 2026-07-10
- [x] T31: Remove mobile pet tiles, move the optional view joystick to the view side, and reduce Target
- [x] T32: Rebalance joystick inset, movement wheel, Consumables faces, and Target scale
- [x] T33: Dock open compact Consumables low beside the movement joystick
- [x] T34: Keep the compact Consumables toggle low and expand items toward the player frame

### T28 verification note (2026-07-10)

All task-specific unit, browser, real-page geometry, interaction, visual, changed-file lint,
i18n freshness, malware, typecheck, and build checks passed. Earlier full-suite attempts exposed
unrelated five-second test timeouts, and each affected test passed immediately in isolation. The
latest fresh `npm run gate` completed successfully: all nine steps were green, Vitest recorded
11,487 passing and 14 skipped tests, and the malware scan reported zero high-severity findings.
T28 is complete.

## Scope amendment: portrait handled elsewhere

On 2026-07-10 the user removed portrait gameplay from this contribution because another PR
will disable that orientation. Keep existing portrait compatibility CSS intact, but exclude
portrait profiles, screenshots, and geometry results from this plan's acceptance gate.

## Follow-up amendment: map-adjacent Party, centered Target, and larger player chrome

On 2026-07-10 the user replaced the temporary top-center Party placement. In every landscape
touch tier, Party now occupies one top row immediately inward of the minimap and follows the map
when handedness mirrors. The row contains the Party disclosure, all expanded 68px member cards,
and the compact close-icon Leave control. Target owns a separate row 48px below the safe top edge
and is centered within the safe viewport width. The complete player frame and its cast/swing bars
share a responsive scale of 0.72 on compact phones, 1 on standard touch screens, and 1.1 on
tablets. Player chrome is also centered within the safe width so a landscape notch moves it away
from the action pad without reducing its size.

The Party disclosure now exposes only a compact 28px glass chevron while retaining its 40px
transparent hit target and visually hidden localized label. A live pet's command bar is no longer
part of the top-center/Target stack: it docks directly above the action pad with an 8px gap and
mirrors with that pad for left-handed play. The guaranteed upper action-side camera rectangle is
`min(30vw, 220px)` by `min(24vh, 100px)` so it clears the pet bar at the 740x360 maximum-scale
stress state; swipe-look remains available on all other unobstructed canvas pixels.

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
- `scripts/mobile_autorun_shot.mjs`
- `scripts/_probe_layout_visual.mjs`

### Preserve as existing evidence

- `docs/solutions/2026-07-10-mobile-context-interact.md`
- `docs/screenshots/mobile-context-interact-after.png`
- `docs/screenshots/mobile-context-interact-after-ring.png`
- `docs/screenshots/mobile-context-interact-after-npc-selected.png`

Update the solution note only if the rebase changes an already documented behavior. Do not overwrite or recapture the existing context-interaction evidence as part of the layout work.

### Consume and extend

- `src/ui/mobile_action_page_view.ts`
  - Keep `MOBILE_ACTIONS_PER_PAGE` at five and extend the shared source span to 15 slots, producing three pages through the existing `mobilePageCount`, `sourceSlotForMobileButton`, `sourceSlotsForMobilePage`, and `nextMobilePage` arithmetic.
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
A1, A2, A5, Target, Page, A3, A4, Attack, Jump/Use
```

CSS grid areas place them as:

```text
.     A1  A2  A5      Target
Page  A3  A4  Attack  Jump/Use
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

- `compact` for every compact landscape tier.
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

Landscape minimums are `min(30vw, 220px)` by `min(24vh, 100px)`. The retained compatibility-only
portrait rule remains `min(42vw, 160px)` by `min(24vh, 200px)`, but portrait gameplay QA is owned
by the separate orientation PR.

### Hitbox and visual scaling

The button element owns the unscaled interactive target. The user's Button Size setting scales only inner visual content and decoration. Compact minimums:

- A1 through A5, Attack, Target, Page, Consumables toggle and slots, and compact menu: 48 x 48px.
- Jump/Use: 56 x 56px.
- Interactive edge gap: at least 4px.

Do not apply `transform: scale(var(--btn-scale))` to the hitbox element. Use an inner icon/face transform or size variables clamped independently from the target dimensions.

### Attack active state

Keep `ActionBarSlotState.queued` as the source for active auto-attack. `ActionBarPainter` continues toggling `.queued`. `MobileActionRingPainter` adds a write-elided `aria-pressed="true|false"` update on the fixed Attack button. CSS renders the active state through the stronger queued outline and glow, with an explicit forced-colors treatment, without adding a detached corner marker. No attack behavior changes.

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

- **Summary:** Preserve an auditable before state at the exact five landscape visual-QA profiles.
- **Files:** `scripts/mobile_hud_layout_shots.mjs`, five landscape `before-*` files under `docs/screenshots/mobile-hud-layout/`.
- **Changes:** Reuse `BROWSER_PATH` and `enterOfflineGame`; accept `SHOT_PHASE=before|after`; create deterministic resting, Consumables-open, target/party, left-handed, and tablet-landscape states; fail on page errors or unexpected console errors.
- **Tests:** Start `npm run dev -- --host 127.0.0.1`; run `SHOT_PHASE=before URL=http://127.0.0.1:5173/ node scripts/mobile_hud_layout_shots.mjs`; inspect all five images at native size.
- **Interfaces:** Consumes existing offline-game and browser helpers. Produces five named baseline screenshots and the same capture path for T27.
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
- **Changes:** Add the `MobileMenuPlacement` type and `menuPlacement` output. Cover all seven canonical landscape viewports, threshold boundaries, desktop cleanup behavior, determinism, and existing safe-area CSS vars.
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
- **Changes:** Introduce the named size/gap variables, keep button boxes unscaled, scale inner faces only, set Jump/Use to 56px in compact, add at least 4px gaps, render Attack's `.queued` state as an outline and glow without a detached marker, and add forced-colors and reduced-motion rules. Define measurable face variables so the rendered order is Jump/Use highest; abilities and Target next; Attack below them; Page lowest. Enumerate `.ui-icon`, `.icon-label`, `.mobile-label`, `.item-count`, `.cd-overlay`, `.cdtext`, `.keybind`, and the page indicator so no interactive ancestor receives `--btn-scale`.
- **Tests:** Add source-contract failures for unscaled hitboxes, complete descendant ownership, measurable face hierarchy, and active-state fallback; run `npx vitest run tests/client_shell.test.ts tests/mobile_action_ring_painter.test.ts`. T22 adds decisive computed-style comparisons across tiers and scales.
- **Interfaces:** Consumes `.queued` and `aria-pressed` from T4. Produces minimum hitbox and emphasis tokens for every tier.
- **Dependencies:** T4 and T9.
- **Estimated time:** 5 minutes.

### T11. Reflow minimap, target, and party as one top-corner system

- **Summary:** Put map above movement and keep target inward without entering the camera zone;
  T29 supersedes the original Party placement.
- **Files:** `tests/client_shell.test.ts`, `src/styles/hud.mobile.css`.
- **Changes:** Add named map/anchor variables; set compact map width to roughly 80-85px; preserve map zoom and target/party interaction. The original target and Party placement is superseded by T29.
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

### T13. Move Consumables beside movement and render a stable responsive drawer

- **Summary:** Keep automatic item selection but change only placement and expansion geometry.
- **Files:** `tests/client_shell.test.ts`, `src/styles/hud.mobile.css`.
- **Changes:** Place the closed toggle immediately inward of the movement capture zone; keep it
  low when open and fill the compact 2-column drawer toward the player frame before wrapping
  upward; retain the 3-column by 2-row upward/inward drawer on larger tiers; collapse empty slots;
  preserve the stable open snapshot, live
  count/usability/cooldown painting, long-press inspection, and multi-touch button path.
- **Tests:** Add failing CSS/source assertions, implement the geometry, then run `npx vitest run tests/client_shell.test.ts tests/consumable_bar_view.test.ts`; manually open/close twice to verify stable order.
- **Interfaces:** Consumes the unchanged six-slot markup and `consumableBarItems`. Produces closed and open geometry for T22, T25, and T26.
- **Dependencies:** T12.
- **Estimated time:** 4 minutes.

### T14. Mirror the whole topology for left-handed play

- **Summary:** Mirror side ownership and internal pad proximity, not only the two joysticks.
- **Files:** `tests/client_shell.test.ts`, `src/styles/hud.mobile.css`.
- **Changes:** Move joystick/map to the right, Party inward-left beside the map, Consumables inward-left, action pad and camera zone left, and menu right-to-left to the top-left. Keep Target and player chrome safe-centered. Pin the mirrored grid explicitly as `Target A5 A2 A1 . / Jump Attack A4 A3 Page`, so Jump/Use and Target are nearest the left thumb and Page remains farthest away. Do not change source-slot mapping or labels.
- **Tests:** Add source-contract assertions for all mirrored anchors; run `npx vitest run tests/client_shell.test.ts tests/settings.test.ts`; inspect the 740x360 left-handed state.
- **Interfaces:** Consumes `body.mobile-left-handed`. Produces a complete mirror for T21-T25, with no JS action remapping.
- **Dependencies:** T13.
- **Estimated time:** 5 minutes.

### T15. Add standard and tablet landscape tier geometry

- **Summary:** Preserve one action topology while tuning compact, standard, and tablet landscape tiers.
- **Files:** `tests/client_shell.test.ts`, `src/styles/hud.mobile.css`.
- **Changes:** Add tier-specific named size/gap/map variables and retain the bottom-center player frame without the old radial nudge. Existing portrait compatibility rules are not changed or accepted here.
- **Tests:** Run `npx vitest run tests/client_shell.test.ts`; inspect the compact landscape phones and 1024x768 before adding stress-state rules.
- **Interfaces:** Consumes tier and landscape selectors. Produces baseline geometry for all seven canonical profiles.
- **Dependencies:** T14.
- **Estimated time:** 5 minutes.

### T16. Add safe-area, scale-extreme, and camera-joystick CSS constraints

- **Summary:** Keep controls reachable under settings extremes and device insets.
- **Files:** `tests/client_shell.test.ts`, `src/styles/hud.mobile.css`.
- **Changes:** Add left/right/top/bottom safe-area anchors, maximum joystick/button-scale clearance, minimum-scale hitbox floors, and optional camera-joystick clearance. Keep every anchor expressed through named variables so browser state runners can inspect it.
- **Tests:** Run `npx vitest run tests/client_shell.test.ts`; use browser devtools spot checks for minimum and maximum scales in 740x360 before automating the matrix.
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
- **Changes:** Extend `PROFILES` to all seven landscape PRD viewports; add the three landscape `SAFE_AREA_VECTORS`; encode the five bounded landscape state runs from the PRD; retain pure gap helpers but stop treating rectangular action-pad controls as radial circles.
- **Tests:** Run `node -e "import('./scripts/lib/overlap_geometry.mjs').then(({PROFILES,SAFE_AREA_VECTORS}) => { if (PROFILES.length !== 7 || Object.keys(SAFE_AREA_VECTORS).length !== 3) process.exit(1) })"`.
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
- **Changes:** Remove standalone Autorun and ring-circle assumptions; measure all nine pad buttons, compact/full menu inventory, integrated joystick Autorun target, Consumables, and optional camera joystick; enforce on-screen boxes, the 48px floor, at least 4px gaps, right-handed approved order, and the exact left-handed `Target A5 A2 A1 . / Jump Attack A4 A3 Page` mirror.
- **Tests:** With the dev server running, execute right/left baselines for all seven landscape profiles and the minimum/maximum 740x360 scale states. Require zero failures.
- **Interfaces:** Consumes T20 state setup and real `getBoundingClientRect` records. Produces base cluster evidence for AC 1, 6, 12, 13, and 14.
- **Dependencies:** T20.
- **Estimated time:** 5 minutes for assertions plus 4-8 minutes for the matrix run.

### T22. Gate rendered topology relations and action hierarchy

- **Summary:** Prove the approved layout relationships and emphasis in the rendered page, not only in CSS source.
- **Files:** `scripts/mobile_cluster_layout_check.mjs`, `scripts/lib/overlap_geometry.mjs`.
- **Changes:** Assert, with handedness-aware inequalities: camera probe is on the action side above
  the pad; map is above movement; Party sits immediately inward of the map in one top row; Target
  occupies the safe-centered second row; menu is on the opposite side; Consumables sits immediately
  inward of movement, keeps its compact toggle low, fills toward the player frame before wrapping
  upward, and retains the larger-tier 3-column by 2-row topology; player frame center matches the
  safe viewport center and its rendered width meets the
  tier floor. Collect computed face size/opacity/border tokens and assert Jump/Use > abilities and
  Target > Attack > Page at default, minimum, and maximum Button Size. Assert Attack's hitbox and
  visible face are never the largest in compact, standard, or tablet landscape, or either
  handedness.
- **Tests:** Run the relational pass on every profile in both handedness modes plus the strict minimum/maximum scale states. Print named relation failures with both rectangles/styles.
- **Interfaces:** Consumes T21 rectangles and T10 measurable face tokens. Produces decisive evidence for FR-1.5, AC 2, AC 8, AC 11, and AC 12.
- **Dependencies:** T21.
- **Estimated time:** 5 minutes for assertions plus 4-8 minutes for the matrix run.

### T23. Gate the camera rectangle and every 3 x 3 start point

- **Summary:** Prove the reserved camera surface is correctly measured and truly starts on canvas.
- **Files:** `scripts/mobile_cluster_layout_check.mjs`, `scripts/lib/overlap_geometry.mjs`.
- **Changes:** Read `getComputedStyle(mobileControls, '::before')`; parse left/top/width/height; convert containing-block coordinates to viewport coordinates by adding `mobileControls.getBoundingClientRect().left/top`; reject nonnumeric or undersized values. Sample x positions `left + 0.5`, midpoint, `right - 0.5` and the equivalent y positions so all nine points are boundary-safe but include the four corners, edge midpoints, and center. In a Vite-served page, dynamically import `/src/game/touch_router.ts`; for every point require `document.elementFromPoint(x, y) === document.getElementById('game-canvas')` and `isCameraDragAllowedAt(target, false) === true`. Also assert menus make the same classifier return false.
- **Tests:** Run all seven landscape profiles, both handedness modes, and the strict inset/scale/camera-joystick states. Require the landscape PRD minimum dimensions before point sampling.
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
- **Changes:** Execute the five landscape PRD state runs, including both notch directions; assert
  safe-area reachability, the responsive open Consumables topology, party expansion direction,
  player alignment, and camera-joystick clearance. Preserve the existing intentional overlay
  exceptions. Run every window at the strict profile and the existing spot profiles;
  `MATRIX_ALL=1` remains the optional exhaustive window sweep, not a substitute for the required
  bounded states.
- **Tests:** Run the default `--gate` state/window matrix and then `MATRIX_ALL=1 URL=http://127.0.0.1:5173/ node scripts/mobile_hud_overlap_audit.mjs --gate` before final QA.
- **Interfaces:** Consumes T20 safe-area/state application and T24 persistent geometry. Produces strict AC 8, AC 11, and AC 14 evidence.
- **Dependencies:** T24.
- **Estimated time:** 5 minutes for code changes plus 10-20 minutes for browser runtime.

### T26. Gate compact More actions and two-finger Consumables use

- **Summary:** Prove the relocated actions and inward utility drawer are usable, not only present.
- **Files:** `scripts/mobile_cluster_layout_check.mjs`, `tests/client_shell.test.ts`.
- **Changes:** Add a compact hit-tested flow that opens `#mobile-more`, verifies `elementFromPoint` at the centers of `#mobile-social` and `#mobile-menu`, activates Social and asserts `#social-window` opens, closes it, then activates Settings and asserts `#options-menu` opens. Add a real-page two-pointer flow: hold pointer 1 on movement until the joystick is active; use non-primary pointer 2 to open Consumables; while pointer 1 remains held, use another non-primary tap on a populated slot and assert its count/state changes once; finally release movement. Keep shell assertions that both Consumables controls use `bindTouchTap` and that the compact nodes retain the same IDs.
- **Tests:** Run the interaction pass at 740x360 right-handed and left-handed. Require movement to remain active throughout each second-finger action and no duplicate compatibility click.
- **Interfaces:** Consumes the existing `bindTouchTap` wiring, T8 node reparenting, and T20 state helper. Produces decisive FR-6.8 and FR-8.7 evidence.
- **Dependencies:** T25.
- **Estimated time:** 5 minutes for assertions plus 3-5 minutes for the focused browser flows.

### T27. Capture and inspect final visual evidence

- **Summary:** Capture the five approved landscape after states with the same setup as the baseline.
- **Files:** `scripts/mobile_hud_layout_shots.mjs` and the five landscape `after-*` screenshots.
- **Changes:** Run `SHOT_PHASE=after`; compare every landscape before/after pair at native size; inspect pad hierarchy, camera space, map/menu opposition, map-adjacent Party, safe-centered Target, Consumables placement, responsive player sizing, left-handed mirror, and tablet continuity. Recapture only through the deterministic harness.
- **Tests:** Run `SHOT_PHASE=after URL=http://127.0.0.1:5173/ node scripts/mobile_hud_layout_shots.mjs`; fail on page/console errors; record manual visual pass/fail per pair.
- **Interfaces:** Consumes T26's validated layout. Produces ten total landscape visual artifacts for AC 17.
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

### T29. Redock landscape Party, Target, and player chrome

- **Summary:** Put Party in one top row beside the minimap, place Target in a safe-centered
  second row, enlarge player chrome responsively, and retain the compact close-icon Leave control.
- **Files:** `src/styles/hud.mobile.css`, `src/ui/party_frame_row.ts`,
  `src/ui/party_frames_painter.ts`, `tests/client_shell.test.ts`,
  `tests/party_frames_painter.test.ts`, `scripts/mobile_cluster_layout_check.mjs`, PRD, plan,
  and refreshed landscape screenshots.
- **Changes:** Keep the existing disclosure and collapse persistence. In landscape, anchor the
  Party container immediately inward of the map, render disclosure, members, and Leave in one
  horizontal row with 68px scale-based card widths and 40px minimum hit heights, and mirror the
  dock with the map in left-handed mode. Place Target 48px below the safe top edge at safe center.
  Build the Leave control with the shared close SVG, retain a 40 x 40px hitbox, render a 28px
  visual face, and route both its label span and `aria-label` through elided localized writers.
  Scale the whole player frame and matching cast/swing bars at 0.62, 0.9, and 1.0 across compact,
  standard, and tablet tiers. Safe-center that group so notches preserve action-pad clearance.
  T30 supersedes the temporary pet-bar placement below Target.
- **Tests:** Pin the CSS and builder/painter contract, verify the writer-routed accessible name,
  assert Party/map adjacency, one-row members, Target/player safe centering, and player tier
  scales; run the full landscape cluster and overlap matrices, then recapture and inspect every
  landscape screenshot.
- **Dependencies:** T27 and the integrated T1 base.
- **Estimated time:** 10-20 minutes including real-browser geometry and visual review.

### T30. Compact Party disclosure and dock pet commands with skills

- **Summary:** Replace the visible Party caption with a small chevron face and keep pet commands
  beside the action thumb instead of in the top-center information stack.
- **Files:** `src/ui/party_chip.ts`, `src/styles/hud.mobile.css`,
  `tests/client_shell.test.ts`, PRD, plan, and refreshed landscape screenshots.
- **Changes:** Keep a 40 x 40px Party hit target but make its shell transparent, render only a
  28px glass-backed chevron, and retain the localized caption as visually hidden accessible text.
  In landscape, align the pet bar's action-side edge with the skill pad and place it 8px above the
  pad in compact, standard, and tablet tiers. Mirror the pair together for left-handed mode.
  Shorten the guaranteed camera rectangle to `min(24vh, 100px)` so it occupies the unobstructed
  upper action-side band; do not restrict normal swipe-look to that audit rectangle.
- **Tests:** Pin the icon-only/accessibility and tiered pet-dock CSS contracts; run the focused
  party/shell tests, quick cluster check, both-handed 740x360 max-scale pet stress audit, and
  inspect refreshed right/left screenshots at native size.
- **Dependencies:** T29.
- **Estimated time:** 10 minutes including real-browser capture and stress geometry.

### T31. Simplify pet chrome, redock view joystick, and reduce Target

- **Summary:** Remove mobile-only dark pet tiles, place the optional view joystick on the view
  side, and keep Target visually subordinate to the player frame.
- **Files:** `src/styles/hud.mobile.css`, `tests/client_shell.test.ts`,
  `scripts/mobile_cluster_layout_check.mjs`, `scripts/mobile_hud_overlap_audit.mjs`,
  `scripts/mobile_hud_layout_shots.mjs`, PRD, plan, and refreshed landscape screenshots.
- **Changes:** Keep each pet command's 40 x 40px hitbox while exposing only 32px circular art and
  removing the group panel, button background, border, and shadow on mobile. In default landscape,
  seat the optional view joystick on the right and keep the full camera-start rectangle inward of
  it; mirror both controls in left-handed mode. Scale Target at 72 percent of the tier's player
  scale so its rendered width stays below the player frame in compact, standard, and tablet tiers.
- **Tests:** Pin source contracts, assert rendered Target/player hierarchy and view-joystick side,
  verify pet hitbox, art, and transparent group chrome in the populated browser audit, run the full
  landscape matrix and 740 x 360 maximum-scale stress state, then inspect refreshed screenshots.
- **Dependencies:** T30.
- **Estimated time:** 10 minutes including real-browser capture and contribution gate.

### T31 verification note (2026-07-10)

The focused shell and party tests passed 116/116. The complete compact-to-FHD landscape matrix
passed for both handedness modes, and the populated maximum-scale 740 x 360 stress audit reported
zero layout violations. Refreshed screenshots confirm the intended visual hierarchy. The final
fresh `npm run gate` passed all nine canonical steps with 11,488 passing and 14 skipped tests,
followed by successful typecheck, environment build, server build, and client build.

### T32. Rebalance compact control scale after visual review

- **Summary:** Move the optional view joystick slightly farther inward, trim the movement wheel,
  compact the visible Consumables chrome without reducing its hitboxes, and make Target slightly
  larger while keeping it subordinate to the player frame.
- **Files:** `src/styles/hud.mobile.css`, `tests/client_shell.test.ts`,
  `scripts/mobile_hud_overlap_audit.mjs`, PRD, plan, and refreshed landscape screenshots.
- **Changes:** Seat the view joystick 30px from the viewport edge or 12px beyond its safe inset,
  reduce the landscape movement wheel from 128px to 116px without changing its capture zone, keep
  Consumables at 48 x 48px hitboxes with clamped 36 to 40px visual faces, and raise the Target
  tier ratio from 0.72 to 0.8. Move the guaranteed view zone down by 2px to clear the enlarged
  Target in the maximum-scale 740 x 360 state.
- **Tests:** Pin the source values, measure 40px Consumables faces in the real browser, rerun the
  full landscape and handedness matrix plus the maximum-scale stress audit, inspect refreshed
  screenshots, and run the contribution gate.
- **Dependencies:** T31.
- **Estimated time:** 10 minutes including browser verification and contribution gate.

### T32 verification note (2026-07-10)

The focused shell and party tests passed 116/116 and the real-browser target-size suite passed
12/12. The complete compact-to-FHD landscape matrix passed for both handedness modes and measured
the exact view-joystick inset, 116px movement wheel, unchanged capture zone, and 0.8 rendered
Target tier ratio. Open Consumables states passed at Button Size 0.8, 1.0, and 1.3 with exact
48px hitboxes, 36/40/40px faces, and matching cooldown overlays. The populated maximum-scale
740 x 360 stress audit reported zero layout violations. Refreshed screenshots passed native-size
review. After frontend and test review findings were resolved, the final fresh `npm run gate`
passed all nine canonical steps with 11,488 passing and 14 skipped tests, followed by successful
typecheck, environment build, server build, and client build.

### T33. Dock open compact Consumables low beside movement

- **Summary:** Correct the compact open state so the item drawer stays in the bottom band directly
  inward of the movement joystick instead of rising into the view.
- **Files:** `src/styles/hud.mobile.css`, `tests/client_shell.test.ts`,
  `scripts/mobile_cluster_layout_check.mjs`, PRD, plan, and refreshed compact screenshot.
- **Changes:** Use a 2 x 3 compact grid between the fixed movement capture zone and player frame,
  move the disclosure above the open drawer, mirror the geometry for left-handed mode, and leave
  standard/tablet 3 x 2 behavior unchanged.
- **Tests:** Pin the compact CSS, measure the rendered 2 x 3 topology and movement-zone relation in
  both handedness modes, rerun the maximum-scale overlap audit, inspect the refreshed screenshot,
  and run the contribution gate.
- **Dependencies:** T32.
- **Estimated time:** 10 minutes including browser verification and contribution gate.

### T33 verification note (2026-07-10)

The focused shell and Party tests passed 116/116 and the real-browser target-size suite passed
12/12. The complete compact-to-FHD landscape matrix passed for both handedness modes; compact open
states rendered the 2 x 3 topology at Button Size 0.8, 1.0, and 1.3, remained outside the unchanged
movement capture zone, and preserved the standard/tablet 3 x 2 behavior. The populated maximum-
scale 740 x 360 stress audit reported zero layout violations. The refreshed Consumables screenshot
was inspected at its exact 740 x 360 viewport size. The final fresh `npm run gate` passed all nine
canonical steps with 11,488 passing and 14 skipped tests, followed by successful typecheck,
environment build, server build, and client build.

### T34. Keep the compact disclosure low and fill toward the player frame

- **Summary:** Correct T33's expansion direction: the disclosure remains bottom-right of the
  movement joystick and carried items open from it toward the hero health frame.
- **Files:** `src/styles/hud.mobile.css`, `tests/client_shell.test.ts`,
  `scripts/mobile_cluster_layout_check.mjs`, PRD, plan, and refreshed compact screenshot.
- **Changes:** Seat the toggle 4px beyond the fixed movement capture zone, fill the first compact
  item row horizontally toward the player frame, wrap later items upward, mirror the direction in
  left-handed mode, and lift only the item drawer when either landscape safe inset squeezes the
  space around the centered player frame.
- **Tests:** Pin the low toggle and expansion direction in source, measure the first two rendered
  slots and full 2 x 3 topology in both handedness modes, rerun the maximum-scale overlap audit,
  inspect the refreshed screenshot, and run the contribution gate.
- **Dependencies:** T33.
- **Estimated time:** 10 minutes including browser verification and contribution gate.

### T34 verification note (2026-07-10)

The focused shell and Party suite passed 116/116 and the real-browser target-size suite passed
12/12. The full landscape cluster matrix passed at every supported profile and Button Size for
both handedness modes, including exact low-toggle spacing, expansion toward the player frame,
ordinal upward wrapping, unchanged standard/tablet open geometry, and a targeted movement-side
safe-inset case. The populated maximum-scale stress audit reported zero notes and zero violations,
and the refreshed 740 x 360 screenshot was visually inspected. The final fresh `npm run gate`
passed all nine canonical steps with 11,488 passing and 14 skipped tests, followed by successful
typecheck, environment build, server build, and client build.

## Acceptance criteria traceability

| AC | Implementation tasks | Decisive verification |
|---:|---|---|
| 1. Approved two-row order | T6, T9, T14, T15 | `client_shell.test.ts`; T21 right/left rendered order |
| 2. Explicit tertiary Attack, unchanged behavior | T3, T4, T10, T22 | interaction/painter tests; forced-colors contract; rendered hierarchy at every tier/scale |
| 3. Stable contextual Jump/Use while moving | T3, T4, T5 | interaction, painter, and two-pointer control tests |
| 4. Direct unchanged Target | T6, T9 | shell contract; existing `onCycleTarget` control tests; T21 inventory |
| 5. Pages map 1-5, 6-10, and 11-15 | T6 | `mobile_action_page_view`, ring painter, and spellbook view tests plus shell inventory |
| 6. Page left of A3, tap-only | T5, T9, T14 | control tests; T21 right/left grid-order geometry |
| 7. Camera rectangle meets minimum and all 3 x 3 points drag | T17, T23 | router tests; containing-block-aware probe dimensions; canvas hit test and classifier at all nine points |
| 8. Full HUD has no forbidden overlaps and keeps approved relations | T11-T16, T22, T24, T25, T31 | rendered relation gate plus persistent/stress overlap audits |
| 9. Compact menu is Chat, Quests, More; Social/Settings in More | T6-T8, T12, T26 | layout/applier tests; compact hit-tested Social/Settings flows |
| 10. Integrated Autorun only | T0, T1, T6 | checkpoint comparison; source scan; PR #1724 controls tests; no standalone geometry inventory |
| 11. Automatic stable responsive Consumables drawer | T13, T22, T25, T26, T33, T34 | unchanged view tests; low compact toggle and player-frame expansion; larger-tier 3 x 2 geometry; movement-zone relation; second-finger use flow |
| 12. Complete left-handed mirror | T14, T21-T25, T31 | every-profile left/right order, relation, camera, and populated-state runs |
| 13. Primary gameplay targets are at least 48 x 48px; pet commands are 40 x 40px | T10, T18, T21, T31 | real browser target-size test, minimum-scale cluster run, and rendered pet audit |
| 14. Safe areas and optional camera joystick remain reachable | T16, T20, T23, T25, T31 | hard-fail inset protocol plus bounded scale/inset/camera-joystick matrix |
| 15. `index.html` and `play.html` parity | T6 | `client_shell.test.ts` structural comparison |
| 16. Desktop unchanged | T7, T8, T28 | no-touch layout output; desktop visual smoke; full gate |
| 17. Screenshots and gate pass | T2, T27, T28 | ten landscape images; browser scripts; `npm run test:browser`; `npm run gate` |

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
- T28 and any later follow-up task may be completed only with fresh gate output for the final code.

## Review focus

| Gate | Verdict | Required changes |
|---|---|---|
| Feasibility | Pass | None after checkpoint, safe-area, camera-probe, and task-splitting revisions |
| Product lens | Pass | None after rendered-relation, hierarchy, More-flow, and two-pointer Consumables revisions |

Both mandatory reviews passed on 2026-07-10. The plan has no unresolved product gap. The external PR #1724 and T0 checkpoint blockers were satisfied before final verification.

Feasibility review should pay special attention to PR #1724 conflict handling, DOM reparenting order, CSS hitbox scaling, pseudo-element camera measurement, and browser-matrix runtime.

Product review should verify that Attack is never presented as primary, Jump/Use and Target remain nearest the action thumb, Page remains farthest, the camera zone is truly usable rather than decorative, and compact menu/Consumables placement matches the approved topology.
