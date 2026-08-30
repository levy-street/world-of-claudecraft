// @vitest-environment happy-dom

import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NameplatePainter } from '../src/render/nameplate_painter';
import {
  type NameplatePickCandidate,
  nameplateHealthBarTop,
} from '../src/render/nameplate_pick_core';
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

function entity(id: number, kind: Entity['kind'] = 'mob'): Entity {
  return {
    id,
    kind,
    name: kind === 'player' ? 'Raider' : `Add ${id}`,
    templateId: kind === 'player' ? 'warrior' : 'cinder_artificer',
    pos: { x: 0, y: 0, z: 0 },
    scale: 1,
    level: 10,
    hp: 100,
    maxHp: 100,
    dead: false,
    lootable: false,
    hostile: kind === 'mob',
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
  } as unknown as Entity;
}

function view(): EntityView {
  const group = new THREE.Group();
  group.position.set(0, 0, 0);
  return { group, height: 2, mountLift: 0 } as EntityView;
}

interface PainterAccess {
  anchorScratch: Array<NameplatePickCandidate>;
  anchorCount: number;
}

function liveAnchors(painter: NameplatePainter): NameplatePickCandidate[] {
  const access = painter as unknown as PainterAccess;
  return access.anchorScratch.slice(0, access.anchorCount);
}

function healthPoint(anchor: NameplatePickCandidate): [number, number] {
  return [anchor.sx, nameplateHealthBarTop(anchor.sy, anchor.castVisible) + 2];
}

function harness(targets: Entity[]) {
  const player = entity(1, 'player');
  player.pos = { x: 0, y: 0, z: 3 } as Entity['pos'];
  const views = new Map<number, EntityView>();
  const entities = new Map<number, Entity>([[player.id, player]]);
  for (const target of targets) {
    views.set(target.id, view());
    entities.set(target.id, target);
  }
  const camera = new THREE.PerspectiveCamera(60, VIEWPORT.width / VIEWPORT.height, 0.1, 500);
  camera.position.set(0, 3, 12);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld(true);
  let showNameplates = true;
  const world = {
    player,
    entities,
    markerFor: () => null,
    questState: () => 'available',
  } as unknown as IWorld;
  const painter = new NameplatePainter({
    views,
    camera,
    world,
    layer: document.createElement('div'),
    getViewport: () => VIEWPORT,
    getDevicePixelRatio: () => 1,
    showNameplates: () => showNameplates,
    showDevBadges: () => true,
    showOwnNameplate: () => false,
    showPlayerNameplates: () => true,
    isHostilePlayer: () => false,
  });
  return { painter, setShowNameplates: (value: boolean) => (showNameplates = value) };
}

describe('production nameplate picking path', () => {
  it('returns each exact add from the post-declutter coordinates used for drawing', () => {
    const { painter } = harness([entity(7), entity(8)]);
    painter.update(true);
    const anchors = liveAnchors(painter);

    expect(anchors).toHaveLength(2);
    expect(Math.abs(anchors[0].sy - anchors[1].sy)).toBe(20);
    for (const anchor of anchors) {
      expect(painter.pickEntityAt(...healthPoint(anchor))).toBe(anchor.id);
    }
  });

  it('uses the production boss width and cast-bar lift for Ignivar', () => {
    const ignivar = entity(9);
    ignivar.templateId = 'ignivar_herald_of_the_last_flame';
    ignivar.castingAbility = 'fireball';
    ignivar.castTotal = 2;
    ignivar.castRemaining = 1;
    const { painter } = harness([ignivar]);
    painter.update(true);
    const [anchor] = liveAnchors(painter);

    expect(anchor.boss).toBe(true);
    expect(anchor.castVisible).toBe(true);
    const bossOnlyX = anchor.sx + 48;
    const castLiftOnlyY = nameplateHealthBarTop(anchor.sy, true) + 2;
    expect(painter.pickEntityAt(bossOnlyX, castLiftOnlyY)).toBe(9);
  });

  it('invalidates removed, dead, hidden, and disposed candidates', () => {
    const target = entity(7);
    const { painter, setShowNameplates } = harness([target]);
    painter.update(true);
    const click = healthPoint(liveAnchors(painter)[0]);
    expect(painter.pickEntityAt(...click)).toBe(7);

    painter.remove(7);
    expect(painter.pickEntityAt(...click)).toBeNull();

    target.dead = true;
    painter.update(true);
    expect(liveAnchors(painter)).toHaveLength(0);
    expect(painter.pickEntityAt(...click)).toBeNull();

    target.dead = false;
    setShowNameplates(false);
    painter.update(true);
    expect(liveAnchors(painter)).toHaveLength(0);
    expect(painter.pickEntityAt(...click)).toBeNull();

    setShowNameplates(true);
    painter.update(true);
    const liveClick = healthPoint(liveAnchors(painter)[0]);
    expect(painter.pickEntityAt(...liveClick)).toBe(7);
    painter.dispose();
    expect(painter.pickEntityAt(...liveClick)).toBeNull();
  });
});
