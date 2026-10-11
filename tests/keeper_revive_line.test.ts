// The Pale Keeper's revive tells the player they are back but weaker: the respawn
// event carries `sickness: 'resurrection'` exactly when The Keeper's Toll landed,
// so the HUD can swap "You feel rested and whole again." for the Toll line
// (hud.system.respawnKeeperToll). The penalty-free corpse run, and a Keeper
// revive below the Toll's minimum level, keep the plain event.

import { describe, expect, it } from 'vitest';
import { RES_SICKNESS_MIN_LEVEL } from '../src/sim/resurrection';
import { Sim } from '../src/sim/sim';
import { hasResurrectionSickness } from '../src/sim/spirit';
import type { Entity, SimEvent } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;

const makeSim = (): AnySim =>
  new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true }) as AnySim;

function releaseAsGhost(sim: AnySim): Entity {
  const p = sim.player as Entity;
  p.hp = 0;
  p.dead = true;
  sim.releaseSpirit();
  expect(p.ghost).toBe(true);
  return p;
}

function respawnEvents(events: SimEvent[]): SimEvent[] {
  return events.filter((ev) => ev.type === 'respawn');
}

describe('the Keeper revive respawn event', () => {
  it('is tagged with the Toll when the Pale Keeper revives a levelled character', () => {
    const sim = makeSim();
    sim.setPlayerLevel(RES_SICKNESS_MIN_LEVEL);
    const p = releaseAsGhost(sim);
    sim.drainEvents();
    expect(sim.resurrectAtSpiritHealer()).toBe(true);
    expect(hasResurrectionSickness(p)).toBe(true);
    const respawns = respawnEvents(sim.drainEvents());
    expect(respawns).toStrictEqual([{ type: 'respawn', pid: p.id, sickness: 'resurrection' }]);
  });

  it('stays plain below the Toll level, where the Keeper charges nothing', () => {
    const sim = makeSim();
    sim.setPlayerLevel(RES_SICKNESS_MIN_LEVEL - 1);
    const p = releaseAsGhost(sim);
    sim.drainEvents();
    expect(sim.resurrectAtSpiritHealer()).toBe(true);
    expect(hasResurrectionSickness(p)).toBe(false);
    expect(respawnEvents(sim.drainEvents())).toStrictEqual([{ type: 'respawn', pid: p.id }]);
  });

  it('stays plain on the penalty-free corpse run', () => {
    const sim = makeSim();
    sim.setPlayerLevel(RES_SICKNESS_MIN_LEVEL);
    const p = releaseAsGhost(sim);
    // Run the spirit back onto the body.
    p.pos.x = p.corpsePos!.x;
    p.pos.z = p.corpsePos!.z;
    sim.drainEvents();
    sim.resurrectAtCorpse();
    expect(p.dead).toBe(false);
    expect(hasResurrectionSickness(p)).toBe(false);
    expect(respawnEvents(sim.drainEvents())).toStrictEqual([{ type: 'respawn', pid: p.id }]);
  });
});
