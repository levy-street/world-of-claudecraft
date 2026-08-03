// @vitest-environment jsdom

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
    markerFor: () => null,
    questState: () => 'available',
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
});
