import type { RiteIntensity } from '../../../sim/types';
import type { FocusTrapHandle } from '../../focus_manager';
import { RiteWindow } from './rite_window';

export interface RiteControllerDeps {
  panel: HTMLElement;
  openFocusTrap(): FocusTrapHandle;
  choose(intensity: RiteIntensity): void;
}

/** Owns the Drowned Reliquary rite chooser, its focus lifetime, and command routing. */
export class RiteController {
  private trap: FocusTrapHandle | null = null;
  private readonly window: RiteWindow;

  constructor(private readonly deps: RiteControllerDeps) {
    this.window = new RiteWindow({
      panel: () => this.deps.panel,
      onChoose: (intensity) => this.choose(intensity),
      onClose: () => this.close(),
    });
  }

  open(): void {
    if (this.deps.panel.style.display !== 'block') this.trap = this.deps.openFocusTrap();
    this.deps.panel.style.display = 'block';
    this.window.render();
    this.trap?.focusFirst('.lp-ante-btn');
  }

  close(restoreFocus = true): void {
    if (this.deps.panel.style.display === 'none') return;
    this.deps.panel.style.display = 'none';
    this.trap?.release(restoreFocus);
    this.trap = null;
  }

  private choose(intensity: RiteIntensity): void {
    this.deps.choose(intensity);
    this.close();
  }
}
