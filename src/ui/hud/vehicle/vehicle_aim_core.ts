import { CANNON_ACTIONS } from '../../../sim/content/cannon_encounter';
import { cannonAimValid, isCannonActionId } from '../../../sim/minigames/cannon_encounter';
import type { CannonActionId, CannonPoint } from '../../../sim/types';
import { vehicleStationById } from '../../../sim/vehicle_stations';
import type { IWorldVehicles } from '../../../world_api/vehicles';
import type { GroundAimReticleView } from '../action_bar/ground_aim_controller';

export const VEHICLE_ACTION_SLOTS: readonly CannonActionId[] = [
  'cannonball',
  'grapeshot',
  'incendiary',
];

export class VehicleAimCore {
  private action: CannonActionId | null = null;
  private slot: number | null = null;
  private point: CannonPoint | null = null;
  private readonly view: GroundAimReticleView = {
    point: { x: 0, z: 0 },
    radius: 0,
    school: 'physical',
    dimmed: false,
    blocked: false,
  };
  constructor(
    private readonly world: IWorldVehicles,
    private readonly clearReticle: () => void,
  ) {}
  isActive(): boolean {
    return this.action !== null && this.world.vehicleSession !== null;
  }
  activeSlot(): number | null {
    return this.isActive() ? this.slot : null;
  }
  activeAbilityId(): string | null {
    return this.isActive() ? this.action : null;
  }
  rawAimPoint(): CannonPoint | null {
    return this.point;
  }
  abilityRange(): number | null {
    return this.isActive() ? 100 : null;
  }
  begin(id: string, slot: number): void {
    const session = this.world.vehicleSession;
    const station = session && vehicleStationById(session.stationId);
    if (!isCannonActionId(id) || !session || !station || session.encounter.phase !== 'wave') return;
    this.action = id;
    this.slot = slot;
    const field = station.field;
    this.point = { x: (field.minX + field.maxX) / 2, z: (field.minZ + field.maxZ) / 2 };
  }
  cancel(): boolean {
    const active = this.action !== null;
    this.action = null;
    this.slot = null;
    this.point = null;
    if (active) this.clearReticle();
    return active;
  }
  updatePoint(point: CannonPoint | null): void {
    this.point = point;
  }
  nudge(dx: number, dz: number): void {
    const station = vehicleStationById(this.world.vehicleSession?.stationId ?? '');
    if (!this.point || !this.isActive() || !station) return;
    const field = station.field;
    this.point = {
      x: Math.max(field.minX, Math.min(field.maxX, this.point.x + dx)),
      z: Math.max(field.minZ, Math.min(field.maxZ, this.point.z + dz)),
    };
  }
  reticle(): GroundAimReticleView | null {
    const station = vehicleStationById(this.world.vehicleSession?.stationId ?? '');
    if (!this.isActive() || !this.action || !this.point || !station) return null;
    this.view.point = this.point;
    this.view.radius = CANNON_ACTIONS[this.action].radius;
    this.view.school = this.action === 'incendiary' ? 'fire' : 'physical';
    this.view.blocked = !cannonAimValid(station.field, this.point);
    return this.view;
  }
  commitAt(point: CannonPoint | null | undefined = this.point): boolean {
    const station = vehicleStationById(this.world.vehicleSession?.stationId ?? '');
    if (!this.isActive() || !this.action || !station) return false;
    // A refusing placement consumes the terrain click, not the cooldown or aim.
    if (!point || !cannonAimValid(station.field, point)) return true;
    const action = this.action;
    this.world.useVehicleAction(action, point);
    this.cancel();
    return true;
  }
}
