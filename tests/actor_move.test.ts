import { describe, expect, it, vi } from 'vitest';
import { fastForwardActorMoves, placeActorAtMoveEndpoint } from '../src/sim/scenes/actor_move';
import type { SceneOpDef } from '../src/sim/scenes/registry';
import type { SimContext } from '../src/sim/sim_context';
import type { SquadRun } from '../src/sim/squad/squad';
import type { Entity } from '../src/sim/types';

function fixture() {
  const actor = {
    id: 7,
    pos: { x: 0, y: 0, z: 0 },
    prevPos: { x: -1, y: -1, z: -1 },
  } as Entity;
  const run: SquadRun = {
    claimId: 12,
    dungeonId: 'test',
    actorIds: new Map([['tam', actor.id]]),
    directives: new Map(),
    floorEnabled: true,
    damageMult: 1,
  };
  const rebucket = vi.fn();
  const rngNext = vi.fn();
  const ctx = {
    entities: new Map([[actor.id, actor]]),
    squadRuns: new Map([[run.claimId, run]]),
    groundPos: (x: number, z: number) => ({ x, y: x - z, z }),
    rebucket,
    rng: { next: rngNext },
  } as unknown as SimContext;
  return { actor, ctx, rebucket, rngNext, run };
}

describe('scene actor move convergence', () => {
  it('places the actor, previous pose, directive, and spatial bucket immediately', () => {
    const { actor, ctx, rebucket, rngNext, run } = fixture();

    placeActorAtMoveEndpoint(ctx, run.claimId, 'tam', 4, -3);

    expect(run.directives.get('tam')).toEqual({ kind: 'hold', x: 4, z: -3 });
    expect(actor.pos).toEqual({ x: 4, y: 7, z: -3 });
    expect(actor.prevPos).toEqual(actor.pos);
    expect(actor.prevPos).not.toBe(actor.pos);
    expect(rebucket).toHaveBeenCalledWith(actor);
    expect(rngNext).not.toHaveBeenCalled();
  });

  it('settles each actor at its last authored endpoint without rng', () => {
    const { actor, ctx, rebucket, rngNext, run } = fixture();
    const ops: SceneOpDef[] = [
      { at: 0.5, kind: 'actorMove', actorId: 'tam', x: 1, z: 2 },
      { at: 0.75, kind: 'line', speaker: '', key: 'line' },
      { at: 1, kind: 'actorMove', actorId: 'tam', x: -2, z: 5 },
    ];

    fastForwardActorMoves(ctx, run.claimId, { x: 100, z: 200 }, ops);

    expect(run.directives.get('tam')).toEqual({ kind: 'hold', x: 98, z: 205 });
    expect(actor.pos).toEqual({ x: 98, y: -107, z: 205 });
    expect(actor.prevPos).toEqual(actor.pos);
    expect(rebucket).toHaveBeenCalledTimes(2);
    expect(rngNext).not.toHaveBeenCalled();
  });
});
