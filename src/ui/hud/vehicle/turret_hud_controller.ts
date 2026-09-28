import { TurretDefenseSfx } from '../../../game/turret_defense_sfx';
import { TURRET_TIMING } from '../../../sim/content/turret_defense';
import type { IWorldVehicles } from '../../../world_api/vehicles';
import { t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { TurretAimCore } from './turret_aim_core';
import {
  TURRET_RESULT_LINES,
  type TurretBanner,
  TurretFeedbackCursor,
  TurretHudView,
} from './turret_hud_view';

type TurretHudWorld = Pick<
  IWorldVehicles,
  'turretSession' | 'turretClock' | 'useVehicleAction' | 'leaveVehicle'
>;

/** The Fire and Fly seat HUD: integrity, wave, countdowns, the result panel and Leave. */
export class TurretHudController {
  readonly aim: TurretAimCore;
  private readonly root = document.createElement('section');
  private readonly title = document.createElement('div');
  private readonly status = document.createElement('div');
  private readonly waveLabel = document.createElement('span');
  private readonly leftLabel = document.createElement('span');
  private readonly gauge = document.createElement('div');
  private readonly fill = document.createElement('div');
  private readonly integrity = document.createElement('span');
  private readonly phase = document.createElement('div');
  private readonly result = document.createElement('div');
  private readonly resultTitle = document.createElement('div');
  private readonly resultLines: HTMLElement[] = [];
  private readonly leave = document.createElement('button');
  private readonly view = new TurretHudView();
  private readonly feedback = new TurretFeedbackCursor();
  private readonly sounds = new TurretDefenseSfx();
  private seated = false;
  constructor(
    private readonly world: TurretHudWorld,
    private readonly writers: PainterHostWriters,
    private readonly cancelOnEnter: readonly { cancel(): void }[],
    private readonly showBanner?: (banner: TurretBanner) => void,
  ) {
    this.aim = new TurretAimCore(world);
    this.root.id = 'turret-hud';
    this.root.className = 'vehicle-bar turret-bar';
    this.title.className = 'vehicle-bar-title';
    this.status.className = 'vehicle-bar-status turret-bar-status';
    this.gauge.className = 'vehicle-integrity';
    this.fill.className = 'vehicle-integrity-fill';
    this.integrity.className = 'vehicle-integrity-text';
    this.phase.className = 'vehicle-bar-hint';
    this.result.className = 'turret-result';
    this.resultTitle.className = 'turret-result-title';
    this.leave.className = 'vehicle-exit';
    this.leave.type = 'button';
    writers.setAttr(this.status, 'role', 'status');
    writers.setAttr(this.gauge, 'role', 'meter');
    writers.setAttr(this.gauge, 'aria-valuemin', '0');
    writers.setAttr(this.gauge, 'aria-valuemax', String(TURRET_TIMING.integrity));
    this.status.append(this.waveLabel, this.leftLabel);
    this.gauge.append(this.fill, this.integrity);
    this.result.append(this.resultTitle);
    for (let i = 0; i < TURRET_RESULT_LINES; i++) {
      const line = document.createElement('div');
      this.resultLines.push(line);
      this.result.append(line);
    }
    this.leave.addEventListener('click', () => world.leaveVehicle());
    this.root.append(this.title, this.status, this.gauge, this.phase, this.result, this.leave);
    writers.setDisplay(this.root, 'none');
    writers.setDisplay(this.result, 'none');
    document.getElementById('ui')?.append(this.root);
  }

  get active(): boolean {
    return this.seated;
  }

  update(): void {
    const session = this.world.turretSession;
    const writers = this.writers;
    const seated = !!session;
    if (seated !== this.seated) {
      this.seated = seated;
      this.aim.reset();
      if (seated) for (const controller of this.cancelOnEnter) controller.cancel();
      writers.setDisplay(this.root, seated ? 'grid' : 'none');
    }
    const banner = this.feedback.consume(session);
    if (banner) this.showBanner?.(banner);
    this.sounds.update(session, this.world.turretClock);
    if (!session) return;
    const frame = this.view.tick(session, this.world.turretClock);
    writers.setText(this.title, t('hudChrome.turret.title'));
    writers.setText(this.waveLabel, frame.wave);
    writers.setText(this.leftLabel, frame.left);
    writers.setAttr(this.gauge, 'aria-label', t('hudChrome.turret.integrity'));
    writers.setAttr(this.gauge, 'aria-valuenow', frame.integrityNow);
    writers.setStyleProp(this.fill, '--vehicle-integrity', frame.integrityFill);
    writers.toggleClass(this.gauge, 'low-integrity', frame.low);
    writers.setText(this.integrity, frame.integrityText);
    writers.setText(this.phase, frame.phase);
    writers.setText(this.leave, t('hudChrome.turret.leave'));
    const result = frame.result;
    writers.setDisplay(this.result, result ? '' : 'none');
    if (!result) return;
    writers.toggleClass(this.result, 'won', result.won);
    writers.setText(this.resultTitle, result.title);
    for (let i = 0; i < this.resultLines.length; i++)
      writers.setText(this.resultLines[i], result.lines[i]);
  }
}
