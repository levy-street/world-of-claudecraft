// The touch HUD's unread chat box: a small stack over the Quick Actions
// control with one row per channel that has unread lines (Whisper, Party,
// General) under a "Chat" header carrying the total. This is the thin DOM
// side; which rows show and what they print is chat_unread_core.ts, and the
// counts are the same ones the round badge reads (ChatUnreadController).
//
// SEAT: it is appended to #mobile-combat-controls, the Quick Actions seat, and
// the stylesheet hangs it over that column (hud.mobile.css). That band is the
// one the touch layout already keeps free above the control in every tier, and
// it is nowhere near the top-left column (target frame, its aura strip, party
// frames) or the bottom-centre cluster (player frame, cast bar). On the compact
// tier the names and the header drop and each row is a dot-and-count pill, so
// the footprint stays exactly as wide as the control beneath it.
//
// Every row is a real button: a tap selects that channel's tab and opens chat
// (the controller decides which tab). The accessible name carries the channel
// and the count, so the compact pills are never colour-only to a screen reader.

import { formatNumber, type TranslationKey, t } from '../../i18n';
import { bindTouchTap } from '../../touch_tap';
import { chatChannelColor, chatOpenTabLabelKey } from './chat_channels';
import {
  CHAT_UNREAD_CHANNELS,
  type ChatUnreadChannel,
  type ChatUnreadRow,
  chatUnreadPill,
  chatUnreadTotal,
} from './chat_unread_core';

export const CHAT_UNREAD_BOX_ID = 'chat-unread-box';
/** The Quick Actions seat the box hangs over. */
export const CHAT_UNREAD_BOX_HOST_ID = 'mobile-combat-controls';
export const CHAT_UNREAD_HEAD_CLASS = 'chat-unread-head';
export const CHAT_UNREAD_ROW_CLASS = 'chat-unread-row';
export const CHAT_UNREAD_COUNT_CLASS = 'chat-unread-count';

/** The header's caption: the touch Chat button's own label. */
const TITLE_KEY: TranslationKey = 'hud.core.mobileChat';
const DIGITS = { maximumFractionDigits: 0, useGrouping: false };

interface RowNodes {
  button: HTMLButtonElement;
  plate: HTMLElement;
  name: HTMLElement;
  count: HTMLElement;
}

export interface ChatUnreadBoxDeps {
  document: Document;
  /** A row (its channel) or the header (null) was tapped. */
  onPick(channel: ChatUnreadChannel | null): void;
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setAttr(el: HTMLElement, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

export class ChatUnreadBox {
  private root: HTMLElement | null = null;
  private head: RowNodes | null = null;
  private readonly rows = new Map<ChatUnreadChannel, RowNodes>();

  constructor(private readonly deps: ChatUnreadBoxDeps) {}

  /** Paint `rows` (empty hides the box). Safe to call on every received line:
   *  each write is compared against the RESOLVED text already in the node, so
   *  an unchanged row costs no DOM write and a language switch repaints by
   *  itself (there is no data signature here to go stale across locales). */
  render(rows: readonly ChatUnreadRow[]): void {
    if (rows.length === 0) {
      if (this.root && !this.root.hidden) this.root.hidden = true;
      return;
    }
    const root = this.mount();
    // No seat in this document (a build without the touch controls).
    if (!root || !this.head) return;
    const title = t(TITLE_KEY);
    const total = chatUnreadTotal(rows);
    this.write(this.head, title, total);
    setAttr(root, 'aria-label', this.describe(title, total));
    for (const channel of CHAT_UNREAD_CHANNELS) {
      const nodes = this.rows.get(channel);
      if (!nodes) continue;
      const row = rows.find((candidate) => candidate.channel === channel);
      if (nodes.button.hidden !== !row) nodes.button.hidden = !row;
      if (row) this.write(nodes, t(chatOpenTabLabelKey(channel)), row.count);
    }
    if (root.hidden) root.hidden = false;
  }

  private write(nodes: RowNodes, name: string, count: number): void {
    setText(nodes.name, name);
    setText(nodes.count, this.pillText(count));
    setAttr(nodes.button, 'aria-label', this.describe(name, count));
  }

  private pillText(count: number): string {
    const pill = chatUnreadPill(count);
    const shown = formatNumber(pill.shown, DIGITS);
    return pill.overflow ? t('hudChrome.mobile.whisperUnreadOverflow', { count: shown }) : shown;
  }

  private describe(channel: string, count: number): string {
    return t('hudChrome.mobile.whisperUnreadDesc', {
      channel,
      count: formatNumber(count, DIGITS),
    });
  }

  private mount(): HTMLElement | null {
    const { document } = this.deps;
    const host = document.getElementById(CHAT_UNREAD_BOX_HOST_ID);
    if (!host) return null;
    if (this.root && this.root.parentElement === host) return this.root;
    this.root?.remove();
    this.rows.clear();
    const root = document.createElement('div');
    root.id = CHAT_UNREAD_BOX_ID;
    root.setAttribute('role', 'group');
    root.hidden = true;
    this.head = this.button(CHAT_UNREAD_HEAD_CLASS, null);
    root.append(this.head.button);
    for (const channel of CHAT_UNREAD_CHANNELS) {
      const nodes = this.button(CHAT_UNREAD_ROW_CLASS, channel);
      nodes.button.dataset.chan = channel;
      // The channel color has one home (chat_channels.ts); CSS reads it.
      nodes.button.style.setProperty('--chat-unread-color', chatChannelColor(channel));
      const dot = document.createElement('span');
      dot.className = 'chat-unread-dot';
      dot.setAttribute('aria-hidden', 'true');
      nodes.plate.prepend(dot);
      this.rows.set(channel, nodes);
      root.append(nodes.button);
    }
    host.append(root);
    this.root = root;
    return root;
  }

  private button(className: string, channel: ChatUnreadChannel | null): RowNodes {
    const { document } = this.deps;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    // The button is the 40px touch target; the plate inside is what shows.
    const plate = document.createElement('span');
    plate.className = 'chat-unread-plate';
    const name = document.createElement('span');
    name.className = 'chat-unread-name';
    const count = document.createElement('span');
    count.className = `ui-badge ${CHAT_UNREAD_COUNT_CLASS}`;
    plate.append(name, count);
    button.append(plate);
    // bindTouchTap, not a bare click: the browser only synthesizes a click for
    // the PRIMARY touch, and the other thumb is usually on the move stick.
    bindTouchTap(button, () => this.deps.onPick(channel));
    return { button, plate, name, count };
  }
}
