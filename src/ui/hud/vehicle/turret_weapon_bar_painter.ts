// The Fire and Fly weapon sockets: two ActionBarPainter sockets (the vehicle bar
// family) above the tower rail, or in the action ring's corner on touch. Frames come
// from TurretWeaponBarView and every write goes through the shared facet. The row
// itself is pointer-inert; each socket takes the pointer and stops its press there,
// so a tap on a socket never also reaches the ground behind it as a shot.
import { iconDataUrl } from '../../icons';
import type { PainterHostWriters } from '../../painter_host';
import { bindTouchTap } from '../../touch_tap';
import { ActionBarPainter, type ActionBarSlotElements } from '../action_bar/action_bar_painter';
import type { ActionBarState } from '../action_bar/action_bar_view';
import { TURRET_WEAPON_SLOTS } from './turret_weapon_bar_view';

export const TURRET_WEAPONS_ID = 'turret-weapons';
const ICON_SIZE = 56;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export class TurretWeaponBarPainter {
  readonly root = el('div', 'turret-weapons');
  readonly buttons: readonly HTMLButtonElement[];
  private readonly bar: ActionBarPainter;

  constructor(
    private readonly writers: PainterHostWriters,
    /** `pointer` is false for a keyboard activation (Enter or Space: click detail 0). */
    onPress: (slot: number, pointer: boolean) => void,
    attachTooltip?: (element: HTMLElement, html: () => string) => void,
    tooltip?: (slot: number) => string,
  ) {
    this.root.id = TURRET_WEAPONS_ID;
    writers.setAttr(this.root, 'role', 'group');
    const buttons: HTMLButtonElement[] = [];
    const slots: ActionBarSlotElements[] = TURRET_WEAPON_SLOTS.map((_, index) => {
      const btn = el('button', 'action-btn ui-socket turret-weapon');
      btn.type = 'button';
      const label = el('span', 'icon-label ui-socket-art');
      const countEl = el('span', 'item-count ui-socket-count');
      const keybindEl = el('span', 'keybind ui-socket-key');
      const cdOverlay = el('span', 'cd-overlay ui-socket-cd');
      const cdText = el('span', 'cdtext ui-socket-cd-text');
      const rechargeOverlay = el('span', 'recharge-overlay');
      btn.append(label, countEl, keybindEl, cdOverlay, cdText, rechargeOverlay);
      btn.addEventListener('pointerdown', (event) => event.stopPropagation());
      btn.addEventListener('click', (event) => event.stopPropagation());
      // Per finger, so a socket fires while the other thumb holds the stick or aims.
      bindTouchTap(btn, (event) =>
        onPress(index, event.type === 'pointerup' || (event as MouseEvent).detail > 0),
      );
      if (attachTooltip && tooltip) attachTooltip(btn, () => tooltip(index));
      buttons.push(btn);
      this.root.append(btn);
      return { btn, label, countEl, keybindEl, cdOverlay, cdText, rechargeOverlay };
    });
    this.buttons = buttons;
    this.bar = new ActionBarPainter(
      writers,
      { container: this.root, slots },
      (key) => `url(${iconDataUrl('ability', key, ICON_SIZE)})`,
    );
    this.show(false);
  }

  show(shown: boolean): void {
    this.writers.setDisplay(this.root, shown ? '' : 'none');
  }

  /**
   * `label` is the row's accessible name; `present` says, per slot, whether the scenario
   * gives that weapon: an absent one has no socket, and the row closes up around it.
   */
  paint(state: ActionBarState, label: string, present: readonly boolean[]): void {
    this.writers.setAttr(this.root, 'aria-label', label);
    for (let i = 0; i < this.buttons.length; i++) {
      this.writers.setDisplay(this.buttons[i], present[i] ? '' : 'none');
    }
    this.bar.paint(state);
  }
}
