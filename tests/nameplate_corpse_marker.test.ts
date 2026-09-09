// @vitest-environment happy-dom
//
// The corpse marker on the overhead nameplate, driven through the real
// NameplatePainter over an IWorld-shaped world: the satchel means ordinary
// loot THIS viewer may take, the blade means a harvest still open on a body
// with no ordinary loot for them, and a body offering neither carries no
// marker at all even while `lootable` stays true for the harvest grace
// window. The canvas routing half pins that the harvest tone reaches the
// blade art, never the satchel and never a text glyph.

import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNameplateCanvasState,
  type NameplateCanvasState,
  NameplateCanvasSurface,
} from '../src/render/nameplate_canvas';
import { NameplatePainter } from '../src/render/nameplate_painter';
import type { EntityView } from '../src/render/renderer';
import { LOOT_FFA_DELAY } from '../src/sim/loot/loot_ffa';
import type { Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const VIEWPORT = { width: 1280, height: 720 };
const ME = 1;
const STRANGER = 9;
const MATE = 7;

interface Trace {
  quadraticCurveTo: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  fillStyles: string[];
}

let traces: Trace[];

function fakeContext(): CanvasRenderingContext2D {
  const noop = vi.fn();
  const trace: Trace = {
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(),
    lineTo: vi.fn(),
    fillText: vi.fn(),
    fillStyles: [],
  };
  traces.push(trace);
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
    lineTo: trace.lineTo,
    quadraticCurveTo: trace.quadraticCurveTo,
    arc: trace.arc,
    rect: noop,
    clip: noop,
    fill: noop,
    stroke: noop,
    drawImage: noop,
    fillText: trace.fillText,
    strokeText: noop,
    setLineDash: noop,
    set fillStyle(value: string) {
      trace.fillStyles.push(String(value));
    },
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
  traces = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext());
});

function entity(over: Partial<Entity> & { id: number }): Entity {
  return {
    kind: 'player',
    name: 'Viewer',
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

function corpse(over: Partial<Entity> = {}): Entity {
  return entity({
    id: 2,
    kind: 'mob',
    name: 'Forest Wolf',
    // forest_wolf carries mapped componentTags: harvestable while unclaimed.
    templateId: 'forest_wolf',
    hostile: true,
    dead: true,
    lootable: true,
    corpseTimer: 60,
    loot: null,
    tappedById: null,
    lootFfaTimer: Number.POSITIVE_INFINITY,
    harvestClaimedBy: null,
    ...over,
  } as Partial<Entity> & { id: number });
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

function harness(body: Entity, partyPids: number[] | null = null) {
  const me = entity({ id: ME, name: 'Me', pos: { x: 0, y: 0, z: 3 } as Entity['pos'] });
  const views = new Map<number, EntityView>();
  views.set(body.id, view());
  const camera = new THREE.PerspectiveCamera(60, VIEWPORT.width / VIEWPORT.height, 0.1, 500);
  camera.position.set(0, 3, 12);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld(true);
  const world = {
    player: me,
    entities: new Map<number, Entity>([
      [me.id, me],
      [body.id, body],
    ]),
    partyInfo: partyPids
      ? { leader: ME, raid: false, members: partyPids.map((pid) => ({ pid })) }
      : null,
    markerFor: () => null,
    questState: () => 'unavailable',
    questsDone: new Set<string>(),
    questLog: new Map(),
    craftingIdentity: { version: 1, synced: true, cadenceBlockedQuests: [] },
  } as unknown as IWorld;
  const painter = new NameplatePainter({
    views,
    camera,
    world,
    layer: document.createElement('div'),
    getViewport: () => VIEWPORT,
    getDevicePixelRatio: () => 1,
    showNameplates: () => true,
    showDevBadges: () => false,
    showOwnNameplate: () => false,
    showPlayerNameplates: () => true,
    isHostilePlayer: () => false,
  });
  return { painter, world, body };
}

const plainLoot = () => ({ copper: 0, items: [{ itemId: 'wolf_fang', count: 1 }] });

function expectMarker(painter: NameplatePainter, marker: string, tone: string, label?: string) {
  const state = stateOf(painter, 2);
  expect(state.marker, label).toBe(marker);
  expect(state.markerTone, label).toBe(tone);
}

describe('nameplate corpse marker: ordinary loot vs harvest', () => {
  it('shows the satchel on a body with ordinary loot for me, even while its harvest is open', () => {
    const { painter } = harness(corpse({ loot: plainLoot(), harvestClaimedBy: null }));
    painter.update(true);
    expectMarker(painter, 'loot', 'loot');
  });

  it('shows the blade on a harvest-only body, and nothing once the claim is spent', () => {
    const { painter, body } = harness(corpse({ loot: null, harvestClaimedBy: null }));
    painter.update(true);
    expectMarker(painter, 'harvest', 'harvest', 'grace window, claim open');

    body.harvestClaimedBy = STRANGER;
    painter.update(true);
    expectMarker(painter, '', 'none', 'claim spent while lootable is still true');
  });

  it('switches satchel to blade as the delayed snapshot empties the ordinary loot', () => {
    const { painter, body } = harness(corpse({ loot: plainLoot(), harvestClaimedBy: null }));
    painter.update(true);
    expectMarker(painter, 'loot', 'loot');

    body.loot = null;
    painter.update(true);
    expectMarker(painter, 'harvest', 'harvest');
  });

  it("shows the blade, never the satchel, on a stranger's owner-locked kill I may still harvest", () => {
    const { painter } = harness(
      corpse({
        loot: plainLoot(),
        tappedById: STRANGER,
        lootFfaTimer: LOOT_FFA_DELAY,
        harvestClaimedBy: null,
      }),
    );
    painter.update(true);
    expectMarker(painter, 'harvest', 'harvest');
  });

  it('shows nothing on a stranger-locked kill with its harvest spent, the satchel after the lapse', () => {
    const { painter, body } = harness(
      corpse({
        loot: plainLoot(),
        tappedById: STRANGER,
        lootFfaTimer: LOOT_FFA_DELAY,
        harvestClaimedBy: STRANGER,
      }),
    );
    painter.update(true);
    expectMarker(painter, '', 'none', 'foreign rights, nothing for me');

    body.lootFfaTimer = 0;
    painter.update(true);
    expectMarker(painter, 'loot', 'loot', 'FFA lapse');
  });

  it("reads a party mate's tap as my loot through the viewer roster", () => {
    const body = corpse({
      loot: plainLoot(),
      tappedById: MATE,
      lootFfaTimer: LOOT_FFA_DELAY,
      harvestClaimedBy: STRANGER,
    });
    const grouped = harness(body, [ME, MATE]);
    grouped.painter.update(true);
    expectMarker(grouped.painter, 'loot', 'loot', 'tapper in my party');

    const solo = harness(corpse({ ...body }), null);
    solo.painter.update(true);
    expectMarker(solo.painter, '', 'none', 'solo viewer');
  });

  it('shows nothing on an owned pet body or an expired body, whatever stale fields remain', () => {
    const pet = harness(corpse({ ownerId: STRANGER, loot: plainLoot() }));
    pet.painter.update(true);
    expectMarker(pet.painter, '', 'none', 'owned pet');

    const expired = harness(corpse({ corpseTimer: 0, loot: plainLoot(), harvestClaimedBy: null }));
    expired.painter.update(true);
    expectMarker(expired.painter, '', 'none', 'expired');
  });
});

describe('nameplate canvas: the harvest tone routes to the blade art', () => {
  it('draws the blade shapes and no satchel or text for the harvest tone', () => {
    const surface = new NameplateCanvasSurface(document.createElement('div'));
    const state = createNameplateCanvasState();
    Object.assign(state, {
      initialized: true,
      name: 'Harvestable Body',
      marker: 'harvest',
      markerTone: 'harvest',
    });

    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);

    // The blade is two curves and no arc; the satchel is six curves and one arc.
    expect(traces[0].quadraticCurveTo).toHaveBeenCalledTimes(2);
    expect(traces[0].arc).not.toHaveBeenCalled();
    const rasterizedText = traces.flatMap((trace) =>
      trace.fillText.mock.calls.map(([value]) => value),
    );
    expect(rasterizedText).not.toContain('harvest');
    expect(rasterizedText).not.toContain('loot');
  });

  it('paints the harvest blade in a fill distinct from the loot satchel gold', () => {
    const paint = (tone: 'loot' | 'harvest') => {
      traces = [];
      const surface = new NameplateCanvasSurface(document.createElement('div'));
      const state = createNameplateCanvasState();
      Object.assign(state, { initialized: true, marker: tone, markerTone: tone });
      surface.beginFrame(640, 360, 1);
      surface.drawBase(state, 320, 220);
      return traces[0].fillStyles.at(-1);
    };
    expect(paint('harvest')).not.toBe(paint('loot'));
  });
});
