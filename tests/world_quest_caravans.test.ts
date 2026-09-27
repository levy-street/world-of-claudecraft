import { describe, expect, it } from 'vitest';
import { decideEscortPress, isEscorteeEntity } from '../src/game/escort_interact';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import {
  worldQuestCaravanForMob,
  worldQuestCaravanForRegion,
} from '../src/sim/world_quest_caravans';
import { activeWorldQuestsForCycle } from '../src/sim/world_quest_rotation';

const CASES = [
  ['eastbrook', 'eastbrook_freight_caravan', 'wq_eastbrook_caravan', 'Tobin'],
  ['willowfen', 'willowfen_remedy_caravan', 'wq_willowfen_caravan', 'Mira'],
  ['frostveil', 'frostveil_supply_caravan', 'wq_frostveil_caravan', 'Orin'],
] as const;
const WORLD = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

describe('regional world quest caravans', () => {
  it.each(CASES)(
    'resolves and starts %s via the real dev and interaction paths',
    (region, mobId, questId, speaker) => {
      const def = worldQuestCaravanForRegion(region);
      expect(def?.npcMobId).toBe(mobId);
      expect(worldQuestCaravanForMob(mobId)).toBe(def);
      if (!def) throw new Error('Missing caravan definition');
      const sim = new Sim({
        seed: 424242,
        playerClass: 'warrior',
        devCommands: true,
        world: WORLD,
      });
      sim.resetDay = '2026-09-04';
      sim.chat(`/dev caravan ${region}`);
      const cycle = sim.meta(sim.playerId)?.devWorldQuestCycle;
      expect(activeWorldQuestsForCycle(cycle ?? '').some((q) => q.id === questId)).toBe(true);
      expect(sim.worldQuestLog.get(questId)?.state).toBe('active');
      sim.player.pos = sim.groundPos(def.start.x, def.start.z);
      sim.player.prevPos = { ...sim.player.pos };
      sim.tick();
      const wagon = [...sim.entities.values()].find((e) => e.templateId === mobId);
      expect(isEscorteeEntity(wagon)).toBe(true);
      expect(
        decideEscortPress(sim.player.pos, sim.entities, sim.questLog, sim.worldQuestLog),
      ).toEqual({ kind: 'start', entityId: wagon?.id });
      sim.drainEvents();
      sim.interact();
      expect(sim.escortRuns.get(def.id)?.run).not.toBeNull();
      expect(sim.drainEvents()).toContainEqual(
        expect.objectContaining({
          type: 'chat',
          entityId: wagon?.id,
          from: speaker,
          text: def.startText,
        }),
      );
    },
  );

  it('does not classify ordinary mobs or normal escorts as caravans', () => {
    expect(worldQuestCaravanForMob('vale_bandit')).toBeUndefined();
    expect(worldQuestCaravanForMob('wren')).toBeUndefined();
    expect(worldQuestCaravanForRegion('invalid')).toBeUndefined();
    expect(worldQuestCaravanForRegion('frostreach')).toBe(worldQuestCaravanForRegion('frostveil'));
  });

  it('rejects unavailable regions and keeps commands behind the dev gate', () => {
    for (const [devCommands, command] of [
      [false, '/dev caravan willowfen'],
      [true, '/dev caravan invalid'],
    ] as const) {
      const sim = new Sim({ seed: 424242, playerClass: 'warrior', devCommands, world: WORLD });
      sim.chat(command);
      expect(sim.worldQuestLog.size).toBe(0);
      expect(sim.meta(sim.playerId)?.devWorldQuestCycle).toBeNull();
      expect(sim.player.level).toBe(1);
    }
  });

  it('keeps two simultaneous regional runs and their speech state independent', () => {
    const sim = new Sim({
      seed: 424242,
      playerClass: 'warrior',
      noPlayer: true,
      devCommands: true,
      world: WORLD,
    });
    sim.resetDay = '2026-09-04';
    const starts = CASES.slice(1).map(([region, mobId]) => {
      const pid = sim.addPlayer('warrior', region);
      sim.chat(`/dev caravan ${region}`, pid);
      const def = worldQuestCaravanForRegion(region);
      const player = sim.entities.get(pid);
      if (!def || !player) throw new Error('Missing setup');
      player.pos = sim.groundPos(def.start.x, def.start.z);
      player.prevPos = { ...player.pos };
      sim.tick();
      sim.interact(pid);
      const state = sim.escortRuns.get(def.id);
      const wagon = [...sim.entities.values()].find((e) => e.templateId === mobId);
      if (!state?.run || !wagon) throw new Error('Run failed to start');
      return { pid, def, state, wagon };
    });
    expect(starts[0].state.run?.story).not.toBe(starts[1].state.run?.story);
    starts[0].wagon.dead = true;
    starts[0].wagon.hp = 0;
    starts[0].wagon.respawnTimer = 99999;
    sim.tick();
    expect(starts[0].state.run).toBeNull();
    expect(starts[1].state.run).not.toBeNull();
    expect(starts[1].wagon.dead).toBe(false);
  });
});
