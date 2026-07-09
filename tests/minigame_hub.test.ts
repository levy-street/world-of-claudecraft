import { describe, expect, it } from 'vitest';
import { resolvePosition } from '../src/sim/colliders';
import { GAUNTLET_RECRUITER_ID } from '../src/sim/content/gauntlet';
import { HC_HERALD_ID } from '../src/sim/content/hodrics';
import {
  HUB_EXIT_TEMPLATE,
  HUB_PORTAL_TEMPLATE,
  isMinigameHubPos,
  MINIGAME_HUB,
  MINIGAME_HUB_ENTRY,
  MINIGAME_HUB_EXIT,
  MINIGAME_HUB_MARO,
  MINIGAME_HUB_OSRIC,
  MINIGAME_HUB_PORTAL_POS,
  MINIGAME_HUB_RADIUS,
} from '../src/sim/data';
import { HUB_EXIT_ID, HUB_PORTAL_ID } from '../src/sim/minigame_hub';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function makeSim(opts: { gauntletAlwaysOpen?: boolean } = {}): Sim {
  return new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true, ...opts });
}

function teleport(sim: Sim, pid: number, x: number, z: number): void {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as unknown as { rebucket: (e: unknown) => void }).rebucket(e);
}

function errorTexts(evs: SimEvent[]): string[] {
  return evs.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text);
}

describe('the Proving Grounds hub', () => {
  it('classifies its own band and nothing else', () => {
    expect(isMinigameHubPos(MINIGAME_HUB.x)).toBe(true);
    expect(isMinigameHubPos(0)).toBe(false); // Eastbrook town
    expect(isMinigameHubPos(900)).toBe(false); // a dungeon band
    expect(isMinigameHubPos(13200)).toBe(false); // the Gauntlet band
    expect(isMinigameHubPos(15300)).toBe(false); // Hodric's Castle band
  });

  it('spawns both heralds and both portal fixtures at reserved ids', () => {
    const sim = makeSim();
    const maro = sim.entities.get(GAUNTLET_RECRUITER_ID);
    const osric = sim.entities.get(HC_HERALD_ID);
    const portal = sim.entities.get(HUB_PORTAL_ID);
    const exit = sim.entities.get(HUB_EXIT_ID);
    expect(maro?.templateId).toBe('gauntlet_recruiter');
    expect(osric?.templateId).toBe('hodrics_herald');
    expect(portal?.templateId).toBe(HUB_PORTAL_TEMPLATE);
    expect(exit?.templateId).toBe(HUB_EXIT_TEMPLATE);
    // the heralds stand on their ring marks inside the room
    expect(maro!.pos.x).toBeCloseTo(MINIGAME_HUB.x + MINIGAME_HUB_MARO.x, 5);
    expect(maro!.pos.z).toBeCloseTo(MINIGAME_HUB.z + MINIGAME_HUB_MARO.z, 5);
    expect(osric!.pos.x).toBeCloseTo(MINIGAME_HUB.x + MINIGAME_HUB_OSRIC.x, 5);
    expect(isMinigameHubPos(maro!.pos.x)).toBe(true);
    expect(isMinigameHubPos(osric!.pos.x)).toBe(true);
    // the entrance portal is out in the overworld; the exit is inside the room
    expect(isMinigameHubPos(portal!.pos.x)).toBe(false);
    expect(isMinigameHubPos(exit!.pos.x)).toBe(true);
    // the recruiter id is registered for the Gauntlet join gate
    expect((sim as unknown as { gauntletRecruiterId: number }).gauntletRecruiterId).toBe(
      GAUNTLET_RECRUITER_ID,
    );
  });

  it('walks you through the entrance portal and back out the exit', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Traveler');
    const p = sim.entities.get(pid)!;
    // stand on the overworld portal, tick -> the walk-in trigger enters
    teleport(sim, pid, MINIGAME_HUB_PORTAL_POS.x, MINIGAME_HUB_PORTAL_POS.z);
    sim.tick();
    expect(isMinigameHubPos(p.pos.x)).toBe(true);
    expect(p.pos.x).toBeCloseTo(MINIGAME_HUB.x + MINIGAME_HUB_ENTRY.x, 5);
    expect(p.pos.z).toBeCloseTo(MINIGAME_HUB.z + MINIGAME_HUB_ENTRY.z, 5);
    // stand on the exit portal, tick -> the walk-in trigger leaves
    teleport(sim, pid, MINIGAME_HUB.x + MINIGAME_HUB_EXIT.x, MINIGAME_HUB.z + MINIGAME_HUB_EXIT.z);
    sim.tick();
    expect(isMinigameHubPos(p.pos.x)).toBe(false);
  });

  it('does not re-trigger the portal it just dropped you beside', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Traveler');
    const p = sim.entities.get(pid)!;
    teleport(sim, pid, MINIGAME_HUB_PORTAL_POS.x, MINIGAME_HUB_PORTAL_POS.z);
    sim.tick(); // enter
    expect(isMinigameHubPos(p.pos.x)).toBe(true);
    sim.tick(); // idle on the entry mark: must NOT be bounced back out by the exit
    expect(isMinigameHubPos(p.pos.x)).toBe(true);
  });

  it('holds movers inside the circular room (radial clamp)', () => {
    const seed = 1;
    // a point well outside the wall to the north clamps back onto the room
    const out = resolvePosition(seed, MINIGAME_HUB.x, MINIGAME_HUB.z + 100, 0.5);
    const d = Math.hypot(out.x - MINIGAME_HUB.x, out.z - MINIGAME_HUB.z);
    expect(d).toBeLessThanOrEqual(MINIGAME_HUB_RADIUS);
    // a point already inside is left untouched
    const inside = resolvePosition(seed, MINIGAME_HUB.x + 2, MINIGAME_HUB.z + 2, 0.5);
    expect(inside.x).toBeCloseTo(MINIGAME_HUB.x + 2, 5);
    expect(inside.z).toBeCloseTo(MINIGAME_HUB.z + 2, 5);
  });

  it('blocks the reading tables, bookcases, and chairs (no walking through furniture)', () => {
    const seed = 1;
    const blocked = (lx: number, lz: number): boolean => {
      const r = resolvePosition(seed, MINIGAME_HUB.x + lx, MINIGAME_HUB.z + lz, 0.5);
      return Math.hypot(r.x - (MINIGAME_HUB.x + lx), r.z - (MINIGAME_HUB.z + lz)) > 1e-3;
    };
    // the east + west reading tables
    expect(blocked(8.5, -1.5)).toBe(true);
    expect(blocked(-8.5, -1.5)).toBe(true);
    // the long study table behind the heralds
    expect(blocked(0, 11.5)).toBe(true);
    // a bookcase on the ring (north, radius ~17.1)
    expect(blocked(0, MINIGAME_HUB_RADIUS - 0.9)).toBe(true);
    // open floor stays walkable: the entry + exit marks, the room centre, and
    // the spots the two heralds stand on
    expect(blocked(MINIGAME_HUB_ENTRY.x, MINIGAME_HUB_ENTRY.z)).toBe(false);
    expect(blocked(MINIGAME_HUB_EXIT.x, MINIGAME_HUB_EXIT.z)).toBe(false);
    expect(blocked(0, 0)).toBe(false);
    expect(blocked(MINIGAME_HUB_MARO.x, MINIGAME_HUB_MARO.z)).toBe(false);
    expect(blocked(MINIGAME_HUB_OSRIC.x, MINIGAME_HUB_OSRIC.z)).toBe(false);
  });

  it('lets you join the Gauntlet from beside Maro in the hub', () => {
    const sim = makeSim({ gauntletAlwaysOpen: true });
    const pid = sim.addPlayer('warrior', 'Fighter');
    const maro = sim.entities.get(GAUNTLET_RECRUITER_ID)!;
    teleport(sim, pid, maro.pos.x, maro.pos.z);
    sim.gauntletJoin(pid);
    sim.tick();
    expect(sim.gauntletRuns.length).toBe(1);
    expect(sim.gauntletRuns[0]!.playerStates.has(pid)).toBe(true);
  });

  it("lets you queue for Hodric's race from inside the hub", () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Racer');
    const osric = sim.entities.get(HC_HERALD_ID)!;
    teleport(sim, pid, osric.pos.x, osric.pos.z);
    sim.hcQueueJoin(pid);
    const evs = sim.tick();
    // the "cannot queue from inside an instance" guard is exempt for the hub
    expect(errorTexts(evs)).not.toContain('You cannot queue from inside an instance.');
    expect(
      (sim as unknown as { hcQueue: { pid: number }[] }).hcQueue.some((u) => u.pid === pid),
    ).toBe(true);
  });
});
