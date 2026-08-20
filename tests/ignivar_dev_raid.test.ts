import { describe, expect, it } from 'vitest';
import {
  IGNIVAR_APOCALYPSE_HP_THRESHOLD,
  IGNIVAR_BRAND_AURA_ID,
  IGNIVAR_BRAND_RADIUS,
  IGNIVAR_SOAK_RADIUS,
  IGNIVAR_SOAK_SHARED_MAX_HP,
  updateIgnivarEncounter,
} from '../src/sim/encounters/ignivar';
import {
  IGNIVAR_FORGE_CHAINS_AURA_ID,
  IGNIVAR_FORGE_CHAINS_BREAK_DISTANCE,
  IGNIVAR_FORGE_CHAINS_STRAIN_SECONDS,
} from '../src/sim/ignivar_forge_chains';
import { IGNIVAR_FORGE_APPROACH_ID, IGNIVAR_RAID_ARENA_ID } from '../src/sim/ignivar_raid_ids';
import { Sim } from '../src/sim/sim';
import { DT, dist2d, IGNIVAR_BOSS_ID } from '../src/sim/types';

function devSim(devCommands = true): Sim {
  const sim = new Sim({ seed: 2786, playerClass: 'warrior', autoEquip: true, devCommands });
  sim.setPlayerLevel(20);
  return sim;
}

function ignivarBots(sim: Sim) {
  return [...sim.players.values()]
    .filter((meta) => meta.isDevBot && /^IgnivarG[1-3]Bot[1-3]$/.test(meta.name))
    .sort((a, b) => a.entityId - b.entityId);
}

describe('/dev ignivarraid', () => {
  it('replaces a live Normal dev claim when entering the same arena on Heroic', () => {
    const sim = devSim();
    sim.chat('/dev dungeon ignivar_raid_arena normal');
    const normalInstance = sim.instances.find(
      (instance) => instance.dungeonId === 'ignivar_raid_arena' && instance.partyKey !== null,
    );
    const normalBoss = [...sim.entities.values()].find(
      (entity) => entity.templateId === IGNIVAR_BOSS_ID,
    );
    expect(normalInstance?.difficulty).toBe('normal');
    expect(normalBoss).toBeDefined();
    sim.chat('/dev ignivarraid');
    const botIds = ignivarBots(sim).map((meta) => meta.entityId);
    expect(botIds).toHaveLength(9);
    const oldChainPartner = sim.entities.get(botIds[0]);
    if (!oldChainPartner || !normalBoss) throw new Error('Normal practice raid did not spawn');
    sim.ctx.applyAura(sim.player, {
      id: IGNIVAR_BRAND_AURA_ID,
      name: 'Brand of the Pyre',
      kind: 'dot',
      remaining: 600,
      duration: 600,
      value: 1,
      sourceId: normalBoss.id,
      school: 'fire',
      encounterOwned: true,
    });
    sim.ctx.applyAura(oldChainPartner, {
      id: IGNIVAR_FORGE_CHAINS_AURA_ID,
      name: 'Chains of the Forge',
      kind: 'vulnerability',
      remaining: 8,
      duration: 8,
      value: 0,
      value2: sim.player.id,
      sourceId: normalBoss.id,
      school: 'fire',
      encounterOwned: true,
    });

    sim.chat('/dev dungeon ignivar_raid_arena heroic');

    const heroicInstance = sim.instances.find(
      (instance) => instance.dungeonId === 'ignivar_raid_arena' && instance.partyKey !== null,
    );
    const heroicBoss = [...sim.entities.values()].find(
      (entity) => entity.templateId === IGNIVAR_BOSS_ID,
    );
    expect(heroicInstance?.difficulty).toBe('heroic');
    expect(heroicBoss?.id).not.toBe(normalBoss?.id);
    expect(sim.entities.has(normalBoss?.id ?? -1)).toBe(false);
    for (const botId of botIds) expect(heroicInstance?.enteredBy.has(botId)).toBe(true);
    expect(sim.player.auras.some((aura) => aura.sourceId === normalBoss?.id)).toBe(false);
    expect(oldChainPartner.auras.some((aura) => aura.sourceId === normalBoss?.id)).toBe(false);

    sim.chat('/dev ignivarraid');
    const bot = sim.entities.get(ignivarBots(sim)[0]?.entityId ?? -1);
    if (!heroicBoss || !bot) throw new Error('Heroic replacement raid did not spawn');
    sim.player.pos = { ...bot.pos, x: bot.pos.x + 2 };
    sim.player.prevPos = { ...sim.player.pos };
    heroicBoss.inCombat = true;
    heroicBoss.aiState = 'attack';
    heroicBoss.aggroTargetId = sim.player.id;
    updateIgnivarEncounter(sim.ctx, heroicBoss);
    if (!heroicBoss.ignivar) throw new Error('Heroic replacement did not initialize Ignivar');
    heroicBoss.ignivar.frontalTimer = 999;
    heroicBoss.ignivar.skyfireTimer = 999;
    heroicBoss.ignivar.rotatingRaysTimer = 999;
    heroicBoss.ignivar.forgeWaveTimer = 999;
    heroicBoss.ignivar.meteorTimer = 999;
    heroicBoss.ignivar.soakTimer = 999;
    heroicBoss.ignivar.forgeChainsTimer = 0;

    updateIgnivarEncounter(sim.ctx, heroicBoss);

    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(true);
  });

  it('preserves a live Normal dev claim when Heroic entry is locked', () => {
    const sim = devSim();
    sim.chat('/dev dungeon ignivar_raid_arena normal');
    const normalInstance = sim.instances.find(
      (instance) => instance.dungeonId === 'ignivar_raid_arena' && instance.partyKey !== null,
    );
    const normalBoss = [...sim.entities.values()].find(
      (entity) => entity.templateId === IGNIVAR_BOSS_ID,
    );
    sim.players
      .get(sim.player.id)
      ?.raidLockouts.set('ignivar_raid_arena:heroic', Number.MAX_SAFE_INTEGER);

    sim.chat('/dev dungeon ignivar_raid_arena heroic');

    expect(normalInstance?.difficulty).toBe('normal');
    expect(sim.entities.get(normalBoss?.id ?? -1)).toBe(normalBoss);
  });

  it('pairs the solo tester with a nearby bot for an interactive Heroic chain check', () => {
    const sim = devSim();
    sim.chat('/dev dungeon ignivar_raid_arena heroic');
    sim.chat('/dev ignivarraid');
    const boss = [...sim.entities.values()].find((entity) => entity.templateId === IGNIVAR_BOSS_ID);
    const bot = sim.entities.get(ignivarBots(sim)[0]?.entityId ?? -1);
    if (!boss || !bot) throw new Error('Ignivar Heroic practice setup did not spawn');
    sim.player.pos = { ...bot.pos, x: bot.pos.x + 2 };
    sim.player.prevPos = { ...sim.player.pos };
    boss.inCombat = true;
    boss.aiState = 'attack';
    boss.aggroTargetId = sim.player.id;
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.skyfireTimer = 999;
    boss.ignivar.rotatingRaysTimer = 999;
    boss.ignivar.forgeWaveTimer = 999;
    boss.ignivar.meteorTimer = 999;
    boss.ignivar.soakTimer = 999;
    boss.ignivar.forgeChainsTimer = 0;

    updateIgnivarEncounter(sim.ctx, boss);

    expect(sim.player.auras.find((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)?.value2).toBe(
      bot.id,
    );
    expect(boss.ignivar.forgeChainsPlayerIds).toHaveLength(5);
    expect(
      [...sim.entities.values()].filter((entity) =>
        entity.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID),
      ),
    ).toHaveLength(10);
    sim.player.pos.x = bot.pos.x + IGNIVAR_FORGE_CHAINS_BREAK_DISTANCE + 0.1;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(true);
    boss.ignivar.forgeChainsAttachGraceRemaining = 0;
    const playerPairIndex = boss.ignivar.forgeChainsPlayerIds?.findIndex((pair) =>
      pair.includes(sim.player.id),
    );
    if (playerPairIndex === undefined || playerPairIndex < 0) {
      throw new Error('Tester did not receive a Forge Chains pair');
    }
    boss.ignivar.forgeChainsStrainSeconds[playerPairIndex] =
      IGNIVAR_FORGE_CHAINS_STRAIN_SECONDS - DT;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);
    expect(sim.player.dead).toBe(true);
    expect(sim.player.hp).toBe(0);
    expect(bot.dead).toBe(false);
  });

  it('forms a full raid of stationary, invulnerable participants in spread soak pods', () => {
    const sim = devSim();
    const player = sim.player;
    sim.chat('/dev dungeon ignivar_raid_arena normal');
    const claimId = sim.instanceClaimIdAt(player.pos);
    expect(claimId).not.toBeNull();

    sim.chat('/dev ignivarraid');

    const party = sim.partyOf(player.id);
    const bots = ignivarBots(sim);
    expect(party).toMatchObject({ leader: player.id, raid: true });
    expect(party?.members).toHaveLength(10);
    expect(bots).toHaveLength(9);
    expect(bots.map((meta) => meta.name)).toEqual([
      'IgnivarG1Bot1',
      'IgnivarG1Bot2',
      'IgnivarG1Bot3',
      'IgnivarG2Bot1',
      'IgnivarG2Bot2',
      'IgnivarG2Bot3',
      'IgnivarG3Bot1',
      'IgnivarG3Bot2',
      'IgnivarG3Bot3',
    ]);
    const botEntities = bots.map((meta) => sim.entities.get(meta.entityId));
    const botNameById = new Map(bots.map((meta) => [meta.entityId, meta.name]));
    expect(botEntities.every((bot) => bot !== undefined)).toBe(true);
    for (const bot of botEntities) {
      if (!bot) continue;
      expect(party?.members).toContain(bot.id);
      expect(bot.level).toBe(20);
      expect(bot.profilerInvulnerable).toBe(true);
      expect(bot.devGod).toBe(false);
      expect(sim.players.get(bot.id)?.devAnchored).toBe(true);
      expect(bot.autoAttack).toBe(false);
      expect(bot.targetId).toBeNull();
      expect(sim.instanceClaimIdAt(bot.pos)).toBe(claimId);
      expect(dist2d(player.pos, bot.pos)).toBeGreaterThan(IGNIVAR_BRAND_RADIUS);

      const nearbyBots = botEntities.filter(
        (other) => other && dist2d(bot.pos, other.pos) <= IGNIVAR_SOAK_RADIUS,
      );
      expect(nearbyBots).toHaveLength(3);
      const groupPrefix = botNameById.get(bot.id)?.slice(0, 'IgnivarG1'.length);
      expect(nearbyBots.map((other) => botNameById.get(other?.id ?? -1)).sort()).toEqual(
        bots.map((meta) => meta.name).filter((name) => name.startsWith(groupPrefix ?? '')),
      );
      for (const other of botEntities) {
        if (!other || other.id === bot.id) continue;
        expect(dist2d(bot.pos, other.pos)).toBeGreaterThan(IGNIVAR_BRAND_RADIUS);
      }
    }

    const boss = [...sim.entities.values()].find((entity) => entity.templateId === IGNIVAR_BOSS_ID);
    expect(boss).toBeDefined();
    sim.tick();
    expect(boss?.inCombat).toBe(false);
  });

  it('resets the same raid bots instead of duplicating them', () => {
    const sim = devSim();
    sim.chat('/dev dungeon ignivar_raid_arena normal');
    sim.chat('/dev ignivarraid');
    const before = ignivarBots(sim).map((meta) => meta.entityId);
    const first = sim.entities.get(before[0]);
    expect(first).toBeDefined();
    if (!first) return;
    first.hp = 1;
    first.pos.x += 30;

    sim.chat('/dev ignivarraid');

    const after = ignivarBots(sim).map((meta) => meta.entityId);
    expect(after).toEqual(before);
    expect(sim.partyOf(sim.playerId)?.members).toHaveLength(10);
    expect(first.hp).toBe(first.maxHp);
    expect(dist2d(sim.player.pos, first.pos)).toBeGreaterThan(IGNIVAR_BRAND_RADIUS);
  });

  it('lets the tester complete the four-player Shared Pyre by joining the marked pod', () => {
    const sim = devSim();
    sim.chat('/dev dungeon ignivar_raid_arena normal');
    sim.chat('/dev ignivarraid');
    const boss = [...sim.entities.values()].find((entity) => entity.templateId === IGNIVAR_BOSS_ID);
    if (!boss) throw new Error('Ignivar did not spawn');
    boss.inCombat = true;
    boss.aiState = 'attack';
    boss.aggroTargetId = sim.player.id;
    boss.swingTimer = 999;
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.skyfireTimer = 999;
    boss.ignivar.rotatingRaysTimer = 999;
    boss.ignivar.forgeWaveTimer = 999;
    boss.ignivar.meteorTimer = 999;
    boss.ignivar.soakTimer = 0;

    updateIgnivarEncounter(sim.ctx, boss);
    const marked = sim.entities.get(boss.ignivar.soakTargetId ?? -1);
    expect(sim.players.get(marked?.id ?? -1)?.isDevBot).toBe(true);
    if (!marked) throw new Error('Shared Pyre did not mark a test bot');
    sim.player.pos = { ...marked.pos };
    sim.player.prevPos = { ...sim.player.pos };
    sim.player.hp = sim.player.maxHp;
    boss.ignivar.soakRemaining = DT;

    updateIgnivarEncounter(sim.ctx, boss);

    expect(sim.player.hp).toBe(
      sim.player.maxHp - Math.ceil(sim.player.maxHp * (IGNIVAR_SOAK_SHARED_MAX_HP / 4)),
    );
  });

  it('keeps its invulnerable mechanic bots alive through an Apocalypse wipe', () => {
    const sim = devSim();
    sim.chat('/dev dungeon ignivar_raid_arena normal');
    sim.chat('/dev ignivarraid');
    const boss = [...sim.entities.values()].find((entity) => entity.templateId === IGNIVAR_BOSS_ID);
    if (!boss) throw new Error('Ignivar did not spawn');
    boss.inCombat = true;
    boss.aiState = 'attack';
    boss.aggroTargetId = sim.player.id;
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_APOCALYPSE_HP_THRESHOLD);
    const botIds = ignivarBots(sim).map((meta) => meta.entityId);
    expect(botIds).toHaveLength(9);
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.apocalypseCastRemaining = DT;

    updateIgnivarEncounter(sim.ctx, boss);

    expect(sim.player.dead).toBe(true);
    expect(ignivarBots(sim).map((meta) => meta.entityId)).toEqual(botIds);
    for (const botId of botIds) {
      const bot = sim.entities.get(botId);
      expect(bot).toMatchObject({ dead: false, profilerInvulnerable: true });
      expect(bot?.hp).toBe(bot?.maxHp);
    }
  });

  it('keeps the test roster anchored when an encounter knockback reaches it', () => {
    const sim = devSim();
    sim.chat('/dev dungeon ignivar_raid_arena normal');
    sim.chat('/dev ignivarraid');
    const boss = [...sim.entities.values()].find((entity) => entity.templateId === IGNIVAR_BOSS_ID);
    const firstMeta = ignivarBots(sim)[0];
    const bot = sim.entities.get(firstMeta?.entityId ?? -1);
    if (!boss || !bot) throw new Error('Ignivar test roster did not spawn');
    const before = { ...bot.pos };
    sim.ctx.applyAura(bot, {
      id: IGNIVAR_BRAND_AURA_ID,
      name: 'Brand of the Pyre',
      kind: 'dot',
      remaining: 10,
      duration: 10,
      value: 1,
      sourceId: boss.id,
      school: 'fire',
    });

    const moved = sim.ctx.applyKnockback(boss, bot, 4);

    expect(moved).toBe(0);
    expect(bot.pos).toEqual(before);
  });

  it("cannot take ownership of another player's live Ignivar claim", () => {
    const sim = devSim();
    sim.chat('/dev dungeon ignivar_raid_arena normal');
    const claimId = sim.instanceClaimIdAt(sim.player.pos);
    const instance = sim.instances.find((candidate) => candidate.exitId === claimId);
    if (!instance) throw new Error('Ignivar claim did not spawn');
    const originalPartyKey = instance.partyKey;
    const intruderPid = sim.addPlayer('rogue', 'Intruder');
    const intruder = sim.entities.get(intruderPid);
    if (!intruder) throw new Error('Intruder did not spawn');
    intruder.pos = { ...sim.player.pos };
    intruder.prevPos = { ...intruder.pos };

    sim.chat('/dev ignivarraid', intruderPid);

    expect(instance.partyKey).toBe(originalPartyKey);
    expect(sim.partyOf(intruderPid)).toBeNull();
    expect(ignivarBots(sim)).toHaveLength(0);
  });

  it('enters the Normal forge approach with a full practice raid from the open world', () => {
    const sim = devSim();
    sim.chat('/dev ignivarraid');
    expect(ignivarBots(sim)).toHaveLength(9);
    expect(sim.partyOf(sim.playerId)).toMatchObject({ raid: true, leader: sim.playerId });
    expect(sim.instanceInfoAt(sim.player.pos)?.dungeonId).toBe(IGNIVAR_FORGE_APPROACH_ID);
    expect(sim.dungeonDifficulty()).toBe('normal');
    expect(
      sim.instances.find(
        (instance) =>
          instance.dungeonId === IGNIVAR_FORGE_APPROACH_ID && instance.partyKey !== null,
      ),
    ).toBeDefined();
    expect(
      sim.instances.find(
        (instance) => instance.dungeonId === IGNIVAR_RAID_ARENA_ID && instance.partyKey !== null,
      ),
    ).toBeDefined();
  });

  it('is gated when dev commands are disabled', () => {
    const sim = devSim(false);
    sim.chat('/dev ignivarraid');
    expect(ignivarBots(sim)).toHaveLength(0);
  });
});
