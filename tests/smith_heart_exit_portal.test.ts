// The Smith's Heart's way out (the team's review of 2026-11-17): once the
// Masterless Strength falls, an exit portal opens on the far side of the Anvil
// of the World from the Arrival Terrace and walks a living player back to the
// raid's entrance beside Warden Collier. Driven through a real Sim claim
// (src/sim/encounters/smith_heart/portal.ts and seal.ts).

import { afterEach, describe, expect, it } from 'vitest';
import { SMITH_HEART_FINAL_BOSS } from '../src/sim/content/smith_heart';
import {
  HEART_ARRIVAL,
  HEART_EXIT_LANDING,
  HEART_EXIT_PORTAL,
  HEART_ROOM,
  HEART_TERRACE,
} from '../src/sim/content/smith_heart_layout';
import { SMITH_HEART_ESSENCE_NPC_SPOT } from '../src/sim/content/smith_heart_rewards';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { displacePlayerForDev } from '../src/sim/dev/dev_displace';
import {
  SMITH_HEART_EXIT_BIT,
  SMITH_HEART_PORTAL_EXIT_TEXT,
  smithHeartExitBitSet,
  smithHeartSealMaskOf,
} from '../src/sim/encounters/smith_heart';
import { clearDungeonGateStateForTest } from '../src/sim/instances/dungeon_gate_state';
import { enterDungeon } from '../src/sim/instances/dungeons';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { localizeSimText } from '../src/ui/sim_i18n';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
const SPAWNS = DUNGEONS.smith_heart.spawns;

function setup(): { sim: Sim; pid: number; inst: InstanceSlot } {
  const sim = new Sim({
    seed: 17,
    playerClass: 'warrior',
    noPlayer: true,
    world: WORLD,
    devCommands: true,
  });
  const pid = sim.addPlayer('warrior', 'Heartwalker');
  expect(enterDungeon(sim.ctx, 'smith_heart', pid)).toBe(true);
  const inst = sim.ctx.instances.find(
    (i) => i.dungeonId === 'smith_heart' && i.partyKey !== null,
  ) as InstanceSlot;
  sim.tick();
  return { sim, pid, inst };
}

function put(sim: Sim, pid: number, inst: InstanceSlot, x: number, z: number): void {
  const o = instanceOrigin(DUNGEONS.smith_heart.index, inst.slot);
  displacePlayerForDev(sim.ctx, sim.ctx.entities.get(pid) as Entity, o.x + x, o.z + z);
}

function local(sim: Sim, pid: number, inst: InstanceSlot): { x: number; z: number } {
  const o = instanceOrigin(DUNGEONS.smith_heart.index, inst.slot);
  const e = sim.ctx.entities.get(pid) as Entity;
  return { x: e.pos.x - o.x, z: e.pos.z - o.z };
}

function logs(events: unknown[], pid: number): string[] {
  return (events as { type: string; text?: string; pid?: number }[])
    .filter((e) => e.type === 'log' && e.pid === pid)
    .map((e) => e.text ?? '');
}

function markerBits(sim: Sim, inst: InstanceSlot): number[] {
  const out: number[] = [];
  for (const id of inst.objectIds) {
    const e = sim.ctx.entities.get(id);
    const m = e ? smithHeartSealMaskOf(e.templateId) : null;
    if (m !== null) out.push(m);
  }
  return out;
}

function killFinal(sim: Sim, inst: InstanceSlot): void {
  SPAWNS.forEach((s, i) => {
    if (s.mobId !== SMITH_HEART_FINAL_BOSS) return;
    const mob = sim.ctx.entities.get(inst.mobIds[i]) as Entity;
    mob.hp = 0;
    mob.dead = true;
    mob.aiState = 'dead';
    mob.inCombat = false;
  });
}

const near = (a: { x: number; z: number }, b: { x: number; z: number }, d: number) =>
  Math.hypot(a.x - b.x, a.z - b.z) < d;

describe("the Smith's Heart's exit portal", () => {
  afterEach(() => clearDungeonGateStateForTest());

  it('stands on the platform, on the far side of the arena from the Arrival Terrace', () => {
    const fromCentre = Math.hypot(
      HEART_EXIT_PORTAL.x - HEART_ROOM.x,
      HEART_EXIT_PORTAL.z - HEART_ROOM.z,
    );
    expect(fromCentre + HEART_EXIT_PORTAL.r).toBeLessThan(HEART_ROOM.r);
    // Opposite the terrace: the bearings differ by about half a turn.
    const toExit = Math.atan2(
      HEART_EXIT_PORTAL.x - HEART_ROOM.x,
      HEART_EXIT_PORTAL.z - HEART_ROOM.z,
    );
    const toTerrace = Math.atan2(HEART_TERRACE.x - HEART_ROOM.x, HEART_TERRACE.z - HEART_ROOM.z);
    const turn = Math.abs(Math.atan2(Math.sin(toExit - toTerrace), Math.cos(toExit - toTerrace)));
    expect(turn).toBeGreaterThan(Math.PI * 0.9);
    // The landing is the raid's entrance, beside Warden Collier.
    expect(
      Math.hypot(
        HEART_EXIT_LANDING.x - SMITH_HEART_ESSENCE_NPC_SPOT.x,
        HEART_EXIT_LANDING.z - SMITH_HEART_ESSENCE_NPC_SPOT.z,
      ),
    ).toBeLessThan(8);
  });

  it('is shut while the final boss lives, opens on its fall and walks a living player to the entrance', () => {
    const { sim, pid, inst } = setup();
    put(sim, pid, inst, HEART_EXIT_PORTAL.x, HEART_EXIT_PORTAL.z);
    sim.tick();
    // Shut: no exit bit, nobody moved.
    expect(markerBits(sim, inst).every((m) => !smithHeartExitBitSet(m))).toBe(true);
    expect(near(local(sim, pid, inst), HEART_EXIT_PORTAL, 1.5)).toBe(true);
    // The fall opens it: the marker carries the exit bit, the player crosses.
    put(sim, pid, inst, HEART_ARRIVAL.x, HEART_ARRIVAL.z);
    killFinal(sim, inst);
    sim.tick();
    expect(markerBits(sim, inst).length).toBeGreaterThan(0);
    expect(markerBits(sim, inst).every((m) => smithHeartExitBitSet(m))).toBe(true);
    put(sim, pid, inst, HEART_EXIT_PORTAL.x, HEART_EXIT_PORTAL.z);
    const events = sim.tick();
    expect(near(local(sim, pid, inst), HEART_EXIT_LANDING, 0.6)).toBe(true);
    expect(logs(events, pid)).toContain(SMITH_HEART_PORTAL_EXIT_TEXT);
    // The landing sits clear of every portal and the dungeon's own exit: the
    // player stays in the raid, at the entrance.
    sim.tick();
    expect(near(local(sim, pid, inst), HEART_EXIT_LANDING, 0.6)).toBe(true);
    expect(sim.ctx.instances.includes(inst)).toBe(true);
    expect(inst.partyKey).not.toBeNull();
  });

  it('never takes a corpse', () => {
    const { sim, pid, inst } = setup();
    killFinal(sim, inst);
    sim.tick();
    put(sim, pid, inst, HEART_EXIT_PORTAL.x, HEART_EXIT_PORTAL.z);
    const e = sim.ctx.entities.get(pid) as Entity;
    e.dead = true;
    e.hp = 0;
    sim.tick();
    expect(near(local(sim, pid, inst), HEART_EXIT_PORTAL, 1.5)).toBe(true);
  });

  it('the exit bit is its own (never a vein, the portal or the arrival) and its line is localized', () => {
    expect(SMITH_HEART_EXIT_BIT).toBe(64);
    expect(smithHeartExitBitSet(SMITH_HEART_EXIT_BIT)).toBe(true);
    expect(smithHeartExitBitSet(15 | 16 | 32)).toBe(false);
    expect(smithHeartSealMaskOf(`smith_heart_seal_${15 | 16 | 32 | 64}`)).toBe(127);
    expect(localizeSimText(SMITH_HEART_PORTAL_EXIT_TEXT)).not.toBeNull();
  });
});
