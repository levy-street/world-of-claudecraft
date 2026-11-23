import { DUNGEON_X_THRESHOLD, zoneAt } from '../data';
import type { SimEvent, Vec3 } from '../types';

type DuelEndEvent = Extract<SimEvent, { type: 'duelEnd' }>;

export function duelZoneIdAt(pos: Vec3): string | null {
  return pos.x > DUNGEON_X_THRESHOLD ? null : zoneAt(pos.x, pos.z).id;
}

export function duelEndVisibleToViewer(
  event: DuelEndEvent,
  viewerPid: number,
  viewerPos: Vec3,
): boolean {
  if (viewerPid === event.winnerPid || viewerPid === event.loserPid) return true;
  return event.zoneId !== null && duelZoneIdAt(viewerPos) === event.zoneId;
}
