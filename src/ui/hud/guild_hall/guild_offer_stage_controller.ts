// The live 3D stage of Lantern Hall's quartermaster detail (guild_hall_window.ts): the war
// horse with you in the saddle, or a weapon appearance tried on in your own hand. A thin DOM
// lifecycle over two preview hosts that already exist; it builds no renderer of its own.
//
// - A weapon appearance mounts Hud's ONE shared character turntable (CharacterPreview, the
//   character sheet's and the inspect stage's canvas) through the injected
//   `tryOnWeaponSkin`. That context is session-long and already a client of the preparation
//   scheduler (its open gate and touch queue, Hud.mountSharedPreview); leaving it here is
//   detaching its host, which parks its loop until the next stage mounts it.
// - The war horse mounts the mount-skin inspect rig (render/mount_preview.ts, the Machine
//   Stable's), which links and uploads before its first draw. Like MountInspect it is built
//   when the horse is staged and DISPOSED the moment it is not (another card, another tab,
//   the window closed), so the counter never parks a second session-long context.
//
// The two never draw together: staging one tears the other down first (the shared turntable's
// session-long context stays alive, parked, beside the horse's while the horse is staged, as it
// does beside the Machine Stable's).
import { createMountPreview, type MountPreviewHandle } from '../../../render/mount_preview';
import type { MountKey } from '../../../sim/content/mounts';
import type { IWorld } from '../../../world_api';
import { esc } from '../../esc';
import { t } from '../../i18n';
import { storePreviewAppearance } from '../../store_inspect_deps';
import type { GuildShopStage } from './guild_quartermaster_view';

/** The 3D subjects (a title's nameplate is text, painted by the window itself). */
export type GuildModelStage = Exclude<GuildShopStage, { kind: 'plate' }>;

export interface GuildOfferStageDeps {
  world(): IWorld;
  /** Mount Hud's shared character turntable into `stage`, the player's own body holding the
   *  appearance (absent in a bare test mount: the stage then shows its fallback line). */
  tryOnWeaponSkin?(stage: HTMLElement, skinId: string): void;
}

/** The stage's subject key: a change of it re-stages, the same one only re-attaches. */
function subjectOf(stage: GuildModelStage): string {
  return stage.kind === 'mount' ? `mount:${stage.mountKey}` : `weapon:${stage.skinId}`;
}

export class GuildOfferStage {
  /** The element that persists across the window's rebuilds (the canvas lives inside it). */
  private host: HTMLElement | null = null;
  private subject: string | null = null;
  private mountPreview: MountPreviewHandle | null = null;

  constructor(private readonly deps: GuildOfferStageDeps) {}

  /** Put the stage where the rebuilt detail left its slot, staging `stage` on it. */
  show(slot: HTMLElement, stage: GuildModelStage, label: string): void {
    const subject = subjectOf(stage);
    const kind = stage.kind;
    if (this.host && this.host.dataset.ghStageKind !== kind) this.hide();
    const fresh = !this.host;
    const host = this.host ?? this.createHost(kind);
    if (host.getAttribute('role') === 'img') host.setAttribute('aria-label', label);
    // in the dialog before any rig is built, so a renderer sizes itself to the real track
    slot.replaceWith(host);
    this.host = host;
    // the shared turntable's canvas can have moved to another stage (the character sheet) in
    // the meantime: the same subject re-mounts it then, rather than leaving an empty frame
    const held = stage.kind === 'mount' || host.querySelector('canvas') !== null;
    if (!fresh && subject === this.subject && held) return;
    this.subject = subject;
    if (stage.kind === 'mount') this.stageMount(host, stage.mountKey);
    else this.stageWeapon(host, stage.skinId);
  }

  /** Leave the stage: dispose the horse's context, detach the shared turntable's host. */
  hide(): void {
    this.mountPreview?.setActive(false);
    this.mountPreview?.dispose();
    this.mountPreview = null;
    this.host?.remove();
    this.host = null;
    this.subject = null;
  }

  private createHost(kind: GuildModelStage['kind']): HTMLElement {
    const host = document.createElement('div');
    host.className = `gh-stage gh-stage-${kind}`;
    host.dataset.ghStageKind = kind;
    host.setAttribute('role', 'img');
    return host;
  }

  private stageMount(host: HTMLElement, mountKey: string): void {
    if (this.mountPreview) {
      this.mountPreview.setMount(mountKey as MountKey);
      return;
    }
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    // null when a rig fails to build; the renderer's own constructor THROWS when the device
    // gives no WebGL context at all (before the rig's guard), so both land on the fallback
    let preview: MountPreviewHandle | null = null;
    try {
      preview = createMountPreview(host, canvas, storePreviewAppearance(this.deps.world()));
    } catch (err) {
      console.warn('guild mount stage unavailable:', err);
    }
    if (!preview) {
      this.unavailable(host);
      return;
    }
    this.mountPreview = preview;
    preview.setMode('rider');
    preview.setScene('dusk');
    preview.setMount(mountKey as MountKey);
    preview.setActive(true);
  }

  private stageWeapon(host: HTMLElement, skinId: string): void {
    if (!this.deps.tryOnWeaponSkin) {
      this.unavailable(host);
      return;
    }
    this.deps.tryOnWeaponSkin(host, skinId);
  }

  private unavailable(host: HTMLElement): void {
    // no picture to name: the sentence inside is what a screen reader should read
    host.removeAttribute('role');
    host.removeAttribute('aria-label');
    host.replaceChildren();
    host.insertAdjacentHTML(
      'beforeend',
      `<p class="gh-stage-empty">${esc(t('hudChrome.guildHall.shop.stageUnavailable'))}</p>`,
    );
  }
}
