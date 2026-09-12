// Mount-skin inspect panel: a body-level overlay the store opens when a Machine
// Stable card is clicked, and the Cosmetics window opens from a mount card.
// Left is a live 3D viewport (src/render/mount_preview): the player's own
// character riding the skin under a day / dusk / night scene, or the mount
// alone on a turntable. Right is the codex side: name, rarity, the skin's
// description, the price, and the Buy / Wear / Take off action. The markup
// and the action decision are the pure src/ui/mount_inspect_view.ts; this file
// is the DOM lifecycle, the twin of src/ui/armory_inspect.ts.
//
// Unlike the Armory panel this one DISPOSES its GL context on close: the
// Armory keeps one warmed context parked for the whole session, and a second
// permanently parked context would move the client closer to the browser's
// live-context cap for a panel most sessions open once. The mount GLB stays
// resident in the character asset cache, so a reopen pays a rig build, not a
// fetch.

import type { PreviewAppearance } from '../render/characters';
import {
  createMountPreview,
  type MountPreviewHandle,
  type MountPreviewMode,
  type MountPreviewSceneKey,
} from '../render/mount_preview';
import { isMountSkinId } from '../sim/content/mount_skins';
import {
  MOUNT_INSPECT_BUY_ATTR,
  MOUNT_INSPECT_CLOSE_ATTR,
  MOUNT_INSPECT_MODE_ATTR,
  MOUNT_INSPECT_SCENE_ATTR,
  MOUNT_INSPECT_TAKEOFF_ATTR,
  MOUNT_INSPECT_WEAR_ATTR,
  type MountInspectRow,
  mountInspectActionsHtml,
  mountInspectControlsHtml,
  mountInspectHtml,
} from './mount_inspect_view';

export interface MountInspectDeps {
  appearance(): PreviewAppearance;
  /** The current row for a skin, or null when the catalog does not carry it. */
  row(skinId: string): MountInspectRow | null;
  requestBuy(skinId: string): void;
  wear(skinId: string): void;
  takeOff(): void;
}

const SCENES: readonly MountPreviewSceneKey[] = ['day', 'dusk', 'night'];

export class MountInspect {
  private overlay: HTMLElement | null = null;
  private preview: MountPreviewHandle | null = null;
  private stage: HTMLElement | null = null;
  private row: MountInspectRow | null = null;
  private mode: MountPreviewMode = 'rider';
  private sceneKey: MountPreviewSceneKey = 'day';
  private openerFocus: HTMLElement | null = null;

  constructor(private readonly deps: MountInspectDeps) {}

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  get openSkinId(): string | null {
    return this.row?.skinId ?? null;
  }

  /** Open (or re-target) the panel on a skin. An unknown id is a no-op. A
   *  re-target keeps the stage and its GL context and only swaps the codex
   *  side and the staged mount (setMount), so browsing skins never mints a
   *  context per card. */
  open(skinId: string): void {
    const row = this.deps.row(skinId);
    if (!row) return;
    const wasOpen = this.overlay !== null;
    if (wasOpen) this.detachOverlay();
    this.row = row;
    if (!wasOpen) {
      this.openerFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    const overlay = document.createElement('div');
    overlay.className = 'armory-inspect-overlay mount-inspect-overlay open';
    overlay.addEventListener('keydown', (event) => {
      // A confirm prompt stacked above this overlay owns the keyboard: its own
      // focus trap handles Tab, and Escape must not close the panel out from
      // under a live purchase prompt.
      if (document.getElementById('confirm-dialog')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = overlay.querySelectorAll<HTMLElement>('button:not([disabled])');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !overlay.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !overlay.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    });
    overlay.addEventListener('mousedown', (event) => {
      if (document.getElementById('confirm-dialog')) return;
      if (event.target === overlay) {
        this.close();
        return;
      }
      // A press on the canvas or the codex copy would drop focus to <body>,
      // taking Escape with it; keep the keyboard inside the dialog.
      const target = event.target as HTMLElement | null;
      if (target && !target.closest('button')) {
        event.preventDefault();
        (overlay.querySelector(`[${MOUNT_INSPECT_CLOSE_ATTR}]`) as HTMLElement | null)?.focus();
      }
    });
    overlay.innerHTML = mountInspectHtml(row);
    document.body.appendChild(overlay);
    this.overlay = overlay;
    overlay
      .querySelector(`[${MOUNT_INSPECT_CLOSE_ATTR}]`)
      ?.addEventListener('click', () => this.close());
    const stage = this.ensureStage();
    if (stage) {
      this.preview?.setAppearance(this.deps.appearance());
      this.preview?.setScene(this.sceneKey);
      this.preview?.setMode(this.mode);
      this.preview?.setMount(isMountSkinId(row.skinId) ? row.skinId : null);
      this.preview?.setActive(true);
    }
    this.paintActions();
    this.syncToggles();
    (overlay.querySelector(`[${MOUNT_INSPECT_CLOSE_ATTR}]`) as HTMLElement | null)?.focus();
  }

  /** Re-project the action row after ownership, the worn skin, or the store
   *  snapshot changed. A closed panel, or one on another skin, is untouched. */
  refresh(): void {
    if (!this.overlay || !this.row) return;
    const row = this.deps.row(this.row.skinId);
    if (!row) return;
    this.row = row;
    this.paintActions();
  }

  /** A language switch repaints the open dialog (every label is a t() key):
   *  the codex side rebuilds, the stage and its context survive, and the
   *  toggles are repainted from the current mode and scene. */
  relocalize(): void {
    const open = this.row?.skinId;
    if (!open || !this.overlay) return;
    const controls = this.stage?.querySelector<HTMLElement>('[data-mount-controls]');
    if (controls) {
      controls.innerHTML = mountInspectControlsHtml(SCENES);
      this.wireControls(this.stage as HTMLElement);
    }
    this.open(open);
  }

  close(): void {
    this.hideOverlay(true);
  }

  /** Explicit teardown (a graphics-profile rebuild, page lifecycle). */
  destroy(): void {
    this.hideOverlay(false);
    this.openerFocus = null;
  }

  private ensureStage(): HTMLElement | null {
    const slot = this.overlay?.querySelector<HTMLElement>('[data-mount-stage-slot]');
    if (!slot) return null;
    if (this.stage) {
      slot.replaceWith(this.stage);
      return this.stage;
    }
    const stage = document.createElement('div');
    stage.className = 'armory-inspect-stage';
    stage.innerHTML =
      `<canvas data-mount-canvas></canvas>` +
      `<div class="armory-inspect-controls" data-mount-controls>${mountInspectControlsHtml(SCENES)}</div>`;
    const canvas = stage.querySelector<HTMLCanvasElement>('[data-mount-canvas]');
    if (!canvas) return null;
    // The stage is inside the dialog before the rig is built, so the renderer
    // sizes itself to the real grid track on construction.
    slot.replaceWith(stage);
    const preview = createMountPreview(stage, canvas, this.deps.appearance());
    if (!preview) {
      // No context: the codex side still opens, with the stage slot empty.
      stage.remove();
      return null;
    }
    this.stage = stage;
    this.preview = preview;
    this.preview.setActive(false);
    this.wireControls(stage);
    return stage;
  }

  private wireControls(stage: HTMLElement): void {
    stage.querySelectorAll<HTMLButtonElement>(`[${MOUNT_INSPECT_MODE_ATTR}]`).forEach((button) => {
      button.addEventListener('click', () => {
        this.mode = button.dataset.mountMode as MountPreviewMode;
        this.preview?.setMode(this.mode);
        this.syncToggles();
      });
    });
    stage.querySelectorAll<HTMLButtonElement>(`[${MOUNT_INSPECT_SCENE_ATTR}]`).forEach((button) => {
      button.addEventListener('click', () => {
        this.sceneKey = button.dataset.mountScene as MountPreviewSceneKey;
        this.preview?.setScene(this.sceneKey);
        this.syncToggles();
      });
    });
  }

  /** Drop the dialog markup but keep the stage parked for a re-target. */
  private detachOverlay(): void {
    this.stage?.remove();
    this.overlay?.remove();
    this.overlay = null;
    this.row = null;
  }

  private hideOverlay(restoreFocus: boolean): void {
    const wasOpen = this.overlay !== null;
    this.preview?.setActive(false);
    this.preview?.dispose();
    this.preview = null;
    this.detachOverlay();
    this.stage = null;
    if (restoreFocus && wasOpen && this.openerFocus?.isConnected) this.openerFocus.focus();
    if (restoreFocus) this.openerFocus = null;
  }

  private syncToggles(): void {
    const stage = this.stage;
    if (!stage) return;
    stage.querySelectorAll<HTMLButtonElement>(`[${MOUNT_INSPECT_MODE_ATTR}]`).forEach((button) => {
      const active = button.dataset.mountMode === this.mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    stage.querySelectorAll<HTMLButtonElement>(`[${MOUNT_INSPECT_SCENE_ATTR}]`).forEach((button) => {
      const active = button.dataset.mountScene === this.sceneKey;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  private paintActions(): void {
    const host = this.overlay?.querySelector<HTMLElement>('[data-mount-actions]');
    const row = this.row;
    if (!host || !row) return;
    host.innerHTML = mountInspectActionsHtml(row);
    host
      .querySelector<HTMLButtonElement>(`[${MOUNT_INSPECT_BUY_ATTR}]`)
      ?.addEventListener('click', () => {
        if (this.row) this.deps.requestBuy(this.row.skinId);
      });
    host
      .querySelector<HTMLButtonElement>(`[${MOUNT_INSPECT_WEAR_ATTR}]`)
      ?.addEventListener('click', () => {
        if (this.row) this.deps.wear(this.row.skinId);
        this.refresh();
      });
    host
      .querySelector<HTMLButtonElement>(`[${MOUNT_INSPECT_TAKEOFF_ATTR}]`)
      ?.addEventListener('click', () => {
        this.deps.takeOff();
        this.refresh();
      });
  }
}
