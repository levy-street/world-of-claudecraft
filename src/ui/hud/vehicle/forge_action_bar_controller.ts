// The forge workshop bar: a timing meter, a heat gauge and two slots
// (Strike / Stoke). Same family as the cloak bar: a pure view-core
// (world_quest_forge_view.ts) painted through the PainterHost writers, the
// slots dispatched through game/forge_controls.ts. The needle is a function of
// the authoritative clock; between snapshots the bar extrapolates it from
// wall time (a bounded personal convenience, never a gameplay input).

import {
  type ForgeControlWorld,
  forgeChooseSlot,
  forgeControlsActive,
} from '../../../game/forge_controls';
import { type GamepadKind, GP, gamepadButtonLabel } from '../../../game/gamepad_map';
import { currentInputHintMode } from '../../../game/input_hint_mode';
import { FORGE_QUEST_ID } from '../../../sim/content/world_quest_forging';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import { iconDataUrl } from '../../icons';
import type { PainterHostWriters } from '../../painter_host';
import {
  createForgeActionBarView,
  forgeMeterView,
  forgeSpeechText,
} from '../../world_quest_forge_view';
import { ActionBarPainter, type ActionBarSlotElements } from '../action_bar/action_bar_painter';

/** Wall-clock extrapolation past the last authoritative sample, capped. */
const CLOCK_LEAD_MAX_SECONDS = 0.35;

export type ForgeBarWorld = ForgeControlWorld & { readonly worldQuestTime?: number };

export class ForgeActionBarController {
  private readonly root = document.createElement('section');
  private readonly title = document.createElement('div');
  private readonly status = document.createElement('div');
  private readonly meter = document.createElement('div');
  private readonly band = document.createElement('div');
  private readonly needle = document.createElement('div');
  private readonly gauge = document.createElement('div');
  private readonly fill = document.createElement('div');
  private readonly heatLabel = document.createElement('span');
  private readonly hint = document.createElement('div');
  private readonly view = createForgeActionBarView();
  private readonly painter: ActionBarPainter;
  private active = false;
  private lastClock = Number.NaN;
  private lastClockAt = 0;
  constructor(
    private readonly world: ForgeBarWorld,
    private readonly writers: PainterHostWriters,
    private readonly keyLabel: (slot: number) => string,
    private readonly cancelOnEnter: readonly { cancel(): void }[],
    attachTooltip: (element: HTMLElement, html: () => string) => void,
    consumePeek: () => boolean,
    private readonly padKind: () => GamepadKind = () => 'generic',
    private readonly now: () => number = () => performance.now(),
  ) {
    this.root.id = 'forge-action-bar';
    this.root.className = 'vehicle-bar forge-action-bar';
    this.title.className = 'vehicle-bar-title';
    this.status.className = 'vehicle-bar-status';
    this.hint.className = 'vehicle-bar-hint';
    this.meter.className = 'forge-meter';
    this.band.className = 'forge-meter-band';
    this.needle.className = 'forge-meter-needle';
    this.meter.append(this.band, this.needle);
    this.gauge.className = 'vehicle-integrity forge-heat';
    this.fill.className = 'vehicle-integrity-fill';
    this.heatLabel.className = 'vehicle-integrity-text';
    this.gauge.append(this.fill, this.heatLabel);
    writers.setAttr(this.status, 'role', 'status');
    writers.setAttr(this.meter, 'role', 'img');
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
        if (!consumePeek()) forgeChooseSlot(world, index);
      });
      attachTooltip(btn, () =>
        esc(
          index === 0
            ? t('questUi.worldQuest.forge.strikeTip')
            : t('questUi.worldQuest.forge.stokeTip', {
                floor: formatNumber(0.7, { style: 'percent' }),
              }),
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
    this.root.append(this.title, this.status, this.meter, this.gauge, bar, this.hint);
    writers.setDisplay(this.root, 'none');
    document.getElementById('ui')?.append(this.root);
  }

  /** The authoritative clock, extrapolated a little between samples so the needle glides. */
  private clock(): number {
    const authoritative = this.world.worldQuestTime ?? 0;
    const wall = this.now();
    if (authoritative !== this.lastClock) {
      this.lastClock = authoritative;
      this.lastClockAt = wall;
      return authoritative;
    }
    return (
      authoritative +
      Math.min(CLOCK_LEAD_MAX_SECONDS, Math.max(0, (wall - this.lastClockAt) / 1000))
    );
  }

  update(): void {
    const active = !this.world.player.dead && forgeControlsActive(this.world);
    if (active !== this.active) {
      this.active = active;
      if (active) for (const controller of this.cancelOnEnter) controller.cancel();
      this.writers.toggleClass(document.body, 'working-forge', active);
      this.writers.setDisplay(this.root, active ? 'grid' : 'none');
    }
    if (!active) return;
    const progress = this.world.worldQuestLog.get(FORGE_QUEST_ID);
    const session = progress?.forging;
    if (!session || !progress) return;
    const now = Math.max(this.clock(), session.observedAt);
    const meter = forgeMeterView(session, now);
    this.writers.setText(this.title, t('questUi.worldQuest.forge.title'));
    this.writers.setText(
      this.status,
      t('questUi.worldQuest.forge.strikes', {
        count: formatNumber(session.strikes),
        total: formatNumber(10),
      }),
    );
    this.writers.setAttr(this.meter, 'aria-label', t('questUi.worldQuest.forge.meterAria'));
    this.writers.setStyleProp(this.band, '--forge-band-start', String(meter.bandStart));
    this.writers.setStyleProp(this.band, '--forge-band-end', String(meter.bandEnd));
    this.writers.setStyleProp(this.needle, '--forge-needle', String(meter.needle));
    this.writers.toggleClass(this.meter, 'in-band', meter.inBand);
    this.writers.toggleClass(this.meter, 'working', meter.working);
    const heatText = t('questUi.worldQuest.forge.heat', {
      value: formatNumber(meter.heat / 100, { style: 'percent' }),
      floor: formatNumber(0.7, { style: 'percent' }),
    });
    this.writers.setAttr(this.gauge, 'aria-label', heatText);
    this.writers.setAttr(this.gauge, 'aria-valuenow', String(Math.round(meter.heat)));
    this.writers.setText(this.heatLabel, heatText);
    this.writers.setStyleProp(this.fill, '--vehicle-integrity', String(meter.heat / 100));
    this.writers.toggleClass(this.gauge, 'low-integrity', !meter.warm);
    this.writers.setText(this.hint, forgeSpeechText(progress) ?? '');
    this.painter.paint(
      this.view.tick(session, now, (slot) =>
        currentInputHintMode() === 'touch'
          ? ''
          : currentInputHintMode() === 'pad'
            ? gamepadButtonLabel(slot === 0 ? GP.X : GP.Y, this.padKind())
            : this.keyLabel(slot),
      ),
    );
  }
}
