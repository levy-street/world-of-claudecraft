// The page-close forfeit signal (src/net/online.ts sendLeaving, driven by
// pagehide): a page that goes away on purpose (Alt+F4, a closed window or tab,
// Quit, a reload) tells the server, which forfeits a live world PvP fight. A
// bare socket drop no longer does (server/world_pvp_departure.ts).
import { afterEach, expect, it, vi } from 'vitest';
import { bareClient } from './helpers/bare_client';

afterEach(() => vi.unstubAllGlobals());

function client(readyState: number) {
  vi.stubGlobal('WebSocket', { OPEN: 1 });
  const sent: Array<Record<string, unknown>> = [];
  const world = bareClient(1, {
    ws: { readyState, send: (payload: string) => sent.push(JSON.parse(payload)) },
  });
  return { world, sent };
}

it("sends one t:'leaving' frame while the socket is open", () => {
  const { world, sent } = client(1);
  world.sendLeaving();
  expect(sent).toEqual([{ t: 'leaving' }]);
});

it('stays silent once the session ended (a logout already said goodbye)', () => {
  const { world, sent } = client(1);
  (world as unknown as { sessionEnded: boolean }).sessionEnded = true;
  world.sendLeaving();
  expect(sent).toEqual([]);
});

it('stays silent when the socket is not open', () => {
  const { world, sent } = client(3);
  world.sendLeaving();
  expect(sent).toEqual([]);
});
