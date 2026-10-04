import { describe, expect, it } from 'vitest';
import { FIRE_AND_FLY_DUNGEON_ID } from '../src/sim/content/fire_and_fly_arena';
import {
  TURRET_DEFAULT_SCENARIO,
  TURRET_SCENARIOS,
} from '../src/sim/content/fire_and_fly_scenarios';
import { TURRET_TOWER_POINTS } from '../src/sim/content/turret_defense';
import { WISP_MAZE_QUEST_ID } from '../src/sim/content/world_quest_wisp_maze';
import { DUNGEON_X_THRESHOLD, dungeonAt, PLAYER_START } from '../src/sim/data';
import { handleDevTurretChat } from '../src/sim/dev_turret_defense';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { type ArenaMatch, type DuelState, Sim } from '../src/sim/sim';
import type { BgMatch } from '../src/sim/social/battleground';
import type { Aura, MountRaceSession, SimEvent, WorldQuestProgress } from '../src/sim/types';
import { WORLD_QUEST_DELIVERY_AURA_ID } from '../src/sim/world_quest_delivery';
import { WORLD_SEED } from '../src/sim/world_seed';

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

  it('seats a server player (database character id) in the arena of their durable key', () => {
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      devCommands: true,
      noPlayer: true,
    });
    const pid = sim.addPlayer('warrior', 'Probe', { characterId: 7 });
    sim.drainEvents();
    sim.chat('/dev turret', pid);
    const logs = devLogs(sim.drainEvents());
    expect(logs).toEqual([
      '[dev] Turret seated in your Fire and Fly arena (standard); /dev turret leave returns you.',
    ]);
    expect(sim.meta(pid)?.vehicle?.kind).toBe('turret');
    expect(dungeonAt(sim.entities.get(pid)!.pos.x)?.id).toBe(FIRE_AND_FLY_DUNGEON_ID);
    expect(
      sim.ctx.instances.filter((inst) => inst.partyKey === 'solo:char:7').map((i) => i.dungeonId),
    ).toEqual([FIRE_AND_FLY_DUNGEON_ID]);
    sim.chat('/dev turret leave', pid);
    expect(devLogs(sim.drainEvents())).toEqual(['[dev] Turret left.']);
    expect(dungeonAt(sim.entities.get(pid)!.pos.x)).toBeNull();
  });

  it('still seats nobody on a server without dev commands', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Probe', { characterId: 7 });
    sim.chat('/dev turret', pid);
    expect(sim.meta(pid)?.vehicle ?? null).toBeNull();
    expect(dungeonAt(sim.entities.get(pid)!.pos.x)).toBeNull();
  });

  it('ignores other dev lines', () => {
    const { sim } = rig();
    expect(handleDevTurretChat(sim.ctx, '/dev turrets', sim.playerId)).toBe(false);
    expect(handleDevTurretChat(sim.ctx, '/dev turret 12', sim.playerId)).toBe(false);
    expect(handleDevTurretChat(sim.ctx, '/dev turret -340 1945', sim.playerId)).toBe(false);
    expect(handleDevTurretChat(sim.ctx, '/dev turret hard now', sim.playerId)).toBe(false);
  });

  it('runs Standard when no scenario is named', () => {
    const { sim } = rig();
    chat(sim, '/dev turret');
    const plan = sim.turretSession?.defense.plan;
    expect(plan?.scenarioId).toBe(TURRET_DEFAULT_SCENARIO.id);
    expect(plan?.scenarioId).toBe('fire_and_fly_standard');
    expect(sim.turretSession?.defense.integrity).toBe(TURRET_TOWER_POINTS);
  });

  it.each([
    ['introduction', 'introduction', TURRET_TOWER_POINTS],
    ['hard', 'hard', TURRET_TOWER_POINTS],
    ['HARD', 'hard', TURRET_TOWER_POINTS],
    ['fire_and_fly_introduction', 'introduction', TURRET_TOWER_POINTS],
  ])('runs the scenario named by /dev turret %s', (word, key, integrity) => {
    const { sim } = rig();
    const scenario = TURRET_SCENARIOS.find((s) => s.boardKey === key)!;
    expect(chat(sim, `/dev turret ${word}`)).toEqual([
      `[dev] Turret seated in your Fire and Fly arena (${key}); /dev turret leave returns you.`,
    ]);
    const session = sim.turretSession!;
    expect(session.defense.plan.scenarioId).toBe(scenario.id);
    expect(session.defense.plan.integrity).toBe(integrity);
    expect(session.defense.integrity).toBe(integrity);
    expect(session.waveCount).toBe(scenario.waves.length);
    expect(chat(sim, '/dev turret leave')).toEqual(['[dev] Turret left.']);
  });

  it('refuses an unknown scenario without seating, naming the known ones', () => {
    const { sim, player, meta } = rig();
    const before = { ...player.pos };
    expect(chat(sim, '/dev turret nightmare')).toEqual([
      '[dev] Unknown turret scenario "nightmare"; try one of: introduction, standard, hard, pack, deluge, brittle, powder.',
    ]);
    expect(meta.vehicle ?? null).toBeNull();
    expect(player.pos).toEqual(before);
  });

  it('takes a scenario name with digits in it as its own, refusing it when unknown', () => {
    const { sim, meta } = rig();
    expect(handleDevTurretChat(sim.ctx, '/dev turret hard2', sim.playerId)).toBe(true);
    expect(devLogs(sim.drainEvents())).toEqual([
      '[dev] Unknown turret scenario "hard2"; try one of: introduction, standard, hard, pack, deluge, brittle, powder.',
    ]);
    expect(meta.vehicle ?? null).toBeNull();
  });

  it('takes the player to the tower in their own arena, the tower as the center', () => {
    const { sim, player, meta } = rig();
    const logs = chat(sim, '/dev turret');
    expect(logs).toEqual([
      '[dev] Turret seated in your Fire and Fly arena (standard); /dev turret leave returns you.',
    ]);
    expect(meta.vehicle?.kind).toBe('turret');
    expect(dungeonAt(player.pos.x)?.id).toBe(FIRE_AND_FLY_DUNGEON_ID);
    expect(sim.turretSession?.origin).toEqual(player.pos);
    expect(sim.turretSession?.defense.cx).toBe(player.pos.x);
    expect(sim.turretSession?.defense.cz).toBe(player.pos.z);
    expect(player.mountKey).toBe('');
  });

  it('leaves with /dev turret leave, back where the player stood, and says so when not seated', () => {
    const { sim, player } = rig();
    expect(chat(sim, '/dev turret leave')).toEqual(['[dev] Not seated in the turret.']);
    // Away from the Eastbrook arrival point, the arena's own fallback exit.
    sim.chat('/dev tp -340 1945');
    sim.tick();
    const before = { ...player.pos };
    expect(Math.hypot(before.x - PLAYER_START.x, before.z - PLAYER_START.z)).toBeGreaterThan(100);
    chat(sim, '/dev turret');
    expect(chat(sim, '/dev turret leave')).toEqual(['[dev] Turret left.']);
    expect(sim.turretSession).toBeNull();
    expect(player.pos).toEqual(before);
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
      name: 'standing in the arena through the dungeon path',
      text: 'you are not in the open world',
      set: ({ sim }) => {
        expect(enterDungeon(sim.ctx, FIRE_AND_FLY_DUNGEON_ID, sim.playerId)).toBe(true);
      },
    },
    {
      name: 'every arena is taken',
      text: 'every Fire and Fly arena is taken',
      set: ({ sim }) => {
        for (const inst of sim.ctx.instances) {
          if (inst.dungeonId === FIRE_AND_FLY_DUNGEON_ID) inst.partyKey = `taken:${inst.slot}`;
        }
      },
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
    expect(chat(r.sim, '/dev turret')).toEqual([`[dev] Turret refused: ${text}.`]);
    expect(r.meta.vehicle ?? null).toBe(seatedBefore);
    if (!seatedBefore) expect(r.player.pos).toEqual(before);
  });
});
