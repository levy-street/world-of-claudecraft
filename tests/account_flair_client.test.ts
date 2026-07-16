// Account flair (src/sim/account_flair.ts) as the ONLINE world mirrors it: the
// ClientWorld by-name flair cache behind `IWorld.accountFlair`.
//
// The load-bearing case, and the whole reason the flair rides the chat event rather
// than only the entity wire: general/world/lfg chat reaches you from players far
// OUTSIDE your ~120yd interest scope, where no entity record exists locally. The
// [AI] chat tag and the player menu's stream links have to work there anyway.
//
// The wire keys are pinned to literals here (`ai`, `slk` on the entity identity
// record; `flair` on the chat event), because the wire string IS the protocol.

import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { Sim } from '../src/sim/sim';

const TWITCH = 'https://twitch.tv/valequeen';

// Links a hostile operator (or a compromised wire) might try to land in the
// `window.open` the player menu performs: a script URL, a lookalike host, and a
// credentials-in-authority trick that makes an allowed host the "username".
const HOSTILE_LINKS = {
  twitch: 'javascript:alert(1)',
  x: 'https://x.com.evil.example/pwn',
  kick: 'https://kick.com@evil.example/pwn',
};

// --- harness: a real ClientWorld, DOM/network-free (mirrors world_api_parity.test.ts) ---

class StubWebSocket {
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = StubWebSocket.OPEN;
  constructor(public readonly url: string) {}
  send(): void {
    /* no-op: these tests never send */
  }
  close(): void {
    /* no-op: there is no real socket */
  }
}

function withDomStubs<T>(fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const prevWebSocket = g.WebSocket;
  const prevWindow = g.window;
  g.WebSocket = StubWebSocket as unknown;
  g.window = { setInterval: () => 0, clearInterval: () => undefined };
  try {
    return fn();
  } finally {
    g.WebSocket = prevWebSocket;
    g.window = prevWindow;
  }
}

// A real ClientWorld whose FIELD INITIALIZERS have run, so the flair cache under test
// is the production one and not a hand-rolled stand-in.
interface ClientInternals {
  applySnapshot(snap: unknown): void;
  onMessage(raw: string): void;
}

function makeWorld(): { world: ClientWorld; wire: ClientInternals } {
  const world = withDomStubs(() => {
    const w = new ClientWorld('flair-probe-token', 1, 'warrior', 'http://localhost');
    w.close();
    return w;
  });
  return { world, wire: world as unknown as ClientInternals };
}

// One `events` frame carrying a single chat line. `flair` omitted = an ordinary player.
// A guild/officer line is the SAME `t: 'events'` frame, but the server builds it on a
// second fan-out path (server/social.ts `deliver`, which never passes routeEvents), so
// the channel is a parameter here and every out-of-scope channel is pinned below.
function chatFrame(from: string, flair?: unknown, channel = 'general'): string {
  return JSON.stringify({
    t: 'events',
    list: [{ type: 'chat', fromPid: 77, from, text: 'hello vale', channel, flair }],
  });
}

// A full (identity-bearing) player record, the shape server/game.ts wireEntity emits.
function playerWire(id: number, nm: string, extra: Record<string, unknown> = {}): unknown {
  return {
    id,
    k: 'player',
    tid: 'mage',
    nm,
    lv: 12,
    x: 0,
    y: 0,
    z: 0,
    f: 0,
    hp: 100,
    mhp: 100,
    ...extra,
  };
}

function snapWith(ents: unknown[]): unknown {
  return { t: 'snap', ents, self: playerWire(1, 'Me') };
}

describe('ClientWorld.accountFlair: chat from outside the interest scope', () => {
  it('resolves a flagged sender who has NO local entity (the case that justifies the design)', () => {
    const { world, wire } = makeWorld();
    // The sender is nowhere near us: there is no entity to read flair off, and none
    // appears. The chat event is the ONLY carrier.
    expect(world.entities.size).toBe(0);

    wire.onMessage(chatFrame('ValeQueen', { ai: true, links: { twitch: TWITCH } }));

    expect(world.entities.size).toBe(0);
    expect(world.accountFlair('ValeQueen')).toEqual({ ai: true, links: { twitch: TWITCH } });
  });

  // Every channel that can reach you from OUTSIDE the ~120yd interest scope, where there
  // is no entity record to fall back on. guild/officer are the ones most at risk of
  // silently regressing: the server fans them out on a SECOND path (server/social.ts
  // `deliver`), so they must be decorated separately from the routeEvents chat filter.
  for (const channel of ['general', 'world', 'lfg', 'guild', 'officer'] as const) {
    it(`populates the cache from a decorated ${channel} line with no local entity`, () => {
      const { world, wire } = makeWorld();
      wire.onMessage(chatFrame('ValeQueen', { ai: true, links: { twitch: TWITCH } }, channel));

      expect(world.entities.size).toBe(0);
      expect(world.accountFlair('ValeQueen')).toEqual({ ai: true, links: { twitch: TWITCH } });
    });
  }

  it('populates from a guild line that carries no fromPid (the social.ts SocialEvent shape)', () => {
    // server/social.ts builds `{ type, from, text, channel }` with NO fromPid, unlike the
    // sim's chat event. The cache keys on the NAME, so this must still resolve: if it ever
    // needed fromPid, guild chat would silently lose its flair.
    const { world, wire } = makeWorld();
    wire.onMessage(
      JSON.stringify({
        t: 'events',
        list: [
          {
            type: 'chat',
            from: 'ValeQueen',
            text: 'raid at 8',
            channel: 'guild',
            flair: { ai: true, links: { twitch: TWITCH } },
          },
        ],
      }),
    );

    expect(world.accountFlair('ValeQueen')).toEqual({ ai: true, links: { twitch: TWITCH } });
  });

  it('looks up case-insensitively, and trims', () => {
    const { world, wire } = makeWorld();
    wire.onMessage(chatFrame('ValeQueen', { links: { twitch: TWITCH } }));

    const expected = { ai: false, links: { twitch: TWITCH } };
    expect(world.accountFlair('valequeen')).toEqual(expected);
    expect(world.accountFlair('VALEQUEEN')).toEqual(expected);
    expect(world.accountFlair('  ValeQueen  ')).toEqual(expected);
  });

  it('returns null for an unknown name, and for the empty string', () => {
    const { world, wire } = makeWorld();
    wire.onMessage(chatFrame('ValeQueen', { ai: true }));

    expect(world.accountFlair('Nobody')).toBeNull();
    expect(world.accountFlair('')).toBeNull();
  });

  it('does not cache an empty record for an ordinary (unflagged) sender', () => {
    const { world, wire } = makeWorld();
    wire.onMessage(chatFrame('PlainPlayer'));

    // Not `{ ai: false, links: {} }`: an unflagged account has no cache entry at all,
    // so the HUD's "is this player flagged" check is a single null test.
    expect(world.accountFlair('PlainPlayer')).toBeNull();
  });
});

describe('ClientWorld.accountFlair: the entity identity record', () => {
  it('decodes ai/slk onto the entity and into the cache', () => {
    const { world, wire } = makeWorld();
    wire.applySnapshot(snapWith([playerWire(9, 'Streamer', { ai: 1, slk: { twitch: TWITCH } })]));

    const ent = world.entities.get(9);
    expect(ent?.aiAccount).toBe(true);
    expect(ent?.streamerLinks).toEqual({ twitch: TWITCH });
    expect(world.accountFlair('Streamer')).toEqual({ ai: true, links: { twitch: TWITCH } });
  });

  it('CLEARS a stale entry when the operator turns the flags off', () => {
    const { world, wire } = makeWorld();
    wire.applySnapshot(snapWith([playerWire(9, 'Streamer', { ai: 1, slk: { twitch: TWITCH } })]));
    expect(world.accountFlair('Streamer')).not.toBeNull();

    // Flags off: the server re-sends a full identity record with no `ai`/`slk`. An
    // identity record is authoritative and complete, so absence means "no flair".
    wire.applySnapshot(snapWith([playerWire(9, 'Streamer')]));

    expect(world.entities.get(9)?.aiAccount).toBe(false);
    expect(world.entities.get(9)?.streamerLinks).toBeUndefined();
    expect(world.accountFlair('Streamer')).toBeNull();
  });

  it('leaves flair off a mob that happens to share a player name (flair is an ACCOUNT property)', () => {
    const { world, wire } = makeWorld();
    wire.applySnapshot(
      snapWith([
        { ...(playerWire(9, 'Streamer') as object), k: 'mob', ai: 1, slk: { twitch: TWITCH } },
      ]),
    );

    expect(world.accountFlair('Streamer')).toBeNull();
  });

  it('does not let an undecorated chat line wipe flair the entity wire established', () => {
    // Deliberate: chat is ADD-ONLY. Not every chat event carries flair (guild/officer
    // chat fans out through server/social.ts's own SocialEvent path, and a mob yell is
    // a chat event too), so a bare line is NOT evidence the sender is unflagged. Only
    // the identity record clears.
    const { world, wire } = makeWorld();
    wire.applySnapshot(snapWith([playerWire(9, 'Streamer', { ai: 1, slk: { twitch: TWITCH } })]));

    wire.onMessage(chatFrame('Streamer'));

    expect(world.accountFlair('Streamer')).toEqual({ ai: true, links: { twitch: TWITCH } });
  });
});

describe('ClientWorld.accountFlair: the wire is never trusted', () => {
  it('sanitizes a hostile link off the chat event so it can never reach window.open', () => {
    const { world, wire } = makeWorld();
    wire.onMessage(chatFrame('Impostor', { ai: true, links: HOSTILE_LINKS }));

    // The AI mark survives (it is a boolean, not a URL); every hostile link is dropped.
    expect(world.accountFlair('Impostor')).toEqual({ ai: true, links: {} });
  });

  it('sanitizes a hostile link off the entity identity record', () => {
    const { world, wire } = makeWorld();
    wire.applySnapshot(snapWith([playerWire(9, 'Impostor', { slk: HOSTILE_LINKS })]));

    expect(world.entities.get(9)?.streamerLinks).toBeUndefined();
    expect(world.accountFlair('Impostor')).toBeNull();
  });

  it('caches nothing at all when hostile links are the only flair on offer', () => {
    const { world, wire } = makeWorld();
    wire.onMessage(chatFrame('Impostor', { links: HOSTILE_LINKS }));

    expect(world.accountFlair('Impostor')).toBeNull();
  });
});

describe('Sim.accountFlair: the offline world has no accounts', () => {
  it('is always null', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior' });
    expect(sim.accountFlair('ValeQueen')).toBeNull();
  });
});
