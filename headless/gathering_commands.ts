// Dispatcher for the optional headless `{cmd:'gathering', verb:...}` request
// family (Intentional Gathering PR3). Frozen contract:
// docs/prd/intentional-gathering/headless-gathering-contract.md
//
// Consumes a narrow Sim-shaped host: every mutation and every read runs
// through the exact same Sim methods the browser/server hosts already use
// (buyItem, setHarvestPreference, harvestCorpse, corpseHarvestInfo), never a
// recreated purchase/admission gate. No sim.tick(), no direct inventory
// mutation, no rng of its own.

import { CORPSE_HARVEST_POPUP_RANGE } from '../src/sim/professions/corpse_harvest_inspection';
import {
  HARVEST_PREFERENCE_ALL_TOKEN,
  type HarvestPreference,
} from '../src/sim/professions/harvest_preference';
import type { Sim } from '../src/sim/sim';
import { dist2d, type Entity, INTERACT_RANGE } from '../src/sim/types';
import type { CorpseHarvestInfo } from '../src/world_api';
import { type GatheringRequest, parseGatheringRequest } from './gathering_protocol';

const FIELD_KIT_ITEM_ID = 'field_kit';
const VENDOR_PURCHASE_RANGE = INTERACT_RANGE + 2;
const INSPECT_LIST_CAP = 16;

/** The Sim members gathering commands need: the actor's own reads plus the
 *  exact command bodies (buyItem/setHarvestPreference/harvestCorpse/
 *  corpseHarvestInfo) every other host already dispatches through. */
export type GatheringSimHost = Pick<
  Sim,
  | 'player'
  | 'copper'
  | 'grid'
  | 'harvestPreference'
  | 'countItem'
  | 'buyItem'
  | 'setHarvestPreference'
  | 'harvestCorpse'
  | 'corpseHarvestInfo'
>;

export interface GatheringState {
  readonly preference: HarvestPreference | null;
  readonly copper: number;
  readonly fieldKitCount: number;
}

export interface GatheringVendorRow {
  readonly id: number;
  readonly name: string;
  readonly distance: number;
  readonly x: number;
  readonly z: number;
}

export type GatheringCorpseRow = CorpseHarvestInfo & {
  readonly distance: number;
  readonly x: number;
  readonly z: number;
};

export type GatheringReply =
  | {
      readonly ok: true;
      readonly verb: 'inspect';
      readonly state: GatheringState;
      readonly corpses: readonly GatheringCorpseRow[];
      readonly vendors: readonly GatheringVendorRow[];
    }
  | { readonly ok: true; readonly verb: 'buy_field_kit'; readonly state: GatheringState }
  | { readonly ok: true; readonly verb: 'set_preference'; readonly state: GatheringState }
  | { readonly ok: true; readonly verb: 'harvest'; readonly state: GatheringState }
  | {
      readonly ok: false;
      readonly verb: 'buy_field_kit';
      readonly state: GatheringState;
      readonly reason: 'purchase_refused';
    }
  | {
      readonly ok: false;
      readonly verb: 'set_preference';
      readonly state: GatheringState;
      readonly reason: 'preference_refused';
    }
  | {
      readonly ok: false;
      readonly verb: 'harvest';
      readonly state: GatheringState;
      readonly reason: 'harvest_refused';
    }
  | { readonly ok: false; readonly reason: 'invalid_request' }
  | { readonly ok: false; readonly reason: 'reset_required' };

function currentState(sim: GatheringSimHost): GatheringState {
  return {
    preference: sim.harvestPreference,
    copper: sim.copper,
    fieldKitCount: sim.countItem(FIELD_KIT_ITEM_ID),
  };
}

/** The canonical preference round-trips through its own wire token
 *  (HARVEST_PREFERENCE_ALL_TOKEN or the material item id), so re-applying it
 *  through setHarvestPreference's string entry point re-parses to the exact
 *  same value the caller already validated at parse time. */
function harvestPreferenceToken(preference: HarvestPreference): string {
  return preference.kind === 'material' ? preference.itemId : HARVEST_PREFERENCE_ALL_TOKEN;
}

function byDistanceThenId(player: Entity, a: Entity, b: Entity): number {
  const delta = dist2d(player.pos, a.pos) - dist2d(player.pos, b.pos);
  return delta !== 0 ? delta : a.id - b.id;
}

/** Enumerate via the spatial grid first (cheap kind/dead filter), then run the
 *  disclosure-safe corpseHarvestInfo read only over the sorted, capped
 *  result: harvest-only bodies included, denials such as missing kit or an
 *  unavailable chosen material included, never a corpse life token or
 *  unrolled reward. */
function inspectCorpses(sim: GatheringSimHost): GatheringCorpseRow[] {
  const player = sim.player;
  const candidates: Entity[] = [];
  sim.grid.forEachInRadius(player.pos.x, player.pos.z, CORPSE_HARVEST_POPUP_RANGE, (e) => {
    if (e.kind === 'mob' && e.dead) candidates.push(e);
  });
  candidates.sort((a, b) => byDistanceThenId(player, a, b));
  const rows: GatheringCorpseRow[] = [];
  for (const entity of candidates) {
    if (rows.length >= INSPECT_LIST_CAP) break;
    const info = sim.corpseHarvestInfo(entity.id);
    if (info)
      rows.push({
        ...info,
        distance: dist2d(player.pos, entity.pos),
        x: entity.pos.x,
        z: entity.pos.z,
      });
  }
  return rows;
}

/** Stock/reach facts only, never a purchase-admission promise: an NPC row
 *  means it stocks the kit and sits within the real buy reach
 *  (INTERACT_RANGE + 2, sim/items.ts's own buyItem gate). */
function inspectVendors(sim: GatheringSimHost): GatheringVendorRow[] {
  const player = sim.player;
  const candidates: Entity[] = [];
  sim.grid.forEachInRadius(player.pos.x, player.pos.z, VENDOR_PURCHASE_RANGE, (e) => {
    if (e.kind === 'npc' && e.vendorItems.includes(FIELD_KIT_ITEM_ID)) candidates.push(e);
  });
  candidates.sort((a, b) => byDistanceThenId(player, a, b));
  return candidates.slice(0, INSPECT_LIST_CAP).map((e) => ({
    id: e.id,
    name: e.name,
    distance: dist2d(player.pos, e.pos),
    x: e.pos.x,
    z: e.pos.z,
  }));
}

function inspect(sim: GatheringSimHost): GatheringReply {
  return {
    ok: true,
    verb: 'inspect',
    state: currentState(sim),
    corpses: inspectCorpses(sim),
    vendors: inspectVendors(sim),
  };
}

/** Success is inferred ONLY from the kit count really increasing by exactly
 *  one: sim.buyItem is void and this never recreates its price/range/stock
 *  gates. */
function buyFieldKit(sim: GatheringSimHost, npcId: number): GatheringReply {
  const before = sim.countItem(FIELD_KIT_ITEM_ID);
  sim.buyItem(npcId, FIELD_KIT_ITEM_ID);
  const after = sim.countItem(FIELD_KIT_ITEM_ID);
  const state = currentState(sim);
  return after === before + 1
    ? { ok: true, verb: 'buy_field_kit', state }
    : { ok: false, verb: 'buy_field_kit', state, reason: 'purchase_refused' };
}

function setPreference(sim: GatheringSimHost, preference: string): GatheringReply {
  sim.setHarvestPreference(preference);
  const state = currentState(sim);
  return state.preference !== null && harvestPreferenceToken(state.preference) === preference
    ? { ok: true, verb: 'set_preference', state }
    : { ok: false, verb: 'set_preference', state, reason: 'preference_refused' };
}

/** sim.harvestCorpse admits a timed start only; it never means the reward
 *  landed. */
function harvest(sim: GatheringSimHost, corpseId: number): GatheringReply {
  const started = sim.harvestCorpse(corpseId);
  const state = currentState(sim);
  return started
    ? { ok: true, verb: 'harvest', state }
    : { ok: false, verb: 'harvest', state, reason: 'harvest_refused' };
}

function dispatch(sim: GatheringSimHost, request: GatheringRequest): GatheringReply {
  switch (request.verb) {
    case 'inspect':
      return inspect(sim);
    case 'buy_field_kit':
      return buyFieldKit(sim, request.npcId);
    case 'set_preference':
      return setPreference(sim, request.preference);
    case 'harvest':
      return harvest(sim, request.corpseId);
  }
}

/** Parse then dispatch one gathering request. Parsing runs BEFORE the reset
 *  check, so a malformed request refuses `invalid_request` even pre-reset;
 *  only a well-formed request against a null (pre-reset) sim refuses
 *  `reset_required`. Never advances sim time or the episode step. */
export function executeGatheringCommand(
  sim: GatheringSimHost | null,
  raw: unknown,
): GatheringReply {
  const parsed = parseGatheringRequest(raw);
  if (!parsed.ok) return { ok: false, reason: 'invalid_request' };
  if (!sim) return { ok: false, reason: 'reset_required' };
  return dispatch(sim, parsed.request);
}
