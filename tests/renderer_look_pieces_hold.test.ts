// The live candidate path for composed looks whose pieces are not resident
// (src/render/characters/look_pieces.ts): the entity's body builds NOW without
// its face decals (the stand-in is the body itself: nameplate, click target
// and silhouette on the frame it enters range, never an invisible player), the
// pieces are enqueued, and the decals attach once they land; the local target
// and a covered frame build whole and synchronously as before; the manifest
// path (a deadline-bearing call) never defers.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetArrivalCoverForTest, setArrivalCover } from '../src/render/arrival_cover';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import { type AssembleOptions, setModularLookProvider } from '../src/render/characters';
import {
  DECAL_ATTACH_LABEL,
  lookPiecesStats,
  resetLookPiecesForTest,
  STUBBLE_BAND_LABEL,
} from '../src/render/characters/look_pieces';
import { DEFAULT_APPEARANCE, type ModularLook } from '../src/render/characters/modular';
import { decalKey, hasDecalTexture } from '../src/render/characters/stubble';
import { makeQuestObjectGate } from '../src/render/quest_object_gate_core';
import { Renderer } from '../src/render/renderer';
import type { Entity } from '../src/sim/types';

const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

function entity(id: number, kind: Entity['kind'], templateId = 'warrior'): Entity {
  return {
    id,
    kind,
    templateId,
    targetId: null,
    pos: { x: id, y: 0, z: 0 },
    hp: 1,
    maxHp: 1,
    dead: false,
  } as unknown as Entity;
}

// A never-seen style pair so the deferral is real: nothing in this process
// has painted it (look_pieces.test.ts uses other pairs).
const LOOK: ModularLook = {
  app: { ...DEFAULT_APPEARANCE, hair: 'crew', beard: 'scruff', blush: 'none', eyeshadow: 'none' },
  worn: {},
};
const SEL = { scalp: 'crew', beard: 'scruff' } as const;

interface DeferRenderer {
  createCandidateViews(
    limit: number,
    createdViewTypes: string[],
    deadlineMs?: number,
    deferLooks?: boolean,
  ): { created: number; trimmed: boolean };
}

interface FakeVisual {
  attachDeferredDecals: ReturnType<typeof vi.fn>;
}

function rendererFor(entities: Entity[], targetId: number | null) {
  const player = entity(1, 'player');
  player.targetId = targetId;
  const map = new Map(entities.map((e) => [e.id, e]));
  const views = new Map<number, { visual: FakeVisual }>();
  const runs: { label: string; priority: number }[] = [];
  const visuals = new Map<number, FakeVisual>();
  // the view build as the renderer sees it: a visual per entity, built with
  // the options the candidate path chose
  const createView = vi.fn((e: Entity, opts?: AssembleOptions) => {
    const visual: FakeVisual = { attachDeferredDecals: vi.fn(() => !!opts?.deferDecals) };
    visuals.set(e.id, visual);
    views.set(e.id, { visual });
  });
  const renderer = Object.create(Renderer.prototype) as Record<string, unknown> & DeferRenderer;
  renderer.sim = { entities: map, player, questLog: new Map() };
  renderer.views = views;
  renderer.questObjectHidden = makeQuestObjectGate({});
  renderer.viewCreateRetry = { canAttempt: () => true };
  renderer.createView = createView;
  renderer.viewCandidates = entities.map((e) => ({ id: e.id, d2: e.id, priority: 0 }));
  renderer.backgroundGpuWork = {
    run: (work: () => unknown, priority: number, label: string) => {
      runs.push({ label, priority });
      return Promise.resolve(work());
    },
  };
  return { renderer, createView, views, visuals, runs };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('composed looks on the live candidate path build without their decals, then attach', () => {
  beforeEach(() => {
    resetLookPiecesForTest();
    resetArrivalCoverForTest();
    // every player composes with the never-seen look; mobs keep their rig
    setModularLookProvider((e) => (e.kind === 'player' ? LOOK : null));
  });
  afterEach(() => {
    setModularLookProvider(null);
    resetArrivalCoverForTest();
  });

  it('builds an unready look at once without decals, the target whole, and attaches the decals once the pieces land', async () => {
    expect(hasDecalTexture(SEL)).toBe(false);
    const peer = entity(2, 'player');
    const target = entity(3, 'player');
    const mob = entity(4, 'mob', 'forest_wolf');
    const { renderer, createView, visuals, runs } = rendererFor([peer, target, mob], target.id);
    const pass = renderer.createCandidateViews(4, [], Infinity, true);
    // every candidate got a body this pass: nothing waits invisible
    expect(pass).toEqual({ created: 3, trimmed: false });
    expect(createView.mock.calls).toEqual([[peer, { deferDecals: true }], [target], [mob]]);
    // the peer's pieces are on the queue at LIVE_VIEW, the deferral counted
    expect(lookPiecesStats()).toMatchObject({ pending: 1, deferred: 1, attached: 0 });
    expect(runs[0]).toEqual({
      label: `${STUBBLE_BAND_LABEL}:${decalKey(SEL)}:0`,
      priority: GPU_WORK_PRIORITY.LIVE_VIEW,
    });
    // nothing attaches before the pieces land
    const peerVisual = visuals.get(peer.id);
    expect(peerVisual?.attachDeferredDecals).not.toHaveBeenCalled();
    await flush();
    expect(hasDecalTexture(SEL)).toBe(true);
    expect(peerVisual?.attachDeferredDecals).toHaveBeenCalledTimes(1);
    // ...and it ran as a unit of the same queue, admitted like any piece
    expect(runs.at(-1)).toEqual({
      label: `${DECAL_ATTACH_LABEL}:${peer.id}`,
      priority: GPU_WORK_PRIORITY.LIVE_VIEW,
    });
    // the target and the mob were built whole and are never touched again
    expect(visuals.get(target.id)?.attachDeferredDecals).not.toHaveBeenCalled();
    expect(visuals.get(mob.id)?.attachDeferredDecals).not.toHaveBeenCalled();
    // a later peer with the same look is a ready build (a cache hit), no deferral
    const late = entity(5, 'player');
    const next = rendererFor([late], null);
    expect(next.renderer.createCandidateViews(4, [], Infinity, true).created).toBe(1);
    expect(next.createView.mock.calls).toEqual([[late]]);
    expect(lookPiecesStats().deferred).toBe(1);
  });

  it('never attaches onto a view that was replaced or removed while the pieces were in flight', async () => {
    const NEVER_SEEN: ModularLook = {
      app: { ...LOOK.app, hair: 'buzz', beard: 'scruff' },
      worn: {},
    };
    setModularLookProvider((e) => (e.kind === 'player' ? NEVER_SEEN : null));
    const gone = entity(2, 'player');
    const replaced = entity(3, 'player');
    const { renderer, views, visuals } = rendererFor([gone, replaced], null);
    expect(renderer.createCandidateViews(4, [], Infinity, true).created).toBe(2);
    const goneVisual = visuals.get(gone.id);
    const replacedVisual = visuals.get(replaced.id);
    views.delete(gone.id);
    const other: FakeVisual = { attachDeferredDecals: vi.fn() };
    views.set(replaced.id, { visual: other });
    await flush();
    expect(goneVisual?.attachDeferredDecals).not.toHaveBeenCalled();
    expect(replacedVisual?.attachDeferredDecals).not.toHaveBeenCalled();
    expect(other.attachDeferredDecals).not.toHaveBeenCalled();
  });

  it('never defers on the manifest path or under a cover (the synchronous build as today)', () => {
    const NEVER_SEEN: ModularLook = {
      app: { ...LOOK.app, hair: 'crew', beard: 'stubble' },
      worn: {},
    };
    setModularLookProvider((e) => (e.kind === 'player' ? NEVER_SEEN : null));
    expect(hasDecalTexture({ scalp: 'crew', beard: 'stubble' })).toBe(false);
    const peer = entity(2, 'player');
    const manifest = rendererFor([peer], null);
    expect(manifest.renderer.createCandidateViews(4, [], performance.now() + 10_000)).toEqual({
      created: 1,
      trimmed: false,
    });
    expect(manifest.createView).toHaveBeenCalledWith(peer);
    expect(manifest.runs).toEqual([]);
    setArrivalCover(true);
    const covered = rendererFor([peer], null);
    expect(covered.renderer.createCandidateViews(4, [], Infinity, true).created).toBe(1);
    expect(covered.createView.mock.calls).toEqual([[peer]]);
    expect(covered.runs).toEqual([]);
    expect(lookPiecesStats().deferred).toBe(0);
  });

  it('is wired on the runtime call alone (source pin)', () => {
    const runtime = source.indexOf(
      'createdViews += this.createCandidateViews(\n      this.runtimeViewCreateBudget(dt),\n      createdViewTypes,\n      Infinity,\n      true,\n    ).created;',
    );
    expect(runtime).toBeGreaterThan(-1);
    // the manifest call keeps its three arguments
    expect(source).toContain(
      'this.createCandidateViews(\n            nearbyPrewarmViewBudget(policy.maxViews, createdViews, policy.nearbyViewFloor),\n            createdViewTypes,\n            buildDeadline,\n          );',
    );
    // the deferring build takes the slot like any other build
    const loop = source.slice(
      source.indexOf('private createCandidateViews('),
      source.indexOf('private createViewDeferringLook('),
    );
    expect(loop).toContain(
      'if (deferLooks) this.createViewDeferringLook(e);\n      else this.createView(e);\n      sampleCreatedViewType(createdViewTypes, e);\n      created++;',
    );
    const defer = source.slice(
      source.indexOf('private createViewDeferringLook('),
      source.indexOf('\n  }', source.indexOf('private createViewDeferringLook(')),
    );
    expect(defer).toContain('e.id === this.sim.player.targetId || arrivalCoverActive()');
    expect(defer).toContain('GPU_WORK_PRIORITY.LIVE_VIEW');
    expect(defer).toContain('this.createView(e, { deferDecals: true });');
    // the attach lands only on the visual the deferral built, still mounted
    expect(defer).toContain(
      'pieces.attachWhenReady(`${e.id}`, () => {\n      if (this.views.get(e.id)?.visual === visual) visual.attachDeferredDecals();\n    });',
    );
    // the option threads down to the character factory
    expect(source).toContain("this.createCharacterVisualWithRetry(e, 'view', undefined, opts)");
    expect(source).toContain('const visual = createCharacterVisual(e, formKey, opts);');
    expect(source).toContain('lookPieces: lookPiecesStats(),');
  });
});
