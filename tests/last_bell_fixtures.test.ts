// The Last Bell world fixtures through the real Sim: the two ferry boarding
// points (at the harbors' gangplanks), the Tidemill scenario door, and the
// Breach maw spawn as ground objects with their pinned templateIds and
// positions; the breach is pure scenery (interact must ignore it) while the
// ferries stay interactable. Also pins the H1 tear-out: the interim landing
// docks are gone (the authored harbors replaced them, see
// tests/last_bell_harbor.test.ts) while the fishing jetties survive.
import { describe, expect, it } from 'vitest';
import { FARSHORE_PROPS } from '../src/sim/content/farshore';
import { ZONE1_PROPS } from '../src/sim/content/zone1';
import { GULLHAVEN_HARBOR, MAINLAND_HARBOR } from '../src/sim/harbor_layout';
import { answerSceneChoice } from '../src/sim/scenes/choices';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { FARSHORE_BREACH } from '../src/sim/world';

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

function fixtures(sim: Sim, templateId: string): Entity[] {
  return [...sim.entities.values()].filter((e) => e.templateId === templateId);
}

describe('Last Bell campaign fixtures', () => {
  it('spawns the ferries, the Tidemill door, and the Breach at their pinned spots', () => {
    const sim = makeSim();

    const ferries = fixtures(sim, 'lb_ferry');
    expect(ferries.map((f) => ({ x: f.pos.x, z: f.pos.z }))).toEqual(
      expect.arrayContaining([
        { x: 239, z: -48 },
        { x: 727.5, z: 130 },
      ]),
    );
    expect(ferries).toHaveLength(2);
    // The fixtures stand at the harbors' gangplanks: the layout is the single
    // source for the boarding anchors, so pin the identity, not a copy.
    expect(ferries.map((f) => ({ x: f.pos.x, z: f.pos.z }))).toEqual(
      expect.arrayContaining([
        { x: MAINLAND_HARBOR.boarding.x, z: MAINLAND_HARBOR.boarding.z },
        { x: GULLHAVEN_HARBOR.boarding.x, z: GULLHAVEN_HARBOR.boarding.z },
      ]),
    );
    for (const ferry of ferries) {
      expect(ferry.name).toBe('The Farshore Ferry');
      // Scenery: the fare lives on the gangplank keepers' gossip button, so
      // the mooring marker itself is never interactable.
      expect(ferry.lootable).toBe(false);
    }

    const doors = fixtures(sim, 'lb_scenario_door');
    expect(doors).toHaveLength(1);
    expect(doors[0].name).toBe('The Tidemill');
    expect({ x: doors[0].pos.x, z: doors[0].pos.z }).toEqual({ x: 930, z: 12 });
    expect(doors[0].lootable).toBe(true);

    const breaches = fixtures(sim, 'lb_breach_maw');
    expect(breaches).toHaveLength(1);
    expect(breaches[0].name).toBe('The Breach');
    expect({ x: breaches[0].pos.x, z: breaches[0].pos.z }).toEqual({
      x: FARSHORE_BREACH.x,
      z: FARSHORE_BREACH.z,
    });
    // Pin the anchor itself so the fixture cannot silently drift off the crater.
    expect(FARSHORE_BREACH).toEqual({ x: 1012, z: -172 });
  });

  it('ignores interact on the Breach: it is scenery, not a device', () => {
    const sim = makeSim();
    const breach = fixtures(sim, 'lb_breach_maw')[0];
    expect(breach.lootable).toBe(false);

    teleport(sim, breach.pos.x + 1.5, breach.pos.z + 1.5);
    const before = { ...sim.player.pos };

    // Targeted interact: the lootable=false gate must reject it before any
    // lb_ dispatch (and tryLastBellInteract has no lb_breach_maw arm anyway).
    sim.player.targetId = breach.id;
    sim.interact();
    // Untargeted interact right next to it: the proximity scan must skip it too.
    sim.player.targetId = null;
    sim.interact();
    for (let i = 0; i < 5; i++) sim.tick();

    // Nothing happened: no travel, no quest, no scenario, and the breach is
    // untouched (not picked up, not flagged for respawn).
    expect(sim.player.pos).toEqual(before);
    expect(sim.questLog.has('q_lb_q0_ashore')).toBe(false);
    expect(sim.ctx.scenarioRuns.size).toBe(0);
    expect(sim.entities.get(breach.id)).toBe(breach);
    expect(breach.lootable).toBe(false);
    expect(breach.dead).toBe(false);
  });

  it('the keepers sell passage: talk, pay, cross (the moorings stay scenery)', () => {
    const sim = makeSim();
    const meta = sim.ctx.players.get(sim.playerId);
    expect(meta).toBeTruthy();
    if (!meta) return;
    meta.copper = 25;
    // The mooring marker itself ignores interact, exactly like the breach.
    const mainlandFerry = fixtures(sim, 'lb_ferry').find(
      (f) => f.pos.x === MAINLAND_HARBOR.boarding.x,
    );
    expect(mainlandFerry).toBeTruthy();
    if (!mainlandFerry) return;
    teleport(sim, 238, -47.5);
    sim.player.targetId = mainlandFerry.id;
    sim.interact();
    expect(sim.ctx.activeChoices.size).toBe(0);
    expect(sim.player.pos.x).toBeGreaterThan(200);

    // Talking to Ewald opens the fare; paying crosses.
    const ewald = [...sim.entities.values()].find((e) => e.templateId === 'ferryman_ewald');
    expect(ewald).toBeTruthy();
    if (!ewald) return;
    sim.player.targetId = ewald.id;
    sim.interact();
    expect(answerSceneChoice(sim.ctx, 'ch_lb_ferry_fare_out', 'pay')).toBe(true);
    expect(meta.copper).toBe(15);
    expect(
      Math.hypot(
        sim.player.pos.x - GULLHAVEN_HARBOR.deckArrival.x,
        sim.player.pos.z - GULLHAVEN_HARBOR.deckArrival.z,
      ),
    ).toBeLessThan(3);

    // The cinematic begins on the destination ship and walks the rider down
    // the gangplank. Step back aboard to take the return fare immediately.
    teleport(sim, 727, 131);
    const odda = [...sim.entities.values()].find((e) => e.templateId === 'ferrykeeper_odda');
    expect(odda).toBeTruthy();
    if (!odda) return;
    sim.player.targetId = odda.id;
    sim.interact();
    expect(answerSceneChoice(sim.ctx, 'ch_lb_ferry_fare_back', 'pay')).toBe(true);
    expect(meta.copper).toBe(5);
    expect(
      Math.hypot(
        sim.player.pos.x - MAINLAND_HARBOR.deckArrival.x,
        sim.player.pos.z - MAINLAND_HARBOR.deckArrival.z,
      ),
    ).toBeLessThan(3);
  });

  it('tore out the interim landing docks and kept the fishing jetties', () => {
    // H1 replaced the plank-kit landings with the authored harbors: the two
    // colinear mainland sections at (172 / 177.3, -48) and Gullhaven's town
    // pier dock at (781, 122) are gone.
    expect(ZONE1_PROPS.docks.filter((d) => d.z === -48)).toHaveLength(0);
    expect(FARSHORE_PROPS.docks.filter((d) => d.x === 781 && d.z === 122)).toHaveLength(0);
    // The fishing flavor stays: Demi's vale jetty and the Landing's jetty.
    expect(ZONE1_PROPS.docks.some((d) => d.x === -64 && d.z === 60)).toBe(true);
    expect(FARSHORE_PROPS.docks.some((d) => d.x === 778 && d.z === -36)).toBe(true);
  });
});
