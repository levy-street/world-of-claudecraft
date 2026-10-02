// Paints the Fire and Fly hit feedback (turret_hit_feedback_core.ts) onto the edge
// overlay and the tower rail's bar wrapper the seat HUD hands it (the bevel inside
// clips, so the glow lands on the wrapper): the flash, the glow and the swing, as CSS
// variables the stylesheet turns into the look. Every write goes through the shared
// facet, and nothing is written between strikes.
import type { PainterHostWriters } from '../../painter_host';
import type { TurretHitFrame } from './turret_hit_feedback_core';

export class TurretHitFlashPainter {
  private shown = false;

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly overlay: HTMLElement,
    private readonly bar: HTMLElement,
  ) {}

  paint(frame: TurretHitFrame): void {
    if (!frame.active && !this.shown) return;
    const writers = this.writers;
    this.shown = frame.active;
    writers.setDisplay(this.overlay, frame.active ? '' : 'none');
    writers.setStyleProp(this.overlay, '--turret-hit-flash', frame.flash.toFixed(3));
    writers.setStyleProp(this.bar, '--turret-hit-glow', frame.glow.toFixed(3));
    writers.setStyleProp(this.bar, '--turret-hit-shake', frame.shake.toFixed(3));
  }
}
