// mob/social_aggro.ts: a fleeing mob rallies only its LOCAL idle same-family allies
// (within FLEE_HELP_RADIUS). The flee arm calls this each tick and turns the fleer back
// on the first non-empty rally, so only the first local cluster is pulled. Driven through
// a real Sim so the spatial grid, MOBS table, and threat seeding are the live ones; the
// module is also exercised directly for its return count.
import { describe, expect, it } from 'vitest';
import { FLEE_HELP_RADIUS, rallyFleeingAllies } from '../src/sim/mob/social_aggro';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const makeSim = () => new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });

function wildMobs(sim: Sim): Entity[] {
  return [...sim.entities.values()].filter(
    (e) => e.kind === 'mob' && !e.dead && e.ownerId === null,
  );
}

function placeAlly(ally: Entity, near: Entity, dx: number, templateId = 'gravecaller_cultist') {
  ally.templateId = templateId;
  ally.hostile = true;
  ally.dead = false;
  ally.aiState = 'idle';
  ally.aggroTargetId = null;
  ally.pos = { x: near.pos.x + dx, z: near.pos.z, y: near.pos.y };
  ally.prevPos = { ...ally.pos };
  ally.spawnPos = { ...ally.pos };
}

describe('rallyFleeingAllies', () => {
  it('pulls an idle same-family ally inside the help radius and returns the count', () => {
    const sim = makeSim();
    const [fleer, ally] = wildMobs(sim);
    fleer.templateId = 'gravecaller_cultist';
    fleer.pos = { x: sim.player.pos.x + 3, z: sim.player.pos.z, y: sim.player.pos.y };
    placeAlly(ally, fleer, 2);

    (sim as any).grid.refresh(sim.entities.values());
    const pulled = rallyFleeingAllies((sim as any).ctx, fleer, sim.player);

    expect(pulled).toBe(1);
    expect(ally.aiState).toBe('chase');
    expect(ally.aggroTargetId).toBe(sim.playerId);
  });

  it('does NOT pull an ally beyond the help radius, a different family, or one already engaged', () => {
    const sim = makeSim();
    const mobs = wildMobs(sim);
    const fleer = mobs[0];
    fleer.templateId = 'gravecaller_cultist';
    fleer.pos = { x: sim.player.pos.x + 3, z: sim.player.pos.z, y: sim.player.pos.y };
    const far = mobs[1];
    placeAlly(far, fleer, FLEE_HELP_RADIUS + 2); // just outside the local help radius
    const wrongFamily = mobs[2];
    placeAlly(wrongFamily, fleer, 2, 'mire_prowler'); // adjacent but beast family (no flee rally)
    const busy = mobs[3];
    placeAlly(busy, fleer, 2);
    busy.aiState = 'chase'; // already engaged, not idle

    (sim as any).grid.refresh(sim.entities.values());
    const pulled = rallyFleeingAllies((sim as any).ctx, fleer, sim.player);

    expect(pulled).toBe(0);
    expect(far.aiState).toBe('idle');
    expect(wrongFamily.aiState).toBe('idle');
  });

  it('rallies a tight local cluster but leaves the rest of the pack idle (no chain)', () => {
    const sim = makeSim();
    const mobs = wildMobs(sim);
    const fleer = mobs[0];
    fleer.templateId = 'gravecaller_cultist';
    fleer.pos = { x: sim.player.pos.x + 3, z: sim.player.pos.z, y: sim.player.pos.y };
    const local = mobs[1];
    placeAlly(local, fleer, FLEE_HELP_RADIUS - 1); // inside: joins
    const downLane = mobs[2];
    placeAlly(downLane, fleer, FLEE_HELP_RADIUS + 4); // beyond: stays idle, no chain

    (sim as any).grid.refresh(sim.entities.values());
    const pulled = rallyFleeingAllies((sim as any).ctx, fleer, sim.player);

    expect(pulled).toBe(1);
    expect(local.aiState).toBe('chase');
    expect(downLane.aiState).toBe('idle');
  });

  it('uses a small, local help radius (5yd)', () => {
    expect(FLEE_HELP_RADIUS).toBe(5);
  });

  it('is deterministic: same setup pulls the same allies', () => {
    const run = () => {
      const sim = makeSim();
      const [fleer, ally] = wildMobs(sim);
      fleer.templateId = 'gravecaller_cultist';
      fleer.pos = { x: sim.player.pos.x + 3, z: sim.player.pos.z, y: sim.player.pos.y };
      placeAlly(ally, fleer, 2);
      (sim as any).grid.refresh(sim.entities.values());
      return rallyFleeingAllies((sim as any).ctx, fleer, sim.player);
    };
    expect(run()).toEqual(run());
  });
});
