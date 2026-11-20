import { describe, expect, it, vi } from 'vitest';

// The dormant Hammer Vein Warder over the wire (src/sim/mob/dormant.ts). Its sleep rides the
// `slp` bit every client already reads for a slumbering boss (server/world_boss_wire.ts
// encode, src/net/lance_wire_state.ts decode) and its ward is an ordinary aura row on the
// timer wires (server/snapshot_timer_wire.ts encode, src/net/aura_wire_decode.ts decode).
// tests/smith_heart_dormant_warder.test.ts pins the encoder call alone; this drives the REAL
// GameServer broadcast into a bare ClientWorld, on both timer wires, through the whole cycle:
// first sight asleep and warded, a blow (up off the floor, still warded while it rises), the
// rise over (ward gone), and the evade reset (asleep and warded again). The renderer's heap
// pose and Awaken clip hang off the mirrored bit, so the decode is pinned, not inferred. Db
// is mocked so no Postgres runs (mirrors smith_heart_council_soul_wire.test.ts).
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
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { displacePlayerForDev } from '../src/sim/dev/dev_displace';
import { handleSmithHeartDevChat } from '../src/sim/dev/smith_heart_dev';
import { DORMANT_AURA_ID } from '../src/sim/mob/dormant_state';
import { resetEvadingMob } from '../src/sim/mob/locomotion';
import type { Sim } from '../src/sim/sim';
import { type Entity, TICK_RATE } from '../src/sim/types';
import { STABLE_TIMER_WIRE_VERSION } from '../src/world_api';
import { bareClient, broadcast, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

const WARDER = 'heart_hammer_warder';
const AUTHORED = SMITH_HEART_MOBS[WARDER].dormant;
if (!AUTHORED) throw new Error('the Hammer Vein Warder is not dormant');
const DEF = AUTHORED;

/** The online client's snapshot ingest: private on ClientWorld, driven directly here. */
type Ingest = { applySnapshot(snap: unknown): void };

/** A realm with the dev surface on: the Smith's Heart opens only to dev builds until it ships
 *  (encounters/smith_heart/entry.ts), and the realm reads the flag once, at boot. */
function devRealm(): GameServer {
  const saved = process.env.ALLOW_DEV_COMMANDS;
  process.env.ALLOW_DEV_COMMANDS = '1';
  try {
    return new GameServer();
  } finally {
    if (saved === undefined) delete process.env.ALLOW_DEV_COMMANDS;
    else process.env.ALLOW_DEV_COMMANDS = saved;
  }
}

/** Floor where no Warder can see the player, with the one returned near enough to update at
 *  the full snapshot rate: further than 30 yd from every Warder (the 20 yd aggro ceiling with
 *  room to spare), within 45 yd of `w` (full rate reaches 55 yd,
 *  server/entity_update_cadence.ts, and the last step below sends after a single tick), and
 *  solid underfoot near its level. Much of the gallery's surround is open air over the pit: an
 *  ordinary player stood there falls to their death before a rise is over, ending the pull. */
function clearFloor(sim: Sim, warders: Entity[]): { w: Entity; x: number; z: number } {
  for (const w of warders) {
    for (let d = 30; d <= 45; d++) {
      for (let a = 0; a < 32; a++) {
        const x = w.pos.x + Math.cos((a / 32) * Math.PI * 2) * d;
        const z = w.pos.z + Math.sin((a / 32) * Math.PI * 2) * d;
        if (!warders.every((o) => Math.hypot(o.pos.x - x, o.pos.z - z) > 30)) continue;
        if (Math.abs(sim.groundPos(x, z).y - w.pos.y) > 10) continue;
        return { w, x, z };
      }
    }
  }
  throw new Error('no clear floor near any Warder');
}

const ward = (e: Entity | undefined) => e?.auras.find((a) => a.id === DORMANT_AURA_ID);

describe('the dormant Hammer Vein Warder over the wire', () => {
  it.each([
    ['stable', true],
    ['legacy', false],
  ])(
    'mirrors the sleep and the ward through a wake, a rise and an evade (%s timer wire)',
    (_wire, stable) => {
      const server = devRealm();
      const sim = server.sim;
      const fc = fakeWs();
      const { pid } = joinServer(
        server,
        fc,
        1,
        'Aleph',
        'warrior',
        stable ? { timerWireVersion: STABLE_TIMER_WIRE_VERSION } : {},
      );
      const client = bareClient(pid);

      // Into the claim and onto the gallery, then out of every Warder's reach before the first
      // tick, so nothing but the blow below wakes one. No /dev god: a god's blows are lethal.
      handleSmithHeartDevChat(sim.ctx, '/dev heart enter', pid);
      handleSmithHeartDevChat(sim.ctx, '/dev heart tp gallery', pid);
      const me = sim.entities.get(pid);
      if (!me) throw new Error('the player never joined');
      const warders = [...sim.entities.values()].filter(
        (e) => e.templateId === WARDER && !e.dead && Math.abs(e.pos.x - me.pos.x) < 400,
      );
      expect(warders.length).toBeGreaterThan(0);
      const { w, x, z } = clearFloor(sim, warders);
      displacePlayerForDev(sim.ctx, me, x, z);
      const pack = warders.filter((o) => o.dungeonPackId === w.dungeonPackId);

      // Tick (snapshots are keyed per tick), broadcast once, and feed the client every frame in
      // order: after first sight the server sends deltas, the path the online mirror lives on.
      let applied = 0;
      const mirror = (ticks: number) => {
        for (let i = 0; i < ticks; i++) sim.tick();
        broadcast(server);
        for (; applied < fc.sent.length; applied++) {
          const frame = fc.sent[applied];
          if (frame.t === 'snap') (client as unknown as Ingest).applySnapshot(frame);
        }
        return client.entities.get(w.id);
      };

      // First sight: the one snapshot that ever carried the Warder brings it asleep and warded.
      const first = mirror(2);
      expect(w.asleep).toBe(true);
      const carried = fc.sent.filter(
        (f) => f.t === 'snap' && f.ents.some((r: { id: number }) => r.id === w.id),
      );
      expect(carried.length).toBe(1);
      expect(carried[0]).toBe(lastSnap(fc.sent));
      expect(first?.asleep).toBe(true);
      expect(ward(first)).toMatchObject({ kind: 'shield_wall', value: 0.95 });

      // A blow from range wakes it. The mirror has it up off the floor at once, and still
      // warded while it stands.
      sim.dealDamage(me, w, 10, false, 'fire', null, 'hit');
      const rising = mirror(2);
      expect(w.asleep).toBe(false);
      expect(w.dormantRise ?? 0).toBeGreaterThan(0);
      expect(rising?.asleep).toBe(false);
      expect(ward(rising)).toMatchObject({ kind: 'shield_wall', value: 0.95 });

      // Up: the ward lifts, on the mirror too.
      const up = mirror(Math.ceil(DEF.riseSeconds * TICK_RATE) + 4);
      expect(me.dead).toBe(false);
      expect(w.aggroTargetId).toBe(pid);
      expect(ward(w)).toBeUndefined();
      expect(up?.asleep).toBe(false);
      expect(ward(up)).toBeUndefined();

      // Home: the evade reset lays the pack down where it stands, and the mirror sees the
      // Warder asleep and warded again.
      for (const o of pack) resetEvadingMob(sim.ctx, o);
      const down = mirror(1);
      expect(w.asleep).toBe(true);
      expect(down?.asleep).toBe(true);
      expect(ward(down)).toMatchObject({ kind: 'shield_wall', value: 0.95 });
    },
  );
});
