// The WoW-style raid warning banner: large vibrant-orange lines in the upper center
// of the screen whenever a raid warning (/rw, /ab) is issued.
// Stacks with the newest line on top ("el segundo se pone encima del primero"),
// with each line fading out on its own timer.

export const RAID_WARNING_LINE_MS = 3500;
export const RAID_WARNING_FADE_MS = 400;
export const RAID_WARNING_MAX_LINES = 3;
const LINE_CLASS = 'raid-warning-line';
const FADE_CLASS = 'fade';

export class RaidWarningBanner {
  constructor(
    private readonly el: HTMLElement,
    private readonly maxLines: number = RAID_WARNING_MAX_LINES,
    private readonly lineMs: number = RAID_WARNING_LINE_MS,
    private readonly fadeMs: number = RAID_WARNING_FADE_MS,
  ) {}

  /** Push one raid warning message onto the top of the stack. */
  show(text: string): void {
    const line = this.el.ownerDocument.createElement('div');
    line.className = LINE_CLASS;
    line.textContent = text;
    this.el.prepend(line);
    // Overflow: the OLDEST line yields immediately (oldest is at the tail).
    while (this.el.children.length > this.maxLines) this.el.lastElementChild?.remove();
    setTimeout(() => {
      line.classList.add(FADE_CLASS);
      setTimeout(() => line.remove(), this.fadeMs);
    }, this.lineMs);
  }
}
