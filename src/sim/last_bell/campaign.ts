// Last Bell campaign world systems: the ferry crossing, the scenario entry
// doors, and campaign fixture spawning. Behavior only; content (quests,
// scenes, scenarios, cast) is data-as-code in content/last_bell_campaign.ts.
//
// The ferry is the campaign's front door: boarding on the mainland accepts
// Q0 (once), carries the player to Gullhaven harbor, and plays the Ashore
// arrival scene on the FIRST crossing. Later boardings are plain travel
// both ways (the Ferrywalk sandbar remains the walking route).
//
// Fixture spawning runs in the Sim ctor after escorts, draws no rng, and
// consumes entity ids (a deliberate world shift; the parity goldens were
// re-minted with it, see the commit that landed this module).

import { createGroundObject } from '../entity';
import { GULLHAVEN_HARBOR, MAINLAND_HARBOR } from '../harbor_layout';
import { acceptQuest } from '../quests/quest_commands';
import { startScenario } from '../scenarios/scenarios';
import { startChoiceForPlayer } from '../scenes/choices';
import { playSceneForPlayer } from '../scenes/scenes';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { FARSHORE_BREACH } from '../world';

const Q0_ID = 'q_lb_q0_ashore';
// The first crossing plays the spliced voyage (departure + Q0 arrival, one
// Esc skips both halves); re-rides get the short departure cinematic.
const VOYAGE_SCENE = 'scn_lb_q0_voyage';
const DEPART_OUT_SCENE = 'scn_lb_ferry_depart_out';
const DEPART_BACK_SCENE = 'scn_lb_ferry_depart_back';

// The fare (H2): each rider pays their own passage through the keeper's
// gossip button. Kept low on purpose; the campaign is never money-gated at
// its front door (a broke first-timer rides free, below).
export const FERRY_FARE_COPPER = 10;
export const FARE_CHOICE_OUT = 'ch_lb_ferry_fare_out';
export const FARE_CHOICE_BACK = 'ch_lb_ferry_fare_back';

// Ewald's gossip fare option at either post (owner spec: talk to the ferryman, press
// the buy button, sail). One source of truth for BOTH the client button
// (quest_dialog_controller renders promptKey with the price and answers the
// choice) and the sim talk arm below.
export function ferryFareOfferFor(
  templateId: string | undefined,
): { choiceId: string; promptKey: string } | null {
  if (templateId === 'ferryman_ewald') {
    return { choiceId: FARE_CHOICE_OUT, promptKey: 'lb.fare.promptOut' };
  }
  if (templateId === 'ferryman_ewald_gullhaven') {
    return { choiceId: FARE_CHOICE_BACK, promptKey: 'lb.fare.promptBack' };
  }
  return null;
}

// The two ferry landings: the mainland harbor at the vale's east point and
// the Gullhaven harbor. Boarding at one lands you at the other. The harbor
// layout is the single source for both anchors: the boarding fixtures stand
// at each harbor's gangplank (the railing gap facing the ship berth), and
// arrivals appear at the destination ship's deck arrival point so the
// scene can walk the real player down the gangplank.
const MAINLAND_DECK_ARRIVAL = MAINLAND_HARBOR.deckArrival;
const GULLHAVEN_DECK_ARRIVAL = GULLHAVEN_HARBOR.deckArrival;
const MAINLAND_BOARD = MAINLAND_HARBOR.boarding;
const GULLHAVEN_BOARD = GULLHAVEN_HARBOR.boarding;

interface FixtureDef {
  templateId: 'lb_ferry' | 'lb_scenario_door' | 'lb_breach_maw';
  name: string;
  x: number;
  z: number;
  scenarioId?: string;
}

const FIXTURES: readonly FixtureDef[] = [
  { templateId: 'lb_ferry', name: 'The Farshore Ferry', x: MAINLAND_BOARD.x, z: MAINLAND_BOARD.z },
  {
    templateId: 'lb_ferry',
    name: 'The Farshore Ferry',
    x: GULLHAVEN_BOARD.x,
    z: GULLHAVEN_BOARD.z,
  },
  // The Tidemill door at the Watch Meadow's western edge (Q0's climax).
  {
    templateId: 'lb_scenario_door',
    name: 'The Tidemill',
    x: 930,
    z: 12,
    scenarioId: 'sc_lb_q0_tidemill',
  },
  // The Breach: the campaign's wound in the world, anchored on the terrain
  // crater (FARSHORE_BREACH in world.ts, the single source of the coords).
  // Scenery, never a device: spawned non-lootable below so interact ignores it.
  {
    templateId: 'lb_breach_maw',
    name: 'The Breach',
    x: FARSHORE_BREACH.x,
    z: FARSHORE_BREACH.z,
  },
];

// World-init hook (Sim ctor, after escorts): spawn the campaign fixtures.
export function initLastBellCampaign(ctx: SimContext): void {
  for (const def of FIXTURES) {
    const obj = createGroundObject(ctx.nextId++, '', def.name, ctx.groundPos(def.x, def.z));
    obj.templateId = def.templateId;
    obj.objectItemId = null;
    // interaction.ts only considers ground objects with lootable=true. Only
    // the scenario door is a device; the breach maw AND the ferry moorings
    // are pure scenery (the fare runs through the keepers' gossip button,
    // never a dockside fixture, per the owner's spec).
    obj.lootable = def.templateId === 'lb_scenario_door';
    // The sim's object-respawn pass re-arms every non-lootable object once its
    // respawnTimer runs out, so park the breach's timer effectively forever
    // (finite on purpose: it stays JSON-safe wherever entities get serialized).
    if (!obj.lootable) obj.respawnTimer = Number.MAX_SAFE_INTEGER;
    if (def.scenarioId !== undefined) obj.scenarioId = def.scenarioId;
    ctx.addEntity(obj);
  }
}

function firstCrossingFor(ctx: SimContext, pid: number, fromMainland: boolean): boolean {
  const meta = ctx.players.get(pid);
  if (!meta) return false;
  return fromMainland && !meta.questsDone.has(Q0_ID) && !meta.questLog.has(Q0_ID);
}

// The crossing itself: teleport, Q0 hook, arrival scene. Runs only after the
// fare resolves (or the broke-first-timer waiver).
function crossFerry(ctx: SimContext, fromMainland: boolean, pid: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const dest = fromMainland ? GULLHAVEN_DECK_ARRIVAL : MAINLAND_DECK_ARRIVAL;
  // First crossing: the campaign begins. acceptQuest is a no-op error path
  // when already active; gate on the log so re-rides stay silent.
  const firstCrossing = firstCrossingFor(ctx, r.meta.entityId, fromMainland);
  if (firstCrossing) acceptQuest(ctx, Q0_ID, r.meta.entityId);
  const p = r.e;
  p.pos = ctx.groundPos(dest.x, dest.z);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.targetId = null;
  p.autoAttack = false;
  // Exact strings registered in the client matcher (sim_i18n.ts,
  // log.ferryEnter / log.ferryLeave): change both together or not at all.
  ctx.emit({
    type: 'log',
    text: fromMainland
      ? 'The ferry bell rings once, and the Farshore rises out of the spray.'
      : 'The bell answers from the vale, and the mainland takes you back.',
    color: '#b9f',
    pid: r.meta.entityId,
  });
  // The voyage presentation (H3): the rider already stands at the destination
  // ship's deck arrival point, ready for the authored gangplank walk. A skip
  // settles that walk at its pier endpoint.
  const departure = fromMainland ? DEPART_OUT_SCENE : DEPART_BACK_SCENE;
  playSceneForPlayer(ctx, r.meta.entityId, firstCrossing ? VOYAGE_SCENE : departure);
}

// The pay answer. A broke FIRST crossing rides free (with its own log line)
// so the campaign's front door never money-gates; any other empty purse gets
// the shared refusal and stays ashore.
function payFare(ctx: SimContext, fromMainland: boolean, pid: number): void {
  const r = ctx.resolve(pid);
  if (!r || r.e.dead) return;
  if (r.meta.copper >= FERRY_FARE_COPPER) {
    r.meta.copper -= FERRY_FARE_COPPER;
  } else if (firstCrossingFor(ctx, r.meta.entityId, fromMainland)) {
    // Exact string registered in the client matcher (sim_i18n.ts,
    // log.ferryFareWaived).
    ctx.emit({
      type: 'log',
      text: "Ewald waves the fare away. The first crossing is the town's.",
      color: '#b9f',
      pid: r.meta.entityId,
    });
  } else {
    ctx.error(r.meta.entityId, 'Not enough money.');
    return;
  }
  crossFerry(ctx, fromMainland, pid);
}

// The fare dialog opens only by talking to Ewald at a gangplank. The mooring
// fixtures stay inert scenery. Personal prompt: in a party each rider pays
// their own fare (leader-answers stays a story-claim rule).
function offerFare(ctx: SimContext, fromMainland: boolean, pid: number): void {
  const r = ctx.resolve(pid);
  if (!r || r.e.dead) return;
  startChoiceForPlayer(ctx, r.meta.entityId, fromMainland ? FARE_CHOICE_OUT : FARE_CHOICE_BACK, {
    values: { price: FERRY_FARE_COPPER },
    onResolve: (c, optionId) => {
      if (optionId === 'pay') payFare(c, fromMainland, pid);
    },
  });
}

// Interaction arm (interaction.ts): true when the target was a Last Bell
// fixture and the interact was consumed. Ferry moorings and the breach are
// inert scenery; consuming their targeted interaction prevents a nearby NPC
// from receiving the same key press. Only the scenario door is a device.
export function tryLastBellInteract(ctx: SimContext, target: Entity, pid: number): boolean {
  if (target.templateId === 'lb_scenario_door' && target.scenarioId !== undefined) {
    startScenario(ctx, target.scenarioId, pid);
    return true;
  }
  if (target.templateId === 'lb_ferry' || target.templateId === 'lb_breach_maw') return true;
  return false;
}

// NPC-talk arm (interaction.ts): an interact on either Ewald post opens the
// personal fare choice. The client's gossip fare button drives this
// (targetEntity + interact + answer 'pay'), so the flow is identical on
// every host and the server keeps full authority over the charge.
export function tryLastBellNpcTalk(ctx: SimContext, npc: Entity, pid: number): boolean {
  if (ferryFareOfferFor(npc.templateId) === null) return false;
  // The strait divides the world well east of the mainland harbor and well
  // west of the island: x 400 splits the two gangplanks on any layout drift.
  offerFare(ctx, npc.pos.x < 400, pid);
  return true;
}
