import { describe, expect, it } from 'vitest';
import { clampText } from '../electron/diagnostics.cjs';
import {
  candidatePipePaths,
  createDiscordPresence,
  DEFAULT_DISCORD_APP_ID,
  DISCORD_ANSWER_TIMEOUT_MS,
  DISCORD_BASE_BACKOFF_MS,
  DISCORD_DETAILS_MAX,
  DISCORD_LOG_TEXT_MAX,
  DISCORD_MAX_BACKOFF_MS,
  DISCORD_MIN_SEND_INTERVAL_MS,
  resolveDiscordClientId,
  sanitizeDiscordActivity,
} from '../electron/discord_presence.cjs';
import { decodeFrames, encodeFrame, OPCODES } from '../electron/discord_presence_codec.cjs';

// The Discord presence connection (electron/discord_presence.cjs) is pure and
// injected, so the whole state machine runs here with a fake socket, fake
// timers, and a fake clock. That is the only way these arms get tested at all:
// the interesting ones are a Discord that is not installed, a Discord that
// quits mid-session, and an app id that was never registered, and none of the
// three can be arranged in CI.
//
// Every arm asserts through what the fakes were ASKED to do (bytes written,
// timers armed, log lines emitted) rather than through the readout alone, so a
// state variable that says 'ready' while nothing reached the socket fails here.

const APP_ID = '123456789012345678';
const RUNTIME_DIR = '/run/user/1000';

interface ArmedTimer {
  handle: number;
  callback: () => void;
  delayMs: number;
}

interface FakeSocket {
  path: string;
  writes: Buffer[];
  /** Operation order ('write' | 'end' | 'destroy'), so ORDER contracts (the
   *  disable clear must be written BEFORE end()) are assertable, not just
   *  counts a reordering would satisfy. */
  ops: string[];
  ended: number;
  destroyed: number;
  /** When set, write() throws like a real pipe closed under the writer. */
  writeThrows: boolean;
  on: (event: string, listener: (...args: never[]) => void) => unknown;
  write: (data: unknown) => unknown;
  end: () => unknown;
  destroy: () => unknown;
  emit: (event: string, arg?: unknown) => void;
}

function createFakeSocket(path: string): FakeSocket {
  const listeners = new Map<string, ((arg?: unknown) => void)[]>();
  const socket: FakeSocket = {
    path,
    writes: [],
    ops: [],
    ended: 0,
    destroyed: 0,
    writeThrows: false,
    on: (event, listener) => {
      const list = listeners.get(event) ?? [];
      list.push(listener as unknown as (arg?: unknown) => void);
      listeners.set(event, list);
      return socket;
    },
    write: (data) => {
      socket.ops.push('write');
      if (socket.writeThrows) throw new Error('EPIPE');
      socket.writes.push(data as Buffer);
      return true;
    },
    end: () => {
      socket.ops.push('end');
      socket.ended += 1;
      return socket;
    },
    destroy: () => {
      socket.ops.push('destroy');
      socket.destroyed += 1;
      return socket;
    },
    emit: (event, arg) => {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(arg);
    },
  };
  return socket;
}

interface RigOptions {
  clientId?: string | null;
  platform?: string;
  env?: Record<string, string | undefined>;
  initiallyEnabled?: boolean;
  minSendIntervalMs?: number;
  maxBackoffMs?: number;
  /** null means "this platform has no getuid", which skips the ownership check. */
  uid?: number | null;
  clampTextFn?: (value: unknown, maxLength: number) => string;
}

/** What the fake stat says about one candidate path. */
type StatVerdict = 'ok' | 'foreign' | 'nonsocket' | 'throw';

function createRig(options: RigOptions = {}) {
  const sockets: FakeSocket[] = [];
  const statted: string[] = [];
  const timers: ArmedTimer[] = [];
  const cleared: number[] = [];
  const fired: number[] = [];
  const warnings: unknown[][] = [];
  const debugs: unknown[][] = [];
  const OUR_UID = 501;
  const state = {
    now: 1_000_000,
    nextHandle: 700,
    random: 1,
    connectThrows: false,
    connectReturnsNull: false,
    /** Per-path stat verdict; every candidate is a socket we own by default. */
    statVerdict: (_path: string): StatVerdict => 'ok',
  };
  const presence = createDiscordPresence({
    clientId: options.clientId === undefined ? APP_ID : options.clientId,
    connect: (path: string) => {
      if (state.connectThrows) throw new Error('EACCES');
      if (state.connectReturnsNull) return null;
      const socket = createFakeSocket(path);
      sockets.push(socket);
      return socket;
    },
    statPath: (path: string) => {
      statted.push(path);
      const verdict = state.statVerdict(path);
      if (verdict === 'throw') throw new Error('ENOENT');
      // A foreign socket is the squatting case: it exists, it is a socket, and
      // it belongs to somebody else on the machine.
      return {
        isSocket: () => verdict !== 'nonsocket',
        uid: verdict === 'foreign' ? 999 : OUR_UID,
      };
    },
    uid: options.uid === undefined ? OUR_UID : options.uid,
    clampText: options.clampTextFn,
    platform: options.platform ?? 'linux',
    env: options.env ?? { XDG_RUNTIME_DIR: RUNTIME_DIR },
    now: () => state.now,
    setTimeoutFn: (callback: () => void, delayMs: number) => {
      state.nextHandle += 1;
      timers.push({ handle: state.nextHandle, callback, delayMs });
      return state.nextHandle;
    },
    clearTimeoutFn: (handle: unknown) => {
      cleared.push(handle as number);
    },
    random: () => state.random,
    pid: 4321,
    log: {
      warn: (...args: unknown[]) => warnings.push(args),
      debug: (...args: unknown[]) => debugs.push(args),
    },
    initiallyEnabled: options.initiallyEnabled,
    minSendIntervalMs: options.minSendIntervalMs,
    maxBackoffMs: options.maxBackoffMs,
  });

  const live = () => sockets[sockets.length - 1];
  const framesOf = (socket: FakeSocket) =>
    socket.writes.flatMap((buffer) => decodeFrames(buffer).frames);
  const payloadsOf = (socket: FakeSocket) =>
    framesOf(socket).map((frame) => frame.payload as Record<string, unknown>);
  /** Deliver one frame the way a socket would: as bytes on a 'data' event. */
  const feed = (socket: FakeSocket, opcode: number, payload: unknown) => {
    socket.emit('data', encodeFrame(opcode, payload));
  };
  const ready = (socket: FakeSocket) => {
    socket.emit('connect');
    feed(socket, OPCODES.FRAME, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1 }, nonce: null });
  };
  /**
   * Timers armed and neither cleared nor already fired: what is really pending.
   * The raw `timers` array is append-only (the answer timeout arms once per
   * handshake and once per in-flight update, and is almost always disarmed by
   * the answer), so raw indexing stopped meaning anything; assertions about
   * "what is armed right now" go through this instead.
   */
  const liveTimers = () =>
    timers.filter((timer) => !cleared.includes(timer.handle) && !fired.includes(timer.handle));
  /** Fire the index-th LIVE timer at its due time, advancing the clock the way one does. */
  const fireTimer = (index: number) => {
    const timer = liveTimers()[index];
    fired.push(timer.handle);
    state.now += timer.delayMs;
    timer.callback();
  };
  /** Fail every candidate path, the way a machine with no Discord answers. */
  const failWholeWalk = () => {
    for (let guard = 0; guard < 200; guard += 1) {
      const socket = live();
      if (!socket) break;
      const before = sockets.length;
      socket.emit('error', new Error('ENOENT'));
      if (sockets.length === before) break;
    }
  };
  /** Bring a connection all the way up with one activity showing. */
  const bringUp = (activity: unknown) => {
    presence.setActivity(activity);
    ready(live());
    return live();
  };

  return {
    presence,
    sockets,
    statted,
    timers,
    cleared,
    warnings,
    debugs,
    state,
    live,
    liveTimers,
    framesOf,
    payloadsOf,
    feed,
    ready,
    fireTimer,
    failWholeWalk,
    bringUp,
  };
}

describe('discord candidate socket paths', () => {
  it('pins the linux walk, with the sandboxed installs, n-major', () => {
    const paths = candidatePipePaths('linux', {
      XDG_RUNTIME_DIR: RUNTIME_DIR,
      TMPDIR: '/var/tmp',
    });
    // Five bases in priority order, and slot 0 for ALL of them before slot 1
    // for any: a base-major walk would spend nine dead connects on the runtime
    // directory before reaching the Flatpak socket that actually answers.
    expect(paths.slice(0, 5)).toEqual([
      '/run/user/1000/discord-ipc-0',
      '/run/user/1000/app/com.discordapp.Discord/discord-ipc-0',
      '/run/user/1000/snap.discord/discord-ipc-0',
      '/var/tmp/discord-ipc-0',
      '/tmp/discord-ipc-0',
    ]);
    expect(paths.slice(5, 10)).toEqual([
      '/run/user/1000/discord-ipc-1',
      '/run/user/1000/app/com.discordapp.Discord/discord-ipc-1',
      '/run/user/1000/snap.discord/discord-ipc-1',
      '/var/tmp/discord-ipc-1',
      '/tmp/discord-ipc-1',
    ]);
    expect(paths).toHaveLength(50);
    expect(paths[49]).toBe('/tmp/discord-ipc-9');
  });

  it('falls back to /tmp alone when the environment says nothing', () => {
    const paths = candidatePipePaths('linux', {});
    expect(paths).toEqual([
      '/tmp/discord-ipc-0',
      '/tmp/discord-ipc-1',
      '/tmp/discord-ipc-2',
      '/tmp/discord-ipc-3',
      '/tmp/discord-ipc-4',
      '/tmp/discord-ipc-5',
      '/tmp/discord-ipc-6',
      '/tmp/discord-ipc-7',
      '/tmp/discord-ipc-8',
      '/tmp/discord-ipc-9',
    ]);
    // An absent env object is the same answer, not a throw: main passes
    // process.env, but nothing about the signature promises it is populated.
    expect(candidatePipePaths('linux', undefined)).toEqual(paths);
  });

  it('never lists the same base twice when TMPDIR is /tmp', () => {
    const paths = candidatePipePaths('linux', { TMPDIR: '/tmp' });
    expect(paths).toHaveLength(10);
    expect(new Set(paths).size).toBe(10);
  });

  it('gives macOS no flatpak or snap subdirectory', () => {
    // Neither packaging exists there, so those two would be ten dead connects
    // each on every walk.
    const paths = candidatePipePaths('darwin', { XDG_RUNTIME_DIR: RUNTIME_DIR, TMPDIR: '/var/t' });
    expect(paths.slice(0, 3)).toEqual([
      '/run/user/1000/discord-ipc-0',
      '/var/t/discord-ipc-0',
      '/tmp/discord-ipc-0',
    ]);
    expect(paths).toHaveLength(30);
    expect(paths.some((path) => path.includes('com.discordapp.Discord'))).toBe(false);
    expect(paths.some((path) => path.includes('snap.discord'))).toBe(false);
  });

  it('uses named pipes on Windows and ignores the environment there', () => {
    const paths = candidatePipePaths('win32', { XDG_RUNTIME_DIR: RUNTIME_DIR, TMPDIR: '/var/tmp' });
    expect(paths).toEqual([
      '\\\\?\\pipe\\discord-ipc-0',
      '\\\\?\\pipe\\discord-ipc-1',
      '\\\\?\\pipe\\discord-ipc-2',
      '\\\\?\\pipe\\discord-ipc-3',
      '\\\\?\\pipe\\discord-ipc-4',
      '\\\\?\\pipe\\discord-ipc-5',
      '\\\\?\\pipe\\discord-ipc-6',
      '\\\\?\\pipe\\discord-ipc-7',
      '\\\\?\\pipe\\discord-ipc-8',
      '\\\\?\\pipe\\discord-ipc-9',
    ]);
  });
});

describe('discord app id resolution', () => {
  it('ships the official application id as the baked default', () => {
    // Pinned to the LITERAL, not through the constant production reads: the
    // registration under the name "World of ClaudeCraft" carries exactly this
    // snowflake, and a drifted digit would dial a stranger's app while every
    // shape check stays green. Owner provisioning decision, 2026-08-15.
    expect(DEFAULT_DISCORD_APP_ID).toBe('1537920691200983141');
    expect(resolveDiscordClientId({})).toBe('1537920691200983141');
    expect(resolveDiscordClientId(undefined)).toBe('1537920691200983141');
  });

  it('lets a valid env id override the default, and nothing else through', () => {
    // The id is written straight into a handshake. A set-but-invalid value
    // (the empty string included) resolves to null and keeps the feature
    // inert: the typo failure mode and the documented fork opt-out
    // (WOC_DISCORD_APP_ID=off), never a silent fall-through to the default.
    expect(resolveDiscordClientId({ WOC_DISCORD_APP_ID: APP_ID })).toBe(APP_ID);
    expect(resolveDiscordClientId({ WOC_DISCORD_APP_ID: '1'.repeat(15) })).toBe('1'.repeat(15));
    expect(resolveDiscordClientId({ WOC_DISCORD_APP_ID: '1'.repeat(22) })).toBe('1'.repeat(22));
    for (const junk of [
      '1'.repeat(14),
      '1'.repeat(23),
      '12345678901234567a',
      ' 123456789012345678',
      '123456789012345678 ',
      '',
      'off',
      '-123456789012345678',
    ]) {
      expect(
        resolveDiscordClientId({ WOC_DISCORD_APP_ID: junk }),
        `${JSON.stringify(junk)} must resolve to inert, not to an app id or the default`,
      ).toBeNull();
    }
  });
});

describe('discord activity whitelist', () => {
  // EXECUTED, not read off the handler. This function decides what leaves the
  // machine and reaches another program's UI, so the pins below are about the
  // exact key set of the object it returns: a field added later (a character
  // name, a party id, a join secret) would be invisible to any source-text pin
  // on the IPC handler, and visible here immediately.
  it('returns a fresh object carrying only the two allowed keys', () => {
    const clean = sanitizeDiscordActivity({ details: 'Eastbrook' }, clampText);
    expect(clean).toEqual({ details: 'Eastbrook' });
    expect(Object.keys(clean ?? {})).toEqual(['details']);

    const withStart = sanitizeDiscordActivity(
      { details: 'Eastbrook', timestamps: { start: 1723600000 } },
      clampText,
    );
    expect(Object.keys(withStart ?? {})).toEqual(['details', 'timestamps']);
    expect(Object.keys(withStart?.timestamps ?? {})).toEqual(['start']);
    expect(withStart?.timestamps?.start).toBe(1723600000);
  });

  it('drops every field Discord would happily have accepted', () => {
    // Each of these is a real Rich Presence field: state, party size, join
    // secrets, images, buttons. Reporting any of them would be a privacy
    // decision nobody made, so the whitelist has to be an allow list rather
    // than a deny list, and this proves it by execution.
    const payload = JSON.parse(
      JSON.stringify({
        details: 'Eastbrook',
        state: 'Fighting Grimjaw',
        party: { id: 'party-77', size: [3, 5] },
        secrets: { join: 'a-real-secret' },
        assets: { large_image: 'https://example.invalid/x.png' },
        buttons: [{ label: 'Join', url: 'https://example.invalid' }],
        instance: true,
        timestamps: { start: 1723600000, end: 1723609999 },
      }),
    );
    const clean = sanitizeDiscordActivity(payload, clampText);
    expect(Object.keys(clean ?? {})).toEqual(['details', 'timestamps']);
    // Even inside the one nested object that survives, only start crosses.
    expect(Object.keys(clean?.timestamps ?? {})).toEqual(['start']);
    expect(JSON.stringify(clean)).not.toContain('secret');
    expect(JSON.stringify(clean)).not.toContain('Grimjaw');
  });

  it('cannot be used to pollute Object.prototype', () => {
    // An own __proto__ key, the shape JSON.parse produces (an object literal
    // would set the prototype instead of an own property).
    const payload = JSON.parse('{"__proto__":{"polluted":"yes"},"details":"Eastbrook"}');
    const clean = sanitizeDiscordActivity(payload, clampText);
    expect(Object.keys(clean ?? {})).toEqual(['details']);
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(Object.getPrototypeOf(clean)).toBe(Object.prototype);
  });

  it('refuses every malformed payload rather than repairing it', () => {
    for (const junk of [
      null,
      undefined,
      42,
      'Eastbrook',
      true,
      [],
      [{ details: 'Eastbrook' }],
      {},
      { details: 5 },
      { details: null },
      { details: '' },
      { details: '   ' },
    ]) {
      expect(
        sanitizeDiscordActivity(junk, clampText),
        `${JSON.stringify(junk)} must be refused`,
      ).toBeNull();
    }
    // Timestamps are refused WHOLE rather than stripped, one arm per failure
    // mode: a start that was meant to be sent and quietly vanished would show
    // the player a counter running from the wrong moment.
    for (const timestamps of [
      null,
      'now',
      42,
      [],
      {},
      { start: 0 },
      { start: -1 },
      { start: 1.5 },
      { start: '1723600000' },
      { start: Number.NaN },
      { start: Number.POSITIVE_INFINITY },
      { start: Number.MAX_SAFE_INTEGER + 2 },
      { end: 1723600000 },
    ]) {
      expect(
        sanitizeDiscordActivity({ details: 'Eastbrook', timestamps }, clampText),
        `timestamps ${JSON.stringify(timestamps)} must refuse the whole activity`,
      ).toBeNull();
    }
    // And the accepted arm, so the refusals cannot be satisfied by refusing
    // everything.
    expect(
      sanitizeDiscordActivity({ details: 'Eastbrook', timestamps: { start: 1 } }, clampText),
    ).toEqual({ details: 'Eastbrook', timestamps: { start: 1 } });
  });

  it('clamps details to a length Discord will actually accept', () => {
    // clampText appends three dots ON TOP of the cap it is given, so the cap
    // has to sit below Discord's own 128 or the longest string this can produce
    // is one the daemon rejects outright.
    expect(DISCORD_DETAILS_MAX).toBe(125);
    const clean = sanitizeDiscordActivity({ details: 'a'.repeat(400) }, clampText);
    expect(clean?.details).toHaveLength(DISCORD_DETAILS_MAX + 3);
    expect(clean?.details.length).toBeLessThanOrEqual(128);
    // The injected clamp is the real one, so control characters are flattened
    // on the way out too: this string lands in a surface other people read.
    const flattened = sanitizeDiscordActivity(
      { details: `East\nbrook${String.fromCodePoint(0x0007)}` },
      clampText,
    );
    expect(flattened?.details).not.toContain('\n');
    expect(flattened?.details).not.toContain(String.fromCodePoint(0x0007));
  });

  it('stays bounded when no clamp is injected, and refuses a clamp that misbehaves', () => {
    // The fallback exists so the module is never silently unbounded when used
    // standalone; it is a slice, so there is no suffix to account for.
    expect(sanitizeDiscordActivity({ details: 'a'.repeat(400) })?.details).toHaveLength(
      DISCORD_DETAILS_MAX,
    );
    // A clamp that returns something other than a string is a wiring bug, and
    // it must refuse rather than send a non-string into a JSON frame.
    expect(
      sanitizeDiscordActivity({ details: 'Eastbrook' }, (() => 42) as unknown as typeof clampText),
    ).toBeNull();
  });
});

describe('discord presence connection (electron/discord_presence.cjs)', () => {
  it('pins the pacing and backoff constants to their literals', () => {
    // The send floor is Discord's own rate limit; the ceiling is how long a
    // player who never runs Discord waits between pointless walks.
    expect(DISCORD_MIN_SEND_INTERVAL_MS).toBe(15000);
    expect(DISCORD_BASE_BACKOFF_MS).toBe(2000);
    expect(DISCORD_MAX_BACKOFF_MS).toBe(60000);
    // The bounded wait for a peer's required answer (READY, or a nonce echo):
    // generous next to Discord's one-turn reality, small next to a session.
    expect(DISCORD_ANSWER_TIMEOUT_MS).toBe(10000);
    // The peer-text log bound rides this literal: the two bounded-log arms
    // compare against the imported constant, so without this pin a raised
    // constant would vacuously green the whole hostile-peer guarantee.
    expect(DISCORD_LOG_TEXT_MAX).toBe(200);
  });

  it('does no IO at construction', () => {
    // main.cjs builds this at module scope, before the window exists. A socket
    // or a timer here would be boot-path work for a player who may never enter
    // the world.
    const rig = createRig();
    expect(rig.sockets).toEqual([]);
    expect(rig.timers).toEqual([]);
    expect(rig.presence.stateForTest().state).toBe('idle');
  });

  it('connects only when there is something to show', () => {
    const rig = createRig({ initiallyEnabled: false });
    rig.presence.setEnabled(true);
    expect(rig.sockets).toEqual([]);
    // A clear with nothing running is not a reason to dial either.
    rig.presence.setActivity(null);
    expect(rig.sockets).toEqual([]);
    rig.presence.setActivity({ details: 'Eastbrook' });
    expect(rig.sockets).toHaveLength(1);
    expect(rig.sockets[0].path).toBe('/run/user/1000/discord-ipc-0');
    expect(rig.presence.stateForTest().state).toBe('connecting');
  });

  it('stays completely inert without an app id', () => {
    const rig = createRig({ clientId: null });
    rig.presence.setActivity({ details: 'Eastbrook' });
    rig.presence.setEnabled(true);
    rig.presence.setActivity({ details: 'Vale of Kings' });
    expect(rig.sockets).toEqual([]);
    expect(rig.timers).toEqual([]);
    expect(rig.warnings).toEqual([]);
    expect(rig.presence.stateForTest().state).toBe('absent');
  });

  it('sends the handshake with the app id as soon as a socket comes up', () => {
    const rig = createRig();
    rig.presence.setActivity({ details: 'Eastbrook' });
    const socket = rig.live();
    socket.emit('connect');
    expect(rig.framesOf(socket)).toEqual([
      { opcode: OPCODES.HANDSHAKE, payload: { v: 1, client_id: APP_ID } },
    ]);
    expect(rig.presence.stateForTest().state).toBe('handshaking');
  });

  it('walks to the next candidate path when a socket fails to come up', () => {
    const rig = createRig();
    rig.presence.setActivity({ details: 'Eastbrook' });
    rig.live().emit('error', new Error('ENOENT'));
    expect(rig.sockets).toHaveLength(2);
    expect(rig.sockets[1].path).toBe('/run/user/1000/app/com.discordapp.Discord/discord-ipc-0');
    // The refused socket is released rather than left half-open.
    expect(rig.sockets[0].destroyed).toBe(1);
    // A close with no error is the same event (a pipe that accepted and hung up).
    rig.live().emit('close');
    expect(rig.sockets).toHaveLength(3);
    expect(rig.sockets[2].path).toBe('/run/user/1000/snap.discord/discord-ipc-0');
    // And a connect() that THROWS (EACCES on a socket owned by another user)
    // must not escape into the caller's setActivity.
    rig.state.connectThrows = true;
    expect(() => rig.live().emit('error', new Error('ENOENT'))).not.toThrow();
  });

  it('advances the walk when a candidate accepts and hangs up before READY', () => {
    const rig = createRig();
    rig.presence.setActivity({ details: 'Eastbrook' });
    const first = rig.live();
    first.emit('connect');
    expect(rig.presence.stateForTest().state).toBe('handshaking');
    // Accepting proved something listens at the slot, not that it is Discord:
    // the walk must move on in the SAME pass rather than back off, because the
    // retry restarts at slot 0 and would re-dial the hung-up slot forever
    // while a real Discord sat unreached at a later one.
    first.emit('close');
    expect(rig.sockets).toHaveLength(2);
    expect(rig.sockets[1].path).toBe('/run/user/1000/app/com.discordapp.Discord/discord-ipc-0');
    expect(rig.presence.stateForTest().state).toBe('connecting');
    // A later slot that answers READY still wins the walk.
    rig.ready(rig.live());
    expect(rig.presence.stateForTest().state).toBe('ready');
  });

  it('backs off once a hangup-advanced walk exhausts every candidate', () => {
    const rig = createRig();
    rig.presence.setActivity({ details: 'Eastbrook' });
    for (let guard = 0; guard < 60; guard += 1) {
      if (rig.presence.stateForTest().state === 'backoff') break;
      const socket = rig.live();
      socket.emit('connect');
      socket.emit('close');
    }
    // Every slot accepted and dropped: that is still "no usable Discord", so
    // the walk ends in the ordinary silent backoff, not a tight loop.
    expect(rig.presence.stateForTest().state).toBe('backoff');
    expect(rig.liveTimers()).toHaveLength(1);
    expect(rig.warnings).toEqual([]);
  });

  it('never dials a socket another user owns', () => {
    // The walk ends at /tmp, world-writable on every unix we ship to. A second
    // local account can listen on one of these names and answer the handshake,
    // and the shell would hand it the presence line. Ownership is checked
    // BEFORE the dial, so the squatter never even sees a connection.
    const rig = createRig();
    rig.state.statVerdict = (path) => (path === '/run/user/1000/discord-ipc-0' ? 'foreign' : 'ok');
    rig.presence.setActivity({ details: 'Eastbrook' });
    expect(rig.statted[0]).toBe('/run/user/1000/discord-ipc-0');
    expect(rig.sockets).toHaveLength(1);
    expect(rig.sockets[0].path).toBe('/run/user/1000/app/com.discordapp.Discord/discord-ipc-0');
    // Skipped, not attempted: the counter tracks dials, and a path that was
    // never dialed must not read as one that was refused.
    expect(rig.presence.stateForTest().connectAttempts).toBe(1);
  });

  it('never dials an entry that is not a socket, or one it cannot stat', () => {
    // A regular file (or a directory) planted at the path is the same squat by
    // another route, and a stat that throws is the ordinary "nothing there".
    for (const verdict of ['nonsocket', 'throw'] as const) {
      const rig = createRig();
      rig.state.statVerdict = (path) => (path === '/run/user/1000/discord-ipc-0' ? verdict : 'ok');
      rig.presence.setActivity({ details: 'Eastbrook' });
      expect(rig.sockets, `${verdict} must be skipped`).toHaveLength(1);
      expect(rig.sockets[0].path).toBe('/run/user/1000/app/com.discordapp.Discord/discord-ipc-0');
    }
  });

  it('dials nothing at all when every candidate is squatted', () => {
    const rig = createRig();
    rig.state.statVerdict = () => 'foreign';
    rig.presence.setActivity({ details: 'Eastbrook' });
    expect(rig.sockets).toEqual([]);
    expect(rig.presence.stateForTest().connectAttempts).toBe(0);
    // Every candidate was still LOOKED at, so this is a refusal rather than a
    // walk that stopped early, and it degrades into the ordinary backoff.
    expect(rig.statted).toHaveLength(40);
    expect(rig.timers).toHaveLength(1);
    expect(rig.warnings).toEqual([]);
    expect(rig.presence.stateForTest().state).toBe('backoff');
  });

  it('checks only the socket kind when the platform has no uid to compare', () => {
    // Windows has no getuid, and neither does a caller that passed none; the
    // ownership question is unanswerable there, but the socket check still is.
    const rig = createRig({ uid: null });
    rig.state.statVerdict = (path) => (path === '/run/user/1000/discord-ipc-0' ? 'foreign' : 'ok');
    rig.presence.setActivity({ details: 'Eastbrook' });
    expect(rig.sockets[0].path).toBe('/run/user/1000/discord-ipc-0');
    const nonSocket = createRig({ uid: null });
    nonSocket.state.statVerdict = (path) =>
      path === '/run/user/1000/discord-ipc-0' ? 'nonsocket' : 'ok';
    nonSocket.presence.setActivity({ details: 'Eastbrook' });
    expect(nonSocket.sockets[0].path).toBe(
      '/run/user/1000/app/com.discordapp.Discord/discord-ipc-0',
    );
  });

  it('skips the stat entirely for a Windows named pipe', () => {
    // There is no meaningful stat for one, and the pipe namespace is not a
    // world-writable directory to begin with.
    const rig = createRig({ platform: 'win32' });
    rig.state.statVerdict = () => 'throw';
    rig.presence.setActivity({ details: 'Eastbrook' });
    expect(rig.statted).toEqual([]);
    expect(rig.sockets).toHaveLength(1);
    expect(rig.sockets[0].path).toBe('\\\\?\\pipe\\discord-ipc-0');
  });

  it('never logs unbounded or control-laden text a peer wrote', () => {
    // Everything on this socket comes from another program. Unbounded, a
    // hostile peer grows the log file without limit; with newlines, it forges
    // log lines around its own.
    const rig = createRig({ clampTextFn: clampText });
    rig.presence.setActivity({ details: 'Eastbrook' });
    rig.live().emit('connect');
    rig.feed(rig.live(), OPCODES.CLOSE, {
      code: 4000,
      message: `${'A'.repeat(10000)}\nfake log line`,
    });
    expect(rig.warnings).toHaveLength(1);
    const logged = rig.warnings[0][2] as string;
    expect(typeof logged).toBe('string');
    // The cap plus clampText's three-dot suffix, and nothing that could pass
    // for a line of its own.
    expect(logged.length).toBeLessThanOrEqual(DISCORD_LOG_TEXT_MAX + 3);
    expect(logged).not.toContain('\n');
    // The numeric code is not text and rides as itself, so the log stays
    // readable and the existing refusal pin still means what it says.
    expect(rig.warnings[0][1]).toBe(4000);
  });

  it('bounds a rejected-update message from the peer as well', () => {
    const rig = createRig({ clampTextFn: clampText });
    const socket = rig.bringUp({ details: 'Eastbrook' });
    rig.feed(socket, OPCODES.FRAME, {
      cmd: 'SET_ACTIVITY',
      evt: 'ERROR',
      data: { code: 4000, message: 'B'.repeat(10000) },
      nonce: 'woc-1',
    });
    const logged = rig.warnings[0][1] as string;
    expect(logged.length).toBeLessThanOrEqual(DISCORD_LOG_TEXT_MAX + 3);
  });

  it('treats a machine with no Discord as silent, with a jittered backoff', () => {
    const rig = createRig();
    rig.presence.setActivity({ details: 'Eastbrook' });
    rig.failWholeWalk();
    // Forty candidates on this env (four bases, ten slots), all refused.
    expect(rig.presence.stateForTest().connectAttempts).toBe(40);
    // The common case for most players: nothing above debug, ever.
    expect(rig.warnings).toEqual([]);
    expect(rig.debugs.length).toBeGreaterThan(0);
    expect(rig.timers).toHaveLength(1);
    // random() pinned at 1 makes the jitter factor exactly 1.
    expect(rig.timers[0].delayMs).toBe(DISCORD_BASE_BACKOFF_MS);
    expect(rig.presence.stateForTest().state).toBe('backoff');
    // Half the base at the other end of the jitter range, so the factor is
    // really 0.5 + random()/2 rather than a constant.
    const low = createRig();
    low.state.random = 0;
    low.presence.setActivity({ details: 'Eastbrook' });
    low.failWholeWalk();
    expect(low.timers[0].delayMs).toBe(DISCORD_BASE_BACKOFF_MS / 2);
  });

  it('doubles the backoff on each failed walk and stops at the ceiling', () => {
    const rig = createRig({ env: {}, maxBackoffMs: 5000 });
    rig.presence.setActivity({ details: 'Eastbrook' });
    rig.failWholeWalk();
    const delays: number[] = [rig.liveTimers()[0].delayMs];
    for (let round = 1; round < 4; round += 1) {
      // The retry is the only live timer between walks (no candidate here ever
      // accepts, so no answer timeout is armed).
      rig.fireTimer(0);
      rig.failWholeWalk();
      delays.push(rig.liveTimers()[0].delayMs);
    }
    expect(delays).toEqual([2000, 4000, 5000, 5000]);
    // Ten candidates per walk on the bare env, and every walk really happened.
    expect(rig.presence.stateForTest().connectAttempts).toBe(40);
  });

  it('does not reconnect for a player who turned it off, or with nothing to show', () => {
    const rig = createRig();
    rig.presence.setActivity({ details: 'Eastbrook' });
    rig.failWholeWalk();
    rig.presence.setActivity(null);
    rig.fireTimer(0);
    expect(rig.sockets).toHaveLength(40);
    expect(rig.presence.stateForTest().state).toBe('idle');
    // And it is not stuck: the next real activity dials again.
    rig.presence.setActivity({ details: 'Vale of Kings' });
    expect(rig.sockets).toHaveLength(41);
  });

  it('sends the desired activity as soon as Discord answers READY', () => {
    const rig = createRig();
    const socket = rig.bringUp({ details: 'Eastbrook', timestamps: { start: 17 } });
    expect(rig.presence.stateForTest().state).toBe('ready');
    expect(rig.framesOf(socket)[1]).toEqual({
      opcode: OPCODES.FRAME,
      payload: {
        cmd: 'SET_ACTIVITY',
        args: { pid: 4321, activity: { details: 'Eastbrook', timestamps: { start: 17 } } },
        nonce: 'woc-1',
      },
    });
    expect(rig.presence.stateForTest().pendingNonce).toBe('woc-1');
    // A first connection starts with a clean backoff. READY alone no longer
    // FORGIVES an escalated one: forgiveness waits for an acknowledged update
    // (the dedicated escalation arms below own that contract).
    expect(rig.presence.stateForTest().backoffMs).toBe(0);
  });

  it('keeps escalating the backoff while READY connections die unacknowledged', () => {
    // The win32 pipe namespace has no ownership gate, so a squatter can answer
    // READY forever. Forgiving the backoff AT READY handed exactly that peer a
    // one-to-two-second redial loop for the whole session (every cycle reset
    // the escalation); forgiveness now waits for an acknowledged SET_ACTIVITY,
    // which a drop-on-READY peer never produces, so its redials stretch out.
    const rig = createRig();
    rig.presence.setActivity({ details: 'Eastbrook' });
    rig.ready(rig.live());
    rig.live().emit('close');
    expect(rig.presence.stateForTest().state).toBe('backoff');
    expect(rig.liveTimers()[0].delayMs).toBe(DISCORD_BASE_BACKOFF_MS);
    rig.fireTimer(0);
    rig.ready(rig.live());
    // The re-send is still waiting out the rate-limit floor, so nothing was
    // acknowledged when the peer drops again: the backoff doubles.
    rig.live().emit('close');
    expect(rig.liveTimers()[0].delayMs).toBe(DISCORD_BASE_BACKOFF_MS * 2);
    rig.fireTimer(0);
    rig.ready(rig.live());
    rig.live().emit('close');
    expect(rig.liveTimers()[0].delayMs).toBe(DISCORD_BASE_BACKOFF_MS * 4);
    // Still the silent arm: a squatter is a no-Discord machine, not a warning.
    expect(rig.warnings).toEqual([]);
  });

  it('forgives the backoff once Discord acknowledges an update', () => {
    const rig = createRig();
    rig.presence.setActivity({ details: 'Eastbrook' });
    rig.ready(rig.live());
    rig.live().emit('close');
    // One unproven READY behind us: the escalation is live at the base delay.
    rig.fireTimer(0);
    rig.ready(rig.live());
    // Fire the deferred re-send (the floor spans the reconnect), then answer
    // it: the echo is what proves a working Discord sits at the far end.
    rig.fireTimer(0);
    rig.feed(rig.live(), OPCODES.FRAME, {
      cmd: 'SET_ACTIVITY',
      evt: null,
      data: null,
      nonce: 'woc-2',
    });
    expect(rig.presence.stateForTest().backoffMs).toBe(0);
    rig.live().emit('close');
    // A drop AFTER the ack is a new problem: the retry starts from the base
    // again instead of continuing the escalation.
    expect(rig.liveTimers()[0].delayMs).toBe(DISCORD_BASE_BACKOFF_MS);
  });

  it('bounds a silent-accept peer with the answer timeout, escalating on repeat', () => {
    // A peer that accepts and never answers the handshake used to park the
    // state machine in 'handshaking' until the socket happened to close (the
    // ledger declared it out of scope). It now costs one answer window, then
    // the socket is destroyed and the ordinary backoff path takes over.
    const rig = createRig();
    rig.presence.setActivity({ details: 'Eastbrook' });
    const socket = rig.live();
    socket.emit('connect');
    expect(rig.presence.stateForTest().state).toBe('handshaking');
    expect(rig.liveTimers().map((timer) => timer.delayMs)).toEqual([DISCORD_ANSWER_TIMEOUT_MS]);
    rig.fireTimer(0);
    expect(socket.destroyed).toBe(1);
    expect(rig.presence.stateForTest().state).toBe('backoff');
    expect(rig.liveTimers()[0].delayMs).toBe(DISCORD_BASE_BACKOFF_MS);
    // The same silence on the retry ESCALATES rather than resetting: nothing
    // was ever acknowledged, so this walks the same doubling as any failure.
    rig.fireTimer(0);
    rig.live().emit('connect');
    rig.fireTimer(0);
    expect(rig.presence.stateForTest().state).toBe('backoff');
    expect(rig.liveTimers()[0].delayMs).toBe(DISCORD_BASE_BACKOFF_MS * 2);
    // Silent at debug, like every other no-usable-Discord arm.
    expect(rig.warnings).toEqual([]);
  });

  it('bounds a peer that answers READY but never echoes a SET_ACTIVITY nonce', () => {
    // The pending-nonce wait rides the same timeout: without it, an unanswered
    // update would gate flush() forever while the connection sat 'ready' and
    // healthy-looking, and the presence line would silently never move again.
    const rig = createRig();
    const socket = rig.bringUp({ details: 'Eastbrook' });
    expect(rig.presence.stateForTest().pendingNonce).toBe('woc-1');
    expect(rig.liveTimers().map((timer) => timer.delayMs)).toEqual([DISCORD_ANSWER_TIMEOUT_MS]);
    rig.fireTimer(0);
    expect(socket.destroyed).toBe(1);
    expect(rig.presence.stateForTest().state).toBe('backoff');
    expect(rig.liveTimers()[0].delayMs).toBe(DISCORD_BASE_BACKOFF_MS);
  });

  it('leaves no answer timer pending after a fast READY and a prompt ack', () => {
    // The normal path must be untouched by the timeout: both bounded waits
    // (handshake to READY, write to echo) are answered and disarmed, so
    // nothing is left to fire and tear down a healthy connection later.
    const rig = createRig();
    const socket = rig.bringUp({ details: 'Eastbrook' });
    rig.feed(socket, OPCODES.FRAME, { cmd: 'SET_ACTIVITY', evt: null, data: null, nonce: 'woc-1' });
    expect(rig.presence.stateForTest().state).toBe('ready');
    expect(socket.destroyed).toBe(0);
    expect(rig.liveTimers()).toEqual([]);
  });

  it('answers a PING with a PONG that echoes its payload', () => {
    const rig = createRig();
    const socket = rig.bringUp({ details: 'Eastbrook' });
    rig.feed(socket, OPCODES.PING, { beat: 7 });
    const frames = rig.framesOf(socket);
    expect(frames[frames.length - 1]).toEqual({
      opcode: OPCODES.PONG,
      payload: { beat: 7 },
    });
  });

  it('stops for good when the app id is refused before READY', () => {
    const rig = createRig();
    rig.presence.setActivity({ details: 'Eastbrook' });
    const socket = rig.live();
    socket.emit('connect');
    // The probe-confirmed refusal shape for an unregistered client_id.
    rig.feed(socket, OPCODES.CLOSE, { code: 4000, message: 'Invalid Client ID' });
    expect(rig.presence.stateForTest().state).toBe('invalid-client');
    // Exactly one line, and it carries the code and message an operator needs.
    expect(rig.warnings).toHaveLength(1);
    expect(rig.warnings[0]).toContain(4000);
    expect(rig.warnings[0]).toContain('Invalid Client ID');
    expect(socket.destroyed).toBe(1);
    // No retry storm: nothing armed, and nothing later re-arms it. A hot loop
    // here would hammer the daemon for the whole session.
    expect(rig.liveTimers()).toEqual([]);
    rig.presence.setActivity({ details: 'Vale of Kings' });
    rig.presence.setEnabled(false);
    rig.presence.setEnabled(true);
    rig.presence.setActivity({ details: 'Ironforge Road' });
    expect(rig.sockets).toHaveLength(1);
    expect(rig.liveTimers()).toEqual([]);
  });

  it('advances the walk on a pre-READY CLOSE with a transient code; terminal is 4000 only', () => {
    // Only code 4000 was probe-confirmed as the invalid-client refusal. A
    // peer bowing out mid-handshake with any other code (a restart, a
    // shutdown) must neither kill presence for the rest of the run NOR pin
    // the walk to its slot: symmetric with the socket-hangup arm, the walk
    // moves on in the same pass (a CLOSE-answering squatter would otherwise
    // hold slot 0 forever on win32).
    const rig = createRig();
    rig.presence.setActivity({ details: 'Eastbrook' });
    const socket = rig.live();
    socket.emit('connect');
    rig.feed(socket, OPCODES.CLOSE, { code: 1000, message: 'restarting' });
    expect(rig.warnings).toEqual([]);
    expect(socket.destroyed).toBe(1);
    expect(rig.sockets).toHaveLength(2);
    expect(rig.presence.stateForTest().state).toBe('connecting');
    // The desired activity survives, and a later slot that answers READY
    // still receives it.
    expect(rig.presence.stateForTest().desiredActivity).toEqual({ details: 'Eastbrook' });
    rig.ready(rig.live());
    expect(rig.presence.stateForTest().state).toBe('ready');
    const sent = rig.payloadsOf(rig.sockets[1])[1];
    expect(sent.args).toEqual({ pid: 4321, activity: { details: 'Eastbrook' } });
  });

  it('fails closed on a pre-READY CLOSE whose payload carries no readable code', () => {
    // A peer that refuses without saying why gets no hot loop: unreadable is
    // treated as the refusal shape, exactly like 4000.
    const rig = createRig();
    rig.presence.setActivity({ details: 'Eastbrook' });
    const socket = rig.live();
    socket.emit('connect');
    rig.feed(socket, OPCODES.CLOSE, { message: 'no code here' });
    expect(rig.presence.stateForTest().state).toBe('invalid-client');
    expect(rig.warnings).toHaveLength(1);
    expect(rig.liveTimers()).toEqual([]);
  });

  it('treats a CLOSE on a working connection as a disconnect, not a refusal', () => {
    // Discord quitting sends the same opcode. Going terminal here would leave
    // presence dead for the rest of the session over a normal restart.
    const rig = createRig();
    const socket = rig.bringUp({ details: 'Eastbrook' });
    rig.feed(socket, OPCODES.CLOSE, { code: 1000, message: 'closing' });
    expect(rig.presence.stateForTest().state).toBe('backoff');
    expect(rig.warnings).toEqual([]);
    expect(rig.liveTimers()).toHaveLength(1);
  });

  it('re-sends the desired activity after a drop and a fresh READY', () => {
    const rig = createRig();
    const first = rig.bringUp({ details: 'Eastbrook' });
    rig.feed(first, OPCODES.FRAME, { cmd: 'SET_ACTIVITY', evt: null, data: null, nonce: 'woc-1' });
    first.emit('close');
    expect(rig.presence.stateForTest().state).toBe('backoff');
    rig.fireTimer(0);
    const second = rig.live();
    expect(second).not.toBe(first);
    rig.ready(second);
    // The rate limit spans the reconnect rather than being reset by it: the
    // floor is Discord's, and a flapping socket must not become a way to send
    // faster than it allows. So the re-send is armed for the remainder of the
    // window (2000 ms of it were spent in the backoff) rather than written now.
    expect(rig.framesOf(second)).toHaveLength(1);
    expect(rig.liveTimers()[0].delayMs).toBe(DISCORD_MIN_SEND_INTERVAL_MS - 2000);
    rig.fireTimer(0);
    // The SAME activity goes out again: the dedup is per connection, because a
    // new socket has been told nothing, and skipping it would leave the player
    // with a blank presence until their next zone change.
    const sent = rig.payloadsOf(second)[1];
    expect(sent.cmd).toBe('SET_ACTIVITY');
    expect(sent.args).toEqual({ pid: 4321, activity: { details: 'Eastbrook' } });
  });

  it('paces updates on the trailing edge, sending the LATEST value', () => {
    const rig = createRig();
    const socket = rig.bringUp({ details: 'Eastbrook' });
    rig.feed(socket, OPCODES.FRAME, { cmd: 'SET_ACTIVITY', evt: null, data: null, nonce: 'woc-1' });
    rig.state.now += 1000;
    rig.presence.setActivity({ details: 'Vale of Kings' });
    // Inside the floor: nothing written, one timer armed for the remainder.
    expect(rig.framesOf(socket)).toHaveLength(2);
    expect(rig.liveTimers()).toHaveLength(1);
    expect(rig.liveTimers()[0].delayMs).toBe(DISCORD_MIN_SEND_INTERVAL_MS - 1000);
    // A third zone before the timer fires REPLACES the second rather than
    // queueing behind it: a presence line that replays four stale zones is
    // worse than one that skipped them.
    rig.presence.setActivity({ details: 'Ironforge Road' });
    expect(rig.liveTimers()).toHaveLength(1);
    rig.fireTimer(0);
    const frames = rig.framesOf(socket);
    expect(frames).toHaveLength(3);
    const payload = frames[2].payload as Record<string, unknown>;
    expect(payload.args).toEqual({ pid: 4321, activity: { details: 'Ironforge Road' } });
    expect(payload.nonce).toBe('woc-2');
  });

  it('writes nothing when the activity has not actually changed', () => {
    const rig = createRig();
    const socket = rig.bringUp({ details: 'Eastbrook' });
    rig.feed(socket, OPCODES.FRAME, { cmd: 'SET_ACTIVITY', evt: null, data: null, nonce: 'woc-1' });
    rig.state.now += DISCORD_MIN_SEND_INTERVAL_MS * 2;
    // A fresh object with the same content: the renderer rebuilds its payload
    // on every world tick it reports from, so reference equality would never
    // fire and every tick would cost a frame.
    rig.presence.setActivity({ details: 'Eastbrook' });
    expect(rig.framesOf(socket)).toHaveLength(2);
    expect(rig.liveTimers()).toEqual([]);
    // Key ORDER is not a change either.
    rig.presence.setActivity({ timestamps: { start: 5 }, details: 'Eastbrook' });
    expect(rig.framesOf(socket)).toHaveLength(3);
    rig.feed(socket, OPCODES.FRAME, { cmd: 'SET_ACTIVITY', evt: null, data: null, nonce: 'woc-2' });
    rig.state.now += DISCORD_MIN_SEND_INTERVAL_MS;
    rig.presence.setActivity({ details: 'Eastbrook', timestamps: { start: 5 } });
    expect(rig.framesOf(socket)).toHaveLength(3);
  });

  it('holds the next update until the one in flight is answered', () => {
    const rig = createRig();
    const socket = rig.bringUp({ details: 'Eastbrook' });
    rig.state.now += DISCORD_MIN_SEND_INTERVAL_MS * 2;
    rig.presence.setActivity({ details: 'Vale of Kings' });
    // Outside the rate-limit window, so only the in-flight nonce is holding it:
    // no SEND timer is armed. (The one live timer is the answer timeout that
    // bounds the wait on that nonce, not a re-arm of the write.)
    expect(rig.framesOf(socket)).toHaveLength(2);
    expect(rig.liveTimers().map((timer) => timer.delayMs)).toEqual([DISCORD_ANSWER_TIMEOUT_MS]);
    rig.feed(socket, OPCODES.FRAME, { cmd: 'SET_ACTIVITY', evt: null, data: null, nonce: 'woc-1' });
    const payload = rig.payloadsOf(socket)[2];
    expect(payload.args).toEqual({ pid: 4321, activity: { details: 'Vale of Kings' } });
    // An echo for a nonce we are not waiting on changes nothing.
    rig.feed(socket, OPCODES.FRAME, { cmd: 'SET_ACTIVITY', evt: null, data: null, nonce: 'woc-9' });
    expect(rig.presence.stateForTest().pendingNonce).toBe('woc-2');
  });

  it('logs a rejected update once and moves on rather than retrying it', () => {
    const rig = createRig();
    const socket = rig.bringUp({ details: 'Eastbrook' });
    rig.feed(socket, OPCODES.FRAME, {
      cmd: 'SET_ACTIVITY',
      evt: 'ERROR',
      data: { code: 4000, message: 'Invalid activity' },
      nonce: 'woc-1',
    });
    expect(rig.warnings).toHaveLength(1);
    // Treated as delivered: the refused payload is NOT written again, or the
    // pair would loop for as long as the connection lived.
    expect(rig.framesOf(socket)).toHaveLength(2);
    expect(rig.presence.stateForTest().pendingNonce).toBeNull();
    // A second rejection is silent; one line per run is the contract.
    rig.state.now += DISCORD_MIN_SEND_INTERVAL_MS;
    rig.presence.setActivity({ details: 'Vale of Kings' });
    rig.feed(socket, OPCODES.FRAME, {
      cmd: 'SET_ACTIVITY',
      evt: 'ERROR',
      data: { code: 4000, message: 'Invalid activity' },
      nonce: 'woc-2',
    });
    expect(rig.warnings).toHaveLength(1);
  });

  it('clears the presence and closes the socket when the player turns it off', () => {
    const rig = createRig();
    const socket = rig.bringUp({ details: 'Eastbrook' });
    rig.presence.setEnabled(false);
    const last = rig.framesOf(socket)[2];
    // The clear shape: pid only, no activity key. Leaving a stale line in
    // Discord's UI is exactly what the toggle promises not to do.
    expect(last).toEqual({
      opcode: OPCODES.FRAME,
      payload: { cmd: 'SET_ACTIVITY', args: { pid: 4321 }, nonce: 'woc-2' },
    });
    expect(socket.ended).toBe(1);
    expect(socket.destroyed).toBe(1);
    // ORDER is the contract, not just the counts: end() moved above the clear
    // write would lose the clear on a real net.Socket (write-after-end lands
    // as an async error the teardown never sees) while both counts stayed 1.
    expect(socket.ops.slice(-3)).toEqual(['write', 'end', 'destroy']);
    expect(rig.presence.stateForTest().state).toBe('off');
    expect(rig.presence.stateForTest().desiredActivity).toBeNull();
    // Re-enabling arms nothing by itself; the next activity is what dials.
    rig.presence.setEnabled(true);
    expect(rig.sockets).toHaveLength(1);
    rig.presence.setActivity({ details: 'Vale of Kings' });
    expect(rig.sockets).toHaveLength(2);
  });

  it('treats a throwing write as a lost socket: destroy, back off, redial', () => {
    const rig = createRig();
    const socket = rig.bringUp({ details: 'Eastbrook' });
    rig.feed(socket, OPCODES.FRAME, { cmd: 'SET_ACTIVITY', evt: null, data: null, nonce: 'woc-1' });
    rig.state.now += DISCORD_MIN_SEND_INTERVAL_MS;
    // The pipe closes under the writer: the synchronous throw is the same
    // event as a close, and the desired value must survive to the redial.
    socket.writeThrows = true;
    rig.presence.setActivity({ details: 'Vale of Kings' });
    expect(socket.destroyed).toBe(1);
    expect(rig.presence.stateForTest().state).toBe('backoff');
    expect(rig.liveTimers()).toHaveLength(1);
    rig.fireTimer(0);
    const second = rig.live();
    expect(second).not.toBe(socket);
    rig.ready(second);
    const sent = rig.payloadsOf(second)[1];
    expect(sent.args).toEqual({ pid: 4321, activity: { details: 'Vale of Kings' } });
  });

  it('lands in off with no live timers when the disable clear itself throws', () => {
    const rig = createRig();
    const socket = rig.bringUp({ details: 'Eastbrook' });
    socket.writeThrows = true;
    rig.presence.setEnabled(false);
    // The throwing clear write scheduled a retry on its way down (write treats
    // a throw as a lost socket); the off switch must still cancel every timer
    // and land terminal-quiet, with the socket released exactly once.
    expect(rig.presence.stateForTest().state).toBe('off');
    expect(socket.destroyed).toBe(1);
    expect(rig.liveTimers()).toEqual([]);
    expect(rig.presence.stateForTest().desiredActivity).toBeNull();
  });

  it('cancels a pending reconnect when the player turns it off', () => {
    const rig = createRig({ env: {} });
    rig.presence.setActivity({ details: 'Eastbrook' });
    rig.failWholeWalk();
    expect(rig.timers).toHaveLength(1);
    rig.presence.setEnabled(false);
    expect(rig.cleared).toContain(rig.timers[0].handle);
    // Even if the cancelled timer somehow fires, it must not dial.
    const dialed = rig.sockets.length;
    rig.timers[0].callback();
    expect(rig.sockets).toHaveLength(dialed);
  });

  it('sends a clear through the same rate limiter when the activity goes away', () => {
    const rig = createRig();
    const socket = rig.bringUp({ details: 'Eastbrook' });
    rig.feed(socket, OPCODES.FRAME, { cmd: 'SET_ACTIVITY', evt: null, data: null, nonce: 'woc-1' });
    rig.state.now += 5000;
    rig.presence.setActivity(null);
    // Inside the window, so it waits its turn like any other update.
    expect(rig.framesOf(socket)).toHaveLength(2);
    rig.fireTimer(0);
    const payload = rig.payloadsOf(socket)[2];
    expect(payload.args).toEqual({ pid: 4321 });
    expect(rig.presence.stateForTest().lastSentActivity).toBeNull();
  });

  it('drops a corrupt stream without a warning and reconnects', () => {
    const rig = createRig();
    const socket = rig.bringUp({ details: 'Eastbrook' });
    const bad = Buffer.alloc(8);
    bad.writeUInt32LE(9, 0);
    bad.writeUInt32LE(4, 4);
    socket.emit('data', bad);
    expect(socket.destroyed).toBe(1);
    expect(rig.warnings).toEqual([]);
    expect(rig.presence.stateForTest().state).toBe('backoff');
    expect(rig.liveTimers()).toHaveLength(1);
  });

  it('reassembles a READY that arrives in two chunks', () => {
    // The real socket splits wherever the kernel decides; a manager that only
    // ever saw whole frames in tests would work on every machine but one.
    const rig = createRig();
    rig.presence.setActivity({ details: 'Eastbrook' });
    const socket = rig.live();
    socket.emit('connect');
    const frame = encodeFrame(OPCODES.FRAME, { cmd: 'DISPATCH', evt: 'READY', data: {} });
    socket.emit('data', frame.subarray(0, 5));
    expect(rig.presence.stateForTest().state).toBe('handshaking');
    socket.emit('data', frame.subarray(5));
    expect(rig.presence.stateForTest().state).toBe('ready');
    expect(rig.framesOf(socket)).toHaveLength(2);
  });

  it('goes inert on dispose', () => {
    const rig = createRig();
    const socket = rig.bringUp({ details: 'Eastbrook' });
    rig.state.now += DISCORD_MIN_SEND_INTERVAL_MS;
    rig.presence.setActivity({ details: 'Vale of Kings' });
    rig.presence.dispose();
    expect(socket.destroyed).toBe(1);
    expect(rig.presence.stateForTest().state).toBe('disposed');
    const writes = rig.framesOf(socket).length;
    rig.presence.setActivity({ details: 'Ironforge Road' });
    rig.presence.setEnabled(true);
    expect(rig.sockets).toHaveLength(1);
    expect(rig.framesOf(socket)).toHaveLength(writes);
    // Late socket events during teardown must not resurrect the walk.
    socket.emit('close');
    expect(rig.sockets).toHaveLength(1);
    expect(rig.liveTimers()).toEqual([]);
  });

  it('refuses a missing dependency or a non-positive interval at construction', () => {
    // One case per injected function per failure mode: every one of these is a
    // wiring mistake in main.cjs that would otherwise surface as a silent dead
    // feature (or a throw inside a socket event) long after boot.
    const base: Record<string, unknown> = {
      clientId: APP_ID,
      connect: () => null,
      statPath: () => ({ isSocket: () => true, uid: 1 }),
      uid: 1,
      platform: 'linux',
      env: {},
      now: () => 0,
      setTimeoutFn: () => 1,
      clearTimeoutFn: () => {},
      random: () => 0.5,
      pid: 10,
      log: { warn: () => {}, debug: () => {} },
    };
    const build = (overrides: Record<string, unknown> = {}) =>
      createDiscordPresence({ ...base, ...overrides } as unknown as Parameters<
        typeof createDiscordPresence
      >[0]);
    // The defaults are valid, so the guard cannot be satisfied by refusing
    // everything.
    expect(() => build()).not.toThrow();
    for (const field of [
      'connect',
      'statPath',
      'now',
      'setTimeoutFn',
      'clearTimeoutFn',
      'random',
    ]) {
      expect(() => build({ [field]: undefined }), `${field} must be required`).toThrow(TypeError);
      expect(() => build({ [field]: 'not a function' }), `${field} must be a function`).toThrow(
        TypeError,
      );
    }
    expect(() => build({ pid: 1.5 })).toThrow(TypeError);
    // clampText is the one dep with a default, so absence is fine and junk is
    // not: a non-function would throw inside a log call on the machine of the
    // one player whose Discord refused the handshake.
    expect(() => build({ clampText: undefined })).not.toThrow();
    expect(() => build({ clampText: 'nope' })).toThrow(TypeError);
    // A log without debug would throw inside a socket event instead, i.e. on
    // the machine of the one player whose Discord is missing.
    expect(() => build({ log: { warn: () => {} } })).toThrow(TypeError);
    for (const bad of [0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() => build({ minSendIntervalMs: bad })).toThrow(TypeError);
      expect(() => build({ maxBackoffMs: bad })).toThrow(TypeError);
      expect(() => build({ answerTimeoutMs: bad })).toThrow(TypeError);
    }
  });

  it('honors an injected send floor rather than the default', () => {
    const rig = createRig({ minSendIntervalMs: 400 });
    const socket = rig.bringUp({ details: 'Eastbrook' });
    rig.feed(socket, OPCODES.FRAME, { cmd: 'SET_ACTIVITY', evt: null, data: null, nonce: 'woc-1' });
    rig.state.now += 399;
    rig.presence.setActivity({ details: 'Vale of Kings' });
    expect(rig.liveTimers()[0].delayMs).toBe(1);
    rig.fireTimer(0);
    expect(rig.framesOf(socket)).toHaveLength(3);
  });
});
