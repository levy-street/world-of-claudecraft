import type { Ante, LootTier, PickAction, StepResult } from '../../../sim/lockpick';
import { PICK_ACTIONS } from '../../../sim/lockpick';
import type { SimEvent } from '../../../sim/types';
import type { LockpickView } from '../../../world_api';
import type { FocusTrapHandle } from '../../focus_manager';
import { t } from '../../i18n';
import { PICK_ACTION_HOTKEYS } from './lockpick_panel';
import { LockpickWindow } from './lockpick_window';

export interface LockpickControllerDeps {
  panel: HTMLElement;
  keyboardTarget: Window;
  openFocusTrap(): FocusTrapHandle;
  getState(): LockpickView | null;
  engage(objectId: number, ante: Ante): void;
  act(action: PickAction): void;
  abort(): void;
  drainEvents(): SimEvent[] | null;
  handleEvents(events: SimEvent[]): void;
  showBanner(text: string): void;
  log(text: string, color: string): void;
  hideTooltip(): void;
}

/** Owns lockpick panel state, focus, keyboard input, and authoritative command routing. */
export class LockpickController {
  private trap: FocusTrapHandle | null = null;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;
  private readonly window: LockpickWindow;

  constructor(private readonly deps: LockpickControllerDeps) {
    this.window = new LockpickWindow({
      panel: () => this.deps.panel,
      getState: () => this.deps.getState(),
      tierName: (tier) => this.tierName(tier),
      onEngage: (objectId, ante) => this.submitEngage(objectId, ante),
      onAction: (action) => this.submitAction(action),
      onAbort: () => this.submitAbort(),
      onClose: () => this.close(),
    });
  }

  openAnte(objectId: number, bountiful = false): void {
    this.openPanel();
    this.window.renderAnte(objectId, bountiful);
    this.trap?.focusFirst('.lp-ante-btn');
  }

  openBoard(): void {
    this.openPanel();
    this.window.openBoard();
  }

  onStep(result: StepResult): void {
    this.window.onStep(result);
  }

  repaintIfChanged(): void {
    this.window.repaintIfChanged();
  }

  end(outcome: 'success' | 'fail' | 'abandoned', tier?: LootTier): void {
    const summary =
      outcome === 'success'
        ? tier
          ? t('lockpickUi.summary.success', { tier: this.tierName(tier) })
          : t('lockpickUi.summary.successGeneric')
        : outcome === 'fail'
          ? t('lockpickUi.summary.fail')
          : t('lockpickUi.summary.abandoned');
    if (outcome === 'success') this.deps.showBanner(summary);
    this.deps.log(
      summary,
      outcome === 'success' ? '#7fdc4f' : outcome === 'fail' ? '#ff7a6a' : '#ccc',
    );
    this.close();
  }

  flushEvents(): void {
    const events = this.deps.drainEvents();
    if (events && events.length > 0) this.deps.handleEvents(events);
  }

  submitEngage(objectId: number, ante: Ante): void {
    this.deps.engage(objectId, ante);
    this.flushEvents();
  }

  submitAction(action: PickAction): void {
    this.deps.act(action);
    this.flushEvents();
    this.window.repaintIfChanged();
  }

  submitAbort(): void {
    this.window.stopTimer();
    this.deps.abort();
    this.flushEvents();
  }

  close(restoreFocus = true): void {
    this.deps.panel.style.display = 'none';
    this.window.close();
    this.deps.hideTooltip();
    if (this.keyHandler) {
      this.deps.keyboardTarget.removeEventListener('keydown', this.keyHandler, true);
      this.keyHandler = null;
    }
    this.trap?.release(restoreFocus);
    this.trap = null;
  }

  private openPanel(): void {
    if (this.deps.panel.style.display !== 'block') this.trap = this.deps.openFocusTrap();
    this.deps.panel.style.display = 'block';
    this.bindKeys();
  }

  private bindKeys(): void {
    if (this.keyHandler) return;
    const handler = (event: KeyboardEvent): void => {
      if (this.deps.panel.style.display !== 'block') return;
      const live = this.deps.getState();
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (live) this.submitAbort();
        else this.close();
        return;
      }
      if (!live || event.repeat) return;
      const index = (PICK_ACTION_HOTKEYS as readonly string[]).indexOf(event.key.toLowerCase());
      if (index < 0) return;
      const action = PICK_ACTIONS[index];
      if (!live.allowed.includes(action)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.submitAction(action);
    };
    this.keyHandler = handler;
    this.deps.keyboardTarget.addEventListener('keydown', handler, true);
  }

  private tierName(tier: LootTier): string {
    return t(
      tier === 'premium'
        ? 'sim.lockpick.tierPremium'
        : tier === 'medium'
          ? 'sim.lockpick.tierMedium'
          : 'sim.lockpick.tierLow',
    );
  }
}
