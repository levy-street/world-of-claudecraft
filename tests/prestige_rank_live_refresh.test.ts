// Prestige rank live refresh (issue #2137, second regression): the online
// character window kept showing the pre-prestige rank until closed and
// reopened. #2371 (v0.30.0) added a dedicated `prestige` SimEvent and had
// hud.ts repaint an already-open character sheet on it, but that repaint
// reads ClientWorld.prestigeRank at the moment the event is PROCESSED. The
// server sends this tick's `events` frame before the `snap` frame carrying
// the bumped `prk` field (server/game.ts: routeEvents runs inside the sim
// tick loop, broadcastSnapshots runs once after), so on the online host the
// repaint fired against the STALE mirror and the sheet froze one rank behind
// the chat line, exactly as reported on v0.31.0. The fix mirrors the event's
// own `rank` into ClientWorld.prestigeRank immediately, the same "immediacy
// arm" pattern already used for craft/masterwork/enchant/salvage results.
import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import type { SimEvent } from '../src/sim/types';

// A ClientWorld with no constructor run (the established bareClient pattern
// from tests/masterwork_event_mirror.test.ts / tests/snapshots.test.ts).
// Class-field initializers do not run under Object.create, so prestigeRank
// only comes to exist once the real event-apply path assigns it. Kept bespoke
// on purpose (issue #2088): the shared tests/helpers/bare_client.ts
// bareClient() always sets prestigeRank, which would defeat this liveness point.
function bareClient(): ClientWorld {
  const c = Object.create(ClientWorld.prototype) as ClientWorld;
  (c as unknown as { eventQueue: SimEvent[] }).eventQueue = [];
  return c;
}

// Feed one event through the real wire entry point (onMessage -> the
// 'events' branch -> applyPrestigeEvent), never by poking the field.
function feedEvents(client: ClientWorld, list: unknown[]): void {
  (client as unknown as { onMessage(raw: string): void }).onMessage(
    JSON.stringify({ t: 'events', list }),
  );
}

describe('ClientWorld prestige rank mirror', () => {
  it('updates prestigeRank from the events frame alone, before any snap frame arrives', () => {
    const client = bareClient();
    // The window's initial paint reflected rank 2 (a prior snapshot); the
    // next prestige lands rank 3 via the events frame, with no snap frame
    // received yet (the exact ordering the bug depends on).
    (client as unknown as { prestigeRank: number }).prestigeRank = 2;
    feedEvents(client, [
      { type: 'log', text: 'You have prestiged! Prestige Rank 3.', color: '#ffd100' },
      { type: 'prestige', rank: 3 },
    ]);
    expect(client.prestigeRank).toBe(3);
  });

  it('is a no-op for an unrelated event (does not clobber the mirror)', () => {
    const client = bareClient();
    (client as unknown as { prestigeRank: number }).prestigeRank = 5;
    feedEvents(client, [{ type: 'log', text: 'unrelated', color: '#ffd100' }]);
    expect(client.prestigeRank).toBe(5);
  });

  it('still queues the prestige event for the HUD (chat line + repaint trigger)', () => {
    const client = bareClient();
    (client as unknown as { prestigeRank: number }).prestigeRank = 0;
    feedEvents(client, [{ type: 'prestige', rank: 1 }]);
    const drained = client.drainEvents();
    expect(drained).toEqual([{ type: 'prestige', rank: 1 }]);
  });
});
