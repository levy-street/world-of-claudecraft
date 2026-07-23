import { describe, expect, it } from 'vitest';
import { NPCS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, QuestProgress } from '../src/sim/types';

const ESCORTS = [
  { label: 'Drakelands', questId: 'q_drakewatch_long_climb', travelerId: 'scout_vaela' },
  { label: 'Wraithwood', questId: 'q_wraithwood_lantern_walk', travelerId: 'lantern_iven' },
  { label: 'Farshore', questId: 'q_farshore_ferrywalk', travelerId: 'bellkeeper_tam' },
] as const;

function entityByTemplate(sim: Sim, templateId: string): Entity {
  const entity = [...sim.entities.values()].find(
    (candidate) => candidate.templateId === templateId,
  );
  if (!entity) throw new Error(`missing entity ${templateId}`);
  return entity;
}

function placePlayerAt(sim: Sim, entity: Entity): void {
  sim.player.pos = { ...entity.pos };
  sim.player.prevPos = { ...entity.pos };
}

function startEscort(
  questId: string,
  travelerId: string,
): { sim: Sim; traveler: Entity; progress: QuestProgress } {
  const sim = new Sim({ seed: 1584, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  const traveler = entityByTemplate(sim, travelerId);
  const progress: QuestProgress = { questId, counts: [0], state: 'active' };
  sim.questLog.set(questId, progress);
  placePlayerAt(sim, traveler);
  sim.talkToNpc(traveler.id);
  expect(sim.questEscortRuns.size).toBe(1);
  return { sim, traveler, progress };
}

describe.each(ESCORTS)('$label escort', ({ questId, travelerId }) => {
  it('moves the traveler, spawns authored attackers, and grants credit after every ambush', () => {
    const { sim, traveler, progress } = startEscort(questId, travelerId);
    const start = { ...traveler.pos };
    let sawAmbush = false;
    const defeatedAttackers = new Set<number>();

    for (let ticks = 0; ticks < 4000 && progress.state === 'active'; ticks++) {
      placePlayerAt(sim, traveler);
      const run = [...sim.questEscortRuns.values()][0];
      if (run) {
        for (const id of run.waveIds) {
          const attacker = sim.entities.get(id);
          if (!attacker || attacker.dead) continue;
          sawAmbush = true;
          expect(attacker.aggroTargetId).toBe(traveler.id);
          expect(attacker.threat.has(traveler.id)).toBe(true);
          defeatedAttackers.add(attacker.id);
          sim.ctx.dealDamage(
            sim.player,
            attacker,
            attacker.maxHp + 1,
            false,
            'physical',
            'Escort Test',
            'hit',
          );
        }
      }
      sim.tick();
      for (const attackerId of defeatedAttackers) {
        expect(sim.entities.has(attackerId)).toBe(false);
      }
    }

    expect(Math.hypot(traveler.pos.x - start.x, traveler.pos.z - start.z)).toBeLessThan(0.01);
    expect(sawAmbush).toBe(true);
    expect(progress.counts).toEqual([1]);
    expect(progress.state).toBe('ready');
    expect(sim.questEscortRuns.size).toBe(0);
  });

  it('resets a defeated traveler and lets the active quest restart', () => {
    const { sim, traveler, progress } = startEscort(questId, travelerId);
    const start = { ...traveler.pos };
    const authoredFacing = NPCS[travelerId].facing;

    sim.ctx.dealDamage(null, traveler, traveler.maxHp + 1, false, 'physical', 'Escort Test', 'hit');
    sim.tick();

    expect(sim.questEscortRuns.size).toBe(0);
    expect(traveler.dead).toBe(false);
    expect(traveler.hp).toBe(traveler.maxHp);
    expect(traveler.pos).toMatchObject(start);
    expect(traveler.facing).toBe(authoredFacing);
    expect(traveler.prevFacing).toBe(authoredFacing);
    expect(progress.counts).toEqual([0]);
    expect(progress.state).toBe('active');

    placePlayerAt(sim, traveler);
    sim.talkToNpc(traveler.id);
    expect(sim.questEscortRuns.size).toBe(1);
  });
});
