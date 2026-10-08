// The slumber bit and the warpath phase across the wire (server/entity_wire.ts encode,
// src/net/online.ts decode), driven through a real GameServer snapshot into a bare
// ClientWorld. The online half of the raid is what most players run, and everything the
// renderer does for a sleeper (the sleep loop, the dimmed eye, the hidden ward badge, the
// suppressed far sprite) hangs off the mirrored `asleep` bit, so the decode is pinned on
// its own rather than inferred from the encode.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer } from '../server/game';
import { phaseToCycleMs } from '../src/sim/day_night';
import type { Entity } from '../src/sim/types';
import { bareClient, broadcast, fakeWs, joinServer } from './helpers/bare_client';

const BALGATH = 'balgath_cyclops';

/** The slice of the server's private Sim this file drives. */
interface ServerSim {
  cfg: { dayNightNowMs?: () => number };
  entities: Map<number, Entity>;
  spawnDevBoss(templateId: string, x: number, z: number): number;
  tick(): unknown;
}

describe('slumber and warpath phase on the wire', () => {
  let server: GameServer;
  let boss: Entity;
  let fc: ReturnType<typeof fakeWs>;
  let client: ReturnType<typeof bareClient>;
  let sim: ServerSim;
  let applied = 0;
  let phase = 0.5;

  beforeEach(() => {
    server = new GameServer();
    fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Watcher', 'warrior');
    client = bareClient(session.pid);
    applied = 0;
    phase = 0.5;
    sim = (server as unknown as { sim: ServerSim }).sim;
    // The live server hands its sim the real clock; the test takes that seam over so the
    // night is scripted rather than whatever the wall clock happens to say.
    sim.cfg.dayNightNowMs = () => phaseToCycleMs(phase);
    const me = sim.entities.get(session.pid) as Entity;
    // Drop him a hundred yards out: inside the ~120 yd interest scope, so he rides the
    // viewer's snapshots, and far outside the 20 yd aggro cap, so his idle wander can never
    // turn into a pull that overwrites the hand-set warpath fields below. Where he spawns
    // is his bed.
    const id = sim.spawnDevBoss(BALGATH, me.pos.x + 100, me.pos.z);
    boss = sim.entities.get(id) as Entity;
  });

  // Tick once (snapshots are keyed per tick), broadcast, and feed the ONE client every
  // frame in order: after the first full snapshot the server sends deltas (only entities
  // whose dynamic fields changed), which is exactly the path the online mirror lives on.
  const mirror = (ticks = 30) => {
    // A real slice of time, not one tick: an idle entity's delta rides a snapshot cadence
    // longer than a frame, and a boss who wandered a step in daylight has to walk back to
    // his bed before the night can put him down.
    for (let i = 0; i < ticks; i++) sim.tick();
    broadcast(server);
    for (; applied < fc.sent.length; applied++) {
      const frame = fc.sent[applied];
      // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is the private ingest under test
      if (frame.t === 'snap') (client as any).applySnapshot(frame);
    }
    const e = client.entities.get(boss.id);
    if (!e) throw new Error('the boss never reached the client mirror');
    return e;
  };

  it('mirrors the sleep bit both ways, and neutral with it', () => {
    // Day: the bit is absent on the wire, so the mirror has never heard of it.
    const awake = mirror();
    expect(boss.asleep).toBe(false);
    expect(awake.asleep).toBeUndefined();
    expect(awake.hostile).toBe(true);
    // Night falls; the real slumber driver puts him to bed at his spawn point.
    phase = 0.9;
    const asleep = mirror(80);
    expect(boss.asleep).toBe(true);
    expect(asleep.asleep).toBe(true);
    expect(asleep.hostile).toBe(false);
    expect(asleep.auras.some((a) => a.id === 'slumber' && a.permanent)).toBe(true);
    // Dawn: the bit stops riding, and a mirror that once saw it decodes to a defined false
    // (the sim's own discipline on a slumbering template), not back to undefined.
    phase = 0.5;
    const woke = mirror();
    expect(boss.asleep).toBe(false);
    expect(woke.asleep).toBe(false);
    expect(woke.hostile).toBe(true);
    expect(woke.auras.some((a) => a.id === 'slumber')).toBe(false);
  });

  it('mirrors the warpath phase, and the unharried clock only while travelling', () => {
    expect(mirror().warpathPhase).toBeUndefined();
    // Idle ticks leave hand-set warpath fields alone (the machine only runs engaged).
    boss.warpathPhase = 'travel';
    boss.warpathUnharried = 4.25;
    const travelling = mirror();
    expect(travelling.warpathPhase).toBe('travel');
    expect(travelling.warpathUnharried).toBe(4.25);
    boss.warpathPhase = 'focus';
    const focused = mirror();
    expect(focused.warpathPhase).toBe('focus');
    // Not travelling: the clock is not sent, and the mirror reads a harmless zero.
    expect(focused.warpathUnharried).toBe(0);
    boss.warpathPhase = undefined;
    boss.warpathUnharried = undefined;
    const plain = mirror();
    expect(plain.warpathPhase).toBeUndefined();
    expect(plain.warpathUnharried).toBeUndefined();
  });
});
