import type { PainterHostWriters } from '../../painter_host';
import type { DoomMeterState } from './doom_meter_view';

export class DoomMeterPainter {
  constructor(
    private readonly writers: PainterHostWriters,
    private readonly frame: HTMLElement,
    private readonly root: HTMLElement,
    private readonly fill: HTMLElement,
    private readonly label: HTMLElement,
    private readonly fateThreadsRoot: HTMLElement,
    private readonly fateThreadPips: readonly HTMLElement[],
  ) {}

  paint(state: DoomMeterState): void {
    this.writers.setDisplay(this.frame, state.visible ? 'flex' : 'none');
    this.writers.setStyleProp(this.fill, '--doom-scale', state.fillFrac.toFixed(3));
    this.writers.setText(this.label, state.label);
    this.writers.setAttr(this.root, 'aria-valuenow', String(state.value));
    this.writers.setAttr(this.root, 'aria-valuetext', state.ariaValueText);
    this.writers.toggleClass(this.root, 'warning', state.warning);
    this.writers.toggleClass(this.root, 'ready', state.ready);
    this.writers.setAttr(this.fateThreadsRoot, 'aria-valuenow', String(state.fateThreads));
    this.writers.setAttr(this.fateThreadsRoot, 'aria-valuetext', state.fateThreadsAriaValueText);
    this.writers.toggleClass(this.fateThreadsRoot, 'ready', state.fateThreadsReady);
    for (let i = 0; i < this.fateThreadPips.length; i++) {
      this.writers.toggleClass(this.fateThreadPips[i], 'on', i < state.fateThreads);
    }
  }

  hide(): void {
    this.writers.setDisplay(this.frame, 'none');
  }
}
