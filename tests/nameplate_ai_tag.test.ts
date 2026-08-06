// @vitest-environment happy-dom

import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NameplateCanvasState } from '../src/render/nameplate_canvas';
import { NameplatePainter } from '../src/render/nameplate_painter';
import { FRIENDLY } from '../src/render/reaction';
import type { EntityView } from '../src/render/renderer';
import type { Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const VIEWPORT = { width: 1280, height: 720 };

function fakeContext(): CanvasRenderingContext2D {
  const noop = vi.fn();
  return {
    setTransform: noop,
    scale: noop,
    translate: noop,
    clearRect: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    rect: noop,
    clip: noop,
    fill: noop,
    stroke: noop,
    drawImage: noop,
    fillText: noop,
    strokeText: noop,
    measureText: (text: string) => ({
      width: text.length * 7,
      actualBoundingBoxLeft: (text.length * 7) / 2,
      actualBoundingBoxRight: (text.length * 7) / 2,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 3,
    }),
  } as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext());
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,raid');
});

function entity(over: Partial<Entity> & { id: number }): Entity {
  return {
    kind: 'player',
    name: 'Streamer',
    templateId: 'warrior',
    pos: { x: 0, y: 0, z: 0 },
    scale: 1,
    level: 10,
    hp: 100,
    maxHp: 100,
    dead: false,
    lootable: false,
    hostile: false,
    ownerId: null,
    guild: '',
    auras: [],
    questIds: [],
    targetId: null,
    aggroTargetId: null,
    comboPoints: 0,
    comboTargetId: null,
    castingAbility: null,
    castTotal: 0,
    castRemaining: 0,
    channeling: false,
    ...over,
  } as unknown as Entity;
}

function view(): EntityView {
  const group = new THREE.Group();
  group.position.set(0, 0, 0);
  return { group, height: 2, mountLift: 0 } as EntityView;
}

interface PainterStateAccess {
  states: Map<number, NameplateCanvasState>;
}

function stateOf(painter: NameplatePainter, id: number): NameplateCanvasState {
  const state = (painter as unknown as PainterStateAccess).states.get(id);
  if (!state) throw new Error(`Missing nameplate state for ${id}`);
  return state;
}

function harness(
  targets: Entity[],
  options: {
    me?: Partial<Entity>;
    isHostilePlayer?: (e: Entity) => boolean;
    markerFor?: (entityId: number) => number | null;
    questState?: (questId: string) => string;
  } = {},
) {
  const me = entity({
    id: 1,
    name: 'Me',
    pos: { x: 0, y: 0, z: 3 } as Entity['pos'],
    ...options.me,
  });
  const views = new Map<number, EntityView>();
  for (const target of targets) views.set(target.id, view());
  const camera = new THREE.PerspectiveCamera(60, VIEWPORT.width / VIEWPORT.height, 0.1, 500);
  camera.position.set(0, 3, 12);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld(true);
  const entities = new Map<number, Entity>([[me.id, me]]);
  for (const target of targets) entities.set(target.id, target);
  const world = {
    player: me,
    entities,
    markerFor: options.markerFor ?? (() => null),
    questState: options.questState ?? (() => 'available'),
  } as unknown as IWorld;
  const layer = document.createElement('div');
  const painter = new NameplatePainter({
    views,
    camera,
    world,
    layer,
    getViewport: () => VIEWPORT,
    getDevicePixelRatio: () => 1,
    showNameplates: () => true,
    showDevBadges: () => true,
    showOwnNameplate: () => false,
    showPlayerNameplates: () => true,
    isHostilePlayer: options.isHostilePlayer ?? (() => false),
  });
  return { painter, layer };
}

describe('batched canvas nameplate state', () => {
  it('uses one canvas for many entities and creates no per-entity nameplate DOM', () => {
    const targets = [entity({ id: 2 }), entity({ id: 3, name: 'Other' })];
    const { painter, layer } = harness(targets);
    painter.update(true);

    expect(layer.querySelectorAll('canvas.nameplate-canvas')).toHaveLength(1);
    expect(layer.children).toHaveLength(1);
    expect(layer.firstElementChild?.tagName).toBe('CANVAS');
    expect(layer.querySelectorAll('.nameplate')).toHaveLength(0);
    expect(stateOf(painter, 2).name).toBe('Streamer');
    expect(stateOf(painter, 3).name).toBe('Other');
  });

  it('updates a live AI-account flip while preserving the independent role color', () => {
    const target = entity({ id: 2, discordRole: 'admin' });
    const { painter } = harness([target]);
    painter.update(true);
    const state = stateOf(painter, 2);
    expect(state.aiLabel).toBe('');
    const roleColor = state.nameColor;

    target.aiAccount = true;
    painter.update(true);
    expect(state.aiLabel).toBe('[AI]');
    expect(state.nameColor).toBe(roleColor);

    target.aiAccount = false;
    painter.update(true);
    expect(state.aiLabel).toBe('');
  });

  it('keeps target, hostile, dead, pet, threat, and hp state in canvas paint data', () => {
    const target = entity({
      id: 2,
      kind: 'mob',
      templateId: 'wolf',
      hostile: true,
      hp: 25,
      maxHp: 100,
      aggroTargetId: 1,
    });
    const { painter } = harness([target], { me: { targetId: 2 } });
    painter.update(true);
    const state = stateOf(painter, 2);
    expect(state.currentTarget).toBe(true);
    expect(state.hostile).toBe(true);
    expect(state.threat).toBe(true);
    expect(state.hpFill).toBe(0.25);

    target.hostile = false;
    target.ownerId = 1;
    target.aggroTargetId = null;
    painter.update(true);
    expect(state.myPet).toBe(true);
    expect(state.friendlyPet).toBe(true);
    expect(state.levelColor).toBe(FRIENDLY);

    target.dead = true;
    target.lootable = true;
    target.hostile = true;
    painter.update(true);
    expect(state.deadEnemy).toBe(true);
    expect(state.hpVisible).toBe(false);
    expect(state.level).toBe('');
  });

  it('updates the mob level content without creating another canvas', () => {
    const target = entity({ id: 2, kind: 'mob', templateId: 'wolf', level: 13, hostile: true });
    const { painter, layer } = harness([target]);
    painter.update(true);
    const state = stateOf(painter, 2);
    expect(state.level).toBe('13');

    target.level = 14;
    painter.update(true);
    expect(state.level).toBe('14');
    expect(layer.querySelectorAll('canvas.nameplate-canvas')).toHaveLength(1);
  });

  it('maps live player identity, badge, emote, raid, stealth, and cast state', () => {
    const target = entity({
      id: 2,
      guild: 'Canvas Raiders',
      title: 'prog_veteran',
      overheadEmoteId: 'wave',
      holderTier: 1,
      devTier: 4,
      discordAvatar: 'https://example.com/avatar.png',
      auras: [{ kind: 'stealth' } as Entity['auras'][number]],
      castingAbility: 'fireball',
      castTotal: 2,
      castRemaining: 1,
    });
    const { painter } = harness([target], { markerFor: (id) => (id === target.id ? 3 : null) });

    painter.update(true);
    const state = stateOf(painter, target.id);

    expect(state.guild).toBe('Canvas Raiders');
    expect(state.title).toBe('Veteran');
    expect(state.opacity).toBe(0.55);
    expect(state.badges).toHaveLength(3);
    expect(state.badges[2]).toMatchObject({
      url: 'https://example.com/avatar.png',
      size: 24,
      circular: true,
      border: '#5865f2',
    });
    expect(state.devOutline).not.toBeNull();
    expect(state.raidMarkerUrl).not.toBe('');
    expect(state.emoteIconUrl).toBe('/ui/emotes/emote-wave.png');
    expect(state.emoteLabel).not.toBe('');
    expect(state.castVisible).toBe(true);
    expect(state.castFill).toBe(0.5);
    expect(state.castSource).toBe('fireball');
    expect(state.castLabel).not.toBe('fireball');
  });

  it('maps object, quest NPC, boss, and lootable corpse presentation', () => {
    const questNpc = entity({
      id: 2,
      kind: 'npc',
      templateId: 'marshal_redbrook',
      questIds: ['q_wolves'],
    });
    const object = entity({ id: 3, kind: 'object', templateId: 'delve_locked_chest' });
    const boss = entity({ id: 4, kind: 'mob', templateId: 'gorrak', hostile: true });
    const corpse = entity({
      id: 5,
      kind: 'mob',
      templateId: 'gorrak',
      hostile: true,
      dead: true,
      lootable: true,
    });
    const { painter } = harness([questNpc, object, boss, corpse]);

    painter.update(true);

    expect(stateOf(painter, questNpc.id)).toMatchObject({ marker: '!', markerTone: 'quest' });
    expect(stateOf(painter, object.id)).toMatchObject({ nameColor: '#c084ff', badges: [] });
    expect(stateOf(painter, object.id).name).not.toBe('');
    expect(stateOf(painter, boss.id)).toMatchObject({ frame: 'boss', hpVisible: true });
    expect(stateOf(painter, corpse.id)).toMatchObject({
      frame: '',
      marker: '$',
      markerTone: 'loot',
      hpVisible: false,
    });
    expect(stateOf(painter, corpse.id).name).not.toBe(stateOf(painter, boss.id).name);
  });

  it('forgets cached paint state when a view leaves interest', () => {
    const target = entity({ id: 2 });
    const { painter } = harness([target]);
    painter.update(true);
    expect(stateOf(painter, target.id)).toBeDefined();

    painter.remove(target.id);

    expect((painter as unknown as PainterStateAccess).states.has(target.id)).toBe(false);
  });
});
