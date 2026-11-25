// The service-window family's refresh signature (the pure half of
// service_window_refresh.ts, which says why the family needs a latch): the
// digest of exactly what the copper vendor, the heroic, crucible and WARFARE
// quartermasters, the training ladder and the unbind list read off IWorld.
// The purse and the three balances, an inventory digest with the bound and
// Perfecting flags the unbind list and the sigil counts read, worn ids,
// buyback, standings and faction currencies, proficiency, the quest-log ids
// and states plus the done count the quest-gated rows read, the riding tier,
// the training identity, the owned and pending buddy counts, and the
// in-flight Learn ids at `now`. One signature serves the whole family: a
// dimension a given window ignores costs at most one redundant rebuild of a
// painter that already carries focus across it.
//
// Pure and host-agnostic: no DOM, no clock (the caller passes `nowMs`), so a
// Vitest drives it with a plain Sim-shaped or ClientWorld-shaped object.

import { isPerfectingBound } from '../../../sim/professions/commission';
import type { IWorld } from '../../../world_api';

/** The IWorld reads the service painters render from. */
export type ServiceWindowWorld = Pick<
  IWorld,
  | 'copper'
  | 'honor'
  | 'heroicMarks'
  | 'inventory'
  | 'equipment'
  | 'vendorBuyback'
  | 'factions'
  | 'factionCurrencies'
  | 'gatheringProficiency'
  | 'questLog'
  | 'questsDone'
  | 'ridingTrainingTier'
  | 'craftingIdentity'
  | 'stationPlacements'
  | 'ownedBuddies'
  | 'pendingBuddies'
>;

/** The Hud's TrainLearnTracker, read for the in-flight / confirmed overlay. */
export interface ServiceTrainLearns {
  pendingIds(nowMs: number): ReadonlySet<string>;
  confirmedIds(mirrorKnown: readonly string[]): ReadonlySet<string>;
}

function record(r: Readonly<Record<string, number | undefined>>): string {
  return Object.keys(r)
    .sort()
    .map((k) => `${k}=${r[k]}`)
    .join(',');
}

function sorted(ids: Iterable<string>): string {
  return [...ids].sort().join(',');
}

/** The data signature of everything the service family renders. Pure. */
export function serviceWindowSig(
  world: ServiceWindowWorld,
  learns: ServiceTrainLearns,
  nowMs: number,
): string {
  const identity = world.craftingIdentity;
  const inv = world.inventory
    .map(
      (s) =>
        `${s.itemId}:${s.count}${s.instance?.boundTo !== undefined ? 'b' : ''}${isPerfectingBound(s.instance) ? 'p' : ''}`,
    )
    .join(',');
  const quests: string[] = [];
  for (const [id, q] of world.questLog) quests.push(`${id}:${q.state}`);
  return [
    world.copper,
    world.honor,
    world.heroicMarks,
    inv,
    sorted(Object.values(world.equipment).filter((id): id is string => !!id)),
    world.vendorBuyback.map((s) => `${s.itemId}:${s.count}`).join(','),
    record(world.factions),
    record(world.factionCurrencies),
    record(world.gatheringProficiency),
    quests.sort().join(','),
    world.questsDone.size,
    world.ridingTrainingTier(),
    sorted(identity.knownRecipes),
    record(identity.craftSkills),
    sorted(world.stationPlacements.map((st) => `${st.id}:${st.type}`)),
    // Apart, not summed: a pending buddy turning owned must still move it.
    `${world.ownedBuddies().length}:${world.pendingBuddies().length}`,
    sorted(learns.pendingIds(nowMs)),
    sorted(learns.confirmedIds(identity.knownRecipes)),
  ].join('|');
}
