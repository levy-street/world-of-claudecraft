import { describe, expect, it, vi } from 'vitest';
import { stopDisconnectedPlayerInput } from '../server/disconnected_player_input';
import { WISP_MAZE_NPC_DEF, WISP_MAZE_QUEST_ID } from '../src/sim/content/world_quest_wisp_maze';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';

function setup(start = true) {
  const sim = new Sim({
    seed: 42,
    playerClass: 'mage',
    devCommands: true,
    world: {
      ...BUILTIN_WORLD,
      camps: [],
      groundObjects: [],
      npcs: { [WISP_MAZE_NPC_DEF.id]: WISP_MAZE_NPC_DEF },
    },
  });
  if (start) sim.chat('/dev wisps easy');
  return sim;
}

describe('disconnect and Leave maze routes', () => {
  it('stops held input without teleporting an ordinary player', () => {
    const sim = setup(false);
    const position = { ...sim.player.pos };
    sim.moveInput.forward = true;
    stopDisconnectedPlayerInput(sim, sim.playerId);
    expect(sim.moveInput.forward).toBe(false);
    expect(sim.player.pos).toEqual(position);
    sim.abandonQuest(WISP_MAZE_QUEST_ID);
    expect(sim.player.pos).toEqual(position);
  });

  it.each(['disconnect', 'leave'] as const)(
    '%s pauses simulation and retains all collected lights',
    (route) => {
      const sim = setup();
      for (let i = 0; i < 61; i++) sim.tick();
      const state = sim.worldQuestLog.get(WISP_MAZE_QUEST_ID)!.wispMaze!;
      const collection = [...state.collected];
      expect(collection.length).toBeGreaterThan(0);
      if (route === 'disconnect') stopDisconnectedPlayerInput(sim, sim.playerId);
      else sim.abandonQuest(WISP_MAZE_QUEST_ID);
      expect(state.paused).toBe(true);
      expect(sim.player.pos.x).toBe(WISP_MAZE_NPC_DEF.pos.x);
      const tick = state.tick;
      for (let i = 0; i < 10; i++) sim.tick();
      expect(state.tick).toBe(tick);
      expect(state.collected).toEqual(collection);
      sim.player.pos = sim.groundPos(100, 100);
      const remotePosition = { ...sim.player.pos };
      sim.abandonQuest(WISP_MAZE_QUEST_ID);
      expect(sim.player.pos).toEqual(remotePosition);
    },
  );

  it('refuses class spells and item consumption through actual sim command admission', () => {
    const sim = setup();
    const pos = { ...sim.player.pos };
    const resource = sim.player.resource;
    sim.castAbility('blink');
    sim.castAbilityOn('blink', sim.playerId);
    sim.castAbilityAt('blink', { x: pos.x + 10, z: pos.z });
    expect(sim.player.pos).toEqual(pos);
    expect(sim.player.resource).toBe(resource);
    sim.addItem('minor_healing_potion', 1);
    sim.player.hp -= 100;
    const hp = sim.player.hp;
    sim.useItem('minor_healing_potion');
    expect(sim.player.hp).toBe(hp);
    expect(sim.countItem('minor_healing_potion')).toBe(1);
    sim.abandonQuest(WISP_MAZE_QUEST_ID);
    sim.useItem('minor_healing_potion');
    expect(sim.countItem('minor_healing_potion')).toBe(0);
  });
});

describe('disconnect world-quest cleanup', () => {
  it('drops carried freight and leaves a cannon before stopping input, even without a meta', () => {
    const calls: string[] = [];
    const fake = {
      dropWorldQuestDeliveryCargo: vi.fn((pid: number) => calls.push(`cargo:${pid}`)),
      leaveVehicle: vi.fn((pid: number) => calls.push(`vehicle:${pid}`)),
      meta: vi.fn(() => {
        calls.push('meta');
        return undefined;
      }),
    } as unknown as Sim;
    stopDisconnectedPlayerInput(fake, 5);
    expect(calls).toEqual(['cargo:5', 'vehicle:5', 'meta']);
  });
});
