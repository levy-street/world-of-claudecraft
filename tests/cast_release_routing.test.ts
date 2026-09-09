import { expect, it, vi } from 'vitest';
import { Renderer } from '../src/render/renderer';
import type { SimEvent } from '../src/sim/types';

it('routes dedicated successful spell cues to their corresponding body action once', () => {
  const r = Object.create(Renderer.prototype) as Renderer & Record<string, any>;
  const releaseGesture = vi.fn(),
    triggerAttack = vi.fn();
  Object.assign(r, {
    abilityVfx: { handleSpellfx: () => false, releaseGesture },
    triggerAttack,
    needleOfFateVfx: { spawn: vi.fn() },
    glacialFrontVisual: { spawn: vi.fn() },
    vfx: { paladinHolyShock: vi.fn() },
    sim: {
      cfg: { seed: 42 },
      entities: new Map([[1, { kind: 'player', pos: { x: 0, y: 0, z: 0 }, facing: 0, auras: [] }]]),
    },
  });
  for (const [fx, ability] of [
    ['projectile', 'needle_of_fate'],
    ['frostCone', 'glacial_front'],
    ['fireCone', 'dragons_breath'],
    ['paladinHolyShock', 'solar_invocation'],
  ])
    r.handleEvent({
      type: 'spellfx',
      sourceId: 1,
      targetId: 2,
      school: 'holy',
      fx,
      ability,
    } as SimEvent);
  expect(releaseGesture.mock.calls).toEqual([
    [1, 'needle_of_fate'],
    [1, 'solar_invocation'],
  ]);
  expect(triggerAttack.mock.calls).toEqual([
    [1, 'glacial_front'],
    [1, 'dragons_breath'],
  ]);
});

it('does not invent an area nova for crowd-control or wound status cues', () => {
  const r = Object.create(Renderer.prototype) as Renderer & Record<string, any>;
  const nova = vi.fn();
  Object.assign(r, {
    abilityVfx: { handleSpellfx: () => false },
    vfx: { nova },
    sim: { cfg: { seed: 42 }, entities: new Map() },
  });
  for (const fx of ['ccImpact', 'fearImpact', 'dotApply'])
    r.handleEvent({
      type: 'spellfx',
      sourceId: 1,
      targetId: 2,
      school: 'physical',
      fx,
      ability: 'blind',
    } as SimEvent);
  expect(nova).not.toHaveBeenCalled();
  r.handleEvent({
    type: 'spellfx',
    sourceId: 1,
    targetId: 2,
    school: 'arcane',
    fx: 'temporalRewindNova',
  } as SimEvent);
  expect(nova).toHaveBeenCalledTimes(1);
});
