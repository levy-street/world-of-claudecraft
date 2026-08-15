// @vitest-environment happy-dom
//
// The overhead quest marker branch of the nameplate painter, now driven by the
// shared quest_marker_kind rule (phase 23) on the batched canvas surface: the
// gold '!'/'?' arms must stay byte-identical to the pre-phase painter, the
// blue repeat and dimmed cooldown variants join them, and (the
// nameplate_ai_tag lesson) a LIVE transition from gold to blue must repaint,
// which holds only while resolveContent recomputes marker and markerTone on
// every full pass and the throttled-pass context reuse stays bounded.

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
    templateId: WORK_ORDER.giverNpcId,
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
    isHostilePlayer: () => false,
  });
  return { painter, world };
}

describe('nameplate quest marker variants', () => {
  it("keeps the gold '!' for a never-completed offer, repeatable or not (Q30's first half)", () => {
    const { painter } = harness({ state: 'available' });
    painter.update(true);
    expectMarker(painter, '!', 'quest');

    // The other half of "repeatable or not": a NON-repeatable quest whose id
    // IS in questsDone must stay gold at this surface too. The classifier
    // owns the rule; this arm reddens a plate that branched on
    // questsDone.has(id) directly instead of asking it.
    const attuneId = 'q_prof_attune_smith';
    const plain = harness({ state: 'available', done: [attuneId], questIds: [attuneId] });
    plain.painter.update(true);
    expectMarker(plain.painter, '!', 'quest');
  });

  it("keeps the gold '?' for a ready turn-in and the gray '?' for an active one", () => {
    const ready = harness({ state: 'ready', done: true });
    ready.painter.update(true);
    expectMarker(ready.painter, '?', 'quest');

    const active = harness({ state: 'active' });
    active.painter.update(true);
    expectMarker(active.painter, '?', 'active');
  });

  it("shows the blue '!' once the repeatable has been completed at least once", () => {
    const { painter } = harness({ state: 'available', done: true });
    painter.update(true);
    expectMarker(painter, '!', 'repeat');
  });

  it("shows the dimmed '!' inside the cadence window, and nothing without the mirror", () => {
    const blocked = harness({ state: 'unavailable', done: true, cadenceBlocked: true });
    blocked.painter.update(true);
    expectMarker(blocked.painter, '!', 'cooldown');

    // An older server payload (no cadenceBlockedQuests) degrades to today's
    // no-marker plate rather than guessing.
    const bare = harness({ state: 'unavailable', done: true });
    bare.painter.update(true);
    expectMarker(bare.painter, '', 'none');
  });

  it("folds across an NPC's quests: a ready turn-in beats a completed repeatable", () => {
    // Acceptance (c) at THIS surface: the per-surface fold (accumulator plus
    // the break on ready) runs over more than one quest, not just the
    // classifier unit. The work order's giver also gives the attune quest,
    // and its ready '?' must win the plate over the repeat-blue offer.
    // BOTH orders: with the ready quest first, a fold degenerated to
    // last-value-wins answers 'repeat' (the mutation round proved the
    // ready-last order alone leaves exactly that mutant green).
    const attuneId = 'q_prof_attune_smith';
    for (const questIds of [
      [attuneId, WORK_ORDER.id],
      [WORK_ORDER.id, attuneId],
    ]) {
      const { painter } = harness({
        state: 'unavailable',
        done: true,
        questIds,
        questStates: { [WORK_ORDER.id]: 'available', [attuneId]: 'ready' },
      });
      painter.update(true);
      expectMarker(painter, '?', 'quest', questIds.join(','));
    }
  });

  it('renders the gray in-progress state over a cooldown mark: the documented divergence', () => {
    // The nameplate is the ONE surface that renders 'active', and at its
    // shared rank the gray '?' beats the dimmed '!' (an in-progress turn-in
    // here is the more actionable signal). The minimap and map filter
    // 'active' per quest instead and show the cooldown mark for the same
    // state; tests/quest_marker_surface_agreement.test.ts pins their side.
    const attuneId = 'q_prof_attune_smith';
    const { painter } = harness({
      state: 'unavailable',
      done: true,
      cadenceBlocked: true,
      questIds: [WORK_ORDER.id, attuneId],
      questStates: { [attuneId]: 'active' },
    });
    painter.update(true);
    expectMarker(painter, '?', 'active');
  });

  it('heals a REPLACED questsDone set immediately, even on a throttled pass', () => {
    // Online, ClientWorld REPLACES the whole Set per qdone snapshot rather
    // than mutating it in place (the offline shape). The snapshot's identity
    // re-check must drop the cached context, so a completion flips the plate
    // on the very next pass, full or throttled: the harness NPC sits inside
    // NAMEPLATE_URGENT_RANGE, so update(false) reaches the content branch.
    const { painter, world } = harness({ state: 'available' });
    painter.update(true);
    expectMarker(painter, '!', 'quest');
    (world as unknown as { questsDone: Set<string> }).questsDone = new Set([WORK_ORDER.id]);
    painter.update(false);
    expectMarker(painter, '!', 'repeat');
  });

  it('reuses the snapshot for a cprof-only change until the next full pass: the bounded lag', () => {
    // A fresh turn-in flips the quest state live, but the cadence mirror
    // rides the cached snapshot (questsDone identity unchanged), so a
    // throttled pass blanks the plate for one interval instead of dimming:
    // the one-interval bound the field comment documents. Deleting the
    // cache (resolving fresh every pass) would dim here and redden this
    // arm; the next full pass re-resolves and dims.
    const { painter, world } = harness({ state: 'available', done: true });
    painter.update(true);
    expectMarker(painter, '!', 'repeat');
    (world as unknown as { questState: () => string }).questState = () => 'unavailable';
    (world.craftingIdentity as unknown as { cadenceBlockedQuests: string[] }).cadenceBlockedQuests =
      [WORK_ORDER.id];
    painter.update(false);
    expectMarker(painter, '', 'none');
    painter.update(true);
    expectMarker(painter, '!', 'cooldown');
  });

  it('repaints on a LIVE gold-to-blue transition: the marker rides every full pass', () => {
    // The first completion of a work order happens while its giver's plate
    // is on screen; resolveContent must recompute marker and markerTone on
    // every full pass (the ai-tag lesson, applied to this branch), or the
    // plate keeps the gold '!' until something else changes.
    const { painter, world } = harness({ state: 'available' });
    painter.update(true);
    expectMarker(painter, '!', 'quest');
    (world as unknown as { questsDone: Set<string> }).questsDone.add(WORK_ORDER.id);
    painter.update(true);
    expectMarker(painter, '!', 'repeat');

    // The reverse transitions ride the same recompute (and the per-full-pass
    // context refresh): a fresh turn-in arms the window (blue to dimmed),
    // and expiry returns the blue offer.
    (world as unknown as { questState: () => string }).questState = () => 'unavailable';
    (world.craftingIdentity as unknown as { cadenceBlockedQuests: string[] }).cadenceBlockedQuests =
      [WORK_ORDER.id];
    painter.update(true);
    expectMarker(painter, '!', 'cooldown');
    (world as unknown as { questState: () => string }).questState = () => 'available';
    (world.craftingIdentity as unknown as { cadenceBlockedQuests: string[] }).cadenceBlockedQuests =
      [];
    painter.update(true);
    expectMarker(painter, '!', 'repeat');
  });
});
