import { describe, expect, it, vi } from 'vitest';
import { drainDelayedEvents } from '../src/sim/entity_roster';
import { throwLance } from '../src/sim/lance_throw';
import { LANCE_THROW_RELEASE } from '../src/sim/lance_throw_timing';
import { advancePendingProjectiles } from '../src/sim/projectile_travel';
import type { SimContext } from '../src/sim/sim_context';
import { DT, type Entity, type SimEvent } from '../src/sim/types';

function setup() {
  const source = { id: 1, pos: { x: 0, y: 0, z: 0 }, dead: false } as Entity;
  const target = { id: 2, pos: { x: 12, y: 0, z: 0 }, dead: false } as Entity;
  const events: SimEvent[] = [];
  const ctx = {
    time: 0,
    entities: new Map([
      [1, source],
      [2, target],
    ]),
    players: new Map([[1, { equipment: { mainhand: 'skerrits_shardpike' } }]]),
    delayedEvents: [],
    pendingProjectiles: [],
    emit: (ev: SimEvent) => events.push(ev),
  } as unknown as Omit<SimContext, 'time'> & { time: number };
  const impact = vi.fn();
  const step = () => {
    ctx.time += DT;
    advancePendingProjectiles(ctx);
    drainDelayedEvents(ctx);
  };
  throwLance(ctx, source, target, impact);
  return { ctx, source, target, events, impact, step };
}

describe('Shardpike authoritative throw', () => {
  it('announces to observers, winds up, flies and impacts exactly once', () => {
    const h = setup();
    expect(h.events).toMatchObject([{ type: 'spellfx', fx: 'windup', sourceId: 1, targetId: 2 }]);
    expect(h.events.every((event) => !('pid' in event))).toBe(true);
    h.ctx.time = LANCE_THROW_RELEASE - DT;
    drainDelayedEvents(h.ctx);
    expect(h.ctx.pendingProjectiles).toHaveLength(0);
    h.ctx.time = LANCE_THROW_RELEASE;
    drainDelayedEvents(h.ctx);
    expect(h.ctx.pendingProjectiles).toHaveLength(1);
    expect(h.impact).not.toHaveBeenCalled();
    for (let i = 0; i < 80; i++) h.step();
    expect(h.impact).toHaveBeenCalledExactlyOnceWith(h.source, h.target);
    expect(h.events.map((event) => event.type === 'spellfx' && event.fx)).toEqual([
      'windup',
      'projectile',
      'ccImpact',
    ]);
    expect(h.ctx.pendingProjectiles).toHaveLength(0);
    expect(h.ctx.delayedEvents).toHaveLength(0);
  });
  it.each([
    'caster death',
    'ghost',
    'target death',
    'target despawn',
    'disconnect',
    'weapon change',
  ])('cancels before release: %s', (reason) => {
    const h = setup();
    if (reason === 'caster death') h.source.dead = true;
    if (reason === 'ghost') h.source.ghost = true;
    if (reason === 'target death') h.target.dead = true;
    if (reason === 'target despawn') h.ctx.entities.delete(2);
    if (reason === 'disconnect') h.ctx.entities.delete(1);
    if (reason === 'weapon change') {
      const meta = h.ctx.players.get(1);
      if (!meta) throw new Error('Missing caster metadata');
      meta.equipment.mainhand = undefined;
    }
    for (let i = 0; i < 80; i++) h.step();
    expect(h.impact).not.toHaveBeenCalled();
    expect(h.events).toHaveLength(1);
  });
  it('homes on a moving boss rather than awarding an early hit at its old position', () => {
    const h = setup();
    h.ctx.time = LANCE_THROW_RELEASE;
    drainDelayedEvents(h.ctx);
    h.target.pos.x = 30;
    for (let i = 0; i < 10; i++) h.step();
    expect(h.impact).not.toHaveBeenCalled();
    for (let i = 0; i < 20; i++) h.step();
    expect(h.impact).toHaveBeenCalledOnce();
  });
  it('fizzles if the boss despawns in flight', () => {
    const h = setup();
    h.ctx.time = LANCE_THROW_RELEASE;
    drainDelayedEvents(h.ctx);
    h.ctx.entities.delete(2);
    h.step();
    expect(h.impact).not.toHaveBeenCalled();
    expect(h.ctx.pendingProjectiles).toHaveLength(0);
  });
});
