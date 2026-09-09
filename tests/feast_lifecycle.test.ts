import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { endArenaMatch, startArenaMatch, updateArena } from '../src/sim/social/arena';
import {
  BG_MAX_DURATION,
  bgResolveDesertion,
  endBgMatch,
  startBgMatch,
  updateBattleground,
} from '../src/sim/social/battleground';
import { startYumiMatch } from '../src/sim/social/yumi';
import { EMPTY_TEST_WORLD } from './sim_shared';

function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Required fixture value missing');
  return value;
}

function world() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: EMPTY_TEST_WORLD });
}

function players(sim: Sim, count: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const pid = sim.addPlayer('warrior', `Guest ${sim.players.size + i}`);
    sim.setPlayerLevel(20, pid);
    return pid;
  });
}

function place(sim: Sim, pid: number): number {
  sim.addItem('harvest_feast', 1, pid);
  const from = sim.events.length;
  sim.placeFeast(pid);
  const placed = sim.events.slice(from).filter((event) => event.type === 'farmFeastPlaced');
  expect(placed).toHaveLength(1);
  return placed[0].feastId;
}

describe('feast ownership follows its match lifecycle', () => {
  it.each(['1v1', '2v2', 'fiesta', 'yumi3', 'yumi5'] as const)(
    '%s teardown removes its feasts and frees the owner without touching overworld tables',
    (format) => {
      const sim = world();
      const size = format === '1v1' ? 1 : format === 'yumi3' ? 3 : format === 'yumi5' ? 5 : 2;
      const pids = players(sim, size * 2);
      const overworld = place(sim, pids[1]);
      // The mode-specific entry point claims the actual arena or maze slot.
      if (format === 'yumi3' || format === 'yumi5') {
        startYumiMatch(sim.ctx, format, pids.slice(0, size), pids.slice(size));
      } else {
        startArenaMatch(sim.ctx, format, pids.slice(0, size), pids.slice(size));
      }
      const match = must(sim.arenaMatches.get(pids[0]));
      const feastId = place(sim, pids[0]);
      endArenaMatch(sim.ctx, match, 'A', 'forfeit');
      expect(sim.arenaMatches.has(pids[0])).toBe(false);
      expect(sim.entities.has(feastId)).toBe(false);
      expect(sim.feasts.has(feastId)).toBe(false);
      expect(sim.entities.has(overworld)).toBe(true);
      expect(sim.feasts.has(overworld)).toBe(true);
      expect(sim.feasts.has(place(sim, pids[0]))).toBe(true);
    },
  );

  it('battleground teardown reclaims the feast of a fighter who already deserted', () => {
    const sim = world();
    const pids = players(sim, 10);
    startBgMatch(sim.ctx, pids.slice(0, 5), pids.slice(5), { rated: false });
    const match = must(sim.bgMatches.get(pids[0]));
    const feastId = place(sim, pids[0]);
    bgResolveDesertion(sim.ctx, pids[0]);
    expect(match.teams[0]).not.toContain(pids[0]);
    expect(sim.entities.has(feastId)).toBe(true);
    endBgMatch(sim.ctx, match, 1, 'forfeit');
    expect(sim.entities.has(feastId)).toBe(false);
    expect(sim.feasts.has(feastId)).toBe(false);
    expect(sim.feasts.has(place(sim, pids[0]))).toBe(true);
  });

  it('keeps arena feasts through the aftermath, then removes them at slot release', () => {
    const sim = world();
    const pids = players(sim, 2);
    startArenaMatch(sim.ctx, '1v1', [pids[0]], [pids[1]]);
    const match = must(sim.arenaMatches.get(pids[0]));
    const feastId = place(sim, pids[0]);
    endArenaMatch(sim.ctx, match, 'A', 'defeat');
    expect(match.state).toBe('over');
    expect(sim.entities.has(feastId)).toBe(true);
    match.timer = 0;
    updateArena(sim.ctx);
    expect(sim.entities.has(feastId)).toBe(false);
    expect(sim.feasts.has(feastId)).toBe(false);
  });

  it('keeps battleground feasts through the result hold, then reclaims missing entities too', () => {
    const sim = world();
    const pids = players(sim, 10);
    startBgMatch(sim.ctx, pids.slice(0, 5), pids.slice(5), { rated: false });
    const match = must(sim.bgMatches.get(pids[0]));
    const feastId = place(sim, pids[0]);
    match.state = 'active';
    match.timer = BG_MAX_DURATION;
    updateBattleground(sim.ctx);
    expect(match.state).toBe('ended');
    expect(sim.entities.has(feastId)).toBe(true);
    sim.ctx.dropEntity(feastId);
    match.timer = 0;
    updateBattleground(sim.ctx);
    expect(match.fightersReleased).toBe(true);
    expect(sim.feasts.has(feastId)).toBe(false);
    expect(sim.feasts.has(place(sim, pids[0]))).toBe(true);
  });

  it('isolates concurrent matches, including equal ids in different mode pools', () => {
    const sim = world();
    const pids = players(sim, 14);
    startArenaMatch(sim.ctx, '1v1', [pids[0]], [pids[1]]);
    startArenaMatch(sim.ctx, '1v1', [pids[2]], [pids[3]]);
    startBgMatch(sim.ctx, pids.slice(4, 9), pids.slice(9), { rated: false });
    const first = must(sim.arenaMatches.get(pids[0]));
    const second = must(sim.arenaMatches.get(pids[2]));
    const bg = must(sim.bgMatches.get(pids[4]));
    expect(first.id).toBe(bg.id);
    const firstFeast = place(sim, pids[0]);
    const secondFeast = place(sim, pids[2]);
    const bgFeast = place(sim, pids[4]);
    endArenaMatch(sim.ctx, first, 'A', 'forfeit');
    expect(sim.entities.has(firstFeast)).toBe(false);
    expect(sim.entities.has(secondFeast)).toBe(true);
    expect(sim.entities.has(bgFeast)).toBe(true);
    endBgMatch(sim.ctx, bg, 0, 'forfeit');
    expect(sim.entities.has(bgFeast)).toBe(false);
    expect(sim.entities.has(secondFeast)).toBe(true);
    endArenaMatch(sim.ctx, second, 'B', 'forfeit');
    expect(sim.entities.has(secondFeast)).toBe(false);
    expect(sim.feasts.size).toBe(0);
  });
});
