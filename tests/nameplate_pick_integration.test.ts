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

function harness(
  targets: Entity[],
  dotScale = 0,
  markerFor: () => number | null = () => null,
  questState = 'available',
) {
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
    markerFor,
    questState: () => questState,
    questsDone: new Set<string>(),
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
    // Buddy nameplates are off by default (the "Show Pet Names" option), and
    // this integration drives players and mobs, so the default answers here.
    showPetNames: () => false,
    showPlayerNameplates: () => true,
    nameplateDotScale: () => dotScale,
    isHostilePlayer: () => false,
  });
  return { painter, player, setShowNameplates: (value: boolean) => (showNameplates = value) };
}

describe('production nameplate picking path', () => {
  it('draws overlapping plates at their own anchors, never stacked apart', () => {
    const { painter } = harness([entity(7), entity(8)]);
    painter.update(true);
    const anchors = liveAnchors(painter);

    expect(anchors).toHaveLength(2);
    expect(anchors[0].sx).toBe(anchors[1].sx);
    expect(anchors[0].sy).toBe(anchors[1].sy);
    // the later plate draws on top, so it owns the shared spot
    expect(painter.pickEntityAt(...healthPoint(anchors[0]))).toBe(8);
  });

  it('draws the current target on top of a plate it overlaps, so a click picks it', () => {
    const { painter, player } = harness([entity(7), entity(8)]);
    player.targetId = 7;
    painter.update(true);
    const anchors = liveAnchors(painter);

    expect(anchors.map((a) => a.id)).toEqual([8, 7]);
    expect(painter.pickEntityAt(...healthPoint(anchors[0]))).toBe(7);
  });

  it('paints the current target last, matching the pick order', () => {
    const { painter, player } = harness([entity(7), entity(8)]);
    const access = painter as unknown as {
      surface: { drawBase: (state: unknown) => void };
      states: Map<number, unknown>;
    };
    const drawn: unknown[] = [];
    vi.spyOn(access.surface, 'drawBase').mockImplementation((state) => {
      drawn.push(state);
    });
    player.targetId = 7;
    painter.update(true);
    expect(drawn).toEqual([access.states.get(8), access.states.get(7)]);
  });

  it('keeps a plate at its projected anchor when a dot row lifts it', () => {
    const plain = harness([entity(7), entity(8)]);
    plain.painter.update(true);
    const dotted = entity(7);
    dotted.auras = [
      {
        id: 'corruption',
        name: 'Blackrot',
        kind: 'dot',
        value: 6,
        remaining: 12,
        duration: 18,
        school: 'shadow',
        sourceId: 1,
      },
    ] as Entity['auras'];
    const lifted = harness([dotted, entity(8)], 3);
    lifted.painter.update(true);
    const dottedState = (
      lifted.painter as unknown as { states: Map<number, { dots: { count: number } }> }
    ).states.get(7);
    expect(dottedState?.dots.count).toBeGreaterThan(0);
    expect(liveAnchors(lifted.painter).map((a) => a.sy)).toEqual(
      liveAnchors(plain.painter).map((a) => a.sy),
    );
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

describe('NPC plates', () => {
  function npc(id: number): Entity {
    const e = entity(id, 'npc');
    e.templateId = 'smith_haldren';
    e.hostile = false;
    e.castingAbility = 'fireball';
    e.castTotal = 2;
    e.castRemaining = 1;
    return e;
  }

  it('draws only the name line: no health bar, cast bar or raid mark', () => {
    const { painter } = harness([npc(7)], 1, () => 4);
    painter.update(true);
    const [anchor] = liveAnchors(painter);
    const state = (
      painter as unknown as {
        states: Map<number, { hpVisible: boolean; castVisible: boolean; raidMarkerUrl: string }>;
      }
    ).states.get(7);

    expect(anchor.hpVisible).toBe(false);
    expect(anchor.castVisible).toBe(false);
    expect(state?.raidMarkerUrl).toBe('');
  });

  it('keeps the quest marker on an NPC plate', () => {
    const giver = npc(7);
    giver.questIds = ['q_prof_hobby_switch'];
    const { painter } = harness([giver], 0, () => null, 'ready');
    painter.update(true);
    const state = (
      painter as unknown as { states: Map<number, { marker: string; castVisible: boolean }> }
    ).states.get(7);
    expect(state?.marker).toBe('?');
    expect(state?.castVisible).toBe(false);
  });

  it('strips a friendly quest-giver mob the same way', () => {
    const giver = entity(7);
    giver.hostile = false;
    giver.questIds = ['q_prof_hobby_switch'];
    giver.castingAbility = 'fireball';
    giver.castTotal = 2;
    giver.castRemaining = 1;
    // one of the viewer's own debuffs, with the dot row switched on
    giver.auras = [
      {
        id: 'corruption',
        name: 'Blackrot',
        kind: 'dot',
        value: 6,
        remaining: 12,
        duration: 18,
        school: 'shadow',
        sourceId: 1,
      },
    ] as Entity['auras'];
    const { painter } = harness([giver], 1, () => 4);
    painter.update(true);
    const state = (
      painter as unknown as {
        states: Map<
          number,
          {
            hpVisible: boolean;
            castVisible: boolean;
            raidMarkerUrl: string;
            dots: { count: number };
          }
        >;
      }
    ).states.get(7);
    expect(state?.hpVisible).toBe(false);
    expect(state?.castVisible).toBe(false);
    expect(state?.raidMarkerUrl).toBe('');
    expect(state?.dots.count).toBe(0);
  });

  it('still draws a cast bar and raid mark on a mob in the same spot', () => {
    const mob = entity(7);
    mob.castingAbility = 'fireball';
    mob.castTotal = 2;
    mob.castRemaining = 1;
    const { painter } = harness([mob], 0, () => 4);
    painter.update(true);
    const state = (
      painter as unknown as { states: Map<number, { castVisible: boolean; raidMarkerUrl: string }> }
    ).states.get(7);
    expect(state?.castVisible).toBe(true);
    expect(state?.raidMarkerUrl).not.toBe('');
  });
});
