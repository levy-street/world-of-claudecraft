import { describe, expect, it } from 'vitest';
import {
  WISP_MAZE_NPC_DEF,
  WISP_MAZE_NPC_ID,
  WISP_MAZE_QUEST_ID,
  WISP_MAZE_SITE,
} from '../src/sim/content/world_quest_wisp_maze';
import { BUILTIN_WORLD } from '../src/sim/data';
import { WISP_MAZE_LAYOUT, wispMazeCellCenter } from '../src/sim/minigames/wisp_maze';
import { Sim } from '../src/sim/sim';
import { emptyMoveInput } from '../src/sim/types';
import { worldQuestProgressForWire } from '../src/sim/world_quest_trace_wire';
import {
  advanceWispMazeMovement,
  leaveWispMaze,
  pauseWispMaze,
} from '../src/sim/world_quest_wisp_maze';
import { decodeWispMazeState } from '../src/sim/world_quest_wisp_maze_wire';

function setup() {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    devCommands: true,
    world: {
      ...BUILTIN_WORLD,
      camps: [],
      npcs: { [WISP_MAZE_NPC_DEF.id]: WISP_MAZE_NPC_DEF },
      groundObjects: [],
    },
  });
  sim.resetDay = '2026-09-06';
  sim.chat('/dev wisps');
  sim.talkToNpc(WISP_MAZE_NPC_ID);
  const meta = sim.meta(sim.playerId)!;
  const progress = meta.worldQuestLog.get(WISP_MAZE_QUEST_ID)!;
  return { sim, meta, progress, state: progress.wispMaze! };
}
describe('private world-space wisp trial', () => {
  it('keeps another participant independent and refuses remote starts or unauthorized return teleports', () => {
    const { sim, meta, state } = setup();
    const other = sim.addPlayer('warrior', 'Other');
    const otherMeta = sim.meta(other)!;
    const player = sim.entities.get(other)!;
    const before = { ...player.pos };
    leaveWispMaze(sim.ctx, otherMeta, player);
    expect(player.pos).toEqual(before);
    sim.talkToNpc(WISP_MAZE_NPC_ID, other);
    expect(otherMeta.worldQuestLog.get(WISP_MAZE_QUEST_ID)?.wispMaze).toBeUndefined();
    state.collected = [WISP_MAZE_LAYOUT.spawnCell];
    expect(otherMeta.worldQuestLog.get(WISP_MAZE_QUEST_ID)?.wispMaze).toBeUndefined();
    sim.player.pos = sim.groundPos(100, 100);
    const remote = { ...sim.player.pos };
    leaveWispMaze(sim.ctx, meta, sim.player);
    expect(sim.player.pos).toEqual(remote);
    state.phase = 'won';
    leaveWispMaze(sim.ctx, meta, sim.player);
    expect(sim.player.pos).toEqual(remote);
  });
  it('starts only at its real instructor and advances normal movement without jumping or dashing', () => {
    const { sim, meta, state } = setup();
    expect(state.phase).toBe('countdown');
    for (let i = 0; i < 61; i++) sim.tick();
    const before = { ...sim.player.pos };
    meta.moveInput = { ...emptyMoveInput(), forward: true, jump: true };
    for (let i = 0; i < 4; i++) sim.tick();
    expect(
      Math.hypot(sim.player.pos.x - before.x, sim.player.pos.z - before.z),
    ).toBeLessThanOrEqual(7 * 0.2 + 1e-8);
    expect(sim.player.jumping).toBe(false);
    expect(meta.worldQuestLog.get(WISP_MAZE_QUEST_ID)!.count).toBe(0);
  });
  it('pauses on leave/death/disconnect and resumes at the same private position with collected lights', () => {
    const { sim, meta, state } = setup();
    state.phase = 'active';
    state.collected = [WISP_MAZE_LAYOUT.spawnCell];
    const tick = state.tick;
    pauseWispMaze(meta);
    for (let i = 0; i < 10; i++) sim.tick();
    expect(state.tick).toBe(tick);
    state.paused = false;
    leaveWispMaze(sim.ctx, meta, sim.player);
    expect(sim.player.pos.x).toBe(WISP_MAZE_NPC_DEF.pos.x);
    sim.talkToNpc(WISP_MAZE_NPC_ID);
    expect(meta.worldQuestLog.get(WISP_MAZE_QUEST_ID)!.wispMaze).toBe(state);
    expect(state.paused).toBe(false);
    expect(state.collected).toEqual([WISP_MAZE_LAYOUT.spawnCell]);
    sim.player.dead = true;
    advanceWispMazeMovement(sim.ctx, sim.player, meta);
    expect(state.paused).toBe(true);
  });
  it('credits all lights once, returns the player, isolates snapshots and never saves runtime actors', () => {
    const { sim, meta, progress, state } = setup();
    state.phase = 'active';
    state.collected = WISP_MAZE_LAYOUT.openCells.filter(
      (cell) => cell !== WISP_MAZE_LAYOUT.spawnCell,
    );
    const spawn = wispMazeCellCenter(WISP_MAZE_LAYOUT.spawnCell);
    state.playerX = spawn.x;
    state.playerZ = spawn.z;
    sim.player.pos = sim.groundPos(WISP_MAZE_SITE.x + spawn.x, WISP_MAZE_SITE.z + spawn.z);
    const completed = meta.counters.questsCompleted;
    const lifetimeXp = meta.lifetimeXp;
    sim.tick();
    expect(progress.state).toBe('completed');
    expect(meta.counters.questsCompleted).toBe(completed + 1);
    expect(meta.lifetimeXp).toBeGreaterThan(lifetimeXp);
    expect(meta.deedsEarned.has('exp_wisp_maze')).toBe(true);
    expect(sim.player.pos.x).toBe(WISP_MAZE_NPC_DEF.pos.x);
    const earned = meta.counters.questsCompleted;
    const earnedXp = meta.lifetimeXp;
    for (let i = 0; i < 10; i++) sim.tick();
    expect(meta.counters.questsCompleted).toBe(earned);
    expect(meta.lifetimeXp).toBe(earnedXp);
    const wire = worldQuestProgressForWire(progress);
    expect(wire.wispMaze).not.toBe(state);
    expect(wire.wispMaze?.enemies[0]).not.toBe(state.enemies[0]);
    expect(
      sim
        .serializeCharacter(sim.playerId)
        ?.worldQuests?.progress.find((row) => row.questId === WISP_MAZE_QUEST_ID),
    ).not.toHaveProperty('wispMaze');
  });
  it('bounds poisoned owner frames and copies collection without aliasing', () => {
    const { state } = setup();
    expect(decodeWispMazeState(state, 'wrong')).toBeUndefined();
    expect(decodeWispMazeState({ ...state, lives: 4 }, WISP_MAZE_QUEST_ID)).toBeUndefined();
    expect(
      decodeWispMazeState({ ...state, collected: Array(1000).fill(1) }, WISP_MAZE_QUEST_ID),
    ).toBeUndefined();
    expect(
      decodeWispMazeState({ ...state, playerX: Infinity }, WISP_MAZE_QUEST_ID),
    ).toBeUndefined();
    const decoded = decodeWispMazeState(state, WISP_MAZE_QUEST_ID)!;
    expect(decoded).toBeDefined();
    expect(decoded.collected).not.toBe(state.collected);
    expect(decoded.enemies).not.toBe(state.enemies);
  });
});
