import { type GamepadKind, GP, gamepadButtonLabel } from '../../../game/gamepad_map';
import { currentInputHintMode } from '../../../game/input_hint_mode';
import { keyLabel } from '../../../game/keybinds';
import { TurretDefenseSfx } from '../../../game/turret_defense_sfx';
import type { IWorldVehicles } from '../../../world_api/vehicles';
import type { PainterHostWriters } from '../../painter_host';
import { createReducedMotionProbe } from './reduced_motion_probe';
import { TurretAimCore } from './turret_aim_core';
import { TurretDamageNumbers, type TurretFctSpawn } from './turret_damage_numbers_core';
import { TurretHitFeedback } from './turret_hit_feedback_core';
import { TurretHitFlashPainter } from './turret_hit_flash_painter';
import { TurretHudPainter } from './turret_hud_painter';
import { type TurretBanner, TurretFeedbackCursor, TurretHudView } from './turret_hud_view';

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
  /** The connected pad's brand, for Leave's Start glyph while the pad is in hand. */
  padKind?(): GamepadKind;
}

export const TURRET_HIT_OVERLAY_ID = 'turret-hit-vignette';
/**
 * On body while seated: the tower's rail takes the vitals seat, so the player frame and
 * the XP rail step aside, and the vehicle bars' player-frame lift stays off.
 */
export const TURRET_SEATED_CLASS = 'manning-turret';
/** Replay aims at nothing; the command still carries a point, as every seat action does. */
const REPLAY_POINT = { x: 0, z: 0 } as const;

/**
 * The Fire and Fly seat HUD: status strip, result card, tower rail, hit feedback, Replay
 * and Leave.
 */
export class TurretHudController {
  readonly aim: TurretAimCore;
  private readonly painter: TurretHudPainter;
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
    this.painter = new TurretHudPainter(
      writers,
      () => world.leaveVehicle(),
      () => world.useVehicleAction('turret_replay', REPLAY_POINT),
    );
    this.hitVeil.id = TURRET_HIT_OVERLAY_ID;
    writers.setAttr(this.hitVeil, 'aria-hidden', 'true');
    writers.setDisplay(this.hitVeil, 'none');
    document
      .getElementById('ui')
      ?.append(this.painter.strip, this.painter.rail, this.painter.live, this.hitVeil);
    this.hits = new TurretHitFeedback(
      () => performance.now(),
      hooks.reducedMotion ?? createReducedMotionProbe(),
    );
    this.hitFlash = new TurretHitFlashPainter(writers, this.hitVeil, this.painter.railBar);
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
      this.view.reset();
      if (seated) for (const controller of this.cancelOnEnter) controller.cancel();
      this.painter.show(seated);
      writers.toggleClass(document.body, TURRET_SEATED_CLASS, seated);
    }
    const banner = this.feedback.consume(session);
    if (banner) this.hooks.showBanner?.(banner);
    this.sounds.update(session, this.world.turretClock);
    this.numbers?.update(session, this.world.turretClock);
    const hit = this.hits.update(session, this.world.turretClock);
    this.hitFlash.paint(hit);
    if (hit.cameraShake > 0) this.hooks.addShake?.(hit.cameraShake);
    if (!session) return;
    this.painter.paint(this.view.tick(session, this.world.turretClock), this.leaveKeycap());
  }

  /** Escape leaves the seat; on a pad in hand, Start sends the same escape. */
  private leaveKeycap(): string {
    return currentInputHintMode() === 'pad'
      ? gamepadButtonLabel(GP.START, this.hooks.padKind?.() ?? 'generic')
      : keyLabel('Escape');
  }
}
