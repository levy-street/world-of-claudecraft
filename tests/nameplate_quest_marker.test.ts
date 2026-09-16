// @vitest-environment happy-dom
//
// Exercise the real canvas painter: ambient profession offers are hidden,
// while active/ready hand-ins and combat offers on mixed givers remain visible.

import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NameplateCanvasState, NameplateMarkerTone } from '../src/render/nameplate_canvas';
import { NameplatePainter } from '../src/render/nameplate_painter';
import type { EntityView } from '../src/render/renderer';
import { QUESTS } from '../src/sim/data';
import type { Entity, QuestState } from '../src/sim/types';
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
    setLineDash: noop,
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

function requireWorkOrderQuest() {
  const quest = Object.values(QUESTS).find((q) => q.repeatable && q.repeatCadenceTicks);
  if (!quest) throw new Error('expected a cadenced work order');
  return quest;
}
const WORK_ORDER = requireWorkOrderQuest();

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

/** The canvas translation of the DOM plate's marker-class contract: one
 *  assertion per (glyph, tone) pair so each arm still pins both channels. */
function expectMarker(
  painter: NameplatePainter,
  marker: string,
  tone: NameplateMarkerTone,
  label?: string,
): void {
  const state = stateOf(painter, 2);
  expect(state.marker, label).toBe(marker);
  expect(state.markerTone, label).toBe(tone);
}

/** A painter looking at the work order's giver NPC, with the quest-marker
 *  world knobs (state, history, the cadence mirror, extra quests for the
 *  cross-quest fold arms) under test control. The NPC sits inside
 *  NAMEPLATE_URGENT_RANGE so a throttled update(false) still reaches the
 *  content branch, which the snapshot-reuse arms below depend on. */
function harness(knobs: {
  state: QuestState;
  npcId?: string;
  /** true = the work order's id; an array = explicit questsDone ids (so a
   *  NON-repeatable id can sit in the history for the negative arm). */
  done?: boolean | string[];
  cadenceBlocked?: boolean;
  questIds?: string[];
  questStates?: Record<string, QuestState>;
}) {
  const me = entity({ id: 1, name: 'Me', pos: { x: 0, y: 0, z: 3 } as Entity['pos'] });
  const npc = entity({
    id: 2,
    kind: 'npc',
    name: 'Master',
    templateId: knobs.npcId ?? WORK_ORDER.giverNpcId,
    questIds: knobs.questIds ?? [WORK_ORDER.id],
  });
  const views = new Map<number, EntityView>();
  views.set(npc.id, view());
  const camera = new THREE.PerspectiveCamera(60, VIEWPORT.width / VIEWPORT.height, 0.1, 500);
  camera.position.set(0, 3, 12);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld(true);
  const world = {
    player: me,
    entities: new Map<number, Entity>([
      [me.id, me],
      [npc.id, npc],
    ]),
    markerFor: () => null,
    questState: (q: string) => knobs.questStates?.[q] ?? knobs.state,
    questsDone: new Set<string>(
      Array.isArray(knobs.done) ? knobs.done : knobs.done ? [WORK_ORDER.id] : [],
    ),
    craftingIdentity: {
      version: 1,
      synced: true,
      cadenceBlockedQuests: knobs.cadenceBlocked ? [WORK_ORDER.id] : [],
    },
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
    isHostilePlayer: () => false,
  });
  return { painter, world };
}

describe('nameplate quest marker variants', () => {
  it("hides Jessica's farming offer but keeps accepted and ready hand-ins", () => {
    for (const state of ['available', 'active', 'ready'] as const) {
      const { painter } = harness({
        state,
        npcId: 'farmer_jessica',
        questIds: ['q_farm_intro'],
      });
      painter.update(true);
      expect(stateOf(painter, 2).title).toBe('<Farming Trainer>');
      expectMarker(
        painter,
        state === 'available' ? '' : '?',
        state === 'available' ? 'none' : state === 'active' ? 'active' : 'quest',
      );
    }
  });

  it.each([
    { state: 'available' as const },
    { state: 'available' as const, done: true },
    { state: 'unavailable' as const, done: true, cadenceBlocked: true },
  ])('hides profession offers and cooldowns: %j', (knobs) => {
    const { painter } = harness(knobs);
    painter.update(true);
    expectMarker(painter, '', 'none');
  });

  it("keeps the gold '?' for ready profession hand-ins and gray '?' for active ones", () => {
    for (const state of ['ready', 'active'] as const) {
      const { painter } = harness({ state });
      painter.update(true);
      expectMarker(painter, '?', state === 'ready' ? 'quest' : 'active');
    }
  });

  it('preserves combat offers on mixed givers regardless of quest order', () => {
    for (const questIds of [
      ['q_prof_intro', 'q_mine'],
      ['q_mine', 'q_prof_intro'],
    ]) {
      const { painter } = harness({ state: 'available', npcId: 'foreman_odell', questIds });
      painter.update(true);
      expectMarker(painter, '!', 'quest');
    }
  });

  it('a ready profession hand-in wins over an available combat quest', () => {
    for (const questIds of [
      ['q_prof_intro', 'q_mine'],
      ['q_mine', 'q_prof_intro'],
    ]) {
      const { painter } = harness({
        state: 'available',
        npcId: 'foreman_odell',
        questIds,
        questStates: { q_prof_intro: 'ready' },
      });
      painter.update(true);
      expectMarker(painter, '?', 'quest');
    }
  });

  it('repaints a live profession hand-in and hides its next offer', () => {
    const { painter, world } = harness({ state: 'available' });
    painter.update(true);
    expectMarker(painter, '', 'none');
    const mutable = world as unknown as { questState: () => QuestState; questsDone: Set<string> };
    mutable.questState = () => 'ready';
    painter.update(true);
    expectMarker(painter, '?', 'quest');
    // The online mirror replaces the history set on hand-in. Even a
    // throttled pass must clear the previously visible completion marker.
    mutable.questsDone = new Set([WORK_ORDER.id]);
    mutable.questState = () => 'available';
    painter.update(false);
    expectMarker(painter, '', 'none');
  });
});
