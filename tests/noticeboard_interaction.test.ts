// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { objectDisplayName } from '../src/render/entity_labels';
import { colliderInternalsForTest } from '../src/sim/colliders';
import { noticeboardDefByEntityId } from '../src/sim/content/noticeboards';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import { Sim } from '../src/sim/sim';
import {
  assertCanonicalEastbrookNoticeboardDef,
  EASTBROOK_NOTICEBOARD_ASSET_ID,
  EASTBROOK_NOTICEBOARD_INTERACTION_RADIUS,
  EASTBROOK_NOTICEBOARD_NATIVE_DIMENSIONS,
  EASTBROOK_NOTICEBOARD_TEMPLATE_ID,
  type Entity,
  emptyZoneProps,
  INTERACT_RANGE,
  type NoticeboardDef,
  type SimEvent,
  type WorldContent,
} from '../src/sim/types';
import { Hud } from '../src/ui/hud';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';

const SEED = 20_061;
const EMPTY_NOTICEBOARD_EVENT = {
  type: 'noticeboard',
  noticeboardId: 'noticeboard_eastbrook',
  state: 'empty',
} as const;

function canonicalCustomNoticeboard(): NoticeboardDef {
  return {
    id: 'custom_noticeboard',
    entityId: 2_000_000_002,
    templateId: EASTBROOK_NOTICEBOARD_TEMPLATE_ID,
    assetId: EASTBROOK_NOTICEBOARD_ASSET_ID,
    name: 'Custom Notice Board',
    x: 118,
    z: -76,
    rotation: 0.25,
    ...EASTBROOK_NOTICEBOARD_NATIVE_DIMENSIONS,
    interactionRadius: EASTBROOK_NOTICEBOARD_INTERACTION_RADIUS,
    frontStandingPoint: { x: 118, z: -74.5 },
  };
}

function noticeboard(sim: Sim, templateId = 'noticeboard_eastbrook'): Entity {
  const entity = [...sim.entities.values()].find(
    (candidate) => candidate.kind === 'object' && candidate.templateId === templateId,
  );
  if (!entity) throw new Error(`missing noticeboard entity ${templateId}`);
  return entity;
}

function standAt(sim: Sim, pid: number, point: { x: number; z: number }): Entity {
  const player = sim.entities.get(pid);
  if (!player) throw new Error(`missing player ${pid}`);
  player.pos = sim.groundPos(point.x, point.z);
  player.prevPos = { ...player.pos };
  sim.rebucket(player);
  return player;
}

function customWorld(): WorldContent {
  return {
    zones: BUILTIN_WORLD.zones,
    camps: [],
    npcs: {},
    groundObjects: [],
    roads: [],
    props: emptyZoneProps(),
    playerStart: { x: 120, z: -80 },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  setActiveWorldContent(null);
  setLanguage('en');
});

describe('active-world noticeboard service', () => {
  it('adds the exact stable-id board without perturbing the allocator, established roster, or RNG', () => {
    const servicesWithoutBoard = {
      ...BUILTIN_WORLD.services,
      noticeboards: [],
    };
    const worldWithoutBoard: WorldContent = {
      ...BUILTIN_WORLD,
      services: servicesWithoutBoard,
    };
    setActiveWorldContent(worldWithoutBoard);
    const withoutBoard = new Sim({
      seed: SEED,
      playerClass: 'warrior',
      noPlayer: true,
      world: worldWithoutBoard,
    });
    setActiveWorldContent(null);
    const withBoard = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const board = noticeboard(withBoard);

    expect(board).toMatchObject({
      id: EASTBROOK_LAYOUT.services.noticeboard.entityId,
      kind: 'object',
      templateId: 'noticeboard_eastbrook',
      name: 'Notice Board',
      objectItemId: null,
      lootable: true,
      facing: -0.7853981633974483,
      prevFacing: -0.7853981633974483,
    });
    expect({ x: board.pos.x, z: board.pos.z }).toEqual({ x: 10, z: -8 });
    expect(withBoard.nextId).toBe(withoutBoard.nextId);

    const stableProjection = (sim: Sim) =>
      [...sim.entities.values()]
        .filter((entity) => entity.templateId !== 'noticeboard_eastbrook')
        .map((entity) => ({
          id: entity.id,
          kind: entity.kind,
          templateId: entity.templateId,
          pos: entity.pos,
          facing: entity.facing,
        }));
    expect(stableProjection(withBoard)).toEqual(stableProjection(withoutBoard));
    expect(withBoard.rng.next()).toBe(withoutBoard.rng.next());
  });

  it('emits personal localized-feedback events through direct, target, and proximity interaction', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const first = sim.addPlayer('warrior', 'First');
    const board = noticeboard(sim);
    const player = standAt(sim, first, EASTBROOK_LAYOUT.services.noticeboard.frontStandingPoint);

    sim.drainEvents();
    expect(sim.pickUpObject(board.id, first)).toBe(true);
    expect(sim.drainEvents()).toEqual([{ ...EMPTY_NOTICEBOARD_EVENT, pid: first }]);
    expect(board).toMatchObject({ lootable: true, objectItemId: null });

    player.targetId = board.id;
    sim.interact(first);
    expect(sim.drainEvents()).toEqual([{ ...EMPTY_NOTICEBOARD_EVENT, pid: first }]);

    player.targetId = null;
    sim.interact(first);
    expect(sim.drainEvents()).toEqual([{ ...EMPTY_NOTICEBOARD_EVENT, pid: first }]);
  });

  it('keeps proximity F on nearby service NPCs instead of the permanently lootable board', () => {
    const boardLayout = EASTBROOK_LAYOUT.services.noticeboard;
    const protectedAnchors = [
      ...EASTBROOK_LAYOUT.services.npcs.map((npc) => ({ id: npc.id, position: npc.position })),
      ...EASTBROOK_LAYOUT.services.stations.map((station) => ({
        id: station.id,
        position: station.position,
      })),
      {
        id: EASTBROOK_LAYOUT.services.mailbox.id,
        position: EASTBROOK_LAYOUT.services.mailbox.position,
      },
    ];
    for (const anchor of protectedAnchors) {
      expect(
        Math.hypot(
          boardLayout.position.x - anchor.position.x,
          boardLayout.position.z - anchor.position.z,
        ),
        `${anchor.id} is in range of the noticeboard body`,
      ).toBeGreaterThan(INTERACT_RANGE);
      expect(
        Math.hypot(
          boardLayout.frontStandingPoint.x - anchor.position.x,
          boardLayout.frontStandingPoint.z - anchor.position.z,
        ),
        `${anchor.id} is in range of the noticeboard standing point`,
      ).toBeGreaterThan(INTERACT_RANGE);
    }

    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Service Visitor');
    const board = noticeboard(sim);
    const serviceNpcIds = new Set(EASTBROOK_LAYOUT.services.npcs.map((npc) => npc.id));
    const nearestService = [...sim.entities.values()]
      .filter((entity) => entity.kind === 'npc' && serviceNpcIds.has(entity.templateId))
      .sort(
        (left, right) =>
          Math.hypot(left.pos.x - board.pos.x, left.pos.z - board.pos.z) -
          Math.hypot(right.pos.x - board.pos.x, right.pos.z - board.pos.z),
      )[0];
    if (!nearestService) throw new Error('missing service NPC near noticeboard');
    expect(nearestService.templateId).toBe('tinker_gizzel');
    expect(Math.hypot(nearestService.pos.x - board.pos.x, nearestService.pos.z - board.pos.z)).toBe(
      6.553027797228726,
    );

    const talkToNpc = vi.spyOn(sim, 'talkToNpc');
    const player = standAt(sim, pid, nearestService.pos);
    player.targetId = null;
    sim.drainEvents();
    sim.interact(pid);
    expect(talkToNpc).toHaveBeenCalledWith(nearestService.id, pid);
    expect(sim.drainEvents()).not.toContainEqual(expect.objectContaining({ type: 'noticeboard' }));
  });

  it('localizes the object label and the empty-board feedback from structured keys', () => {
    setLanguage('en');
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const board = noticeboard(sim);
    expect(objectDisplayName(board)).toBe('Notice Board');
    expect(t('hudChrome.noticeboard.empty')).toBe('Nothing seems posted.');
  });

  it('routes the structured event through the HUD localized empty-board log branch', () => {
    const source = readFileSync('src/ui/hud.ts', 'utf8');
    const handleEventsAt = source.indexOf('handleEvents(events: SimEvent[]): void {');
    const noticeboardCaseAt = source.indexOf("case 'noticeboard':", handleEventsAt);
    const nextCaseAt = source.indexOf("case 'mailArrived':", noticeboardCaseAt);
    expect(handleEventsAt).toBeGreaterThan(-1);
    expect(noticeboardCaseAt).toBeGreaterThan(handleEventsAt);
    expect(nextCaseAt).toBeGreaterThan(noticeboardCaseAt);
    const branch = source.slice(noticeboardCaseAt, nextCaseAt);
    const resolveAt = branch.indexOf("const message = t('hudChrome.noticeboard.empty');");
    const bannerAt = branch.indexOf('this.showBanner(message);');
    const logAt = branch.indexOf("this.log(message, '#c8b98f');");
    expect(resolveAt).toBeGreaterThan(-1);
    expect(bannerAt).toBeGreaterThan(resolveAt);
    expect(logAt).toBeGreaterThan(bannerAt);
    expect(branch).not.toContain('Nothing seems posted.');
  });

  it('renders the personal event once as the same localized transient banner and durable log', async () => {
    interface NoticeboardHudHarness {
      sim: {
        playerId: number;
        craftingIdentity: { synced: boolean };
        craftSkills: Record<string, number>;
        gatheringProficiency: Record<string, number>;
      };
      renderer: { handleEvent: ReturnType<typeof vi.fn> };
      playEventSfx: ReturnType<typeof vi.fn>;
      meters: { onEvent: ReturnType<typeof vi.fn> };
      isNythraxisEvent: ReturnType<typeof vi.fn>;
      showBanner: ReturnType<typeof vi.fn>;
      log: ReturnType<typeof vi.fn>;
      prevCraftSkills: Record<string, number> | null;
      craftTierUpDrains: number;
      handleEvents(events: SimEvent[]): void;
    }

    const hud = Object.create(Hud.prototype) as unknown as NoticeboardHudHarness;
    hud.sim = {
      playerId: 17,
      craftingIdentity: { synced: false },
      craftSkills: {},
      gatheringProficiency: {},
    };
    hud.renderer = { handleEvent: vi.fn() };
    hud.playEventSfx = vi.fn();
    hud.meters = { onEvent: vi.fn() };
    hud.isNythraxisEvent = vi.fn(() => false);
    hud.showBanner = vi.fn();
    hud.log = vi.fn();
    hud.prevCraftSkills = null;
    hud.craftTierUpDrains = 0;

    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    hud.handleEvents([{ ...EMPTY_NOTICEBOARD_EVENT, pid: 17 }]);

    const message = t('hudChrome.noticeboard.empty');
    expect(message).toBe('何も貼られていないようだ。');
    expect(hud.showBanner).toHaveBeenCalledTimes(1);
    expect(hud.showBanner).toHaveBeenCalledWith(message);
    expect(hud.log).toHaveBeenCalledTimes(1);
    expect(hud.log).toHaveBeenCalledWith(message, '#c8b98f');
    expect(hud.renderer.handleEvent).toHaveBeenCalledWith({
      ...EMPTY_NOTICEBOARD_EVENT,
      pid: 17,
    });
  });

  it('keeps the normal range and dead-player gates without consuming the board', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Reader');
    const board = noticeboard(sim);
    const player = standAt(sim, pid, {
      x: board.pos.x + INTERACT_RANGE + 1,
      z: board.pos.z,
    });

    sim.drainEvents();
    expect(sim.pickUpObject(board.id, pid)).toBe(false);
    expect(sim.drainEvents()).toContainEqual({ type: 'error', text: 'Too far away.', pid });
    expect(board.lootable).toBe(true);

    standAt(sim, pid, EASTBROOK_LAYOUT.services.noticeboard.frontStandingPoint);
    player.dead = true;
    player.hp = 0;
    expect(sim.pickUpObject(board.id, pid)).toBe(false);
    expect(sim.drainEvents()).toContainEqual({
      type: 'error',
      text: "You can't do that while dead.",
      pid,
    });
    expect(board.lootable).toBe(true);
  });

  it('isolates spawn and static collision to the active custom-world service record', () => {
    const empty = customWorld();
    setActiveWorldContent(empty);
    const absent = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true, world: empty });
    expect(
      [...absent.entities.values()].some((entity) => entity.templateId === 'noticeboard_eastbrook'),
    ).toBe(false);
    expect(
      colliderInternalsForTest
        .staticWorldColliders(SEED)
        .some((collider) => collider.type === 'obb' && collider.x === 10 && collider.z === -8),
    ).toBe(false);

    const boardDef = canonicalCustomNoticeboard();
    const custom: WorldContent = { ...empty, services: { noticeboards: [boardDef] } };
    setActiveWorldContent(custom);
    const present = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true, world: custom });
    const board = noticeboard(present);
    expect(board).toMatchObject({
      id: 2_000_000_002,
      name: 'Custom Notice Board',
      facing: 0.25,
      objectItemId: null,
      lootable: true,
    });
    expect({ x: board.pos.x, z: board.pos.z }).toEqual({ x: 118, z: -76 });
    expect(colliderInternalsForTest.staticWorldColliders(SEED)).toContainEqual({
      type: 'obb',
      x: 118,
      z: -76,
      hw: 1.2,
      hd: 0.3,
      rot: 0.25,
      cameraTopY: present.groundPos(118, -76).y + 2.6,
    });
  });

  it('resolves only the matched active-world definition through the canonical lookup', () => {
    const definition = canonicalCustomNoticeboard();
    expect(noticeboardDefByEntityId([definition], definition.entityId)).toBe(definition);
    expect(noticeboardDefByEntityId([definition], definition.entityId + 1)).toBeNull();
  });

  it.each([
    ['templateId', 'unsupported_noticeboard'],
    ['assetId', '/custom/noticeboard.glb'],
    ['width', 2.5],
    ['depth', 0.7],
    ['height', 2.7],
    ['interactionRadius', 5],
  ] as const)('fails closed on an unsupported canonical %s', (field, unsupported) => {
    const invalid = {
      ...canonicalCustomNoticeboard(),
      [field]: unsupported,
    } as unknown as NoticeboardDef;
    expect(() => assertCanonicalEastbrookNoticeboardDef(invalid)).toThrow(
      `Invalid canonical Eastbrook noticeboard ${field}`,
    );
    expect(() => noticeboardDefByEntityId([invalid], invalid.entityId)).toThrow(
      `Invalid canonical Eastbrook noticeboard ${field}`,
    );

    const world: WorldContent = {
      ...customWorld(),
      services: { noticeboards: [invalid] },
    };
    setActiveWorldContent(world);
    expect(() => new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true, world })).toThrow(
      `Invalid canonical Eastbrook noticeboard ${field}`,
    );
  });

  it.each([
    ['id', (definition: NoticeboardDef) => ({ ...definition, id: '' })],
    ['name', (definition: NoticeboardDef) => ({ ...definition, name: '' })],
    ['entityId', (definition: NoticeboardDef) => ({ ...definition, entityId: 0 })],
    ['x', (definition: NoticeboardDef) => ({ ...definition, x: Number.NaN })],
    ['z', (definition: NoticeboardDef) => ({ ...definition, z: Number.POSITIVE_INFINITY })],
    ['rotation', (definition: NoticeboardDef) => ({ ...definition, rotation: Number.NaN })],
    [
      'frontStandingPoint.x',
      (definition: NoticeboardDef) => ({
        ...definition,
        frontStandingPoint: { ...definition.frontStandingPoint, x: Number.NaN },
      }),
    ],
    [
      'frontStandingPoint.z',
      (definition: NoticeboardDef) => ({
        ...definition,
        frontStandingPoint: {
          ...definition.frontStandingPoint,
          z: Number.POSITIVE_INFINITY,
        },
      }),
    ],
  ] as const)('fails closed independently on invalid authored %s metadata', (field, mutate) => {
    const invalid = mutate(canonicalCustomNoticeboard());
    expect(() => assertCanonicalEastbrookNoticeboardDef(invalid)).toThrow(
      `Invalid canonical Eastbrook noticeboard ${field}`,
    );
  });

  it.each([
    ['non-record definition', 'definition', (_definition: NoticeboardDef): unknown => null],
    [
      'non-record front standing point',
      'frontStandingPoint',
      (definition: NoticeboardDef): unknown => ({ ...definition, frontStandingPoint: null }),
    ],
    ['non-string id', 'id', (definition: NoticeboardDef): unknown => ({ ...definition, id: 7 })],
    [
      'non-string name',
      'name',
      (definition: NoticeboardDef): unknown => ({ ...definition, name: null }),
    ],
    [
      'non-number entity id',
      'entityId',
      (definition: NoticeboardDef): unknown => ({ ...definition, entityId: '2000000002' }),
    ],
    [
      'unsafe entity id',
      'entityId',
      (definition: NoticeboardDef): unknown => ({
        ...definition,
        entityId: Number.MAX_SAFE_INTEGER + 1,
      }),
    ],
    [
      'non-integer entity id',
      'entityId',
      (definition: NoticeboardDef): unknown => ({ ...definition, entityId: 2_000_000_002.5 }),
    ],
  ] as const)('fails closed on strict %s predicates', (_case, field, mutate) => {
    expect(() =>
      assertCanonicalEastbrookNoticeboardDef(mutate(canonicalCustomNoticeboard())),
    ).toThrow(`Invalid canonical Eastbrook noticeboard ${field}`);
  });

  it('uses active-only noticeboard authority in both cfg/active mismatch directions', () => {
    const empty = customWorld();
    const definition = canonicalCustomNoticeboard();
    const withBoard: WorldContent = {
      ...empty,
      services: { noticeboards: [definition] },
    };
    const customCollider = () =>
      colliderInternalsForTest
        .staticWorldColliders(SEED)
        .find(
          (collider) =>
            collider.type === 'obb' &&
            collider.x === definition.x &&
            collider.z === definition.z &&
            collider.rot === definition.rotation,
        );

    setActiveWorldContent(empty);
    const cfgOnly = new Sim({
      seed: SEED,
      playerClass: 'warrior',
      noPlayer: true,
      world: withBoard,
    });
    expect([...cfgOnly.entities.values()].some((entity) => entity.id === definition.entityId)).toBe(
      false,
    );
    expect(customCollider()).toBeUndefined();

    setActiveWorldContent(withBoard);
    const activeOnly = new Sim({
      seed: SEED,
      playerClass: 'warrior',
      noPlayer: true,
      world: empty,
    });
    expect(activeOnly.entities.get(definition.entityId)).toMatchObject({
      kind: 'object',
      templateId: EASTBROOK_NOTICEBOARD_TEMPLATE_ID,
      lootable: true,
    });
    expect(customCollider()).toMatchObject({
      type: 'obb',
      x: definition.x,
      z: definition.z,
      hw: definition.width / 2,
      hd: definition.depth / 2,
      rot: definition.rotation,
    });
  });

  it('fails closed when two active definitions collide on a noticeboard entity id', () => {
    const definition = canonicalCustomNoticeboard();
    const world: WorldContent = {
      ...customWorld(),
      services: {
        noticeboards: [definition, { ...definition, id: 'duplicate_noticeboard' }],
      },
    };
    setActiveWorldContent(world);
    expect(() => new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true, world })).toThrow(
      `Duplicate noticeboard entity id: ${definition.entityId}`,
    );
  });

  it.each(['direct pickup', 'targeted F', 'proximity F'] as const)(
    'uses the inclusive authored radius boundary for %s',
    (path) => {
      const epsilon = 0.001;
      for (const [distance, succeeds] of [
        [EASTBROOK_NOTICEBOARD_INTERACTION_RADIUS - epsilon, true],
        [EASTBROOK_NOTICEBOARD_INTERACTION_RADIUS, true],
        [EASTBROOK_NOTICEBOARD_INTERACTION_RADIUS + epsilon, false],
      ] as const) {
        const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
        const pid = sim.addPlayer('warrior', `${path} ${distance}`);
        const board = noticeboard(sim);
        const player = standAt(sim, pid, { x: board.pos.x + distance, z: board.pos.z });
        sim.drainEvents();

        if (path === 'direct pickup') {
          expect(sim.pickUpObject(board.id, pid), `${path} at ${distance}`).toBe(succeeds);
        } else {
          player.targetId = path === 'targeted F' ? board.id : null;
          sim.interact(pid);
        }

        const noticeEvents = sim.drainEvents().filter((event) => event.type === 'noticeboard');
        expect(noticeEvents, `${path} at ${distance}`).toEqual(
          succeeds ? [{ ...EMPTY_NOTICEBOARD_EVENT, pid }] : [],
        );
      }
    },
  );

  it('does not let a board outside its radius mask a valid nearer proximity interaction', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Nearby Visitor');
    const board = noticeboard(sim);
    const playerPoint = {
      x: board.pos.x + EASTBROOK_NOTICEBOARD_INTERACTION_RADIUS + 0.5,
      z: board.pos.z,
    };
    const player = standAt(sim, pid, playerPoint);
    player.targetId = null;

    const npc = [...sim.entities.values()].find(
      (entity) => entity.kind === 'npc' && entity.templateId === 'tinker_gizzel',
    );
    if (!npc) throw new Error('missing tinker_gizzel fixture');
    npc.pos = sim.groundPos(playerPoint.x + 0.25, playerPoint.z);
    npc.prevPos = { ...npc.pos };
    sim.rebucket(npc);

    const talkToNpc = vi.spyOn(sim, 'talkToNpc');
    sim.drainEvents();
    sim.interact(pid);
    expect(talkToNpc).toHaveBeenCalledTimes(1);
    expect(talkToNpc).toHaveBeenCalledWith(npc.id, pid);
    expect(sim.drainEvents()).not.toContainEqual(expect.objectContaining({ type: 'noticeboard' }));
  });
});
