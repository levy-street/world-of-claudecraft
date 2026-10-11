// The WoW-style quest-progress banner: short yellow lines at the top-center
// ("Forest Wolf slain: 3/8") whenever a quest mob dies or a quest item lands in
// the bags. Event-driven (the sim's questProgress SimEvent, already localized
// by the Hud before it reaches here), never a per-frame path, so plain DOM
// construction is fine. Up to maxLines stack (a multi-objective loot burst
// shows every line); each line fades on its own timer and the oldest drops
// when the stack overflows. The chat log keeps the durable copy and the live
// region announces it, so the banner container is aria-hidden decoration.
//
// The lane also YIELDS to the world quest entry plate (#banner.banner-world-quest),
// which sits in the same top-centre band: `yieldToPlate` holds every line on
// screen and every line that arrives while the plate is up, then shows them in
// order once it has faded, so the two can never overlap on any viewport and no
// line is lost.

// How long a line stays fully visible before its fade starts, and how long the
// CSS opacity fade runs (matches .quest-banner-line's transition duration).
export const QUEST_BANNER_LINE_MS = 3000;
export const QUEST_BANNER_FADE_MS = 400;
export const QUEST_BANNER_MAX_LINES = 3;
/** The #banner slot's opacity fade (hud.css `#banner` transition): the plate
 *  still paints for this long after its hold ends. */
export const BANNER_PLATE_FADE_MS = 1200;
const LINE_CLASS = 'quest-banner-line ui-cin';
const FADE_CLASS = 'fade';

export class QuestProgressBanner {
  constructor(
    private readonly el: HTMLElement,
    private readonly maxLines: number = QUEST_BANNER_MAX_LINES,
    private readonly lineMs: number = QUEST_BANNER_LINE_MS,
    private readonly fadeMs: number = QUEST_BANNER_FADE_MS,
  ) {}

  /** Lines waiting out a plate, oldest first, and the hold's release timer. */
  private readonly held: string[] = [];
  private holdTimer: ReturnType<typeof setTimeout> | undefined;

  /** Clear the lane while a plate holds the top-centre band for `plateMs` (then
   *  fades): lines on screen step aside and, with any that arrive meanwhile,
   *  show again in order once the plate is gone. A line already fading out is
   *  simply let go. A second call extends the hold. */
  yieldToPlate(plateMs: number): void {
    for (const line of Array.from(this.el.children)) {
      if (!line.classList.contains(FADE_CLASS)) this.held.push(line.textContent ?? '');
      line.remove();
    }
    clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => {
      this.holdTimer = undefined;
      for (const text of this.held.splice(0)) this.show(text);
    }, plateMs + BANNER_PLATE_FADE_MS);
  }

  /** Push one already-localized progress line onto the stack. */
  show(text: string): void {
    if (this.holdTimer !== undefined) {
      this.held.push(text);
      return;
    }
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
