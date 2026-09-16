import type * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { type GuideWorld, IslandGuidance } from '../src/render/island_guidance';
import { EASTBROOK_NPC_PLACEMENTS_BY_ID } from '../src/sim/eastbrook_layout';

const calls = vi.hoisted(() => ({ update: vi.fn(), construct: vi.fn() }));
vi.mock('../src/render/coach_trail', () => ({
  CoachTrail: class {
    constructor() {
      calls.construct();
    }
    update = calls.update;
  },
}));

it('uses one trail and clears every visual when the injected tracking choice changes', () => {
  let tracked = true;
  let enabled = true;
  const guidance = new IslandGuidance(
    {} as THREE.Object3D,
    () => 0,
    undefined,
    () => tracked,
    () => enabled,
  );
  const world: GuideWorld = {
    player: { pos: { x: -55, z: -102 } },
    questLog: new Map([['q_wolves', { state: 'active' }]]),
    questState: () => 'unavailable',
    entities: new Map(),
  };
  guidance.update(world, 1, 0.05);
  expect(calls.update.mock.lastCall?.[0]?.key).toBe('wolves:active');
  world.questLog = new Map([['q_wolves', { state: 'ready' }]]);
  guidance.update(world, 2, 0.05);
  expect(calls.update.mock.lastCall?.[0]?.key).toBe('wolves:ready');
  expect(calls.update.mock.lastCall?.[1]).toEqual(
    EASTBROOK_NPC_PLACEMENTS_BY_ID.marshal_redbrook.position,
  );
  tracked = false;
  guidance.update(world, 3, 0.05);
  expect(calls.update.mock.lastCall?.slice(0, 4)).toEqual([null, null, null, null]);
  tracked = true;
  enabled = false;
  guidance.update(world, 4, 0.05);
  expect(calls.update.mock.lastCall?.slice(0, 4)).toEqual([null, null, null, null]);
  const vfx = { castSparkle: vi.fn() };
  guidance.npcFizz(world, { id: 123, templateId: 'marshal_redbrook' }, vfx, 4, 0.05);
  expect(vfx.castSparkle).not.toHaveBeenCalled();
  enabled = true;
  world.questLog = new Map();
  world.questState = () => 'available';
  guidance.npcFizz(world, { id: 123, templateId: 'marshal_redbrook' }, vfx, 5, 0.05);
  expect(vfx.castSparkle).toHaveBeenCalledWith(123, 'holy', 0.05 * 3, 0xffd766);
  expect(calls.construct).toHaveBeenCalledTimes(1);
});
