import { describe, expect, it, vi } from 'vitest';

// Wellspring Brand and the held Cinder Grip over the wire (heat_brand.ts,
// heat_grip.ts): no wire or IWorld field is new, so this pins that the
// existing aura mirror carries what the HUD and the bots read: the tank
// buster marker (its code, its countdown) during the tell, the brand's mark
// (kind, share, the tier's gap in `value2`, the swap count in `value3`) and
// its beam cue, through the REAL server snapshot path into the online mirror.
// Db is mocked so no Postgres runs (mirrors smith_heart_heat_wire.test.ts).
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
  HEAT_AURAS,
  HEAT_CUES,
  HEAT_DIFFICULTY,
  HEAT_GUARDIAN,
  HEAT_TUNING as T,
} from '../src/sim/encounters/smith_heart/heat_ids';
import {
  heartTankBusterByCode,
  TANK_BUSTER_AURA,
} from '../src/sim/encounters/smith_heart/tank_buster_ids';
import { STABLE_TIMER_WIRE_VERSION } from '../src/world_api';
import { bareClient } from './helpers/bare_client';

// biome-ignore lint/suspicious/noExplicitAny: the in-process server idiom (afk_wire.test.ts)
type Any = any;

function joinAt(server: Any, id: number, name: string) {
  const frames: Any[] = [];
  const events: Any[] = [];
  const ws = {
    readyState: 1,
    send: (payload: string) => {
      const m = JSON.parse(payload);
      if (m.t === 'snap') frames.push(m);
      else if (m.t === 'events') events.push(...m.list);
    },
  };
  const session = server.join(ws, id, id, name, 'warrior', null, false, {
    timerWireVersion: STABLE_TIMER_WIRE_VERSION,
  });
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return { session, pid: session.pid as number, frames, events };
}

describe('Wellspring Brand over the wire', () => {
  it('the tell, the mark and the beam reach the tank on the online mirror', () => {
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
    sim.chat('/dev heart tp heatboss', a.pid);
    sim.chat('/dev god', a.pid);
    sim.chat('/dev heart heat pull', a.pid);
    const client: Any = bareClient(a.pid);
    const run = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 20); i++) {
        server.routeEvents(sim.tick());
        server.broadcastSnapshots();
        for (const f of a.frames.splice(0)) client.applySnapshot(f);
      }
    };
    run(1);
    const serverBoss = [...sim.entities.values()].find(
      (e: Any) => e.templateId === HEAT_GUARDIAN,
    ) as Any;
    const st = serverBoss.smithHeartHeat;
    expect(st).toBeDefined();
    for (const k of ['fistTimer', 'flareTimer', 'seedTimer', 'zoneTimer', 'wheelTimer'])
      st[k] = 999;
    expect(serverBoss.aggroTargetId).toBe(a.pid);
    const rule = HEAT_DIFFICULTY[st.difficulty as 'normal'].brand;
    st.brandTimer = rule.lead + 0.3;
    run(0.6);
    const me = () => client.entities.get(a.pid);
    const aura = (id: string) => me()?.auras.find((x: Any) => x.id === id);
    const mark = aura(TANK_BUSTER_AURA);
    expect(heartTankBusterByCode(mark?.value)?.key).toBe('brand');
    expect(mark?.remaining).toBeGreaterThan(0);
    a.events.splice(0);
    run(rule.lead + 0.3);
    const brand = aura(HEAT_AURAS.brand);
    expect(brand?.kind).toBe('spellvuln');
    expect(brand?.value).toBe(rule.taken);
    expect(brand?.value2).toBe(rule.every);
    expect(brand?.value3).toBe(T.brandSwap);
    expect(aura(TANK_BUSTER_AURA)).toBeUndefined();
    const beam = a.events.find(
      (e: Any) => e.type === 'spellfx' && e.ability === HEAT_CUES.brand && e.targetId === a.pid,
    );
    expect(beam?.sourceId).toBe(serverBoss.id);
  });
});
