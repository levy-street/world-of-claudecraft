import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';
import type { SimEvent } from '../src/sim/types';
import { COURSES } from '../src/sim/content/courses';

type P = { pos: { x: number; y: number; z: number }; prevPos: { x: number; y: number; z: number }; mountTier?: number; mountId?: string; kind: string; hostile?: boolean; aiState?: string };

// A party of `n` flyers staged on open ground, all mounted on a flyer.
function makeParty(n: number): { sim: Sim; pids: number[] } {
  const sim = new Sim({ seed: 5, playerClass: 'warrior', autoEquip: true, noPlayer: true });
  const pids: number[] = [];
  for (let i = 0; i < n; i++) {
    const pid = sim.addPlayer('warrior', `Racer${i}`);
    const e = sim.entities.get(pid) as unknown as P;
    e.pos.x = 40 + i * 0.5; e.pos.z = 40;
    e.pos.y = terrainHeight(e.pos.x, e.pos.z, sim.cfg.seed);
    e.prevPos = { ...e.pos };
    e.mountTier = 11;
    e.mountId = 'sovereign'; // a flyer (set directly; the race doesn't re-cast)
    pids.push(pid);
  }
  for (const ent of sim.entities.values()) {
    if (ent.kind === 'mob') { ent.hostile = false; ent.aggroTargetId = null; ent.aiState = 'idle'; }
  }
  // leader (pid 0) invites the rest into a party
  for (let i = 1; i < n; i++) { sim.partyInvite(pids[i], pids[0]); sim.partyAccept(pids[i]); }
  return { sim, pids };
}

function driveThroughCourse(sim: Sim, pid: number): SimEvent[] {
  const e = sim.entities.get(pid) as unknown as P;
  const def = COURSES.skytrial_vale;
  const evs: SimEvent[] = [];
  for (const gate of def.checkpoints) {
    e.pos.x = gate.x; e.pos.y = gate.y; e.pos.z = gate.z;
    for (const ev of sim.tick()) evs.push(ev);
  }
  return evs;
}

describe('multi-racer races', () => {
  it('forms a party race, runs a synchronized countdown, and places by finish order', () => {
    const { sim, pids } = makeParty(3);
    expect(sim.partyOf(pids[0])?.members.length).toBe(3);

    expect(sim.startRace('skytrial_vale', pids[0])).toBe(true);
    // all three are in a countdown (frozen, clock not started)
    const info0 = sim.raceInfoFor(pids[0])!;
    expect(info0.state).toBe('countdown');
    expect(info0.participants.length).toBe(3);
    expect(info0.countdown).toBeGreaterThan(0);

    // run out the countdown → GO (clocks start together)
    const goEvents: SimEvent[] = [];
    for (let i = 0; i < 61; i++) for (const ev of sim.tick()) goEvents.push(ev);
    expect(goEvents.some((e) => e.type === 'raceGo')).toBe(true);
    expect(sim.raceInfoFor(pids[0])!.state).toBe('active');

    // finish racer0, then racer1, then racer2 (others hover at the start)
    const fin0 = driveThroughCourse(sim, pids[0]);
    expect(fin0.some((e) => e.type === 'raceFinish' && e.place === 1)).toBe(true);
    driveThroughCourse(sim, pids[1]);
    const fin2 = driveThroughCourse(sim, pids[2]);
    // the last finisher closes the race → everyone gets a raceResult with a place
    const results = fin2.filter((e): e is Extract<SimEvent, { type: 'raceResult' }> => e.type === 'raceResult');
    expect(results.length).toBe(3);
    const placeByPid = new Map(results.map((e) => [e.pid, e.place]));
    expect(placeByPid.get(pids[0])).toBe(1);
    expect(placeByPid.get(pids[1])).toBe(2);
    expect(placeByPid.get(pids[2])).toBe(3);

    // raceInfo reflects final placement, leaders first
    const finalInfo = sim.raceInfoFor(pids[0])!;
    expect(finalInfo.state).toBe('done');
    expect(finalInfo.participants[0].place).toBe(1);
    expect(finalInfo.participants.every((p) => p.done)).toBe(true);
  });

  it('a racer who loses flight mid-race is a DNF (place 0), not blocking the result', () => {
    const { sim, pids } = makeParty(2);
    sim.startRace('skytrial_vale', pids[0]);
    for (let i = 0; i < 61; i++) sim.tick(); // GO
    // racer1 loses their mount → DNF
    sim.dismissMount(pids[1]);
    sim.tick();
    // racer0 finishes; the race resolves with racer1 DNF
    const evs = driveThroughCourse(sim, pids[0]);
    const results = evs.filter((e): e is Extract<SimEvent, { type: 'raceResult' }> => e.type === 'raceResult');
    expect(results.length).toBe(2);
    expect(results.find((e) => e.pid === pids[0])!.place).toBe(1);
    expect(results.find((e) => e.pid === pids[1])!.place).toBe(0); // DNF
    const info = sim.raceInfoFor(pids[0])!;
    expect(info.participants.find((p) => p.pid === pids[1])!.dnf).toBe(true);
  });

  it('rejects a race on a ground mount (flyingOnly course)', () => {
    const { sim, pids } = makeParty(1);
    const e = sim.entities.get(pids[0]) as unknown as P;
    e.mountId = 'emberhoof'; // ground
    expect(sim.startRace('skytrial_vale', pids[0])).toBe(false);
  });
});
