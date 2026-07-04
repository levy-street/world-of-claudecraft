// The Envoys' Hall flow (content: content/valdris/envoys.ts): the one-shot
// faction-and-race oath every character swears in person, and the ferry travel
// network it opens between the Landing and the three realm hubs.
//
// System module behind the SimContext seam (src/sim/CLAUDE.md): functions only,
// no module state, no rng, no clock. The teleport is the dungeon-door primitive
// (set pos + prevPos, rebucket, drop target/auto-attack): the client's zone
// veil fires on the position jump by itself. All checks are server-authoritative
// re-checks of what the client UI already gates: a forged command cannot swear
// twice, swear early, swear remotely, or travel from nowhere.
//
// Player-facing emits here are English literals; each has a matcher RULE in
// src/ui/sim_i18n.ts (the S3 two-file contract).

import { factionOfRace, isPlayerRace } from './content/races';
import { ENVOY_HALL_Z, ENVOY_NPC_IDS, FERRY_NPC_IDS } from './content/valdris/envoys';
import { ZONES } from './data';
import type { SimContext } from './sim_context';
import { dist2d, type Entity, INTERACT_RANGE, type PlayerFaction } from './types';

// The Envoys hear an oath from level 18 (the island paces to 20; the realms
// open at 20, so a slightly early oath lands on orange-difficulty camps, the
// classic early-travel experience, never a wall).
export const ENVOY_CHOICE_MIN_LEVEL = 18;

// Proximity slack matches the vendor rule (items.ts buyItem: INTERACT_RANGE+2).
const TRAVEL_RANGE = INTERACT_RANGE + 2;

const REALM_ZONE_IDS: Record<PlayerFaction, string> = {
  kael: 'kael_empire',
  veth: 'veth_confederation',
  ossara: 'ossara_domain',
};

// English faction names as the sim emits them (matched by sim_i18n RULES).
const FACTION_OATH_NAMES: Record<PlayerFaction, string> = {
  kael: 'the Kael Empire',
  veth: 'the Confederation of Veth',
  ossara: 'the Domain of Ossara',
};

function liveNpcNear(ctx: SimContext, e: Entity, ids: readonly string[]): Entity | null {
  for (const other of ctx.entities.values()) {
    if (other.kind !== 'npc' || other.dead) continue;
    if (!ids.includes(other.templateId)) continue;
    if (dist2d(e.pos, other.pos) <= TRAVEL_RANGE) return other;
  }
  return null;
}

// The dungeon-door teleport primitive (instances/dungeons.ts pattern): position
// and prevPos move together or resolveMovement sweeps the whole world next tick.
function teleport(ctx: SimContext, e: Entity, x: number, z: number): void {
  e.pos = ctx.groundPos(x, z);
  e.prevPos = { ...e.pos };
  ctx.rebucket(e);
  e.targetId = null;
  e.autoAttack = false;
}

function realmHubArrival(faction: PlayerFaction): { x: number; z: number } | null {
  const zone = ZONES.find((z) => z.id === REALM_ZONE_IDS[faction]);
  if (!zone) return null;
  // Land at the hub's south edge, beside the ferry, not on top of the crowd.
  return { x: zone.hub.x + 3, z: zone.hub.z - 16 };
}

/** The one-shot oath: validates race, level, the unsworn state, and standing
 *  before an Envoy, then swears the character and carries them to their new
 *  realm's hub. Returns true when the oath was sworn. */
export function chooseRaceAtEnvoy(ctx: SimContext, race: string, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const { meta, e } = r;
  if (meta.race) {
    ctx.error(e.id, 'Your oath is already sworn.');
    return false;
  }
  if (!isPlayerRace(race)) {
    ctx.error(e.id, 'The Envoys do not recognize that people.');
    return false;
  }
  if (e.level < ENVOY_CHOICE_MIN_LEVEL) {
    ctx.error(e.id, `The Envoys will hear your oath at level ${ENVOY_CHOICE_MIN_LEVEL}.`);
    return false;
  }
  if (!liveNpcNear(ctx, e, Object.values(ENVOY_NPC_IDS))) {
    ctx.error(e.id, 'You must stand before an Envoy to swear your oath.');
    return false;
  }
  if (!ctx.setPlayerRace(e.id, race)) return false;
  const faction = factionOfRace(race);
  const arrival = realmHubArrival(faction);
  ctx.emit({
    type: 'log',
    pid: e.id,
    text: `You have sworn your oath to ${FACTION_OATH_NAMES[faction]}.`,
    color: '#ffd100',
  });
  if (arrival) teleport(ctx, e, arrival.x, arrival.z);
  return true;
}

/** Ferry travel for the sworn: a realm-hub ferry carries anyone back to the
 *  Envoys' Hall; a player's own Envoy carries them out to their realm hub.
 *  Unsworn players are pointed at the oath instead. */
export function travelWithFerry(ctx: SimContext, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const { meta, e } = r;
  if (liveNpcNear(ctx, e, Object.values(FERRY_NPC_IDS))) {
    teleport(ctx, e, 0, ENVOY_HALL_Z - 8);
    return true;
  }
  const envoy = liveNpcNear(ctx, e, Object.values(ENVOY_NPC_IDS));
  if (envoy) {
    if (!meta.race) {
      ctx.error(e.id, 'Swear your oath first: passage follows allegiance.');
      return false;
    }
    const faction = factionOfRace(meta.race);
    if (envoy.templateId !== ENVOY_NPC_IDS[faction]) {
      ctx.error(e.id, 'Your own Envoy holds your passage.');
      return false;
    }
    const arrival = realmHubArrival(faction);
    if (!arrival) return false;
    teleport(ctx, e, arrival.x, arrival.z);
    return true;
  }
  ctx.error(e.id, 'There is no passage from here.');
  return false;
}
