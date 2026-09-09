import { perfectingInfoFrom } from '../sim/professions/perfecting';
import type { PerfectItemRef, PerfectingCopyReads } from '../sim/professions/perfecting_copy';
import {
  type PerfectingSwapRequest,
  perfectingSwapInfoFrom,
} from '../sim/professions/perfecting_swap';
import type { Entity, InvSlot, StationDef } from '../sim/types';
import { perfectingCommand } from './perfecting_command';

/** Each nested ref carries the prompt's capture, or captures the current mirror. */
export function perfectingSwapCommand(reads: PerfectingCopyReads, request: PerfectingSwapRequest) {
  return {
    source: perfectingCommand(reads, request.source),
    target: perfectingCommand(reads, request.target),
  };
}

interface PerfectingMirror extends PerfectingCopyReads {
  inventory: InvSlot[];
  craftingIdentity: { craftSkills: Readonly<Record<string, number>> };
  player: Pick<Entity, 'dead' | 'inCombat' | 'castingAbility' | 'channeling' | 'pos'>;
  stationPlacements: readonly StationDef[];
}

/** Display only. Authoritative commands re-read both copies on the server. */
export function perfectingInfoForMirror(reads: PerfectingMirror, ref: PerfectItemRef) {
  return perfectingInfoFrom({ ...mirrorInputs(reads), ref });
}

function mirrorInputs(reads: PerfectingMirror) {
  return {
    inventory: reads.inventory,
    equipment: reads.equipment,
    equipmentInstances: reads.equipmentInstances,
    craftSkills: reads.craftingIdentity.craftSkills,
  };
}

export function perfectingSwapInfoForMirror(
  reads: PerfectingMirror,
  request: PerfectingSwapRequest,
) {
  const player = reads.player;
  if (!player) return null;
  return perfectingSwapInfoFrom({
    ...mirrorInputs(reads),
    ...request,
    dead: player.dead,
    inCombat: player.inCombat,
    busy: player.castingAbility !== null || player.channeling,
    pos: player.pos,
    stationPlacements: reads.stationPlacements,
  });
}
