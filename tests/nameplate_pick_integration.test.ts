// @vitest-environment happy-dom

import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nameplateDotRowHeight } from '../src/render/nameplate_dots_core';
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

function harness(targets: Entity[], dotScale = 0) {
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
    nameplateDotScale: () => dotScale,
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

describe('the dot row in the declutter anchor', () => {
  // Every other harness in this file injects a scale of 0, so resolveDots and the
  // extraLift row-height term are dead in them. This is the one case that turns
  // the row on: without the term, two dotted plates in a crowd take the
  // bare-label envelope and overlap without being nudged apart, and deleting it
  // from the painter leaves the rest of the suite green.
  const OWNER = 1;

  function dotted(id: number): Entity {
    const e = entity(id);
    e.auras = [
      {
        id: 'corruption',
        name: 'Blackrot',
        kind: 'dot',
        value: 6,
        remaining: 12,
        duration: 18,
        school: 'shadow',
        sourceId: OWNER,
      },
    ] as Entity['auras'];
    return e;
  }

  it('adds the row height to extraLift, on top of any heraldry lift', () => {
    const withoutRow = harness([dotted(7)], 0);
    withoutRow.painter.update(true);
    const bare = liveAnchors(withoutRow.painter)[0] as { extraLift?: number };

    const withRow = harness([dotted(7)], 1);
    withRow.painter.update(true);
    const lifted = liveAnchors(withRow.painter)[0] as { extraLift?: number };

    expect(lifted.extraLift ?? 0).toBeCloseTo(
      (bare.extraLift ?? 0) + nameplateDotRowHeight(1, 1),
      5,
    );
    expect(lifted.extraLift ?? 0).toBeGreaterThan(0);
  });

  it('grows that term with the size slider', () => {
    const one = harness([dotted(7)], 1);
    one.painter.update(true);
    const atOne = (liveAnchors(one.painter)[0] as { extraLift?: number }).extraLift ?? 0;
    const three = harness([dotted(7)], 3);
    three.painter.update(true);
    const atThree = (liveAnchors(three.painter)[0] as { extraLift?: number }).extraLift ?? 0;
    expect(atThree).toBeCloseTo(atOne * 3, 5);
  });

  it.each([
    ['the 150% default', 1.5, 34.5],
    ['the 300% maximum', 3, 69],
  ])('declutters two dotted plates at one anchor by the whole row at %s', (_label, scale, lift) => {
    // Both enemies stand on the same spot, so they project to one anchor. The
    // painter hands the row height to the declutter pass through extraLift;
    // this pins that the pass actually SPENDS it: the pair's pitch is the bare
    // 20px plus the row, not the 28px heraldry pitch (PR 3853 review).
    const bare = harness([entity(7), entity(8)]);
    bare.painter.update(true);
    const [bareA, bareB] = liveAnchors(bare.painter);
    expect(Math.abs(bareA.sy - bareB.sy)).toBe(20);

    const dots = harness([dotted(7), dotted(8)], scale);
    dots.painter.update(true);
    const anchors = liveAnchors(dots.painter);

    expect(anchors).toHaveLength(2);
    expect(nameplateDotRowHeight(1, scale)).toBe(lift);
    expect(Math.abs(anchors[0].sy - anchors[1].sy)).toBeCloseTo(20 + lift, 5);
    // and picking still resolves at the post-declutter coordinates it draws at
    for (const anchor of anchors) {
      expect(dots.painter.pickEntityAt(...healthPoint(anchor))).toBe(anchor.id);
    }
  });

  it('leaves the anchor unlifted for a plate with no dots of YOURS on it', () => {
    const foreign = entity(7);
    foreign.auras = [
      {
        id: 'corruption',
        name: 'Blackrot',
        kind: 'dot',
        value: 6,
        remaining: 12,
        duration: 18,
        school: 'shadow',
        sourceId: 99,
      },
    ] as Entity['auras'];
    const h = harness([foreign], 1);
    h.painter.update(true);
    expect((liveAnchors(h.painter)[0] as { extraLift?: number }).extraLift ?? 0).toBe(0);
  });
});
