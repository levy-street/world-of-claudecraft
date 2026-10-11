import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/sim/world', () => ({ groundHeight: () => 0 }));
vi.mock('../src/ui/world_quest_trace_view', () => ({
  worldQuestTraceRatingLabel: (rating: string) => `localized-${rating}`,
}));

import type { PublicTraceReader } from '../src/render/world_quest_public_trace_core';
import { WorldQuestTraceLabels } from '../src/render/world_quest_trace_labels';
import type { NearbyWorldQuestTrace } from '../src/sim/world_quest_trace_public';

describe('public glyph completion labels', () => {
  it('draws localized medals and raw proper names on the shared surface only while success exists', () => {
    const trace: NearbyWorldQuestTrace = {
      pid: 2,
      name: 'Writer2',
      questId: 'wq_eastbrook_calligraphy',
      shapeIndex: 2,
      variant: 'star',
      phase: 'success',
      score: 97,
      rating: 'gold',
      expiresAt: 5,
      trail: [],
    };
    const world: PublicTraceReader & { cfg: { seed: number } } = {
      cfg: { seed: 1 },
      nearbyWorldQuestTraces: [trace],
      player: { id: 1, pos: { x: 172, y: 0, z: -28 } },
      entities: new Map([
        [
          2,
          {
            id: 2,
            kind: 'player',
            name: 'Writer2',
            hostile: false,
            dead: false,
            pos: { x: 172, y: 0, z: -28 },
          },
        ],
      ]),
    };
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(172, 20, -5);
    camera.lookAt(172, 0, -27);
    camera.updateMatrixWorld();
    const drawBase = vi.fn();
    const labels = new WorldQuestTraceLabels();
    labels.draw(world, { drawBase }, camera, 800, 800);
    expect(drawBase).toHaveBeenCalledTimes(1);
    expect(drawBase.mock.calls[0][0]).toMatchObject({
      name: 'Writer2',
      title: 'localized-gold',
      aiLabel: '',
      hpVisible: false,
    });
    const state = drawBase.mock.calls[0][0];
    drawBase.mockClear();
    labels.draw(world, { drawBase }, camera, 800, 800);
    expect(drawBase.mock.calls[0][0]).toBe(state);
    world.nearbyWorldQuestTraces = [{ ...trace, phase: 'drawing' }];
    drawBase.mockClear();
    labels.draw(world, { drawBase }, camera, 800, 800);
    expect(drawBase).not.toHaveBeenCalled();
    world.nearbyWorldQuestTraces = [];
    labels.draw(world, { drawBase }, camera, 800, 800);
    expect(drawBase).not.toHaveBeenCalled();
  });
});
