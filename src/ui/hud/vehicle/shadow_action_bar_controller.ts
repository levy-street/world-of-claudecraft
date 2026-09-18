import { type GamepadKind, GP, gamepadButtonLabel } from '../../../game/gamepad_map';
import { currentInputHintMode } from '../../../game/input_hint_mode';
import {
  type ShadowControlWorld,
  shadowChooseSlot,
  shadowControlsActive,
} from '../../../game/shadow_controls';
import { SHADOW_QUEST_ID } from '../../../sim/content/world_quest_shadow';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import { iconDataUrl } from '../../icons';
import type { PainterHostWriters } from '../../painter_host';
import { createShadowActionBarView, shadowActionHint } from '../../world_quest_shadow_view';
import { ActionBarPainter, type ActionBarSlotElements } from '../action_bar/action_bar_painter';

export class ShadowActionBarController {
  private readonly root = document.createElement('section');
  private readonly title = document.createElement('div');
  private readonly status = document.createElement('div');
  private readonly gauge = document.createElement('div');
  private readonly fill = document.createElement('div');
  private readonly suspicionLabel = document.createElement('span');
  private readonly hint = document.createElement('div');
  private readonly view = createShadowActionBarView();
  private readonly painter: ActionBarPainter;
  private active = false;
  constructor(
    private readonly world: ShadowControlWorld,
    private readonly writers: PainterHostWriters,
    private readonly keyLabel: (slot: number) => string,
    private readonly cancelOnEnter: readonly { cancel(): void }[],
    attachTooltip: (element: HTMLElement, html: () => string) => void,
    consumePeek: () => boolean,
    private readonly padKind: () => GamepadKind = () => 'generic',
  ) {
    this.root.id = 'shadow-action-bar';
    this.root.className = 'vehicle-bar shadow-action-bar';
    this.title.className = 'vehicle-bar-title';
    this.status.className = 'vehicle-bar-status';
    this.hint.className = 'vehicle-bar-hint';
    this.gauge.className = 'vehicle-integrity';
    this.fill.className = 'vehicle-integrity-fill';
    this.suspicionLabel.className = 'vehicle-integrity-text';
    this.gauge.append(this.fill, this.suspicionLabel);
    writers.setAttr(this.status, 'role', 'status');
    writers.setAttr(this.gauge, 'role', 'meter');
    writers.setAttr(this.gauge, 'aria-valuemin', '0');
    writers.setAttr(this.gauge, 'aria-valuemax', '100');
    const bar = document.createElement('div');
    bar.className = 'vehicle-action-slots';
    const slots: ActionBarSlotElements[] = [0, 1].map((index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'action-btn vehicle-action';
      const label = document.createElement('span'),
        countEl = document.createElement('span'),
        keybindEl = document.createElement('span'),
        cdOverlay = document.createElement('span'),
        cdText = document.createElement('span'),
        rechargeOverlay = document.createElement('span');
      label.className = 'icon-label';
      keybindEl.className = 'keybind';
      cdOverlay.className = 'cd-overlay';
      cdText.className = 'cdtext';
      rechargeOverlay.className = 'recharge-overlay';
      btn.append(label, countEl, keybindEl, cdOverlay, cdText, rechargeOverlay);
      btn.addEventListener('click', () => {
        if (!consumePeek()) shadowChooseSlot(world, index);
      });
      attachTooltip(btn, () =>
        esc(
          t(
            index === 0
              ? 'questUi.worldQuest.shadow.stealTip'
              : 'questUi.worldQuest.shadow.leaveTip',
          ),
        ),
      );
      bar.append(btn);
      return { btn, label, countEl, keybindEl, cdOverlay, cdText, rechargeOverlay };
    });
    this.painter = new ActionBarPainter(
      writers,
      { container: bar, slots },
      (key) => `url(${iconDataUrl('ability', key, 56)})`,
    );
    this.root.append(this.title, this.status, this.gauge, bar, this.hint);
    writers.setDisplay(this.root, 'none');
    document.getElementById('ui')?.append(this.root);
  }
  update(): void {
    const active = !this.world.player.dead && shadowControlsActive(this.world);
    if (active !== this.active) {
      this.active = active;
      if (active) for (const controller of this.cancelOnEnter) controller.cancel();
      this.writers.toggleClass(document.body, 'wearing-shadow-cloak', active);
      this.writers.setDisplay(this.root, active ? 'grid' : 'none');
    }
    if (!active) return;
    const progress = this.world.worldQuestLog.get(SHADOW_QUEST_ID);
    const shadow = progress?.shadow;
    if (!shadow || !progress) return;
    this.writers.setText(this.title, t('questUi.worldQuest.shadow.cloak'));
    this.writers.setText(
      this.status,
      t('questUi.worldQuest.shadow.documents', { count: formatNumber(progress.count) }),
    );
    this.writers.setAttr(
      this.gauge,
      'aria-label',
      t('questUi.worldQuest.shadow.suspicion', {
        value: formatNumber(shadow.suspicion, { style: 'percent' }),
      }),
    );
    this.writers.setText(
      this.suspicionLabel,
      t('questUi.worldQuest.shadow.suspicion', {
        value: formatNumber(shadow.suspicion, { style: 'percent' }),
      }),
    );
    this.writers.setAttr(this.gauge, 'aria-valuenow', String(Math.round(shadow.suspicion * 100)));
    this.writers.setStyleProp(this.fill, '--vehicle-integrity', String(shadow.suspicion));
    this.writers.toggleClass(this.gauge, 'low-integrity', shadow.suspicion > 0);
    this.writers.setText(this.hint, shadowActionHint(this.world));
    this.painter.paint(
      this.view.tick(this.world, (slot) =>
        currentInputHintMode() === 'touch'
          ? ''
          : currentInputHintMode() === 'pad'
            ? gamepadButtonLabel(slot === 0 ? GP.X : GP.Y, this.padKind())
            : this.keyLabel(slot),
      ),
    );
  }
}
