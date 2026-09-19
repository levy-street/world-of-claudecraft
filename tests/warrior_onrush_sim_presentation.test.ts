import { expect, it, vi } from 'vitest';
import { ArchetypeSequencer, type SequencerHost } from '../src/render/ability_vfx/sequencer';
import type { AnimState } from '../src/render/characters/anim_state';
import {
  createOnrushArrivalHandler,
  onrushArrivalAllowed,
  WarriorRushPose,
} from '../src/render/characters/warrior_rush_pose';
import { newLocoTrack, updateLocomotion } from '../src/render/locomotion';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';
import { DT, type Entity, MELEE_RANGE } from '../src/sim/types';
import { StudioSession } from '../src/vfx_studio/session';
import { stageStudioCast } from '../src/vfx_studio/stage_cast';

it.each(['arms', 'fury', 'prot'])(
  'real %s Onrush reaches its native stop and plays exactly one planted finish',
  (spec) => {
    const session = new StudioSession({ cls: 'warrior', spec, seed: 42, scene: 'sandbox' });
    const sim = session.sim;
    const targetId = stageStudioCast(sim, 'charge', session.targetIds[0]);
    const player = sim.player,
      target = sim.entities.get(targetId)!;
    const pose = new WarriorRushPose();
    let arrivals = 0,
      finishes = 0;
    const host = new Proxy(
      {
        anchorOf: (id: number, _fraction: number, out = { x: 0, y: 0, z: 0 }) => {
          const entity = sim.entities.get(id);
          return entity ? Object.assign(out, entity.pos) : null;
        },
        groundYAt: () => 0,
        quality: () => 1,
        timeNow: () => sim.time,
        overlayCells: () => ({ glow: 0, star: 1, rune: 2, spark: 3 }),
        onRushArrival: (sourceId: number, destinationId: number) => {
          if (!onrushArrivalAllowed(sim.entities.get(sourceId), sim.entities.get(destinationId)))
            return false;
          arrivals++;
          pose.arrive();
          return true;
        },
      },
      { get: (object, key) => Reflect.get(object, key) ?? (() => undefined) },
    ) as unknown as SequencerHost;
    const seq = new ArchetypeSequencer();
    const events = session.dispatch({ kind: 'cast', abilityId: 'charge', targetId });
    expect(events.some((event) => event.type === 'spellfx' && event.ability === 'charge')).toBe(
      true,
    );
    pose.begin('charge');
    seq.start(
      host,
      'charge',
      WARRIOR_VFX_FULL_SPECS.charge,
      player.id,
      targetId,
      0xffffff,
      0,
      false,
    );
    const track = newLocoTrack();
    let x = player.pos.x,
      z = player.pos.z;
    for (let tick = 0; tick < 30; tick++) {
      session.tick();
      const vx = player.pos.x - x,
        vz = player.pos.z - z;
      x = player.pos.x;
      z = player.pos.z;
      const loco = updateLocomotion(track, vx, vz, player.facing, DT);
      pose.update(DT, { ...loco, rawMoving: Math.hypot(vx, vz) / DT > 0.4 } as AnimState);
      if (pose.arrivalStarted) finishes++;
      seq.update(host, DT);
    }
    const gap = Math.hypot(player.pos.x - target.pos.x, player.pos.z - target.pos.z);
    // This is the actual engine stop the previous <2.5 VFX test never reached.
    expect(gap).toBeGreaterThan(2.5);
    expect(gap).toBeLessThanOrEqual(MELEE_RANGE - 1);
    expect(arrivals).toBe(1);
    expect(finishes).toBe(1);
    expect(pose.ownsBody).toBe(false);
    expect(player.autoAttack).toBe(true);
    expect(target.hp).toBeLessThan(target.maxHp);
  },
);

it('an in-range interruption or dead/missing recipient never authorizes a successful arrival', () => {
  const source = { dead: false, auras: [] } as unknown as Entity;
  const target = { dead: false } as Entity;
  expect(onrushArrivalAllowed(source, target)).toBe(true);
  expect(onrushArrivalAllowed(undefined, target)).toBe(false);
  expect(onrushArrivalAllowed(source, undefined)).toBe(false);
  expect(onrushArrivalAllowed(source, { ...target, dead: true })).toBe(false);
  expect(onrushArrivalAllowed({ ...source, dead: true }, target)).toBe(false);
  expect(onrushArrivalAllowed({ ...source, auras: [{ kind: 'root' } as never] }, target)).toBe(
    false,
  );
  expect(onrushArrivalAllowed({ ...source, auras: [{ kind: 'stun' } as never] }, target)).toBe(
    false,
  );
});

it.each(['alive', 'dead source', 'dead target', 'rooted', 'missing source', 'missing target'])(
  'a reused renderer resolves the current entity map after a session swap: %s',
  (state) => {
    const source = { id: 1, dead: false, auras: [] } as unknown as Entity;
    const target = { id: 2, dead: false, auras: [] } as unknown as Entity;
    const previousAllowed = state !== 'alive';
    let entities = new Map([
      [1, { ...source, dead: !previousAllowed }],
      [2, target],
    ]);
    const entitiesNow = vi.fn(() => entities);
    const arriveFromOnrush = vi.fn(() => true);
    const handler = createOnrushArrivalHandler(
      entitiesNow,
      new Map([[1, { arriveFromOnrush }]]),
      (view) => view,
    );
    expect(entitiesNow).not.toHaveBeenCalled();
    expect(handler(1, 2)).toBe(previousAllowed);

    // Studio keeps the renderer but replaces the world, reusing entity IDs.
    entities = new Map([
      [1, { ...source }],
      [2, { ...target }],
    ]);
    if (state === 'dead source') entities.get(1)!.dead = true;
    if (state === 'dead target') entities.get(2)!.dead = true;
    if (state === 'rooted') entities.get(1)!.auras = [{ kind: 'root' } as never];
    if (state === 'missing source') entities.delete(1);
    if (state === 'missing target') entities.delete(2);
    expect(handler(1, 2)).toBe(state === 'alive');
    expect(entitiesNow).toHaveBeenCalledTimes(2);
    expect(arriveFromOnrush).toHaveBeenCalledTimes(1);
  },
);
