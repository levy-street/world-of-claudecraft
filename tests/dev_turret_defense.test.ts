import { describe, expect, it } from 'vitest';
import { TURRET_TANK_MOUNT } from '../src/sim/content/turret_defense';
import { WISP_MAZE_QUEST_ID } from '../src/sim/content/world_quest_wisp_maze';
import { DUNGEON_X_THRESHOLD } from '../src/sim/data';
import { handleDevTurretChat } from '../src/sim/dev_turret_defense';
import { type ArenaMatch, type DuelState, Sim } from '../src/sim/sim';
import type { BgMatch } from '../src/sim/social/battleground';
import type { Aura, MountRaceSession, SimEvent, WorldQuestProgress } from '../src/sim/types';
import { WORLD_QUEST_DELIVERY_AURA_ID } from '../src/sim/world_quest_delivery';
import { WORLD_SEED } from '../src/sim/world_seed';

const AMBERFALL = { x: -340, z: 1945 };
const LAKE = { x: -282, z: 2016 };

function rig(devCommands = true) {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands });
  return { sim, player: sim.player, meta: sim.meta(sim.playerId)! };
}

function devLogs(events: readonly SimEvent[]): string[] {
  return events.flatMap((e) =>
    e.type === 'log' && typeof e.text === 'string' && e.text.startsWith('[dev]') ? [e.text] : [],
  );
}

function chat(sim: Sim, line: string): string[] {
  sim.chat(line);
  return devLogs(sim.drainEvents());
}

describe('/dev turret', () => {
  it('does nothing when dev commands are off, even called directly', () => {
    const { sim, meta } = rig(false);
    sim.chat('/dev turret');
    expect(meta.vehicle ?? null).toBeNull();
    expect(handleDevTurretChat(sim.ctx, '/dev turret', sim.playerId)).toBe(true);
    expect(meta.vehicle ?? null).toBeNull();
    expect(sim.turretSession).toBeNull();
  });

  it('ignores other dev lines', () => {
    const { sim } = rig();
    expect(handleDevTurretChat(sim.ctx, '/dev turrets', sim.playerId)).toBe(false);
    expect(handleDevTurretChat(sim.ctx, '/dev turret 12', sim.playerId)).toBe(false);
  });

  it('seats the player where they stand, feet position as the center', () => {
    const { sim, player, meta } = rig();
    const at = { ...player.pos };
    const logs = chat(sim, '/dev turret');
    expect(logs.some((l) => l.startsWith('[dev] Turret seated'))).toBe(true);
    expect(meta.vehicle?.kind).toBe('turret');
    expect(sim.turretSession?.origin).toEqual(at);
    expect(sim.turretSession?.defense.cx).toBe(at.x);
    expect(sim.turretSession?.defense.cz).toBe(at.z);
    expect(player.mountKey).toBe(TURRET_TANK_MOUNT);
  });

  it('teleports first with coordinates, through the dev displacement', () => {
    const { sim, player } = rig();
    chat(sim, `/dev turret ${AMBERFALL.x} ${AMBERFALL.z}`);
    const view = sim.turretSession!;
    expect(view.origin.x).toBeCloseTo(AMBERFALL.x, 6);
    expect(view.origin.z).toBeCloseTo(AMBERFALL.z, 6);
    expect(player.pos).toEqual(view.origin);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(sim.turretSession).not.toBeNull();
  });

  it('leaves with /dev turret leave, and says so when not seated', () => {
    const { sim, player } = rig();
    expect(chat(sim, '/dev turret leave')).toEqual(['[dev] Not seated in the turret.']);
    chat(sim, '/dev turret');
    expect(chat(sim, '/dev turret leave')).toEqual(['[dev] Turret left.']);
    expect(sim.turretSession).toBeNull();
    expect(player.mountKey).toBe('');
  });

  const refusals: { name: string; text: string; set: (r: ReturnType<typeof rig>) => void }[] = [
    { name: 'dead', text: 'you are dead', set: ({ player }) => (player.dead = true) },
    { name: 'in combat', text: 'you are in combat', set: ({ player }) => (player.inCombat = true) },
    {
      name: 'already seated',
      text: 'you are already seated in a vehicle',
      set: ({ sim }) => sim.chat('/dev turret'),
    },
    {
      name: 'leaving',
      text: 'you are leaving the world',
      set: ({ meta }) => (meta.leaving = true),
    },
    {
      name: 'in a duel',
      text: 'you are in a match or a duel',
      set: ({ sim }) => sim.ctx.duels.set(sim.playerId, {} as DuelState),
    },
    {
      name: 'in a battleground match',
      text: 'you are in a match or a duel',
      set: ({ sim }) => sim.ctx.bgMatches.set(sim.playerId, {} as BgMatch),
    },
    {
      name: 'in an arena match',
      text: 'you are in a match or a duel',
      set: ({ sim }) => sim.ctx.arenaMatches.set(sim.playerId, {} as ArenaMatch),
    },
    {
      name: 'inside an instanced band',
      text: 'you are not in the open world',
      set: ({ player }) => (player.pos.x = DUNGEON_X_THRESHOLD + 50),
    },
    {
      name: 'mid-jump',
      text: 'another activity owns your movement',
      set: ({ player }) => (player.jumping = true),
    },
    {
      name: 'in a mount race',
      text: 'another activity owns your movement',
      set: ({ meta }) => (meta.mountRace = { raceId: 'highwatch' } as MountRaceSession),
    },
    {
      name: 'in the wisp maze',
      text: 'another activity owns your movement',
      set: ({ meta }) =>
        meta.worldQuestLog.set(WISP_MAZE_QUEST_ID, {
          wispMaze: { phase: 'active', paused: false },
        } as unknown as WorldQuestProgress),
    },
    {
      name: 'swimming',
      text: 'you are swimming or aboard a ship',
      set: ({ sim }) => {
        sim.chat(`/dev tp ${LAKE.x} ${LAKE.z}`);
        sim.tick();
        expect(sim.ctx.isSwimming(sim.player)).toBe(true);
      },
    },
    {
      name: 'carrying world-quest freight',
      text: 'you are carrying freight',
      set: ({ player }) =>
        player.auras.push({
          id: WORLD_QUEST_DELIVERY_AURA_ID,
          name: 'Freight',
          kind: 'world_quest_cargo',
          remaining: 60,
          duration: 60,
          value: 0,
        } as Aura),
    },
  ];

  it.each(refusals)('refuses when $name, without teleporting', ({ text, set }) => {
    const r = rig();
    set(r);
    const before = { ...r.player.pos };
    const seatedBefore = r.meta.vehicle ?? null;
    r.sim.drainEvents();
    expect(chat(r.sim, `/dev turret ${AMBERFALL.x} ${AMBERFALL.z}`)).toEqual([
      `[dev] Turret refused: ${text}.`,
    ]);
    expect(r.meta.vehicle ?? null).toBe(seatedBefore);
    if (!seatedBefore) expect(r.player.pos.x).toBe(before.x);
  });
});
