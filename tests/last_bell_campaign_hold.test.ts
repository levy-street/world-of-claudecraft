// The PRE-RELEASE HOLD on the Last Bell chain (the owner decision recorded on
// Q0 in src/sim/content/last_bell_campaign.ts): the island, the ferry, its
// cinematics, and the cast all ship, but every island quest stays retired
// until the chain is finished, because a quest players can pick up cannot be
// taken back after release. This suite pins the HELD behavior; the open
// campaign machinery is covered by tests/last_bell_q0.test.ts and friends,
// which un-hold the data per file.
//
// Unlike those suites, this file must NOT touch the retired flags: it runs
// against the exact data players would ship with.
import { describe, expect, it } from 'vitest';
import { QUESTS } from '../src/sim/data';
import { GULLHAVEN_HARBOR, MAINLAND_HARBOR } from '../src/sim/harbor_layout';
import { computeQuestState } from '../src/sim/quests/quest_commands';
import { scenarioRunFor } from '../src/sim/scenarios/scenarios';
import { answerSceneChoice } from '../src/sim/scenes/choices';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

const Q0 = 'q_lb_q0_ashore';
const OUT = 'ch_lb_ferry_fare_out';
const BACK = 'ch_lb_ferry_fare_back';

function makeSim(): Sim {
  const sim = new Sim({ seed: 4242, playerClass: 'warrior', playerName: 'Ash', devCommands: true });
  sim.player.level = 6;
  return sim;
}

function teleport(sim: Sim, x: number, z: number): void {
  const pos = sim.groundPos(x, z);
  sim.player.pos = { ...pos };
  sim.player.prevPos = { ...pos };
  sim.rebucket(sim.player);
}

function keeper(sim: Sim, templateId: string): Entity | undefined {
  return [...sim.entities.values()].find((e) => e.templateId === templateId);
}

function board(sim: Sim, fromMainland: boolean): void {
  if (fromMainland) {
    teleport(sim, 238, -47.5);
    const ewald = keeper(sim, 'ferryman_ewald');
    expect(ewald).toBeTruthy();
    sim.player.targetId = ewald?.id ?? null;
  } else {
    teleport(sim, GULLHAVEN_HARBOR.boarding.x, GULLHAVEN_HARBOR.boarding.z);
    const islandEwald = keeper(sim, 'ferryman_ewald_gullhaven');
    expect(islandEwald).toBeTruthy();
    sim.player.targetId = islandEwald?.id ?? null;
  }
  sim.interact();
}

function collect(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

function sceneOps(events: SimEvent[]): Extract<SimEvent, { type: 'scene' }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: 'scene' }> => e.type === 'scene');
}

describe('the hold itself, in the shipped data', () => {
  it('retires every island quest, campaign and zone side alike', () => {
    const island = Object.keys(QUESTS).filter(
      (id) => id.startsWith('q_lb_') || id.startsWith('q_fs_'),
    );
    // Vacuity floor: the chain plus the nine Farshore quests really are here.
    expect(island.length).toBeGreaterThanOrEqual(10);
    for (const id of island) {
      expect(QUESTS[id].retired, `${id} must stay retired while the chain is held`).toBe(true);
    }
  });

  it('resolves every island quest unavailable for an eligible fresh player', () => {
    for (const id of [Q0, 'q_fs_moss_and_mending', 'q_fs_bram_come_home']) {
      expect(computeQuestState(id, new Map(), new Set(), 10)).toBe('unavailable');
    }
  });
});

describe('the ferry while the chain is held', () => {
  it('a paid crossing lands at Gullhaven with no quest, no error, and the voyage', () => {
    const sim = makeSim();
    const meta = sim.ctx.players.get(sim.playerId);
    expect(meta).toBeTruthy();
    if (!meta) return;
    meta.copper = 50;
    board(sim, true);
    expect(answerSceneChoice(sim.ctx, OUT, 'pay')).toBe(true);
    const events = collect(sim, 2);
    expect(
      Math.hypot(
        sim.player.pos.x - GULLHAVEN_HARBOR.deckArrival.x,
        sim.player.pos.z - GULLHAVEN_HARBOR.deckArrival.z,
      ),
    ).toBeLessThan(3);
    // The hold's whole point: the crossing grants NOTHING a player can do.
    expect(sim.questLog.has(Q0)).toBe(false);
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    // The showpiece still plays: the first crossing is the spliced voyage.
    const ops = sceneOps(events);
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((e) => e.sceneId === 'scn_lb_q0_voyage')).toBe(true);
    // And the once-per-rider marker persisted onto the campaign flags.
    expect(meta.campaignFlags.has('lb_held_voyage_seen')).toBe(true);
  });

  it('a re-ride is plain travel: the short departure, never the voyage again', () => {
    const sim = makeSim();
    const meta = sim.ctx.players.get(sim.playerId);
    if (!meta) return;
    meta.copper = 100;
    board(sim, true);
    answerSceneChoice(sim.ctx, OUT, 'pay');
    collect(sim, 45 * 20); // let the voyage finish
    board(sim, false);
    answerSceneChoice(sim.ctx, BACK, 'pay');
    collect(sim, 35 * 20); // and the return departure
    board(sim, true);
    answerSceneChoice(sim.ctx, OUT, 'pay');
    const ops = sceneOps(collect(sim, 2));
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((e) => e.sceneId === 'scn_lb_ferry_depart_out')).toBe(true);
  });

  it('waives a broke rider exactly once, keyed on the held marker', () => {
    const sim = makeSim();
    const meta = sim.ctx.players.get(sim.playerId);
    if (!meta) return;
    meta.copper = 0;
    board(sim, true);
    answerSceneChoice(sim.ctx, OUT, 'pay');
    const firstX = sim.player.pos.x;
    expect(firstX).toBeGreaterThan(600); // crossed on the waiver
    collect(sim, 45 * 20);
    board(sim, false);
    const events = collect(sim, 1);
    answerSceneChoice(sim.ctx, BACK, 'pay');
    const refusals = [...events, ...collect(sim, 1)].filter(
      (e) => e.type === 'error' && e.text === 'Not enough money.',
    );
    expect(refusals.length).toBeGreaterThan(0);
    expect(sim.player.pos.x).toBeGreaterThan(600); // still on the island
  });
});

describe('the Tidemill door while the chain is held', () => {
  it('spawns as inert scenery and starts no scenario on interact', () => {
    const sim = makeSim();
    const door = [...sim.entities.values()].find((e) => e.templateId === 'lb_scenario_door');
    expect(door).toBeTruthy();
    if (!door) return;
    expect(door.lootable).toBe(false);
    teleport(sim, door.pos.x + 1, door.pos.z + 1);
    sim.player.targetId = door.id;
    sim.interact();
    collect(sim, 2);
    expect(scenarioRunFor(sim.ctx, sim.playerId)).toBeFalsy();
    expect(sim.sceneActiveForLocalPlayer()).toBe(false);
  });
});
