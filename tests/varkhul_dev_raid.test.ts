import { describe, expect, it } from 'vitest';
import { updateVarkhulEncounter, VARKHUL_BOSS_ID } from '../src/sim/encounters/varkhul';
import { IGNIVAR_SECOND_WING_ID } from '../src/sim/ignivar_raid_ids';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { varkhulForgeBeamAssignments } from '../src/sim/varkhul_forge_beams';
import { VARKHUL_FORGE_LOCAL_POS } from '../src/sim/varkhul_forge_intermission';

function devSim(devCommands = true): Sim {
  const sim = new Sim({ seed: 6112, playerClass: 'warrior', autoEquip: true, devCommands });
  sim.setPlayerLevel(20);
  return sim;
}

function raidBots(sim: Sim) {
  return [...sim.players.values()]
    .filter((meta) => meta.isDevBot && /^IgnivarG[1-3]Bot[1-3]$/.test(meta.name))
    .sort((first, second) => first.entityId - second.entityId);
}

describe('/dev varkhulraid', () => {
  it('forms a ten-player raid and spreads nine anchored bots around the Inner Crucible', () => {
    const sim = devSim();
    sim.chat('/dev dungeon ignivar_inner_crucible normal');

    sim.chat('/dev varkhulraid normal');

    expect(sim.instanceInfoAt(sim.player.pos)?.dungeonId).toBe(IGNIVAR_SECOND_WING_ID);
    expect(
      sim.instances.find(
        (candidate) =>
          candidate.dungeonId === IGNIVAR_SECOND_WING_ID &&
          candidate.partyKey === sim.ctx.instanceKeyFor(sim.player.id),
      )?.difficulty,
    ).toBe('normal');
    const party = sim.partyOf(sim.player.id);
    expect(party).toMatchObject({ raid: true, leader: sim.player.id });
    expect(party?.members).toHaveLength(10);
    const bots = raidBots(sim);
    expect(bots).toHaveLength(9);
    const positions = bots.map((meta) => {
      const bot = sim.entities.get(meta.entityId);
      if (!bot) throw new Error(`Missing Varkhul practice bot ${meta.name}`);
      expect(meta.devAnchored).toBe(true);
      expect(bot.profilerInvulnerable).toBe(true);
      expect(bot.autoAttack).toBe(false);
      expect(sim.instanceInfoAt(bot.pos)?.dungeonId).toBe(IGNIVAR_SECOND_WING_ID);
      return `${bot.pos.x.toFixed(2)}:${bot.pos.z.toFixed(2)}`;
    });
    expect(new Set(positions).size).toBe(9);
    const xs = bots.map((meta) => sim.entities.get(meta.entityId)?.pos.x ?? 0);
    const zs = bots.map((meta) => sim.entities.get(meta.entityId)?.pos.z ?? 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(48);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThanOrEqual(46);
    const instance = sim.instances.find(
      (candidate) =>
        candidate.dungeonId === IGNIVAR_SECOND_WING_ID &&
        candidate.partyKey === sim.ctx.instanceKeyFor(sim.player.id),
    );
    if (!instance) throw new Error('Inner Crucible practice instance disappeared');
    const origin = sim.ctx.instanceOriginOf(instance);
    const botRows = bots.map((meta) => {
      const bot = sim.entities.get(meta.entityId);
      if (!bot) throw new Error(`Missing Varkhul practice bot ${meta.name}`);
      return { id: bot.id, x: bot.pos.x, z: bot.pos.z, dead: bot.dead };
    });
    expect(
      varkhulForgeBeamAssignments(
        { x: origin.x + VARKHUL_FORGE_LOCAL_POS.x, z: origin.z + VARKHUL_FORGE_LOCAL_POS.z },
        botRows,
      ).map((beam) => beam.blockerId),
    ).toEqual([null, null]);

    const boss = instance.mobIds
      .map((id) => sim.entities.get(id))
      .find((entity) => entity?.templateId === VARKHUL_BOSS_ID);
    if (!boss) throw new Error('Varkhul practice boss disappeared');
    const positionsBeforeIntermission = bots.map((meta) => {
      const bot = sim.entities.get(meta.entityId);
      if (!bot) throw new Error(`Missing Varkhul practice bot ${meta.name}`);
      return { id: meta.entityId, pos: { ...bot.pos } };
    });
    boss.inCombat = true;
    boss.aiState = 'attack';
    boss.aggroTargetId = sim.player.id;
    boss.hp = Math.floor(boss.maxHp * 0.5);
    updateVarkhulEncounter(sim.ctx, boss);
    if (!boss.varkhul) throw new Error('Varkhul practice intermission did not start');
    boss.varkhul.assemblyForgeBeamWarmupRemaining = 0;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(boss.varkhul.assemblyForgeBeamBlockerIds).toEqual([null, null]);
    expect(
      positionsBeforeIntermission.map(({ id }) => {
        const bot = sim.entities.get(id);
        if (!bot) throw new Error(`Missing Varkhul practice bot ${id}`);
        return { id, pos: { ...bot.pos } };
      }),
    ).toEqual(positionsBeforeIntermission);
    expect(sim.activeVarkhulAssemblies[0]).toMatchObject({
      runes: [],
      assignments: [],
      cores: [],
    });
  });

  it('can create the practice raid directly on Heroic and reuses it on reset', () => {
    const sim = devSim();
    sim.chat('/dev varkhulraid heroic');
    const before = raidBots(sim).map((meta) => meta.entityId);
    const instance = sim.instances.find(
      (candidate) =>
        candidate.dungeonId === IGNIVAR_SECOND_WING_ID &&
        candidate.partyKey === sim.ctx.instanceKeyFor(sim.player.id),
    );
    expect(instance?.difficulty).toBe('heroic');

    const stagedPositions = before.map((botId, index) => {
      const bot = sim.entities.get(botId);
      if (!bot) throw new Error('Varkhul practice bot did not spawn');
      const staged = { ...bot.pos };
      bot.pos.x += 17 + index;
      bot.pos.z += 19 + index;
      return staged;
    });
    sim.chat('/dev varkhulraid');

    expect(raidBots(sim).map((meta) => meta.entityId)).toEqual(before);
    const resetPositions = before.map((botId, index) => {
      const bot = sim.entities.get(botId);
      if (!bot) throw new Error('Varkhul practice bot disappeared on reset');
      expect(bot.pos).toEqual(stagedPositions[index]);
      expect(sim.instanceInfoAt(bot.pos)?.dungeonId).toBe(IGNIVAR_SECOND_WING_ID);
      return `${bot.pos.x.toFixed(2)}:${bot.pos.z.toFixed(2)}`;
    });
    expect(new Set(resetPositions).size).toBe(9);
    expect(
      sim.instances.find(
        (candidate) =>
          candidate.dungeonId === IGNIVAR_SECOND_WING_ID &&
          candidate.partyKey === sim.ctx.instanceKeyFor(sim.player.id),
      )?.difficulty,
    ).toBe('heroic');
    for (const meta of raidBots(sim)) {
      const bot = sim.entities.get(meta.entityId);
      expect(meta.devAnchored).toBe(true);
      expect(bot).toMatchObject({
        dead: false,
        ghost: false,
        profilerInvulnerable: true,
        autoAttack: false,
      });
    }

    const firstBot = sim.entities.get(before[0]);
    if (!firstBot) throw new Error('Varkhul practice bot disappeared before death reset');
    firstBot.profilerInvulnerable = false;
    sim.ctx.handleDeath(firstBot, null);
    sim.releaseSpirit(firstBot.id);
    expect(firstBot).toMatchObject({ dead: true, ghost: true });
    expect(firstBot.corpseInstanceId).not.toBeNull();

    sim.chat('/dev varkhulraid normal');

    expect(raidBots(sim).map((meta) => meta.entityId)).toEqual(before);
    expect(firstBot).toMatchObject({
      dead: false,
      ghost: false,
      corpsePos: null,
      corpseInstanceId: null,
      profilerInvulnerable: true,
      autoAttack: false,
    });
    expect(
      sim.instances.find(
        (candidate) =>
          candidate.dungeonId === IGNIVAR_SECOND_WING_ID &&
          candidate.partyKey === sim.ctx.instanceKeyFor(sim.player.id),
      )?.difficulty,
    ).toBe('normal');
  });

  it('switches an existing Normal practice room to Heroic when the command requests it', () => {
    const sim = devSim();
    const difficultyAt = (entity: Entity) => {
      const claimId = sim.ctx.instanceClaimIdAt(entity.pos);
      return sim.instances.find((instance) => instance.exitId === claimId)?.difficulty;
    };
    sim.chat('/dev varkhulraid normal');
    expect(difficultyAt(sim.player)).toBe('normal');

    sim.chat('/dev varkhulraid heroic');

    expect(sim.instanceInfoAt(sim.player.pos)?.dungeonId).toBe(IGNIVAR_SECOND_WING_ID);
    expect(difficultyAt(sim.player)).toBe('heroic');
    const party = sim.partyOf(sim.player.id);
    if (!party) throw new Error('Varkhul practice raid disappeared during difficulty switch');
    for (const memberId of party.members) {
      const member = sim.entities.get(memberId);
      if (!member) throw new Error(`Varkhul practice member ${memberId} disappeared`);
      expect(difficultyAt(member)).toBe('heroic');
    }
  });

  it('is inert when development commands are disabled', () => {
    const sim = devSim(false);
    const before = { ...sim.player.pos };
    const beforeDifficulty = sim.players.get(sim.player.id)?.dungeonDifficulty;
    const beforeInstances = sim.instances.map((instance) => ({
      dungeonId: instance.dungeonId,
      difficulty: instance.difficulty,
      partyKey: instance.partyKey,
    }));
    sim.chat('/dev varkhulraid');
    expect(sim.player.pos).toEqual(before);
    expect(sim.players.get(sim.player.id)?.dungeonDifficulty).toBe(beforeDifficulty);
    expect(sim.partyOf(sim.player.id)).toBeNull();
    expect(
      sim.instances.map((instance) => ({
        dungeonId: instance.dungeonId,
        difficulty: instance.difficulty,
        partyKey: instance.partyKey,
      })),
    ).toEqual(beforeInstances);
    expect(raidBots(sim)).toHaveLength(0);
  });
});
