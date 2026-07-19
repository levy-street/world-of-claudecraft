import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { type ClientSession, GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';
import { hasVisibleHuntersMark } from '../src/render/hunter_mark_marker_core';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';

interface FakeSocket {
  sent: any[];
  deliver: ((payload: string) => void) | null;
  ws: { readyState: number; send: (payload: string) => void };
}

interface OnlineHunter {
  server: GameServer;
  session: ClientSession;
  client: ClientWorld;
  outbound: any[];
  serverSocket: FakeSocket;
}

function fakeSocket(): FakeSocket {
  const sent: any[] = [];
  const socket: FakeSocket = {
    sent,
    deliver: null,
    ws: {
      readyState: 1,
      send: (payload: string) => {
        sent.push(JSON.parse(payload));
        socket.deliver?.(payload);
      },
    },
  };
  return socket;
}

function joined(result: ClientSession | { error: string }): ClientSession {
  if ('error' in result) throw new Error(result.error);
  result.blockListLoaded = true;
  return result;
}

function place(server: GameServer, id: number, x: number, z: number): void {
  const entity = server.sim.entities.get(id);
  if (!entity) throw new Error(`missing entity ${id}`);
  entity.pos = server.sim.groundPos(x, z);
  entity.prevPos = { ...entity.pos };
  server.sim.grid.update(entity);
  if (entity.kind === 'player') server.sim.playerGrid.update(entity);
}

function makeOnlineHunter(): OnlineHunter {
  vi.stubGlobal('WebSocket', { OPEN: 1 });
  const server = new GameServer();
  const serverSocket = fakeSocket();
  const session = joined(
    server.join(serverSocket.ws as any, 101, 101, 'NetHunter', 'hunter', null),
  );
  server.sim.setPlayerLevel(20, session.pid);
  server.sim.setSpec('marksmanship', session.pid);
  server.sim.applyTalents(
    {
      spec: 'marksmanship',
      rows: { 14: 'hun_r14_multi_shot', 20: 'hun_r20_powershot' },
    },
    session.pid,
  );
  place(server, session.pid, 700, 0);

  const outbound: any[] = [];
  const client = Object.create(ClientWorld.prototype) as ClientWorld;
  Object.assign(client as any, {
    cfg: { seed: server.sim.cfg.seed, playerClass: 'hunter' },
    connected: true,
    spectating: null,
    playerId: session.pid,
    ownPlayerId: session.pid,
    ownPlayerClass: 'hunter',
    known: [],
    entities: new Map(),
    eventQueue: [],
    moveInput: {},
    inventory: [],
    vendorBuyback: [],
    equipment: {},
    accountCosmetics: { completedQuestIds: [], mechChromaIds: [] },
    copper: 0,
    honor: 0,
    lifetimeHonor: 0,
    xp: 0,
    questLog: new Map(),
    questsDone: new Set(),
    pendingQuestCommands: new Map(),
    partyInfo: null,
    selectedDungeonDifficulty: 'normal',
    tradeInfo: null,
    duelInfo: null,
    lastSnapAt: 0,
    snapInterval: 50,
    serverTickHz: null,
    missingSince: new Map(),
    pendingFacingDelta: 0,
    mouselookFacing: null,
    lastInputSentAt: 0,
    lastInputSig: '',
    inputSeq: 0,
    pendingInputSeqSentAt: new Map(),
    ackedInputSeq: 0,
    inputEchoSamples: [],
    spectateFacingPending: false,
    pendingSpectateFacing: null,
    nodeCooldowns: new Map(),
    ws: {
      readyState: 1,
      send: (payload: string) => {
        outbound.push(JSON.parse(payload));
        server.handleMessage(session, payload);
      },
    },
  });
  serverSocket.deliver = (payload) =>
    (client as unknown as { onMessage(raw: string): void }).onMessage(payload);
  broadcast(server);
  return { server, session, client, outbound, serverSocket };
}

function spawnTarget(harness: OnlineHunter, x: number, z: number, id = 900_001): number {
  const mob = createMob(id, MOBS.forest_wolf, 18, harness.server.sim.groundPos(x, z));
  mob.hostile = true;
  mob.aiState = 'idle';
  mob.maxHp = 20_000;
  mob.hp = mob.maxHp;
  (harness.server.sim as any).addEntity(mob);
  return id;
}

function broadcast(server: GameServer): void {
  (server as any).broadcastSnapshots();
}

function advance(server: GameServer): void {
  const events = server.sim.tick();
  (server as any).routeEvents(events);
  broadcast(server);
}

function advanceTicks(server: GameServer, count: number): void {
  for (let i = 0; i < count; i++) advance(server);
}

function lastSnapshot(socket: FakeSocket): any {
  for (let i = socket.sent.length - 1; i >= 0; i--) {
    if (socket.sent[i].t === 'snap') return socket.sent[i];
  }
  throw new Error('no snapshot sent');
}

function remoteEntity(snapshot: any, id: number): any {
  return snapshot.ents.find((entity: any) => entity.id === id);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Hunter base abilities online', () => {
  it("routes Hunter's Mark through ClientWorld and returns the marked target in a snapshot", () => {
    const harness = makeOnlineHunter();
    const targetId = spawnTarget(harness, 700, 12);

    harness.client.targetEntity(targetId);
    harness.client.castAbility('hunters_mark');

    expect(harness.outbound.slice(-2)).toEqual([
      { t: 'cmd', cmd: 'target', id: targetId },
      { t: 'cmd', cmd: 'cast', ability: 'hunters_mark' },
    ]);
    const target = harness.server.sim.entities.get(targetId)!;
    expect(target.auras).toContainEqual(
      expect.objectContaining({ kind: 'hunter_mark', sourceId: harness.session.pid }),
    );

    broadcast(harness.server);
    expect(remoteEntity(lastSnapshot(harness.serverSocket), targetId).auras).toContainEqual(
      expect.objectContaining({ kind: 'hunter_mark', src: harness.session.pid }),
    );
    expect(harness.client.entities.get(targetId)?.auras).toContainEqual(
      expect.objectContaining({ kind: 'hunter_mark', sourceId: harness.session.pid }),
    );
    expect(hasVisibleHuntersMark(harness.client.entities.get(targetId)!)).toBe(true);
  });

  it("applies Hunter's Mark to a real direct shot through the online server path", () => {
    const fireArcaneShot = (marked: boolean): number => {
      const harness = makeOnlineHunter();
      const targetId = spawnTarget(harness, 700, 20);
      const target = harness.server.sim.entities.get(targetId);
      const hunter = harness.server.sim.entities.get(harness.session.pid);
      if (!target || !hunter) throw new Error('missing online Hunter cast entities');
      harness.client.targetEntity(targetId);
      if (marked) harness.client.castAbility('hunters_mark');
      hunter.gcdRemaining = 0;
      hunter.resource = hunter.maxResource;
      const hpBefore = target.hp;
      harness.client.castAbility('arcane_shot');
      advance(harness.server);
      expect(harness.client.entities.get(targetId)?.hp).toBe(target.hp);
      return hpBefore - target.hp;
    };

    const unmarked = fireArcaneShot(false);
    expect(fireArcaneShot(true)).toBe(Math.round(unmarked * 1.05));
  });

  it('returns Cheetah, Turtle, and Feign Death states in authoritative self snapshots', () => {
    const cases = [
      ['aspect_of_the_cheetah', 'buff_speed'],
      ['aspect_of_the_turtle', 'shield_wall'],
      ['feign_death', 'feign_death'],
    ] as const;

    for (const [abilityId, auraKind] of cases) {
      const harness = makeOnlineHunter();
      harness.client.castAbility(abilityId);
      broadcast(harness.server);

      expect(harness.outbound.at(-1)).toEqual({ t: 'cmd', cmd: 'cast', ability: abilityId });
      expect(lastSnapshot(harness.serverSocket).self.auras).toContainEqual(
        expect.objectContaining({ id: abilityId, kind: auraKind }),
      );
      expect(harness.client.player.auras).toContainEqual(
        expect.objectContaining({ id: abilityId, kind: auraKind }),
      );
      if (abilityId === 'feign_death') {
        expect(lastSnapshot(harness.serverSocket).self.auras).toContainEqual(
          expect.objectContaining({ id: abilityId, rem: 360, dur: 360 }),
        );
        expect(harness.client.player.auras).toContainEqual(
          expect.objectContaining({ id: abilityId, remaining: 360, duration: 360 }),
        );
      }
    }
  });

  it('applies Disengage and Exhilaration on the server and echoes their results', () => {
    const disengage = makeOnlineHunter();
    const hunter = disengage.server.sim.entities.get(disengage.session.pid)!;
    hunter.facing = 0;
    const startZ = hunter.pos.z;

    disengage.client.castAbility('disengage');
    expect(hunter.pos.z).toBe(startZ);
    expect(hunter.onGround).toBe(false);
    expect(hunter.vy).toBeGreaterThan(0);
    advanceTicks(disengage.server, 4);
    expect(hunter.pos.z).toBeLessThan(startZ);
    expect(hunter.pos.y).toBeGreaterThan(disengage.server.sim.groundPos(700, startZ).y);
    broadcast(disengage.server);
    expect(lastSnapshot(disengage.serverSocket).self.z).toBeCloseTo(hunter.pos.z, 2);
    expect(disengage.client.player.pos.z).toBeCloseTo(hunter.pos.z, 2);

    const exhilaration = makeOnlineHunter();
    const wounded = exhilaration.server.sim.entities.get(exhilaration.session.pid)!;
    wounded.hp = Math.floor(wounded.maxHp * 0.2);
    const expected = Math.min(wounded.maxHp, wounded.hp + Math.round(wounded.maxHp * 0.3));

    exhilaration.client.castAbility('exhilaration');
    expect(wounded.hp).toBe(expected);
    broadcast(exhilaration.server);
    expect(lastSnapshot(exhilaration.serverSocket).self.hp).toBe(expected);
    expect(exhilaration.client.player.hp).toBe(expected);
  });

  it('enforces Turtle attack lockout and Feign Death threat loss from online commands', () => {
    const turtle = makeOnlineHunter();
    turtle.client.castAbility('aspect_of_the_turtle');
    turtle.client.startAutoAttack();
    expect(turtle.outbound.slice(-2)).toEqual([
      { t: 'cmd', cmd: 'cast', ability: 'aspect_of_the_turtle' },
      { t: 'cmd', cmd: 'attack' },
    ]);
    expect(turtle.server.sim.entities.get(turtle.session.pid)?.autoAttack).toBe(false);
    advance(turtle.server);
    expect(turtle.client.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'error',
        text: "You can't attack while protected by Aspect of the Turtle.",
      }),
    );

    const feign = makeOnlineHunter();
    const targetId = spawnTarget(feign, 700, 3);
    const mob = feign.server.sim.entities.get(targetId)!;
    mob.threat.set(feign.session.pid, 500);
    mob.aggroTargetId = feign.session.pid;

    feign.client.castAbility('feign_death');
    expect(mob.threat.has(feign.session.pid)).toBe(false);
    expect(mob.aggroTargetId).not.toBe(feign.session.pid);
  });

  it('places Freezing Trap with castAt and snapshots the first triggered incapacitate', () => {
    const harness = makeOnlineHunter();
    const targetId = spawnTarget(harness, 700, 8);

    harness.client.castAbilityAt('freezing_trap', { x: 700, z: 8 });
    expect(harness.outbound.at(-1)).toEqual({
      t: 'cmd',
      cmd: 'castAt',
      ability: 'freezing_trap',
      x: 700,
      z: 8,
    });
    expect(harness.server.sim.ctx.groundAoEs).toContainEqual(
      expect.objectContaining({ ability: 'Freezing Trap', radius: 1.5 }),
    );
    const trap = [...harness.server.sim.entities.values()].find(
      (entity) => entity.templateId === 'hunter_freezing_trap',
    );
    const groundY = harness.server.sim.groundPos(700, 8).y;
    expect(trap).toEqual(
      expect.objectContaining({
        kind: 'object',
        lootable: false,
        pos: { x: 700, y: groundY, z: 8 },
      }),
    );
    broadcast(harness.server);
    expect(remoteEntity(lastSnapshot(harness.serverSocket), trap!.id)).toEqual(
      expect.objectContaining({ k: 'object', tid: 'hunter_freezing_trap', y: groundY }),
    );
    expect(harness.client.entities.get(trap!.id)).toEqual(
      expect.objectContaining({
        kind: 'object',
        templateId: 'hunter_freezing_trap',
        pos: { x: 700, y: groundY, z: 8 },
      }),
    );

    advance(harness.server);
    expect(harness.server.sim.entities.get(targetId)?.auras).toContainEqual(
      expect.objectContaining({
        id: 'freezing_trap',
        kind: 'incapacitate',
        remaining: expect.closeTo(59.95, 4),
        duration: 60,
      }),
    );
    expect(remoteEntity(lastSnapshot(harness.serverSocket), targetId).auras).toContainEqual(
      expect.objectContaining({
        id: 'freezing_trap',
        kind: 'incapacitate',
        rem: 59.95,
        dur: 60,
      }),
    );
    expect(harness.client.entities.get(targetId)?.auras).toContainEqual(
      expect.objectContaining({
        id: 'freezing_trap',
        kind: 'incapacitate',
        remaining: 59.95,
        duration: 60,
      }),
    );
    expect(harness.server.sim.entities.has(trap!.id)).toBe(false);
    expect(harness.client.entities.has(trap!.id)).toBe(false);
  });
});

describe('Marksmanship Hunter online', () => {
  it('mirrors the complete selected spec kit into ClientWorld', () => {
    const harness = makeOnlineHunter();
    expect(harness.client.known.map((known) => known.def.id)).toEqual(
      expect.arrayContaining([
        'steady_shot',
        'explosive_shot',
        'aimed_shot',
        'rapid_fire',
        'multi_shot',
        'trueshot',
        'powerful_shot',
        'kill_shot',
      ]),
    );
  });

  it('mirrors the Survival-only melee kit and removes retired abilities', () => {
    const harness = makeOnlineHunter();
    const marksmanshipKnown = harness.client.known.map((known) => known.def.id);
    for (const abilityId of [
      'raptor_strike',
      'mongoose_bite',
      'aspect_of_the_monkey',
      'trueshot_aura',
    ]) {
      expect(marksmanshipKnown, `Marksmanship excludes ${abilityId}`).not.toContain(abilityId);
    }

    harness.client.setSpec('survival');
    expect(harness.server.sim.meta(harness.session.pid)?.talents.spec).toBe('survival');
    broadcast(harness.server);
    const survivalKnown = harness.client.known.map((known) => known.def.id);
    expect(survivalKnown).toEqual(expect.arrayContaining(['raptor_strike', 'mongoose_bite']));
    expect(survivalKnown).not.toContain('aspect_of_the_monkey');
    expect(survivalKnown).not.toContain('trueshot_aura');
  });

  it('replicates Lock and Load and Deathblow through their real attack paths', () => {
    const harness = makeOnlineHunter();
    const targetId = spawnTarget(harness, 700, 20);
    const sim = harness.server.sim as any;
    const hunter = harness.server.sim.entities.get(harness.session.pid)!;
    const target = harness.server.sim.entities.get(targetId)!;
    target.auras.push({
      id: 'passive_test_stun',
      name: 'Passive Test Stun',
      kind: 'stun',
      remaining: 20,
      duration: 20,
      value: 0,
      sourceId: hunter.id,
      school: 'physical',
    });
    sim.rng.chance = (chance: number) => chance === 0.1;

    harness.client.targetEntity(targetId);
    harness.client.startAutoAttack();
    advanceTicks(harness.server, 100);
    expect(hunter.auras).toContainEqual(
      expect.objectContaining({ id: 'lock_and_load', kind: 'next_cast_free_instant' }),
    );
    expect(harness.client.player.auras).toContainEqual(
      expect.objectContaining({ id: 'lock_and_load', kind: 'next_cast_free_instant' }),
    );

    harness.client.stopAutoAttack();
    hunter.gcdRemaining = 0;
    hunter.cooldowns.delete('aimed_shot');
    hunter.resource = 35;
    harness.client.castAbility('aimed_shot');
    expect(hunter.castingAbility).toBeNull();
    advanceTicks(harness.server, 25);
    expect(hunter.auras).toContainEqual(expect.objectContaining({ id: 'deathblow' }));
    expect(harness.client.player.auras).toContainEqual(
      expect.objectContaining({ id: 'deathblow' }),
    );

    const hpBeforeKillShot = target.hp;
    hunter.gcdRemaining = 0;
    harness.client.castAbility('kill_shot');
    advanceTicks(harness.server, 35);
    expect(target.hp).toBeLessThan(hpBeforeKillShot);
    expect(harness.client.player.auras.some((aura) => aura.id === 'deathblow')).toBe(false);
  });

  it('routes every ordinary Marksmanship cast through ClientWorld and the authoritative server', () => {
    const cases: Array<{ id: string; ticks: number; prepare?: (target: any) => void }> = [
      { id: 'steady_shot', ticks: 70 },
      { id: 'aimed_shot', ticks: 95 },
      { id: 'explosive_shot', ticks: 110 },
      { id: 'rapid_fire', ticks: 75 },
      { id: 'multi_shot', ticks: 10 },
      { id: 'kill_shot', ticks: 35, prepare: (target) => (target.hp = target.maxHp * 0.19) },
    ];

    for (const testCase of cases) {
      const harness = makeOnlineHunter();
      const targetId = spawnTarget(harness, 700, 20);
      const target = harness.server.sim.entities.get(targetId)!;
      target.auras.push({
        id: 'online_test_stun',
        name: 'Online Test Stun',
        kind: 'stun',
        remaining: 20,
        duration: 20,
        value: 0,
        sourceId: harness.session.pid,
        school: 'physical',
      });
      testCase.prepare?.(target);
      const hpBefore = target.hp;
      harness.client.targetEntity(targetId);
      harness.client.castAbility(testCase.id);
      expect(harness.outbound.at(-1)).toEqual({ t: 'cmd', cmd: 'cast', ability: testCase.id });
      let remainingTicks = testCase.ticks;
      if (testCase.id === 'explosive_shot') {
        while (remainingTicks > 0 && !target.auras.some((aura) => aura.id === 'explosive_shot')) {
          advance(harness.server);
          remainingTicks--;
        }
        expect(target.auras).toContainEqual(expect.objectContaining({ id: 'explosive_shot' }));
        expect(target.hp).toBe(hpBefore);
        expect(harness.server.sim.entities.get(harness.session.pid)?.inCombat).toBe(true);
        expect(target.inCombat).toBe(true);
      }
      advanceTicks(harness.server, remainingTicks);
      expect(target.hp, `${testCase.id} damages on the server`).toBeLessThan(hpBefore);
      expect(harness.client.entities.get(targetId)?.hp, `${testCase.id} mirrors damage`).toBe(
        target.hp,
      );
    }

    const trueshot = makeOnlineHunter();
    trueshot.client.castAbility('trueshot');
    advance(trueshot.server);
    expect(trueshot.server.sim.entities.get(trueshot.session.pid)?.auras).toContainEqual(
      expect.objectContaining({ id: 'trueshot', kind: 'trueshot' }),
    );
    expect(trueshot.client.player.auras).toContainEqual(
      expect.objectContaining({ id: 'trueshot', kind: 'trueshot' }),
    );
  });

  it('measures Powershot duration on the server for distinct early and late releases', () => {
    const release = (chargeTicks: number, distance: number) => {
      const harness = makeOnlineHunter();
      const targetId = spawnTarget(harness, 700, distance);
      const target = harness.server.sim.entities.get(targetId)!;
      target.auras.push({
        id: 'online_test_stun',
        name: 'Online Test Stun',
        kind: 'stun',
        remaining: 20,
        duration: 20,
        value: 0,
        sourceId: harness.session.pid,
        school: 'physical',
      });
      harness.server.sim.entities.get(harness.session.pid)!.facing = 0;
      harness.client.castAbility('powerful_shot');
      expect(harness.outbound.at(-1)).toEqual({
        t: 'cmd',
        cmd: 'cast',
        ability: 'powerful_shot',
      });
      advanceTicks(harness.server, chargeTicks);
      harness.client.releaseEmpoweredAbility('powerful_shot');
      expect(harness.outbound.at(-1)).toEqual({
        t: 'cmd',
        cmd: 'releaseEmpowered',
        ability: 'powerful_shot',
      });
      advance(harness.server);
      expect(harness.client.entities.get(targetId)?.hp).toBe(target.hp);
      expect(harness.client.drainEvents()).toContainEqual(
        expect.objectContaining({
          type: 'powerfulShotFx',
          sourceId: harness.session.pid,
          x: 700,
          z: expect.any(Number),
        }),
      );
      expect(harness.server.sim.entities.get(harness.session.pid)?.castingAbility).toBeNull();
      return target.maxHp - target.hp;
    };

    expect(release(5, 20)).toBe(0);
    expect(release(25, 20)).toBeGreaterThan(0);
    expect(release(25, 12)).toBeGreaterThan(release(5, 12));
    expect(release(50, 40)).toBeGreaterThan(0); // authoritative automatic maximum release
  });

  it('keeps partial Powershot damage deterministic between offline and online hosts', () => {
    const harness = makeOnlineHunter();
    const targetId = spawnTarget(harness, 700, 12);
    const onlineTarget = harness.server.sim.entities.get(targetId)!;
    const onlineHunter = harness.server.sim.entities.get(harness.session.pid)!;
    onlineTarget.auras.push({
      id: 'online_parity_stun',
      name: 'Online Parity Stun',
      kind: 'stun',
      remaining: 20,
      duration: 20,
      value: 0,
      sourceId: onlineHunter.id,
      school: 'physical',
    });
    (harness.server.sim as any).rng.chance = () => false;
    (harness.server.sim as any).rng.range = (min: number, max: number) => (min + max) / 2;
    onlineHunter.facing = 0;
    harness.client.castAbility('powerful_shot');
    advanceTicks(harness.server, 25);
    harness.client.releaseEmpoweredAbility('powerful_shot');
    advance(harness.server);
    const onlineDamage = onlineTarget.maxHp - onlineTarget.hp;

    const offline = new Sim({
      seed: harness.server.sim.cfg.seed,
      playerClass: 'hunter',
      autoEquip: false,
    });
    offline.setPlayerLevel(20);
    offline.setSpec('marksmanship');
    offline.applyTalents({
      spec: 'marksmanship',
      rows: { 14: 'hun_r14_multi_shot', 20: 'hun_r20_powershot' },
    });
    offline.player.pos = {
      x: 700,
      y: groundHeight(700, 0, offline.cfg.seed),
      z: 0,
    };
    offline.player.prevPos = { ...offline.player.pos };
    offline.player.facing = 0;
    const offlineTarget = createMob(900_001, MOBS.forest_wolf, 18, offline.groundPos(700, 12));
    offlineTarget.hostile = true;
    offlineTarget.aiState = 'idle';
    offlineTarget.maxHp = 20_000;
    offlineTarget.hp = offlineTarget.maxHp;
    offlineTarget.auras.push({
      id: 'offline_parity_stun',
      name: 'Offline Parity Stun',
      kind: 'stun',
      remaining: 20,
      duration: 20,
      value: 0,
      sourceId: offline.player.id,
      school: 'physical',
    });
    (offline as any).addEntity(offlineTarget);
    (offline as any).rng.chance = () => false;
    (offline as any).rng.range = (min: number, max: number) => (min + max) / 2;
    offline.castAbility('powerful_shot');
    for (let i = 0; i < 25; i++) offline.tick();
    offline.releaseEmpoweredAbility('powerful_shot');

    expect(onlineDamage).toBeGreaterThan(0);
    expect(offlineTarget.maxHp - offlineTarget.hp).toBe(onlineDamage);
  });

  it('uses the latest facing sent by the online client for automatic maximum release', () => {
    const harness = makeOnlineHunter();
    const oldDirectionId = spawnTarget(harness, 700, 12);
    const latestDirectionId = spawnTarget(harness, 725, 0, 900_002);
    const hunter = harness.server.sim.entities.get(harness.session.pid)!;
    for (const targetId of [oldDirectionId, latestDirectionId]) {
      harness.server.sim.entities.get(targetId)!.auras.push({
        id: `powershot_facing_stun_${targetId}`,
        name: 'Powershot Facing Stun',
        kind: 'stun',
        remaining: 20,
        duration: 20,
        value: 0,
        sourceId: hunter.id,
        school: 'physical',
      });
    }
    (harness.server.sim as any).rng.chance = () => false;

    harness.client.setMouselookFacing(0);
    expect(harness.client.flushInput(20)).toBe(true);
    harness.client.castAbility('powerful_shot');
    advanceTicks(harness.server, 25);
    harness.client.setMouselookFacing(Math.PI / 2);
    expect(harness.client.flushInput(40)).toBe(true);
    advanceTicks(harness.server, 25);

    const oldDirection = harness.server.sim.entities.get(oldDirectionId)!;
    const latestDirection = harness.server.sim.entities.get(latestDirectionId)!;
    expect(hunter.castingAbility).toBeNull();
    expect(oldDirection.hp).toBe(oldDirection.maxHp);
    expect(latestDirection.hp).toBeLessThan(latestDirection.maxHp);
    expect(harness.client.entities.get(latestDirectionId)?.hp).toBe(latestDirection.hp);
  });

  it('applies release facing atomically when turning and releasing in the same frame', () => {
    const harness = makeOnlineHunter();
    const oldDirectionId = spawnTarget(harness, 700, 12);
    const releaseDirectionId = spawnTarget(harness, 712, 0, 900_003);
    const hunter = harness.server.sim.entities.get(harness.session.pid)!;
    for (const targetId of [oldDirectionId, releaseDirectionId]) {
      harness.server.sim.entities.get(targetId)!.auras.push({
        id: `powershot_atomic_facing_stun_${targetId}`,
        name: 'Powershot Atomic Facing Stun',
        kind: 'stun',
        remaining: 20,
        duration: 20,
        value: 0,
        sourceId: hunter.id,
        school: 'physical',
      });
    }
    (harness.server.sim as any).rng.chance = () => false;
    hunter.facing = 0;

    harness.client.castAbility('powerful_shot');
    advanceTicks(harness.server, 25);
    harness.client.setMouselookFacing(Math.PI / 2);
    expect(harness.client.flushInput(50)).toBe(true);
    harness.client.releaseEmpoweredAbility('powerful_shot');
    expect(harness.outbound.at(-1)).toEqual({
      t: 'cmd',
      cmd: 'releaseEmpowered',
      ability: 'powerful_shot',
    });
    advance(harness.server);

    const oldDirection = harness.server.sim.entities.get(oldDirectionId)!;
    const releaseDirection = harness.server.sim.entities.get(releaseDirectionId)!;
    expect(hunter.facing).toBe(Math.PI / 2);
    expect(oldDirection.hp).toBe(oldDirection.maxHp);
    expect(releaseDirection.hp).toBeLessThan(releaseDirection.maxHp);
    expect(harness.client.entities.get(releaseDirectionId)?.hp).toBe(releaseDirection.hp);
  });
});
