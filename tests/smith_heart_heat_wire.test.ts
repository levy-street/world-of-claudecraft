import { describe, expect, it, vi } from 'vitest';

// The Guardian of the Heat's fight rides existing entity fields only
// (src/sim/encounters/smith_heart/heat_ids.ts): its phase and stage on the
// guardian's state aura, its untargetable sinking (hostile off), the
// wellspring's claim object (its state in the template), Basalt Fist's bar,
// spot and lanes (objects, their warning in the template, a radius or a half
// width in `scale`), the waves that roll (moving objects), Hearth Flare's
// mark (a debuff) and its bolt (a beam event), the overflow's rivers, the
// Wellspawn and Wellkeepers (mobs), the Hearthseeds and Wakefire's bands
// (objects), a Rolling Cinder (a mob) and its quarry's Hunted mark. This
// drives the REAL server snapshot path into the real online mirror
// (ClientWorld, on the browser's stable timer wire) and checks each one
// arrives. Db is mocked so no Postgres runs (mirrors
// smith_heart_quench_wire.test.ts).
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
import { HEARTH_WELL } from '../src/sim/content/smith_heart_layout';
import {
  HEAT_AURAS,
  HEAT_CASTS,
  HEAT_CUES,
  HEAT_GUARDIAN,
  HEAT_MOBS,
  HEAT_OBJECTS,
  HEAT_STAGES,
  heatTimedOf,
  riverOf,
  swellLaneOf,
  HEAT_TUNING as T,
  wellOf,
  zoneOf,
} from '../src/sim/encounters/smith_heart/heat_ids';
import { STABLE_TIMER_WIRE_VERSION } from '../src/world_api';
import { bareClient } from './helpers/bare_client';

// biome-ignore lint/suspicious/noExplicitAny: the in-process server idiom (afk_wire.test.ts)
type Any = any;

function joinAt(server: Any, id: number, name: string, stable: boolean) {
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
    ...(stable ? { timerWireVersion: STABLE_TIMER_WIRE_VERSION } : {}),
  });
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return { session, pid: session.pid as number, frames, events };
}

describe('the Guardian of the Heat over the wire', () => {
  it('reaches the online mirror: the wellspring, the fist and its swells, the flare, the overflow, the seeds, the bands, the cinder', () => {
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
      sim.chat('/dev heart tp heatboss', p.pid);
      sim.chat('/dev god', p.pid);
    }
    sim.chat('/dev heart heat heroic', a.pid);
    sim.chat('/dev heart heat pull', a.pid);
    const client: Any = bareClient(b.pid);
    const run = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 20); i++) {
        server.routeEvents(sim.tick());
        server.broadcastSnapshots();
        for (const f of b.frames.splice(0)) client.applySnapshot(f);
      }
    };
    const onClient = (pred: (e: Any) => boolean) =>
      [...client.entities.values()].filter((e: Any) => pred(e)) as Any[];
    const objects = (prefix: string) =>
      onClient((e) => e.kind === 'object' && e.templateId.startsWith(prefix));
    const mobs = (templateId: string) =>
      onClient((e) => e.kind === 'mob' && e.templateId === templateId && !e.dead);
    const me = () => client.entities.get(b.pid);
    const serverMe = sim.entities.get(b.pid);
    const aura = (e: Any, id: string) => e?.auras.find((x: Any) => x.id === id);
    run(1);
    const boss = () => mobs(HEAT_GUARDIAN)[0];
    const serverBoss = sim.entities.get(boss().id);
    // Hold its own clocks (each step below asks for what it checks).
    const hold = () => {
      const st = serverBoss.smithHeartHeat;
      st.fistTimer = 999;
      st.flareTimer = 999;
      st.seedTimer = 999;
      st.zoneTimer = 999;
      st.cinderTimer = 999;
    };
    hold();
    const local = (e: Any) => {
      const o = sim.ctx.instanceOriginOf(
        sim.ctx.instances.find((i: Any) =>
          i.objectIds.includes(objects(HEAT_OBJECTS.wellPrefix)[0].id),
        ),
      );
      return { x: e.pos.x - o.x, z: e.pos.z - o.z };
    };
    const put = (x: number, z: number) => {
      const w = objects(HEAT_OBJECTS.wellPrefix)[0];
      const wl = local(w);
      serverMe.pos.x = w.pos.x - wl.x + x;
      serverMe.pos.z = w.pos.z - wl.z + z;
      serverMe.prevPos = { ...serverMe.pos };
      sim.ctx.rebucket(serverMe);
    };

    // The wellspring: its claim object at the pool, calm; the guardian's
    // phase and stage on its state aura.
    const well = objects(HEAT_OBJECTS.wellPrefix);
    expect(well).toHaveLength(1);
    expect(wellOf(well[0].templateId)).toBe('calm');
    expect(local(well[0]).x).toBeCloseTo(HEARTH_WELL.x, 3);
    const state = aura(boss(), HEAT_AURAS.state);
    expect(state?.value).toBe(1);
    expect(state?.value2).toBe(HEAT_STAGES.fight);

    // Basalt Fist under the mirrored raider: its bar, its spot, its lanes;
    // then the swells' waves rolling.
    put(-206, 0);
    run(0.2);
    sim.chat('/dev heart heat fist', b.pid);
    run(0.3);
    expect(boss().castingAbility).toBe(HEAT_CASTS.fist);
    const spot = objects(HEAT_OBJECTS.fistPrefix);
    expect(spot).toHaveLength(1);
    expect(spot[0].scale).toBe(T.fistR);
    expect(heatTimedOf(HEAT_OBJECTS.fistPrefix, spot[0].templateId)).toBeCloseTo(T.fistCast, 5);
    const lanes = objects(HEAT_OBJECTS.lanePrefix);
    expect(lanes).toHaveLength(3);
    for (const l of lanes) {
      expect(swellLaneOf(l.templateId)?.state).toBe('warn');
      expect(l.scale).toBe(T.laneHalf);
    }
    b.events.splice(0);
    run(T.fistCast + T.waveDelay + 0.4);
    expect(b.events.some((e: Any) => e.type === 'spellfxAt' && e.ability === HEAT_CUES.fist)).toBe(
      true,
    );
    expect(objects(HEAT_OBJECTS.fistPrefix)).toHaveLength(0);
    const waves = objects(HEAT_OBJECTS.wave);
    expect(waves.length).toBe(3);
    const before = { ...waves[0].pos };
    run(0.5);
    const after = objects(HEAT_OBJECTS.wave).find((w: Any) => w.id === waves[0].id);
    expect(Math.hypot(after.pos.x - before.x, after.pos.z - before.z)).toBeGreaterThan(2);
    run(5);
    hold();

    // Hearth Flare on the raider standing far out: the mark and the bolt.
    put(-196, 18);
    run(0.2);
    b.events.splice(0);
    sim.chat('/dev heart heat flare', a.pid);
    run(0.3);
    expect(aura(me(), HEAT_AURAS.scorched)?.kind).toBe('spellvuln');
    const bolt = b.events.find(
      (e: Any) => e.type === 'spellfx' && e.ability === HEAT_CUES.flare && e.targetId === b.pid,
    );
    expect(bolt?.sourceId).toBe(boss().id);
    put(-206, 0);

    // The overflow: it sinks out of reach, the wellspring overflows, the
    // rivers, heroic's Wellspawn climbing out.
    sim.chat('/dev heart heat intermission', a.pid);
    run(T.sinkSeconds + 0.5);
    expect(aura(boss(), HEAT_AURAS.state)?.value2).toBe(HEAT_STAGES.under);
    expect(boss().hostile).toBe(false);
    expect(wellOf(objects(HEAT_OBJECTS.wellPrefix)[0].templateId)).toBe('over');
    run(1);
    expect(mobs(HEAT_MOBS.spawn).length).toBeGreaterThan(0);
    run(T.riverWarn + 1);
    const rivers = objects(HEAT_OBJECTS.riverPrefix);
    expect(rivers.length).toBeGreaterThan(0);
    expect(riverOf(rivers[0].templateId)).not.toBeNull();
    expect(rivers[0].scale).toBe(T.riverHalf);

    // Phase 2: the guardian back up, the Hearthseeds and Wakefire's bands.
    sim.chat('/dev heart heat phase 2', a.pid);
    run(T.riseSeconds + 0.5);
    hold();
    expect(aura(boss(), HEAT_AURAS.state)?.value).toBe(2);
    expect(aura(boss(), HEAT_AURAS.state)?.value2).toBe(HEAT_STAGES.fight);
    expect(boss().hostile).toBe(true);
    sim.chat('/dev heart heat seeds', a.pid);
    sim.chat('/dev heart heat zones', a.pid);
    run(0.5);
    const seeds = objects(HEAT_OBJECTS.seedPrefix);
    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds[0].scale).toBe(T.seedReach);
    const zones = objects(HEAT_OBJECTS.zonePrefix);
    expect(zones.length).toBeGreaterThan(0);
    expect(zoneOf(zones[0].templateId)?.state).toBe('warn');

    // Phase 3: a Rolling Cinder falls, lands and hunts a raider.
    sim.chat('/dev heart heat phase 3', a.pid);
    run(0.2);
    hold();
    sim.chat('/dev heart heat cinder', a.pid);
    run(0.3);
    expect(objects(HEAT_OBJECTS.fallPrefix)).toHaveLength(1);
    run(T.cinderFallWarn + 0.5);
    expect(mobs(HEAT_MOBS.cinder)).toHaveLength(1);
    const hunted = onClient(
      (e) => e.kind === 'player' && e.auras.some((x: Any) => x.id === HEAT_AURAS.hunted),
    );
    expect(hunted).toHaveLength(1);
  });
});
