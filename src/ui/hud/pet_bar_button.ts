// One pet-bar button (#petbar): the socket, its icon and cooldown text, the
// click / Shift+Enter / right-click / touch-hold arms, and, for a command the
// action bar can hold, the drag that copies it onto an action-bar slot.
// Extracted from Hud.renderPetBar, which still decides WHICH buttons exist and
// what each one does; this module only builds and wires one of them.

import { FOCUS_KEY_ATTR } from '../focus_restore';
import { t, tPlural } from '../i18n';
import { iconDataUrl } from '../icons';
import type { HotbarAction } from './action_bar/hotbar';

/** How long a touch press must hold before it toggles autocast instead. */
export const PET_AUTOCAST_TOUCH_HOLD_MS = 2000;

export interface PetBarButtonOptions {
  active?: boolean;
  autocast?: boolean;
  cooldownText?: string;
  onContextMenu?: () => void;
  onTouchHold?: () => void;
  focusKey?: string;
  // Kept visible (never hidden) but greyed and inert while set. The
  // accessible name (`title`, which also feeds aria-label) STAYS the
  // action name; the WHY is carried by the rich hover tooltip
  // (`tooltip`), so a screen reader still announces the action, not the
  // disabled reason.
  disabled?: boolean;
  // The action-bar binding a drag of this button carries (a pet command).
  // Absent for the buttons the action bar cannot hold.
  dragAction?: Exclude<HotbarAction, null>;
}

/** What the button needs from the Hud: the shared tooltip and touch-peek
 *  plumbing, the click sound, and the action bar's drag hand-off. */
export interface PetBarButtonDeps {
  click(): void;
  consumePeek(): boolean;
  hideTooltip(): void;
  attachTooltip(el: HTMLElement, html: () => string): void;
  /** Start an action-bar drag of `action`; false when the bars are locked. */
  beginDrag(action: Exclude<HotbarAction, null>, dt: DataTransfer | null): boolean;
  endDrag(): void;
}

/** addPetBarButton's arguments after its deps, for the Hud's bound helper. */
export type PetBarButtonArgs = [
  parent: HTMLElement,
  iconId: string,
  title: string,
  tooltip: string,
  onClick: () => void,
  opts?: PetBarButtonOptions,
];

export function addPetBarButton(
  deps: PetBarButtonDeps,
  parent: HTMLElement,
  iconId: string,
  title: string,
  tooltip: string,
  onClick: () => void,
  opts: PetBarButtonOptions = {},
): void {
  const btn = document.createElement('button');
  btn.className = 'pet-btn ui-socket';
  // Through the shared namespace: renderPetBar's restore finds the rebuilt button by it.
  btn.setAttribute(FOCUS_KEY_ATTR, opts.focusKey ?? iconId);
  if (opts.active) btn.classList.add('active', 'is-on');
  if (opts.autocast) btn.classList.add('autocast');
  if (opts.cooldownText) btn.classList.add('cooldown');
  if (opts.disabled) btn.classList.add('disabled');
  btn.setAttribute(
    'aria-label',
    opts.cooldownText
      ? `${title}, ${tPlural('hudChrome.plurals.secondsRemaining', Number(opts.cooldownText))}`
      : title,
  );
  if (opts.disabled) btn.setAttribute('aria-disabled', 'true');
  if (opts.active) btn.setAttribute('aria-pressed', 'true');
  if (opts.onContextMenu) {
    // Primary activation casts the skill; it does not toggle autocast. Do
    // not expose this as aria-pressed (which promises the opposite button
    // contract). Announce the secondary mode as descriptive state instead.
    btn.setAttribute(
      'aria-description',
      t(opts.autocast ? 'hud.pet.autocastOn' : 'hud.pet.autocastOff'),
    );
    btn.setAttribute('aria-keyshortcuts', 'Shift+Enter');
  }
  const icon = document.createElement('span');
  icon.className = 'icon-label ui-socket-art';
  icon.style.backgroundImage = `url(${iconDataUrl('ability', iconId)})`;
  btn.appendChild(icon);
  if (opts.cooldownText) {
    const cdText = document.createElement('span');
    cdText.className = 'cdtext ui-socket-cd-text';
    cdText.textContent = opts.cooldownText;
    btn.appendChild(cdText);
  }
  const dragAction = opts.dragAction;
  if (dragAction) {
    // A copy, not a move: the pet bar keeps its button. A cooldown or
    // disabled state does not block the drag, only the press.
    btn.draggable = true;
    btn.addEventListener('dragstart', (e) => {
      if (!deps.beginDrag(dragAction, e.dataTransfer)) {
        e.preventDefault();
        return;
      }
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
      deps.hideTooltip();
    });
    btn.addEventListener('dragend', () => deps.endDrag());
  }
  let suppressNextClick = false;
  let touchHoldTimer: number | undefined;
  let touchHoldPointerId: number | null = null;
  let touchHoldStartX = 0;
  let touchHoldStartY = 0;
  let touchHoldTriggered = false;
  let touchHoldCanceled = false;
  const clearTouchHoldTimer = () => {
    if (touchHoldTimer !== undefined) window.clearTimeout(touchHoldTimer);
    touchHoldTimer = undefined;
  };
  const runClickAction = () => {
    if (opts.cooldownText || opts.disabled) return;
    deps.click();
    onClick();
  };
  btn.addEventListener('click', () => {
    if (suppressNextClick) {
      suppressNextClick = false;
      deps.consumePeek();
      deps.hideTooltip();
      btn.blur();
      return;
    }
    if (deps.consumePeek()) {
      deps.hideTooltip();
      btn.blur();
      return;
    }
    runClickAction();
  });
  if (opts.onContextMenu) {
    btn.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || !event.shiftKey || event.repeat || opts.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      deps.click();
      opts.onContextMenu?.();
    });
    btn.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (document.body.classList.contains('mobile-touch')) return;
      if (opts.disabled) return; // an inert button fires no secondary action
      deps.click();
      opts.onContextMenu?.();
    });
  }
  if (opts.onTouchHold) {
    btn.addEventListener('pointerdown', (event) => {
      if (!document.body.classList.contains('mobile-touch') || event.pointerType !== 'touch') {
        return;
      }
      if (opts.disabled) return; // an inert button fires no long-press action
      event.preventDefault();
      clearTouchHoldTimer();
      suppressNextClick = false;
      touchHoldTriggered = false;
      touchHoldCanceled = false;
      touchHoldPointerId = event.pointerId;
      touchHoldStartX = event.clientX;
      touchHoldStartY = event.clientY;
      try {
        btn.setPointerCapture?.(event.pointerId);
      } catch {
        /* pointer already released */
      }
      touchHoldTimer = window.setTimeout(() => {
        if (touchHoldPointerId !== event.pointerId || touchHoldCanceled) return;
        touchHoldTriggered = true;
        suppressNextClick = true;
        deps.click();
        opts.onTouchHold?.();
        deps.hideTooltip();
        deps.consumePeek();
        btn.blur();
      }, PET_AUTOCAST_TOUCH_HOLD_MS);
    });
    btn.addEventListener('pointermove', (event) => {
      if (touchHoldPointerId !== event.pointerId) return;
      const moved = Math.hypot(event.clientX - touchHoldStartX, event.clientY - touchHoldStartY);
      if (moved > 9) {
        touchHoldCanceled = true;
        clearTouchHoldTimer();
      }
    });
    const finishTouchHold = (event: PointerEvent, canceled: boolean) => {
      if (touchHoldPointerId !== event.pointerId) return;
      event.preventDefault();
      const triggered = touchHoldTriggered;
      const movedAway = touchHoldCanceled || canceled;
      clearTouchHoldTimer();
      touchHoldPointerId = null;
      touchHoldTriggered = false;
      touchHoldCanceled = false;
      suppressNextClick = true;
      if (triggered || movedAway) {
        deps.consumePeek();
        return;
      }
      if (deps.consumePeek()) {
        deps.hideTooltip();
        btn.blur();
        return;
      }
      runClickAction();
      btn.blur();
    };
    btn.addEventListener('pointerup', (event) => finishTouchHold(event, false));
    btn.addEventListener('pointercancel', (event) => finishTouchHold(event, true));
  }
  deps.attachTooltip(btn, () => tooltip);
  parent.appendChild(btn);
}
