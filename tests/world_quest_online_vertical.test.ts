// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadAccountFlair: vi.fn(async () => ({
    ai: false,
    streamer: false,
    links: {},
  })),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
  })),
  grantAccountMechChroma: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
  })),
  revokeAccountMechChroma: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
  })),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { ClientWorld } from '../src/net/online';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { hasWorldQuestDeliveryCargo } from '../src/sim/world_quest_delivery';
import { joinGroundTruthCharacter, teleportEntity } from './helpers/movement_ground_truth';

class CapturingWebSocket {
  static readonly OPEN = 1;
  static instances: CapturingWebSocket[] = [];
  readyState = CapturingWebSocket.OPEN;
  bufferedAmount = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    CapturingWebSocket.instances.push(this);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = 3;
  }
}

describe('online world-quest command path', () => {
  afterEach(() => {
    CapturingWebSocket.instances = [];
    vi.unstubAllGlobals();
  });

  it('carries pickup, delivery, match-three swap/reset, and beam rotation through the online stack', async () => {
    vi.stubGlobal('WebSocket', CapturingWebSocket);
    const joined = joinGroundTruthCharacter(81);
    const quest = WORLD_QUESTS_BY_ID.wq_palmreach_confections;
    if (quest.objective.type !== 'match3') throw new Error('Expected match-three fixture');
    const activationObjectItemId = quest.objective.activationObjectItemId;
    const player = joined.server.sim.entities.get(joined.pid);
    if (!player) throw new Error('Missing joined player');
    joined.server.sim.setPlayerLevel(20, joined.pid);
    joined.server.sim.resetDay = '2026-08-31';
    teleportEntity(player, quest.area.x, quest.area.z, joined.server.sim.cfg.seed);
    joined.server.sim.ctx.rebucket(player);
    joined.server.sim.tick();
    const activator = [...joined.server.sim.entities.values()].find(
      (entity) => entity.objectItemId === activationObjectItemId,
    );
    if (!activator) throw new Error('Missing confection game box');
    teleportEntity(player, activator.pos.x, activator.pos.z, joined.server.sim.cfg.seed);
    joined.server.sim.ctx.rebucket(player);

    const client = new ClientWorld('token', 81, 'warrior', 'http://localhost');
    const socket = CapturingWebSocket.instances[0];
    const wire = client as unknown as { onMessage(raw: string): void };
    wire.onMessage(JSON.stringify({ t: 'hello', pid: joined.pid, seed: 42 }));
    socket.sent.length = 0;

    const pickup = client.pickUpObject(activator.id);
    const pickupFrame = socket.sent.pop();
    if (!pickupFrame) throw new Error('Client did not send pickup command');
    joined.server.handleMessage(joined.session, pickupFrame);
    const outcome = joined.client.sent
      .map((raw) => JSON.parse(raw) as { t?: string })
      .reverse()
      .find((frame) => frame.t === 'commandOutcome');
    if (!outcome) throw new Error('Server did not answer pickup command');
    wire.onMessage(JSON.stringify(outcome));
    expect(await pickup).toBe(true);
    expect(joined.server.sim.meta(joined.pid)?.openWorldQuestPuzzleId).toBe(quest.id);

    client.swapWorldQuestMatch3Tiles(quest.id, 2, 3);
    const swapFrame = socket.sent.pop();
    if (!swapFrame) throw new Error('Client did not send match-three command');
    joined.server.handleMessage(joined.session, swapFrame);
    expect(joined.server.sim.meta(joined.pid)?.worldQuestLog.get(quest.id)).toMatchObject({
      count: 3,
      match3Moves: 1,
    });

    client.resetWorldQuestMatch3(quest.id);
    const resetFrame = socket.sent.pop();
    if (!resetFrame) throw new Error('Client did not send match-three reset command');
    joined.server.handleMessage(joined.session, resetFrame);
    expect(joined.server.sim.meta(joined.pid)?.worldQuestLog.get(quest.id)).toMatchObject({
      count: 0,
      match3Moves: 0,
      match3RefillIndex: 0,
    });

    const beamQuest = WORLD_QUESTS_BY_ID.wq_galecrest_wisps;
    if (beamQuest.objective.type !== 'puzzle') throw new Error('Expected beam puzzle fixture');
    const beamActivationObjectItemId = beamQuest.objective.activationObjectItemId;
    teleportEntity(player, beamQuest.area.x, beamQuest.area.z, joined.server.sim.cfg.seed);
    joined.server.sim.ctx.rebucket(player);
    joined.server.sim.tick();
    const beamActivator = [...joined.server.sim.entities.values()].find(
      (entity) => entity.objectItemId === beamActivationObjectItemId,
    );
    if (!beamActivator) throw new Error('Missing miniature ley cache');
    teleportEntity(player, beamActivator.pos.x, beamActivator.pos.z, joined.server.sim.cfg.seed);
    joined.server.sim.ctx.rebucket(player);

    const beamPickup = client.pickUpObject(beamActivator.id);
    const beamPickupFrame = socket.sent.pop();
    if (!beamPickupFrame) throw new Error('Client did not send beam pickup command');
    joined.server.handleMessage(joined.session, beamPickupFrame);
    const beamOutcome = joined.client.sent
      .map((raw) => JSON.parse(raw) as { t?: string })
      .reverse()
      .find((frame) => frame.t === 'commandOutcome');
    if (!beamOutcome) throw new Error('Server did not answer beam pickup command');
    wire.onMessage(JSON.stringify(beamOutcome));
    expect(await beamPickup).toBe(true);

    const rotationsBefore = [
      ...(joined.server.sim.meta(joined.pid)?.worldQuestLog.get(beamQuest.id)?.puzzleRotations ??
        []),
    ];
    client.rotateWorldQuestPuzzleTile(beamQuest.id, 0);
    const rotateFrame = socket.sent.pop();
    if (!rotateFrame) throw new Error('Client did not send beam rotation command');
    joined.server.handleMessage(joined.session, rotateFrame);
    const rotationsAfter = joined.server.sim
      .meta(joined.pid)
      ?.worldQuestLog.get(beamQuest.id)?.puzzleRotations;
    expect(rotationsAfter?.[0]).toBe(((rotationsBefore[0] ?? 0) + 1) % 4);

    const deliveryQuest = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    if (deliveryQuest.objective.type !== 'delivery') {
      throw new Error('Expected delivery fixture');
    }
    const deliveryObjective = deliveryQuest.objective;
    teleportEntity(player, deliveryQuest.area.x, deliveryQuest.area.z, joined.server.sim.cfg.seed);
    joined.server.sim.ctx.rebucket(player);
    joined.server.sim.tick();
    const freightCrate = [...joined.server.sim.entities.values()].find(
      (entity) => entity.objectItemId === deliveryObjective.pickupObjectItemId,
    );
    const freightWagon = [...joined.server.sim.entities.values()].find(
      (entity) => entity.objectItemId === deliveryObjective.deliveryObjectItemId,
    );
    if (!freightCrate || !freightWagon) throw new Error('Missing freight fixtures');

    teleportEntity(player, freightCrate.pos.x, freightCrate.pos.z, joined.server.sim.cfg.seed);
    joined.server.sim.ctx.rebucket(player);
    const freightPickup = client.pickUpObject(freightCrate.id);
    const freightPickupFrame = socket.sent.pop();
    if (!freightPickupFrame) throw new Error('Client did not send freight pickup command');
    joined.server.handleMessage(joined.session, freightPickupFrame);
    const freightPickupOutcome = joined.client.sent
      .map((raw) => JSON.parse(raw) as { t?: string })
      .reverse()
      .find((frame) => frame.t === 'commandOutcome');
    if (!freightPickupOutcome) throw new Error('Server did not answer freight pickup command');
    wire.onMessage(JSON.stringify(freightPickupOutcome));
    expect(await freightPickup).toBe(true);
    expect(hasWorldQuestDeliveryCargo(player)).toBe(true);

    teleportEntity(player, freightWagon.pos.x, freightWagon.pos.z, joined.server.sim.cfg.seed);
    joined.server.sim.ctx.rebucket(player);
    const freightDelivery = client.pickUpObject(freightWagon.id);
    const freightDeliveryFrame = socket.sent.pop();
    if (!freightDeliveryFrame) throw new Error('Client did not send freight delivery command');
    joined.server.handleMessage(joined.session, freightDeliveryFrame);
    const freightDeliveryOutcome = joined.client.sent
      .map((raw) => JSON.parse(raw) as { t?: string })
      .reverse()
      .find((frame) => frame.t === 'commandOutcome');
    if (!freightDeliveryOutcome) throw new Error('Server did not answer freight delivery command');
    wire.onMessage(JSON.stringify(freightDeliveryOutcome));
    expect(await freightDelivery).toBe(true);
    expect(hasWorldQuestDeliveryCargo(player)).toBe(false);
    expect(joined.server.sim.meta(joined.pid)?.worldQuestLog.get(deliveryQuest.id)?.count).toBe(1);

    teleportEntity(player, freightCrate.pos.x, freightCrate.pos.z, joined.server.sim.cfg.seed);
    joined.server.sim.ctx.rebucket(player);
    const disconnectPickup = client.pickUpObject(freightCrate.id);
    const disconnectPickupFrame = socket.sent.pop();
    if (!disconnectPickupFrame) throw new Error('Client did not send disconnect pickup command');
    joined.server.handleMessage(joined.session, disconnectPickupFrame);
    const disconnectPickupOutcome = joined.client.sent
      .map((raw) => JSON.parse(raw) as { t?: string })
      .reverse()
      .find((frame) => frame.t === 'commandOutcome');
    if (!disconnectPickupOutcome)
      throw new Error('Server did not answer disconnect pickup command');
    wire.onMessage(JSON.stringify(disconnectPickupOutcome));
    expect(await disconnectPickup).toBe(true);
    expect(hasWorldQuestDeliveryCargo(player)).toBe(true);

    joined.client.ws.readyState = 3;
    expect(joined.server.socketClosed(joined.session, joined.client.ws)).toBe(true);
    expect(hasWorldQuestDeliveryCargo(player)).toBe(false);
    expect(joined.server.sim.meta(joined.pid)?.worldQuestLog.get(deliveryQuest.id)?.count).toBe(1);

    client.close();
    await joined.server.leave(joined.session, 'test complete');
  });
});
