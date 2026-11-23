import { isFerryPassenger } from '../sim/ferry_passenger';
import type { Entity, ZoneDef } from '../sim/types';
import { currentSubzone, type NamedArea } from './subzone';

/** Keep announcement history separate from the map's current zone. */
export class ZoneAnnouncementCore {
  private lastAnnouncedZone: string | null = '';

  /** A HUD opened mid-voyage waits even if already over its destination zone. */
  initialize(zoneId: string, player: Entity): boolean {
    const riding = isFerryPassenger(player);
    this.lastAnnouncedZone = riding ? null : zoneId;
    return !riding;
  }

  update(zoneId: string, previousZoneId: string, player: Entity): boolean {
    if (this.lastAnnouncedZone === '') this.lastAnnouncedZone = previousZoneId || zoneId;
    if (isFerryPassenger(player) || zoneId === this.lastAnnouncedZone) return false;
    this.lastAnnouncedZone = zoneId;
    return true;
  }

  subzone(player: Entity, inDungeon: boolean, pois: ZoneDef['pois'], current: string | null) {
    return this.subzoneHit(player, inDungeon, pois, [], current)?.label ?? null;
  }

  subzoneHit(
    player: Entity,
    inDungeon: boolean,
    pois: ZoneDef['pois'],
    areas: readonly NamedArea[],
    current: string | null,
  ) {
    return inDungeon || isFerryPassenger(player)
      ? null
      : currentSubzone(player.pos.x, player.pos.z, pois, areas, current);
  }
}
