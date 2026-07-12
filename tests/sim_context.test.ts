// Direct unit tests for the SimContext seam (src/sim/sim_context.ts), installed by
// session S0b. Two layers:
//   1. createSimContext() in isolation against a FAKE host: the primitives are live
//      read-throughs, the callbacks pass through unchanged, and building/reading the
//      context draws no rng (so the seam can never perturb determinism).
//   2. The real `Sim.ctx`: every stub delegates to the still-on-Sim method of the
//      same name, and the seam leaves same-seed-same-world determinism intact.

import { describe, expect, it, vi } from 'vitest';
import { createDeedRuntime } from '../src/sim/deeds';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { createSimContext, type SimContextHost } from '../src/sim/sim_context';
import { createVcState } from '../src/sim/social/vale_cup';
import { SpatialGrid } from '../src/sim/spatial';
import type { Entity, SimEvent } from '../src/sim/types';

// Every cross-system callback on the seam. The list IS the contract: each must be a
// faithful pass-through to its host (and, on a real Sim, to the method of the same
// name). Keep in sync with SimContextCallbacks.
const CALLBACK_KEYS = [
  'emit',
  'error',
  'dealDamage',
  'handleDeath',
  'cancelCast',
  'pushbackCast',
  'refreshMobLeashFromAction',
  'retargetMob',
  'nythraxisAddFallbackTarget',
  'scheduleNythraxisAddDespawnIfBossReset',
  'isArenaCrossTeam',
  'arenaTeamOf',
  'endArenaMatch',
  'endDuel',
  // A2 duel/arena slice surface (consumed-from-Sim + arena bodies exposed for A3).
  'clearAurasFromSource',
  'entityInDungeon',
  'hasPendingSocialInvite',
  'createFiestaState',
  'fiestaStandardize',
  'updateFiestaActive',
  'fiestaRestoreChar',
  'clearFiestaAugments',
  'readyArenaFighter',
  'resetForArena',
  'isArenaTeamWiped',
  'arenaIsDown',
  'arenaAllPids',
  'fiestaTakedown',
  'fiestaDown',
  'rollLoot',
  'rollWorldBossLoot',
  'applyHeal',
  'spellCrit',
  'applyAura',
  'applyRootAura',
  'applyKnockback',
  'diminishedCrowdControlDuration',
  'hostilesInRadius',
  'breakStealth',
  'applyTaunt',
  'summonPet',
  'petOf',
  'completeTame',
  // P1b new shared-helper keys (error/playerGcdFor/healingThreat/countItem already listed
  // elsewhere - deduped, not re-added).
  'spendResource',
  'removeItem',
  'canAddItem',
  'clearEntityMarker',
  'partyOf',
  'removeFromParty',
  'dropPartyMarkers',
  // Q1 quest-credit trio + the countItem it consumes.
  'onMobKilledForQuests',
  'onInventoryChangedForQuests',
  'checkQuestReady',
  'countItem',
  'completeQuestForDev',
  'completeCurrentQuestsForDev',
  // E1 entity-roster surface.
  'addEntity',
  'dropEntity',
  'rebucket',
  'resolve',
  'groundPos',
  'playerMods',
  'delveRunForPlayer',
  'delveModuleEntry',
  'failDelveRun',
  'pulseGroundAoE',
  // C1 damage-core surface.
  'grantXp',
  'enterCombat',
  'hexOutputMult',
  'critVulnBonus',
  'pvpController',
  'threatMod',
  'clearNonPlayerStatAuras',
  // C3 aura/regen runner surface.
  'healingTakenMult',
  'healingThreat',
  'applyNonPlayerStatAura',
  'delveRunForMob',
  'onDelveBossDefeated',
  'grantNythraxisLockout',
  'frenzyPackmates',
  'armDeathThroes',
  'refreshKnownAbilities',
  'syncPetLevel',
  // M2 mob-locomotion surface.
  'moveToward',
  'mobSwing',
  'updateRangedPetAttack',
  'fleeMoveSpeed',
  'maybeFlee',
  'aggroMob',
  'isStunned',
  'isRooted',
  'moveSpeedMult',
  'swingIntervalMult',
  'mobCanSwim',
  'resolveMovePoint',
  'updatePet',
  'isDelveCompanionMob',
  'updateDelveCompanion',
  'updateBossMechanics',
  'updateNythraxisEncounter',
  'resetNythraxisEncounter',
  'despawnSummonedAdds',
  'updateFearMovement',
  'delveDetectMult',
  'detonateCorpse',
  'despawnPet',
  'respawnMob',
  'onBossDeath',
  // I1 dungeon instancing + the shared raid-lockout clock + the host reset boundary.
  'lockoutNowMs',
  'raidResetMs',
  'instanceKeyFor',
  'instanceOriginOf',
  'enterDungeon',
  'leaveDungeon',
  'dungeonDifficulty',
  'setDungeonDifficulty',
  'awardHeroicMarks',
  'grantHeroicKillLockout',
  // M3 mob-swing affix cascade surface.
  'effectiveArmor',
  'recalcPlayer',
  // I2a delve run lifecycle consume surface (helpers / gates / pet seam / I2b / I2c
  // + the reach-in callbacks). grantXp/despawnPet/delveRunForMob/onDelveBossDefeated/
  // delveDetectMult already listed above (C1/M2/C3) - deduped, not re-added.
  'partyMembersForKey',
  'addItem',
  'addItemInstance',
  // 'removeItem' listed above (P1b inventory-hub helper) - deduped.
  'spawnBossAdds',
  'tradeFor',
  'duelFor',
  'serializePet',
  'restorePet',
  'despawnPersistentPet',
  'isPetClass',
  'spawnDelveCompanion',
  'despawnDelveCompanion',
  'maybeCompanionBark',
  'abandonLockpick',
  'tickLockpickTimeout',
  'startDelveRaiseDeadChannel',
  // C4a casting-lifecycle surface.
  'resolvedAbility',
  'playerGcdFor',
  'isFriendlyTo',
  'isHostileTo',
  'lineOfSightBlocked',
  'stopFollow',
  'tameError',
  'standUp',
  'breakGhostWolf',
  'startAutoAttack',
  'revivePet',
  'completeFishing',
  'applyDemonHealTick',
  'awardCombo',
  'meleeSwing',
  'effectiveAttackPower',
  'hasLineOfSight',
  'findChargePath',
  'runEffects',
  // P1a pet-AI surface (effectiveAttackPower/isHostileTo already listed above; deduped).
  // C5 auto-attack consumes aggroMob/swingIntervalMult, already listed above (M2; deduped).
  'syncPetAspect',
  // G2 social plumbing (hasPendingSocialInvite already listed above; deduped).
  'setPlayerLevel',
  'notice',
  'spawnDevBot',
  // L2 inventory/vendor (W2): the four still-on-Sim helpers the moved useItem dispatches to.
  'startFishing',
  'unlockMechChromaFromItem',
  'openSkinSelect',
  'isSwimming',
  // W3 interaction: the two still-on-Sim quest-NPC delegates the moved interact dispatches to.
  'talkToNpc',
  'isQuestInteractionEntity',
  // W5 chat router/readouts reach-backs.
  'targetEntity',
  'partyCapacity',
  'marketListingBelongsTo',
  // Ravenpost mail: the quest turn-in letter hook.
  'queueQuestLetter',
  // Set proc firing.
  'applySetProcs',
  // The Vale Cup sport-move arms (social/vale_cup.ts).
  'vcupBallKick',
  'vcupBallPass',
  'vcupShoot',
  'vcupSportDash',
  'vcupSportShove',
] as const;

// A fully-spied fake host. `clock` is mutable so a test can prove the context reads
// time/tickCount LIVE rather than snapshotting them at construction.
function makeFakeHost() {
  const rng = new Rng(123);
  const entities = new Map<number, Entity>();
  const clock = { time: 0, tick: 0 };
  const host: SimContextHost = {
    get rng() {
      return rng;
    },
    get time() {
      return clock.time;
    },
    get tickCount() {
      return clock.tick;
    },
    get entities() {
      return entities;
    },
    players: new Map(),
    primaryId: -1,
    tradeInvites: new Map(),
    duelInvites: new Map(),
    nextId: 1,
    grid: new SpatialGrid(),
    playerGrid: new SpatialGrid(),
    delayedEvents: [],
    pendingProjectiles: [],
    groundAoEs: [],
    dungeonDoorIds: null,
    instances: [],
    arenaMatches: new Map(),
    duels: new Map(),
    cfg: { seed: 1 } as unknown as SimContextHost['cfg'],
    trades: new Map(),
    arenaQueue1v1: [],
    arenaQueue2v2: [],
    arenaQueueFiesta: [],
    arenaBusySlots: new Set(),
    arenaQueueYumi3: [],
    arenaQueueYumi5: [],
    yumiBusySlots: new Set(),
    yumiCatMatches: new Map(),
    matchmakeYumi: vi.fn(),
    updateYumiActive: vi.fn(),
    yumiPlayerDown: vi.fn(),
    yumiCatDamaged: vi.fn(),
    cleanupYumiMatch: vi.fn(),
    nextArenaMatchId: 1,
    delveRuns: [],
    delvePetStash: new Map(),
    utcDay: '',
    pendingMobRespawns: [],
    partyInvites: new Map(),
    readyChecks: new Map(),
    chatTokens: new Map(),
    channelSubs: new Map(),
    pendingLootRolls: new Map(),
    nextLootRollId: 1,
    devCommands: false,
    marketListings: [],
    bankerIds: [],
    vcup: createVcState(),
    deedDirtyPids: new Set<number>(),
    deedDirtyKeys: new Map<number, Set<string>>(),
    worldBossEntityIds: [],
    deedRuntime: createDeedRuntime(),
    fiestaBotPids: [],
    bumpDeedStat: vi.fn(),
    markItemDiscovered: vi.fn(),
    markVisited: vi.fn(),
    markDeedsDirty: vi.fn(),
    grantDeed: vi.fn(() => true),
    emit: vi.fn(),
    error: vi.fn(),
    dealDamage: vi.fn(),
    handleDeath: vi.fn(),
    cancelCast: vi.fn(),
    pushbackCast: vi.fn(),
    refreshMobLeashFromAction: vi.fn(),
    retargetMob: vi.fn(),
    nythraxisAddFallbackTarget: vi.fn(() => null),
    scheduleNythraxisAddDespawnIfBossReset: vi.fn(() => false),
    isArenaCrossTeam: vi.fn(() => false),
    arenaTeamOf: vi.fn(() => null),
    endArenaMatch: vi.fn(),
    endDuel: vi.fn(),
    clearAurasFromSource: vi.fn(),
    entityInDungeon: vi.fn(() => false),
    hasPendingSocialInvite: vi.fn(() => false),
    createFiestaState: vi.fn(),
    fiestaStandardize: vi.fn(),
    updateFiestaActive: vi.fn(),
    fiestaRestoreChar: vi.fn(),
    clearFiestaAugments: vi.fn(),
    readyArenaFighter: vi.fn(),
    resetForArena: vi.fn(),
    isArenaTeamWiped: vi.fn(() => false),
    arenaIsDown: vi.fn(() => false),
    arenaAllPids: vi.fn(() => []),
    fiestaTakedown: vi.fn(),
    fiestaDown: vi.fn(),
    rollLoot: vi.fn(),
    rollWorldBossLoot: vi.fn(),
    applyHeal: vi.fn(),
    spellCrit: vi.fn(() => 0.05),
    applyAura: vi.fn(),
    isControlAura: vi.fn(() => false),
    applyRootAura: vi.fn(),
    applyKnockback: vi.fn(() => 0),
    diminishedCrowdControlDuration: vi.fn(() => null),
    hostilesInRadius: vi.fn(() => []),
    breakStealth: vi.fn(),
    applyTaunt: vi.fn(),
    summonPet: vi.fn(),
    petOf: vi.fn(() => null),
    completeTame: vi.fn(),
    // P1b new shared-helper stubs (error/playerGcdFor/healingThreat/countItem stubbed
    // elsewhere in this host - deduped).
    spendResource: vi.fn(),
    removeItem: vi.fn(),
    canAddItem: vi.fn(() => true),
    removeFungibleItem: vi.fn(),
    clearEntityMarker: vi.fn(),
    partyOf: vi.fn(() => null),
    removeFromParty: vi.fn(),
    dropPartyMarkers: vi.fn(),
    onMobKilledForQuests: vi.fn(),
    onInventoryChangedForQuests: vi.fn(),
    checkQuestReady: vi.fn(),
    countItem: vi.fn(() => 0),
    countFungibleItem: vi.fn(() => 0),
    countEnchantableItem: vi.fn(() => 0),
    removeEnchantableItem: vi.fn(),
    completeQuestForDev: vi.fn(() => false),
    completeCurrentQuestsForDev: vi.fn(() => 0),
    lockoutNowMs: vi.fn(() => 0),
    raidResetMs: vi.fn((nowMs: number) => nowMs),
    instanceKeyFor: vi.fn(() => 'solo:0'),
    instanceOriginOf: vi.fn(() => ({ x: 0, z: 0 })),
    enterDungeon: vi.fn(),
    leaveDungeon: vi.fn(),
    dungeonDifficulty: vi.fn(() => 'normal' as const),
    setDungeonDifficulty: vi.fn(),
    awardHeroicMarks: vi.fn(),
    grantHeroicKillLockout: vi.fn(),
    addEntity: vi.fn(),
    dropEntity: vi.fn(),
    rebucket: vi.fn(),
    resolve: vi.fn(() => null),
    groundPos: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    playerMods: vi.fn(),
    delveRunForPlayer: vi.fn(() => null),
    delveModuleEntry: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    failDelveRun: vi.fn(),
    pulseGroundAoE: vi.fn(),
    grantXp: vi.fn(),
    enterCombat: vi.fn(),
    hexOutputMult: vi.fn(() => 1),
    critVulnBonus: vi.fn(() => 0),
    pvpController: vi.fn(() => null),
    threatMod: vi.fn(() => 1),
    clearNonPlayerStatAuras: vi.fn(),
    healingTakenMult: vi.fn(() => 1),
    healingThreat: vi.fn(),
    applyNonPlayerStatAura: vi.fn(),
    delveRunForMob: vi.fn(() => null),
    onDelveBossDefeated: vi.fn(),
    grantNythraxisLockout: vi.fn(),
    frenzyPackmates: vi.fn(),
    armDeathThroes: vi.fn(),
    refreshKnownAbilities: vi.fn(),
    syncPetLevel: vi.fn(),
    moveToward: vi.fn(() => false),
    mobSwing: vi.fn(),
    updateRangedPetAttack: vi.fn(),
    fleeMoveSpeed: vi.fn(() => 0),
    maybeFlee: vi.fn(() => false),
    aggroMob: vi.fn(),
    isStunned: vi.fn(() => false),
    isRooted: vi.fn(() => false),
    moveSpeedMult: vi.fn(() => 1),
    swingIntervalMult: vi.fn(() => 1),
    mobCanSwim: vi.fn(() => false),
    resolveMovePoint: vi.fn(() => ({ x: 0, z: 0 })),
    updatePet: vi.fn(),
    isDelveCompanionMob: vi.fn(() => false),
    updateDelveCompanion: vi.fn(),
    updateBossMechanics: vi.fn(),
    updateNythraxisEncounter: vi.fn(),
    resetNythraxisEncounter: vi.fn(),
    despawnSummonedAdds: vi.fn(),
    updateFearMovement: vi.fn(() => false),
    delveDetectMult: vi.fn(() => 1),
    detonateCorpse: vi.fn(),
    despawnPet: vi.fn(),
    respawnMob: vi.fn(),
    resetEvadingMob: vi.fn(),
    onBossDeath: vi.fn(),
    effectiveArmor: vi.fn(() => 0),
    recalcPlayer: vi.fn(),
    // I2a delve run lifecycle stubs. grantXp/despawnPet/delveRunForMob/onDelveBossDefeated/
    // delveDetectMult stubbed above (C1/M2/C3) - deduped here.
    partyMembersForKey: vi.fn(() => []),
    addItem: vi.fn(),
    addItemInstance: vi.fn(),
    // removeItem stubbed above (P1b inventory-hub helper) - deduped.
    spawnBossAdds: vi.fn(),
    tradeFor: vi.fn(() => null),
    duelFor: vi.fn(() => null),
    serializePet: vi.fn(() => null),
    restorePet: vi.fn(),
    despawnPersistentPet: vi.fn(),
    isPetClass: vi.fn(() => false),
    spawnDelveCompanion: vi.fn(),
    despawnDelveCompanion: vi.fn(),
    maybeCompanionBark: vi.fn(),
    abandonLockpick: vi.fn(),
    tickLockpickTimeout: vi.fn(),
    startDelveRaiseDeadChannel: vi.fn(() => false),
    resolvedAbility: vi.fn(() => null),
    playerGcdFor: vi.fn(() => 1.5),
    isFriendlyTo: vi.fn(() => false),
    isHostileTo: vi.fn(() => false),
    lineOfSightBlocked: vi.fn(() => false),
    stopFollow: vi.fn(),
    partyInvite: vi.fn(),
    readyCheckStart: vi.fn(),
    tameError: vi.fn(() => null),
    standUp: vi.fn(),
    breakGhostWolf: vi.fn(),
    startAutoAttack: vi.fn(),
    revivePet: vi.fn(),
    completeFishing: vi.fn(),
    applyDemonHealTick: vi.fn(),
    awardCombo: vi.fn(),
    meleeSwing: vi.fn(() => false),
    effectiveAttackPower: vi.fn(() => 0),
    hasLineOfSight: vi.fn(() => true),
    findChargePath: vi.fn(() => []),
    runEffects: vi.fn(),
    // P1a pet-AI stub (effectiveAttackPower/isHostileTo already stubbed above; deduped).
    // C5 auto-attack consumes aggroMob/swingIntervalMult, already stubbed above (M2; deduped).
    syncPetAspect: vi.fn(),
    // G2 social plumbing (hasPendingSocialInvite already stubbed above; deduped).
    setPlayerLevel: vi.fn(),
    notice: vi.fn(),
    spawnDevBot: vi.fn(),
    // L2 inventory/vendor (W2): the four still-on-Sim helpers the moved useItem dispatches to.
    startFishing: vi.fn(),
    unlockMechChromaFromItem: vi.fn(),
    openSkinSelect: vi.fn(),
    isSwimming: vi.fn(() => false),
    // W3 interaction: the two still-on-Sim quest-NPC delegates the moved interact dispatches to.
    talkToNpc: vi.fn(),
    isQuestInteractionEntity: vi.fn(() => false),
    // W5 chat router/readouts reach-backs.
    targetEntity: vi.fn(),
    partyCapacity: vi.fn(() => 5),
    marketListingBelongsTo: vi.fn(() => false),
    // Ravenpost mail: the quest turn-in letter hook.
    queueQuestLetter: vi.fn(),
    applySetProcs: vi.fn(),
    // The Vale Cup sport-move arms.
    vcupBallKick: vi.fn(),
    vcupBallPass: vi.fn(),
    vcupShoot: vi.fn(),
    vcupSportDash: vi.fn(),
    vcupSportShove: vi.fn(),
  };
  return { host, rng, entities, clock };
}

describe('createSimContext (isolated, fake host)', () => {
  it('exposes the host rng/entities by shared reference', () => {
    const { host, rng, entities } = makeFakeHost();
    const ctx = createSimContext(host);
    expect(ctx.rng).toBe(rng);
    expect(ctx.entities).toBe(entities);
  });

  it('reads time/tickCount LIVE, not snapshotted at construction', () => {
    const { host, clock } = makeFakeHost();
    const ctx = createSimContext(host);
    expect(ctx.time).toBe(0);
    expect(ctx.tickCount).toBe(0);
    clock.time = 12.5;
    clock.tick = 7;
    expect(ctx.time).toBe(12.5);
    expect(ctx.tickCount).toBe(7);
  });

  it('exposes bankerIds as a live shared view (the marketListings idiom)', () => {
    const { host } = makeFakeHost();
    const ctx = createSimContext(host);
    expect(ctx.bankerIds).toBe(host.bankerIds);
    host.bankerIds.push(4242); // the Sim ctor pushes ids after the ctx is built
    expect(ctx.bankerIds).toEqual([4242]);
  });

  it('passes every callback through to the host by identity (no rewrapping)', () => {
    const { host } = makeFakeHost();
    const ctx = createSimContext(host);
    const ctxRec = ctx as unknown as Record<string, unknown>;
    const hostRec = host as unknown as Record<string, unknown>;
    for (const key of CALLBACK_KEYS) {
      expect(typeof ctxRec[key]).toBe('function');
      expect(ctxRec[key]).toBe(hostRec[key]);
    }
  });

  it('forwards call arguments and return values to the host', () => {
    const { host } = makeFakeHost();
    const ctx = createSimContext(host);
    const ev = { type: 'loot', text: 'seam-test' } as SimEvent;
    ctx.emit(ev);
    expect(host.emit).toHaveBeenCalledWith(ev);

    const src = { id: 1 } as Entity;
    const tgt = { id: 2 } as Entity;
    ctx.dealDamage(src, tgt, 9, true, 'fire', 'fireball', 'hit');
    expect(host.dealDamage).toHaveBeenCalledWith(src, tgt, 9, true, 'fire', 'fireball', 'hit');

    (host.petOf as ReturnType<typeof vi.fn>).mockReturnValueOnce(tgt);
    expect(ctx.petOf(42)).toBe(tgt);
    expect(host.petOf).toHaveBeenCalledWith(42);
  });

  it('constructs and reads without drawing rng (determinism-safe)', () => {
    const { host } = makeFakeHost();
    let draws = 0;
    host.rng.setObserver(() => {
      draws++;
    });
    const ctx = createSimContext(host);
    // Touch every primitive view; none may draw.
    void ctx.rng;
    void ctx.time;
    void ctx.tickCount;
    void ctx.entities;
    host.rng.setObserver(null);
    expect(draws).toBe(0);
  });
});

describe('Sim.ctx (real seam delegation)', () => {
  const makeSim = (seed = 42) => new Sim({ seed, playerClass: 'warrior', autoEquip: true });

  it('exposes the live shared rng/entities/time/tickCount', () => {
    const sim = makeSim();
    expect(sim.ctx.rng).toBe(sim.rng);
    expect(sim.ctx.entities).toBe(sim.entities);
    expect(sim.ctx.time).toBe(sim.time);
    expect(sim.ctx.tickCount).toBe(sim.tickCount);
    sim.tick();
    expect(sim.ctx.tickCount).toBe(1);
    expect(sim.ctx.tickCount).toBe(sim.tickCount);
    expect(sim.ctx.time).toBe(sim.time);
  });

  it('emit delegates to the Sim event queue', () => {
    const sim = makeSim();
    sim.drainEvents(); // clear any startup events
    const ev = { type: 'loot', text: 'seam-emit' } as SimEvent;
    sim.ctx.emit(ev);
    expect(sim.drainEvents()).toContain(ev);
  });

  it('read-only callbacks (partyOf/petOf) delegate to Sim', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    expect(sim.ctx.partyOf(pid)).toBe(sim.partyOf(pid));
    expect(sim.ctx.petOf(pid)).toBe(sim.petOf(pid));
  });

  it('a mutating callback (dealDamage) delegates identically to Sim.dealDamage', () => {
    const viaCtx = makeSim(7);
    const viaDirect = makeSim(7);
    const pa = viaCtx.entities.get(viaCtx.primaryId) as Entity;
    const pb = viaDirect.entities.get(viaDirect.primaryId) as Entity;
    const hp0 = pa.hp;
    expect(pb.hp).toBe(hp0); // same seed => identical start

    viaCtx.ctx.dealDamage(null, pa, 5, false, 'physical', null, 'hit');
    viaDirect.dealDamage(null, pb, 5, false, 'physical', null, 'hit');

    expect(pa.hp).toBe(pb.hp); // delegation is identical to calling Sim directly
    expect(pa.hp).toBeLessThan(hp0); // and it actually applied damage (non-vacuous)
  });

  it('does not perturb determinism (same seed -> same world through the seam)', () => {
    const run = () => {
      const sim = makeSim(7);
      for (let i = 0; i < 40; i++) sim.tick();
      const p = sim.entities.get(sim.primaryId) as Entity;
      return { time: sim.ctx.time, tick: sim.ctx.tickCount, hp: p.hp, pos: { ...p.pos } };
    };
    expect(run()).toEqual(run());
  });
});
