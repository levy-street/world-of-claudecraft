import { describe, expect, it } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { CLASSIC_WORLD_QUEST_COMMANDS } from '../src/sim/dev_world_quest';
import { Sim } from '../src/sim/sim';

describe('dev world quest commands', () => {
  it('rejects developer world quest commands when devCommands is false', () => {
    const sim = new Sim({ seed: 20061, playerClass: 'warrior', devCommands: false });
    sim.chat('/dev wq eastbrook_bandits');
    expect(sim.players.get(sim.playerId)?.devWorldQuestCycle).toBeNull();
    expect(sim.players.get(sim.playerId)?.worldQuestLog.has('wq_eastbrook_bandits')).toBe(false);
  });

  it('lists world quest commands when typing /dev wq without arguments', () => {
    const sim = new Sim({ seed: 20061, playerClass: 'warrior', devCommands: true });
    sim.chat('/dev wq');
    expect(sim.players.get(sim.playerId)?.devWorldQuestCycle).toBeNull();
  });

  it.each(CLASSIC_WORLD_QUEST_COMMANDS)('arms and teleports to /dev %s', (cmd) => {
    const sim = new Sim({ seed: 20061, playerClass: 'mage', devCommands: true });
    expect(sim.player.level).toBe(1);

    sim.chat(`/dev ${cmd}`);
    sim.tick();

    const questId = `wq_${cmd}`;
    const quest = WORLD_QUESTS_BY_ID[questId];
    expect(quest).toBeDefined();

    const meta = sim.players.get(sim.playerId);
    expect(sim.player.level).toBeGreaterThanOrEqual(quest.minLevel);
    expect(meta?.devWorldQuestCycle).toBeTruthy();
    expect(meta?.worldQuestLog.get(questId)?.state).toBe('active');
    expect(meta?.worldQuestLog.get(questId)?.count).toBe(0);

    if (quest) {
      const dx = sim.player.pos.x - quest.area.x;
      const dz = sim.player.pos.z - quest.area.z;
      const dist = Math.hypot(dx, dz);
      expect(dist).toBeLessThanOrEqual(quest.area.radius + 1);
    }
  });

  it.each([
    { input: '/dev wq eastbrook', expectedId: 'wq_eastbrook_bandits' },
    { input: '/dev wq sporelings', expectedId: 'wq_hollow_sporelings' },
    { input: '/dev wq brood', expectedId: 'wq_drakelands_brood' },
    { input: '/dev wq howlers', expectedId: 'wq_frostveil_howlers' },
    { input: '/dev wq lurkers', expectedId: 'wq_amberfall_lurkers' },
    { input: '/dev wq willowfen', expectedId: 'wq_willowfen_ore' },
    { input: '/dev wq barrow', expectedId: 'wq_nightbloom_barrow' },
    { input: '/dev wq wraithwood', expectedId: 'wq_wraithwood_restless' },
    { input: '/dev wq evergarden', expectedId: 'wq_evergarden_watch' },
  ])('arms through alias $input -> $expectedId', ({ input, expectedId }) => {
    const sim = new Sim({ seed: 20061, playerClass: 'mage', devCommands: true });
    sim.chat(input);
    sim.tick();
    const meta = sim.players.get(sim.playerId);
    expect(meta?.worldQuestLog.get(expectedId)?.state).toBe('active');
  });
});
