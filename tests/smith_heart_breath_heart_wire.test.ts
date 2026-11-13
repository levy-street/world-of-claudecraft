import { describe, expect, it, vi } from 'vitest';

// The Knotted Gale over the REAL server snapshot path into the real online mirror
// (ClientWorld): the ball, its fuse and its radius, both portals, the marks and the
// load, the load's speed as the client's own motion kernel reads it, the crossing
// bumping the movement epoch (how the client reconciles a teleport), the throw through
// the ordinary interact command; then phase 2's round, its second pair (C and D)
// mirrored and crossing C to D. Db is mocked (mirrors smith_heart_breath_wire.test.ts).
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
import { updateMovementOverrideEpochs } from '../server/movement_override_epoch';
import {
  BREATH_AURAS,
  BREATH_GUARDIAN,
  BREATH_KNOT,
  BREATH_OBJECTS,
  knotOf,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart/breath_ids';
import { moveSpeedMult } from '../src/sim/player_motion';
import { STABLE_TIMER_WIRE_VERSION } from '../src/world_api';
import { bareClient } from './helpers/bare_client';

// biome-ignore lint/suspicious/noExplicitAny: the in-process server idiom (afk_wire.test.ts)
type Any = any;

function joinAt(server: Any, id: number, name: string) {
  const frames: Any[] = [];
  const ws = {
    readyState: 1,
    send: (payload: string) => {
      const m = JSON.parse(payload);
      if (m.t === 'snap') frames.push(m);
    },
  };
  const session = server.join(ws, id, id, name, 'warrior', null, false, {
    timerWireVersion: STABLE_TIMER_WIRE_VERSION,
    movementWireVersion: 2,
  });
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return { session, pid: session.pid as number, frames };
}

describe('the Knotted Gale over the wire', () => {
  it('mirrors the ball, the portals, the marks and the load; the crossing bumps the epoch', () => {
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
    const a = joinAt(server, 1, 'Aleph');
    sim.setPlayerLevel(20, a.pid);
    sim.chat('/dev heart enter', a.pid);
    sim.chat('/dev heart tp cornice', a.pid);
    sim.chat('/dev god', a.pid);
    sim.chat('/dev heart breath pull', a.pid);
    const client: Any = bareClient(a.pid);
    const run = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 20); i++) {
        sim.tick();
        updateMovementOverrideEpochs(sim, [a.session]);
        server.broadcastSnapshots();
        for (const f of a.frames.splice(0)) client.applySnapshot(f);
      }
    };
    const objects = (prefix: string) =>
      [...client.entities.values()].filter(
        (e: Any) => e.kind === 'object' && e.templateId.startsWith(prefix),
      ) as Any[];
    const mirror = () => client.entities.get(a.pid);
    const serverMe = sim.entities.get(a.pid);
    run(0.5);

    sim.chat('/dev heart breath heart', a.pid);
    run(0.5);
    const ball = objects(BREATH_OBJECTS.knotPrefix)[0];
    expect(ball).toBeDefined();
    expect(ball.scale).toBe(T.heartPickR);
    expect(knotOf(ball.templateId)?.state).toBe('free');
    // Alone he wears Portal A, on the client's aura bar too.
    expect(mirror().auras.some((x: Any) => x.id === BREATH_AURAS.portalA)).toBe(true);
    run(T.heartMark);
    expect(mirror().auras.some((x: Any) => x.id === BREATH_AURAS.portalA)).toBe(false);
    expect(objects(BREATH_OBJECTS.portalA)).toHaveLength(1);
    expect(objects(BREATH_OBJECTS.portalB)).toHaveLength(1);

    // The load: the mirrored aura, and the speed the client's own kernel reads off it.
    sim.chat('/dev heart breath heart carry', a.pid);
    run(0.2);
    const load = mirror().auras.find((x: Any) => x.id === BREATH_AURAS.laden);
    expect(load).toBeDefined();
    // The crawl, or the quicker pace with the wind at his back (whichever the
    // server set this tick): the mirror carries the server's value exactly.
    const serverLoad = serverMe.auras.find((x: Any) => x.id === BREATH_AURAS.laden);
    // A Normal run's dev carry switches it to Mythic: Mythic's row.
    const M = BREATH_KNOT.mythic;
    expect([M.walkMult, M.tailMult]).toContain(load.value);
    // The tier's walk rides value2 (the tooltip's read), mirrored as it is.
    expect(load.value2).toBe(M.walkMult);
    expect(load.value).toBe(serverLoad?.value);
    expect(moveSpeedMult(mirror())).toBeCloseTo(moveSpeedMult(serverMe), 6);
    expect(moveSpeedMult(mirror())).toBeLessThanOrEqual(M.tailMult + 1e-6);
    expect(knotOf(objects(BREATH_OBJECTS.knotPrefix)[0].templateId)?.state).toBe('held');

    // The crossing: a discontinuity, so the client's prediction is told to snap.
    const portalA = sim.entities.get(objects(BREATH_OBJECTS.portalA)[0].id);
    const portalB = sim.entities.get(objects(BREATH_OBJECTS.portalB)[0].id);
    // Off both mouths first (the carry happened on Portal A's own spot).
    serverMe.pos.x = (portalA.pos.x + portalB.pos.x) / 2;
    serverMe.pos.z = (portalA.pos.z + portalB.pos.z) / 2;
    run(0.2);
    const epoch = a.session.movementOverrideEpoch;
    serverMe.pos.x = portalA.pos.x;
    serverMe.pos.z = portalA.pos.z;
    run(0.2);
    expect(Math.hypot(serverMe.pos.x - portalB.pos.x, serverMe.pos.z - portalB.pos.z)).toBeLessThan(
      0.5,
    );
    expect(a.session.movementOverrideEpoch).toBeGreaterThan(epoch);
    expect(Math.hypot(mirror().pos.x - portalB.pos.x, mirror().pos.z - portalB.pos.z)).toBeLessThan(
      1,
    );

    // The throw is the ordinary interact command; the round leaves the mirror.
    sim.interact(a.pid);
    run(0.2);
    expect(objects(BREATH_OBJECTS.knotPrefix)).toHaveLength(0);
    expect(objects(BREATH_OBJECTS.portalA)).toHaveLength(0);
    expect(mirror().auras.some((x: Any) => x.id === BREATH_AURAS.laden)).toBe(false);
    expect([...client.entities.values()].some((e: Any) => e.templateId === BREATH_GUARDIAN)).toBe(
      true,
    );

    // Phase 2's round over the wire: two balls, both pairs of portals mirrored, and
    // the second pair carries C to D (never to A or B), bumping the epoch too.
    sim.chat('/dev heart breath heart 2', a.pid);
    run(0.5);
    expect(objects(BREATH_OBJECTS.knotPrefix)).toHaveLength(2);
    expect(mirror().auras.some((x: Any) => x.id === BREATH_AURAS.portalA)).toBe(true);
    run(T.heartMark);
    for (const o of ['portalA', 'portalB', 'portalC', 'portalD'] as const)
      expect(objects(BREATH_OBJECTS[o]), o).toHaveLength(1);
    const at = (o: 'portalA' | 'portalB' | 'portalC' | 'portalD') =>
      sim.entities.get(objects(BREATH_OBJECTS[o])[0].id);
    const C = at('portalC');
    const D = at('portalD');
    // Off every mouth first.
    serverMe.pos.x = (C.pos.x + D.pos.x) / 2 + T.heartPortalR * 3;
    serverMe.pos.z = (C.pos.z + D.pos.z) / 2;
    run(0.2);
    const epoch2 = a.session.movementOverrideEpoch;
    serverMe.pos.x = C.pos.x;
    serverMe.pos.z = C.pos.z;
    run(0.2);
    // Empty-handed, the wind may nudge him a step after the landing: still in D's mouth.
    expect(Math.hypot(serverMe.pos.x - D.pos.x, serverMe.pos.z - D.pos.z)).toBeLessThan(
      T.heartPortalR,
    );
    expect(a.session.movementOverrideEpoch).toBeGreaterThan(epoch2);
    expect(Math.hypot(mirror().pos.x - D.pos.x, mirror().pos.z - D.pos.z)).toBeLessThan(
      T.heartPortalR,
    );
    for (const o of ['portalA', 'portalB'] as const) {
      const p = at(o);
      expect(Math.hypot(serverMe.pos.x - p.pos.x, serverMe.pos.z - p.pos.z)).toBeGreaterThan(
        T.heartPortalR,
      );
    }
    sim.chat('/dev heart breath reset', a.pid);
    run(0.2);
    for (const o of ['portalA', 'portalB', 'portalC', 'portalD'] as const)
      expect(objects(BREATH_OBJECTS[o]), o).toHaveLength(0);
  });
});
