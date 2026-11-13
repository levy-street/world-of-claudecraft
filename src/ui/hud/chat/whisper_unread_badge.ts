// The touch HUD's unread chat badge: a small count on every control that leads
// to chat, lit by unread whispers and party lines. This is the thin DOM side: it
// paints the counts it is handed. The counts are the unread counter
// (chat_unread_core.ts), kept by ChatUnreadController, which also follows chat
// opening and closing, so no touch-input file needs to know about the badge.
//
// ONE number (whispers plus party) in ONE colour: the whisper colour while any
// whisper is unread, else the party colour. The split is spelled out for
// assistive tech in the description ("Whisper: 2, Party: 1").
//
// Three controls are badged because which one is on screen depends on where the
// player is: the Quick Actions anchor (the only one visible while chat is
// closed), the strip's Chat seat (once the strip is open), and the More tray's
// Chat button. A control that is not in the DOM is skipped.
//
// The count is announced through aria-describedby, never by rewriting
// aria-label: the anchor's accessible name is owned by menu_control_controller
// (it swaps per gesture mode) and the shell re-stamps every data-i18n-aria name
// on a language switch, so a rewritten label would be fought over and lost.

import { formatList, formatNumber, t } from '../../i18n';
import { chatChannelColor, chatOpenTabLabelKey } from './chat_channels';
import { CHAT_UNREAD_CHANNELS, type ChatUnreadCounts, chatUnreadDot } from './chat_unread_core';
import { whisperUnreadBadge } from './whisper_unread_core';

/** Every control that opens chat or reveals the one that does. */
export const WHISPER_UNREAD_HOST_IDS = [
  'mobile-menu-anchor',
  'mobile-menu-chat',
  'mobile-chat',
] as const;
export const WHISPER_UNREAD_BADGE_CLASS = 'whisper-unread-badge';
export const WHISPER_UNREAD_HOST_CLASS = 'has-whisper-unread';
export const WHISPER_UNREAD_DESC_ID = 'whisper-unread-desc';

const DESCRIBED_BY = 'aria-describedby';

export class WhisperUnreadBadge {
  private painted = '';
  private description: HTMLElement | null = null;
  private readonly badges = new Map<string, HTMLElement>();

  constructor(private readonly document: Document) {}

  /** Paint the unread counts; `force` repaints unchanged counts (a language
   *  switch). */
  render(counts: ChatUnreadCounts, force = false): void {
    const key = CHAT_UNREAD_CHANNELS.map((channel) => counts[channel]).join('/');
    if (!force && key === this.painted) return;
    this.painted = key;
    const { document } = this;
    const dot = chatUnreadDot(counts);
    const badge = dot === null ? null : whisperUnreadBadge(dot.total);
    if (dot === null || badge === null) {
      for (const id of WHISPER_UNREAD_HOST_IDS) {
        this.badges.get(id)?.remove();
        this.badges.delete(id);
        const host = document.getElementById(id);
        host?.classList.remove(WHISPER_UNREAD_HOST_CLASS);
        host?.removeAttribute(DESCRIBED_BY);
      }
      this.description?.remove();
      this.description = null;
      return;
    }
    const digits = { maximumFractionDigits: 0, useGrouping: false };
    const shown = formatNumber(badge.shown, digits);
    const text = badge.overflow
      ? t('hudChrome.mobile.whisperUnreadOverflow', { count: shown })
      : shown;
    if (this.description === null) {
      // `hidden` keeps it out of the layout and the reading order; a hidden
      // element still supplies an aria-describedby description.
      this.description = document.createElement('span');
      this.description.id = WHISPER_UNREAD_DESC_ID;
      this.description.hidden = true;
      document.body.append(this.description);
    }
    this.description.textContent = formatList(
      CHAT_UNREAD_CHANNELS.filter((channel) => counts[channel] > 0).map((channel) =>
        t('hudChrome.mobile.whisperUnreadDesc', {
          channel: t(chatOpenTabLabelKey(channel)),
          count: formatNumber(counts[channel], digits),
        }),
      ),
    );
    // Each channel colour has one home (chat_channels.ts); CSS reads it.
    const color = chatChannelColor(dot.lead);
    for (const id of WHISPER_UNREAD_HOST_IDS) {
      const host = document.getElementById(id);
      if (!host) continue;
      let el = this.badges.get(id);
      if (!el || el.parentElement !== host) {
        el?.remove();
        el = document.createElement('span');
        el.className = `ui-badge ui-badge--corner ${WHISPER_UNREAD_BADGE_CLASS}`;
        el.setAttribute('aria-hidden', 'true');
        host.append(el);
        this.badges.set(id, el);
      }
      el.style.setProperty('--whisper-unread-color', color);
      el.textContent = text;
      host.classList.add(WHISPER_UNREAD_HOST_CLASS);
      host.setAttribute(DESCRIBED_BY, WHISPER_UNREAD_DESC_ID);
    }
  }
}
