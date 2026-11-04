// The retired `set_town_focus` wire token (Town Focus left the game on
// 2026-11-04). COMMAND_NAMES is append-only (the wire string IS the protocol),
// so the token stays as a dispatch-only tombstone the server swallows: a stale
// client bundle that still sends it must be met with silence, never the
// unknown-command anomaly arm, and must change nothing on the character.
import { describe, expect, it } from 'vitest';
import { GameServer } from '../../server/game';
import { COMMAND_NAMES, DISPATCH_ONLY_COMMANDS } from '../../src/world_api';
import { broadcast, fakeWs, joinServer, lastSnap } from '../helpers/bare_client';

describe('set_town_focus is a retired, dispatch-only tombstone', () => {
  it('keeps its append-only protocol token and sits on the dispatch-only allowlist', () => {
    expect(COMMAND_NAMES).toContain('set_town_focus');
    expect(DISPATCH_ONLY_COMMANDS).toContain('set_town_focus');
  });

  it('a stale client frame is swallowed: no throw, no state change, no wire echo', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Stale');
    const before = server.sim.serializeCharacter(session.pid)!;
    const copperBefore = server.sim.players.get(session.pid)?.copper ?? 0;
    fc.sent.length = 0;

    expect(() => {
      server.handleMessage(
        session,
        JSON.stringify({
          t: 'cmd',
          cmd: 'set_town_focus',
          allocation: { hide: 10 },
          tier: 'instant',
        }),
      );
    }).not.toThrow();

    const after = server.sim.serializeCharacter(session.pid)!;
    expect(after).toEqual(before);
    expect('townFocus' in after).toBe(false);
    expect('pendingTownFocus' in after).toBe(false);
    expect(server.sim.players.get(session.pid)?.copper).toBe(copperBefore);
    // Nothing is answered to the sender: no error toast, no outcome frame.
    expect(fc.sent.filter((f) => f.t === 'error' || f.t === 'commandOutcome')).toEqual([]);
    // The next snapshot carries neither retired self-wire key.
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap).not.toBeNull();
    expect('tfocus' in (snap.self ?? {})).toBe(false);
    expect('tfpend' in (snap.self ?? {})).toBe(false);
  });
});
