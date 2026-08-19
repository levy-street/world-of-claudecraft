import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';

function bareClient(): { client: any; sent: unknown[] } {
  const sent: unknown[] = [];
  const client: any = Object.create(ClientWorld.prototype);
  client.connected = true;
  client.ws = {
    readyState: 1,
    send: (raw: string) => sent.push(JSON.parse(raw)),
  };
  return { client, sent };
}

describe('online poker wire', () => {
  it('sends only action intent with authoritative revision tokens', () => {
    const { client, sent } = bareClient();
    client.onMessage(
      JSON.stringify({
        t: 'poker_snapshot',
        names: { 10: 'Player' },
        snapshot: {
          tableId: 'low-stakes-1',
          handNumber: 7,
          actionSequence: 9,
          revision: 12,
          viewerSeat: 0,
          watching: false,
          turnDeadlineMs: 1000,
          config: {
            id: 'low-stakes-1',
            numSeats: 2,
            smallBlind: 10,
            bigBlind: 20,
            minBuyIn: 2000,
            maxBuyIn: 2000,
          },
          button: 0,
          street: 'preflop',
          actorSeat: 0,
          communityCards: [],
          pots: [],
          seats: [null, null],
          legalActions: null,
          lastResult: null,
        },
      }),
    );
    client.act({ type: 'raise', to: 400 });

    expect(sent).toEqual([
      {
        t: 'poker_action',
        tableId: 'low-stakes-1',
        handNumber: 7,
        actionSequence: 9,
        action: { type: 'raise', to: 400 },
      },
    ]);
    expect(JSON.stringify(sent)).not.toContain('playerId');
  });

  it('tracks table, snapshot, error, and connection state for the UI port', () => {
    const { client } = bareClient();
    client.onMessage(
      JSON.stringify({
        t: 'poker_tables',
        enabled: true,
        tables: [
          {
            tableId: 'low-stakes-1',
            watcherCount: 1,
            seatedCount: 2,
            inHand: true,
            openSeats: [],
          },
        ],
      }),
    );
    client.onMessage(JSON.stringify({ t: 'poker_error', code: 'stale_action' }));

    expect(client.pokerState()).toMatchObject({
      connected: true,
      enabled: true,
      error: 'stale_action',
      tables: [{ tableId: 'low-stakes-1' }],
    });
  });

  it('clears a stale table snapshot after the server confirms the viewer is detached', () => {
    const { client, sent } = bareClient();
    const snapshot = {
      tableId: 'low-stakes-1',
      handNumber: 1,
      actionSequence: 0,
      revision: 2,
      viewerSeat: null,
      watching: false,
      turnDeadlineMs: null,
      config: {
        id: 'low-stakes-1',
        numSeats: 2,
        smallBlind: 10,
        bigBlind: 20,
        minBuyIn: 2000,
        maxBuyIn: 2000,
      },
      button: null,
      street: null,
      actorSeat: null,
      communityCards: [],
      pots: [],
      seats: [null, null],
      legalActions: null,
      lastResult: null,
    };

    client.onMessage(JSON.stringify({ t: 'poker_snapshot', snapshot, names: {} }));

    expect(client.pokerState().snapshot).toBeNull();
    expect(client.pokerState().names).toEqual({});

    const seatedSnapshot = { ...snapshot, viewerSeat: 0 };
    client.onMessage(
      JSON.stringify({ t: 'poker_snapshot', snapshot: seatedSnapshot, names: { 1: 'Player' } }),
    );
    client.stopWatching('low-stakes-1');
    expect(client.pokerState().snapshot).toBeNull();
    expect(sent.at(-1)).toEqual({ t: 'poker_stop_watch', tableId: 'low-stakes-1' });

    client.onMessage(
      JSON.stringify({ t: 'poker_snapshot', snapshot: seatedSnapshot, names: { 1: 'Player' } }),
    );
    client.leave('low-stakes-1');
    expect(client.pokerState().snapshot).toBeNull();
    expect(sent.at(-1)).toEqual({ t: 'poker_leave', tableId: 'low-stakes-1' });
  });

  it('ignores malformed poker frames instead of installing unsafe UI state', () => {
    const { client } = bareClient();
    client.onMessage(
      JSON.stringify({
        t: 'poker_tables',
        enabled: true,
        tables: [{ tableId: '../bad', watcherCount: -1, seatedCount: 99 }],
      }),
    );
    client.onMessage(JSON.stringify({ t: 'poker_error', code: 'unknown_dynamic_key' }));

    expect(client.pokerState()).toMatchObject({
      enabled: false,
      error: null,
      tables: [],
    });
  });
});
