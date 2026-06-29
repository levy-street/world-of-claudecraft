// Direct unit tests for src/sim/entity_roster.ts (E1). The roster ops, despawn
// prologue, delayed-event drain and ground-AoE drain are exercised in ISOLATION
// against a fake SimContext (proving the module needs no Sim); release-spirit is
// exercised against a real Sim.ctx (so resolve/recalcPlayerStats/groundPos are real).

import { describe, expect, it, vi } from 'vitest';
import { DELVES, isDelvePos, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  addEntityToRoster,
  drainDelayedEvents,
  dropEntityFromRoster,
  type GroundAoE,
  graveyardReadout,
  rebucketEntity,
  releasePlayerSpirit,
  runDespawnDecay,
  tickGroundAoEs,
} from '../src/sim/entity_roster';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { createSimContext, type SimContextHost } from '../src/sim/sim_context';
import { SpatialGrid } from '../src/sim/spatial';
import type { Entity } from '../src/sim/types';

type AnyEntity = Entity & Record<string, any>;

// A SpatialGrid contains `e` iff a radius query around its position finds its id.
function gridHas(grid: SpatialGrid, e: Entity): boolean {
  let found = false;
  grid.forEachInRadius(e.pos.x, e.pos.z, 1, (other) => {
    if (other.id === e.id) found = true;
  });
  return found;
}

// A real-ish fake SimContext: real grids/maps/collections so the roster ops mutate
// observable state, spies for the callbacks the isolated tests inspect, and harmless
// stubs for the release-spirit deps (those are covered against a real Sim below).
function makeCtx() {
  const rng = new Rng(7);
  const entities = new Map<number, Entity>();
  const grid = new SpatialGrid();
  const playerGrid = new SpatialGrid();
  const groundAoEs: GroundAoE[] = [];
  const dungeonDoorIds: number[] = [];
  const arenaMatches = new Map();
  const players = new Map();
  const cfg = { seed: 1 } as unknown as SimContextHost['cfg'];
  const clock = { time: 0, tick: 0 };
  let delayedEvents: { at: number; event: any; guard?: () => boolean }[] = [];
  let pendingProjectiles: any[] = [];
  const emit = vi.fn();
  const clearEntityMarker = vi.fn();
  const pulseGroundAoE = vi.fn();
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
    primaryId: -1,
    tradeInvites: new Map(),
    duelInvites: new Map(),
    nextId: 1,
    get grid() {
      return grid;
    },
    get playerGrid() {
      return playerGrid;
    },
    get delayedEvents() {
      return delayedEvents;
    },
    set delayedEvents(v) {
      delayedEvents = v;
    },
    get pendingProjectiles() {
      return pendingProjectiles;
    },
    set pendingProjectiles(v) {
      pendingProjectiles = v;
    },
    get groundAoEs() {
      return groundAoEs;
    },
    get dungeonDoorIds() {
      return dungeonDoorIds;
    },
    instances: [],
    get arenaMatches() {
      return arenaMatches;
    },
    get players() {
      return players;
    },
    get cfg() {
      return cfg;
    },
    trades: new Map(),
    arenaQueue1v1: [],
    arenaQueue2v2: [],
    arenaQueueFiesta: [],
    arenaBusySlots: new Set(),
    nextArenaMatchId: 1,
    delveRuns: [],
    delvePetStash: new Map(),
    utcDay: '',
    pendingMobRespawns: [],
    partyInvites: new Map(),
    chatTokens: new Map(),
    channelSubs: new Map(),
    emit,
    error: vi.fn(),
    clearEntityMarker,
    pulseGroundAoE,
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
    partyOf: vi.fn(() => null),
    removeFromParty: vi.fn(),
    dropPartyMarkers: vi.fn(),
    onMobKilledForQuests: vi.fn(),
    onInventoryChangedForQuests: vi.fn(),
    checkQuestReady: vi.fn(),
    countItem: vi.fn(() => 0),
    lockoutNowMs: vi.fn(() => 0),
    instanceKeyFor: vi.fn(() => 'solo:0'),
    instanceOriginOf: vi.fn(() => ({ x: 0, z: 0 })),
    enterDungeon: vi.fn(),
    leaveDungeon: vi.fn(),
    addEntity: vi.fn(),
    dropEntity: vi.fn(),
    rebucket: vi.fn(),
    resolve: vi.fn(() => null),
    groundPos: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    playerMods: vi.fn(),
    delveRunForPlayer: vi.fn(() => null),
    delveModuleEntry: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    failDelveRun: vi.fn(),
    duels: new Map(),
    pendingLootRolls: new Map(),
    nextLootRollId: 1,
    devCommands: false,
    marketListings: [],
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
    usesProfiledMobCombat: vi.fn(() => false),
    updateProfiledMobCombat: vi.fn(),
    tryMobMeleeSwingInRange: vi.fn(() => false),
    maybeFlee: vi.fn(() => false),
    aggroMob: vi.fn(),
    isStunned: vi.fn(() => false),
    isRooted: vi.fn(() => false),
    moveSpeedMult: vi.fn(() => 1),
    swingIntervalMult: vi.fn(() => 1),
    mobEffectiveMeleeRange: vi.fn(() => 0),
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
  };
  const ctx = createSimContext(host);
  return {
    ctx,
    entities,
    grid,
    playerGrid,
    groundAoEs,
    dungeonDoorIds,
    clock,
    emit,
    clearEntityMarker,
    pulseGroundAoE,
    delayed: () => host.delayedEvents,
  };
}

function mob(id: number, x: number, z: number, key = 'forest_wolf'): AnyEntity {
  return createMob(id, MOBS[key], 3, { x, y: 0, z }) as AnyEntity;
}

describe('entity_roster: roster ops (isolated ctx)', () => {
  it('addEntityToRoster inserts into entities + grid, and playerGrid only for players', () => {
    const t = makeCtx();
    const m = mob(101, 10, 10);
    addEntityToRoster(t.ctx, m);
    expect(t.entities.get(101)).toBe(m);
    expect(gridHas(t.grid, m)).toBe(true);
    expect(gridHas(t.playerGrid, m)).toBe(false); // mob is not in the player grid

    const p = mob(102, 12, 12);
    p.kind = 'player';
    addEntityToRoster(t.ctx, p);
    expect(gridHas(t.grid, p)).toBe(true);
    expect(gridHas(t.playerGrid, p)).toBe(true); // player IS in both grids
  });

  it('addEntityToRoster appends dungeon doors to dungeonDoorIds (and nothing else)', () => {
    const t = makeCtx();
    const door = mob(110, 5, 5);
    door.templateId = 'dungeon_door';
    addEntityToRoster(t.ctx, door);
    expect(t.dungeonDoorIds).toEqual([110]);
    addEntityToRoster(t.ctx, mob(111, 6, 6)); // a non-door spawn
    expect(t.dungeonDoorIds).toEqual([110]); // unchanged
  });

  it('dropEntityFromRoster removes from both grids + map and clears the marker', () => {
    const t = makeCtx();
    const p = mob(120, 8, 8);
    p.kind = 'player';
    addEntityToRoster(t.ctx, p);
    dropEntityFromRoster(t.ctx, 120);
    expect(t.entities.has(120)).toBe(false);
    expect(gridHas(t.grid, p)).toBe(false);
    expect(gridHas(t.playerGrid, p)).toBe(false);
    expect(t.clearEntityMarker).toHaveBeenCalledWith(120);
  });

  it('dropEntityFromRoster on a missing id still clears the marker but no-ops the rest', () => {
    const t = makeCtx();
    dropEntityFromRoster(t.ctx, 999);
    expect(t.clearEntityMarker).toHaveBeenCalledWith(999);
    expect(t.entities.size).toBe(0);
  });

  it('rebucketEntity re-indexes after a position change', () => {
    const t = makeCtx();
    const m = mob(130, 0, 0);
    addEntityToRoster(t.ctx, m);
    m.pos = { x: 50, y: 0, z: 50 };
    rebucketEntity(t.ctx, m);
    expect(gridHas(t.grid, m)).toBe(true); // found at the NEW cell
    let foundAtOld = false;
    t.grid.forEachInRadius(0, 0, 1, (e) => {
      if (e.id === 130) foundAtOld = true;
    });
    expect(foundAtOld).toBe(false);
  });
});

describe('entity_roster: despawn prologue (isolated ctx)', () => {
  it('collect-then-drop: expires despawnTimer AND idle-despawn mobs, keeps survivors', () => {
    const t = makeCtx();
    t.clock.time = 100;
    const expiring = mob(201, 1, 1); // despawnTimer branch
    expiring.despawnTimer = 0.04; // < DT (0.05) -> drops this pass
    const idle = mob(202, 2, 2, 'varkas_boneguard'); // DAMAGE_IDLE_DESPAWN branch
    idle.inCombat = false;
    idle.dead = false;
    idle.damageIdleDespawnTimer = 0.04;
    const survivor = mob(203, 3, 3);
    survivor.facing = 1.25;
    for (const e of [expiring, idle, survivor]) addEntityToRoster(t.ctx, e);

    runDespawnDecay(t.ctx);

    expect(t.entities.has(201)).toBe(false); // despawnTimer expired -> dropped
    expect(t.entities.has(202)).toBe(false); // idle-despawn expired -> dropped
    expect(t.entities.has(203)).toBe(true); // survivor stays
    expect(gridHas(t.grid, survivor)).toBe(true);
    // movement bookkeeping ran for the survivor (prevFacing copied from facing).
    expect((survivor as AnyEntity).prevFacing).toBe(1.25);
  });

  it('an idle-despawn mob IN COMBAT is not despawned', () => {
    const t = makeCtx();
    const fighting = mob(210, 1, 1, 'varkas_boneguard');
    fighting.inCombat = true;
    fighting.damageIdleDespawnTimer = 0.01;
    addEntityToRoster(t.ctx, fighting);
    runDespawnDecay(t.ctx);
    expect(t.entities.has(210)).toBe(true);
  });

  it('clears an expired overhead emote', () => {
    const t = makeCtx();
    t.clock.time = 50;
    const m = mob(220, 1, 1);
    m.overheadEmoteId = 'laugh' as any;
    m.overheadEmoteUntil = 49; // already past
    addEntityToRoster(t.ctx, m);
    runDespawnDecay(t.ctx);
    expect(m.overheadEmoteId).toBe(null);
    expect(m.overheadEmoteUntil).toBe(0);
  });
});

describe('entity_roster: delayed-event drain (isolated ctx)', () => {
  it('fires due events, drops guard-false events, keeps future events', () => {
    const t = makeCtx();
    t.clock.time = 10;
    t.ctx.delayedEvents = [
      { at: 9, event: { type: 'respawn', pid: 1 } }, // due -> fires
      { at: 9, event: { type: 'respawn', pid: 2 }, guard: () => false }, // due -> dropped
      { at: 9, event: { type: 'respawn', pid: 3 }, guard: () => true }, // due -> fires
      { at: 100, event: { type: 'respawn', pid: 4 } }, // future -> stays
    ];
    drainDelayedEvents(t.ctx);
    expect(t.emit).toHaveBeenCalledTimes(2);
    expect(t.emit).toHaveBeenCalledWith({ type: 'respawn', pid: 1 });
    expect(t.emit).toHaveBeenCalledWith({ type: 'respawn', pid: 3 });
    expect(t.delayed()).toEqual([{ at: 100, event: { type: 'respawn', pid: 4 } }]);
  });

  it('is a no-op (no allocation churn) when there are no delayed events', () => {
    const t = makeCtx();
    drainDelayedEvents(t.ctx);
    expect(t.emit).not.toHaveBeenCalled();
  });
});

describe('entity_roster: ground-AoE drain (isolated ctx)', () => {
  function aoe(over: Partial<GroundAoE> = {}): GroundAoE {
    return {
      sourceId: 1,
      pos: { x: 0, y: 0, z: 0 },
      radius: 8,
      min: 1,
      max: 2,
      remaining: 2,
      interval: 1,
      tickTimer: 0,
      school: 'holy',
      ability: 'consecration',
      ...over,
    };
  }

  it('pulses on interval and advances the tick timer; drops expired effects', () => {
    const t = makeCtx();
    t.groundAoEs.push(aoe({ remaining: 2, tickTimer: 0, interval: 1 }));
    tickGroundAoEs(t.ctx);
    expect(t.pulseGroundAoE).toHaveBeenCalledTimes(1);
    expect(t.groundAoEs.length).toBe(1); // still alive
    expect(t.groundAoEs[0].tickTimer).toBeCloseTo(0.95, 6); // 0 + interval(1) - DT(0.05)

    // An effect at the end of its life is spliced out and does not pulse.
    const t2 = makeCtx();
    t2.groundAoEs.push(aoe({ remaining: 0.04, tickTimer: 1 }));
    tickGroundAoEs(t2.ctx);
    expect(t2.pulseGroundAoE).not.toHaveBeenCalled();
    expect(t2.groundAoEs.length).toBe(0);
  });
});

describe('entity_roster: graveyardReadout (pure)', () => {
  it('names the fall-back graveyard for the position', () => {
    const e = mob(1, 0, 0);
    const text = graveyardReadout(e);
    expect(text).toMatch(/spirit returns to the .+ graveyard at \(-?\d+, -?\d+\)\./);
  });
});

describe('entity_roster: release-spirit (real Sim.ctx)', () => {
  const makeSim = (cls: 'warrior' | 'rogue' = 'warrior', seed = 42) =>
    new Sim({ seed, playerClass: cls, autoEquip: true }) as any;

  it('outdoor release respawns at the zone graveyard at FULL hp, out of combat', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    p.hp = 1;
    p.inCombat = true;
    p.dead = true;
    releasePlayerSpirit(sim.ctx, sim.playerId);
    expect(p.dead).toBe(false);
    expect(p.hp).toBe(p.maxHp); // FULL hp
    expect(p.inCombat).toBe(false);
    expect(p.auras).toEqual([]);
    expect(isDelvePos(p.pos.x)).toBe(false);
  });

  it('a not-dead player early-bails (no respawn side effects)', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    const posBefore = { ...p.pos };
    p.dead = false;
    releasePlayerSpirit(sim.ctx, sim.playerId);
    expect(p.pos).toEqual(posBefore); // untouched
  });

  it('in-delve first death respawns at 50% hp; a second death fails the run', () => {
    const sim = makeSim('rogue', 99);
    const reliquary = DELVES.collapsed_reliquary;
    sim.setPlayerLevel(reliquary.minLevel);
    const p = sim.player as AnyEntity;
    p.pos = { x: reliquary.doorPos.x, y: 0, z: reliquary.doorPos.z };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(sim.playerId);
    expect(run, 'delve run started').toBeTruthy();
    run.modules = ['reliquary_finale'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);

    // First death -> 50% hp at the module entry (delve pos).
    p.dead = true;
    releasePlayerSpirit(sim.ctx, sim.playerId);
    expect(p.dead).toBe(false);
    expect(p.hp).toBe(Math.max(1, Math.round(p.maxHp * 0.5)));
    expect(isDelvePos(p.pos.x)).toBe(true);

    // Second in-run death -> run fails, player ejected out of the delve.
    const e2 = sim.entities.get(sim.playerId) as AnyEntity;
    e2.dead = true;
    releasePlayerSpirit(sim.ctx, sim.playerId);
    const events = sim.tick();
    expect(events.some((ev: any) => ev.type === 'delveFailed')).toBe(true);
    expect(isDelvePos((sim.entities.get(sim.playerId) as AnyEntity).pos.x)).toBe(false);
  });

  it('is deterministic: same seed + same death -> identical graveyard outcome', () => {
    const outcome = () => {
      const sim = makeSim('warrior', 7);
      sim.setPlayerLevel(10);
      const p = sim.player as AnyEntity;
      p.dead = true;
      releasePlayerSpirit(sim.ctx, sim.playerId);
      return { hp: p.hp, maxHp: p.maxHp, pos: { ...p.pos } };
    };
    expect(outcome()).toEqual(outcome());
  });
});
