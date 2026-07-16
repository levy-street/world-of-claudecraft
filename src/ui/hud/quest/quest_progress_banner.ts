// The WoW-style quest-progress banner: short yellow lines at the top-center
// ("Forest Wolf slain: 3/8") whenever a quest mob dies or a quest item lands in
// the bags. Event-driven (the sim's questProgress SimEvent, already localized
// by the Hud before it reaches here), never a per-frame path, so plain DOM
// construction is fine. Up to maxLines stack (a multi-objective loot burst
// shows every line); each line fades on its own timer and the oldest drops
// when the stack overflows. The chat log keeps the durable copy and the live
// region announces it, so the banner container is aria-hidden decoration.

// How long a line stays fully visible before its fade starts, and how long the
// CSS opacity fade runs (matches .quest-banner-line's transition duration).
export const QUEST_BANNER_LINE_MS = 3000;
export const QUEST_BANNER_FADE_MS = 400;
export const QUEST_BANNER_MAX_LINES = 3;
const LINE_CLASS = 'quest-banner-line';
const FADE_CLASS = 'fade';

export class QuestProgressBanner {
  constructor(
    private readonly el: HTMLElement,
    private readonly maxLines: number = QUEST_BANNER_MAX_LINES,
    private readonly lineMs: number = QUEST_BANNER_LINE_MS,
    private readonly fadeMs: number = QUEST_BANNER_FADE_MS,
  ) {}

  /** Push one already-localized progress line onto the stack. */
  show(text: string): void {
    const line = this.el.ownerDocument.createElement('div');
    line.className = LINE_CLASS;
    line.textContent = text;
    this.el.appendChild(line);
    // Overflow: the OLDEST line yields immediately (classic behavior: the
    // newest kill is the one you are reading).
    while (this.el.children.length > this.maxLines) this.el.firstElementChild?.remove();
    setTimeout(() => {
      line.classList.add(FADE_CLASS);
      setTimeout(() => line.remove(), this.fadeMs);
    }, this.lineMs);
  }
}
