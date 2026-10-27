import { describe, expect, it, vi } from 'vitest';

// The Guardian of the Quench's fight rides existing entity fields only
// (src/sim/encounters/smith_heart/quench_ids.ts): each player's cold bar (an
// aura's value and trend), the huddle's warmth, the freeze and the water
// (auras), the shore ice's slabs, the cracks and the holes (objects, their
// radius in scale), the Smith's four blades (their state in the template,
// their place and facing), the echoes' footprints (the attack's facing and
// reach), heroic's crossing lane and the blades in flight. This drives the
// REAL server snapshot path into the real online mirror (ClientWorld, on the
// browser's stable timer wire) and checks each one arrives. Db is mocked so no
// Postgres runs (mirrors afk_wire.test.ts).
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadAccountFlair: vi.fn(async () => null),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer } from '../server/game';
import {
  bladeStateOf,
  echoOf,
  laneOf,
  QUENCH_AURAS,
  QUENCH_GUARDIAN,
  QUENCH_OBJECTS,
  QUENCH_TUNING as T,
} from '../src/sim/encounters/smith_heart/quench_ids';
import { STABLE_TIMER_WIRE_VERSION } from '../src/world_api';
import { bareClient } from './helpers/bare_client';

// biome-ignore lint/suspicious/noExplicitAny: the in-process server idiom (afk_wire.test.ts)
type Any = any;

function joinAt(server: Any, id: number, name: string, stable: boolean) {
  const frames: Any[] = [];
  const ws = {
    readyState: 1,
    send: (payload: string) => {
      const m = JSON.parse(payload);
      if (m.t === 'snap') frames.push(m);
    },
  };
  const session = server.join(ws, id, id, name, 'warrior', null, false, {
    ...(stable ? { timerWireVersion: STABLE_TIMER_WIRE_VERSION } : {}),
  });
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return { session, pid: session.pid as number, frames };
}

describe('the Guardian of the Quench over the wire', () => {
  it('reaches the online mirror: the cold, the ice, the water, the blades, the echoes and the crossing', () => {
    const saved = process.env.ALLOW_DEV_COMMANDS;
    process.env.ALLOW_DEV_COMMANDS = '1';
    let server: Any;
    try {
      server = new GameServer();
    } finally {
      if (saved === undefined) delete process.env.ALLOW_DEV_COMMANDS;
      else process.env.ALLOW_DEV_COMMANDS = saved;
    }
    const sim = server.sim;
    const a = joinAt(server, 1, 'Aleph', false);
    const b = joinAt(server, 2, 'Bet', true);
    sim.partyInvite(b.pid, a.pid);
    sim.partyAccept(b.pid);
    for (const p of [a, b]) {
      sim.setPlayerLevel(20, p.pid);
      sim.chat('/dev heart enter', p.pid);
      sim.chat('/dev heart tp lake', p.pid);
      sim.chat('/dev god', p.pid);
    }
    sim.chat('/dev heart quench pull', a.pid);
    const client: Any = bareClient(b.pid);
    const run = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 20); i++) {
        sim.tick();
        server.broadcastSnapshots();
        for (const f of b.frames.splice(0)) client.applySnapshot(f);
      }
    };
    const onClient = (pred: (e: Any) => boolean) =>
      [...client.entities.values()].filter((e: Any) => pred(e)) as Any[];
    const objects = (prefix: string) =>
      onClient((e) => e.kind === 'object' && e.templateId.startsWith(prefix));
    const me = () => client.entities.get(b.pid);
    const serverMe = sim.entities.get(b.pid);
    const aura = (e: Any, id: string) => e.auras.find((x: Any) => x.id === id);
    run(1);

    // The shore ice rising, then standing.
    expect(objects(QUENCH_OBJECTS.rimRise).length).toBe(28);
    run(T.rimRise + 0.5);
    const rim = onClient((e) => e.kind === 'object' && e.templateId === QUENCH_OBJECTS.rim);
    expect(rim.length).toBe(28);
    const slab = sim.entities.get(rim[0].id);
    expect(rim[0].facing).toBeCloseTo(slab.facing, 1);

    // The cold bar: its value and trend as the server holds them.
    run(2);
    const sCold = aura(serverMe, QUENCH_AURAS.cold);
    const cCold = aura(me(), QUENCH_AURAS.cold);
    expect(cCold).toBeDefined();
    expect(cCold.value).toBe(sCold.value);
    expect(cCold.value2).toBe(sCold.value2);
    sim.chat('/dev heart quench cold 70', b.pid);
    run(0.3);
    expect(aura(me(), QUENCH_AURAS.cold).value).toBeGreaterThanOrEqual(70);

    // A freeze: the stun on the mirror.
    sim.chat('/dev heart quench burst', b.pid);
    run(0.3);
    expect(aura(me(), QUENCH_AURAS.frozen)?.kind).toBe('stun');
    run(T.freezeSeconds + 0.5);
    expect(aura(me(), QUENCH_AURAS.brittle)).toBeDefined();

    // A crack, then a hole under the second raider, who is held in it.
    sim.chat('/dev heart quench crack', a.pid);
    run(0.3);
    const crack = objects(QUENCH_OBJECTS.crackPrefix)[0];
    expect(crack?.scale).toBe(T.holeR);
    sim.chat('/dev heart quench hole', b.pid);
    run(0.3);
    const holes = objects(QUENCH_OBJECTS.hole);
    expect(holes.length).toBeGreaterThan(0);
    expect(holes.every((h: Any) => h.scale === T.holeR)).toBe(true);
    expect(aura(me(), QUENCH_AURAS.trapped)?.kind).toBe('root');
    run(T.trapSeconds + 0.5);
    expect(aura(me(), QUENCH_AURAS.trapped)).toBeUndefined();
    // The climb out lands where the server put it.
    expect(Math.hypot(me().pos.x - serverMe.pos.x, me().pos.z - serverMe.pos.z)).toBeLessThan(0.5);

    // The blades: sunk, then awake and floating.
    expect(objects(QUENCH_OBJECTS.bladePrefix).map((e: Any) => bladeStateOf(e.templateId))).toEqual(
      ['sunk', 'sunk', 'sunk', 'sunk'],
    );
    sim.chat('/dev heart quench blades', a.pid);
    run(0.5);
    for (const e of objects(QUENCH_OBJECTS.bladePrefix))
      expect(bladeStateOf(e.templateId)).toBe('float');
    const boss = onClient((e) => e.kind === 'mob' && e.templateId === QUENCH_GUARDIAN)[0];
    expect(aura(boss, QUENCH_AURAS.awake)).toBeDefined();

    // An echoed breath: four footprints, the guardian's facing, the reach.
    sim.chat('/dev heart quench breath', a.pid);
    run(0.3);
    const serverBoss = sim.entities.get(boss.id);
    const facing = serverBoss.smithHeartQuench.bar.facing;
    const echoes = objects(QUENCH_OBJECTS.echoPrefix).filter(
      (e: Any) => echoOf(e.templateId)?.kind === 'breath',
    );
    expect(echoes.length).toBe(4);
    for (const e of echoes) {
      expect(e.facing).toBeCloseTo(facing, 1);
      expect(e.scale).toBe(T.breathRange);
    }
    run(T.breathCast + T.echoDelay + 0.2);
    expect(
      objects(QUENCH_OBJECTS.echoPrefix).some((e: Any) => echoOf(e.templateId)?.hit === true),
    ).toBe(true);

    // Heroic's crossing: the lane, the blades in flight and their swap.
    sim.chat('/dev heart quench heroic', a.pid);
    sim.chat('/dev heart quench dance', a.pid);
    run(0.3);
    const lane = objects(QUENCH_OBJECTS.lanePrefix)[0];
    expect(laneOf(lane.templateId)?.state).toBe('warn');
    run(T.danceWarn + 0.3);
    const flying = objects(QUENCH_OBJECTS.bladePrefix).filter(
      (e: Any) => bladeStateOf(e.templateId) === 'fly',
    );
    expect(flying.length).toBe(2);
    const p0 = { ...flying[0].pos };
    run(0.4);
    expect(Math.hypot(flying[0].pos.x - p0.x, flying[0].pos.z - p0.z)).toBeGreaterThan(2);
    const serverBlade = sim.entities.get(flying[0].id);
    expect(
      Math.hypot(flying[0].pos.x - serverBlade.pos.x, flying[0].pos.z - serverBlade.pos.z),
    ).toBeLessThan(2.5);
    run(T.danceFly + T.laneCrack + 0.5);
    expect(objects(QUENCH_OBJECTS.lanePrefix)).toEqual([]);
    for (const e of objects(QUENCH_OBJECTS.bladePrefix))
      expect(bladeStateOf(e.templateId)).toBe('float');
  });
});
