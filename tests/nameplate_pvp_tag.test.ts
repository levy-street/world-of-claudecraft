// @vitest-environment happy-dom

// The World PvP flag on a nameplate: a flagged player's plate carries the
// `<PvP>` tag (hudChrome.nameplate.pvpTag) ahead of the name, and the tag
// follows the entity's `pvpFlag` wire bit on the very next pass, full or not.
// Plate content otherwise re-resolves on the tier-derived full-pass interval
// (nameplate_cadence_core.ts: 1/15 s on the LOW tier, 1/24 s above it); the
// tag is the colour-blind-safe read of an actionable cue, so the painter
// compares the entity's flag with the one the row was built with on every
// pass (NameplateCanvasState.pvpFlag) and re-resolves the frame they differ,
// on every tier alike, without marking a flagged plate urgent (an urgent plate
// re-resolves its content every frame, the cost of a live cast bar). The
// idiom (fake canvas context, painter state access) is
// tests/nameplate_ai_tag.test.ts's.

import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NameplateCanvasState } from '../src/render/nameplate_canvas';
import { NameplatePainter } from '../src/render/nameplate_painter';
import type { EntityView } from '../src/render/renderer';
import type { Entity } from '../src/sim/types';
import { setLanguage } from '../src/ui/i18n';
import type { IWorld } from '../src/world_api';

const VIEWPORT = { width: 1280, height: 720 };
/** In front of the camera, inside nameplate range, outside the urgent range. */
const FAR = { x: 0, y: 0, z: -20 } as Entity['pos'];

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
  setLanguage('en');
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

function stateOf(painter: NameplatePainter, id: number): NameplateCanvasState {
  const state = (painter as unknown as { states: Map<number, NameplateCanvasState> }).states.get(
    id,
  );
  if (!state) throw new Error(`Missing nameplate state for ${id}`);
  return state;
}

function harness(targets: Entity[], isHostilePlayer: (e: Entity) => boolean = () => false) {
  const me = entity({ id: 1, name: 'Me', pos: { x: 0, y: 0, z: 3 } as Entity['pos'] });
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
    nameplateDotScale: () => 0,
    isHostilePlayer,
  });
  return { painter, layer };
}

describe('the nameplate <PvP> tag', () => {
  it('a flagged player carries the tag ahead of the name; an unflagged one does not', () => {
    const flagged = entity({ id: 2, name: 'Aleph', pvpFlag: true });
    const bare = entity({ id: 3, name: 'Bet' });
    const { painter } = harness([flagged, bare]);
    painter.update(true);
    expect(stateOf(painter, 2).name).toBe('<PvP> Aleph');
    expect(stateOf(painter, 3).name).toBe('Bet');
  });

  it('follows the wire bit on the next pass even when it is not a full pass, both ways', () => {
    // Outside NAMEPLATE_URGENT_RANGE (14 yd) of the viewer, so nothing but the
    // flag comparison can refresh the row on a non-full pass.
    const target = entity({ id: 2, name: 'Aleph', pos: FAR });
    let hostile = false;
    const { painter } = harness([target], () => hostile);
    painter.update(true);
    const state = stateOf(painter, 2);
    expect(state.name).toBe('Aleph');
    expect(state.hostile).toBe(false);

    // A non-full pass (the ordinary frame between two content re-resolves)
    // still picks the flip up: the tag never waits on the tier cadence.
    target.pvpFlag = true;
    painter.update(false);
    expect(state.name).toBe('<PvP> Aleph');
    // The flag alone does not paint red: two unflagged strangers on
    // contested ground, or a party mate, keep their colour (pvp_hostile_core).
    expect(state.hostile).toBe(false);

    hostile = true;
    painter.update(false);
    expect(state.hostile).toBe(true);

    target.pvpFlag = false;
    painter.update(false);
    expect(state.name).toBe('Aleph');
  });

  it('a plate that merely stays flagged is not re-resolved between full passes', () => {
    const target = entity({ id: 2, name: 'Aleph', pvpFlag: true, pos: FAR });
    const { painter } = harness([target]);
    painter.update(true);
    const state = stateOf(painter, 2);
    expect(state.name).toBe('<PvP> Aleph');
    // A rename with no flag change is only seen on the next FULL pass: the
    // proof that the flag comparison, not an urgent mark, drives the refresh.
    target.name = 'Bet';
    painter.update(false);
    expect(state.name).toBe('<PvP> Aleph');
    painter.update(true);
    expect(state.name).toBe('<PvP> Bet');
  });
});
