import { TurretDefenseSfx } from '../../../game/turret_defense_sfx';
import { TURRET_TIMING } from '../../../sim/content/turret_defense';
import type { IWorldVehicles } from '../../../world_api/vehicles';
import { t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { createReducedMotionProbe } from './reduced_motion_probe';
import { TurretAimCore } from './turret_aim_core';
import { TurretDamageNumbers, type TurretFctSpawn } from './turret_damage_numbers_core';
import { TurretHitFeedback } from './turret_hit_feedback_core';
import { TurretHitFlashPainter } from './turret_hit_flash_painter';
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

/** The HUD surfaces the seat reports through: banner slot, floating combat text, camera. */
export interface TurretHudHooks {
  showBanner?(banner: TurretBanner): void;
  spawnFct?: TurretFctSpawn;
  /** Camera trauma for a strike on the turret. */
  addShake?(amount: number): void;
  /** Read once per strike; defaults to the OS setting or the in-game Reduce Motion switch. */
  reducedMotion?(): boolean;
}

export const TURRET_HIT_OVERLAY_ID = 'turret-hit-vignette';

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
  private readonly hitVeil = document.createElement('div');
  private readonly view = new TurretHudView();
  private readonly feedback = new TurretFeedbackCursor();
  private readonly sounds = new TurretDefenseSfx();
  private readonly numbers: TurretDamageNumbers | null;
  private readonly hits: TurretHitFeedback;
  private readonly hitFlash: TurretHitFlashPainter;
  private seated = false;
  constructor(
    private readonly world: TurretHudWorld,
    private readonly writers: PainterHostWriters,
    private readonly cancelOnEnter: readonly { cancel(): void }[],
    private readonly hooks: TurretHudHooks = {},
  ) {
    this.aim = new TurretAimCore(world);
    this.numbers = hooks.spawnFct
      ? new TurretDamageNumbers(hooks.spawnFct, () => performance.now())
      : null;
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
    this.hitVeil.id = TURRET_HIT_OVERLAY_ID;
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
    writers.setAttr(this.hitVeil, 'aria-hidden', 'true');
    writers.setDisplay(this.hitVeil, 'none');
    document.getElementById('ui')?.append(this.root, this.hitVeil);
    this.hits = new TurretHitFeedback(
      () => performance.now(),
      hooks.reducedMotion ?? createReducedMotionProbe(),
    );
    this.hitFlash = new TurretHitFlashPainter(writers, this.hitVeil, this.gauge);
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
    if (banner) this.hooks.showBanner?.(banner);
    this.sounds.update(session, this.world.turretClock);
    this.numbers?.update(session, this.world.turretClock);
    const hit = this.hits.update(session, this.world.turretClock);
    this.hitFlash.paint(hit);
    if (hit.cameraShake > 0) this.hooks.addShake?.(hit.cameraShake);
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
