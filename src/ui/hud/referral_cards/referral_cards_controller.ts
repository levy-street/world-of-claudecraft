import type { ReferralMilestone } from '../../../sim/referral_cards';
import { markDialogRoot } from '../../dialog_root';
import { captureFocusKey, FOCUS_KEY_ATTR, restoreFirstEnabled } from '../../focus_restore';
import { formatNumber } from '../../i18n';
import { installPromptDialog, type PromptDialogHandle } from '../../prompt_dialog';
import { bindTouchTap } from '../../touch_tap';
import {
  referralOwnParticipant,
  referralReadyCount,
  referralStampKey,
  referralStampRows,
} from './referral_cards_view';
import { referralCardsHtml, referralText } from './referral_cards_window';
import type {
  ReferralCardsHost,
  ReferralCardsSnapshot,
  ReferralLinkActionPayload,
  ReferralLinkSnapshot,
  ReferralUiReason,
} from './types';

export class ReferralCardsController {
  private openState = false;
  private lastRevision: number | null | undefined;
  private animated = new Set<string>();
  private animations: Animation[] = [];
  private seenPrompts = new Set<string>();
  private fogbinderProgress = new Map<string, boolean>();
  private fogbinderWarnings = new Set<string>();
  private prompt: PromptDialogHandle | null = null;
  private promptLink: { linkId: number; revision: number } | null = null;
  private promptReopen: (() => void) | null = null;
  private destroyed = false;
  private activeLauncher: HTMLButtonElement;
  private cooldownRevision: number | null | undefined;
  private cooldownReceivedAt = 0;
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly host: ReferralCardsHost) {
    this.activeLauncher = host.launcher;
    host.root.id = 'referral-cards-window';
    host.root.classList.add('window', 'ui-window');
    host.root.hidden = true;
    host.root.addEventListener('click', this.onClick);
    host.launcher.addEventListener('click', this.onLauncher);
    for (const launcher of host.extraLaunchers ?? []) bindTouchTap(launcher, this.onLauncher);
  }

  isOpen(): boolean {
    return this.openState;
  }

  open(): void {
    if (this.destroyed) return;
    if (!this.openState) this.host.beforeOpen?.();
    this.openState = true;
    this.trackCooldown(this.host.getSnapshot());
    this.host.root.hidden = false;
    this.host.root.style.display = 'flex';
    this.lastRevision = this.host.getSnapshot()?.revision ?? null;
    this.paintLauncher(this.host.getSnapshot());
    this.paint();
    this.host.focusWindow('#referral-cards-window');
    this.processPrompts(this.host.getSnapshot());
    this.scheduleCooldown();
  }

  close(): void {
    const wasOpen = this.openState;
    this.dismissPrompt();
    this.stopAnimations();
    if (this.cooldownTimer !== null) clearTimeout(this.cooldownTimer);
    this.cooldownTimer = null;
    this.openState = false;
    this.host.root.hidden = true;
    this.host.root.style.display = 'none';
    this.host.root.inert = false;
    this.host.launcher.setAttribute('aria-expanded', 'false');
    for (const launcher of this.host.extraLaunchers ?? [])
      launcher.setAttribute('aria-expanded', 'false');
    if (wasOpen) this.host.onClose();
  }

  /** Driven by the parent's cadence; identical revisions do no DOM work or queries. */
  update(): void {
    if (this.destroyed) return;
    const snapshot = this.host.getSnapshot();
    const revision = snapshot?.revision ?? null;
    if (this.lastRevision === revision) return;
    this.lastRevision = revision;
    this.trackCooldown(snapshot);
    this.retainSnapshotState(snapshot);
    this.host.onSnapshotChange?.();
    this.paintLauncher(snapshot);
    if (this.promptLink) {
      const link = snapshot?.links.find((row) => row.card.linkId === this.promptLink!.linkId);
      if (!link || link.card.revision !== this.promptLink.revision) this.dismissPrompt();
    }
    if (this.openState) this.paint();
    this.processPrompts(snapshot);
    if (this.openState) this.scheduleCooldown();
  }

  relocalize(): void {
    if (this.destroyed) return;
    const snapshot = this.host.getSnapshot();
    this.lastRevision = snapshot?.revision ?? null;
    this.paintLauncher(snapshot);
    if (this.openState) this.paint();
    const reopen = this.promptReopen;
    if (reopen) {
      this.dismissPrompt();
      reopen();
    }
  }

  destroy(): void {
    this.close();
    this.destroyed = true;
    this.host.root.removeEventListener('click', this.onClick);
    this.host.launcher.removeEventListener('click', this.onLauncher);
    for (const launcher of this.host.extraLaunchers ?? [])
      launcher.removeEventListener('click', this.onLauncher);
    this.animated.clear();
    this.seenPrompts.clear();
    this.fogbinderProgress.clear();
    this.fogbinderWarnings.clear();
  }

  private readonly onLauncher = (event: Event): void => {
    if (this.destroyed) return;
    this.activeLauncher = event.currentTarget as HTMLButtonElement;
    if (this.openState) this.close();
    else this.open();
  };

  /** Retain only the bounded current page and notice batch, never a session-long history. */
  private retainSnapshotState(snapshot: ReferralCardsSnapshot | null): void {
    const stamps = new Set<string>();
    const fogbinderProgress = new Map<string, boolean>();
    const prompts = new Set(snapshot?.notices.map((notice) => `notice:${notice.id}`));
    for (const link of snapshot?.links ?? []) {
      prompts.add(`lock:${link.card.linkId}:${link.card.revision}`);
      prompts.add(`decline:${link.card.linkId}:${link.card.revision}`);
      const own = referralOwnParticipant(link, snapshot!.accountId);
      if (own?.characterId != null) {
        if (own.characterId === snapshot?.characterId) {
          const key = referralStampKey(link.card.linkId, own.characterId, 'fogbinder');
          const earned = (own.credited & 4) !== 0;
          fogbinderProgress.set(key, earned);
          if (earned && !(own.redeemed & 4) && this.fogbinderProgress.get(key) === false)
            this.fogbinderWarnings.add(key);
          if (own.redeemed & 4) this.fogbinderWarnings.delete(key);
        }
        for (const stamp of referralStampRows(own)) {
          stamps.add(referralStampKey(link.card.linkId, own.characterId, stamp.id));
        }
      }
    }
    for (const key of this.animated) if (!stamps.has(key)) this.animated.delete(key);
    for (const key of this.seenPrompts) if (!prompts.has(key)) this.seenPrompts.delete(key);
    for (const key of this.fogbinderWarnings)
      if (!fogbinderProgress.has(key)) this.fogbinderWarnings.delete(key);
    this.fogbinderProgress = fogbinderProgress;
  }

  private paintLauncher(snapshot: ReferralCardsSnapshot | null): void {
    const count = referralReadyCount(snapshot);
    const label =
      count > 0
        ? referralText('readyCount', { count: formatNumber(count) })
        : referralText('launcher');
    for (const launcher of [this.host.launcher, ...(this.host.extraLaunchers ?? [])]) {
      launcher.hidden = snapshot === null;
      launcher.setAttribute('aria-expanded', String(this.openState));
      launcher.classList.toggle('referral-reward-ready', count > 0);
      launcher.setAttribute('aria-label', label);
      launcher.setAttribute('title', label);
      launcher.dataset.referralReady = count > 0 ? formatNumber(count) : '';
      const caption = launcher.querySelector('.mobile-label');
      if (caption) caption.textContent = referralText('launcher');
    }
  }

  private paint(): void {
    const key = captureFocusKey(this.host.root);
    this.stopAnimations();
    this.host.root.innerHTML = referralCardsHtml(this.cooldownSnapshot(), this.animated);
    markDialogRoot(this.host.root, { labelledBy: 'referral-cards-title' });
    if (key !== null) {
      const controls = Array.from(
        this.host.root.querySelectorAll<HTMLElement>(`[${FOCUS_KEY_ATTR}]`),
      );
      restoreFirstEnabled([
        controls.find((control) => control.getAttribute(FOCUS_KEY_ATTR) === key),
        controls.find((control) => control.getAttribute(FOCUS_KEY_ATTR) === 'close'),
      ]);
    }
    this.animateStamps();
  }

  private trackCooldown(snapshot: ReferralCardsSnapshot | null): void {
    const revision = snapshot?.revision ?? null;
    if (this.cooldownRevision === revision) return;
    this.cooldownRevision = revision;
    this.cooldownReceivedAt = Date.now();
  }

  private cooldownSnapshot(): ReferralCardsSnapshot | null {
    const snapshot = this.host.getSnapshot();
    if (!snapshot) return null;
    const elapsed = (Date.now() - this.cooldownReceivedAt) / 1000;
    return {
      ...snapshot,
      links: snapshot.links.map((link) => ({
        ...link,
        summonRemainingSeconds: Math.max(0, link.summonRemainingSeconds - elapsed),
      })),
    };
  }

  /** One visible-window timer, bounded by the snapshot page; never a per-frame walk. */
  private scheduleCooldown(): void {
    if (this.cooldownTimer !== null) clearTimeout(this.cooldownTimer);
    this.cooldownTimer = null;
    if (!this.openState) return;
    const remaining =
      this.cooldownSnapshot()
        ?.links.map((link) => link.summonRemainingSeconds)
        .filter((seconds) => seconds > 0) ?? [];
    if (!remaining.length) return;
    this.cooldownTimer = setTimeout(
      () => {
        this.cooldownTimer = null;
        if (!this.openState || this.destroyed) return;
        this.paint();
        this.scheduleCooldown();
      },
      Math.min(60, ...remaining) * 1000,
    );
  }

  private animateStamps(): void {
    for (const stamp of this.host.root.querySelectorAll<HTMLElement>('[data-animate="true"]')) {
      const key = stamp.dataset.stampKey!;
      const mark = stamp.querySelector<HTMLElement>('.referral-stamp-mark')!;
      const finish = (): void => {
        if (!stamp.isConnected) return;
        this.animated.add(key);
        stamp.dataset.animate = 'false';
        const redeem = stamp.querySelector<HTMLButtonElement>('[data-referral-action="redeem"]');
        if (redeem) {
          redeem.textContent = referralText('redeem');
          // The earlier-stamp reason is rendered from the authoritative card view.
          redeem.disabled = stamp.querySelector('.referral-stamp > .ui-muted') !== null;
        }
      };
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !mark.animate) {
        finish();
      } else {
        const animation = mark.animate(
          [
            { opacity: 0, transform: 'translateY(-35%) rotate(-10deg)' },
            { opacity: 1, transform: 'translateY(0) rotate(0)' },
          ],
          { duration: 360, easing: 'ease-out' },
        );
        this.animations.push(animation);
        void animation.finished.then(finish, () => {});
      }
    }
  }

  private stopAnimations(): void {
    for (const animation of this.animations) animation.cancel();
    this.animations.length = 0;
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('[data-referral-action]');
    if (!button || !this.host.root.contains(button) || button.disabled) return;
    const action = button.dataset.referralAction;
    if (action === 'close') {
      this.close();
      return;
    }
    const snapshot = this.host.getSnapshot();
    if (action === 'firstPage' || action === 'nextPage') {
      this.host.send(
        action === 'firstPage'
          ? { type: 'page' }
          : { type: 'page', after: snapshot?.nextCursor ?? undefined },
      );
      return;
    }
    const linkId = Number(button.closest<HTMLElement>('[data-link-id]')?.dataset.linkId);
    const link = snapshot?.links.find((row) => row.card.linkId === linkId);
    if (!snapshot || !link) return;
    if (action === 'start') {
      if (link.startReason) this.reason(link.startReason, button);
      else this.send(link, { type: 'start' });
    } else if (action === 'respond') this.startPrompt(link, button);
    else if (action === 'move') this.movePrompt(link, snapshot, button);
    else if (action === 'summon') {
      if (link.summonReason) this.reason(link.summonReason, button);
      else this.send(link, { type: 'summon' });
    } else if (action === 'redeem') {
      this.send(link, { type: 'redeem', milestone: button.dataset.milestone as ReferralMilestone });
    }
  };

  private send(link: ReferralLinkSnapshot, action: ReferralLinkActionPayload): void {
    this.host.send({
      ...action,
      linkId: link.card.linkId,
      expectedRevision: link.card.revision,
    });
  }

  private processPrompts(snapshot: ReferralCardsSnapshot | null): void {
    if (!snapshot || this.prompt) return;
    for (const link of snapshot.links) {
      const confirmation = link.card.lockConfirmation;
      const lockKey = `lock:${link.card.linkId}:${link.card.revision}`;
      if (confirmation?.accountId === snapshot.accountId && !this.seenPrompts.has(lockKey)) {
        this.seenPrompts.add(lockKey);
        const own = referralOwnParticipant(link, snapshot.accountId)!;
        const stage = confirmation.stage;
        this.dialog(
          () => referralText(stage === 1 ? 'lockFirst' : 'lockSecond', { name: own.characterName }),
          stage === 1 ? 'understand' : 'confirmLock',
          () =>
            this.send(link, {
              type: 'redeem',
              milestone: 'fogbinder',
              confirmation: stage === 1 ? 'understand' : 'confirm',
            }),
          this.activeLauncher,
          true,
          link,
        );
        return;
      }
      const warningKey = referralStampKey(link.card.linkId, snapshot.characterId, 'fogbinder');
      if (!confirmation && this.fogbinderWarnings.delete(warningKey)) {
        // Quest hand-in announces the future lock; only explicit redemption can lock it.
        this.dialog(
          () => referralText('unlocked'),
          'understand',
          () => this.open(),
          this.activeLauncher,
        );
        return;
      }
      const declineKey = `decline:${link.card.linkId}:${link.card.revision}`;
      if (link.card.declineAccountId === snapshot.accountId && !this.seenPrompts.has(declineKey)) {
        this.seenPrompts.add(declineKey);
        this.dialog(
          () => referralText('declinePrompt'),
          'decline',
          () => this.send(link, { type: 'respond', accept: false, confirmDecline: true }),
          this.activeLauncher,
          true,
          link,
        );
        return;
      }
    }
    const notice = snapshot.notices.find((row) => !this.seenPrompts.has(`notice:${row.id}`));
    if (!notice) return;
    this.seenPrompts.add(`notice:${notice.id}`);
    this.host.send({ type: 'acknowledgeNotice', noticeId: notice.id });
    if (notice.type === 'reason') this.reason(notice.reason, this.activeLauncher);
    else if (notice.type === 'declined')
      this.dialog(
        () => referralText('declineConfirmed'),
        'okay',
        () => {},
        this.activeLauncher,
      );
    else if (notice.type === 'completed')
      this.dialog(
        () => referralText('completion', { friend: notice.friendName }),
        'openInvites',
        () => this.open(),
        this.activeLauncher,
      );
    else if (notice.type === 'summon')
      this.dialog(
        () => referralText('summonPrompt', { friend: notice.friendName }),
        'accept',
        () => this.host.send({ type: 'answerSummon', requestId: notice.requestId, accept: true }),
        this.activeLauncher,
        true,
        undefined,
        () => this.host.send({ type: 'answerSummon', requestId: notice.requestId, accept: false }),
        'decline',
      );
    else {
      const link = snapshot.links.find((row) => row.card.linkId === notice.linkId);
      if (link && notice.type === 'start') this.startPrompt(link, this.activeLauncher);
      else if (link) this.movePrompt(link, snapshot, this.activeLauncher);
    }
  }

  private startPrompt(link: ReferralLinkSnapshot, opener: HTMLElement): void {
    this.dialog(
      () => referralText('startPrompt', { friend: link.friendName }),
      'accept',
      () => this.send(link, { type: 'respond', accept: true }),
      opener,
      true,
      link,
      () => this.send(link, { type: 'respond', accept: false }),
      'decline',
    );
  }

  private movePrompt(
    link: ReferralLinkSnapshot,
    snapshot: ReferralCardsSnapshot,
    opener: HTMLElement,
  ): void {
    if (link.moveReason || !link.canMove) {
      this.reason(link.moveReason ?? 'unavailable', opener);
      return;
    }
    const own = referralOwnParticipant(link, snapshot.accountId)!;
    this.dialog(
      () =>
        referralText('movePrompt', { oldName: own.characterName, newName: snapshot.characterName }),
      'confirmMove',
      () => this.send(link, { type: 'move', characterId: snapshot.characterId }),
      opener,
      true,
      link,
    );
  }

  private reason(reason: ReferralUiReason, opener: HTMLElement): void {
    this.dialog(
      () => referralText(`reasons.${reason}`),
      'okay',
      () => {},
      opener,
    );
  }

  private dialog(
    text: () => string,
    acceptKey: string,
    accept: () => void,
    opener: HTMLElement,
    cancellable = false,
    link?: ReferralLinkSnapshot,
    cancel?: () => void,
    cancelKey = 'cancel',
  ): void {
    this.dismissPrompt();
    this.promptReopen = () =>
      this.dialog(text, acceptKey, accept, opener, cancellable, link, cancel, cancelKey);
    this.promptLink = link ? { linkId: link.card.linkId, revision: link.card.revision } : null;
    const element = document.createElement('div');
    element.className = 'prompt referral-prompt';
    const title = document.createElement('p');
    title.className = 'prompt-text';
    title.textContent = text();
    element.append(title);
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.textContent = referralText(acceptKey);
    element.append(yes);
    let no: HTMLButtonElement | null = null;
    if (cancellable) {
      no = document.createElement('button');
      no.type = 'button';
      no.textContent = referralText(cancelKey);
      element.append(no);
    }
    this.host.promptStack.append(element);
    const active = document.activeElement;
    const returnTarget = this.openState
      ? active instanceof HTMLElement && this.host.root.contains(active)
        ? active
        : (this.host.root.querySelector<HTMLElement>('[data-referral-action="close"]') ?? opener)
      : opener;
    const handle = installPromptDialog(
      element,
      returnTarget,
      () => {
        element.remove();
        this.prompt = null;
        this.promptLink = null;
        this.promptReopen = null;
        if (this.openState && !returnTarget.isConnected)
          this.host.focusWindow('#referral-cards-window');
      },
      { inertRoot: this.host.root, idPrefix: 'referral-prompt' },
    );
    this.prompt = handle;
    yes.addEventListener('click', () => {
      handle.dismissAndReturn();
      accept();
      this.processPrompts(this.host.getSnapshot());
    });
    no?.addEventListener('click', () => {
      handle.dismissAndReturn();
      cancel?.();
      this.processPrompts(this.host.getSnapshot());
    });
    (no ?? yes).focus();
  }

  private dismissPrompt(): void {
    this.prompt?.dismiss();
    this.prompt = null;
    this.promptLink = null;
    this.promptReopen = null;
    this.host.root.inert = false;
  }
}
