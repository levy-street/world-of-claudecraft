/** The shared red error surface. Chat logging and announcements stay with the caller. */
export class ErrorToastController {
  private timer: number | undefined;

  constructor(private readonly el: HTMLElement) {}

  show(text: string, durationMs = 1600, heldLoot = false): void {
    this.el.classList.toggle('held-loot-warning', heldLoot);
    this.el.textContent = text;
    this.el.style.opacity = '1';
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.el.style.opacity = '0';
    }, durationMs);
  }
}
