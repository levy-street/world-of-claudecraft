import { type GamepadKind, GP, gamepadButtonLabel } from '../../../game/gamepad_map';
import { currentInputHintMode } from '../../../game/input_hint_mode';
import { keyLabel } from '../../../game/keybinds';
import { TURRET_PAD_WEAPON_BUTTONS } from '../../../game/turret_controls';
import { TurretDefenseSfx } from '../../../game/turret_defense_sfx';
import type { IWorldQuests } from '../../../world_api/quests';
import type { IWorldVehicles } from '../../../world_api/vehicles';
import type { PainterHostWriters } from '../../painter_host';
import { createReducedMotionProbe } from './reduced_motion_probe';
import { TurretAimCore } from './turret_aim_core';
import { TurretDamageNumbers, type TurretFctSpawn } from './turret_damage_numbers_core';
import { TurretHitFeedback } from './turret_hit_feedback_core';
import { TurretHitFlashPainter } from './turret_hit_flash_painter';
import { TurretHudPainter } from './turret_hud_painter';
import { type TurretBanner, TurretFeedbackCursor, TurretHudView } from './turret_hud_view';
import { FireAndFlyRecruitmentWatch, fireAndFlyRecruitedBanner } from './turret_recruitment_core';
import { TurretWeaponBarPainter } from './turret_weapon_bar_painter';
import {
  TURRET_WEAPON_SLOTS,
  type TurretWeaponBarInput,
  TurretWeaponBarView,
  turretWeaponInArsenal,
} from './turret_weapon_bar_view';
import { turretWaveCoreDamage, turretWeaponTooltip } from './turret_weapon_tooltip';

type TurretHudWorld = Pick<
  IWorldVehicles,
  'turretSession' | 'turretClock' | 'useVehicleAction' | 'leaveVehicle'
> &
  Partial<Pick<IWorldQuests, 'fireAndFlyRecruitment'>>;

/** The HUD surfaces the seat reports through: banner slot, floating combat text, camera. */
export interface TurretHudHooks {
  showBanner?(banner: TurretBanner): void;
  /** A Replay began a fresh run over an ended one: the host drops what the last run left up. */
  onNewRun?(): void;
  spawnFct?: TurretFctSpawn;
  /** Camera trauma for a strike on the turret. */
  addShake?(amount: number): void;
  /** Read once per strike; defaults to the OS setting or the in-game Reduce Motion switch. */
  reducedMotion?(): boolean;
  /** The connected pad's brand, for Leave's Start glyph while the pad is in hand. */
  padKind?(): GamepadKind;
  /** The player's key for an action-bar slot: the weapon sockets' keycaps (keys 1 and 2). */
  keyLabel?(slot: number): string;
  attachTooltip?(element: HTMLElement, html: () => string): void;
  /** True when a touch only peeked at a tooltip: the socket then does not fire. */
  consumePeek?(): boolean;
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
 * The Fire and Fly seat HUD: status strip, result card, tower rail, weapon sockets, hit
 * feedback, Replay and Leave.
 */
export class TurretHudController {
  readonly aim: TurretAimCore;
  private readonly painter: TurretHudPainter;
  private readonly hitVeil = document.createElement('div');
  private readonly view = new TurretHudView();
  private readonly feedback = new TurretFeedbackCursor();
  private readonly recruitment = new FireAndFlyRecruitmentWatch();
  private readonly sounds = new TurretDefenseSfx();
  private readonly numbers: TurretDamageNumbers | null;
  private readonly hits: TurretHitFeedback;
  private readonly hitFlash: TurretHitFlashPainter;
  private readonly weaponView = new TurretWeaponBarView();
  private readonly weapons: TurretWeaponBarPainter;
  private weaponInput: TurretWeaponBarInput | null = null;
  private seated = false;
  /** The seat's run had ended at the last update: a live run after it is a Replay's. */
  private runEnded = false;
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
    this.weapons = new TurretWeaponBarPainter(
      writers,
      (slot, pointer) => {
        if (hooks.consumePeek?.()) return;
        this.chooseSlot(slot);
        // A tap focuses the socket, and a focused socket shows its tooltip over the field;
        // a keyboard press keeps its focus where the player put it.
        if (pointer) this.weapons.buttons[slot]?.blur();
      },
      hooks.attachTooltip,
      (slot) => this.weaponTooltip(slot),
    );
    this.hitVeil.id = TURRET_HIT_OVERLAY_ID;
    writers.setAttr(this.hitVeil, 'aria-hidden', 'true');
    writers.setDisplay(this.hitVeil, 'none');
    document
      .getElementById('ui')
      ?.append(
        this.painter.strip,
        this.weapons.root,
        this.painter.rail,
        this.painter.live,
        this.hitVeil,
      );
    this.hits = new TurretHitFeedback(
      () => performance.now(),
      hooks.reducedMotion ?? createReducedMotionProbe(),
    );
    this.hitFlash = new TurretHitFlashPainter(writers, this.hitVeil, this.painter.railBar);
  }

  get active(): boolean {
    return this.seated;
  }

  /**
   * A bar slot while seated: slot 0 (key 1, pad Y) slams, slot 1 (key 2, pad LB) arms or
   * disarms. A weapon the scenario does not give does nothing, and says nothing.
   */
  chooseSlot(slot: number): void {
    const weapon = TURRET_WEAPON_SLOTS[slot];
    const arsenal = this.world.turretSession?.defense.plan.arsenal;
    if (!weapon || !arsenal || !turretWeaponInArsenal(arsenal, weapon)) return;
    if (slot === 0) this.aim.fireShockwave();
    else if (slot === 1) this.aim.toggleFrag();
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
      // A seated frame decides the row below; the frame that drops the seat must hide it here.
      if (!seated) this.weapons.show(false);
      writers.toggleClass(document.body, TURRET_SEATED_CLASS, seated);
    }
    const phase = session?.defense.phase;
    const runEnded = phase === 'won' || phase === 'lost';
    if (session && this.runEnded && !runEnded) this.hooks.onNewRun?.();
    this.runEnded = runEnded;
    let banner = this.feedback.consume(session, () => this.weaponKeys());
    const recruited = this.world.fireAndFlyRecruitment?.recruited === true;
    if (this.recruitment.observe(seated, recruited)) banner = fireAndFlyRecruitedBanner();
    if (banner) this.hooks.showBanner?.(banner);
    this.sounds.update(session, this.world.turretClock);
    this.numbers?.update(session, this.world.turretClock);
    const hit = this.hits.update(session, this.world.turretClock);
    this.hitFlash.paint(hit);
    if (hit.cameraShake > 0) this.hooks.addShake?.(hit.cameraShake);
    this.aim.sync();
    if (!session) return;
    const clock = this.world.turretClock;
    const frame = this.view.tick(session, clock);
    this.painter.paint(frame, this.leaveKeycap());
    const arsenal = session.defense.plan.arsenal;
    const armed = frame.result === null && arsenal.shockwave + arsenal.fragmentation > 0;
    this.weapons.show(armed);
    if (!armed) return;
    let input = this.weaponInput;
    if (!input) {
      input = {
        session,
        clock,
        shots: this.aim.shots,
        fragArmed: false,
        keycap: (slot) => this.weaponKeycap(slot),
      };
      this.weaponInput = input;
    }
    input.session = session;
    input.clock = clock;
    input.fragArmed = this.aim.fragArmed;
    const state = this.weaponView.tick(input);
    this.weapons.paint(state, this.weaponView.groupLabel(), this.weaponView.presence);
  }

  /** The weapon socket's keycap: the pad glyph while the pad is in hand, else the bound key. */
  private weaponKeycap(slot: number): string {
    if (currentInputHintMode() === 'pad') {
      return gamepadButtonLabel(
        TURRET_PAD_WEAPON_BUTTONS[slot],
        this.hooks.padKind?.() ?? 'generic',
      );
    }
    return this.hooks.keyLabel?.(slot) ?? '';
  }

  /** The keys the first wave's banner names; null on touch, which has none. */
  private weaponKeys(): { shock: string; frag: string } | null {
    if (currentInputHintMode() === 'touch') return null;
    return { shock: this.weaponKeycap(0), frag: this.weaponKeycap(1) };
  }

  private weaponTooltip(slot: number): string {
    const session = this.world.turretSession;
    if (!session) return '';
    const weapon = slot === 0 ? 'shock' : 'frag';
    return turretWeaponTooltip(
      weapon,
      turretWaveCoreDamage(session),
      this.aim.shots.chargesLeft(session, this.world.turretClock, weapon),
      session.defense.plan,
    );
  }

  /** Escape leaves the seat; on a pad in hand, Start sends the same escape. */
  private leaveKeycap(): string {
    return currentInputHintMode() === 'pad'
      ? gamepadButtonLabel(GP.START, this.hooks.padKind?.() ?? 'generic')
      : keyLabel('Escape');
  }
}
