// The raid run read behind IWorld.raidRun (src/sim/instances/raid_run.ts): the
// raid a player stands in, and which of its boss bodies are down or fighting in
// this claim. The Adventure Journal lands on the engaged boss, else the next
// one standing, on both hosts, so the rows and their states are pinned here
// against a real Smith's Heart claim, and the `rdrun` wire round trip with them.
import { describe, expect, it } from 'vitest';
import { raidRunWireJson } from '../server/dungeon_run_wire';
import { decodeRaidRun, nextRaidRun } from '../src/net/dungeon_run_wire';
import {
  SMITH_HEART_DUNGEON,
  SMITH_HEART_FINAL_BOSS,
  SMITH_HEART_GUARDIANS,
} from '../src/sim/content/smith_heart';
import { BUILTIN_WORLD, DUNGEONS } from '../src/sim/data';
import { COUNCIL_SEAM_SINGER } from '../src/sim/encounters/smith_heart/council_ids';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { RAID_RUN_PLANS, raidRunForPlayer } from '../src/sim/instances/raid_run';
import { type InstanceSlot, Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function raid(): { sim: Sim; inst: InstanceSlot; pid: number } {
  const sim = new Sim({
    seed: 31,
    playerClass: 'warrior',
    noPlayer: true,
    world: WORLD,
    devCommands: true,
  });
  const pid = sim.addPlayer('warrior', 'Reader');
  if (!enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)) throw new Error('enter');
  const inst = sim.ctx.instances.find(
    (i) => i.dungeonId === SMITH_HEART_DUNGEON && i.partyKey !== null,
  ) as InstanceSlot;
  return { sim, inst, pid };
}

function body(sim: Sim, inst: InstanceSlot, mobId: string): Entity {
  const index = DUNGEONS[inst.dungeonId].spawns.findIndex((s) => s.mobId === mobId);
  const mob = sim.ctx.entities.get(inst.mobIds[index]);
  if (!mob) throw new Error(`${mobId} not placed`);
  return mob;
}

describe('raid run (IWorld.raidRun)', () => {
  it('tracks the Smith Heart bodies in route order, the council as two rows', () => {
    expect(RAID_RUN_PLANS[SMITH_HEART_DUNGEON]).toEqual([
      'heart_hammer_guardian',
      'heart_seam_singer',
      'heart_breath_guardian',
      'heart_quench_guardian',
      'heart_heat_guardian',
      'heart_masterless_strength',
    ]);
    expect(SMITH_HEART_GUARDIANS.hammer).toBe('heart_hammer_guardian');
    expect(COUNCIL_SEAM_SINGER).toBe('heart_seam_singer');
    expect(SMITH_HEART_FINAL_BOSS).toBe('heart_masterless_strength');
  });

  it('reads every row standing and idle on a fresh claim', () => {
    const { sim, pid } = raid();
    const view = raidRunForPlayer(sim.ctx, pid);
    expect(view?.dungeonId).toBe(SMITH_HEART_DUNGEON);
    expect(view?.difficulty).toBe('normal');
    expect(view?.bosses.map((b) => [b.mobId, b.defeated, b.engaged])).toEqual(
      RAID_RUN_PLANS[SMITH_HEART_DUNGEON].map((mobId) => [mobId, false, false]),
    );
    // The offline Sim serves the same view through the IWorld member.
    expect(sim.raidRun).toBe(view);
  });

  it('is reference-stable until a row changes, then flips defeated and engaged', () => {
    const { sim, inst, pid } = raid();
    const first = raidRunForPlayer(sim.ctx, pid);
    expect(raidRunForPlayer(sim.ctx, pid)).toBe(first);

    const breath = body(sim, inst, SMITH_HEART_GUARDIANS.breath);
    breath.inCombat = true;
    breath.aiState = 'chase';
    const pulled = raidRunForPlayer(sim.ctx, pid);
    expect(pulled).not.toBe(first);
    const breathRow = pulled?.bosses.find((b) => b.mobId === SMITH_HEART_GUARDIANS.breath);
    expect(breathRow).toEqual({
      mobId: SMITH_HEART_GUARDIANS.breath,
      defeated: false,
      engaged: true,
    });

    // Walking home is not a fight.
    breath.aiState = 'evade';
    expect(
      raidRunForPlayer(sim.ctx, pid)?.bosses.find((b) => b.mobId === breath.templateId)?.engaged,
    ).toBe(false);

    const singer = body(sim, inst, COUNCIL_SEAM_SINGER);
    sim.ctx.handleDeath(singer, sim.ctx.entities.get(pid) as Entity);
    const rows = raidRunForPlayer(sim.ctx, pid)?.bosses ?? [];
    expect(rows.find((b) => b.mobId === COUNCIL_SEAM_SINGER)).toEqual({
      mobId: COUNCIL_SEAM_SINGER,
      defeated: true,
      engaged: false,
    });
    expect(rows.find((b) => b.mobId === SMITH_HEART_GUARDIANS.hammer)?.defeated).toBe(false);
  });

  it('is null outside the raid', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', world: WORLD });
    expect(raidRunForPlayer(sim.ctx, sim.player.id)).toBeNull();
    expect(sim.raidRun).toBeNull();
  });

  it('round-trips the rdrun wire and keeps the mirror reference-stable', () => {
    const { sim, inst, pid } = raid();
    body(sim, inst, SMITH_HEART_GUARDIANS.quench).inCombat = true;
    const json = raidRunWireJson(sim.ctx, pid);
    const decoded = decodeRaidRun(JSON.parse(json));
    expect(decoded).toEqual(raidRunForPlayer(sim.ctx, pid));
    // The JSON is built once per view.
    expect(raidRunWireJson(sim.ctx, pid)).toBe(json);
    // A repeated frame keeps the held object; a cleared one is null.
    expect(nextRaidRun(decoded, JSON.parse(json))).toBe(decoded);
    expect(nextRaidRun(decoded, null)).toBeNull();
    expect(raidRunWireJson(new Sim({ seed: 4, playerClass: 'mage', world: WORLD }).ctx, 1)).toBe(
      'null',
    );
  });

  it('drops a malformed or unknown frame whole', () => {
    const good = { dungeonId: SMITH_HEART_DUNGEON, difficulty: 'heroic', bosses: [] as unknown[] };
    good.bosses.push({ mobId: SMITH_HEART_FINAL_BOSS, defeated: false, engaged: true });
    expect(decodeRaidRun(good)?.bosses[0].engaged).toBe(true);
    expect(decodeRaidRun({ ...good, dungeonId: 'nowhere' })).toBeNull();
    expect(decodeRaidRun({ ...good, difficulty: 'mythic' })).toBeNull();
    expect(
      decodeRaidRun({ ...good, bosses: [{ mobId: SMITH_HEART_FINAL_BOSS, defeated: false }] }),
    ).toBeNull();
    expect(
      decodeRaidRun({ ...good, bosses: [{ mobId: 'not_a_mob', defeated: true, engaged: false }] }),
    ).toBeNull();
    expect(
      decodeRaidRun({
        ...good,
        bosses: [{ mobId: SMITH_HEART_FINAL_BOSS, defeated: 'yes', engaged: false }],
      }),
    ).toBeNull();
    expect(decodeRaidRun({ ...good, bosses: [] })).toBeNull();
    expect(decodeRaidRun({ ...good, bosses: Array(17).fill(good.bosses[0]) })).toBeNull();
    expect(decodeRaidRun({ ...good, bosses: ['row'] })).toBeNull();
  });
});
