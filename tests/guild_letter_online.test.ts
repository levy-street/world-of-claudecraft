// The Guild trend letter over the live GameServer wire (Professions 2.0
// Phase 7 QA): the offline delivery suite (tests/professions_trend.test.ts)
// pins the sweep through the real Sim, but nothing pinned that the SERVER-side
// sweep books the letter and that the raven's mailArrived routes to only the
// owning session over the real pump (sim.tick() returning the buffered
// events, then routeEvents fanning per session), with the unread-envelope
// mirror (mailU) counting it. That is the 2033 stub-trap class of regression:
// if mailArrived were dropped from routing or the letterId stripped on the
// wire, every offline test would stay green. Modeled on the
// masterwork_zone_broadcast session-routing suite (Phase 6 QA).
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so the live GameServer suite needs no Postgres; only the
// sim sweep and the tick -> routeEvents wire pump are under test, never
// persistence (the corpse_harvest_sim broadcast-suite precedent; the vi.mock
// hoisting caveat from #2088 applies: this block cannot be imported).
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
}));

import { type ClientSession, GameServer } from '../server/game';
import type { PlayerMeta } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

const LETTER_ID = 'guild_trend_weaponcrafting_armorcrafting';

// Booking happens on the 1 Hz sweep within a second of the crossing; the raven
// then flies the standard 90 second NPC delivery delay (the professions_trend
// suite mirrors the same literal). 95 sim-seconds covers both with margin.
const DELIVERY_WINDOW_TICKS = 95 * 20;
const ONLINE_SUITE_TIMEOUT_MS = 40_000;

function fakeWs(): { sent: { t: string; list?: SimEvent[]; [k: string]: unknown }[]; ws: unknown } {
  const sent: { t: string; list?: SimEvent[] }[] = [];
  return {
    sent,
    ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) },
  };
}

function joinServer(
  server: GameServer,
  fc: ReturnType<typeof fakeWs>,
  id: number,
  name: string,
): ClientSession {
  const session = server.join(fc.ws as never, id, id, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

describe('guild letter over the live GameServer wire (session routing)', () => {
  it(
    'the server sweep books on crossing; mailArrived routes to only the owning session; mailU counts it; the one-shot holds',
    () => {
      const server = new GameServer();
      const fcCross = fakeWs();
      const fcOther = fakeWs();
      const fcThird = fakeWs();
      const sc = joinServer(server, fcCross, 81, 'Crosser');
      joinServer(server, fcOther, 82, 'Watcher');
      joinServer(server, fcThird, 83, 'Wanderer');

      // Drive the crosser past the threshold on the LIVE server sim (the
      // sweep reads meta.craftSkills; it draws no rng, so no seed hunting).
      const players = (server.sim as unknown as { players: Map<number, PlayerMeta> }).players;
      const meta = players.get(sc.pid);
      if (!meta) throw new Error('no crosser meta');
      meta.craftSkills.weaponcrafting = 13;
      meta.craftSkills.armorcrafting = 12;

      // The REAL pump: tick returns the buffered emits, routeEvents fans them
      // per session (the Phase 6 masterworkZone suite idiom).
      const route = (evs: SimEvent[]) =>
        (server as unknown as { routeEvents(e: SimEvent[]): void }).routeEvents(evs);
      for (let i = 0; i < DELIVERY_WINDOW_TICKS; i++) route(server.sim.tick());

      const guildEvsOf = (sent: { t: string; list?: SimEvent[] }[]) =>
        sent
          .filter((m) => m.t === 'events')
          .flatMap((m) => m.list ?? [])
          .filter(
            (ev) =>
              ev.type === 'mailArrived' &&
              ((ev as { letterId?: string }).letterId ?? '').startsWith('guild_trend_'),
          );
      // Exactly one arrival, exact wire payload, owner session only.
      expect(guildEvsOf(fcCross.sent)).toEqual([
        { type: 'mailArrived', senderName: 'The Crafting Guild', letterId: LETTER_ID, pid: sc.pid },
      ]);
      expect(guildEvsOf(fcOther.sent)).toEqual([]);
      expect(guildEvsOf(fcThird.sent)).toEqual([]);
      expect(meta.guildLetterSent).toBe(true);

      // The unread-envelope mirror: the welcome letter (delay 0) plus the
      // guild letter for the crosser, welcome only for the bystanders. Read
      // the same authoritative counter the snapshot's mailU key wires
      // (server/game.ts maybe('mailU', sim.mailUnreadFor(pid))).
      const unreadFor = (pid: number) =>
        (server.sim as unknown as { mailUnreadFor(pid: number): number }).mailUnreadFor(pid);
      const otherPids = [...players.keys()].filter((pid) => pid !== sc.pid);
      expect(unreadFor(sc.pid)).toBe(2);
      for (const pid of otherPids) expect(unreadFor(pid)).toBe(1);

      // One-shot at the booking level over the server path: a second
      // qualifying pair never re-books (asserted against the PostOffice store
      // so no second 90 second flight is needed).
      meta.craftSkills.jewelcrafting = 100;
      meta.craftSkills.enchanting = 100;
      for (let i = 0; i < 40; i++) route(server.sim.tick());
      const mailStore = (server.sim as unknown as { postOffice: { mail: { letterId?: string }[] } })
        .postOffice.mail;
      expect(mailStore.filter((m) => (m.letterId ?? '').startsWith('guild_trend_'))).toHaveLength(
        1,
      );
    },
    ONLINE_SUITE_TIMEOUT_MS,
  );
});
