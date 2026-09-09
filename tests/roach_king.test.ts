import { describe, expect, it } from 'vitest';
import { updateAuras } from '../src/sim/combat/auras';
import {
  GARBAGE_BEETLE_ID,
  ROACH_CROWN_AURA,
  ROACH_KING_ID,
} from '../src/sim/content/rift/roach_king';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { resetEvadingMob } from '../src/sim/mob/locomotion';
import { aurasSurvivingDeath } from '../src/sim/resurrection';
import { riftRankTemplate, riftRankTuningFor } from '../src/sim/rift/ranks';
import { generateRiftFloor, riftFloorCount } from '../src/sim/rift/rift_gen';
import { createRoachKingState, updateRoachKing } from '../src/sim/rift/roach_king';
import { handleRoachKingDevCommand } from '../src/sim/rift/roach_king_dev';
import { tickRiftBossDeathZones } from '../src/sim/rift/runs';
import { applyRiftUpgrade, validateRiftUpgrade } from '../src/sim/rift/upgrade';
import { buildHeuristicRiftUpgrade, buildRiftDungeonDraft } from '../src/sim/rift/upgrader_draft';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { addThreat } from '../src/sim/threat';
import { DT, type SimEvent } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function encounter(baseLevel = 20, seed = 42, playerClass: 'warrior' | 'mage' = 'warrior') {
  const sim = new Sim({
    seed,
    playerClass,
    autoEquip: true,
    devCommands: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.enterRift(seed, baseLevel, sim.playerId);
  const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null)!;
  const ctx = (sim as unknown as { ctx: SimContext }).ctx;
  for (const id of inst.mobIds) ctx.dropEntity(id);
  inst.mobIds = [];
  const boss = createMob(
    ctx.nextId++,
    riftRankTemplate(MOBS[ROACH_KING_ID], riftRankTuningFor(baseLevel), 'boss'),
    baseLevel >= 28 ? 23 : 22,
    { ...sim.player.pos },
  );
  boss.mechanicDamageMult = riftRankTuningFor(baseLevel).bossDamageMultiplier;
  boss.riftMechanicSpacing = 3;
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.playerId;
  boss.roachKing = createRoachKingState();
  addThreat(boss, sim.playerId, 1000);
  ctx.addEntity(boss);
  inst.mobIds.push(boss.id);
  inst.bossId = boss.id;
  sim.player.maxHp = 10000;
  sim.player.hp = 10000;
  const events: SimEvent[] = [];
  ctx.emit = (event) => events.push(event);
  const step = (seconds: number) => {
    for (let tick = 0; tick < Math.ceil(seconds / DT); tick++) {
      updateRoachKing(ctx, boss);
    }
  };
  return { sim, inst, ctx, boss, events, step };
}

describe('Roach King rift encounter', () => {
  it('every procedural and authored rift boss uses Asmon at every rank', () => {
    for (const level of [20, 22, 25, 28]) {
      for (let seed = 1; seed <= 100; seed++) {
        const count = riftFloorCount(seed, level);
        for (let floor = 0; floor < count; floor++) {
          const plan = generateRiftFloor(seed, level, floor);
          for (const spawn of plan.spawns.filter((spawn) => spawn.boss || spawn.miniboss)) {
            expect(spawn.templateId).toBe(ROACH_KING_ID);
          }
        }
      }
    }
  });

  it('an upgrade artifact cannot restore an old guardian identity or display name', () => {
    const seed = 42;
    const draft = buildRiftDungeonDraft(seed, 25);
    const upgrade = buildHeuristicRiftUpgrade(draft)!;
    upgrade.boss.templateId = 'rift_boss_frost';
    upgrade.boss.name = 'Obsolete Guardian';
    const floor = generateRiftFloor(seed, 25, draft.floorCount - 1);
    const boss = applyRiftUpgrade(floor, upgrade).spawns.find((spawn) => spawn.boss)!;
    expect(boss.templateId).toBe(ROACH_KING_ID);
    expect(boss.name).toBe(MOBS[ROACH_KING_ID].name);
    upgrade.boss.templateId = 'rift_boss_asmon';
    const saved = validateRiftUpgrade(upgrade, draft.floorCount);
    expect(saved.value?.boss.name).toBe(MOBS[ROACH_KING_ID].name);
  });

  it('winds up a fixed slam, holds movement and gives players time to leave', () => {
    const { sim, ctx, boss, events, step } = encounter();
    boss.roachKing!.nextCast = 0;
    const hp = sim.player.hp;
    expect(updateRoachKing(ctx, boss)).toBe(true);
    expect(boss.castingAbility).toBe('rift_asmon_desk_slam');
    expect(sim.player.hp).toBe(hp);
    const warning = events.find((event) => event.type === 'spellfxAt' && event.fx === 'runeCircle');
    expect(warning).toMatchObject({ radius: 8, duration: 2.2, x: boss.pos.x, z: boss.pos.z });
    sim.player.pos.x += 9;
    step(2.3);
    expect(sim.player.hp).toBe(hp);
    expect(boss.castingAbility).toBeNull();
  });

  it('a slam hits a player who stays, but cannot one-shot from full health', () => {
    const { sim, boss, step } = encounter(28);
    sim.player.maxHp = 100;
    sim.player.hp = 100;
    boss.roachKing!.nextCast = 0;
    step(2.4);
    expect(sim.player.hp).toBeLessThan(100);
    expect(sim.player.hp).toBeGreaterThan(0);
  });

  it('transforms exactly once at half health, retaining form even after healing', () => {
    const { ctx, boss, step, inst } = encounter();
    boss.hp = Math.floor(boss.maxHp / 2);
    updateRoachKing(ctx, boss);
    expect(boss.castingAbility).toBe('rift_asmon_coronation');
    expect(boss.auras.some((aura) => aura.id === ROACH_CROWN_AURA)).toBe(false);
    step(3.1);
    expect(boss.auras.find((aura) => aura.id === ROACH_CROWN_AURA)).toMatchObject({
      undispellable: true,
    });
    expect(aurasSurvivingDeath(boss.auras).some((aura) => aura.id === ROACH_CROWN_AURA)).toBe(true);
    expect(boss.summonedIds).toHaveLength(2);
    expect(boss.summonedIds.every((id) => inst.mobIds.includes(id))).toBe(true);
    boss.hp = boss.maxHp;
    step(4.2);
    expect(boss.castingAbility).toBe('rift_asmon_swarm');
  });

  it.each([20, 22, 25, 28])('scales tribute adds with rank %i and the boss level', (level) => {
    const { ctx, boss, inst } = encounter(level);
    boss.roachKing!.sequence = 1;
    boss.roachKing!.nextCast = 0;
    updateRoachKing(ctx, boss);
    const add = ctx.entities.get(boss.roachKing!.tributeIds[0])!;
    const expected = createMob(
      -1,
      riftRankTemplate(MOBS[GARBAGE_BEETLE_ID], riftRankTuningFor(level), 'add'),
      boss.level,
      add.pos,
    );
    expect(add.maxHp).toBe(expected.maxHp);
    expect(add.weapon).toEqual(expected.weapon);
    expect(add.level).toBe(boss.level);
    expect(inst.mobIds).toContain(add.id);
  });

  it('interrupting Tribute denies healing; killing its beetles also denies healing', () => {
    for (const answer of ['interrupt', 'kill']) {
      const { ctx, boss, step } = encounter();
      boss.hp = Math.floor(boss.maxHp * 0.8);
      boss.roachKing!.sequence = 1;
      boss.roachKing!.nextCast = 0;
      updateRoachKing(ctx, boss);
      const hp = boss.hp;
      if (answer === 'interrupt') {
        ctx.setPlayerLevel(20, ctx.entities.get(boss.aggroTargetId!)!.id);
        const player = ctx.entities.get(boss.aggroTargetId!)!;
        ctx.runEffects(
          player,
          ctx.players.get(player.id)!,
          boss,
          ctx.resolvedAbility('pummel', player.id)!,
        );
        expect(boss.auras.some((aura) => aura.kind === 'lockout')).toBe(true);
      } else for (const id of boss.roachKing!.tributeIds) ctx.entities.get(id)!.dead = true;
      step(5.2);
      expect(boss.hp).toBe(hp);
    }
  });

  it('Counterspell lockout postpones the next Nature cast until its actual expiry', () => {
    const { sim, ctx, boss } = encounter(25, 42, 'mage');
    ctx.setPlayerLevel(23, sim.playerId);
    boss.roachKing!.crowned = true;
    boss.roachKing!.sequence = 1;
    boss.roachKing!.nextCast = 0;
    updateRoachKing(ctx, boss);
    expect(boss.castingAbility).toBe('rift_asmon_tribute');
    ctx.runEffects(
      sim.player,
      ctx.players.get(sim.playerId)!,
      boss,
      ctx.resolvedAbility('counterspell', sim.playerId)!,
    );
    expect(boss.auras.find((aura) => aura.kind === 'lockout')).toMatchObject({
      school: 'nature',
      remaining: 6,
    });
    for (let tick = 0; tick < Math.ceil(5 / DT); tick++) {
      updateAuras(ctx, boss);
      updateRoachKing(ctx, boss);
      expect(boss.castingAbility).toBeNull();
    }
    expect(boss.roachKing!.sequence).toBe(2);
    for (let tick = 0; tick < Math.ceil(1.2 / DT); tick++) {
      updateAuras(ctx, boss);
      updateRoachKing(ctx, boss);
    }
    expect(boss.castingAbility).toBe('rift_asmon_filth');
  });

  it('silence and school lockout gate Nature casts while physical Desk Slam remains usable', () => {
    for (const kind of ['silence', 'lockout'] as const) {
      for (const school of ['nature', 'frost'] as const) {
        for (const crowned of [false, true]) {
          const { ctx, boss, step, events } = encounter();
          boss.roachKing!.crowned = crowned;
          boss.roachKing!.nextCast = 0;
          ctx.applyAura(boss, {
            id: 'test_control',
            name: 'Control',
            kind,
            school,
            remaining: 8,
            duration: 8,
            value: 0,
            sourceId: boss.aggroTargetId!,
          });
          updateRoachKing(ctx, boss);
          const blocked = crowned && (kind === 'silence' || school === 'nature');
          expect(boss.castingAbility).toBe(
            blocked ? null : crowned ? 'rift_asmon_swarm' : 'rift_asmon_desk_slam',
          );
          expect(boss.roachKing!.sequence).toBe(blocked ? 0 : 1);
          if (!crowned) {
            step(2.3);
            expect(
              events.find((event) => event.type === 'damage' && event.ability === 'Desk Slam'),
            ).toMatchObject({ school: 'physical' });
          }
        }
      }
    }
  });

  it('unanswered tribute heals in proportion to living beetles', () => {
    const { ctx, boss, step } = encounter(22);
    boss.hp = Math.floor(boss.maxHp * 0.8);
    boss.roachKing!.sequence = 1;
    boss.roachKing!.nextCast = 0;
    updateRoachKing(ctx, boss);
    const hp = boss.hp;
    step(5.1);
    expect(boss.hp).toBe(hp + Math.round(boss.maxHp * 0.06));
  });

  it('S-rank filth warns every member, then kills only players inside a marked zone', () => {
    const { sim, ctx, boss, inst, step } = encounter(28);
    const other = sim.addPlayer('warrior', 'Other', { autoEquip: true });
    const player = ctx.entities.get(other)!;
    player.pos = { ...sim.player.pos, x: sim.player.pos.x + 20 };
    inst.memberIds.add(other);
    boss.roachKing!.crowned = true;
    boss.roachKing!.sequence = 2;
    boss.roachKing!.nextCast = 0;
    updateRoachKing(ctx, boss);
    expect(inst.bossDeathZones).toHaveLength(2);
    expect(inst.bossDeathZones[0].remaining).toBe(3.5);
    sim.player.pos.z += 9;
    for (let i = 0; i < 72; i++) tickRiftBossDeathZones(ctx);
    expect(sim.player.dead).toBe(false);
    expect(player.dead).toBe(true);
  });

  it('evade and death cancel casts, zones and summons without harming a sibling instance', () => {
    for (const death of [false, true]) {
      const { ctx, boss, inst, events } = encounter(28);
      boss.hp = Math.floor(boss.maxHp / 2);
      updateRoachKing(ctx, boss);
      boss.roachKing!.cast = null;
      boss.castingAbility = null;
      boss.roachKing!.sequence = 1;
      boss.roachKing!.nextCast = 0;
      updateRoachKing(ctx, boss);
      const ids = [...boss.summonedIds];
      const sibling = ctx.riftInstances.find((candidate) => candidate !== inst)!;
      sibling.partyKey = 'sibling';
      sibling.bossDeathZones = [{ x: 10, z: 10, radius: 2, remaining: 8, total: 8 }];
      inst.bossDeathZones.push({
        x: boss.pos.x,
        z: boss.pos.z,
        radius: 7,
        remaining: 1,
        total: 1,
        sourceId: boss.id,
      });
      if (death) {
        boss.dead = true;
        updateRoachKing(ctx, boss);
      } else resetEvadingMob(ctx, boss);
      expect(sibling.bossDeathZones).toHaveLength(1);
      expect(boss.castingAbility).toBeNull();
      expect(boss.roachKing).toBeUndefined();
      expect(inst.bossDeathZones).toEqual([]);
      expect(ids.every((id) => !ctx.entities.has(id) && !inst.mobIds.includes(id))).toBe(true);
      expect(events.some((event) => event.type === 'riftDeathZoneClear')).toBe(true);
      if (!death) expect(boss.auras.some((aura) => aura.id === ROACH_CROWN_AURA)).toBe(false);
    }
  });

  it('source-only reset keeps another boss warning in the same instance', () => {
    const { ctx, boss, inst, events } = encounter(28);
    boss.roachKing!.crowned = true;
    boss.roachKing!.sequence = 2;
    boss.roachKing!.nextCast = 0;
    updateRoachKing(ctx, boss);
    inst.bossDeathZones.push({
      x: boss.pos.x + 20,
      z: boss.pos.z,
      radius: 4,
      remaining: 6,
      total: 6,
      sourceId: -22,
    });
    resetEvadingMob(ctx, boss);
    expect(inst.bossDeathZones).toEqual([
      { x: boss.pos.x + 20, z: boss.pos.z, radius: 4, remaining: 6, total: 6, sourceId: -22 },
    ]);
    expect(
      events.some((event) => event.type === 'riftDeathZoneSpawn' && event.durationSecs === 6),
    ).toBe(true);
  });

  it('a killing blow before the global zone tick cancels its imminent detonation', () => {
    const { sim, ctx, boss, inst } = encounter(28);
    inst.bossDeathZones.push({
      x: sim.player.pos.x,
      z: sim.player.pos.z,
      radius: 7,
      remaining: DT,
      total: DT,
      sourceId: boss.id,
    });
    boss.dead = true;
    tickRiftBossDeathZones(ctx);
    expect(sim.player.dead).toBe(false);
    expect(inst.bossDeathZones).toEqual([]);
  });

  it('replays encounter events and summons deterministically', () => {
    const trace = () => {
      const { boss, ctx, events, step } = encounter(28, 551);
      boss.hp = Math.floor(boss.maxHp / 2);
      step(35);
      return {
        events,
        state: boss.roachKing,
        adds: boss.summonedIds.map((id) => {
          const add = ctx.entities.get(id)!;
          return { id, templateId: add.templateId, hp: add.hp, weapon: add.weapon, pos: add.pos };
        }),
      };
    };
    expect(trace()).toEqual(trace());
  });
});

describe('Roach King dev encounter route', () => {
  it('is unavailable without dev commands and enters the actual S-rank final floor when enabled', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      autoEquip: true,
      devCommands: true,
      world: EMPTY_TEST_WORLD,
    });
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    expect(
      handleRoachKingDevCommand({ ...ctx, devCommands: false }, '/dev roachking S', sim.playerId),
    ).toBe(false);
    expect(sim.riftInstances.every((inst) => inst.partyKey === null)).toBe(true);
    expect(handleRoachKingDevCommand(ctx, '/dev roachking S', sim.playerId)).toBe(true);
    const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null)!;
    expect(inst.floorIndex).toBe(inst.floorCount - 1);
    expect(inst.baseLevel).toBe(28);
    expect(inst.mobIds).toEqual([inst.bossId]);
    expect(sim.entities.get(inst.bossId!)?.templateId).toBe(ROACH_KING_ID);
    expect(sim.player.targetId).toBe(inst.bossId);
  });
});
