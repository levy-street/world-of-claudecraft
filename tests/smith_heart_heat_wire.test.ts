import { describe, expect, it, vi } from 'vitest';

// The Guardian of the Heat's fight rides existing entity fields only
// (src/sim/encounters/smith_heart/heat_ids.ts): the heat on the guardian's
// resource and on each player's quiet marker (its value and trend), the
// overheating and the stoking on the guardian, each player's Crystal Burn
// (a debuff's stacks), the rise spots and the Kindled Crystals (objects,
// their life in the template), every ray a beam event from the crystal to
// the player it struck, the channel's object (its state and half width) and
// heroic's Knell Embers. This drives the REAL server snapshot path into the
// real online mirror (ClientWorld, on the browser's stable timer wire) and
// checks each one arrives. Db is mocked so no Postgres runs (mirrors
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
import {
  channelOf,
  crystalOf,
  embersOf,
  HEAT_AURAS,
  HEAT_CUES,
  HEAT_GUARDIAN,
  HEAT_OBJECTS,
  riseOf,
  HEAT_TUNING as T,
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
  it('reaches the online mirror: the heat, the burns, the crystals and their rays, the channel and the embers', () => {
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
    const me = () => client.entities.get(b.pid);
    const serverMe = sim.entities.get(b.pid);
    const aura = (e: Any, id: string) => e.auras.find((x: Any) => x.id === id);
    run(1);
    const boss = () => onClient((e) => e.kind === 'mob' && e.templateId === HEAT_GUARDIAN)[0];
    const serverBoss = sim.entities.get(boss().id);

    // The heat: the guardian's resource and the player's marker.
    sim.chat('/dev heart heat heat 42', a.pid);
    run(0.5);
    expect(boss().resource).toBe(serverBoss.resource);
    expect(boss().maxResource).toBe(T.heatMax);
    expect(boss().resource).toBeGreaterThanOrEqual(42);
    const mark = aura(me(), HEAT_AURAS.heat);
    expect(mark).toBeDefined();
    expect(mark.value).toBe(aura(serverMe, HEAT_AURAS.heat).value);
    expect(mark.value2).toBe(aura(serverMe, HEAT_AURAS.heat).value2);

    // The wind-up from 90: the overheating on the guardian.
    sim.chat('/dev heart heat heat 92', a.pid);
    run(0.3);
    expect(aura(boss(), HEAT_AURAS.overheating)).toBeDefined();
    sim.chat('/dev heart heat heat 10', a.pid);
    run(0.3);
    expect(aura(boss(), HEAT_AURAS.overheating)).toBeUndefined();

    // Crystal Burn: the debuff's stacks.
    sim.chat('/dev heart heat burn 4', b.pid);
    run(0.3);
    expect(aura(me(), HEAT_AURAS.burn)?.stacks).toBe(4);
    expect(aura(me(), HEAT_AURAS.burn)?.kind).toBe('spellvuln');

    // Shed Heat: the rise spots, then the crystals and their rays.
    sim.chat('/dev heart heat shed', a.pid);
    run(0.3);
    const rises = objects(HEAT_OBJECTS.risePrefix);
    expect(rises.length).toBe(2);
    expect(riseOf(rises[0].templateId)).toBeCloseTo(T.shedCast, 5);
    expect(rises[0].scale).toBe(T.crystalR);
    run(T.shedCast + 0.3);
    const crystals = objects(HEAT_OBJECTS.crystalPrefix);
    expect(crystals.length).toBe(2);
    expect(crystalOf(crystals[0].templateId)).toBeCloseTo(T.crystalLife, 5);
    // Stand the mirrored raider in the first crystal's reach: its ray finds
    // them, and the beam event names the crystal and the raider.
    const c0 = sim.entities.get(crystals[0].id);
    sim.chat('/dev god', b.pid);
    serverMe.pos.x = c0.pos.x + 2;
    serverMe.pos.z = c0.pos.z;
    serverMe.prevPos = { ...serverMe.pos };
    sim.ctx.rebucket(serverMe);
    b.events.splice(0);
    run(T.rayEvery + 0.3);
    const beams = b.events.filter(
      (e: Any) => e.type === 'spellfx' && e.ability === HEAT_CUES.beam && e.targetId === b.pid,
    );
    expect(beams.length).toBeGreaterThan(0);
    expect(beams[0].sourceId).toBe(crystals[0].id);
    expect(beams[0].fx).toBe('beam');

    // The channel: its object, its state and its half width.
    const ch = objects(HEAT_OBJECTS.channelPrefix)[0];
    expect(ch.scale).toBe(T.channelHalf);
    expect(channelOf(ch.templateId)?.state).toBe('still');
    sim.chat('/dev heart heat channel', a.pid);
    run(0.3);
    expect(channelOf(objects(HEAT_OBJECTS.channelPrefix)[0].templateId)?.state).toBe('warn');
    run(T.channelWarn + 0.2);
    expect(channelOf(objects(HEAT_OBJECTS.channelPrefix)[0].templateId)?.state).toBe('flow');

    // Heroic's embers: an object at their radius, their life in the template.
    sim.chat('/dev heart heat heroic', a.pid);
    sim.chat('/dev heart heat embers', b.pid);
    run(0.3);
    const embers = objects(HEAT_OBJECTS.embersPrefix);
    expect(embers.length).toBe(1);
    expect(embers[0].scale).toBe(T.embersR);
    expect(embersOf(embers[0].templateId)).toBeCloseTo(T.embersLife, 5);
  });
});
