// On-bar action-bar key-binding mode (issue #1238): the controller behind the
// Key Bindings menu's single "Edit action bar keys" entry. While active, a slot
// click on the live bar selects that slot instead of casting, and the next
// physical keypress binds it through the same Input.captureNextKey seam every
// other rebind flow uses, so it never fires the ability. When the pressed key
// is ALREADY IN USE by another action it raises an are-you-sure prompt first
// (accepting unbinds that action); cancelling leaves every binding untouched.
// Exited via the banner's Done button.
//
// The state machine is the pure action_bar_bind_core.ts, the banner DOM is
// action_bar_bind_banner.ts; this class wires both to the HUD through deps and
// holds only the mode state and the banner root (it reaches no browser global
// itself, so it sits in the architecture sweep's default bucket).

import { audio } from '../../../game/audio';
import { type Keybinds, keyLabel } from '../../../game/keybinds';
import { t } from '../../i18n';
import { mountActionBarBindBanner, setActionBarBindBannerStatus } from './action_bar_bind_banner';
import {
  type ActionBarBindState,
  actionBarBindEnter,
  actionBarBindPrompt,
  actionBarBindResolveCapture,
  actionBarBindSelectSlot,
} from './action_bar_bind_core';

export interface ActionBarBindControllerDeps {
  keybinds: () => Keybinds;
  /** OptionsHooks.captureKey: arm a one-shot key capture, or null to clear it. */
  captureKey: (cb: ((code: string | null) => void) | null) => void;
  /** The HUD's shared are-you-sure dialog. */
  confirmDialog: (
    title: string,
    body: string,
    okText: string,
    cancelText: string,
    onOk: () => void,
  ) => void;
  /** Repaint every keycap after the key map changed (hud.refreshKeybindLabels). */
  refreshKeybindLabels: () => void;
  /** The localized name of a bind action (keybind_action_names.ts). */
  actionName: (actionId: string) => string;
  /** Close the options window: the mode plays out on the live bar, not in a menu. */
  closeOptions: () => void;
  /** Where the banner mounts (#actionbar-stack). */
  bannerParent: () => HTMLElement | null;
  /** Mark the selected slot (or none) and whether the mode is active at all. */
  syncSlotClasses: (selected: number | null, active: boolean) => void;
}

export class ActionBarBindController {
  private state: ActionBarBindState | null = null;
  private bannerEl: HTMLElement | null = null;

  constructor(private readonly deps: ActionBarBindControllerDeps) {}

  /** Whether the mode is active (a slot click then selects instead of casting). */
  get active(): boolean {
    return this.state !== null;
  }

  /** Enter the mode: close the options window, build the banner. A no-op while
   *  already active. */
  begin(): void {
    if (this.state) return;
    this.deps.closeOptions();
    this.state = actionBarBindEnter();
    this.bannerEl?.remove();
    this.bannerEl = mountActionBarBindBanner(this.deps.bannerParent(), {
      onReset: () => this.confirmReset(),
      onDone: () => this.end(),
    });
    this.sync();
  }

  end(): void {
    if (!this.state) return;
    this.cancelPendingCapture();
    this.state = null;
    this.bannerEl?.remove();
    this.bannerEl = null;
    this.sync();
  }

  // A slot is selected (a capture is armed via Input.captureNextKey) and the
  // player clicks Done or Reset with the MOUSE instead of pressing a key: the
  // armed callback is left dangling (captureNextKey is one-shot, cleared only
  // by an actual keydown). Clear it so the player's very next real keypress
  // after leaving/resetting the mode is not silently swallowed by that stale
  // callback instead of driving normal gameplay.
  private cancelPendingCapture(): void {
    if (this.state?.selectedSlot == null) return;
    this.deps.captureKey(null);
  }

  /** A slot was clicked while the mode is active: select it, then arm capture
   *  so the very next physical keypress (including a modifier chord) binds it. */
  selectSlot(slot: number): void {
    if (!this.state) return;
    audio.click();
    this.state = actionBarBindSelectSlot(slot);
    this.sync();
    this.deps.captureKey((code) => {
      // A stale capture: the mode exited, or a later slot click already
      // re-armed capture for a different slot. Drop it.
      if (!this.state || this.state.selectedSlot !== slot) return;
      if (code === null) {
        this.resolve(null);
        return;
      }
      // Warn when the pressed key is already in use: binding it here steals it
      // from that other action. Cancelling leaves every binding untouched.
      const id = `slot${slot}`;
      const conflict = this.deps.keybinds().findBindConflict(id, 0, code);
      const prompt = actionBarBindPrompt({
        key: keyLabel(code),
        other: conflict ? this.deps.actionName(conflict.id) : null,
        slot: this.deps.actionName(id),
      });
      if (!prompt) {
        this.commit(slot, code);
        return;
      }
      // The capture has fired, so nothing is armed while the dialog is up; the
      // banner drops to idle until the player chooses.
      this.resolve(null);
      this.deps.confirmDialog(
        t(prompt.titleKey),
        t(prompt.bodyKey, prompt.params),
        t(prompt.acceptKey),
        t(prompt.cancelKey),
        () => this.commit(slot, code),
      );
    });
  }

  private commit(slot: number, code: string): void {
    // The conflict prompt is not modal to the banner: Done can end the mode
    // while it is up, and committing then would resurrect the mode with no
    // banner to leave it by.
    if (!this.state) return;
    const keybinds = this.deps.keybinds();
    let boundLabel: string | null = null;
    if (keybinds.bind(`slot${slot}`, 0, code)) {
      // Read back what actually got stored (matches the keycap the
      // ActionBarPainter shows), not the raw captured chord.
      boundLabel = keyLabel(keybinds.codeAt(`slot${slot}`, 0));
      this.deps.refreshKeybindLabels();
    }
    this.resolve(boundLabel);
  }

  private resolve(boundLabel: string | null): void {
    this.state = actionBarBindResolveCapture(boundLabel);
    this.sync();
  }

  private confirmReset(): void {
    // Capture is handled before the dialog's own key handling in Input.onKeyDown,
    // so an armed slot capture left in place while the confirm is up would bind
    // the slot to whatever key the player presses (Escape only cancels the
    // capture, it does not dismiss the dialog). Cancel it up front, not only in
    // the OK callback below.
    this.cancelPendingCapture();
    this.deps.confirmDialog(
      t('hudChrome.actionBar.resetConfirmTitle'),
      t('hudChrome.actionBar.resetConfirmBody'),
      t('hudChrome.actionBar.reset'),
      t('hudChrome.actionBar.cancel'),
      () => {
        if (!this.state) return; // Done was clicked under the dialog
        this.deps.keybinds().resetSlots();
        this.deps.refreshKeybindLabels();
        this.state = actionBarBindEnter();
        this.sync();
      },
    );
  }

  private sync(): void {
    this.deps.syncSlotClasses(this.state?.selectedSlot ?? null, this.state !== null);
    if (this.bannerEl && this.state) setActionBarBindBannerStatus(this.bannerEl, this.state);
  }
}
