import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as colliders from '../src/sim/colliders';
import { isBlocked } from '../src/sim/colliders';
import { handleDeath } from '../src/sim/combat/damage';
import { DROWNED_TEMPLE_FIELD } from '../src/sim/content/drowned_temple_layout';
import {
  DUNGEON_CHECKPOINTS,
  type DungeonCheckpoint,
} from '../src/sim/content/dungeon_checkpoints';
import { GRAVEWYRM_SANCTUM_FIELD } from '../src/sim/content/gravewyrm_sanctum_layout';
import { HOLLOW_CRYPT_FIELD } from '../src/sim/content/hollow_crypt_layout';
import {
  SUNKEN_BASTION_ANCHORS,
  SUNKEN_BASTION_FIELD,
} from '../src/sim/content/sunken_bastion_layout';
import { WILDHEART_BASIN_FIELD } from '../src/sim/content/wildheart_basin_layout';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { dungeonReentryPoint } from '../src/sim/instances/dungeon_checkpoints';
import {
  clearDungeonGateStateForTest,
  setOpenDungeonGates,
} from '../src/sim/instances/dungeon_gate_state';
import { dungeonGateState, setDungeonGatesDevOpen } from '../src/sim/instances/dungeon_gates';
import { freeInstance, updateDoorTriggers } from '../src/sim/instances/dungeons';
import { MAX_AGGRO_RADIUS, MAX_WANDER_RADIUS } from '../src/sim/mob/aggro_ranges';
import { PATROL_REJOIN_DISTANCE } from '../src/sim/mob/patrol';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { RIFT_ENTRY_CLEAR_RADIUS } from '../src/sim/rift/entry_clearance';
import { type InstanceSlot, Sim } from '../src/sim/sim';
import { RES_HP_FRACTION, RESURRECTION_SICKNESS_ID } from '../src/sim/spirit';
import { type Entity, PLAYER_INTEREST_DROP_RADIUS } from '../src/sim/types';

const CASES = [
  ['hollow_crypt', ['sexton_marrow'], -82, 116],
  ['hollow_crypt', ['rimeweb'], 80, 112],
  ['hollow_crypt', ['sexton_marrow', 'rimeweb', 'cantor_ilvane'], 0, 162],
  ['drowned_temple', ['choirmother_selthe'], 0, 0],
  ['drowned_temple', ['choirmother_selthe', 'tideglass_colossus'], 86, 208],
  ['sunken_bastion', ['knight_commander_olen'], 57, 130],
  ['sunken_bastion', ['knight_commander_olen', 'gaoler_ossick'], -2, 12],
  ['gravewyrm_sanctum', ['korgath_the_bound'], 0, -22],
  ['gravewyrm_sanctum', ['korgath_the_bound', 'grand_necromancer_velkhar'], 0, 107],
  ['wildheart_basin', ['wildheart_beastmaster', 'fanglord_jaguar'], -86, 40],
  ['wildheart_basin', ['the_gorgebloom'], 84, 42],
] as const;

// The Choir Loft's own neighbours. None of them stands behind a gate on the way
// in, and each one denies the loft while it lives (pinned further down): the nave
// guard q1, the aisle patrol q2, and the two Choristers of Cantor's own pack.
const LOFT_NEIGHBOURS = ['q1', 'q2', 'ilvane'] as const;
const LOFT_BOSSES = ['sexton_marrow', 'rimeweb', 'cantor_ilvane'] as const;
const isLoft = (dungeonId: string, bosses: readonly string[]) =>
  dungeonId === 'hollow_crypt' && LOFT_BOSSES.every((boss) => bosses.includes(boss));

// The open gate sets are a process-wide collision view keyed by slot: no test
// inherits the one an earlier sim (or an earlier flood fill) published.
beforeEach(() => clearDungeonGateStateForTest());

const FIELDS = {
  hollow_crypt: HOLLOW_CRYPT_FIELD,
  drowned_temple: DROWNED_TEMPLE_FIELD,
  sunken_bastion: SUNKEN_BASTION_FIELD,
  gravewyrm_sanctum: GRAVEWYRM_SANCTUM_FIELD,
  wildheart_basin: WILDHEART_BASIN_FIELD,
} as const;

function setup(dungeonId = 'hollow_crypt', heroic = false, idleMobTickRadius = 0) {
  const sim = new Sim({
    seed: 99,
    playerClass: 'warrior',
    noPlayer: true,
    idleMobTickRadius,
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  });
  const pid = sim.addPlayer('warrior', 'Runner');
  if (heroic) {
    sim.setPlayerLevel(20, pid);
    sim.setDungeonDifficulty('heroic', pid);
  }
  expect(sim.enterDungeon(dungeonId, pid)).toBe(true);
  const inst = sim.instances.find((i) => i.dungeonId === dungeonId && i.partyKey !== null)!;
  return { sim, pid, inst, player: sim.entities.get(pid)! };
}

function slay(sim: Sim, inst: InstanceSlot, mob: Entity) {
  // Exercise the authoritative death path, including loot and encounter cleanup.
  if (!mob.dead) handleDeath(sim.ctx, mob, sim.entities.get([...inst.enteredBy][0]) ?? null);
}

function rosterMob(sim: Sim, inst: InstanceSlot, templateId: string): Entity {
  const mob = inst.mobIds
    .map((id) => sim.entities.get(id))
    .find((e) => e?.templateId === templateId);
  if (!mob) throw new Error(`Missing ${templateId}`);
  return mob;
}

function kill(sim: Sim, inst: InstanceSlot, ...bosses: string[]) {
  for (const bossId of bosses) slay(sim, inst, rosterMob(sim, inst, bossId));
}

/** Every living mob of the listed placement packs, by the claim's spawn ordinals. */
function packMobs(sim: Sim, inst: InstanceSlot, packIds: readonly string[]): Entity[] {
  const out: Entity[] = [];
  DUNGEONS[inst.dungeonId].spawns.forEach((spawn, i) => {
    if (!spawn.packId || !packIds.includes(spawn.packId)) return;
    const mob = sim.entities.get(inst.mobIds[i]);
    if (mob && !mob.dead) out.push(mob);
  });
  return out;
}

function killPacks(sim: Sim, inst: InstanceSlot, ...packIds: string[]) {
  for (const mob of packMobs(sim, inst, packIds)) slay(sim, inst, mob);
}

function gateOf(dungeonId: string, gateId: string) {
  const gate = DUNGEONS[dungeonId].gates?.find((g) => g.id === gateId);
  if (!gate) throw new Error(`Missing gate ${gateId}`);
  return gate;
}

function rowOf(dungeonId: string, bosses: readonly string[]): DungeonCheckpoint {
  const row = DUNGEON_CHECKPOINTS[dungeonId].find(
    (c) => c.bosses.length === bosses.length && c.bosses.every((b) => bosses.includes(b)),
  );
  if (!row) throw new Error(`No checkpoint for ${bosses.join(', ')}`);
  return row;
}

/**
 * Earn checkpoints the way a group does: clear the packs every gate on the way
 * in waits on, then kill the bosses. Everything else in the dungeon stays alive.
 */
function earn(sim: Sim, inst: InstanceSlot, ...bosses: string[]) {
  for (const row of DUNGEON_CHECKPOINTS[inst.dungeonId]) {
    if (!row.bosses.every((b) => bosses.includes(b))) continue;
    for (const gateId of row.gates)
      killPacks(sim, inst, ...(gateOf(inst.dungeonId, gateId).packs ?? []));
  }
  kill(sim, inst, ...bosses);
}

/** The first living mob of the claim's roster (the cleared route's are dead). */
function livingMob(sim: Sim, inst: InstanceSlot): Entity {
  const mob = inst.mobIds.map((id) => sim.entities.get(id)).find((e) => e && !e.dead);
  if (!mob) throw new Error('No living mob');
  return mob;
}

function doorOf(sim: Sim, dungeonId: string): Entity {
  return [...sim.entities.values()].find(
    (e) => e.templateId === 'dungeon_door' && e.dungeonId === dungeonId,
  )!;
}

function standAt(sim: Sim, e: Entity, x: number, z: number) {
  e.pos = sim.ctx.groundPos(x, z);
  e.prevPos = { ...e.pos };
  sim.ctx.rebucket(e);
}

/** Re-home a mob: its body AND the spawn point its wander ring is centred on. */
function moveHome(sim: Sim, mob: Entity, x: number, z: number) {
  standAt(sim, mob, x, z);
  mob.spawnPos = { ...mob.pos };
}

/** A released spirit whose body lies where the player stands (no door crossed). */
function release(sim: Sim, pid: number) {
  const player = sim.entities.get(pid)!;
  player.dead = true;
  sim.releaseSpirit(pid);
  expect(player.ghost).toBe(true);
}

/** Walk a released spirit through the dungeon's outside door. */
function crossDoor(sim: Sim, pid: number, dungeonId: string) {
  const player = sim.entities.get(pid)!;
  const door = doorOf(sim, dungeonId);
  player.pos = { ...door.pos };
  player.prevPos = { ...player.pos };
  sim.ctx.rebucket(player);
  updateDoorTriggers(sim.ctx, player);
}

function reenter(sim: Sim, pid: number, dungeonId: string) {
  release(sim, pid);
  crossDoor(sim, pid, dungeonId);
}

/** Ground-plane distance between two points. */
function gap(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function localOf(inst: InstanceSlot, x: number, z: number) {
  const origin = instanceOrigin(DUNGEONS[inst.dungeonId].index, inst.slot);
  return { x: origin.x + x, z: origin.z + z };
}

function expectLocal(sim: Sim, pid: number, inst: InstanceSlot, x: number, z: number) {
  const player = sim.entities.get(pid)!;
  const at = localOf(inst, x, z);
  expect(player.pos.x).toBe(at.x);
  expect(player.pos.z).toBe(at.z);
  expect(player.prevPos).toEqual(player.pos);
}

/** Tick `seconds` of sim time: did anything in the claim ever come for `player`? */
function tickAndWatch(sim: Sim, inst: InstanceSlot, player: Entity, seconds: number): boolean {
  let pulled = false;
  for (let i = 0; i < 20 * seconds; i++) {
    sim.tick();
    if (player.inCombat || player.dead) pulled = true;
    for (const id of inst.mobIds) {
      const mob = sim.entities.get(id);
      if (mob && !mob.dead && (mob.aggroTargetId === player.id || mob.inCombat)) pulled = true;
    }
  }
  return pulled;
}

describe('dungeon death checkpoints', () => {
  it.each([false, true])(
    'returns to the cleared Marrow arena through the door (heroic=%s)',
    (heroic) => {
      const { sim, pid, inst, player } = setup('hollow_crypt', heroic);
      earn(sim, inst, 'sexton_marrow');
      reenter(sim, pid, inst.dungeonId);
      expectLocal(sim, pid, inst, -82, 116);
      expect(player.dead).toBe(false);
      expect(player.ghost).toBe(false);
      expect(player.corpsePos).toBeNull();
      expect(player.corpseInstanceId).toBeNull();
      expect(player.hp).toBe(Math.max(1, Math.round(player.maxHp * RES_HP_FRACTION)));
      expect(player.auras.some((a) => a.id === RESURRECTION_SICKNESS_ID)).toBe(false);
    },
  );

  it('keeps the entrance until a checkpoint is earned', () => {
    const { sim, pid, inst } = setup();
    reenter(sim, pid, inst.dungeonId);
    const entry = DUNGEONS[inst.dungeonId].entry;
    expectLocal(sim, pid, inst, entry.x, entry.z);
  });

  for (const heroic of [false, true]) {
    it.each(CASES)(`safe %s checkpoint after %s (heroic=${heroic})`, (dungeonId, bosses, x, z) => {
      const { sim, pid, inst, player } = setup(dungeonId, heroic);
      // Only the packs the route's gates wait on die, with the bosses. Every other
      // pack, patrol and boss of the dungeon is alive when the ghost arrives.
      earn(sim, inst, ...bosses);
      if (isLoft(dungeonId, bosses)) killPacks(sim, inst, ...LOFT_NEIGHBOURS);
      const trashAlive = inst.mobIds
        .map((id) => sim.entities.get(id))
        .filter((mob) => mob && !mob.dead && !MOBS[mob.templateId].boss);
      expect(trashAlive.length).toBeGreaterThan(0);
      reenter(sim, pid, dungeonId);
      expectLocal(sim, pid, inst, x, z);
      expect(isBlocked(sim.cfg.seed, player.pos.x, player.pos.z, PLAYER_BODY_RADIUS)).toBe(false);
      expect(player.pos.y).toBeGreaterThan(-10);
      // Safe means left alone: nothing in the living dungeon comes for the arrival.
      expect(tickAndWatch(sim, inst, player, 10)).toBe(false);
      expectLocal(sim, pid, inst, x, z);
    });
  }

  it('lists one row per pinned case, at the pinned point', () => {
    const rows = Object.values(DUNGEON_CHECKPOINTS).reduce((n, list) => n + list.length, 0);
    expect(rows).toBe(CASES.length);
    for (const [dungeonId, bosses, x, z] of CASES) {
      expect(rowOf(dungeonId, bosses).pos, `${dungeonId} ${bosses.join(',')}`).toEqual({ x, z });
    }
  });

  it('does not bypass a living predecessor when a later boss dies out of order', () => {
    const { sim, pid, inst } = setup();
    // Every gate reads open, so only the boss order can refuse the loft.
    setDungeonGatesDevOpen(inst, true);
    kill(sim, inst, 'cantor_ilvane');
    killPacks(sim, inst, ...LOFT_NEIGHBOURS);
    reenter(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, 0, -130);
  });

  it('requires both the Beastmaster and his Jaguar to finish their checkpoint', () => {
    const { sim, pid, inst } = setup('wildheart_basin');
    const row = rowOf('wildheart_basin', ['wildheart_beastmaster', 'fanglord_jaguar']);
    for (const gateId of row.gates)
      killPacks(sim, inst, ...(gateOf('wildheart_basin', gateId).packs ?? []));
    kill(sim, inst, 'wildheart_beastmaster');
    // The Jaguar lives, far from the pits: only the boss list can refuse them now,
    // not a living body standing on the point.
    const far = localOf(inst, 0, -150);
    moveHome(sim, rosterMob(sim, inst, 'fanglord_jaguar'), far.x, far.z);
    reenter(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, 0, -217);
    kill(sim, inst, 'fanglord_jaguar');
    reenter(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, -86, 40);
  });

  it('ordinary living entries still arrive at the entrance', () => {
    const { sim, pid, inst } = setup();
    earn(sim, inst, 'sexton_marrow');
    sim.leaveDungeon(pid);
    sim.enterDungeon(inst.dungeonId, pid);
    expectLocal(sim, pid, inst, 0, -130);
  });

  it('falls back during combat and recovers the checkpoint after the fight stops', () => {
    const { sim, pid, inst } = setup();
    earn(sim, inst, 'sexton_marrow');
    const enemy = livingMob(sim, inst);
    enemy.inCombat = true;
    reenter(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, 0, -130);
    enemy.inCombat = false;
    reenter(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, -82, 116);
  });

  it('falls back to an earlier safe checkpoint if a live enemy occupies the latest one', () => {
    const { sim, pid, inst } = setup();
    earn(sim, inst, 'sexton_marrow', 'rimeweb');
    const web = localOf(inst, 80, 112);
    standAt(sim, livingMob(sim, inst), web.x, web.z);
    reenter(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, -82, 116);
  });

  it('cannot borrow progress from another solo claim or a missing boss entity', () => {
    const { sim, pid, inst, player } = setup();
    earn(sim, inst, 'sexton_marrow');
    release(sim, pid);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual({ x: -82, z: 116 });
    const secondPid = sim.addPlayer('warrior', 'Other');
    sim.enterDungeon(inst.dungeonId, secondPid);
    const other = sim.instances.find(
      (i) => i.dungeonId === inst.dungeonId && i.partyKey === `solo:${secondPid}`,
    )!;
    expect(dungeonReentryPoint(sim.ctx, other, player)).toEqual(DUNGEONS[inst.dungeonId].entry);
    sim.ctx.dropEntity(rosterMob(sim, inst, 'sexton_marrow').id);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(DUNGEONS[inst.dungeonId].entry);
  });

  it('shares earned progress with party members who die in the same claim', () => {
    const { sim, pid } = setup();
    sim.leaveDungeon(pid);
    const secondPid = sim.addPlayer('warrior', 'PartyRunner');
    sim.partyInvite(secondPid, pid);
    sim.partyAccept(secondPid);
    sim.enterDungeon('hollow_crypt', pid);
    sim.enterDungeon('hollow_crypt', secondPid);
    const inst = sim.instances.find(
      (i) => i.dungeonId === 'hollow_crypt' && i.partyKey?.startsWith('party:'),
    )!;
    earn(sim, inst, 'sexton_marrow');
    reenter(sim, secondPid, inst.dungeonId);
    expectLocal(sim, secondPid, inst, -82, 116);
  });

  it('resetting and reclaiming a slot discards its recovery progress', () => {
    const { sim, pid, inst } = setup();
    earn(sim, inst, 'sexton_marrow');
    sim.leaveDungeon(pid);
    freeInstance(sim.ctx, inst);
    sim.enterDungeon('hollow_crypt', pid);
    reenter(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, 0, -130);
  });

  it('retains progress after the defeated boss corpse decays', () => {
    const { sim, pid, inst, player } = setup();
    earn(sim, inst, 'sexton_marrow');
    const boss = rosterMob(sim, inst, 'sexton_marrow');
    boss.corpseTimer = 0;
    release(sim, pid);
    sim.tick();
    expect(sim.entities.get(boss.id)?.dead).toBe(true);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual({ x: -82, z: 116 });
  });

  it('uses the previous safe arena while a lingering ground zone covers the latest checkpoint', () => {
    const { sim, pid, inst, player } = setup();
    earn(sim, inst, 'sexton_marrow', 'rimeweb');
    release(sim, pid);
    const origin = instanceOrigin(DUNGEONS[inst.dungeonId].index, inst.slot);
    const ctx = sim.ctx;
    ctx.groundAoEs.push({
      sourceId: inst.mobIds[0],
      pos: { x: origin.x + 80, y: -6, z: origin.z + 112 },
      radius: 5,
      remaining: 10,
      min: 1,
      max: 1,
      interval: 1,
      tickTimer: 1,
      school: 'shadow',
      ability: 'Test hazard',
      abilityId: 'test_hazard',
    });
    expect(dungeonReentryPoint(ctx, inst, player)).toEqual({ x: -82, z: 116 });
    ctx.groundAoEs[0].remaining = 0;
    expect(dungeonReentryPoint(ctx, inst, player)).toEqual({ x: 80, z: 112 });
    ctx.groundAoEs[0].remaining = 10;
    ctx.groundAoEs[0].pos.z = origin.z + 112 + 5 + PLAYER_BODY_RADIUS;
    expect(dungeonReentryPoint(ctx, inst, player)).toEqual({ x: -82, z: 116 });
    ctx.groundAoEs[0].pos.z += 0.01;
    expect(dungeonReentryPoint(ctx, inst, player)).toEqual({ x: 80, z: 112 });
  });

  it('does not apply a reclaimed slot checkpoint to a corpse from its previous claim', () => {
    const { sim, pid, inst, player } = setup();
    release(sim, pid);
    const oldClaimId = player.corpseInstanceId;
    freeInstance(sim.ctx, inst);
    const secondPid = sim.addPlayer('warrior', 'NewOwner');
    sim.enterDungeon('hollow_crypt', secondPid);
    earn(sim, inst, 'sexton_marrow');
    expect(inst.exitId).not.toBe(oldClaimId);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(DUNGEONS[inst.dungeonId].entry);
    // The new owner's own corpse does earn it, so only the claim id refused the old one.
    release(sim, secondPid);
    expect(dungeonReentryPoint(sim.ctx, inst, sim.entities.get(secondPid)!)).toEqual({
      x: -82,
      z: 116,
    });
  });

  it.each(['chase', 'evade'] as const)(
    'keeps the entrance while a living actor is in %s',
    (aiState) => {
      const { sim, pid, inst } = setup();
      earn(sim, inst, 'sexton_marrow');
      livingMob(sim, inst).aiState = aiState;
      reenter(sim, pid, inst.dungeonId);
      expectLocal(sim, pid, inst, 0, -130);
    },
  );

  it('counts an engaged encounter add appended after the static spawns', () => {
    const { sim, pid, inst } = setup();
    earn(sim, inst, 'sexton_marrow');
    const add = createMob(sim.ctx.nextId++, MOBS.crypt_shambler, 8, livingMob(sim, inst).pos);
    add.inCombat = true;
    sim.ctx.addEntity(add);
    inst.mobIds.push(add.id);
    reenter(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, 0, -130);
  });

  it.each([
    ['wildheart_basin', 'fanglord_jaguar'],
    ['sunken_bastion', 'gaoler_ossick'],
    ['drowned_temple', 'tideglass_colossus'],
    ['gravewyrm_sanctum', 'grand_necromancer_velkhar'],
  ])('cannot unlock %s by killing only %s', (dungeonId, successor) => {
    const { sim, pid, inst } = setup(dungeonId);
    // Every gate reads open and every living boss stands far from every point, so
    // only the missing predecessor can refuse the successor's row.
    setDungeonGatesDevOpen(inst, true);
    kill(sim, inst, successor);
    const row = DUNGEON_CHECKPOINTS[dungeonId].find((c) => c.bosses.includes(successor))!;
    const entry = DUNGEONS[dungeonId].entry;
    const far = localOf(inst, entry.x, entry.z + 40);
    const predecessors = row.bosses.filter((boss) => boss !== successor);
    expect(predecessors.length).toBeGreaterThan(0);
    for (const boss of predecessors) moveHome(sim, rosterMob(sim, inst, boss), far.x, far.z);
    release(sim, pid);
    const player = sim.entities.get(pid)!;
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(entry);
    // The predecessors were all that stood in the way.
    kill(sim, inst, ...predecessors);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(row.pos);
  });

  it('resolves identical recoveries on a replay without drawing rng', () => {
    const run = () => {
      const { sim, pid, inst, player } = setup();
      earn(sim, inst, 'sexton_marrow');
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      reenter(sim, pid, inst.dungeonId);
      expect(draws).toEqual([]);
      const nextDraw = sim.ctx.rng.next();
      // The observer was listening all along: it hears the very next draw.
      expect(draws).toEqual([nextDraw]);
      return { pos: player.pos, hp: player.hp, nextDraw };
    };
    const first = run();
    expect(first).toEqual(run());
    const origin = instanceOrigin(DUNGEONS.hollow_crypt.index, 0);
    expect(first.pos.x).toBe(origin.x - 82);
    expect(first.pos.z).toBe(origin.z + 116);
  });

  it.each(['sexton_marrow', 'rimeweb'])(
    'the loft still requires %s independently',
    (missingBoss) => {
      const { sim, pid, inst } = setup();
      // Every gate reads open and the loft stands empty, so only the living wing
      // boss can refuse it.
      setDungeonGatesDevOpen(inst, true);
      kill(sim, inst, ...LOFT_BOSSES.filter((boss) => boss !== missingBoss));
      killPacks(sim, inst, ...LOFT_NEIGHBOURS);
      reenter(sim, pid, inst.dungeonId);
      if (missingBoss === 'rimeweb') expectLocal(sim, pid, inst, -82, 116);
      else expectLocal(sim, pid, inst, 80, 112);
    },
  );

  it('a same-template summoned corpse cannot replace the living authored boss', () => {
    const { sim, pid, inst, player } = setup();
    setDungeonGatesDevOpen(inst, true);
    // The authored Sexton lives, far from his yard, so his body cannot be what
    // refuses the point: only his own spawn ordinal still reading alive can.
    const sexton = rosterMob(sim, inst, 'sexton_marrow');
    const far = localOf(inst, 0, -30);
    moveHome(sim, sexton, far.x, far.z);
    const summon = createMob(sim.ctx.nextId++, MOBS.sexton_marrow, 8, { ...sexton.pos });
    sim.ctx.addEntity(summon);
    inst.mobIds.push(summon.id);
    handleDeath(sim.ctx, summon, sim.entities.get(pid) ?? null);
    expect(summon.dead).toBe(true);
    release(sim, pid);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(DUNGEONS.hollow_crypt.entry);
    // The authored one dies and the same scene offers the yard.
    kill(sim, inst, 'sexton_marrow');
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual({ x: -82, z: 116 });
  });

  it('the loft still requires Cantor even when her living body is away from the recovery point', () => {
    const { sim, pid, inst, player } = setup();
    earn(sim, inst, 'sexton_marrow', 'rimeweb');
    setDungeonGatesDevOpen(inst, true);
    killPacks(sim, inst, 'q1', 'q2');
    // Cantor and her Choristers live, re-homed far from the loft.
    const far = localOf(inst, 0, -30);
    for (const mob of packMobs(sim, inst, ['ilvane'])) moveHome(sim, mob, far.x, far.z);
    release(sim, pid);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual({ x: 80, z: 112 });
    // Her death alone, Choristers still standing far off, offers the loft.
    kill(sim, inst, 'cantor_ilvane');
    expect(packMobs(sim, inst, ['ilvane']).length).toBe(2);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual({ x: 0, z: 162 });
  });

  it('falls back to the previous arena if the latest point becomes obstructed', () => {
    const { sim, pid, inst, player } = setup();
    earn(sim, inst, 'sexton_marrow', 'rimeweb');
    release(sim, pid);
    const origin = instanceOrigin(DUNGEONS[inst.dungeonId].index, inst.slot);
    const original = colliders.isBlocked;
    // A changing collider can obstruct an otherwise valid authored point.
    // Keep all other probes on the real collision path.
    const probe = vi
      .spyOn(colliders, 'isBlocked')
      .mockImplementation((seed, x, z, radius) =>
        x === origin.x + 80 && z === origin.z + 112 ? true : original(seed, x, z, radius),
      );
    try {
      expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual({ x: -82, z: 116 });
    } finally {
      probe.mockRestore();
    }
  });
});

describe('dungeon death checkpoints: gates', () => {
  const GATED = Object.entries(DUNGEON_CHECKPOINTS).flatMap(([dungeonId, rows]) =>
    rows.flatMap((row, index) =>
      row.gates
        .filter((gateId) => (gateOf(dungeonId, gateId).packs ?? []).length > 0)
        .map((gateId) => [dungeonId, index, gateId] as const),
    ),
  );

  it('lists a pack gate on the way to every checkpoint', () => {
    for (const [dungeonId, rows] of Object.entries(DUNGEON_CHECKPOINTS)) {
      rows.forEach((_, index) => {
        expect(
          GATED.some(([d, i]) => d === dungeonId && i === index),
          `${dungeonId} ${index}`,
        ).toBe(true);
      });
    }
  });

  it.each(GATED)(
    '%s checkpoint %i stays shut while the %s packs live',
    (dungeonId, index, gateId) => {
      const { sim, pid, inst, player } = setup(dungeonId);
      const row = DUNGEON_CHECKPOINTS[dungeonId][index];
      const gate = gateOf(dungeonId, gateId);
      // The gate's own packs live. Every other pack and boss on the way in is dead,
      // and so is every boss the checkpoint asks for.
      const spared = new Set(gate.packs ?? []);
      for (const otherId of row.gates) {
        const other = gateOf(dungeonId, otherId);
        killPacks(sim, inst, ...(other.packs ?? []).filter((p) => !spared.has(p)));
      }
      kill(sim, inst, ...row.bosses);
      if (isLoft(dungeonId, row.bosses)) killPacks(sim, inst, ...LOFT_NEIGHBOURS);
      expect(packMobs(sim, inst, [...spared]).length).toBeGreaterThan(0);
      expect(dungeonGateState(sim.ctx, inst, gate)).toBe('closed');
      release(sim, pid);
      const refused = dungeonReentryPoint(sim.ctx, inst, player);
      expect(refused).not.toEqual(row.pos);
      // It goes to the door or to an earlier row, never anywhere else.
      const earlier = DUNGEON_CHECKPOINTS[dungeonId].slice(0, index).map((c) => c.pos);
      expect([DUNGEONS[dungeonId].entry, ...earlier]).toContainEqual(refused);
      // The gate is what refuses it, not the packs that still live behind it:
      // read the gates open with those packs untouched and the point is offered.
      setDungeonGatesDevOpen(inst, true);
      expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(row.pos);
      setDungeonGatesDevOpen(inst, false);
      expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(refused);
      // And for real: its packs die, the gate opens, the point is offered.
      killPacks(sim, inst, ...spared);
      expect(dungeonGateState(sim.ctx, inst, gate)).toBe('open');
      expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(row.pos);
    },
  );

  it('a remote boss kill cannot open a sealed arena to a returning ghost', () => {
    const { sim, pid, inst, player } = setup();
    // The boss is dead and every pack of the dungeon is alive: the Bone Barrier
    // (packs w1 to w4) and the Undercroft Grille before it are both closed.
    kill(sim, inst, 'sexton_marrow');
    expect(dungeonGateState(sim.ctx, inst, gateOf('hollow_crypt', 'grille'))).toBe('closed');
    expect(dungeonGateState(sim.ctx, inst, gateOf('hollow_crypt', 'yard_barrier'))).toBe('closed');
    reenter(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, 0, -130);
    expect(player.dead).toBe(false);
  });

  it('reads the gates through the gate module, dev override included', () => {
    const { sim, pid, inst, player } = setup();
    kill(sim, inst, 'sexton_marrow');
    release(sim, pid);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(DUNGEONS.hollow_crypt.entry);
    setDungeonGatesDevOpen(inst, true);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual({ x: -82, z: 116 });
    setDungeonGatesDevOpen(inst, false);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(DUNGEONS.hollow_crypt.entry);
  });
});

describe('dungeon death checkpoints: arrival clearance', () => {
  it('clears the wander ring round every home and the aggro ceiling round every body', () => {
    expect(MAX_AGGRO_RADIUS).toBe(20);
    expect(MAX_WANDER_RADIUS).toBe(9);
    expect(RIFT_ENTRY_CLEAR_RADIUS).toBe(29);
    const { sim, pid, inst, player } = setup();
    earn(sim, inst, 'sexton_marrow');
    release(sim, pid);
    const at = localOf(inst, -82, 116);
    const yard = { x: -82, z: 116 };
    const door = DUNGEONS[inst.dungeonId].entry;
    // Unrostered on purpose: a hazard nobody added to the claim is still seen.
    const add = createMob(sim.ctx.nextId++, MOBS.crypt_shambler, 8, {
      x: at.x + 28.99,
      y: 8,
      z: at.z,
    });
    sim.ctx.addEntity(add);
    expect(inst.mobIds).not.toContain(add.id);
    const place = (home: number, body: number) => {
      add.spawnPos = { x: at.x + home, y: 8, z: at.z };
      add.pos = { x: at.x + body, y: 8, z: at.z };
      add.prevPos = { ...add.pos };
      sim.ctx.rebucket(add);
      return dungeonReentryPoint(sim.ctx, inst, player);
    };
    // Standing on its home: refused a hair inside the clearance, offered on it.
    expect(place(28.99, 28.99)).toEqual(door);
    expect(place(29, 29)).toEqual(yard);
    // A wanderer is judged by its home, not by where it is right now: at the far
    // edge of a ring that reaches well inside the ceiling it still refuses...
    expect(place(20, 29)).toEqual(door);
    expect(place(28.99, 37.9)).toEqual(door);
    // ...and at the near edge of a ring that stops on the ceiling it does not.
    expect(place(29, 20)).toEqual(yard);
    // A body inside the ceiling right now refuses, however far its home.
    expect(place(60, 19.99)).toEqual(door);
    expect(place(60, 20)).toEqual(yard);
  });

  it('measures a patrol by its loop, with room for the corner it cuts', () => {
    expect(PATROL_REJOIN_DISTANCE).toBe(4);
    const reach = MAX_AGGRO_RADIUS + PATROL_REJOIN_DISTANCE;
    const { sim, pid, inst, player } = setup();
    earn(sim, inst, 'sexton_marrow');
    release(sim, pid);
    const at = localOf(inst, -82, 116);
    const yard = { x: -82, z: 116 };
    const door = DUNGEONS[inst.dungeonId].entry;
    // The patroller itself stands far off: only its loop comes near the yard.
    const walker = createMob(sim.ctx.nextId++, MOBS.crypt_shambler, 8, {
      x: at.x + 70,
      y: 8,
      z: at.z,
    });
    sim.ctx.addEntity(walker);
    inst.mobIds.push(walker.id);
    const loopAt = (d: number) => ({
      points: [
        { x: at.x + d, z: at.z - 40 },
        { x: at.x + d, z: at.z + 40 },
        { x: at.x + 70, z: at.z + 40 },
        { x: at.x + 70, z: at.z - 40 },
      ],
      offset: 0,
      pace: 0.4,
    });
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(yard);
    walker.dungeonPatrol = loopAt(reach - 0.01);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(door);
    walker.dungeonPatrol = loopAt(reach);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(yard);
    // A patrol has no wander ring: its spawn point inside the home clearance
    // does not refuse a point its loop stays clear of.
    walker.spawnPos = { x: at.x + reach, y: 8, z: at.z };
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(yard);
    // The same mob without a loop, standing in the ring round that spawn point,
    // is a wanderer homed too close.
    walker.dungeonPatrol = undefined;
    walker.pos = { x: at.x + reach + MAX_WANDER_RADIUS, y: 8, z: at.z };
    sim.ctx.rebucket(walker);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(door);
    // A loop that only a dead patroller walked refuses nothing.
    walker.dungeonPatrol = loopAt(reach - 0.01);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(door);
    handleDeath(sim.ctx, walker, null);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(yard);
  });

  it('a wanderer on the edge of the clearance never reaches an arrival', () => {
    const { sim, pid, inst, player } = setup();
    earn(sim, inst, 'sexton_marrow');
    const at = localOf(inst, -82, 116);
    const home = sim.ctx.groundPos(at.x, at.z - RIFT_ENTRY_CLEAR_RADIUS);
    const wanderer = createMob(sim.ctx.nextId++, MOBS.crypt_shambler, 8, home);
    sim.ctx.addEntity(wanderer);
    inst.mobIds.push(wanderer.id);
    // The worst arrival: low enough that the wanderer sees it from the full ceiling.
    sim.setPlayerLevel(1, pid);
    expect(
      MOBS.crypt_shambler.aggroRadius + (wanderer.level - player.level) * 1.5,
    ).toBeGreaterThanOrEqual(MAX_AGGRO_RADIUS);
    reenter(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, -82, 116);
    let nearest = Infinity;
    let strayed = 0;
    for (let i = 0; i < 20 * 60; i++) {
      sim.tick();
      nearest = Math.min(nearest, gap(wanderer.pos, player.pos));
      strayed = Math.max(strayed, gap(wanderer.pos, home));
      expect(player.inCombat).toBe(false);
      expect(wanderer.inCombat).toBe(false);
    }
    // It did wander, inside the ring the clearance allows for, so it never came
    // inside the ceiling.
    expect(strayed).toBeGreaterThan(1);
    expect(strayed).toBeLessThanOrEqual(MAX_WANDER_RADIUS + 0.5);
    expect(nearest).toBeGreaterThanOrEqual(MAX_AGGRO_RADIUS);
  });

  // The tightest real case: the aisle patrol q2 turns 18 yd short of the loft.
  // Run on a host that ticks every idle mob and on one that culls them out of
  // sight of every player (the server and the offline client), where the patrol
  // stands frozen at the far end of the nave while the spirit runs back.
  it.each([0, PLAYER_INTEREST_DROP_RADIUS])(
    'refuses a point a living patrol walks past, wherever it is now (idle cull %i)',
    (idleMobTickRadius) => {
      const { sim, pid, inst, player } = setup('hollow_crypt', false, idleMobTickRadius);
      earn(sim, inst, ...LOFT_BOSSES);
      killPacks(sim, inst, 'q1', 'ilvane');
      const patrol = packMobs(sim, inst, ['q2']);
      expect(patrol.length).toBeGreaterThan(0);
      const loft = localOf(inst, 0, 162);
      const before = patrol.map((mob) => ({ ...mob.pos }));
      release(sim, pid);
      for (let i = 0; i < 20 * 40; i++) sim.tick();
      const walked = patrol.some((mob, i) => gap(mob.pos, before[i]) > 1);
      expect(walked).toBe(idleMobTickRadius === 0);
      if (idleMobTickRadius > 0) {
        // Frozen out of sight: no mob stands anywhere near the loft right now.
        for (const mob of patrol) {
          expect(gap(mob.pos, loft)).toBeGreaterThan(RIFT_ENTRY_CLEAR_RADIUS);
        }
      }
      crossDoor(sim, pid, inst.dungeonId);
      expectLocal(sim, pid, inst, 80, 112);
      let nearestToLoft = Infinity;
      for (let i = 0; i < 20 * 40; i++) {
        sim.tick();
        expect(player.inCombat).toBe(false);
        for (const mob of patrol) {
          expect(mob.inCombat).toBe(false);
          nearestToLoft = Math.min(nearestToLoft, gap(mob.pos, loft));
        }
      }
      // Meanwhile the patrol came round inside the aggro ceiling of the loft...
      expect(nearestToLoft).toBeLessThan(MAX_AGGRO_RADIUS);
      // ...where it does see a low arrival: the refusal is not caution for its own sake.
      const visitor = sim.addPlayer('warrior', 'Visitor');
      const body = sim.entities.get(visitor)!;
      expect(body.level).toBe(1);
      standAt(sim, body, loft.x, loft.z);
      let seen = false;
      for (let i = 0; i < 20 * 60 && !seen; i++) {
        sim.tick();
        seen = patrol.some((mob) => mob.aggroTargetId === visitor);
      }
      expect(seen).toBe(true);
      killPacks(sim, inst, 'q2');
      reenter(sim, pid, inst.dungeonId);
      expectLocal(sim, pid, inst, 0, 162);
    },
  );

  it('lands beside a living patrol whose loop stays outside the aggro ceiling', () => {
    const { sim, pid, inst, player } = setup('gravewyrm_sanctum');
    earn(sim, inst, 'korgath_the_bound', 'grand_necromancer_velkhar');
    // The shore patrol pd lives: its loop passes 28 yd from the Vault's point.
    const patrol = packMobs(sim, inst, ['pd']);
    expect(patrol.length).toBeGreaterThan(0);
    const vault = localOf(inst, 0, 107);
    // The point is offered at every phase of the lap, the nearest included: the
    // answer does not turn on where the patrol happens to be.
    release(sim, pid);
    let nearest = Infinity;
    for (let i = 0; i < 20 * 120; i++) {
      sim.tick();
      expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual({ x: 0, z: 107 });
      for (const mob of patrol) nearest = Math.min(nearest, gap(mob.pos, vault));
    }
    expect(nearest).toBeLessThan(RIFT_ENTRY_CLEAR_RADIUS);
    expect(nearest).toBeGreaterThanOrEqual(MAX_AGGRO_RADIUS + PATROL_REJOIN_DISTANCE);
    // And the arrival is left alone for another lap and more.
    crossDoor(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, 0, 107);
    for (let i = 0; i < 20 * 120; i++) {
      sim.tick();
      expect(player.inCombat).toBe(false);
      for (const mob of patrol) expect(mob.inCombat).toBe(false);
    }
    expectLocal(sim, pid, inst, 0, 107);
  });

  it('a Chorister that outlives Cantor still guards the loft', () => {
    const { sim, pid, inst, player } = setup();
    earn(sim, inst, ...LOFT_BOSSES);
    killPacks(sim, inst, 'q1', 'q2');
    // Cantor's death leaves her two Choristers standing: ordinary hostile elites
    // of her pack, idle at the rail 10.6 yd from the loft's point.
    const choristers = packMobs(sim, inst, ['ilvane']);
    expect(choristers.map((mob) => mob.templateId)).toEqual([
      'hollow_chorister',
      'hollow_chorister',
    ]);
    const loft = localOf(inst, 0, 162);
    for (const mob of choristers) {
      expect(mob.hostile).toBe(true);
      expect(mob.aiState).toBe('idle');
      expect(gap(mob.pos, loft)).toBeLessThan(11);
    }
    release(sim, pid);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual({ x: 80, z: 112 });
    // They are a real threat to the point, not a stale body: a living player of
    // their own level who stands on it is pulled at once.
    const visitor = sim.addPlayer('warrior', 'Visitor');
    sim.setPlayerLevel(8, visitor);
    const body = sim.entities.get(visitor)!;
    standAt(sim, body, loft.x, loft.z);
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    expect(choristers.some((mob) => mob.aggroTargetId === visitor)).toBe(true);
  });

  it('counts only the mobs that can pull the arriving player', () => {
    const { sim, pid, inst, player } = setup();
    earn(sim, inst, 'sexton_marrow');
    release(sim, pid);
    const at = localOf(inst, -82, 116);
    const yard = { x: -82, z: 116 };
    const door = DUNGEONS[inst.dungeonId].entry;
    const prop = createMob(
      sim.ctx.nextId++,
      MOBS.crypt_shambler,
      8,
      sim.ctx.groundPos(at.x + 4, at.z),
    );
    sim.ctx.addEntity(prop);
    expect(MOBS.crypt_shambler.elite).toBe(true);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(door);
    // An inert, non-hostile body (a candle, a cage, a scripted entrance) pulls nobody.
    prop.hostile = false;
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(yard);
    // A flying patrol on the wing is not hostile either, and it still stoops on
    // whoever it sees.
    prop.dungeonPatrol = { points: [{ x: at.x + 4, z: at.z }], offset: 0, pace: 0.4, flightY: 40 };
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(door);
    prop.dungeonPatrol = undefined;
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(yard);
    // Somebody's pet is nobody's threat, hostile flag or not.
    prop.hostile = true;
    prop.ownerId = pid;
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(yard);
    prop.ownerId = null;
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(door);
    prop.hostile = false;
    // Ordinary (non-elite) trash counts while the arrival is near its level...
    expect(MOBS.rime_egg_sac.elite).toBeFalsy();
    const plain = createMob(
      sim.ctx.nextId++,
      MOBS.rime_egg_sac,
      8,
      sim.ctx.groundPos(at.x - 4, at.z),
    );
    sim.ctx.addEntity(plain);
    expect(player.level).toBeLessThan(10);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(door);
    // ...and never aggroes on sight once it is trivial to them.
    sim.setPlayerLevel(20, pid);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(yard);
    // An elite does, at any level.
    prop.hostile = true;
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(door);
    // A dead one does not.
    handleDeath(sim.ctx, prop, null);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(yard);
  });
});

describe('dungeon death checkpoints: the table', () => {
  it('names real gates, bosses of the dungeon, and unobstructed points', () => {
    for (const [dungeonId, rows] of Object.entries(DUNGEON_CHECKPOINTS)) {
      const dungeon = DUNGEONS[dungeonId];
      const origin = instanceOrigin(dungeon.index, 4);
      setOpenDungeonGates(
        origin.x,
        origin.z,
        (dungeon.gates ?? []).map((g) => g.id),
      );
      for (const row of rows) {
        expect(row.gates.length, `${dungeonId} gates`).toBeGreaterThan(0);
        expect(new Set(row.gates).size).toBe(row.gates.length);
        for (const gateId of row.gates) {
          const gate = gateOf(dungeonId, gateId);
          // A gate that waits on a boss waits only on bosses the row already asks
          // for, so the row's own pack gates are what prove the way in.
          for (const boss of gate.bosses ?? []) {
            expect(row.bosses, `${dungeonId} ${gateId}`).toContain(boss);
          }
        }
        // The route ends in the pack gate of the arena's own section.
        const last = gateOf(dungeonId, row.gates[row.gates.length - 1]);
        expect((last.packs ?? []).length, `${dungeonId} ${last.id}`).toBeGreaterThan(0);
        for (const boss of row.bosses) {
          expect(
            dungeon.spawns.some((s) => s.mobId === boss),
            `${dungeonId} ${boss}`,
          ).toBe(true);
        }
        expect(
          isBlocked(99, origin.x + row.pos.x, origin.z + row.pos.z, PLAYER_BODY_RADIUS),
          `${dungeonId} ${row.pos.x},${row.pos.z}`,
        ).toBe(false);
      }
      setOpenDungeonGates(origin.x, origin.z, []);
    }
  });

  it('lists either twin where two gates open on one condition', () => {
    const condition = (dungeonId: string, gateId: string) => {
      const gate = gateOf(dungeonId, gateId);
      return { packs: gate.packs ?? [], bosses: gate.bosses ?? [], seal: gate.sealWhileEngaged };
    };
    expect(condition('gravewyrm_sanctum', 'west_chain_stair')).toEqual(
      condition('gravewyrm_sanctum', 'east_chain_stair'),
    );
    const west = condition('drowned_temple', 'court_stair_west');
    expect(west).toEqual(condition('drowned_temple', 'court_stair_east'));
  });

  it('stands the Drowning Yard point clear of the winch that fills the yard centre', () => {
    const dungeon = DUNGEONS.sunken_bastion;
    const origin = instanceOrigin(dungeon.index, 4);
    const yard = SUNKEN_BASTION_ANCHORS.drowningYard;
    expect(isBlocked(99, origin.x + yard.x, origin.z + yard.z, PLAYER_BODY_RADIUS)).toBe(true);
    const row = rowOf('sunken_bastion', ['knight_commander_olen', 'gaoler_ossick']);
    expect(row.pos.x).toBe(yard.x);
    expect(row.pos.z).toBeLessThan(yard.z);
    expect(isBlocked(99, origin.x + row.pos.x, origin.z + row.pos.z, PLAYER_BODY_RADIUS)).toBe(
      false,
    );
  });

  // The walk is a flood fill over a one-yard grid that asks the real collision
  // seam (the same one the per-dungeon route suites walk), with exactly the listed
  // gates open: the point must be reachable from the door, and no listed gate may
  // be left out without cutting it off.
  describe.each(Object.keys(DUNGEON_CHECKPOINTS))('%s routes', (dungeonId) => {
    const dungeon = DUNGEONS[dungeonId];
    const origin = instanceOrigin(dungeon.index, 4);
    const { minX, maxX, minZ, maxZ } = FIELDS[dungeonId as keyof typeof FIELDS].bounds;
    const width = maxX - minX + 1;
    const cell = (x: number, z: number) => (Math.round(z) - minZ) * width + (Math.round(x) - minX);
    const reaches = (open: readonly string[], x: number, z: number): boolean => {
      setOpenDungeonGates(origin.x, origin.z, open);
      const seen = new Uint8Array(width * (maxZ - minZ + 1));
      const queue = [Math.round(dungeon.entry.x), Math.round(dungeon.entry.z)];
      seen[cell(queue[0], queue[1])] = 1;
      for (let q = 0; q < queue.length; q += 2) {
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = queue[q] + dx;
          const nz = queue[q + 1] + dz;
          if (nx < minX || nx > maxX || nz < minZ || nz > maxZ) continue;
          const i = cell(nx, nz);
          if (seen[i] || isBlocked(7, origin.x + nx, origin.z + nz, 0.5)) continue;
          seen[i] = 1;
          queue.push(nx, nz);
        }
      }
      setOpenDungeonGates(origin.x, origin.z, []);
      return seen[cell(x, z)] === 1;
    };

    it.each(DUNGEON_CHECKPOINTS[dungeonId].map((row, index) => [index, row] as const))(
      'checkpoint %i is behind exactly its listed gates',
      (_, row) => {
        expect(reaches([], row.pos.x, row.pos.z)).toBe(false);
        expect(reaches(row.gates, row.pos.x, row.pos.z)).toBe(true);
        for (const gateId of row.gates) {
          const rest = row.gates.filter((id) => id !== gateId);
          expect(reaches(rest, row.pos.x, row.pos.z), `without ${gateId}`).toBe(false);
        }
      },
      120_000,
    );
  });
});
