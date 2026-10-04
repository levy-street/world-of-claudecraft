// @vitest-environment happy-dom

// A player covering Morthen's shift (the Graveyard Shift) wears the boss's
// overhead plate, the owner's own plate included: Morthen's name, the boss
// frame and elite mark, his "10+" level, and none of the player's own lines.
// The plate turns with the body, on the very next pass, full or not. The
// harness is tests/nameplate_pvp_tag.test.ts's.

import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NameplateCanvasState } from '../src/render/nameplate_canvas';
import { NameplatePainter } from '../src/render/nameplate_painter';
import type { EntityView } from '../src/render/renderer';
import { morthenIdentityAura } from '../src/sim/graveyard_shift/morthen_identity';
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

function harness(me: Entity, others: Entity[] = [], showOwn = true) {
  const views = new Map<number, EntityView>([[me.id, view()]]);
  for (const other of others) views.set(other.id, view());
  const camera = new THREE.PerspectiveCamera(60, VIEWPORT.width / VIEWPORT.height, 0.1, 500);
  camera.position.set(0, 3, 12);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld(true);
  const entities = new Map<number, Entity>([[me.id, me]]);
  for (const other of others) entities.set(other.id, other);
  const world = {
    player: me,
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
    showNameplates: () => true,
    showDevBadges: () => true,
    showOwnNameplate: () => showOwn,
    showPlayerNameplates: () => true,
    nameplateDotScale: () => 0,
    isHostilePlayer: () => false,
  });
  return painter;
}

const shiftMe = () =>
  entity({
    id: 1,
    name: 'Ari',
    guild: 'Night Watch',
    title: 'some_deed',
    pos: FAR,
    auras: [morthenIdentityAura(1)],
  } as Partial<Entity> & { id: number });

describe("the Morthen player's overhead plate", () => {
  it("reads as the boss's: his name, the boss frame and mark, the boss level", () => {
    const me = shiftMe();
    const painter = harness(me);
    painter.update(true);
    const state = stateOf(painter, 1);
    expect(state.name).toBe('Morthen the Gravecaller');
    expect(state.frame).toBe('boss');
    expect(state.marker).toBe('\u25c6');
    // The real Morthen's plate level: his level with the elite mark, conned
    // against the viewer (the owner's own plate: same level, yellow).
    expect(state.level).toBe('10+');
    expect(state.levelColor).toBe('#ffe97a');
    expect(state.nameColor).toBe('#fff');
    expect(state.hpVisible).toBe(true);
    // None of the player's own lines.
    expect(state.guild).toBe('');
    expect(state.guildLabel).toBe('');
    expect(state.title).toBe('');
    expect(state.badges).toHaveLength(0);
  });

  it('turns with the body on the next pass, full or not, and back', () => {
    // Another player out of urgent range: only the identity check can refresh
    // the row between full passes (the owner's own plate is always urgent).
    const me = entity({ id: 1, name: 'Viewer', pos: { x: 0, y: 0, z: 3 } as Entity['pos'] });
    const other = entity({ id: 2, name: 'Ari', guild: 'Night Watch', pos: FAR });
    const painter = harness(me, [other]);
    painter.update(true);
    const state = stateOf(painter, 2);
    expect(state.name).toBe('Ari');
    expect(state.frame).toBe('');
    other.auras = [morthenIdentityAura(2)];
    painter.update(false);
    expect(state.name).toBe('Morthen the Gravecaller');
    expect(state.frame).toBe('boss');
    other.auras = [];
    painter.update(false);
    expect(state.name).toBe('Ari');
    expect(state.level).toBe('');
    expect(state.frame).toBe('');
    expect(state.guildLabel).toBe('<Night Watch>');
  });

  it("is the boss's to another viewer as well", () => {
    const me = entity({ id: 1, name: 'Viewer' });
    const other = shiftMe();
    other.id = 2;
    const painter = harness(me, [other]);
    painter.update(true);
    expect(stateOf(painter, 2).name).toBe('Morthen the Gravecaller');
    expect(stateOf(painter, 2).frame).toBe('boss');
  });

  it('still honours the hidden own-nameplate setting', () => {
    const me = shiftMe();
    const painter = harness(me, [], false);
    painter.update(true);
    const states = (painter as unknown as { states: Map<number, NameplateCanvasState> }).states;
    expect(states.get(1)?.name ?? '').toBe('');
  });
});
