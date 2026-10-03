// The Graveyard Shift bar: while the player holds the Morthen identity, five
// slots (Attack plus the kit) stand in for the action, stance and pet bars, which
// the morthen-shift body class hides. Same family as the cloak bar: the pure view
// core (morthen_action_bar_view.ts) painted through the PainterHost writers, the
// slots dispatched through game/morthen_controls.ts. The real action bar is never
// touched (the sim also holds it read-only while the identity lasts).

import {
  type MorthenControlWorld,
  morthenChooseSlot,
  morthenControlsActive,
} from '../../../game/morthen_controls';
import { playerSpellHasteFrac } from '../../ability_tooltip_lines';
import { t } from '../../i18n';
import { iconDataUrl } from '../../icons';
import type { PainterHostWriters } from '../../painter_host';
import { ActionBarPainter, type ActionBarSlotElements } from '../action_bar/action_bar_painter';
import {
  createMorthenActionBarView,
  MORTHEN_BAR_SLOTS,
  morthenSlotTooltipHtml,
} from './morthen_action_bar_view';

export const MORTHEN_SHIFT_BODY_CLASS = 'morthen-shift';

export class MorthenActionBarController {
  private readonly root = document.createElement('section');
  private readonly title = document.createElement('div');
  private readonly view = createMorthenActionBarView();
  private readonly painter: ActionBarPainter;
  private active = false;
  constructor(
    private readonly world: MorthenControlWorld,
    private readonly writers: PainterHostWriters,
    private readonly keyLabel: (slot: number) => string,
    private readonly cancelOnEnter: readonly { cancel(): void }[],
    attachTooltip: (element: HTMLElement, html: () => string) => void,
    consumePeek: () => boolean,
  ) {
    this.root.id = 'morthen-action-bar';
    this.root.className = 'vehicle-bar morthen-action-bar';
    this.title.className = 'vehicle-bar-title';
    const bar = document.createElement('div');
    bar.className = 'vehicle-action-slots';
    const slots: ActionBarSlotElements[] = MORTHEN_BAR_SLOTS.map((_, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'action-btn vehicle-action ui-socket';
      const label = document.createElement('span'),
        countEl = document.createElement('span'),
        keybindEl = document.createElement('span'),
        cdOverlay = document.createElement('span'),
        cdText = document.createElement('span'),
        rechargeOverlay = document.createElement('span');
      label.className = 'icon-label ui-socket-art';
      countEl.className = 'item-count ui-socket-count';
      keybindEl.className = 'keybind ui-socket-key';
      cdOverlay.className = 'cd-overlay ui-socket-cd';
      cdText.className = 'cdtext ui-socket-cd-text';
      rechargeOverlay.className = 'recharge-overlay';
      btn.append(label, countEl, keybindEl, cdOverlay, cdText, rechargeOverlay);
      btn.addEventListener('click', () => {
        if (!consumePeek()) this.chooseSlot(index);
      });
      attachTooltip(btn, () => morthenSlotTooltipHtml(index, playerSpellHasteFrac(world.player)));
      bar.append(btn);
      return { btn, label, countEl, keybindEl, cdOverlay, cdText, rechargeOverlay };
    });
    this.painter = new ActionBarPainter(
      writers,
      { container: bar, slots },
      (key) => `url(${iconDataUrl('ability', key, 56)})`,
    );
    this.root.append(this.title, bar);
    writers.setDisplay(this.root, 'none');
    document.getElementById('ui')?.append(this.root);
  }

  chooseSlot(slot: number): void {
    morthenChooseSlot(this.world, slot);
  }

  update(): void {
    const active = morthenControlsActive(this.world);
    if (active !== this.active) {
      this.active = active;
      if (active) for (const controller of this.cancelOnEnter) controller.cancel();
      this.writers.toggleClass(document.body, MORTHEN_SHIFT_BODY_CLASS, active);
      this.writers.setDisplay(this.root, active ? 'grid' : 'none');
    }
    if (!active) return;
    const player = this.world.player;
    const target =
      player.targetId === null ? null : (this.world.entities.get(player.targetId) ?? null);
    this.writers.setText(this.title, t('devCommand.graveyardShift.identityAura'));
    this.painter.paint(this.view.tick(player, target, this.keyLabel));
  }
}
