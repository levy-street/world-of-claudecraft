import { describe, expect, it, vi } from 'vitest';

// The Guardian of the Breath's fight rides existing entity fields only
// (src/sim/encounters/smith_heart/breath_ids.ts): the wind's phase, bearing
// and length in its object's template id, the kernel's wind and pull auras on
// each player (their heading, speed and point exact), Captain Thessaly as an
// NPC with no quests, her circle's object and the anchors, the vortex and the
// loose gales (their positions), the storm body and the swell on the guardian,
// the strikes' spots, the charged ground, the cradle's object and the lifted
// player's height. This drives the REAL server snapshot path into the real
// online mirror (ClientWorld, on the browser's stable timer wire) and checks
// each one arrives. Db is mocked so no Postgres runs (mirrors afk_wire.test.ts).
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
  BREATH_AURAS,
  BREATH_GUARDIAN,
  BREATH_OBJECTS,
  BREATH_THESSALY_NPC,
  breathWindOf,
  calmOf,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart/breath_ids';
import { WIND_DRIFT_AURA, WIND_PULL_AURA } from '../src/sim/wind_drift';
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

describe('the Guardian of the Breath over the wire', () => {
  it('reaches the online mirror: the wind, the push, Thessaly and her calm, the storm and its marks', () => {
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
      sim.chat('/dev heart tp cornice', p.pid);
      sim.chat('/dev god', p.pid);
    }
    sim.chat('/dev heart breath pull', a.pid);
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
    run(1);

    // Captain Thessaly: an NPC, no quests offered.
    const thessaly = onClient((e) => e.kind === 'npc' && e.templateId === BREATH_THESSALY_NPC)[0];
    expect(thessaly).toBeDefined();
    expect(thessaly.questIds).toEqual([]);

    // A blow: the wind object's phase and bearing, the push's exact aura.
    sim.chat('/dev heart breath blow 90', a.pid);
    run(1);
    const wind = breathWindOf(objects(BREATH_OBJECTS.windPrefix)[0].templateId);
    expect(wind?.phase).toBe('blow');
    expect(wind?.bearingDeg).toBe(90);
    const sAura = serverMe.auras.find((x: Any) => x.id === WIND_DRIFT_AURA);
    const cAura = me().auras.find((x: Any) => x.id === WIND_DRIFT_AURA);
    expect(cAura).toBeDefined();
    expect(cAura.value).toBe(sAura.value);
    expect(cAura.value2).toBe(sAura.value2);

    // The calm, then Thessaly's circle: landing, holding, an anchor.
    sim.chat('/dev heart breath calm', a.pid);
    run(0.5);
    expect(me().auras.some((x: Any) => x.id === WIND_DRIFT_AURA)).toBe(false);
    sim.chat('/dev heart breath circle', a.pid);
    run(0.2);
    const circle = objects(BREATH_OBJECTS.calmPrefix)[0];
    expect(calmOf(circle.templateId)?.state).toBe('land');
    expect(circle.scale).toBe(T.circleR);
    const serverCircle = sim.entities.get(circle.id);
    serverMe.pos.x = serverCircle.pos.x;
    serverMe.pos.z = serverCircle.pos.z;
    run(T.circleLand + 0.5);
    expect(me().auras.some((x: Any) => x.id === BREATH_AURAS.anchor)).toBe(true);

    // The indrawn breath: the vortex object and (on the unanchored) the pull.
    sim.chat('/dev heart breath inhale', a.pid);
    run(1);
    const vortex = objects(BREATH_OBJECTS.vortex)[0];
    expect(vortex?.scale).toBe(T.vortexR);
    const aleph = sim.entities.get(a.pid);
    expect(aleph.auras.some((x: Any) => x.id === WIND_PULL_AURA)).toBe(true);
    run(T.inhaleCast + T.gustCast + 0.5);

    // Heroic's loose gales: their positions follow the server's.
    sim.chat('/dev heart breath heroic', a.pid);
    sim.chat('/dev heart breath tornado', a.pid);
    run(1);
    const gale = objects(BREATH_OBJECTS.gale)[0];
    const g0 = { ...gale.pos };
    run(1);
    const galeServer = sim.entities.get(gale.id);
    expect(Math.hypot(gale.pos.x - g0.x, gale.pos.z - g0.z)).toBeGreaterThan(0.2);
    expect(Math.hypot(gale.pos.x - galeServer.pos.x, gale.pos.z - galeServer.pos.z)).toBeLessThan(
      0.5,
    );

    // The storm: the body on the guardian, the spots, then the marks.
    sim.chat('/dev heart breath phase2', a.pid);
    run(T.stormCast + 1);
    const boss = onClient((e) => e.kind === 'mob' && e.templateId === BREATH_GUARDIAN)[0];
    expect(boss.auras.some((x: Any) => x.id === BREATH_AURAS.stormForm)).toBe(true);
    expect(objects(BREATH_OBJECTS.strikePrefix).length).toBeGreaterThan(0);
    run(T.barrageSeconds);
    sim.chat('/dev heart breath conductor', a.pid);
    run(T.drawnCast + 3);
    expect(objects(BREATH_OBJECTS.chargedPrefix).length).toBeGreaterThan(0);
    run(T.drawnSeconds);
    sim.chat('/dev heart breath eye', a.pid);
    run(T.cradleCast + 1.5);
    const cradle = objects(BREATH_OBJECTS.cradlePrefix)[0];
    expect(cradle?.scale).toBe(T.cradleR);
    const st = sim.entities.get(boss.id).smithHeartBreath;
    const lifted = client.entities.get(st.cradle.playerId);
    expect(lifted.pos.y).toBeGreaterThan(cradle.pos.y + T.cradleLift - 0.6);
    expect(lifted.auras.some((x: Any) => x.id === BREATH_AURAS.cradled)).toBe(true);
    const swell = boss.auras.find((x: Any) => x.id === BREATH_AURAS.swell);
    expect(swell?.stacks).toBeGreaterThan(0);
  });
});
