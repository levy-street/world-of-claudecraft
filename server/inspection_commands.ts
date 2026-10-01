// The two correlated, non-mutating inspection reads (the selected-corpse
// harvest status and the mob inspect window's live stat block) behind ONE
// game.ts dispatch case group, so the coordinator carries two labels and one
// call. Each command's validation, throttle and reply shape stay whole in its
// own module; this only routes by label.

import {
  type CorpseHarvestInspectionSim,
  dispatchCorpseHarvestInspection,
  type InspectCorpseHarvestPayload,
  type InspectCorpseHarvestSession,
} from './corpse_harvest_inspection';
import {
  dispatchMobInspection,
  type InspectMobPayload,
  type MobInspectionSim,
} from './mob_inspection';

export type InspectionCommand = 'inspectCorpseHarvest' | 'inspectMob';

/** The per-session inspection state the game.ts session record carries (the
 *  corpse query's throttle deadline and cached answer; the mob read keeps its
 *  own state in a WeakMap keyed by the session, so it adds no field). */
export type InspectionSessionState = InspectCorpseHarvestSession;

export function dispatchInspectionCommand(
  command: InspectionCommand,
  sim: CorpseHarvestInspectionSim & MobInspectionSim,
  session: InspectionSessionState,
  msg: InspectCorpseHarvestPayload & InspectMobPayload,
  pid: number,
  send: (frame: { t: string }) => void,
): void {
  if (command === 'inspectMob') dispatchMobInspection(sim, session, msg, pid, send);
  else dispatchCorpseHarvestInspection(sim, session, msg, pid, send);
}
