// The Cartographer's Ink picker's choice on the wire: ClientWorld.useItem puts
// the chosen map on the existing 'use' command as `inkMap`, and the server's
// 'use' arm forwards it raw to the sim, which re-validates it
// (src/sim/treasure_vault.ts useCartographersInk). Driven end to end: the
// client's real send is handed to the real GameServer dispatch.
import { describe, expect, it, vi } from 'vitest';
import {
  CARTOGRAPHERS_INK_ITEM_ID,
  TREASURE_MAP_ITEM_IDS,
  TREASURE_MAP_UPGRADE_INKS,
} from '../src/sim/content/treasure_maps';

// Mock the db layer so the online arm needs no Postgres. Hoisted above the
// server/game import; the key set mirrors tests/recipe_pattern_items.test.ts.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndGuildBankState: vi.fn(async () => true),
  loadGuildBankRow: vi.fn(async () => null),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

import { GameServer } from '../server/game';
import { bareClient, fakeWs, joinServer } from './helpers/bare_client';

function recordingClient(pid: number) {
  const sent: Record<string, unknown>[] = [];
  Object.assign(globalThis, { WebSocket: { OPEN: 1 } });
  const client = bareClient(pid, {
    ws: { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) },
  });
  return { client, sent };
}

describe("Cartographer's Ink target on the wire", () => {
  it('sends the chosen map on the use command, and omits it when none is chosen', () => {
    const { client, sent } = recordingClient(7);
    client.useItem(CARTOGRAPHERS_INK_ITEM_ID, {
      slotIndex: 3,
      inkMap: { rarity: 'common', read: false },
    });
    client.useItem(CARTOGRAPHERS_INK_ITEM_ID);
    expect(sent).toEqual([
      {
        t: 'cmd',
        cmd: 'use',
        item: CARTOGRAPHERS_INK_ITEM_ID,
        slot: 3,
        inkMap: { rarity: 'common', read: false },
      },
      { t: 'cmd', cmd: 'use', item: CARTOGRAPHERS_INK_ITEM_ID },
    ]);
    expect(Object.keys(sent[1]).sort()).toEqual(['cmd', 'item', 't']);
  });

  it("the server forwards the client's choice to the sim, which redraws that map", () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 9101, 'Inkwell');
    const sim = server.sim;
    sim.addItem(TREASURE_MAP_ITEM_IDS.rare, 1, session.pid);
    sim.useItem(TREASURE_MAP_ITEM_IDS.rare, session.pid);
    const read = { ...sim.players.get(session.pid)!.treasureMap! };
    sim.addItem(TREASURE_MAP_ITEM_IDS.common, 1, session.pid);
    sim.addItem(CARTOGRAPHERS_INK_ITEM_ID, TREASURE_MAP_UPGRADE_INKS.common, session.pid);

    const { client, sent } = recordingClient(session.pid);
    client.useItem(CARTOGRAPHERS_INK_ITEM_ID, { inkMap: { rarity: 'common', read: false } });
    for (const frame of sent) server.handleMessage(session, JSON.stringify(frame));

    // The unread common became a rare; the read rare (and its dig site) stayed.
    expect(sim.countItem(TREASURE_MAP_ITEM_IDS.common, session.pid)).toBe(0);
    expect(sim.countItem(TREASURE_MAP_ITEM_IDS.rare, session.pid)).toBe(2);
    expect(sim.countItem(CARTOGRAPHERS_INK_ITEM_ID, session.pid)).toBe(0);
    expect(sim.players.get(session.pid)!.treasureMap).toEqual(read);
  });
});
