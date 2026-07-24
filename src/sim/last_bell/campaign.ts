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
import { acceptQuest } from '../quests/quest_commands';
import { startScenario } from '../scenarios/scenarios';
import { playSceneForPlayer } from '../scenes/scenes';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

const Q0_ID = 'q_lb_q0_ashore';
const ARRIVAL_SCENE = 'scn_lb_q0_ashore';

// The two ferry landings: the mainland dock at the vale's east point and
// the Gullhaven harbor pier. Boarding at one lands you at the other.
const MAINLAND_DOCK = { x: 146, z: -52 };
const GULLHAVEN_PIER = { x: 299, z: 78 };

interface FixtureDef {
  templateId: 'lb_ferry' | 'lb_scenario_door';
  name: string;
  x: number;
  z: number;
  scenarioId?: string;
}

const FIXTURES: readonly FixtureDef[] = [
  { templateId: 'lb_ferry', name: 'The Farshore Ferry', x: MAINLAND_DOCK.x, z: MAINLAND_DOCK.z },
  { templateId: 'lb_ferry', name: 'The Farshore Ferry', x: GULLHAVEN_PIER.x, z: GULLHAVEN_PIER.z },
  // The Tidemill door at the Watch Meadow's western edge (Q0's climax).
  {
    templateId: 'lb_scenario_door',
    name: 'The Tidemill',
    x: 352,
    z: -8,
    scenarioId: 'sc_lb_q0_tidemill',
  },
];

// World-init hook (Sim ctor, after escorts): spawn the campaign fixtures.
export function initLastBellCampaign(ctx: SimContext): void {
  for (const def of FIXTURES) {
    const obj = createGroundObject(ctx.nextId++, '', def.name, ctx.groundPos(def.x, def.z));
    obj.templateId = def.templateId;
    obj.objectItemId = null;
    obj.lootable = true; // interactable
    if (def.scenarioId !== undefined) obj.scenarioId = def.scenarioId;
    ctx.addEntity(obj);
  }
}

function boardFerry(ctx: SimContext, obj: Entity, pid: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const fromMainland = obj.pos.x < 200;
  const dest = fromMainland ? GULLHAVEN_PIER : MAINLAND_DOCK;
  // First crossing: the campaign begins. acceptQuest is a no-op error path
  // when already active; gate on the log so re-rides stay silent.
  const firstCrossing =
    fromMainland && !r.meta.questsDone.has(Q0_ID) && !r.meta.questLog.has(Q0_ID);
  if (firstCrossing) acceptQuest(ctx, Q0_ID, r.meta.entityId);
  const p = r.e;
  p.pos = ctx.groundPos(dest.x, dest.z);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.targetId = null;
  p.autoAttack = false;
  ctx.emit({
    type: 'log',
    text: fromMainland
      ? 'The ferry noses through the strait and puts you ashore at Gullhaven.'
      : 'The ferry carries you back across the strait to the mainland dock.',
    color: '#b9f',
    pid: r.meta.entityId,
  });
  if (firstCrossing) playSceneForPlayer(ctx, r.meta.entityId, ARRIVAL_SCENE);
}

// Interaction arm (interaction.ts): true when the target was a Last Bell
// fixture and the interact was consumed.
export function tryLastBellInteract(ctx: SimContext, target: Entity, pid: number): boolean {
  if (target.templateId === 'lb_ferry') {
    boardFerry(ctx, target, pid);
    return true;
  }
  if (target.templateId === 'lb_scenario_door' && target.scenarioId !== undefined) {
    startScenario(ctx, target.scenarioId, pid);
    return true;
  }
  return false;
}
