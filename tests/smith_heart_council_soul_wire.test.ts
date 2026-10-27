import { describe, expect, it, vi } from 'vitest';

// The Mythic council's soul pillars (src/sim/encounters/smith_heart/
// council_soul.ts) ride existing entity fields only: the soul, the pillar's
// kind and its pips in the object's template id, the Walking Slab in its
// position (its collider rebuilt from the mirrored entity), the Echo of Wrath
// and the Endless Song as the pillar's own bar, the song's count as a stack of
// an aura on the pillar. The offline Sim reads them in place; this drives the
// REAL server snapshot path into the real online mirror (ClientWorld, on the
// browser's stable timer wire) and checks each one arrives, the way the raid
// bots (scripts/heart_council_raid.mjs) saw it over a live server. Db is
// mocked so no Postgres runs (mirrors afk_wire.test.ts).
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
import { syncClientCombatWalls } from '../src/net/combat_wall_wire';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../src/sim/data';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_TUNING,
  councilSoulOf,
} from '../src/sim/encounters/smith_heart/council_ids';
import { combatWallsAt } from '../src/sim/instances/combat_wall_state';
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

describe('the soul pillars over the wire', () => {
  it('reach the online mirror: which soul, its pips, the Walking Slab, the Echo and the Endless Song', () => {
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
      sim.chat('/dev heart tp pit', p.pid);
      sim.chat('/dev god', p.pid);
    }
    sim.chat('/dev heart council mythic on', a.pid);
    sim.chat('/dev heart council pull', a.pid);

    const client: Any = bareClient(b.pid);
    const run = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 20); i++) {
        sim.tick();
        server.broadcastSnapshots();
        for (const f of b.frames.splice(0)) client.applySnapshot(f);
        syncClientCombatWalls(client);
      }
    };
    const soulOnClient = (role: string) =>
      [...client.entities.values()].find(
        (e: Any) => e.kind === 'object' && councilSoulOf(e.templateId)?.role === role,
      ) as Any;
    const soulOnServer = (role: string) =>
      [...sim.entities.values()].find(
        (e: Any) => e.kind === 'object' && councilSoulOf(e.templateId)?.role === role,
      ) as Any;
    run(1);

    // The Guardian's soul: its pips, then its Echo bar 12 s on.
    sim.chat('/dev heart council soul guardian', a.pid);
    run(1);
    const echo = soulOnClient('guardian');
    expect(echo).toBeDefined();
    expect(councilSoulOf(echo.templateId)?.pips).toBe(COUNCIL_TUNING.soulPips);
    expect(echo.id).toBe(soulOnServer('guardian').id);
    let echoBar = 0;
    for (let s = 0; s < 14 && echoBar === 0; s += 0.5) {
      run(0.5);
      const e = soulOnClient('guardian');
      if (e?.castingAbility === COUNCIL_CASTS.echo) echoBar = e.castTotal;
    }
    expect(echoBar).toBe(COUNCIL_TUNING.echoCast);

    // The Slabwright's soul walks toward the raid; the mirror and its
    // collider follow it.
    sim.chat('/dev heart council soul slabwright', a.pid);
    run(0.5);
    const startAt = { ...soulOnServer('slabwright').pos };
    for (const p of [a, b]) sim.meta(p.pid).moveInput.forward = true;
    run(2);
    for (const p of [a, b]) sim.meta(p.pid).moveInput.forward = false;
    run(3);
    const slabServer = soulOnServer('slabwright');
    const slabClient = soulOnClient('slabwright');
    expect(Math.hypot(slabServer.pos.x - startAt.x, slabServer.pos.z - startAt.z)).toBeGreaterThan(
      2,
    );
    expect(
      Math.hypot(slabClient.pos.x - slabServer.pos.x, slabClient.pos.z - slabServer.pos.z),
    ).toBeLessThan(0.5);
    const me = client.entities.get(b.pid);
    const o = instanceOrigin(DUNGEONS.smith_heart.index, instanceSlotForZ(me.pos.z));
    const wall = combatWallsAt(o.x, o.z).find(
      (w: Any) => Math.hypot(w.x - (slabClient.pos.x - o.x), w.z - (slabClient.pos.z - o.z)) < 1,
    );
    expect(wall).toBeDefined();

    // The Seam Singer's soul: the song's bar and its pulse count.
    sim.chat('/dev heart council soul singer', a.pid);
    run(COUNCIL_TUNING.songPulseFirst + COUNCIL_TUNING.songPulseEvery + 0.5);
    const song = soulOnClient('singer');
    expect(song.castingAbility).toBe(COUNCIL_CASTS.endlessSong);
    expect(song.castTotal).toBe(COUNCIL_TUNING.songPulseEvery);
    const stacks = song.auras.find((x: Any) => x.id === COUNCIL_AURAS.endlessSong)?.stacks ?? 0;
    expect(stacks).toBeGreaterThanOrEqual(2);

    // A struck pip, then the burst: gone from the mirror too.
    sim.chat('/dev heart council soulpip 1', a.pid);
    run(0.5);
    for (const role of ['guardian', 'slabwright', 'singer'])
      expect(councilSoulOf(soulOnClient(role).templateId)?.pips).toBe(1);
    sim.chat('/dev heart council soulpip 0', a.pid);
    run(0.5);
    for (const role of ['guardian', 'slabwright', 'singer'])
      expect(soulOnClient(role)).toBeUndefined();
  });
});
