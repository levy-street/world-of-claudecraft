// mob/social_aggro.ts: a fleeing mob rallies only its LOCAL idle same-family allies
// (within FLEE_HELP_RADIUS). The flee arm calls this each tick and turns the fleer back
// on the first non-empty rally, so only the first local cluster is pulled. Driven through
// a real Sim so the spatial grid, MOBS table, and threat seeding are the live ones; the
// module is also exercised directly for its return count.
import { describe, expect, it } from 'vitest';
import {
  FLEE_HELP_RADIUS,
  rallyFleeingAllies,
  socialPullSameTemplate,
} from '../src/sim/mob/social_aggro';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const makeSim = () => new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });

type CombatHarness = {
  enterCombat(a: Entity, b: Entity): boolean;
};

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
  it('blocks quest-gated enterCombat before combat state changes for a non-quester', () => {
    const sim = makeSim();
    const [egg] = wildMobs(sim);
    placeAlly(egg, sim.player, 2, 'spider_egg');
    sim.player.combatTimer = 4;
    egg.combatTimer = 6;
    const harness = sim as unknown as CombatHarness;

    harness.enterCombat(sim.player, egg);

    expect(sim.player.inCombat).toBe(false);
    expect(sim.player.combatTimer).toBe(4);
    expect(egg.inCombat).toBe(false);
    expect(egg.combatTimer).toBe(6);
    expect(egg.aiState).toBe('idle');
    expect(egg.aggroTargetId).toBeNull();
    expect(egg.threat.has(sim.playerId)).toBe(false);

    sim.questLog.set('q_broodmother', {
      questId: 'q_broodmother',
      counts: [0, 0],
      state: 'active',
    });
    harness.enterCombat(sim.player, egg);

    expect(sim.player.inCombat).toBe(true);
    expect(egg.inCombat).toBe(true);
    expect(egg.aiState).toBe('chase');
    expect(egg.aggroTargetId).toBe(sim.playerId);
    expect(egg.threat.has(sim.playerId)).toBe(true);
  });

  it('does not seed melee auto-attack threat against a quest-gated mob for a non-quester', () => {
    const sim = makeSim();
    const [egg] = wildMobs(sim);
    placeAlly(egg, sim.player, 2, 'spider_egg');
    sim.player.targetId = egg.id;

    sim.startAutoAttack();

    expect(sim.player.autoAttack).toBe(false);
    expect(sim.player.inCombat).toBe(false);
    expect(egg.inCombat).toBe(false);
    expect(egg.aiState).toBe('idle');
    expect(egg.aggroTargetId).toBeNull();
    expect(egg.threat.has(sim.playerId)).toBe(false);

    sim.questLog.set('q_broodmother', {
      questId: 'q_broodmother',
      counts: [0, 0],
      state: 'active',
    });
    sim.startAutoAttack();

    expect(sim.player.inCombat).toBe(true);
    expect(egg.inCombat).toBe(true);
    expect(egg.aiState).toBe('chase');
    expect(egg.threat.has(sim.playerId)).toBe(true);
  });

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

  it('does not pull a quest-gated same-family ally onto a player without the quest', () => {
    // A Broodmother egg (spider_egg, family 'spider', requiresQuestId q_broodmother)
    // parked beside a fleeing Mirefen Widow (also family 'spider') must stay inert
    // scenery for a non-quester, same as the direct idle-scan aggro path (sim.ts
    // aggroMob / mob/quest_gated_aggro.ts questGateBlocksAggro).
    const sim = makeSim();
    const [fleer, egg] = wildMobs(sim);
    fleer.templateId = 'mire_widow';
    fleer.pos = { x: sim.player.pos.x + 3, z: sim.player.pos.z, y: sim.player.pos.y };
    placeAlly(egg, fleer, 2, 'spider_egg');

    (sim as any).grid.refresh(sim.entities.values());
    const pulled = rallyFleeingAllies((sim as any).ctx, fleer, sim.player);

    expect(pulled).toBe(0);
    expect(egg.aiState).toBe('idle');
    expect(egg.inCombat).toBe(false);

    // The same egg DOES join once the player is on the gating quest.
    sim.questLog.set('q_broodmother', {
      questId: 'q_broodmother',
      counts: [0, 0],
      state: 'active',
    });
    const pulledOnQuest = rallyFleeingAllies((sim as any).ctx, fleer, sim.player);
    expect(pulledOnQuest).toBe(1);
    expect(egg.aiState).toBe('chase');
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

describe('socialPullSameTemplate', () => {
  it('pulls only idle same-template neighbours inside the default radius', () => {
    const sim = makeSim();
    const [pulled, near, far, otherTemplate, busy] = wildMobs(sim);
    pulled.templateId = 'gravecaller_cultist';
    pulled.pos = { x: sim.player.pos.x + 3, z: sim.player.pos.z, y: sim.player.pos.y };
    placeAlly(near, pulled, 3);
    placeAlly(far, pulled, 9);
    placeAlly(otherTemplate, pulled, 2, 'gravecaller_mender');
    placeAlly(busy, pulled, -2);
    busy.aiState = 'chase';
    (sim as any).grid.refresh(sim.entities.values());

    socialPullSameTemplate((sim as any).ctx, pulled, sim.player);

    expect(near.aiState).toBe('chase');
    expect(near.aggroTargetId).toBe(sim.player.id);
    expect(near.inCombat).toBe(true);
    expect(near.threat.get(sim.player.id)).toBe(1);
    expect(far.aiState).toBe('idle');
    expect(otherTemplate.aiState).toBe('idle');
    expect(busy.aggroTargetId).toBeNull();
  });

  it('applies the per-family radius override (mudfin pulls to 8 yards)', () => {
    const sim = makeSim();
    const [pulled, insideOverride, defaultPulled, defaultSevenYards] = wildMobs(sim);
    pulled.templateId = 'deepfen_murloc';
    pulled.pos = { x: sim.player.pos.x + 3, z: sim.player.pos.z, y: sim.player.pos.y };
    placeAlly(insideOverride, pulled, 7, 'deepfen_murloc');
    // Negative control: the same 7 yard gap stays OUTSIDE the default radius,
    // so the mudfin pull below proves the override rather than a raised default.
    defaultPulled.templateId = 'gravecaller_cultist';
    defaultPulled.pos = { x: pulled.pos.x + 40, z: pulled.pos.z, y: pulled.pos.y };
    placeAlly(defaultSevenYards, defaultPulled, 7);
    (sim as any).grid.refresh(sim.entities.values());

    socialPullSameTemplate((sim as any).ctx, pulled, sim.player);
    socialPullSameTemplate((sim as any).ctx, defaultPulled, sim.player);

    expect(insideOverride.aiState).toBe('chase');
    expect(defaultSevenYards.aiState).toBe('idle');
  });
});
