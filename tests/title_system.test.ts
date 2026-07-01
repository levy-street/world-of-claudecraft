import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function makeWorld(): Sim {
  return new Sim({ seed: 11, playerClass: 'warrior', noPlayer: true });
}

function lastError(events: SimEvent[], pid: number): string | undefined {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error' && e.pid === pid)
    .at(-1)?.text;
}

function runCommand(sim: Sim, pid: number, command: string): string | undefined {
  sim.tick();
  expect(sim.chat(command, pid)).toBeNull();
  return lastError(sim.tick(), pid);
}

function player(sim: Sim, pid: number) {
  const meta = sim.meta(pid);
  const e = sim.entities.get(pid);
  if (!meta || !e) throw new Error(`Missing player ${pid}`);
  return { meta, e };
}

function characterState(sim: Sim, pid: number) {
  const state = sim.serializeCharacter(pid);
  if (!state) throw new Error(`Missing character state ${pid}`);
  return state;
}

describe('player titles', () => {
  it('starts new players with an earned active title and persists it', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Ari');
    const { meta, e } = player(sim, pid);

    expect(meta.earnedTitles.has('adventurer')).toBe(true);
    expect(meta.activeTitle).toBe('adventurer');
    expect(e.title).toBe('the Adventurer');

    const state = characterState(sim, pid);
    expect(state.earnedTitles).toContain('adventurer');
    expect(state.activeTitle).toBe('adventurer');

    const loaded = makeWorld();
    const loadedPid = loaded.addPlayer('warrior', 'Ari', { state });
    expect(loaded.meta(loadedPid)?.activeTitle).toBe('adventurer');
    expect(loaded.entities.get(loadedPid)?.title).toBe('the Adventurer');
  });

  it('unlocks and selects level-gated titles through /title', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Ari');
    const { meta, e } = player(sim, pid);

    sim.setPlayerLevel(10, pid);
    expect(meta.earnedTitles.has('veteran')).toBe(true);

    expect(runCommand(sim, pid, '/title veteran')).toBe('Title selected: the Veteran.');
    expect(meta.activeTitle).toBe('veteran');
    expect(e.title).toBe('the Veteran');

    const readout = runCommand(sim, pid, '/title');
    expect(readout).toContain('Active title: the Veteran.');
    expect(readout).toContain('* veteran: the Veteran');
  });

  it('rejects locked titles and clears the selected title', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Ari');
    const { meta, e } = player(sim, pid);

    expect(runCommand(sim, pid, '/title champion')).toBe('You have not earned the Champion.');
    expect(meta.activeTitle).toBe('adventurer');
    expect(e.title).toBe('the Adventurer');

    expect(runCommand(sim, pid, '/title clear')).toBe('Title cleared.');
    expect(meta.activeTitle).toBeNull();
    expect(e.title).toBe('');
    const state = characterState(sim, pid);
    expect(state.activeTitle).toBeNull();

    const loaded = makeWorld();
    const loadedPid = loaded.addPlayer('warrior', 'Ari', { state });
    expect(loaded.meta(loadedPid)?.activeTitle).toBeNull();
    expect(loaded.entities.get(loadedPid)?.title).toBe('');
  });
});
