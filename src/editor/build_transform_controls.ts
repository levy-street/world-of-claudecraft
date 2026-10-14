// Small reusable control strip for an armed asset or the current placement.
// The coordinator routes keyboard events only while its build tools are active.
import { FOCUS_KEY_ATTR } from '../ui/focus_restore';
import { formatNumber, t } from '../ui/i18n';
import {
  applyBuildTransform,
  type BuildTransformAction,
  type BuildTransformState,
  buildTransformActionForKey,
} from './build_transform_core';
import { button, checkbox, el } from './dom';
import './build_transform_controls.css';

export interface BuildTransformControlsState {
  transform: BuildTransformState | null;
  fineRotation: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export interface BuildTransformControlsDeps {
  getState(): BuildTransformControlsState;
  onTransform(next: BuildTransformState, action: BuildTransformAction): void;
  onFineRotationChange(on: boolean): void;
  onUndo(): void;
  onRedo(): void;
}

export class BuildTransformControls {
  readonly root: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly fineRotation: HTMLInputElement;
  private readonly transformButtons: HTMLButtonElement[] = [];
  private readonly undo: HTMLButtonElement;
  private readonly redo: HTMLButtonElement;

  constructor(private readonly deps: BuildTransformControlsDeps) {
    this.root = el('section', 'ed-build-transform');
    this.root.setAttribute('aria-label', t('editor.buildMode.transformControls'));
    const history = el('div', 'ed-build-transform-row');
    this.undo = button(t('editor.buildMode.undo'), () => {
      if (!this.deps.getState().canUndo) return;
      this.deps.onUndo();
      this.refresh();
    });
    this.redo = button(t('editor.buildMode.redo'), () => {
      if (!this.deps.getState().canRedo) return;
      this.deps.onRedo();
      this.refresh();
    });
    this.undo.setAttribute(FOCUS_KEY_ATTR, 'transform:undo');
    this.redo.setAttribute(FOCUS_KEY_ATTR, 'transform:redo');
    history.append(this.undo, this.redo);

    const rotate = el('div', 'ed-build-transform-row');
    rotate.append(
      this.transformButton('rotateLeft', t('editor.buildMode.rotateLeft'), ','),
      this.transformButton('rotateRight', t('editor.buildMode.rotateRight'), '.'),
    );
    const resize = el('div', 'ed-build-transform-row');
    resize.append(
      this.transformButton('smaller', t('editor.buildMode.smaller'), '['),
      this.transformButton('larger', t('editor.buildMode.larger'), ']'),
    );
    const fine = checkbox(t('editor.buildMode.fineRotation'), false, (on) => {
      this.deps.onFineRotationChange(on);
      this.refresh();
    });
    this.fineRotation = fine.input;
    this.fineRotation.setAttribute(FOCUS_KEY_ATTR, 'transform:fineRotation');
    this.readout = el('p', 'ed-build-transform-readout');
    this.readout.setAttribute('aria-live', 'polite');
    this.root.append(
      history,
      rotate,
      resize,
      fine.root,
      this.readout,
      el('p', 'ed-build-transform-hint', t('editor.buildMode.transformShortcuts')),
    );
    this.refresh();
  }

  private transformButton(
    action: BuildTransformAction,
    label: string,
    shortcut: string,
  ): HTMLButtonElement {
    const control = button(label, () => this.apply(action));
    control.setAttribute(FOCUS_KEY_ATTR, `transform:${action}`);
    control.setAttribute('aria-keyshortcuts', shortcut);
    this.transformButtons.push(control);
    return control;
  }

  private apply(action: BuildTransformAction): boolean {
    const { transform, fineRotation } = this.deps.getState();
    if (!transform) return false;
    const next = applyBuildTransform(transform, action, fineRotation);
    // A press at the scale limit must not create an empty undo entry.
    if (next.rotY !== transform.rotY || next.scale !== transform.scale) {
      this.deps.onTransform(next, action);
    }
    this.refresh();
    return true;
  }

  refresh(): void {
    const state = this.deps.getState();
    this.undo.disabled = !state.canUndo;
    this.redo.disabled = !state.canRedo;
    this.fineRotation.checked = state.fineRotation;
    for (const control of this.transformButtons) control.disabled = !state.transform;
    this.readout.textContent = state.transform
      ? t('editor.buildMode.transformReadout', {
          degrees: formatNumber((state.transform.rotY * 180) / Math.PI, {
            maximumFractionDigits: 1,
          }),
          scale: formatNumber(state.transform.scale, { maximumFractionDigits: 2 }),
        })
      : t('editor.buildMode.transformEmpty');
  }

  /** Returns true only when this control consumed the event. No global listener. */
  handleKeydown(event: KeyboardEvent): boolean {
    const target = event.target instanceof Element ? event.target : null;
    const typing = Boolean(
      target?.closest('input, textarea, select, [contenteditable], [role="textbox"]'),
    );
    const action = buildTransformActionForKey({
      key: event.key,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      isComposing: event.isComposing,
      defaultPrevented: event.defaultPrevented,
      typing,
    });
    if (!action || !this.apply(action)) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
}
