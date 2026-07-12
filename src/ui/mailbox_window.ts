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
  clampParcelQty,
  type MailInboxBody,
  type MailInboxRow,
  type MailSendBody,
  type MailTab,
  mailSendBlocked,
  recipientSuggestions,
  wrappedSuggestionIndex,
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
// Recipient autocomplete timings: debounce before querying, delay clear after
// blur so a pending mousedown on a suggestion can still fire first.
const RECIPIENT_SUGGEST_DEBOUNCE_MS = 160;
const RECIPIENT_SUGGEST_BLUR_CLEAR_MS = 150;
// Maximum number of autocomplete suggestions shown.
const RECIPIENT_SUGGEST_MAX = 8;

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
  // Recipient autocomplete state (Send tab only).
  private recipientSuggestTimer: number | undefined;
  private recipientSuggest: {
    items: { name: string; cls: string; level: number }[];
    index: number;
  } = { items: [], index: -1 };

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
    window.clearTimeout(this.recipientSuggestTimer);
    this.recipientSuggest = { items: [], index: -1 };
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
    const count = this.ownedCountFor(itemId);
    if (count < 1) return;
    this.attachments.push({ itemId, count });
    audio.click();
    this.render();
  }

  /**
   * Total owned across all bag slots of one item id (the stepper's ceiling).
   * Mirrors the sim's fungible-only stock check (countFungibleItem in
   * sim.ts skips instanced slots), so the ceiling never exceeds what the
   * send path can actually deduct.
   */
  private ownedCountFor(itemId: string): number {
    return this.deps
      .world()
      .inventory.filter((s) => s.itemId === itemId && !s.instance)
      .reduce((n, s) => n + s.count, 0);
  }

  /** Nudge a staged parcel's quantity from the +/- stepper (#1444). */
  private adjustParcelQty(itemId: string, delta: number): void {
    const slot = this.attachments.find((s) => s.itemId === itemId);
    if (!slot) return;
    const next = clampParcelQty(slot.count, delta, this.ownedCountFor(itemId));
    if (next === slot.count) return;
    slot.count = next;
    audio.click();
    this.renderParcels();
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
    window.clearTimeout(this.recipientSuggestTimer);
    this.recipientSuggest = { items: [], index: -1 };
    body.innerHTML =
      `<div class="mail-send-form">` +
      `<div class="mail-field"><label for="mail-to">${esc(t('hudChrome.mailbox.toLabel'))}</label>` +
      `<div class="mail-to-wrap">` +
      `<div class="mail-to-suggest" id="mail-to-suggest" role="listbox"></div>` +
      `<input id="mail-to" type="text" maxlength="32" autocomplete="off" placeholder="${esc(t('hudChrome.mailbox.toPlaceholder'))}" role="combobox" aria-autocomplete="list" aria-controls="mail-to-suggest" aria-expanded="false"></div></div>` +
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
    this.wireRecipientSuggest(body);
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

  // Wire the recipient field combobox: debounced searchCharacters, keyboard
  // navigation (ArrowDown/Up/Enter/Escape), hover highlight, click-to-select,
  // and blur-with-delay so mousedown on a suggestion fires before the list clears.
  private wireRecipientSuggest(body: HTMLElement): void {
    const input = body.querySelector<HTMLInputElement>('#mail-to');
    if (!input) return;

    input.addEventListener('input', () => {
      const q = input.value.trim();
      window.clearTimeout(this.recipientSuggestTimer);
      if (!q) {
        this.renderRecipientSuggest(body, []);
        return;
      }
      this.recipientSuggestTimer = window.setTimeout(async () => {
        const results = await this.deps.world().searchCharacters(q);
        const filtered = recipientSuggestions(
          results,
          this.deps.world().player.name,
          RECIPIENT_SUGGEST_MAX,
        );
        this.renderRecipientSuggest(body, filtered);
      }, RECIPIENT_SUGGEST_DEBOUNCE_MS);
    });

    input.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      const open = this.recipientSuggest.items.length > 0;
      if (ke.key === 'ArrowDown' && open) {
        ke.preventDefault();
        this.moveRecipientSuggest(body, 1);
      } else if (ke.key === 'ArrowUp' && open) {
        ke.preventDefault();
        this.moveRecipientSuggest(body, -1);
      } else if (ke.key === 'Escape' && open) {
        ke.preventDefault();
        this.renderRecipientSuggest(body, []);
      } else if (ke.key === 'Enter' && open && this.recipientSuggest.index >= 0) {
        ke.preventDefault();
        const picked = this.recipientSuggest.items[this.recipientSuggest.index]?.name;
        if (picked) this.selectRecipient(body, input, picked);
      }
    });

    input.addEventListener('blur', () => {
      window.setTimeout(
        () => this.renderRecipientSuggest(body, []),
        RECIPIENT_SUGGEST_BLUR_CLEAR_MS,
      );
    });
  }

  private selectRecipient(body: HTMLElement, input: HTMLInputElement, name: string): void {
    input.value = name;
    this.renderRecipientSuggest(body, []);
  }

  private renderRecipientSuggest(
    body: HTMLElement,
    results: { name: string; cls: string; level: number }[],
  ): void {
    const box = body.querySelector<HTMLElement>('#mail-to-suggest');
    const input = body.querySelector<HTMLInputElement>('#mail-to');
    if (!box) return;
    this.recipientSuggest = { items: results, index: -1 };
    if (results.length === 0) {
      box.style.display = 'none';
      box.innerHTML = '';
      input?.setAttribute('aria-expanded', 'false');
      input?.removeAttribute('aria-activedescendant');
      return;
    }
    box.innerHTML = results
      .map(
        (r, i) =>
          `<div id="mail-to-sugg-${i}" class="soc-sugg-item" data-i="${i}" data-name="${esc(r.name)}" role="option" aria-selected="false"><span class="soc-name">${esc(r.name)}</span></div>`,
      )
      .join('');
    this.placeRecipientSuggest(body, box);
    box.style.display = 'block';
    input?.setAttribute('aria-expanded', 'true');
    input?.removeAttribute('aria-activedescendant');
    box.querySelectorAll('.soc-sugg-item').forEach((it) => {
      it.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const name = (it as HTMLElement).dataset.name ?? '';
        if (name && input) this.selectRecipient(body, input, name);
      });
      it.addEventListener('mousemove', () => {
        this.recipientSuggest.index = Number((it as HTMLElement).dataset.i);
        this.highlightRecipientSuggest(body);
      });
    });
  }

  private moveRecipientSuggest(body: HTMLElement, delta: number): void {
    const n = this.recipientSuggest.items.length;
    if (n === 0) return;
    this.recipientSuggest.index = wrappedSuggestionIndex(this.recipientSuggest.index, delta, n);
    this.highlightRecipientSuggest(body);
  }

  private placeRecipientSuggest(body: HTMLElement, box: HTMLElement): void {
    const wrap = body.querySelector<HTMLElement>('.mail-to-wrap');
    if (!wrap) return;
    box.classList.remove('up');
    box.style.maxHeight = '';
    const bodyRect = body.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const gap = 3;
    const spaceBelow = Math.floor(bodyRect.bottom - wrapRect.bottom - gap);
    const spaceAbove = Math.floor(wrapRect.top - bodyRect.top - gap);
    const openUp = spaceBelow < 110 && spaceAbove > spaceBelow;
    if (openUp) box.classList.add('up');
    const available = openUp ? spaceAbove : spaceBelow;
    const maxHeight = Math.min(210, Math.max(80, available));
    box.style.maxHeight = `${maxHeight}px`;
  }

  private highlightRecipientSuggest(body: HTMLElement): void {
    const box = body.querySelector<HTMLElement>('#mail-to-suggest');
    const input = body.querySelector<HTMLInputElement>('#mail-to');
    if (!box) return;
    box.querySelectorAll('.soc-sugg-item').forEach((it) => {
      const on = Number((it as HTMLElement).dataset.i) === this.recipientSuggest.index;
      it.classList.toggle('active', on);
      it.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) (it as HTMLElement).scrollIntoView({ block: 'nearest' });
    });
    if (this.recipientSuggest.index >= 0) {
      input?.setAttribute('aria-activedescendant', `mail-to-sugg-${this.recipientSuggest.index}`);
    } else {
      input?.removeAttribute('aria-activedescendant');
    }
  }

  private renderParcels(): void {
    const parcels = this.deps.root().querySelector<HTMLElement>('#mail-parcels');
    if (!parcels) return;
    // A +/- click rebuilds this whole container, which would otherwise drop
    // keyboard focus to <body>; remember which control (by item + role) had
    // it so the rebuilt equivalent can reclaim it below.
    const focusedEl = document.activeElement as HTMLElement | null;
    const focusKey =
      focusedEl && parcels.contains(focusedEl) ? (focusedEl.dataset.focusKey ?? null) : null;
    parcels.innerHTML = '';
    if (this.attachments.length === 0) {
      const hint = document.createElement('span');
      hint.className = 'mail-parcel-hint';
      hint.textContent = t('hudChrome.mailbox.parcelsHint');
      parcels.appendChild(hint);
      return;
    }
    const itemControls = new Map<
      string,
      { minus?: HTMLButtonElement; plus?: HTMLButtonElement; remove?: HTMLButtonElement }
    >();
    for (const slot of this.attachments) {
      const item = ITEMS[slot.itemId];
      if (!item) continue;
      const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? QUALITY_DEFAULT_COLOR;
      const chip = document.createElement('span');
      chip.className = 'mail-parcel-chip';
      const name = document.createElement('span');
      name.className = 'mail-parcel-name';
      // Keyboard-focusable so Tab can reach it: attachTooltip's keyboard path
      // is a focusin listener on this exact element.
      name.tabIndex = 0;
      name.innerHTML = `${this.deps.itemIcon(item)}<span style="color:${qColor}">${esc(itemDisplayName(item))}</span>`;
      this.deps.attachTooltip(name, () => this.deps.itemTooltip(item));
      chip.appendChild(name);
      const owned = this.ownedCountFor(slot.itemId);
      const controls: {
        minus?: HTMLButtonElement;
        plus?: HTMLButtonElement;
        remove?: HTMLButtonElement;
      } = {};
      if (owned > 1) {
        const step = document.createElement('span');
        step.className = 'mail-parcel-qty';
        const minus = document.createElement('button');
        minus.type = 'button';
        minus.className = 'mail-parcel-step';
        minus.textContent = '−';
        minus.disabled = slot.count <= 1;
        minus.dataset.focusKey = `${slot.itemId}:minus`;
        minus.setAttribute(
          'aria-label',
          t('hudChrome.mailbox.parcelQtyDecreaseAria', { item: itemDisplayName(item) }),
        );
        minus.addEventListener('click', () => this.adjustParcelQty(slot.itemId, -1));
        const qty = document.createElement('span');
        qty.className = 'mail-parcel-qty-value';
        qty.setAttribute('aria-live', 'polite');
        qty.textContent = t('itemUi.bags.stackCount', {
          count: formatNumber(slot.count, { maximumFractionDigits: 0 }),
        });
        const plus = document.createElement('button');
        plus.type = 'button';
        plus.className = 'mail-parcel-step';
        plus.textContent = '+';
        plus.disabled = slot.count >= owned;
        plus.dataset.focusKey = `${slot.itemId}:plus`;
        plus.setAttribute(
          'aria-label',
          t('hudChrome.mailbox.parcelQtyIncreaseAria', { item: itemDisplayName(item) }),
        );
        plus.addEventListener('click', () => this.adjustParcelQty(slot.itemId, 1));
        step.append(minus, qty, plus);
        chip.appendChild(step);
        controls.minus = minus;
        controls.plus = plus;
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mail-parcel-remove-btn';
      remove.innerHTML = svgIcon('close', { cls: 'mail-parcel-remove' });
      remove.dataset.focusKey = `${slot.itemId}:remove`;
      remove.setAttribute(
        'aria-label',
        t('hudChrome.mailbox.removeParcelAria', { item: itemDisplayName(item) }),
      );
      remove.addEventListener('click', () => {
        this.attachments = this.attachments.filter((s) => s.itemId !== slot.itemId);
        audio.click();
        this.renderParcels();
      });
      chip.appendChild(remove);
      controls.remove = remove;
      itemControls.set(slot.itemId, controls);
      parcels.appendChild(chip);
    }
    if (focusKey) {
      const [itemId, role] = focusKey.split(':');
      const controls = itemControls.get(itemId);
      const preferred = controls
        ? role === 'minus'
          ? controls.minus
          : role === 'plus'
            ? controls.plus
            : controls.remove
        : undefined;
      // The just-activated control (or its whole item) can vanish on rebuild
      // (disabled at a bound, or the stepper dropped once owned <= 1): fall
      // back to the nearest still-focusable control for the same item.
      let target: HTMLButtonElement | undefined;
      if (preferred && !preferred.disabled) target = preferred;
      else if (controls?.minus && !controls.minus.disabled) target = controls.minus;
      else if (controls?.plus && !controls.plus.disabled) target = controls.plus;
      else target = controls?.remove;
      target?.focus();
    }
  }
}
