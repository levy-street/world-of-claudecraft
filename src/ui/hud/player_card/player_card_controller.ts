import type { EquipSlot } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import { esc } from '../../esc';
import type { FocusTrapHandle } from '../../focus_manager';
import { holderTierDisplayName, holderTierForBalance } from '../../holder_tier';
import { formatNumber, t } from '../../i18n';
import { svgIcon } from '../../ui_icons';
import { verifiedWocBalance, walletDisplayAvailable } from '../../wallet_balance';
import {
  CARD_POSES,
  cardCanvasToBlob,
  cardCanvasToUploadBlob,
  type PlayerCardData,
  renderPlayerCardCanvas,
} from './player_card';
import { buildPlayerCardData } from './player_card_data';
import {
  type CharacterStanding,
  cardHostingAvailable,
  fetchReferralInfo,
  fetchStanding,
  type PublishedCard,
  publishCard,
} from './player_card_share';

export interface PlayerCardPreviewPort {
  captureCloseup(options?: {
    width?: number;
    height?: number;
    angle?: number;
    poseClips?: readonly string[];
    poseFraction?: number;
  }): string;
}

export interface PlayerCardOptionsPort {
  refreshBalance(): void;
  showWallet(): boolean;
  setShowWallet(show: boolean): void;
  showDevBadges(): boolean;
}

export interface PlayerCardControllerDeps {
  document: Document;
  world(): IWorld;
  ensurePreview(): void;
  preview(): PlayerCardPreviewPort | null;
  openFocusTrap(root: () => HTMLElement | null): FocusTrapHandle;
  options: PlayerCardOptionsPort;
  slotName(slot: EquipSlot): string;
  click(): void;
}

interface PlayerCardState {
  canvas: HTMLCanvasElement | null;
  data: PlayerCardData | null;
  published: PublishedCard | null;
}

/** Owns the shareable player-card modal, composition races, and share actions. */
export class PlayerCardController {
  private modal: HTMLElement | null = null;
  private trap: FocusTrapHandle | null = null;
  private recompose: (() => void) | null = null;

  constructor(private readonly deps: PlayerCardControllerDeps) {}

  get isOpen(): boolean {
    return this.modal !== null;
  }

  refresh(): void {
    this.recompose?.();
  }

  async open(): Promise<void> {
    this.deps.ensurePreview();
    const preview = this.deps.preview();
    if (!preview) return;

    this.close(false);
    this.deps.options.refreshBalance();
    this.trap = this.deps.openFocusTrap(() => this.modal);
    const backdrop = this.deps.document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'player-card-modal';
    const poseButtonsHtml = CARD_POSES.map(
      (pose, index) =>
        `<button type="button" class="btn pc-pose${index === 0 ? ' sel' : ''}" data-pose="${index}">${esc(t(pose.labelKey))}</button>`,
    ).join('');
    backdrop.innerHTML =
      `<div class="panel pc-modal" role="dialog" aria-modal="true" aria-labelledby="player-card-modal-title">` +
      `<div class="panel-title"><span id="player-card-modal-title">${esc(t('playerCard.title'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('playerCard.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="pc-preview pc-loading">${esc(t('playerCard.loading'))}</div>` +
      `<div class="pc-poses" role="group" aria-label="${esc(t('playerCard.poseGroup'))}">${poseButtonsHtml}</div>` +
      `<div class="pc-options"><button type="button" class="btn pc-wallet-toggle" data-wallet-card-toggle><span>${esc(t('hudChrome.playerCard.showWalletBadge'))}</span><span class="pc-toggle-state"></span></button></div>` +
      `<div class="pc-actions"></div>` +
      `<div class="pc-link" hidden><span class="pc-link-label">${esc(t('playerCard.referralLinkLabel'))}</span>` +
      `<input class="pc-link-input" type="text" readonly aria-label="${esc(t('playerCard.referralLinkAria'))}"></div>` +
      `<div class="pc-status" aria-live="polite"></div>` +
      `</div>`;
    this.deps.document.body.appendChild(backdrop);
    this.modal = backdrop;
    const close = () => this.close();
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close();
    });
    backdrop.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    });
    backdrop.querySelector('[data-close]')?.addEventListener('click', () => {
      this.deps.click();
      close();
    });
    this.trap?.focusFirst('[data-close]');

    const previewBox = backdrop.querySelector('.pc-preview') as HTMLElement;
    const status = backdrop.querySelector('.pc-status') as HTMLElement;
    const linkRow = backdrop.querySelector('.pc-link') as HTMLElement;
    const setStatus = (message: string): void => {
      status.textContent = message;
    };
    const walletToggle = backdrop.querySelector<HTMLButtonElement>('[data-wallet-card-toggle]');
    const walletToggleState = walletToggle?.querySelector<HTMLElement>('.pc-toggle-state') ?? null;
    const state: PlayerCardState = { canvas: null, data: null, published: null };
    const poseButtons = Array.from(backdrop.querySelectorAll<HTMLButtonElement>('.pc-pose'));
    let requestedPoseIndex = 0;
    let showWalletOnCard = walletDisplayAvailable() && this.deps.options.showWallet();
    let metadataReady = false;
    let referral: Awaited<ReturnType<typeof fetchReferralInfo>> = null;
    let standing: CharacterStanding | null = null;
    const selectPose = (poseIndex: number): void => {
      requestedPoseIndex = poseIndex;
      poseButtons.forEach((button, index) => {
        button.classList.toggle('sel', index === poseIndex);
      });
    };
    const syncWalletToggle = (): void => {
      if (!walletToggle || !walletToggleState) return;
      const enabled = walletDisplayAvailable() && showWalletOnCard;
      walletToggle.classList.toggle('off', !enabled);
      walletToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      walletToggle.setAttribute('aria-label', t('hudChrome.playerCard.showWalletBadge'));
      walletToggleState.textContent = enabled ? t('hud.options.on') : t('hud.options.off');
    };
    syncWalletToggle();

    let composeSequence = 0;
    const compose = async (poseIndex: number): Promise<void> => {
      const sequence = ++composeSequence;
      const pose = CARD_POSES[poseIndex];
      selectPose(poseIndex);
      try {
        const characterImage = preview.captureCloseup({
          poseClips: pose.clips,
          poseFraction: pose.fraction,
        });
        const data = buildPlayerCardData(this.deps.world(), {
          characterImage,
          referral,
          standing,
          balance: walletDisplayAvailable() && showWalletOnCard ? verifiedWocBalance() : null,
          showDevBadges: this.deps.options.showDevBadges(),
          slotName: this.deps.slotName,
        });
        const canvas = await renderPlayerCardCanvas(data);
        if (this.modal !== backdrop || sequence !== composeSequence) return;
        canvas.classList.add('pc-card-canvas');
        previewBox.classList.remove('pc-loading');
        previewBox.innerHTML = '';
        previewBox.appendChild(canvas);
        state.canvas = canvas;
        state.data = data;
        state.published = null;
        linkRow.hidden = true;
        setStatus('');
      } catch {
        if (this.modal !== backdrop || sequence !== composeSequence) return;
        previewBox.classList.remove('pc-loading');
        previewBox.textContent = t('playerCard.renderFailed');
        setStatus(t('playerCard.renderFailedStatus'));
      }
    };

    poseButtons.forEach((button, index) => {
      button.addEventListener('click', () => {
        if (requestedPoseIndex === index) return;
        this.deps.click();
        if (!metadataReady) {
          selectPose(index);
          return;
        }
        void compose(index);
      });
    });
    walletToggle?.addEventListener('click', () => {
      if (!walletDisplayAvailable()) return;
      this.deps.click();
      showWalletOnCard = !showWalletOnCard;
      this.deps.options.setShowWallet(showWalletOnCard);
      syncWalletToggle();
      state.published = null;
      linkRow.hidden = true;
      setStatus('');
      if (metadataReady) void compose(requestedPoseIndex);
    });

    this.recompose = () => {
      if (this.modal === backdrop && metadataReady) void compose(requestedPoseIndex);
    };

    [referral, standing] = await Promise.all([fetchReferralInfo(), fetchStanding()]);
    metadataReady = true;
    if (this.modal !== backdrop) return;

    await compose(requestedPoseIndex);
    if (this.modal !== backdrop) return;
    this.wireActions(backdrop, state, setStatus);
  }

  close(restoreFocus = true): void {
    const backdrop = this.modal;
    if (!backdrop) return;
    backdrop.remove();
    if (this.modal === backdrop) this.modal = null;
    this.recompose = null;
    this.trap?.release(restoreFocus);
    this.trap = null;
  }

  private wireActions(
    backdrop: HTMLElement,
    state: PlayerCardState,
    setStatus: (message: string) => void,
  ): void {
    const actions = backdrop.querySelector('.pc-actions') as HTMLElement;
    const linkRow = backdrop.querySelector('.pc-link') as HTMLElement;
    const linkInput = backdrop.querySelector('.pc-link-input') as HTMLInputElement;
    const fileName = () =>
      `${(state.data?.referralHandle || t('playerCard.fileNameFallback')).replace(/[^a-z0-9-]/g, '')}-woc-card.png`;
    const makeButton = (label: string, className = ''): HTMLButtonElement => {
      const button = this.deps.document.createElement('button');
      button.type = 'button';
      button.className = `btn${className ? ` ${className}` : ''}`;
      button.textContent = label;
      actions.appendChild(button);
      return button;
    };
    const errorMessage = () => t('playerCard.statusGenericError');

    const publishOnce = async (): Promise<PublishedCard> => {
      if (state.published) return state.published;
      if (!state.canvas) throw new Error(t('playerCard.statusStillRendering'));
      setStatus(t('playerCard.statusPublishing'));
      const published = await publishCard(await cardCanvasToUploadBlob(state.canvas), {
        level: state.data?.level ?? this.deps.world().player.level,
      });
      state.published = published;
      linkInput.value = published.url;
      linkRow.hidden = false;
      setStatus(t('playerCard.statusPublished'));
      return published;
    };

    if (cardHostingAvailable()) {
      const shareX = makeButton(t('playerCard.actionShareX'), 'cd-ok');
      shareX.addEventListener('click', async () => {
        this.deps.click();
        shareX.disabled = true;
        try {
          let copied = false;
          if (state.canvas && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
            try {
              await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': cardCanvasToBlob(state.canvas) }),
              ]);
              copied = true;
            } catch {
              copied = false;
            }
          }
          const published = await publishOnce();
          const text = state.data ? this.shareText(state.data) : t('playerCard.nativeShareTitle');
          const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(published.url)}`;
          window.open(intent, '_blank', 'noopener,noreferrer');
          setStatus(
            copied ? t('playerCard.statusOpenedXWithImage') : t('playerCard.statusOpenedXWithLink'),
          );
        } catch {
          setStatus(errorMessage());
        } finally {
          shareX.disabled = false;
        }
      });
      const copyLink = makeButton(t('playerCard.actionCopyReferral'));
      copyLink.addEventListener('click', async () => {
        this.deps.click();
        copyLink.disabled = true;
        try {
          const published = await publishOnce();
          await navigator.clipboard.writeText(published.url);
          linkInput.select();
          setStatus(t('playerCard.statusReferralCopied'));
        } catch {
          setStatus(errorMessage());
        } finally {
          copyLink.disabled = false;
        }
      });
    }

    const download = makeButton(t('playerCard.actionDownload'));
    download.addEventListener('click', async () => {
      this.deps.click();
      if (!state.canvas) return;
      const blob = await cardCanvasToBlob(state.canvas);
      const href = URL.createObjectURL(blob);
      const anchor = this.deps.document.createElement('a');
      anchor.href = href;
      anchor.download = fileName();
      this.deps.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(href), 4000);
      setStatus(t('playerCard.statusDownloaded'));
    });

    const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
    if (typeof nav.canShare === 'function') {
      const shareNative = makeButton(t('playerCard.actionShareNative'));
      shareNative.addEventListener('click', async () => {
        this.deps.click();
        if (!state.canvas) return;
        shareNative.disabled = true;
        try {
          const file = new File([await cardCanvasToBlob(state.canvas)], fileName(), {
            type: 'image/png',
          });
          const payload: ShareData = {
            files: [file],
            title: t('playerCard.nativeShareTitle'),
            text: state.data ? this.shareText(state.data) : t('playerCard.nativeShareTitle'),
          };
          if (cardHostingAvailable()) {
            try {
              payload.url = (await publishOnce()).url;
            } catch {
              // Sharing the generated file remains available without hosting.
            }
          }
          if (nav.canShare?.(payload)) await nav.share?.(payload);
          else if (nav.canShare?.({ files: [file] })) await nav.share?.({ files: [file] });
          else setStatus(t('playerCard.statusShareUnsupported'));
        } catch (error) {
          if (!(error instanceof Error && error.name === 'AbortError')) setStatus(errorMessage());
        } finally {
          shareNative.disabled = false;
        }
      });
    }
  }

  private shareText(data: PlayerCardData): string {
    const tier = holderTierForBalance(data.balance);
    const tierBit = tier ? t('playerCard.shareTierBit', { tier: holderTierDisplayName(tier) }) : '';
    return t('playerCard.shareText', {
      level: formatNumber(data.level, { maximumFractionDigits: 0 }),
      className: data.className,
      tierBit,
    });
  }
}
