// Thin DOM painter for the Ravenpost mailbox window.
//
// The consumer half of the pure-core + thin-painter split (the MarketWindow
// shape): it paints #mailbox-window from the structured MailboxView
// (mailbox_view.ts) and owns the window's view-state (tab, the opened letter,
// the staged parcels) plus its lifecycle (open / close / refresh-on-snapshot).
// The pure core decides WHICH state the snapshot is in and WHAT rows it shows;
// this module renders that and wires send / take / delete / read back through
// IWorld. It holds no Sim reference and reaches into Hud only through its deps.
//
// Cold, event-driven window: rendered on open and on a real signature change,
// never from the per-frame hot path, so innerHTML rebuilds are fine here.

import { audio } from '../game/audio';
import { ITEMS } from '../sim/data';
import type { InvSlot } from '../sim/types';
import type { IWorld } from '../world_api';
import { markDialogRoot } from './dialog_root';
import { itemDisplayName, tEntity } from './entity_i18n';
import { esc } from './esc';
import { formatMoney, formatNumber, t } from './i18n';
import { QUALITY_COLOR } from './icons';
import {
  buildMailboxView,
  type MailInboxBody,
  type MailInboxRow,
  type MailSendBody,
  type MailTab,
  mailSendBlocked,
} from './mailbox_view';
import type { PainterHostPresentation } from './painter_host';
import { svgIcon } from './ui_icons';

const QUALITY_DEFAULT_COLOR = 'var(--color-quality-default)';
// Copper-per-denomination (mirrors market_view's COPPER_PER_*).
const COPPER_PER_GOLD = 10_000;
const COPPER_PER_SILVER = 100;
// Grace before "no mailInfo" closes the window: online, the mail mirror rides
// the staggered heavy self refresh, so it can lag the open by up to ~2s.
const MAIL_INFO_GRACE_MS = 3_000;

export interface MailboxWindowDeps extends PainterHostPresentation {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  hideTooltip(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  showError(text: string): void;
  /** Render the bags window and, when `open`, reveal it alongside the mailbox. */
  syncBags(open: boolean): void;
}

export class MailboxWindow {
  private opened = false;
  private tab: MailTab = 'inbox';
  private openedId: number | null = null;
  private attachments: InvSlot[] = [];
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;
  private openedAt = 0;

  constructor(private readonly deps: MailboxWindowDeps) {}

  get isOpen(): boolean {
    return this.opened;
  }

  /** True while the Send tab is showing (the bags window stages parcels into it). */
  get isSendTab(): boolean {
    return this.opened && this.tab === 'send';
  }

  open(): void {
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus();
    this.opened = true;
    this.tab = 'inbox';
    this.openedId = null;
    this.attachments = [];
    this.lastSig = '';
    this.openedAt = performance.now();
    // Nudge a heavy self refresh so the mail mirror arrives promptly online
    // (mail_read is a HEAVY_SELF_CMDS member; id 0 never matches a letter).
    this.deps.world().mailMarkRead(0);
    this.render();
    this.deps.root().style.display = 'flex';
    audio.bagOpen();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.openedId = null;
    this.attachments = [];
    this.deps.root().style.display = 'none';
    this.deps.hideTooltip();
    this.deps.syncBags(false);
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  /** Stage a bag stack as a parcel (called by the bags window on click). */
  stageParcel(itemId: string): void {
    if (!this.isSendTab) return;
    const info = this.deps.world().mailInfo;
    const max = info?.maxAttachments ?? 3;
    if (this.attachments.length >= max) {
      this.deps.showError(
        t('hudChrome.mailbox.result.tooManyParcels', {
          count: formatNumber(max, { maximumFractionDigits: 0 }),
        }),
      );
      return;
    }
    if (this.attachments.some((s) => s.itemId === itemId)) return;
    const count = this.deps
      .world()
      .inventory.filter((s) => s.itemId === itemId)
      .reduce((n, s) => n + s.count, 0);
    if (count < 1) return;
    this.attachments.push({ itemId, count });
    audio.click();
    this.render();
  }

  /** Mail command outcome relayed by the HUD (handleEvents). */
  onMailResult(code: string): void {
    if (!this.opened) return;
    if (code === 'sent') {
      this.attachments = [];
      const root = this.deps.root();
      const subject = root.querySelector<HTMLInputElement>('#mail-subject');
      const body = root.querySelector<HTMLTextAreaElement>('#mail-body');
      if (subject) subject.value = '';
      if (body) body.value = '';
      for (const id of ['mail-g', 'mail-s', 'mail-c']) {
        const coin = root.querySelector<HTMLInputElement>(`#${id}`);
        if (coin) coin.value = '0';
      }
      this.renderParcels();
      // Escrow left the purse and bags the moment the send resolved: repaint the
      // bags window now (it rides alongside the Send tab), not on mailbox close.
      this.deps.syncBags(this.isSendTab);
    }
    if (code === 'collected' || code === 'letterGone' || code === 'takeParcelsFirst') {
      this.lastSig = '';
    }
    if (code === 'collected') {
      // Coin and parcels just landed in the purse and bags: repaint if open.
      this.deps.syncBags(false);
    }
  }

  // Per-frame (slow divider): refresh the inbox when the mirror changes; close
  // when the player walks away from the mailbox (the mirror goes null).
  refreshIfChanged(): void {
    if (!this.opened) return;
    const info = this.deps.world().mailInfo;
    if (!info) {
      if (performance.now() - this.openedAt > MAIL_INFO_GRACE_MS) this.close();
      return;
    }
    if (this.tab === 'send') return; // typed inputs: rebuilt only on actions
    const sig = JSON.stringify([this.tab, this.openedId, info.messages, info.unread]);
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.render();
  }

  private senderLabel(row: MailInboxRow): string {
    if (row.letterId) return tEntity({ kind: 'letter', id: row.letterId, field: 'sender' });
    return row.senderName;
  }

  private subjectLabel(row: MailInboxRow): string {
    if (row.letterId) return tEntity({ kind: 'letter', id: row.letterId, field: 'subject' });
    return row.subject.length > 0 ? row.subject : t('hudChrome.mailbox.noSubject');
  }

  render(): void {
    const el = this.deps.root();
    this.deps.hideTooltip();
    markDialogRoot(el, { label: t('hudChrome.mailbox.title') });
    const info = this.deps.world().mailInfo;
    const inboxLabel =
      info && info.unread > 0
        ? t('hudChrome.mailbox.tabInboxWithCount', {
            count: formatNumber(info.unread, { maximumFractionDigits: 0 }),
          })
        : t('hudChrome.mailbox.tabInbox');
    const tabButton = (id: MailTab, label: string) =>
      `<button type="button" class="mail-tab${this.tab === id ? ' sel' : ''}" data-tab="${id}" aria-pressed="${this.tab === id ? 'true' : 'false'}">${esc(label)}</button>`;
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('hudChrome.mailbox.title'))} <span class="panel-subtitle">${esc(t('hudChrome.mailbox.subtitle'))}</span></span><button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.mailbox.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="mail-tabs">${tabButton('inbox', inboxLabel)}${tabButton('send', t('hudChrome.mailbox.tabSend'))}</div>` +
      `<div id="mailbox-body"></div>`;
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    el.querySelectorAll('[data-tab]').forEach((node) => {
      node.addEventListener('click', () => {
        const next = (node as HTMLElement).dataset.tab as MailTab;
        if (next === this.tab) return;
        this.tab = next;
        this.openedId = null;
        this.lastSig = '';
        audio.click();
        this.render();
        this.deps.syncBags(this.tab === 'send');
        (this.deps.root().querySelector(`[data-tab="${next}"]`) as HTMLElement | null)?.focus();
      });
    });
    this.renderContent();
  }

  private renderContent(): void {
    const body = this.deps.root().querySelector<HTMLElement>('#mailbox-body');
    if (!body) return;
    const view = buildMailboxView({
      info: this.deps.world().mailInfo,
      tab: this.tab,
      openedId: this.openedId,
      attachments: this.attachments,
    });
    if (view.kind === 'no-data') {
      body.innerHTML = `<div class="mail-empty">${esc(t('hudChrome.mailbox.result.tooFar'))}</div>`;
      return;
    }
    if (view.kind === 'inbox') {
      this.renderInbox(body, view.body);
      return;
    }
    this.renderSend(body, view.body);
  }

  private renderInbox(body: HTMLElement, view: MailInboxBody): void {
    if (view.opened) {
      this.renderReading(body, view.opened);
      return;
    }
    body.innerHTML = '';
    if (view.rows.length === 0) {
      body.innerHTML = `<div class="mail-empty">${esc(t('hudChrome.mailbox.empty'))}</div>`;
      return;
    }
    const list = document.createElement('div');
    list.className = 'mail-list';
    for (const row of view.rows) {
      const sender = this.senderLabel(row);
      const subject = this.subjectLabel(row);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `mail-row${row.unread ? ' unread' : ''}`;
      btn.setAttribute('aria-label', t('hudChrome.mailbox.openAria', { subject, name: sender }));
      btn.innerHTML =
        `<span class="mail-row-icon${row.unread ? ' unread' : ''}">${svgIcon('mail')}</span>` +
        `<span class="mail-row-text"><span class="mail-row-subject">${esc(subject)}</span>` +
        `<span class="mail-row-sender">${esc(sender)}</span></span>` +
        (row.hasAttachments
          ? `<span class="mail-row-parcel" title="${esc(t('hudChrome.mailbox.attachmentsBadge'))}">${svgIcon('bags')}</span>`
          : '');
      btn.addEventListener('click', () => {
        this.openedId = row.id;
        if (row.unread) this.deps.world().mailMarkRead(row.id);
        this.lastSig = '';
        audio.click();
        this.render();
      });
      list.appendChild(btn);
    }
    body.appendChild(list);
    if (view.totalCount > view.rows.length) {
      const note = document.createElement('div');
      note.className = 'mail-note';
      note.textContent = t('hudChrome.mailbox.truncated', {
        shown: formatNumber(view.rows.length, { maximumFractionDigits: 0 }),
        total: formatNumber(view.totalCount, { maximumFractionDigits: 0 }),
      });
      body.appendChild(note);
    }
  }

  private renderReading(body: HTMLElement, opened: MailInboxRow & { body: string }): void {
    const sender = this.senderLabel(opened);
    const subject = this.subjectLabel(opened);
    const letterBody = opened.letterId
      ? tEntity({ kind: 'letter', id: opened.letterId, field: 'body' })
      : opened.body;
    body.innerHTML =
      `<div class="mail-reading">` +
      `<button type="button" class="mail-back" data-mail-back>${svgIcon('prev')}<span>${esc(t('hudChrome.mailbox.back'))}</span></button>` +
      `<div class="mail-reading-head"><span class="mail-reading-subject">${esc(subject)}</span>` +
      `<span class="mail-reading-sender">${esc(sender)}</span></div>` +
      `<div class="mail-reading-body">${esc(letterBody).replace(/\n/g, '<br>')}</div>` +
      `<div class="mail-attachments" id="mail-attachments"></div>` +
      `<div class="mail-actions" id="mail-actions"></div>` +
      `</div>`;
    body.querySelector('[data-mail-back]')?.addEventListener('click', () => {
      this.openedId = null;
      this.lastSig = '';
      audio.click();
      this.render();
    });
    const attachmentsRow = body.querySelector<HTMLElement>('#mail-attachments');
    if (attachmentsRow) {
      if (opened.copper > 0) {
        const coin = document.createElement('span');
        coin.className = 'mail-attachment-coin';
        coin.innerHTML = this.deps.moneyHtml(opened.copper);
        attachmentsRow.appendChild(coin);
      }
      for (const slot of opened.items) {
        const item = ITEMS[slot.itemId];
        const chip = document.createElement('span');
        chip.className = 'mail-attachment-item';
        if (item) {
          const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? QUALITY_DEFAULT_COLOR;
          const stack =
            slot.count > 1 ? ` x${formatNumber(slot.count, { maximumFractionDigits: 0 })}` : '';
          chip.innerHTML = `${this.deps.itemIcon(item)}<span style="color:${qColor}">${esc(itemDisplayName(item))}${esc(stack)}</span>`;
          this.deps.attachTooltip(chip, () => this.deps.itemTooltip(item));
        } else {
          chip.textContent = slot.itemId;
        }
        attachmentsRow.appendChild(chip);
      }
    }
    const actions = body.querySelector<HTMLElement>('#mail-actions');
    if (!actions) return;
    if (opened.hasAttachments) {
      const take = document.createElement('button');
      take.type = 'button';
      take.className = 'mail-action-btn';
      take.textContent = t('hudChrome.mailbox.take');
      take.addEventListener('click', () => {
        this.deps.world().mailTake(opened.id);
        audio.coin();
        this.lastSig = '';
      });
      actions.appendChild(take);
    } else {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'mail-action-btn danger';
      del.textContent = t('hudChrome.mailbox.delete');
      del.setAttribute(
        'aria-label',
        t('hudChrome.mailbox.deleteAria', { subject: this.subjectLabel(opened) }),
      );
      del.addEventListener('click', () => {
        this.deps.world().mailDelete(opened.id);
        this.openedId = null;
        this.lastSig = '';
        audio.click();
      });
      actions.appendChild(del);
    }
  }

  private renderSend(body: HTMLElement, view: MailSendBody): void {
    body.innerHTML =
      `<div class="mail-send-form">` +
      `<div class="mail-field"><label for="mail-to">${esc(t('hudChrome.mailbox.toLabel'))}</label>` +
      `<input id="mail-to" type="text" maxlength="32" autocomplete="off" placeholder="${esc(t('hudChrome.mailbox.toPlaceholder'))}"></div>` +
      `<div class="mail-field"><label for="mail-subject">${esc(t('hudChrome.mailbox.subjectLabel'))}</label>` +
      `<input id="mail-subject" type="text" maxlength="64" autocomplete="off"></div>` +
      `<div class="mail-field"><label for="mail-body">${esc(t('hudChrome.mailbox.bodyLabel'))}</label>` +
      `<textarea id="mail-body" maxlength="600" rows="5"></textarea></div>` +
      `<div class="mail-field mail-coin-row"><label>${esc(t('hudChrome.mailbox.coinLabel'))}</label>` +
      `<input class="coininput" id="mail-g" type="number" min="0" value="0" aria-label="${esc(t('itemUi.money.gold'))}"><span class="coin g" aria-hidden="true"></span>` +
      `<input class="coininput" id="mail-s" type="number" min="0" max="99" value="0" aria-label="${esc(t('itemUi.money.silver'))}"><span class="coin s" aria-hidden="true"></span>` +
      `<input class="coininput" id="mail-c" type="number" min="0" max="99" value="0" aria-label="${esc(t('itemUi.money.copper'))}"><span class="coin c" aria-hidden="true"></span></div>` +
      `<div class="mail-field"><label>${esc(t('hudChrome.mailbox.parcelsLabel'))}</label>` +
      `<div class="mail-parcels" id="mail-parcels"></div></div>` +
      `<div class="mail-note">${esc(
        t('hudChrome.mailbox.postageNote', {
          amount: formatMoney(view.postage),
          seconds: formatNumber(view.deliverySeconds, { maximumFractionDigits: 0 }),
        }),
      )}</div>` +
      `<button type="button" class="mail-send-btn" id="mail-send-btn">${esc(t('hudChrome.mailbox.sendButton'))}</button>` +
      `</div>`;
    this.renderParcels();
    // Bags ride alongside so parcels can be clicked straight onto the letter.
    this.deps.syncBags(true);
    // The coin inputs seed "0": select it on focus so typing replaces the value
    // (clicking into gold and typing 1 must mean 1g, not the 10 you get by
    // appending). The once-only mouseup swallow keeps the click-to-focus gesture
    // from collapsing the selection again; a second click still places the caret.
    for (const id of ['mail-g', 'mail-s', 'mail-c']) {
      const coin = body.querySelector<HTMLInputElement>(`#${id}`);
      coin?.addEventListener('focus', () => {
        coin.select();
        coin.addEventListener('mouseup', (e) => e.preventDefault(), { once: true });
      });
    }
    body.querySelector('#mail-send-btn')?.addEventListener('click', () => {
      const root = this.deps.root();
      const read = (id: string) =>
        Math.max(
          0,
          parseInt(root.querySelector<HTMLInputElement>(`#${id}`)?.value || '0', 10) || 0,
        );
      const to = root.querySelector<HTMLInputElement>('#mail-to')?.value ?? '';
      const subject = root.querySelector<HTMLInputElement>('#mail-subject')?.value ?? '';
      const letter = root.querySelector<HTMLTextAreaElement>('#mail-body')?.value ?? '';
      const copper =
        read('mail-g') * COPPER_PER_GOLD + read('mail-s') * COPPER_PER_SILVER + read('mail-c');
      const info = this.deps.world().mailInfo;
      const blocked = mailSendBlocked({
        to,
        attachedCopper: copper,
        postage: info?.postage ?? 0,
        purse: this.deps.world().copper,
      });
      if (blocked) {
        this.deps.showError(t(`hudChrome.mailbox.result.${blocked}`));
        return;
      }
      this.deps.world().mailSend(to, subject, letter, copper, this.attachments);
      audio.click();
    });
  }

  private renderParcels(): void {
    const parcels = this.deps.root().querySelector<HTMLElement>('#mail-parcels');
    if (!parcels) return;
    parcels.innerHTML = '';
    if (this.attachments.length === 0) {
      const hint = document.createElement('span');
      hint.className = 'mail-parcel-hint';
      hint.textContent = t('hudChrome.mailbox.parcelsHint');
      parcels.appendChild(hint);
      return;
    }
    for (const slot of this.attachments) {
      const item = ITEMS[slot.itemId];
      if (!item) continue;
      const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? QUALITY_DEFAULT_COLOR;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'mail-parcel-chip';
      const stack =
        slot.count > 1 ? ` x${formatNumber(slot.count, { maximumFractionDigits: 0 })}` : '';
      chip.innerHTML = `${this.deps.itemIcon(item)}<span style="color:${qColor}">${esc(itemDisplayName(item))}${esc(stack)}</span>${svgIcon('close', { cls: 'mail-parcel-remove' })}`;
      chip.setAttribute(
        'aria-label',
        t('hudChrome.mailbox.removeParcelAria', { item: itemDisplayName(item) }),
      );
      chip.addEventListener('click', () => {
        this.attachments = this.attachments.filter((s) => s.itemId !== slot.itemId);
        audio.click();
        this.renderParcels();
      });
      this.deps.attachTooltip(chip, () => this.deps.itemTooltip(item));
      parcels.appendChild(chip);
    }
  }
}
