import { expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer } from '../server/game';
import { drainDelayedEvents } from '../src/sim/entity_roster';
import { throwLance } from '../src/sim/lance_throw';
import { advancePendingProjectiles } from '../src/sim/projectile_travel';
import type { SimContext } from '../src/sim/sim_context';
import type { SimEvent } from '../src/sim/types';

it('routes the real throw phases to nearby non-party observers, not only its owner', () => {
  const server = new GameServer();
  const join = (id: number, z: number) => {
    const sent: string[] = [];
    const ws = { readyState: 1, bufferedAmount: 0, send: (payload: string) => sent.push(payload) };
    const session = server.join(ws as never, id, id, `Piker${id}`, 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;
    const entity = server.sim.entities.get(session.pid);
    if (!entity) throw new Error('Missing joined player');
    entity.pos = { x: 0, y: 0, z };
    return { sent, entity };
  };
  const caster = join(1, 0),
    target = join(2, 12),
    near = join(3, 20),
    far = join(4, 200);
  const ctx = (server.sim as unknown as { ctx: SimContext }).ctx;
  const meta = ctx.players.get(caster.entity.id);
  if (!meta) throw new Error('Missing metadata');
  meta.equipment.mainhand = 'skerrits_shardpike';
  const events: SimEvent[] = [];
  vi.spyOn(ctx, 'emit').mockImplementation((event) => events.push(event));
  throwLance(ctx, caster.entity, target.entity, () => {});
  for (let i = 0; i < 25; i++) {
    server.sim.time += 0.05;
    advancePendingProjectiles(ctx);
    drainDelayedEvents(ctx);
  }
  for (const client of [caster, target, near, far]) client.sent.length = 0;
  (server as unknown as { routeEvents(events: SimEvent[]): void }).routeEvents(events);
  const phases = (sent: string[]) =>
    sent.flatMap((s) => {
      const f = JSON.parse(s);
      return f.t === 'events' ? f.list.map((e: { fx: string }) => e.fx) : [];
    });
  expect(phases(caster.sent)).toEqual(['windup', 'projectile', 'ccImpact']);
  expect(phases(near.sent)).toEqual(['windup', 'projectile', 'ccImpact']);
  expect(phases(far.sent)).toEqual([]);
  vi.restoreAllMocks();
});
