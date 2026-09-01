import { currentInputHintMode, registerInputHandoff } from './input_hint_mode';

export const CONTROLLER_FOCUS_CONFIRM_ATTR = 'data-pad-focus-confirm-label';
export const CONTROLLER_FOCUS_STATIC_ATTR = 'data-pad-focus-static';
export const CONTROLLER_SUBCOMMANDS_ATTR = 'data-pad-subcommands-label';

export interface ControllerFocusHintSource {
  confirmLabel(): string | null;
  subcommandsLabel(): string | null;
  gameplayAllowed(): boolean;
  virtualMouse(): boolean;
}

export interface ControllerFocusHint {
  refresh(): void;
  dispose(): void;
}

function activationControl(element: HTMLElement): boolean {
  if (element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement) return true;
  if (element instanceof HTMLInputElement) {
    return ['button', 'submit', 'reset', 'checkbox', 'radio'].includes(element.type);
  }
  const role = element.getAttribute('role');
  return role !== null && ['button', 'menuitem', 'tab', 'checkbox', 'switch'].includes(role);
}

export function createControllerFocusHint(source: ControllerFocusHintSource): ControllerFocusHint {
  let labeled: HTMLElement | null = null;
  let subcommandsFrame: HTMLElement | null = null;
  let targetFrame: HTMLElement | null = null;
  let playerFrame: HTMLElement | null = null;

  const clear = (): void => {
    labeled?.removeAttribute(CONTROLLER_FOCUS_CONFIRM_ATTR);
    labeled?.removeAttribute(CONTROLLER_FOCUS_STATIC_ATTR);
    labeled = null;
    subcommandsFrame?.removeAttribute(CONTROLLER_SUBCOMMANDS_ATTR);
    subcommandsFrame = null;
  };
  const stopHandoff = registerInputHandoff(clear);

  return {
    refresh() {
      if (currentInputHintMode() !== 'pad' || source.virtualMouse()) {
        clear();
        return;
      }
      const focused =
        labeled?.classList.contains('pad-focus') === true
          ? labeled
          : typeof document === 'undefined'
            ? null
            : document.querySelector<HTMLElement>('.pad-focus');
      const confirmLabel = source.confirmLabel();
      const confirmTarget =
        focused &&
        confirmLabel &&
        activationControl(focused) &&
        !focused.hasAttribute('data-gamepad-confirm-label') &&
        !focused.closest('.xhb')
          ? focused
          : null;
      if (labeled !== confirmTarget) {
        labeled?.removeAttribute(CONTROLLER_FOCUS_CONFIRM_ATTR);
        labeled?.removeAttribute(CONTROLLER_FOCUS_STATIC_ATTR);
        labeled = confirmTarget;
        if (labeled) {
          const position = getComputedStyle(labeled).position;
          if (!position || position === 'static') {
            labeled.setAttribute(CONTROLLER_FOCUS_STATIC_ATTR, '');
          }
        }
      }
      if (
        labeled &&
        confirmLabel &&
        labeled.getAttribute(CONTROLLER_FOCUS_CONFIRM_ATTR) !== confirmLabel
      ) {
        labeled.setAttribute(CONTROLLER_FOCUS_CONFIRM_ATTR, confirmLabel);
      }
      const subcommandsLabel = source.gameplayAllowed() ? source.subcommandsLabel() : null;
      if (!targetFrame?.isConnected) targetFrame = document.querySelector('#target-frame');
      if (!playerFrame?.isConnected) playerFrame = document.querySelector('#player-frame');
      let nextSubcommandsFrame: HTMLElement | null = null;
      if (subcommandsLabel) {
        for (const frame of [targetFrame, playerFrame]) {
          if (!frame) continue;
          if (frame.hidden || frame.style.display === 'none') continue;
          nextSubcommandsFrame = frame;
          break;
        }
      }
      if (subcommandsFrame !== nextSubcommandsFrame) {
        subcommandsFrame?.removeAttribute(CONTROLLER_SUBCOMMANDS_ATTR);
        subcommandsFrame = nextSubcommandsFrame;
      }
      if (
        subcommandsFrame &&
        subcommandsLabel &&
        subcommandsFrame.getAttribute(CONTROLLER_SUBCOMMANDS_ATTR) !== subcommandsLabel
      ) {
        subcommandsFrame.setAttribute(CONTROLLER_SUBCOMMANDS_ATTR, subcommandsLabel);
      }
    },
    dispose() {
      stopHandoff();
      clear();
    },
  };
}
