// The guild-signpost popup: a small centered card listing a noticeboard's
// posted notices, opened by the HUD's 'listings' noticeboard event arm and
// closed by its one button. Guild names and notes are world data spliced
// verbatim (the player-name rule); only the title and the close label
// localize. The card reuses the tutorial card family's chrome
// (styles/hud.css .tut-card + the .nb-* extensions) rather than the .window
// machinery: it is transient feedback, not a managed HUD window, so it owns
// no focus trap, no ESC arbitration, and no z-order entanglement with the
// window stack. That reasoning also decides its a11y role: role="status"
// like the coach card, announced on open and dismissable in passing, NOT a
// role="dialog" (a dialog promises focus capture, an Escape route, and a
// managed close, none of which a transient card provides; PR #3467 review,
// finding 10). If the posting system later makes this interactive, adopt
// the full markDialogRoot recipe instead of widening this.

import type { NoticeboardListing } from '../sim/types';
import { t } from './i18n';

export class NoticeboardPopup {
  private root: HTMLElement | null = null;
  private listings: readonly NoticeboardListing[] = [];

  show(listings: readonly NoticeboardListing[]): void {
    this.listings = listings;
    this.hide();
    const ui = document.getElementById('ui');
    if (!ui) return;

    const root = document.createElement('div');
    root.className = 'tut-card nb-popup';
    root.setAttribute('role', 'status');

    const title = document.createElement('div');
    title.className = 'tut-title';
    title.id = 'nb-popup-title';
    title.textContent = t('hudChrome.noticeboard.popupTitle');
    root.appendChild(title);

    const list = document.createElement('div');
    list.className = 'nb-list';
    for (const listing of listings) {
      const item = document.createElement('div');
      item.className = 'nb-item';
      const guild = document.createElement('div');
      guild.className = 'nb-guild';
      guild.textContent = listing.guild;
      const note = document.createElement('div');
      note.className = 'nb-note';
      note.textContent = listing.note;
      item.append(guild, note);
      list.appendChild(item);
    }
    root.appendChild(list);

    const close = document.createElement('button');
    close.className = 'tut-skip';
    close.type = 'button';
    close.textContent = t('hudChrome.noticeboard.close');
    close.addEventListener('click', () => this.hide());
    root.appendChild(close);

    ui.appendChild(root);
    this.root = root;
  }

  hide(): void {
    this.root?.remove();
    this.root = null;
  }

  /** Re-localize after an in-game language switch (the Hud's
   *  woc:languagechange fan-out): repaint the open card's chrome strings. */
  relocalize(): void {
    if (this.root) this.show(this.listings);
  }
}
