import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { resetNythraxisEncounter } from '../src/sim/encounters/nythraxis';
import { Sim } from '../src/sim/sim';
import { dist2d } from '../src/sim/types';

function encounter() {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  });
  const pid = sim.addPlayer('warrior', 'Tank');
  sim.players.get(pid)!.questsDone.add('q_nythraxis_bound_guardian');
  for (let i = 0; i < 4; i++) {
    const member = sim.addPlayer('priest', `Member${i}`);
    sim.partyInvite(member, pid);
    sim.partyAccept(member);
  }
  sim.convertPartyToRaid(pid);
  sim.enterDungeon('nythraxis_boss_arena', pid);
  const player = sim.entities.get(pid)!;
  const origin = instanceOrigin(
    DUNGEONS.nythraxis_boss_arena.index,
    sim.instanceSlotAt(player.pos)!,
  );
  const boss = [...sim.entities.values()].find(
    (e) => e.templateId === 'nythraxis_scourge_of_thornpeak',
  )!;
  player.pos = sim.ctx.groundPos(origin.x, origin.z + 36);
  player.prevPos = { ...player.pos };
  player.maxHp = player.hp = 1e9;
  boss.moveSpeed = 0;
  boss.swingTimer = 999;
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = pid;
  boss.threat.set(pid, 1000);
  boss.hp = Math.floor(boss.maxHp * 0.69);
  sim.tick();
  const aldric = [...sim.entities.values()].find((e) => e.templateId === 'brother_aldric_raid')!;
  expect(aldric).toBeTruthy();
  return { sim, boss, aldric, origin };
}

describe('Aldric returns to the Nythraxis entrance', () => {
  it('removes Aldric and his pending walk on encounter reset', () => {
    const { sim, boss, aldric } = encounter();
    for (let i = 0; i < 20 * 40 && boss.nythraxis?.phase === 'transition'; i++) sim.tick();
    expect(aldric.wanderTarget).not.toBeNull();
    resetNythraxisEncounter(sim.ctx, boss);
    expect(sim.entities.has(aldric.id)).toBe(false);
  });
  it('replays the same return path and RNG tail from the same seed', () => {
    const run = () => {
      const { sim, boss, aldric } = encounter();
      for (let i = 0; i < 20 * 40 && boss.nythraxis?.phase === 'transition'; i++) sim.tick();
      expect(boss.nythraxis?.phase).toBe(2);
      sim.ctx.dealDamage(sim.player, boss, boss.hp + 1, false, 'physical', null, 'hit');
      const path = [];
      for (let i = 0; i < 20 * 15; i++) {
        sim.tick();
        path.push({ ...aldric.pos });
      }
      return { path, rngTail: sim.rng.next() };
    };
    expect(run()).toEqual(run());
  });
  it.each([false, true])(
    'walks away from the pillar after his speech (early kill: %s)',
    (earlyKill) => {
      const { sim, boss, aldric, origin } = encounter();
      const spawnPos = { ...aldric.spawnPos };
      for (let i = 0; i < 20 * 15; i++) sim.tick();
      expect(boss.nythraxis!.phase).toBe('transition');
      expect(aldric.pos.z).toBeCloseTo(origin.z + 66, 0);
      for (let i = 0; i < 20 * 40 && boss.nythraxis?.phase === 'transition'; i++) sim.tick();
      expect(boss.nythraxis?.phase).toBe(2);
      const speechPos = { ...aldric.pos };
      if (earlyKill)
        sim.ctx.dealDamage(sim.player, boss, boss.hp + 1, false, 'physical', null, 'hit');
      if (earlyKill) expect(boss.dead).toBe(true);
      sim.tick();
      expect(aldric.pos.z).toBeLessThan(speechPos.z);
      expect(dist2d(aldric.pos, speechPos)).toBeLessThanOrEqual(aldric.moveSpeed / 20 + 0.01);
      for (let i = 0; i < 20 * 20; i++) sim.tick();
      expect(dist2d(aldric.pos, { x: origin.x + 8, y: 0, z: origin.z + 24 })).toBeLessThan(0.3);
      expect(dist2d(aldric.pos, { x: origin.x, y: 0, z: origin.z + 62 })).toBeGreaterThan(30);
      expect(aldric.spawnPos).toEqual(spawnPos);
      expect(aldric.kind).toBe('npc');
      expect(aldric.questIds).toContain('q_nythraxis_scourges_end');
      const arrived = { ...aldric.pos };
      for (let i = 0; i < 20; i++) sim.tick();
      expect(aldric.pos).toEqual(arrived);
    },
  );
});
