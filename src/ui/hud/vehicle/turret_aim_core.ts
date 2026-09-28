import { TURRET_WEAPON } from '../../../sim/content/turret_defense';
import type { CannonPoint } from '../../../sim/types';
import type { IWorldVehicles, TurretSessionView } from '../../../world_api/vehicles';
import type { GroundAimReticleView } from '../action_bar/ground_aim_controller';

type TurretAimWorld = Pick<IWorldVehicles, 'turretSession' | 'turretClock' | 'useVehicleAction'>;

/** Where a pad-steered aim starts, ahead of the last shot's direction. */
const SEED_DISTANCE = 20;

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
 * shot the sim refuses (cooldown) still consumes the click; cancel never drops it,
 * so Escape falls through to the seat's own exit.
 */
export class TurretAimCore {
  private readonly raw: CannonPoint = { x: 0, z: 0 };
  private hasPoint = false;
  private readonly aimed: CannonPoint = { x: 0, z: 0 };
  private readonly view: GroundAimReticleView = {
    point: this.aimed,
    radius: TURRET_WEAPON.blastRadius,
    school: 'physical',
    dimmed: false,
    blocked: false,
  };
  constructor(private readonly world: TurretAimWorld) {}
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
  reset(): void {
    this.hasPoint = false;
  }
  cancel(): boolean {
    return false;
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
    this.view.dimmed = (this.world.turretClock ?? Infinity) < session.defense.readyTick;
    this.view.blocked = false;
    return this.view;
  }
  commitAt(point: CannonPoint | null | undefined = this.rawAimPoint()): boolean {
    const session = this.world.turretSession;
    if (!session) return false;
    if (!point) return true;
    this.clampInto(session, point.x, point.z);
    this.world.useVehicleAction('turret_fire', { x: this.aimed.x, z: this.aimed.z });
    return true;
  }
  private setRaw(x: number, z: number): void {
    this.raw.x = x;
    this.raw.z = z;
  }
  /** Writes the point, held inside the weapon's reach band, into `aimed`; returns its distance.
   *  A point-blank click fires at the minimum range along its bearing, as the sim would. */
  private clampInto(session: TurretSessionView, x: number, z: number): number {
    const { cx, cz, aimX, aimZ } = session.defense;
    let dx = x - cx;
    let dz = z - cz;
    let distance = Math.hypot(dx, dz);
    if (distance < 1e-6) {
      dx = aimX;
      dz = aimZ;
      distance = 1;
    }
    const reach = Math.min(TURRET_WEAPON.maxRange, Math.max(TURRET_WEAPON.minRange, distance));
    this.aimed.x = cx + (dx / distance) * reach;
    this.aimed.z = cz + (dz / distance) * reach;
    return reach;
  }
}
