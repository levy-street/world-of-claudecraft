import { describe, expect, it } from 'vitest';
import { updateDoorTriggers } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import {
  isSourceCavePos,
  SOURCE_CAVE_DOOR_ID,
  SOURCE_CAVE_WELL_BANTER_LINES,
} from '../src/sim/source_cave';
import type { Entity } from '../src/sim/types';

// biome-ignore lint/suspicious/noExplicitAny: tests reach ctx / private helpers.
type AnySim = Sim & any;

function makeSim(seed = 1234): AnySim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true }) as AnySim;
}

function teleport(sim: AnySim, e: Entity, x: number, z: number): void {
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

function standAtWell(sim: AnySim, pid: number): Entity {
  const p = sim.entities.get(pid) as Entity;
  const door = sim.entities.get(SOURCE_CAVE_DOOR_ID) as Entity;
  teleport(sim, p, door.pos.x, door.pos.z);
  return p;
}

function lastNotice(sim: AnySim): string | undefined {
  const events = sim.drainEvents() as { type: string; text?: string }[];
  return events.filter((e) => e.type === 'log').at(-1)?.text;
}

describe('source cave well: banter gate', () => {
  it('points the conflict below the well toward the cave', () => {
    expect(SOURCE_CAVE_WELL_BANTER_LINES[7]).toBe(
      "That's a source of conflict down there, you know.",
    );
  });

  it('plays each banter line in order, once per interaction, without entering', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    const p = standAtWell(sim, pid);
    sim.drainEvents(); // discard the join/spawn noise

    for (let i = 0; i < SOURCE_CAVE_WELL_BANTER_LINES.length; i++) {
      sim.interact(pid);
      expect(lastNotice(sim), `line ${i + 1}`).toBe(SOURCE_CAVE_WELL_BANTER_LINES[i]);
      expect(isSourceCavePos(p.pos.x), `still outside after line ${i + 1}`).toBe(false);
    }
  });

  it('the interaction past the last line finally opens the well', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    const p = standAtWell(sim, pid);
    sim.drainEvents();

    for (let i = 0; i < SOURCE_CAVE_WELL_BANTER_LINES.length; i++) sim.interact(pid);
    expect(isSourceCavePos(p.pos.x)).toBe(false); // still outside after all 10 lines

    sim.interact(pid);
    expect(isSourceCavePos(p.pos.x)).toBe(true); // the 11th interaction enters
  });

  it('once unlocked this session, every further interaction enters immediately (no replay)', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    const p = standAtWell(sim, pid);
    for (let i = 0; i <= SOURCE_CAVE_WELL_BANTER_LINES.length; i++) sim.interact(pid);
    expect(isSourceCavePos(p.pos.x)).toBe(true);

    // Leave, walk back up to the well, and interact again: no banter this time.
    sim.leaveDungeon(pid);
    expect(isSourceCavePos(p.pos.x)).toBe(false);
    standAtWell(sim, pid);
    sim.drainEvents();
    sim.interact(pid);
    expect(isSourceCavePos(p.pos.x)).toBe(true);
  });

  it('an ineligible player still gets denied on the interaction that would open the well', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(19, pid); // below the level-20 gate
    const p = standAtWell(sim, pid);
    for (let i = 0; i < SOURCE_CAVE_WELL_BANTER_LINES.length; i++) sim.interact(pid);
    sim.drainEvents();

    sim.interact(pid);
    expect(isSourceCavePos(p.pos.x)).toBe(false);
    const events = sim.drainEvents() as { type: string; text?: string }[];
    expect(
      events.some(
        (e) => e.type === 'error' && e.text === 'You must reach level 20 to enter The Open Source.',
      ),
    ).toBe(true);
  });

  it('tracks each player independently: one player banters while another has none yet', () => {
    const sim = makeSim();
    const pidA = sim.addPlayer('warrior', 'Alice');
    const pidB = sim.addPlayer('warrior', 'Bob');
    sim.setPlayerLevel(20, pidA);
    sim.setPlayerLevel(20, pidB);
    standAtWell(sim, pidA);
    sim.interact(pidA);
    sim.interact(pidA);
    sim.drainEvents();

    standAtWell(sim, pidB);
    sim.interact(pidB);
    expect(lastNotice(sim)).toBe(SOURCE_CAVE_WELL_BANTER_LINES[0]);
  });

  it('walking up to the well never auto-enters: only an explicit interact advances the gate', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    const p = standAtWell(sim, pid);
    sim.drainEvents();

    // The generic walk-in door trigger would normally teleport a player standing
    // this close to any other dungeon door; the well must not.
    updateDoorTriggers(sim.ctx, p);
    expect(isSourceCavePos(p.pos.x)).toBe(false);
    expect(sim.drainEvents().length).toBe(0);
  });
});
