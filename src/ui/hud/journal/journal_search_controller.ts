// The Adventure Journal's boss search, wired (cold, event-driven): the field at
// the top of the instance list (inside the drawer on a phone). Typing paints
// the results in place, never a window repaint, so the field keeps its caret
// and an IME composition; Up and Down move the highlighted result, Enter or a
// click opens that boss's page, Escape clears the field (and, on an empty
// field, leaves it, so the next Escape closes the window).
//
// The field is a plain <input>: the game's keybind dispatcher (src/game/input.ts)
// ignores every keydown while an input or a textarea holds the focus, so no
// game key fires while the player types here.
//
// The matching is the pure core's (journal_search_view.ts); the markup is
// journal_search_html.ts. The window owns when to repaint and hands the
// controller each freshly painted root to bind. Its DOM writes are direct on
// purpose: cold, event-driven chrome over nodes the window just painted (no
// frame band, so no PainterHost write cache to keep in step).

import {
  searchFieldHtml,
  searchOptionId,
  searchResultsHtml,
  searchStatusText,
} from './journal_search_html';
import {
  type JournalSearchPage,
  type JournalSearchResult,
  journalSearch,
  journalSearchCursor,
} from './journal_search_view';

export interface JournalSearchDeps {
  /** Every page the list may show, names in the current language. */
  pages(): readonly JournalSearchPage[];
  /** Open a boss page (the window clears the search first). */
  open(instanceId: string, bossKey: string): void;
  /** Escape on an empty field: move the focus out of it. */
  leave(): void;
}

export class JournalSearchController {
  private query = '';
  private active = -1;
  private results: JournalSearchResult[] = [];
  private caret: number | null = null;

  constructor(private readonly deps: JournalSearchDeps) {}

  /** Whether a query is narrowing the list (the list hides behind the results). */
  get searching(): boolean {
    return this.query.trim() !== '';
  }

  /** The field and its results for the window's repaint. */
  html(): string {
    // The page list is only built while there is a query to match.
    this.results = this.searching ? journalSearch(this.deps.pages(), this.query) : [];
    if (this.active >= this.results.length) this.active = this.results.length - 1;
    return searchFieldHtml(this.query, this.results, this.active);
  }

  /** Drop the query (a result was opened, or the window opens afresh). */
  clear(): void {
    this.query = '';
    this.active = -1;
    this.results = [];
  }

  /** Before a repaint: remember where the caret sits in a focused field. */
  captureCaret(root: HTMLElement): void {
    const input = root.querySelector<HTMLInputElement>('.aj-search-input');
    this.caret =
      input && input.ownerDocument.activeElement === input ? (input.selectionStart ?? null) : null;
  }

  /** After the repaint's focus restore: put the caret back. */
  restoreCaret(root: HTMLElement): void {
    const input = root.querySelector<HTMLInputElement>('.aj-search-input');
    if (this.caret === null || !input || input.ownerDocument.activeElement !== input) return;
    const at = Math.min(this.caret, input.value.length);
    input.setSelectionRange(at, at);
    this.caret = null;
  }

  /** Wire a freshly painted field. */
  bind(root: HTMLElement): void {
    const input = root.querySelector<HTMLInputElement>('.aj-search-input');
    const box = root.querySelector<HTMLElement>('[data-search-results]');
    if (!input || !box) return;
    let composing = false;
    const apply = () => {
      if (input.value === this.query) return;
      this.query = input.value;
      this.active = -1;
      this.results = this.searching ? journalSearch(this.deps.pages(), this.query) : [];
      this.paint(root, input, box);
      // One persistent live region, its words changed only with the query.
      const status = root.querySelector<HTMLElement>('[data-search-status]');
      if (status) status.textContent = searchStatusText(this.query, this.results);
    };
    input.addEventListener('compositionstart', () => {
      composing = true;
    });
    input.addEventListener('compositionend', () => {
      composing = false;
      apply();
    });
    input.addEventListener('input', (event) => {
      // Mid-composition (a CJK IME assembling a word): wait for its end.
      if (composing || (event as InputEvent).isComposing) return;
      apply();
    });
    input.addEventListener('keydown', (event) => {
      if (event.isComposing || composing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (input.value !== '') {
          input.value = '';
          apply();
        } else this.deps.leave();
        return;
      }
      if (event.key === 'Enter') {
        const pick = this.results[this.active >= 0 ? this.active : 0];
        if (!pick) return;
        event.preventDefault();
        this.openResult(pick);
        return;
      }
      const next = journalSearchCursor(this.active, event.key, this.results.length);
      if (next === null) return;
      event.preventDefault();
      this.move(input, box, next);
    });
    root.querySelector<HTMLButtonElement>('[data-search-clear]')?.addEventListener('click', () => {
      input.value = '';
      apply();
      input.focus();
    });
    box.addEventListener('click', (event) => {
      const hit = (event.target as Element | null)?.closest?.<HTMLElement>('[data-search-hit]');
      const pick = hit ? this.results[Number(hit.dataset.searchHit)] : undefined;
      if (pick) this.openResult(pick);
    });
    // A press on a result must not take the focus from the field first (the
    // click still lands): the field stays where the player was typing.
    box.addEventListener('mousedown', (event) => event.preventDefault());
  }

  private openResult(pick: JournalSearchResult): void {
    this.clear();
    this.deps.open(pick.instanceId, pick.bossKey);
  }

  /** Move the highlight without rebuilding the list: flip the two options. */
  private move(input: HTMLInputElement, box: HTMLElement, next: number): void {
    const old = box.querySelector<HTMLElement>(`#${searchOptionId(this.active)}`);
    old?.classList.remove('active');
    old?.setAttribute('aria-selected', 'false');
    this.active = next;
    const now = box.querySelector<HTMLElement>(`#${searchOptionId(next)}`);
    now?.classList.add('active');
    now?.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', searchOptionId(next));
    now?.scrollIntoView?.({ block: 'nearest' });
  }

  /** Paint the results in place and keep the field's ARIA in step. */
  private paint(root: HTMLElement, input: HTMLInputElement, box: HTMLElement): void {
    root.querySelector('.aj-nav')?.classList.toggle('aj-searching', this.searching);
    box.innerHTML = searchResultsHtml(this.query, this.results, this.active);
    const open = this.searching && this.results.length > 0;
    input.setAttribute('aria-expanded', String(open));
    if (open && this.active >= 0) {
      input.setAttribute('aria-activedescendant', searchOptionId(this.active));
    } else input.removeAttribute('aria-activedescendant');
  }
}
