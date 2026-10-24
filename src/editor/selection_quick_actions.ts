// Selected-placement actions stay in the viewport while the inspector is open.
// The host owns selection validity, mutations, and undo history.
import { FOCUS_KEY_ATTR } from '../ui/focus_restore';
import { formatNumber, t } from '../ui/i18n';
import {
  applyBuildTransform,
  type BuildTransformAction,
  type BuildTransformState,
} from './build_transform_core';
import { button, el } from './dom';
import './selection_quick_actions.css';

export interface SelectionQuickActionsState {
  label: string;
  count: number;
  transform: BuildTransformState;
  fineRotation: boolean;
}

export interface SelectionQuickActionsDeps {
  getState(): SelectionQuickActionsState | null;
  onMove(): void;
  onFrame(): void;
  onDuplicate(): void;
  onRemove(): void;
  onTransform(next: BuildTransformState): void;
}

const LOCAL_EVENTS = [
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'click',
  'dblclick',
  'contextmenu',
  'wheel',
  'keydown',
  'keyup',
] as const;

export class SelectionQuickActions {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly controls: HTMLButtonElement[] = [];
  private readonly transformControls = new Map<BuildTransformAction, HTMLButtonElement>();
  private disposed = false;
  // Keep native button activation, focus, scrolling, and Tab navigation intact.
  private readonly stopEvent = (event: Event): void => event.stopPropagation();

  constructor(private readonly deps: SelectionQuickActionsDeps) {
    this.root = el('section', 'ed-selection-quick-actions');
    this.root.setAttribute('aria-label', t('editor.quickActions.title'));
    const heading = el('div', 'ed-selection-quick-heading');
    this.title = el('strong', 'ed-selection-quick-title');
    this.title.setAttribute('aria-live', 'polite');
    this.readout = el('span', 'ed-selection-quick-readout');
    heading.append(this.title, this.readout);

    const actions = el('div', 'ed-selection-quick-row');
    actions.append(
      this.actionButton('move', t('editor.quickActions.move'), () => this.deps.onMove()),
      this.actionButton('frame', t('editor.quickActions.frame'), () => this.deps.onFrame()),
      this.actionButton('duplicate', t('editor.selection.duplicate'), () =>
        this.deps.onDuplicate(),
      ),
      this.actionButton('remove', t('editor.quickActions.remove'), () => this.deps.onRemove()),
    );
    const transforms = el('div', 'ed-selection-quick-row');
    transforms.append(
      this.transformButton('rotateLeft', t('editor.buildMode.rotateLeft')),
      this.transformButton('rotateRight', t('editor.buildMode.rotateRight')),
      this.transformButton('smaller', t('editor.buildMode.smaller')),
      this.transformButton('larger', t('editor.buildMode.larger')),
    );
    this.root.append(heading, actions, transforms);
    for (const type of LOCAL_EVENTS) this.root.addEventListener(type, this.stopEvent);
    this.refresh();
  }

  private state(): SelectionQuickActionsState | null {
    return this.disposed ? null : this.deps.getState();
  }

  private actionButton(action: string, label: string, run: () => void): HTMLButtonElement {
    const control = button(label, () => {
      // Recheck the live selection even if it changed before the next refresh.
      if (!this.state()) {
        this.refresh();
        return;
      }
      run();
      this.refresh();
    });
    control.dataset.action = action;
    control.setAttribute(FOCUS_KEY_ATTR, `selection-quick:${action}`);
    this.controls.push(control);
    return control;
  }

  private transformButton(action: BuildTransformAction, label: string): HTMLButtonElement {
    const control = this.actionButton(action, label, () => {
      const state = this.state();
      if (!state) return;
      const next = applyBuildTransform(state.transform, action, state.fineRotation);
      if (next.rotY !== state.transform.rotY || next.scale !== state.transform.scale) {
        this.deps.onTransform(next);
      }
    });
    this.transformControls.set(action, control);
    return control;
  }

  refresh(): void {
    const state = this.state();
    this.root.hidden = !state;
    for (const control of this.controls) control.disabled = !state;
    if (!state) {
      this.title.textContent = '';
      this.readout.textContent = '';
      return;
    }
    this.title.textContent =
      state.count > 1
        ? t('editor.quickActions.count', { count: formatNumber(state.count) })
        : state.label;
    this.readout.textContent = t('editor.buildMode.transformReadout', {
      degrees: formatNumber((state.transform.rotY * 180) / Math.PI, {
        maximumFractionDigits: 1,
      }),
      scale: formatNumber(state.transform.scale, { maximumFractionDigits: 2 }),
    });
    for (const [action, control] of this.transformControls) {
      const next = applyBuildTransform(state.transform, action, state.fineRotation);
      control.disabled = next.rotY === state.transform.rotY && next.scale === state.transform.scale;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.refresh();
    for (const type of LOCAL_EVENTS) this.root.removeEventListener(type, this.stopEvent);
    this.root.remove();
  }
}
