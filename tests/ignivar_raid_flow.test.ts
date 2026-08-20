import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  IGNIVAR_APOCALYPSE_ADD_ID,
  IGNIVAR_APOCALYPSE_HP_THRESHOLD,
  IGNIVAR_BRAND_AURA_ID,
  IGNIVAR_BRAND_MAX_STACKS,
  IGNIVAR_JUDGMENT_CAST_ID,
  IGNIVAR_LAST_INFERNO_HP_THRESHOLD,
  IGNIVAR_MOLTEN_ARMOR_AURA_ID,
  IGNIVAR_SKYFIRE_CAST_ID,
  IGNIVAR_SOAK_AURA_ID,
  IGNIVAR_SOAK_REQUIRED_PLAYERS,
  updateIgnivarEncounter,
} from '../src/sim/encounters/ignivar';
import { IGNIVAR_WATER_CONDUIT_TEMPLATES } from '../src/sim/ignivar_arena';
import { IGNIVAR_JUDGMENT_ACTIVE_SECONDS } from '../src/sim/ignivar_forge_judgment';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, IGNIVAR_BOSS_ID, type PlayerClass } from '../src/sim/types';

type RaidRole = 'tank' | 'healer' | 'dps';

interface TestRaider {
  entity: Entity;
  role: RaidRole;
}

describe('Ignivar ten-player Normal mechanics smoke', () => {
  it('coordinates the full Ignivar phase flow in a 2-2-6 roster', () => {
    const sim = new Sim({ seed: 2786, playerClass: 'warrior', devCommands: true });
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', sim.player.id, true)).toBe(true);
    const boss = [...sim.entities.values()].find((entity) => entity.templateId === IGNIVAR_BOSS_ID);
    if (!boss) throw new Error('Ignivar did not spawn');

    const roster: TestRaider[] = [{ entity: sim.player, role: 'tank' }];
    const additions: readonly [PlayerClass, string, RaidRole][] = [
      ['paladin', 'Tank Two', 'tank'],
      ['priest', 'Healer One', 'healer'],
      ['druid', 'Healer Two', 'healer'],
      ['mage', 'DPS One', 'dps'],
      ['rogue', 'DPS Two', 'dps'],
      ['warlock', 'DPS Three', 'dps'],
      ['hunter', 'DPS Four', 'dps'],
      ['shaman', 'DPS Five', 'dps'],
      ['mage', 'DPS Six', 'dps'],
    ];
    for (const [cls, name, role] of additions) {
      const pid = sim.addPlayer(cls, name);
      const entity = sim.entities.get(sim.players.get(pid)?.entityId ?? -1);
      if (!entity) throw new Error(`Raider ${name} did not spawn`);
      roster.push({ entity, role });
      sim.setPlayerLevel(20, pid);
    }
    sim.setPlayerLevel(20);
    expect(sim.setSpec('prot')).toBe(true);
    const secondTank = roster.find(
      (raider) => raider.role === 'tank' && raider.entity.id !== sim.player.id,
    )?.entity;
    if (!secondTank) throw new Error('Second tank was not found');
    expect(sim.setSpec('protection', secondTank.id)).toBe(true);
    expect(roster.filter((raider) => raider.role === 'tank')).toHaveLength(2);
    expect(roster.filter((raider) => raider.role === 'healer')).toHaveLength(2);
    expect(roster.filter((raider) => raider.role === 'dps')).toHaveLength(6);

    const origin = instanceOrigin(DUNGEONS.ignivar_raid_arena.index, 0);
    for (let index = 0; index < roster.length; index++) {
      const angle = (index / roster.length) * Math.PI * 2;
      roster[index].entity.pos = {
        x: origin.x + Math.sin(angle) * 12,
        y: 0,
        z: origin.z + Math.cos(angle) * 12,
      };
      roster[index].entity.prevPos = { ...roster[index].entity.pos };
      roster[index].entity.devGod = true;
    }
    // This pins roster topology and mechanic coordination. Survival and healer throughput
    // remain human-playtest tuning, so invulnerability keeps random damage out of this smoke.
    const tanks = roster.filter((raider) => raider.role === 'tank').map((raider) => raider.entity);
    const dps = roster.filter((raider) => raider.role === 'dps').map((raider) => raider.entity);
    tanks[0].pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z - 2 };
    tanks[1].pos = { ...tanks[0].pos };
    boss.inCombat = true;
    boss.aiState = 'attack';
    boss.aggroTargetId = tanks[0].id;

    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 0;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.overlapTimer = 999;
    boss.swingTimer = 999;
    updateIgnivarEncounter(sim.ctx, boss);
    const branded = roster
      .map((raider) => raider.entity)
      .filter((entity) => entity.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID));
    expect(branded).toHaveLength(3);

    for (let i = 0; i < 40; i++) sim.tick();
    for (const player of branded) {
      expect(player.auras.find((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)?.stacks).toBe(2);
    }

    const conduit = [...sim.entities.values()].find(
      (entity) => entity.templateId === IGNIVAR_WATER_CONDUIT_TEMPLATES.ready,
    );
    if (!conduit) throw new Error('Water conduit did not spawn');
    conduit.templateId = IGNIVAR_WATER_CONDUIT_TEMPLATES.active;
    for (const player of branded) player.pos = { ...conduit.pos };
    updateIgnivarEncounter(sim.ctx, boss);
    expect(
      branded.some((player) => player.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)),
    ).toBe(false);

    boss.ignivar.skyfireTimer = 0;
    boss.ignivar.soakTimer = 999;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.castingAbility).toBe(IGNIVAR_SKYFIRE_CAST_ID);
    boss.ignivar.skyfireCastRemaining = DT;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.castingAbility).toBeNull();

    boss.ignivar.soakTimer = 0;
    updateIgnivarEncounter(sim.ctx, boss);
    const marked = sim.entities.get(boss.ignivar.soakTargetId ?? -1);
    if (!marked) throw new Error('Shared Pyre target was not found');
    expect(roster.find((raider) => raider.entity.id === marked.id)?.role).not.toBe('tank');
    const soakGroup = [
      marked,
      ...roster
        .filter((raider) => raider.role !== 'tank' && raider.entity.id !== marked.id)
        .slice(0, IGNIVAR_SOAK_REQUIRED_PLAYERS - 1)
        .map((raider) => raider.entity),
    ];
    expect(soakGroup).toHaveLength(IGNIVAR_SOAK_REQUIRED_PLAYERS);
    for (const raider of roster) {
      raider.entity.pos = soakGroup.includes(raider.entity)
        ? { ...marked.pos }
        : { x: marked.pos.x + 20, y: marked.pos.y, z: marked.pos.z };
    }
    boss.ignivar.soakRemaining = DT;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(marked.auras.some((aura) => aura.id === IGNIVAR_SOAK_AURA_ID)).toBe(false);
    expect(boss.ignivar.soakTargetId).toBeNull();

    tanks[0].pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z - 2 };
    tanks[1].pos = { ...tanks[0].pos };
    boss.ignivar.forgeStrikeTimer = 0;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(tanks[0].auras.find((aura) => aura.id === IGNIVAR_MOLTEN_ARMOR_AURA_ID)?.stacks).toBe(1);
    boss.forcedTargetId = tanks[1].id;
    boss.forcedTargetTimer = 3;
    boss.ignivar.forgeStrikeTimer = 0;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(tanks[1].auras.find((aura) => aura.id === IGNIVAR_MOLTEN_ARMOR_AURA_ID)?.stacks).toBe(1);

    boss.hp = Math.floor(boss.maxHp * IGNIVAR_APOCALYPSE_HP_THRESHOLD);
    updateIgnivarEncounter(sim.ctx, boss);
    const add = [...sim.entities.values()].find(
      (entity) => entity.templateId === IGNIVAR_APOCALYPSE_ADD_ID && !entity.dead,
    );
    if (!add) throw new Error('Heart of the End did not spawn');
    for (const attacker of dps) {
      if (add.dead) break;
      sim.ctx.dealDamage(
        attacker,
        add,
        Math.ceil(add.maxHp / dps.length),
        false,
        'arcane',
        'Raid Focus',
        'hit',
        true,
        undefined,
        false,
        false,
        true,
      );
    }
    expect(add.dead).toBe(true);
    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.ignivar.apocalypseResolved).toBe(true);

    boss.hp = Math.floor(boss.maxHp * IGNIVAR_LAST_INFERNO_HP_THRESHOLD);
    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.ignivar.forgeJudgmentPhase).toBe('warning');
    expect(boss.castingAbility).toBe(IGNIVAR_JUDGMENT_CAST_ID);
    boss.ignivar.forgeJudgmentRemaining = IGNIVAR_JUDGMENT_ACTIVE_SECONDS + DT;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.ignivar.forgeJudgmentPhase).toBe('active');
    boss.ignivar.forgeJudgmentRemaining = DT;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.ignivar.forgeJudgmentPhase).toBe('done');
    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.ignivar.lastInfernoTriggered).toBe(true);
    expect(boss.enraged).toBe(true);
    expect(branded.every((player) => !player.dead)).toBe(true);
    expect(IGNIVAR_BRAND_MAX_STACKS).toBe(3);
  });
});
