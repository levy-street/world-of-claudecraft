import { describe, expect, it, vi } from 'vitest';
import * as colliders from '../src/sim/colliders';
import { isBlocked } from '../src/sim/colliders';
import { handleDeath } from '../src/sim/combat/damage';
import { DUNGEON_CHECKPOINTS } from '../src/sim/content/dungeon_checkpoints';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { dungeonReentryPoint } from '../src/sim/instances/dungeon_checkpoints';
import { freeInstance, updateDoorTriggers } from '../src/sim/instances/dungeons';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { type InstanceSlot, Sim } from '../src/sim/sim';
import { RES_HP_FRACTION, RESURRECTION_SICKNESS_ID } from '../src/sim/spirit';

const CASES = [
  ['hollow_crypt', ['sexton_marrow'], -82, 112],
  ['hollow_crypt', ['rimeweb'], 80, 112],
  ['hollow_crypt', ['sexton_marrow', 'rimeweb', 'cantor_ilvane'], 0, 162],
  ['drowned_temple', ['choirmother_selthe'], 0, 0],
  ['drowned_temple', ['choirmother_selthe', 'tideglass_colossus'], 86, 208],
  ['sunken_bastion', ['knight_commander_olen'], 57, 126],
  ['sunken_bastion', ['knight_commander_olen', 'gaoler_ossick'], -2, 12],
  ['gravewyrm_sanctum', ['korgath_the_bound'], 0, -22],
  ['gravewyrm_sanctum', ['korgath_the_bound', 'grand_necromancer_velkhar'], 0, 107],
  ['wildheart_basin', ['wildheart_beastmaster', 'fanglord_jaguar'], -86, 40],
  ['wildheart_basin', ['the_gorgebloom'], 84, 42],
] as const;

function setup(dungeonId = 'hollow_crypt', heroic = false) {
  const sim = new Sim({
    seed: 99,
    playerClass: 'warrior',
    noPlayer: true,
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

function kill(sim: Sim, inst: InstanceSlot, ...bosses: string[]) {
  for (const bossId of bosses) {
    const boss = inst.mobIds
      .map((id) => sim.entities.get(id))
      .find((e) => e?.templateId === bossId);
    if (!boss) throw new Error(`Missing ${bossId}`);
    // Exercise the authoritative death path, including loot and encounter cleanup.
    handleDeath(sim.ctx, boss, sim.entities.get([...inst.enteredBy][0]) ?? null);
  }
}

function reenter(sim: Sim, pid: number, dungeonId: string) {
  const player = sim.entities.get(pid)!;
  player.dead = true;
  sim.releaseSpirit(pid);
  expect(player.ghost).toBe(true);
  const door = [...sim.entities.values()].find(
    (e) => e.templateId === 'dungeon_door' && e.dungeonId === dungeonId,
  )!;
  player.pos = { ...door.pos };
  player.prevPos = { ...player.pos };
  sim.ctx.rebucket(player);
  updateDoorTriggers(sim.ctx, player);
}

function expectLocal(sim: Sim, pid: number, inst: InstanceSlot, x: number, z: number) {
  const player = sim.entities.get(pid)!;
  const origin = instanceOrigin(DUNGEONS[inst.dungeonId].index, inst.slot);
  expect(player.pos.x).toBe(origin.x + x);
  expect(player.pos.z).toBe(origin.z + z);
  expect(player.prevPos).toEqual(player.pos);
}

describe('dungeon death checkpoints', () => {
  it.each([false, true])(
    'returns to the cleared Marrow arena through the door (heroic=%s)',
    (heroic) => {
      const { sim, pid, inst, player } = setup('hollow_crypt', heroic);
      kill(sim, inst, 'sexton_marrow');
      reenter(sim, pid, inst.dungeonId);
      expectLocal(sim, pid, inst, -82, 112);
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
      // The route to these arenas is gated by the trash. Clear it while
      // keeping every unearned main boss alive, including the final boss.
      const checkpointBosses = new Set(
        DUNGEON_CHECKPOINTS[dungeonId].flatMap((c) => [...c.bosses]),
      );
      for (const id of inst.mobIds) {
        const mob = sim.entities.get(id)!;
        if (!checkpointBosses.has(mob.templateId) && !MOBS[mob.templateId].boss) {
          handleDeath(sim.ctx, mob, player);
        }
      }
      kill(sim, inst, ...bosses);
      reenter(sim, pid, dungeonId);
      expectLocal(sim, pid, inst, x, z);
      expect(isBlocked(sim.cfg.seed, player.pos.x, player.pos.z, PLAYER_BODY_RADIUS)).toBe(false);
      expect(player.pos.y).toBeGreaterThan(-10);
    });
  }

  it('does not bypass a living predecessor when a later boss dies out of order', () => {
    const { sim, pid, inst } = setup();
    kill(sim, inst, 'cantor_ilvane');
    reenter(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, 0, -130);
  });

  it('requires both the Beastmaster and his Jaguar to finish their checkpoint', () => {
    const { sim, pid, inst } = setup('wildheart_basin');
    kill(sim, inst, 'wildheart_beastmaster');
    reenter(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, 0, -217);
    kill(sim, inst, 'fanglord_jaguar');
    reenter(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, -86, 40);
  });

  it('ordinary living entries still arrive at the entrance', () => {
    const { sim, pid, inst } = setup();
    kill(sim, inst, 'sexton_marrow');
    sim.leaveDungeon(pid);
    sim.enterDungeon(inst.dungeonId, pid);
    expectLocal(sim, pid, inst, 0, -130);
  });

  it('falls back during combat and recovers the checkpoint after the fight stops', () => {
    const { sim, pid, inst } = setup();
    kill(sim, inst, 'sexton_marrow');
    const enemy = sim.entities.get(inst.mobIds[0])!;
    enemy.inCombat = true;
    reenter(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, 0, -130);
    enemy.inCombat = false;
    reenter(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, -82, 112);
  });

  it('falls back to an earlier safe checkpoint if a live enemy occupies the latest one', () => {
    const { sim, pid, inst } = setup();
    kill(sim, inst, 'sexton_marrow', 'rimeweb');
    const enemy = sim.entities.get(inst.mobIds[0])!;
    const origin = instanceOrigin(DUNGEONS[inst.dungeonId].index, inst.slot);
    enemy.pos = { x: origin.x + 80, y: -6, z: origin.z + 112 };
    reenter(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, -82, 112);
  });

  it('cannot borrow progress from another solo claim or a missing boss entity', () => {
    const { sim, pid, inst, player } = setup();
    kill(sim, inst, 'sexton_marrow');
    player.dead = true;
    sim.releaseSpirit(pid);
    const secondPid = sim.addPlayer('warrior', 'Other');
    sim.enterDungeon(inst.dungeonId, secondPid);
    const other = sim.instances.find(
      (i) => i.dungeonId === inst.dungeonId && i.partyKey === `solo:${secondPid}`,
    )!;
    expect(dungeonReentryPoint(sim.ctx, other, player)).toEqual(DUNGEONS[inst.dungeonId].entry);
    const bossId = inst.mobIds.find((id) => sim.entities.get(id)?.templateId === 'sexton_marrow')!;
    sim.ctx.dropEntity(bossId);
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
    kill(sim, inst, 'sexton_marrow');
    reenter(sim, secondPid, inst.dungeonId);
    expectLocal(sim, secondPid, inst, -82, 112);
  });

  it('resetting and reclaiming a slot discards its recovery progress', () => {
    const { sim, pid, inst } = setup();
    kill(sim, inst, 'sexton_marrow');
    sim.leaveDungeon(pid);
    freeInstance(sim.ctx, inst);
    sim.enterDungeon('hollow_crypt', pid);
    reenter(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, 0, -130);
  });

  it('retains progress after the defeated boss corpse decays', () => {
    const { sim, pid, inst, player } = setup();
    kill(sim, inst, 'sexton_marrow');
    const boss = inst.mobIds
      .map((id) => sim.entities.get(id))
      .find((e) => e?.templateId === 'sexton_marrow')!;
    boss.corpseTimer = 0;
    player.dead = true;
    sim.releaseSpirit(pid);
    sim.tick();
    expect(sim.entities.get(boss.id)?.dead).toBe(true);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual({ x: -82, z: 112 });
  });

  it('uses the previous safe arena while a lingering ground zone covers the latest checkpoint', () => {
    const { sim, pid, inst, player } = setup();
    kill(sim, inst, 'sexton_marrow', 'rimeweb');
    player.dead = true;
    sim.releaseSpirit(pid);
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
    expect(dungeonReentryPoint(ctx, inst, player)).toEqual({ x: -82, z: 112 });
    ctx.groundAoEs[0].remaining = 0;
    expect(dungeonReentryPoint(ctx, inst, player)).toEqual({ x: 80, z: 112 });
    ctx.groundAoEs[0].remaining = 10;
    ctx.groundAoEs[0].pos.z = origin.z + 112 + 5 + PLAYER_BODY_RADIUS;
    expect(dungeonReentryPoint(ctx, inst, player)).toEqual({ x: -82, z: 112 });
    ctx.groundAoEs[0].pos.z += 0.01;
    expect(dungeonReentryPoint(ctx, inst, player)).toEqual({ x: 80, z: 112 });
  });

  it('does not apply a reclaimed slot checkpoint to a corpse from its previous claim', () => {
    const { sim, pid, inst, player } = setup();
    player.dead = true;
    sim.releaseSpirit(pid);
    const oldClaimId = player.corpseInstanceId;
    freeInstance(sim.ctx, inst);
    const secondPid = sim.addPlayer('warrior', 'NewOwner');
    sim.enterDungeon('hollow_crypt', secondPid);
    kill(sim, inst, 'sexton_marrow');
    expect(inst.exitId).not.toBe(oldClaimId);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(DUNGEONS[inst.dungeonId].entry);
  });

  it.each(['chase', 'evade'] as const)(
    'keeps the entrance while a living actor is in %s',
    (aiState) => {
      const { sim, pid, inst } = setup();
      kill(sim, inst, 'sexton_marrow');
      sim.entities.get(inst.mobIds[0])!.aiState = aiState;
      reenter(sim, pid, inst.dungeonId);
      expectLocal(sim, pid, inst, 0, -130);
    },
  );

  it('counts an engaged encounter add appended after the static spawns', () => {
    const { sim, pid, inst } = setup();
    kill(sim, inst, 'sexton_marrow');
    const add = createMob(
      sim.ctx.nextId++,
      MOBS.crypt_shambler,
      8,
      sim.entities.get(inst.mobIds[0])!.pos,
    );
    add.inCombat = true;
    sim.ctx.addEntity(add);
    inst.mobIds.push(add.id);
    reenter(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, 0, -130);
  });

  it('checks unrostered enemies and the actual maximum aggro boundary', () => {
    const { sim, pid, inst, player } = setup();
    kill(sim, inst, 'sexton_marrow');
    player.dead = true;
    sim.releaseSpirit(pid);
    const origin = instanceOrigin(DUNGEONS[inst.dungeonId].index, inst.slot);
    const add = createMob(sim.ctx.nextId++, MOBS.crypt_shambler, 8, {
      x: origin.x - 82 + 19.99,
      y: 8,
      z: origin.z + 112,
    });
    sim.ctx.addEntity(add);
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual(DUNGEONS[inst.dungeonId].entry);
    add.pos.x = origin.x - 82 + 20;
    expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual({ x: -82, z: 112 });
  });

  it.each([
    ['wildheart_basin', 'fanglord_jaguar'],
    ['sunken_bastion', 'gaoler_ossick'],
    ['drowned_temple', 'tideglass_colossus'],
    ['gravewyrm_sanctum', 'grand_necromancer_velkhar'],
  ])('cannot unlock %s by killing only %s', (dungeonId, successor) => {
    const { sim, pid, inst } = setup(dungeonId);
    kill(sim, inst, successor);
    reenter(sim, pid, dungeonId);
    const entry = DUNGEONS[dungeonId].entry;
    expectLocal(sim, pid, inst, entry.x, entry.z);
  });

  it('resolves identical recoveries on a replay without drawing rng', () => {
    const run = () => {
      const { sim, pid, inst, player } = setup();
      kill(sim, inst, 'sexton_marrow');
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      reenter(sim, pid, inst.dungeonId);
      expect(draws).toEqual([]);
      return { pos: player.pos, hp: player.hp, nextDraw: sim.ctx.rng.next() };
    };
    expect(run()).toEqual(run());
  });

  it.each(['sexton_marrow', 'rimeweb'])(
    'the loft still requires %s independently',
    (missingBoss) => {
      const { sim, pid, inst } = setup();
      const defeated = ['sexton_marrow', 'rimeweb', 'cantor_ilvane'].filter(
        (boss) => boss !== missingBoss,
      );
      kill(sim, inst, ...defeated);
      reenter(sim, pid, inst.dungeonId);
      expectLocal(sim, pid, inst, missingBoss === 'rimeweb' ? -82 : 80, 112);
    },
  );

  it('a same-template summoned corpse cannot replace the living authored boss', () => {
    const { sim, pid, inst } = setup();
    const summon = createMob(
      sim.ctx.nextId++,
      MOBS.sexton_marrow,
      8,
      sim.entities.get(inst.mobIds[0])!.pos,
    );
    sim.ctx.addEntity(summon);
    inst.mobIds.push(summon.id);
    handleDeath(sim.ctx, summon, sim.entities.get(pid) ?? null);
    reenter(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, 0, -130);
  });

  it('the loft still requires Cantor even when his living body is away from the recovery point', () => {
    const { sim, pid, inst } = setup();
    kill(sim, inst, 'sexton_marrow', 'rimeweb');
    const cantor = inst.mobIds
      .map((id) => sim.entities.get(id))
      .find((e) => e?.templateId === 'cantor_ilvane')!;
    cantor.pos = { ...sim.entities.get(inst.mobIds[0])!.pos };
    reenter(sim, pid, inst.dungeonId);
    expectLocal(sim, pid, inst, 80, 112);
  });

  it('falls back to the previous arena if the latest point becomes obstructed', () => {
    const { sim, pid, inst, player } = setup();
    kill(sim, inst, 'sexton_marrow', 'rimeweb');
    player.dead = true;
    sim.releaseSpirit(pid);
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
      expect(dungeonReentryPoint(sim.ctx, inst, player)).toEqual({ x: -82, z: 112 });
    } finally {
      probe.mockRestore();
    }
  });
});
