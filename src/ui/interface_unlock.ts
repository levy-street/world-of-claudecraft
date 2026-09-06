// Coordinator behind the "Unlock interface" Interface option: one flag, one
// registry of MovableFrame instances, and the body class the stylesheet reads.
//
// It owns no geometry of its own. Every frame it governs is an ordinary
// MovableFrame (movable_frame.ts) that already knows how to drag, scale, clamp
// and persist itself; this module only decides WHICH of them are loose right
// now, which is the whole feature: a single press unlocks every live frame and a
// second press locks them all back. The eligibility rule and the frame table are
// pure (interface_unlock_core.ts) so a Vitest pins them without a DOM.
//
// Desktop only, like every frame gesture in this HUD: MovableFrame refuses a
// gesture on the mobile layout and the stylesheet hides the chrome there, so an
// unlocked interface on a phone is inert rather than half-working.

import {
  framesToLock,
  HUD_FRAME_SPECS,
  type HudFrameSpec,
  type UnlockCandidate,
} from './interface_unlock_core';
import type { MovableFrame } from './movable_frame';

/** Where a re-homed frame came from, so locking can put it back exactly. */
interface FrameHome {
  parent: Node;
  next: Node | null;
}

export interface UnlockEntry {
  id: string;
  mover: MovableFrame;
  /** Live for this character right now (a pet is out, the bar is enabled). */
  isActive(): boolean;
  /** Optional show/hide-row override: when present the row is listed while
   *  `listed()` says so (whatever isActive answers) and its checkbox reads and
   *  writes THIS state instead of the mover's hidden flag. The optional action
   *  bars use it: their row toggles the bar's ENABLED setting, the same state
   *  the on-bar plus/minus drives, so the menu can always offer bars 2 and 3
   *  while the bars are split. */
  rowOverride?: {
    listed(): boolean;
    value(): boolean;
    set(checked: boolean): void;
  };
}

export interface InterfaceUnlockDeps {
  document: Document;
  /** Localized label for the floating lock button (t is resolved by the host so
   *  this module stays free of the i18n import, like the rest of the seam). */
  lockAllLabel?: () => string;
  /** Hover tooltip for that button: the reminder that the freeze is the mode
   *  working as intended, not the game hanging. */
  lockAllTitle?: () => string;
  /** Localized label for the frames settings menu button beside it. */
  framesMenuLabel?: () => string;
  /** Hover tooltip / accessible name for that menu: what ticking a row does. */
  framesMenuTitle?: () => string;
  /** Localized label for the show/hide sub-menu inside the dropdown. */
  framesSubmenuLabel?: () => string;
  /** The frame-behavior settings the dropdown renders below the show/hide
   *  sub-menu (combine bars, hide unused slots, ...). Resolved per rebuild so
   *  each row's value reflects the live setting; `set` both persists and
   *  applies (the host wires settings.set + onSettingChange together). */
  settingToggles?: () => FramesMenuToggle[];
  /** Discrete numeric settings the dropdown renders after the toggles as
   *  compact label + select rows (the party columns count). Same resolve-per-
   *  rebuild and persist-and-apply contract as settingToggles. */
  settingSelects?: () => FramesMenuSelect[];
  /** Label for the per-frame size-reset button on every show/hide row. */
  resetSizeLabel?: () => string;
  /** Accessible name for that button, carrying WHICH frame it resets. Falls
   *  back to the short resetSizeLabel text when absent. */
  resetSizeLabelFor?: (name: string) => string;
  /** Fired after a row's size reset (mover.resetSize already ran), so the
   *  host can reset that frame's settings-backed sizes (the dimension drags,
   *  the scale factors) through the same persist-and-apply pair. */
  onSizeReset?: (id: string) => void;
  /** Fired after every flip with the new state (and from relocalize with the
   *  current one). The host hangs the edit-mode preview samples off it. */
  onUnlockedChanged?: (unlocked: boolean) => void;
  /** Whether the Snap to Grid setting is on: while it is (and the interface
   *  is unlocked), the coordinator shows the alignment grid overlay the
   *  snapped drags land on. Absent means no grid ever shows. */
  snapGridActive?: () => boolean;
}

/** One frame-behavior toggle row in the frames settings dropdown. */
export interface FramesMenuToggle {
  id: string;
  label: string;
  value: boolean;
  set(value: boolean): void;
}

/** One discrete numeric row in that dropdown: a label plus a native select
 *  over its legal values (a slider is options-window furniture; a handful of
 *  whole numbers reads better as a picker in a compact menu). */
export interface FramesMenuSelect {
  id: string;
  label: string;
  value: number;
  options: { value: number; label: string }[];
  set(value: number): void;
}

/** Body class the stylesheet gates the unlocked affordances on (the frame
 *  outline, the corner button, the resize grip, the cast-bar preview). */
export const INTERFACE_UNLOCKED_BODY_CLASS = 'interface-unlocked';

export class InterfaceUnlock {
  private unlocked = false;
  private controls: {
    bar: HTMLElement;
    lockBtn: HTMLButtonElement;
    framesBtn: HTMLButtonElement;
    menu: HTMLElement;
  } | null = null;
  /** The 16px alignment grid shown while arranging with Snap to Grid on
   *  (FRAME_SNAP_GRID; the stylesheet draws the lines). Minted with the edit
   *  controls, refreshed on every unlock flip and snap-toggle change. */
  private gridOverlay: HTMLElement | null = null;
  private menuOpen = false;
  private submenuOpen = false;
  private readonly entries: UnlockEntry[] = [];

  constructor(private readonly deps: InterfaceUnlockDeps) {}

  /** Join a frame to the global toggle. Order is the registration order, which
   *  is the frame-table order for the HUD frames and then the unit frames. */
  register(entry: UnlockEntry): void {
    this.entries.push(entry);
  }

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  /** Flip every registered frame at once. Returns the new state so the caller
   *  can repaint its own label without re-reading. */
  toggle(): boolean {
    this.setUnlocked(!this.unlocked);
    return this.unlocked;
  }

  /**
   * The floating edit controls, built on first unlock and shown only while
   * unlocked: the "Lock Interface" exit (arranging is a mode the player enters
   * from the options menu, and leaving it should not mean finding that menu
   * again, so the mode carries its own exit) plus the frames show/hide menu
   * beside it. Minted here rather than in the entry documents because they
   * belong to this coordinator's state, not the stock HUD.
   */
  private ensureControls(): NonNullable<InterfaceUnlock['controls']> | null {
    if (this.controls) return this.controls;
    const doc = this.deps.document;
    const host = doc.getElementById('ui');
    if (!host) return null;
    const bar = doc.createElement('div');
    bar.id = 'interface-edit-controls';
    const lockBtn = doc.createElement('button');
    lockBtn.type = 'button';
    lockBtn.id = 'interface-lock-all';
    lockBtn.className = 'btn';
    lockBtn.addEventListener('click', () => this.setUnlocked(false));
    bar.appendChild(lockBtn);
    const framesBtn = doc.createElement('button');
    framesBtn.type = 'button';
    framesBtn.id = 'interface-frames-toggle';
    framesBtn.className = 'btn';
    framesBtn.setAttribute('aria-expanded', 'false');
    framesBtn.setAttribute('aria-controls', 'interface-frames-menu');
    framesBtn.addEventListener('click', () => this.setFramesMenuOpen(!this.menuOpen));
    bar.appendChild(framesBtn);
    const menu = doc.createElement('div');
    menu.id = 'interface-frames-menu';
    menu.className = 'panel';
    menu.hidden = true;
    bar.appendChild(menu);
    host.appendChild(bar);
    // The alignment grid sits FIRST in the host at z-index 0, so it paints
    // over the world but under every HUD element being arranged.
    const grid = doc.createElement('div');
    grid.id = 'interface-grid-overlay';
    grid.setAttribute('aria-hidden', 'true');
    grid.hidden = true;
    host.insertBefore(grid, host.firstChild);
    this.gridOverlay = grid;
    this.controls = { bar, lockBtn, framesBtn, menu };
    return this.controls;
  }

  /** Open or close the frames show/hide dropdown; opening (re)builds the rows
   *  so the list always reflects the frames that are live right now. */
  private setFramesMenuOpen(open: boolean): void {
    if (!this.controls) return;
    this.menuOpen = open;
    if (open) this.rebuildFramesMenu();
    this.controls.menu.hidden = !open;
    this.controls.framesBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  /** One checkbox row: the shared shape for both the show/hide list and the
   *  settings toggles below it. */
  private checkRow(
    label: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
  ): HTMLElement {
    const doc = this.deps.document;
    const row = doc.createElement('label');
    row.className = 'frames-menu-row';
    const box = doc.createElement('input');
    box.type = 'checkbox';
    box.checked = checked;
    box.addEventListener('change', () => onChange(box.checked));
    row.appendChild(box);
    const text = doc.createElement('span');
    text.textContent = label;
    row.appendChild(text);
    return row;
  }

  /** One label + select row (the discrete numeric settings). A <label> like
   *  checkRow, so clicking the text focuses the control and the row needs no
   *  separate aria wiring: the label element names the select it wraps. */
  private selectRow(select: FramesMenuSelect): HTMLElement {
    const doc = this.deps.document;
    const row = doc.createElement('label');
    row.className = 'frames-menu-row frames-menu-select';
    const text = doc.createElement('span');
    text.textContent = select.label;
    row.appendChild(text);
    const picker = doc.createElement('select');
    for (const option of select.options) {
      const el = doc.createElement('option');
      el.value = String(option.value);
      el.textContent = option.label;
      if (option.value === select.value) el.selected = true;
      picker.appendChild(el);
    }
    picker.addEventListener('change', () => select.set(Number(picker.value)));
    row.appendChild(picker);
    return row;
  }

  /** The dropdown body: a show/hide SUB-MENU (one ticked row per LIVE frame; a
   *  hidden-by-choice frame stays listed, since the menu is the way back), then
   *  the frame-behavior setting toggles. Rebuilt on open / refresh /
   *  relocalize rather than patched: the list is cold UI and a dozen-odd rows.
   *  The sub-menu's expanded state survives the rebuild via `submenuOpen`, so
   *  flipping a setting does not fold the list a player just opened. */
  private rebuildFramesMenu(): void {
    if (!this.controls) return;
    const doc = this.deps.document;
    const menu = this.controls.menu;
    if (this.deps.framesMenuTitle) menu.setAttribute('aria-label', this.deps.framesMenuTitle());
    while (menu.firstChild) menu.removeChild(menu.firstChild);
    const sub = doc.createElement('details');
    sub.className = 'frames-menu-sub';
    sub.open = this.submenuOpen;
    sub.addEventListener('toggle', () => {
      this.submenuOpen = sub.open;
    });
    const summary = doc.createElement('summary');
    summary.textContent = this.deps.framesSubmenuLabel ? this.deps.framesSubmenuLabel() : '';
    sub.appendChild(summary);
    const rows = doc.createElement('div');
    rows.className = 'frames-menu-rows';
    // Each show/hide row is a WRAP holding the checkbox label plus the
    // per-frame size-reset button (owner request: reset lives per frame, not
    // as one global action). The button sits OUTSIDE the label on purpose: a
    // button inside a <label> would also activate the checkbox it labels.
    const frameRow = (
      name: string,
      checked: boolean,
      onCheck: (on: boolean) => void,
      id: string,
      mover: MovableFrame,
    ) => {
      const wrap = doc.createElement('div');
      wrap.className = 'frames-menu-row-wrap';
      wrap.appendChild(this.checkRow(name, checked, onCheck));
      if (this.deps.resetSizeLabel) {
        const reset = doc.createElement('button');
        reset.type = 'button';
        reset.className = 'frames-menu-reset';
        const label = this.deps.resetSizeLabel();
        reset.textContent = label;
        // The visible text is the shared action word; the accessible name
        // carries WHICH frame it resets.
        const accessibleName = this.deps.resetSizeLabelFor?.(name) ?? label;
        reset.setAttribute('aria-label', accessibleName);
        reset.title = accessibleName;
        reset.addEventListener('click', () => {
          mover.resetSize();
          this.deps.onSizeReset?.(id);
          this.rebuildFramesMenu();
        });
        wrap.appendChild(reset);
      }
      return wrap;
    };
    for (const entry of this.entries) {
      const name = entry.mover.labelText();
      if (!name) continue;
      const override = entry.rowOverride;
      if (override) {
        if (!override.listed()) continue;
        rows.appendChild(
          frameRow(
            name,
            override.value(),
            (checked) => override.set(checked),
            entry.id,
            entry.mover,
          ),
        );
        continue;
      }
      if (!entry.isActive() && !entry.mover.isUserHidden) continue;
      rows.appendChild(
        frameRow(
          name,
          !entry.mover.isUserHidden,
          (checked) => entry.mover.setUserHidden(!checked),
          entry.id,
          entry.mover,
        ),
      );
    }
    sub.appendChild(rows);
    menu.appendChild(sub);
    const toggles = this.deps.settingToggles ? this.deps.settingToggles() : [];
    const selects = this.deps.settingSelects ? this.deps.settingSelects() : [];
    if (toggles.length > 0 || selects.length > 0) {
      const settings = doc.createElement('div');
      settings.className = 'frames-menu-settings';
      for (const toggle of toggles) {
        settings.appendChild(
          this.checkRow(toggle.label, toggle.value, (v) => {
            toggle.set(v);
            // Snap to Grid (or any future toggle that feeds it) can change
            // whether the alignment grid should show.
            this.refreshGridOverlay();
          }),
        );
      }
      for (const select of selects) settings.appendChild(this.selectRow(select));
      menu.appendChild(settings);
    }
  }

  setUnlocked(unlocked: boolean): void {
    this.unlocked = unlocked;
    const controls = unlocked ? this.ensureControls() : this.controls;
    if (controls) {
      if (this.deps.lockAllLabel) controls.lockBtn.textContent = this.deps.lockAllLabel();
      if (this.deps.lockAllTitle) controls.lockBtn.title = this.deps.lockAllTitle();
      if (this.deps.framesMenuLabel) controls.framesBtn.textContent = this.deps.framesMenuLabel();
      if (this.deps.framesMenuTitle) controls.framesBtn.title = this.deps.framesMenuTitle();
      controls.bar.hidden = !unlocked;
      // Leaving edit mode folds the dropdown too, so re-entering starts clean.
      if (!unlocked && this.menuOpen) this.setFramesMenuOpen(false);
      // A refresh while the menu is open re-lists against the new active set
      // (a bar enabled mid-unlock appears, a folded one drops out).
      if (unlocked && this.menuOpen) this.rebuildFramesMenu();
    }
    const candidates: UnlockCandidate[] = this.entries.map((e) => ({
      id: e.id,
      isActive: e.isActive,
    }));
    const decisions = new Map(framesToLock(candidates, unlocked).map((d) => [d.id, d.unlocked]));
    for (const entry of this.entries) {
      entry.mover.setLockState(decisions.get(entry.id) ?? false);
    }
    this.deps.document.body.classList.toggle(INTERFACE_UNLOCKED_BODY_CLASS, unlocked);
    this.refreshGridOverlay();
    this.deps.onUnlockedChanged?.(unlocked);
  }

  /** Show the alignment grid exactly while arranging with Snap to Grid on. */
  private refreshGridOverlay(): void {
    if (!this.gridOverlay) return;
    this.gridOverlay.hidden = !(this.unlocked && (this.deps.snapGridActive?.() ?? false));
  }

  /** Re-run the unlock decision for every frame against the CURRENT eligibility,
   *  without flipping the global flag. A frame that just became live (an action
   *  bar enabled mid-unlock, the combined group after the option flipped) gains
   *  its chrome immediately, and one that went inactive loses it. */
  refresh(): void {
    if (this.unlocked) this.setUnlocked(true);
  }

  /** Put one registered frame's bottom edge back where it was (the combined
   *  action bar group, so plus/minus stacks rows upward from the bottom bar). */
  reanchorBottom(id: string): void {
    for (const entry of this.entries) {
      if (entry.id === id) entry.mover.reanchorBottom();
    }
  }

  /** Drop one registered frame's applied geometry while keeping its saved spot,
   *  so a shape that goes inactive re-docks and returns unchanged later. */
  clearAppliedGeometry(id: string): void {
    for (const entry of this.entries) {
      if (entry.id === id) entry.mover.clearAppliedGeometry();
    }
  }

  /** Re-adopt one registered frame's saved spot from storage and apply it: the
   *  way back after clearAppliedGeometry, when the shape becomes active again. */
  restoreSavedPosition(id: string): void {
    for (const entry of this.entries) {
      if (entry.id === id) entry.mover.restoreSavedPosition();
    }
  }

  /** Drop every registered frame's SIZE adjustments while keeping positions:
   *  the Reset Frame Sizes menu action. The host resets the settings-backed
   *  dimension and scale keys alongside (dimensions-mode frames store their
   *  sizes there). */
  resetAllSizes(): void {
    for (const entry of this.entries) entry.mover.resetSize();
  }

  /** Lock everything and forget every saved box. Wired to the existing
   *  "Reset Frame Positions" option so one button still undoes every drag. */
  resetAll(): void {
    this.setUnlocked(false);
    for (const entry of this.entries) entry.mover.reset();
  }

  /** Repaint every saved visual-space box after a live UI Scale change. */
  reapplyAll(): void {
    for (const entry of this.entries) entry.mover.reapplyPosition();
  }

  /** Re-resolve every frame's t() labels in place (language switch). This is the
   *  ONE fan-out arm for every MovableFrame in the HUD: the three unit frames
   *  register here too, so their corner-button labels ride the same call. */
  relocalize(): void {
    for (const entry of this.entries) entry.mover.relocalize();
    const controls = this.controls;
    if (!controls) return;
    if (this.deps.lockAllLabel) controls.lockBtn.textContent = this.deps.lockAllLabel();
    if (this.deps.lockAllTitle) controls.lockBtn.title = this.deps.lockAllTitle();
    if (this.deps.framesMenuLabel) controls.framesBtn.textContent = this.deps.framesMenuLabel();
    if (this.deps.framesMenuTitle) controls.framesBtn.title = this.deps.framesMenuTitle();
    // The dropdown rows are plain resolved text, so an open menu rebuilds once.
    if (this.menuOpen) this.rebuildFramesMenu();
    // The preview samples carry t() text too; the hook rebuilds them in place.
    this.deps.onUnlockedChanged?.(this.unlocked);
  }
}

/** The class a frame wears while a custom position applies (hud.css re-asserts
 *  `position: absolute` on it, so a row lifted out of a flex column keeps its
 *  saved left/top). */
const HUD_FRAME_DETACHED_CLASS = 'hud-frame-detached';

/**
 * The slot a frame returns to when its custom position stops applying: the
 * spec's declared stock home, resolved NOW against the live tree, else the
 * slot captured at detach time. A declared home wins because a captured
 * `nextSibling` can have left the parent since (the other aura row, detached
 * too), and a parent captured while the frame sat somewhere transient is not
 * a stock slot at all.
 */
function resolveStockHome(
  doc: Document,
  spec: HudFrameSpec,
  captured: FrameHome | null,
): FrameHome | null {
  const stock = spec.stockHome;
  if (!stock) return captured;
  const parent = doc.getElementById(stock.parentId);
  if (!parent) return null;
  return { parent, next: stock.slot === 'first' ? parent.firstChild : null };
}

/**
 * Re-home a frame onto #ui while a custom position applies, and back to its
 * stock slot when it stops. A frame inside #bottom-bar (the action bars, the pet
 * frame) sits under a centering transform, and a transformed ancestor becomes
 * the containing block for absolute positioning, so its saved left/top would
 * resolve in the wrong coordinates. This is the same move Hud already makes for
 * the player frame, generalized so every table row can share it: the element
 * refs the painters hold are live nodes, so they survive the reparent.
 *
 * The release half only puts back what the detacher took: a frame that is not
 * on #ui at that moment belongs to another owner (the buff row docked on the
 * player frame by the auras-on-frame option), who restores it on its own
 * transition through restoreFrameHome below.
 */
export function makeUiRootDetacher(
  doc: Document,
  spec: HudFrameSpec,
  frame: HTMLElement,
): (active: boolean) => void {
  let captured: FrameHome | null = null;
  return (active: boolean) => {
    frame.classList.toggle(HUD_FRAME_DETACHED_CLASS, active);
    if (!spec.detachToUiRoot) return;
    const uiRoot = doc.getElementById('ui');
    if (!uiRoot) return;
    if (active) {
      if (frame.parentNode === uiRoot) return;
      captured ??= { parent: frame.parentNode as Node, next: frame.nextSibling };
      uiRoot.appendChild(frame);
      return;
    }
    if (frame.parentNode !== uiRoot) return;
    const home = resolveStockHome(doc, spec, captured);
    if (!home || frame.parentNode === home.parent) return;
    home.parent.insertBefore(frame, home.next);
  };
}

/**
 * Put a frame the HOST moved somewhere transient (the buff row on the player
 * frame) back where the detacher would have it: on #ui while it still carries a
 * custom position, else in its declared stock slot. The class is the truth here,
 * not a remembered parent: a remembered parent is whatever the frame sat on when
 * the host first looked, which was #ui whenever a saved position applied at boot.
 * `frameId` names the HUD_FRAME_SPECS row, and the element comes from that row
 * so the two cannot disagree. An unknown id, a row that declares no stock home,
 * or an element missing from the document is a no-op: there is nothing to
 * restore to (tests/interface_unlock_core.test.ts pins the ids hud.ts uses).
 */
export function restoreFrameHome(doc: Document, frameId: string): void {
  const spec = HUD_FRAME_SPECS.find((s) => s.id === frameId);
  const frame = spec && doc.getElementById(spec.elementId);
  if (!spec || !frame) return;
  if (frame.classList.contains(HUD_FRAME_DETACHED_CLASS)) {
    const uiRoot = doc.getElementById('ui');
    if (uiRoot && frame.parentNode !== uiRoot) uiRoot.appendChild(frame);
    return;
  }
  const home = resolveStockHome(doc, spec, null);
  if (!home || frame.parentNode === home.parent) return;
  home.parent.insertBefore(frame, home.next);
}
