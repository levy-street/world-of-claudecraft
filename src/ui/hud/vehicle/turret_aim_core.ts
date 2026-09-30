import { TURRET_FRAGMENTATION, TURRET_WEAPON } from '../../../sim/content/turret_defense';
import { clampTurretAimInto, type TurretAim } from '../../../sim/minigames/turret_defense';
import { TURRET_BOMBLETS, writeTurretFragStar } from '../../../sim/minigames/turret_fragmentation';
import type { CannonPoint } from '../../../sim/types';
import type { IWorldVehicles, TurretSessionView } from '../../../world_api/vehicles';
import type { GroundAimReticleView } from '../action_bar/ground_aim_controller';
import type { TurretOwnShotLedger } from './turret_own_shot_core';
import { turretOwnShots } from './turret_own_shots';

type TurretAimWorld = Pick<IWorldVehicles, 'turretSession' | 'turretClock' | 'useVehicleAction'>;

/** Where a pad-steered aim starts, ahead of the last shot's direction. */
const SEED_DISTANCE = 20;
/** The armed fragmentation shell's footprint: its outer bomblets' ring plus one bomblet's blast. */
export const TURRET_FRAG_FOOTPRINT =
  TURRET_FRAGMENTATION.outerRadius + TURRET_FRAGMENTATION.blastRadius;
/** The armed reticle's colour, through the reticle's school palette (orange). */
const FRAG_SCHOOL = 'fire';
const SHELL_SCHOOL = 'physical';

/** Either seat owns the HUD's ground aim; a static read, so no bar is built to answer it. */
export function vehicleOwnsAim(
  world: Partial<Pick<IWorldVehicles, 'vehicleSession' | 'turretSession'>>,
): boolean {
  return !!world.vehicleSession || !!world.turretSession;
}

function ended(session: TurretSessionView): boolean {
  return session.defense.phase === 'won' || session.defense.phase === 'lost';
}

/**
 * The Fire and Fly aim: on for the whole seat. A click fires and keeps aiming, and a
 * shot the sim refuses (cooldown) still consumes the click. Every click sent is
 * marked in the own-shot ledger, which plays its report at once when the server
 * will surely take it.
 *
 * The limited weapons: the Shockwave fires at once, and the fragmentation shell is
 * ARMED first, so the next click fires it in place of a shell. Arming again, cancel
 * (right click, Escape, the pad's cancel) or the seat ending disarms it with no
 * charge spent; cancel reports nothing else, so Escape with nothing armed falls
 * through to the seat's own exit. A weapon click the ledger says the server surely
 * refuses (reloading, rearming, no charge, no wave) is not sent: the frag stays armed.
 */
export class TurretAimCore {
  private readonly raw: CannonPoint = { x: 0, z: 0 };
  private hasPoint = false;
  private readonly aimed: CannonPoint = { x: 0, z: 0 };
  private readonly clamp: TurretAim = { x: 0, z: 0, dirX: 0, dirZ: 1, range: 0 };
  private readonly view: GroundAimReticleView = {
    point: this.aimed,
    radius: TURRET_WEAPON.blastRadius,
    school: SHELL_SCHOOL,
    dimmed: false,
    blocked: false,
    landing: null,
  };
  private armed = false;
  private readonly star: CannonPoint[] = Array.from({ length: TURRET_BOMBLETS }, () => ({
    x: 0,
    z: 0,
  }));
  constructor(
    private readonly world: TurretAimWorld,
    readonly shots: TurretOwnShotLedger = turretOwnShots,
  ) {}
  isActive(): boolean {
    return !!this.world.turretSession;
  }
  activeSlot(): number | null {
    return null;
  }
  activeAbilityId(): string | null {
    return null;
  }
  rawAimPoint(): CannonPoint | null {
    return this.hasPoint ? this.raw : null;
  }
  abilityRange(): number | null {
    return this.isActive() ? TURRET_WEAPON.maxRange : null;
  }
  /** The fragmentation shell waits for the next click. */
  get fragArmed(): boolean {
    return this.armed;
  }
  reset(): void {
    this.hasPoint = false;
    this.armed = false;
  }
  /** Disarms an armed fragmentation shell; false (nothing handled) otherwise. */
  cancel(): boolean {
    if (!this.armed) return false;
    this.armed = false;
    return true;
  }
  /**
   * Arms the fragmentation shell, or disarms it when armed. Arming needs a seat
   * still running with a charge left as the player sees it; returns the armed state.
   */
  toggleFrag(): boolean {
    if (this.armed) {
      this.armed = false;
      return false;
    }
    const session = this.world.turretSession;
    this.armed =
      !!session &&
      !ended(session) &&
      this.shots.chargesLeft(session, this.world.turretClock, 'frag') > 0;
    return this.armed;
  }
  /** Drops an armed shell the seat can no longer fire (left, ended, or its last charge spent). */
  sync(): void {
    if (!this.armed) return;
    const session = this.world.turretSession;
    if (
      !session ||
      ended(session) ||
      this.shots.chargesLeft(session, this.world.turretClock, 'frag') <= 0
    ) {
      this.armed = false;
    }
  }
  /**
   * The Shockwave, at once (it has no aim: the command carries the tower's centre).
   * Sent unless the ledger says the server surely refuses it; true when sent.
   */
  fireShockwave(): boolean {
    const session = this.world.turretSession;
    const clock = this.world.turretClock;
    if (!session || ended(session)) return false;
    const { cx, cz } = session.defense;
    if (clock !== null) {
      const play = this.shots.classify(session, clock, 'shock');
      if (play === 'free') return false;
      const center: TurretAim = { x: cx, z: cz, dirX: 0, dirZ: 1, range: 0 };
      this.shots.markWeapon(session, clock, center, 'shock', play);
    }
    this.world.useVehicleAction('turret_shockwave', { x: cx, z: cz });
    return true;
  }
  /**
   * Where the armed shell's six bomblets land for the current aim (the engine's
   * fixed star, turned to the aim's bearing); null while nothing is armed or aimed.
   */
  fragLandingPoints(): readonly CannonPoint[] | null {
    const session = this.world.turretSession;
    if (!this.armed || !session || !this.hasPoint || ended(session)) return null;
    this.clampInto(session, this.raw.x, this.raw.z);
    return this.writeStar();
  }
  updatePoint(point: CannonPoint | null): void {
    this.hasPoint = !!point && this.isActive();
    if (point && this.hasPoint) this.setRaw(point.x, point.z);
  }
  nudge(dx: number, dz: number): void {
    const session = this.world.turretSession;
    if (!session) return;
    const { cx, cz, aimX, aimZ } = session.defense;
    const x = this.hasPoint ? this.raw.x : cx + aimX * SEED_DISTANCE;
    const z = this.hasPoint ? this.raw.z : cz + aimZ * SEED_DISTANCE;
    this.clampInto(session, x + dx, z + dz);
    this.setRaw(this.aimed.x, this.aimed.z);
    this.hasPoint = true;
  }
  reticle(): GroundAimReticleView | null {
    const session = this.world.turretSession;
    if (!session || !this.hasPoint || ended(session)) return null;
    this.clampInto(session, this.raw.x, this.raw.z);
    const clock = this.world.turretClock;
    const weapon = this.armed ? 'frag' : 'shell';
    this.view.radius = this.armed ? TURRET_FRAG_FOOTPRINT : TURRET_WEAPON.blastRadius;
    this.view.school = this.armed ? FRAG_SCHOOL : SHELL_SCHOOL;
    this.view.dimmed = clock !== null && !this.shots.canMark(session, clock, weapon);
    this.view.blocked = false;
    this.view.landing = this.armed ? this.writeStar() : null;
    return this.view;
  }
  commitAt(point: CannonPoint | null | undefined = this.rawAimPoint()): boolean {
    const session = this.world.turretSession;
    if (!session) return false;
    if (!point) return true;
    this.clampInto(session, point.x, point.z);
    // Marked before the send: offline the shot fires inside it, and its entry must find the mark.
    const clock = this.world.turretClock;
    if (!this.armed) {
      if (clock !== null) this.shots.mark(session, clock, this.clamp);
      this.world.useVehicleAction('turret_fire', { x: this.aimed.x, z: this.aimed.z });
      return true;
    }
    if (clock !== null) {
      const play = this.shots.classify(session, clock, 'frag');
      if (play === 'free') return true;
      this.shots.markWeapon(session, clock, this.clamp, 'frag', play);
    }
    this.armed = false;
    this.world.useVehicleAction('turret_frag', { x: this.aimed.x, z: this.aimed.z });
    return true;
  }
  /** The engine's star for the clamped aim, written in place: the reticle reads it every frame. */
  private writeStar(): readonly CannonPoint[] {
    const { x, z, dirX, dirZ } = this.clamp;
    return writeTurretFragStar(x, z, dirX, dirZ, this.star);
  }
  private setRaw(x: number, z: number): void {
    this.raw.x = x;
    this.raw.z = z;
  }
  /** Writes the point, held in the weapon's reach band by the engine's own clamp, into `aimed`. */
  private clampInto(session: TurretSessionView, x: number, z: number): void {
    const { cx, cz, aimX, aimZ } = session.defense;
    clampTurretAimInto(cx, cz, aimX, aimZ, x, z, this.clamp);
    this.aimed.x = this.clamp.x;
    this.aimed.z = this.clamp.z;
  }
}
