// The Gateway socket seam. Two directions matter and they need opposite setups,
// so `ws` is module-mocked for the whole file: the DEFAULT socket factory must
// construct the real `ws` client at the real gateway URL (the arm a broken
// default parameter would silently replace), and an INJECTED factory must be
// used instead of it. The mock stands in for the `ws` module so neither arm
// opens a socket; asserting the mocked constructor was called IS the proof that
// the default routes through `ws`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The close-code decision itself is pure and lives in bot/logic.ts; the shell
// below only acts on it. Imported statically because logic.ts touches no socket.
import { isFatalCloseCode } from '../bot/logic';

/** Every socket the code under test constructed, in order. */
const constructed: { url: string; socket: FakeSocket }[] = [];

class FakeSocket {
  static OPEN = 1;
  readyState: number = FakeSocket.OPEN;
  readonly listeners = new Map<string, (arg: unknown) => void>();
  readonly sent: string[] = [];
  terminated = 0;
  closed = 0;
  listenersRemoved = 0;

  constructor(url: string) {
    constructed.push({ url, socket: this });
  }

  on(event: string, cb: (arg: unknown) => void): this {
    this.listeners.set(event, cb);
    return this;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  terminate(): void {
    this.terminated += 1;
    this.readyState = 3; // CLOSED, as the real ws client does
  }

  close(): void {
    this.closed += 1;
    this.readyState = 3;
  }

  // Gateway.reconnect() calls this FIRST; without it the real call throws into
  // its own `catch {}` and close() is never reached, which would make the
  // teardown half of a reconnect untestable (and silently so).
  removeAllListeners(): void {
    this.listenersRemoved += 1;
    this.listeners.clear();
  }

  emit(event: string, arg?: unknown): void {
    this.listeners.get(event)?.(arg);
  }
}

vi.mock('ws', () => ({ WebSocket: FakeSocket }));

// Imported AFTER the mock declaration; vi.mock is hoisted, so bot/gateway.ts
// binds to FakeSocket rather than the real client.
const { Gateway, EXIT_DRAIN_BACKSTOP_MS } = await import('../bot/gateway');

function noopHandlers() {
  return { onDispatch: () => {} };
}

/** Timers that record rather than run, so no test waits on a real delay. */
function fakeTimers() {
  const armed: { ms: number; fn: () => void }[] = [];
  // `cleared` on the entry as well as the id log, so `tick` below can refuse to
  // run a cancelled interval. A test that reaches for `.fn()` directly is
  // simulating the callback; `tick` is simulating the CLOCK, and only the second
  // can say anything about clearInterval having been called.
  const intervals: { id: number; ms: number; fn: () => void; cleared: boolean }[] = [];
  const cleared: unknown[] = [];
  let nextInterval = 1;
  return {
    armed,
    intervals,
    cleared,
    /** Fire an interval the way a real clock would: a cleared one never runs. */
    tick: (index: number): void => {
      const entry = intervals[index];
      if (entry === undefined || entry.cleared) return;
      entry.fn();
    },
    /** The intervals still armed. */
    live: (): number[] => intervals.filter((i) => !i.cleared).map((i) => i.id),
    seam: {
      setTimeout: (fn: () => void, ms: number) => {
        armed.push({ fn, ms });
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
      setInterval: (fn: () => void, ms: number) => {
        const id = nextInterval++;
        intervals.push({ id, fn, ms, cleared: false });
        return id as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: (id: ReturnType<typeof setInterval>) => {
        cleared.push(id);
        const entry = intervals.find((i) => i.id === (id as unknown as number));
        if (entry !== undefined) entry.cleared = true;
      },
    },
  };
}

/** A Gateway on an injected socket + injected timers, the rig most arms need. */
function rig(): {
  socket: FakeSocket;
  timers: ReturnType<typeof fakeTimers>;
  gateway: InstanceType<typeof Gateway>;
  factoryUrls: string[];
  sockets: FakeSocket[];
  exits: number[];
} {
  const timers = fakeTimers();
  const factoryUrls: string[] = [];
  const sockets: FakeSocket[] = [];
  // The exit seam is injected in EVERY arm, not just the fatal-close ones: a
  // fatal close now calls it, and the production default is a real
  // `process.exit`, which inside vitest takes the whole worker down.
  const exits: number[] = [];
  const gateway = new Gateway(
    'tok',
    'wss://gateway.discord.gg',
    noopHandlers(),
    (url) => {
      factoryUrls.push(url);
      const s = new FakeSocket('injected');
      sockets.push(s);
      return s as unknown as never;
    },
    timers.seam,
    (code) => exits.push(code),
  );
  gateway.connect(false);
  return { socket: sockets[0], timers, gateway, factoryUrls, sockets, exits };
}

/** Deliver one gateway frame the way `ws` does, as a Buffer. */
function frame(socket: FakeSocket, payload: unknown): void {
  socket.emit('message', Buffer.from(JSON.stringify(payload)));
}

function lastSent(socket: FakeSocket): { op: number; d: Record<string, unknown> } {
  return JSON.parse(socket.sent[socket.sent.length - 1]) as {
    op: number;
    d: Record<string, unknown>;
  };
}

beforeEach(() => {
  constructed.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Gateway production defaults', () => {
  it('constructs the real ws client at the v10 JSON gateway URL with three arguments', () => {
    // Exactly the construction in bot/main.ts: token, gateway URL, handlers.
    // No socket factory, no timers.
    const gateway = new Gateway('tok', 'wss://gateway.discord.gg', noopHandlers());

    gateway.connect(false);

    expect(constructed.length).toBe(1);
    // The query string is what selects protocol v10 and JSON (not ETF) encoding;
    // dropping either silently changes the wire format the parser expects.
    expect(constructed[0].url).toBe('wss://gateway.discord.gg/?v=10&encoding=json');
  });

  it('registers the message, close, and error listeners on the default socket', () => {
    const gateway = new Gateway('tok', 'wss://gateway.discord.gg', noopHandlers());
    gateway.connect(false);

    expect([...constructed[0].socket.listeners.keys()].sort()).toEqual([
      'close',
      'error',
      'message',
    ]);
  });

  it('runs the reconnect delay and the heartbeat on the REAL global timers', async () => {
    // The socket factory has a default-path test above; the timers seam did not,
    // so replacing all three members with no-ops used to keep the suite green
    // while the production bot would never heartbeat and never reconnect.
    //
    // Constructed BEFORE the fake clock is installed, per R16: the default
    // parameter is evaluated at construction, so a capture form
    // (`= { setTimeout, setInterval, clearInterval }`) would bind the REAL
    // timers here and never see the fake, and neither the heartbeat nor the
    // reconnect below would fire. Installing the fake first passes for both
    // forms and would guard nothing.
    const gateway = new Gateway('tok', 'wss://gateway.discord.gg', noopHandlers());
    vi.useFakeTimers();
    gateway.connect(false);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // A HELLO on the default timers must arm a real interval.
    frame(constructed[0].socket, { op: 10, d: { heartbeat_interval: 30_000 } });
    expect(constructed[0].socket.sent.length).toBe(1); // IDENTIFY
    await vi.advanceTimersByTimeAsync(30_000);
    expect(lastSent(constructed[0].socket).op).toBe(1); // the heartbeat fired

    // And an abnormal close must arm a real 2000 ms reconnect.
    constructed[0].socket.emit('close', 1006);
    expect(constructed.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(constructed.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(constructed.length).toBe(2);

    // And the third member: the close ran stopHeartbeat, so the interval must
    // be genuinely cleared on the real clock. A no-op default clearInterval
    // would keep beating forever against every future socket.
    // Counted as TERMINATIONS, not sends: the first beat left acked false, so a
    // leaked interval takes the zombie branch and terminates instead of
    // sending, which a send count cannot see.
    const terminations = () => constructed.reduce((n, c) => n + c.socket.terminated, 0);
    expect(terminations()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(terminations()).toBe(0);
  });

  it('exits through the REAL default seam on a fatal close: staged exitCode, drain, then exit 1', () => {
    // The exit seam is the one default every other arm injects (rig() must, or
    // the real process.exit takes the vitest worker down), so nothing else in
    // the suite ever runs it, and production runs ONLY it: bot/main.ts
    // constructs with three arguments. A no-op default, a bare
    // `process.exit(code)` (the drain dropped), and an exit code of 0 all have
    // to fail here, because in production each one is invisible until the next
    // incident.
    //
    // Constructed BEFORE the globals are stubbed, per R16: the default forwards
    // to process.exit and process.stderr.write at CALL time, so the stubs
    // installed after construction are still seen; stub-then-construct would
    // pass for a capturing default and guard nothing.
    const gateway = new Gateway('tok', 'wss://gateway.discord.gg', noopHandlers());
    vi.useFakeTimers();
    gateway.connect(false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const order: string[] = [];
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      order.push(`exit:${code}`);
      return undefined as never;
    }) as never);
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((
      _chunk: unknown,
      cb?: unknown,
    ) => {
      order.push('drain');
      if (typeof cb === 'function') (cb as () => void)();
      return true;
    }) as never);
    const prevExitCode = process.exitCode;

    // finally, because the seam stages process.exitCode = 1 and a failing
    // expect would otherwise leave the worker's exitCode dirty for the rest of
    // the file (bounded today, nothing else reads it, but hygiene is cheap).
    try {
      constructed[0].socket.emit('close', 4004);

      // exitCode is staged FIRST so any other loop end still exits nonzero, then
      // the drain hands the queued close-code line to the pipe, then the exit.
      // The order array is the pin: a drain-less default reads ['exit:1'].
      expect(process.exitCode).toBe(1);
      expect(order).toEqual(['drain', 'exit:1']);
      expect(writeSpy).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledTimes(1);
    } finally {
      process.exitCode = prevExitCode;
    }
  });

  it('exits anyway after EXIT_DRAIN_BACKSTOP_MS when the stderr drain never completes', async () => {
    // stderr in the container is a pipe to the docker daemon; a pipe nobody
    // drains defers the write callback forever. Without the backstop the
    // process would keep running with a dead gateway while the heartbeat task
    // keeps the healthcheck green: the silent zombie, wearing a green light.
    const gateway = new Gateway('tok', 'wss://gateway.discord.gg', noopHandlers());
    vi.useFakeTimers();
    gateway.connect(false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exits: (number | undefined)[] = [];
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exits.push(code);
      return undefined as never;
    }) as never);
    // The blocked pipe: the write is accepted but its callback never runs.
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never);
    const prevExitCode = process.exitCode;

    try {
      constructed[0].socket.emit('close', 4014);

      expect(process.exitCode).toBe(1); // staged even while the drain hangs
      expect(exits).toEqual([]);
      await vi.advanceTimersByTimeAsync(EXIT_DRAIN_BACKSTOP_MS - 1);
      expect(exits).toEqual([]); // one tick early: the bound is exact, not fuzzy
      await vi.advanceTimersByTimeAsync(1);
      expect(exits).toEqual([1]); // the log line is lost, the exit is not
    } finally {
      process.exitCode = prevExitCode;
    }
  });
});

describe('Gateway injected socket factory', () => {
  it('uses the injected factory INSTEAD of the default, with the same URL', () => {
    const seen: string[] = [];
    const injected = new FakeSocket('unused');
    const gateway = new Gateway(
      'tok',
      'wss://gateway.discord.gg',
      noopHandlers(),
      (url) => {
        seen.push(url);
        return injected as unknown as never;
      },
      fakeTimers().seam,
    );

    // The factory pushed 'unused' at its own construction, so reset the log the
    // Gateway sees to prove the DEFAULT path did not also run.
    constructed.length = 0;
    gateway.connect(false);

    expect(seen).toEqual(['wss://gateway.discord.gg/?v=10&encoding=json']);
    expect(constructed).toEqual([]); // the default never constructed a socket
  });

  it('IDENTIFYs over the injected socket on HELLO and starts the heartbeat', () => {
    const { socket, timers } = rig();

    // 30000 deliberately, NOT 41250: 41250 is heartbeatIntervalMs's own default,
    // so a gateway that ignored the HELLO payload entirely would still produce
    // it and the assertion could not fail.
    frame(socket, { op: 10, d: { heartbeat_interval: 30_000 } });

    expect(timers.intervals.map((i) => i.ms)).toEqual([30_000]);
    const identify = lastSent(socket);
    expect(identify.op).toBe(2); // IDENTIFY
    expect(identify.d.token).toBe('tok');
  });
});

describe('Gateway heartbeat', () => {
  it('beats with the last seq it saw', () => {
    const { socket, timers } = rig();
    frame(socket, { op: 10, d: { heartbeat_interval: 30_000 } });
    // A DISPATCH carrying s=7 is what advances the sequence the heartbeat sends;
    // without seq tracking Discord cannot tell what the RESUME already delivered.
    frame(socket, { op: 0, s: 7, t: 'GUILD_CREATE', d: {} });

    timers.intervals[0].fn();

    expect(lastSent(socket)).toEqual({ op: 1, d: 7 });
  });

  it('terminates a zombie socket when a beat goes unacked', () => {
    const { socket, timers } = rig();
    frame(socket, { op: 10, d: { heartbeat_interval: 30_000 } });
    const beat = timers.intervals[0].fn;
    const beats = () => socket.sent.filter((f) => JSON.parse(f).op === 1).length;

    beat(); // acked starts true: this one sends
    expect(socket.terminated).toBe(0);
    expect(beats()).toBe(1);

    beat(); // no ACK arrived: the connection is a zombie
    expect(socket.terminated).toBe(1);
    // A terminate must NOT also send: that is the whole point of the early
    // return. (The fake goes to readyState CLOSED on terminate, as ws does, so
    // this also proves the guard rather than the fake's willingness to buffer.)
    expect(beats()).toBe(1);
  });

  it('keeps beating while ACKs keep arriving', () => {
    // The other half of the same flag, on a socket that stays alive: op 11 is
    // HEARTBEAT_ACK, and each one has to re-arm the next beat. Without the
    // reset every second beat would kill a perfectly healthy connection.
    const { socket, timers } = rig();
    frame(socket, { op: 10, d: { heartbeat_interval: 30_000 } });
    const beat = timers.intervals[0].fn;
    const beats = () => socket.sent.filter((f) => JSON.parse(f).op === 1).length;

    beat();
    frame(socket, { op: 11 });
    beat();
    frame(socket, { op: 11 });
    beat();

    expect(beats()).toBe(3);
    expect(socket.terminated).toBe(0);
  });

  it('answers a server-requested heartbeat (op 1) immediately', () => {
    const { socket } = rig();
    frame(socket, { op: 10, d: { heartbeat_interval: 30_000 } });
    frame(socket, { op: 0, s: 3, t: 'READY', d: {} });

    frame(socket, { op: 1 });

    expect(lastSent(socket)).toEqual({ op: 1, d: 3 });
  });

  it('does not stack a second interval when a reconnect never saw a close', () => {
    // op 7 and INVALID_SESSION reconnect WITHOUT a close event, so onClose's
    // stopHeartbeat never runs and the leading stopHeartbeat() inside
    // startHeartbeat is the only thing left. Drop it and every reconnect leaves
    // another live interval beating against a dead socket forever, which is the
    // request-amplification shape this whole packet exists to stop.
    const { socket, timers, sockets } = rig();
    frame(socket, { op: 10, d: { heartbeat_interval: 30_000 } });
    expect(timers.intervals.length).toBe(1);

    frame(socket, { op: 7 }); // RECONNECT: no close, straight to a new socket
    frame(sockets[1], { op: 10, d: { heartbeat_interval: 30_000 } });

    // Two armed in total, but the FIRST was cleared before the second started.
    expect(timers.intervals.length).toBe(2);
    expect(timers.cleared).toEqual([1]);
  });

  it('clears the old interval BEFORE the new socket exists, so a stale beat cannot kill it (L18)', () => {
    // The ledgered L18 defect, and the window it lives in is the whole point.
    // op 7 reconnects with no close event, so onClose's stopHeartbeat never runs,
    // and reconnect() calls removeAllListeners(), which strips the 'close'
    // handler that was the only other caller. startHeartbeat's own leading
    // stopHeartbeat does eventually clear it, but not until the NEW socket's
    // HELLO arrives, and connect() has already pointed `this.ws` at that new
    // socket. The heartbeat tick reads `this.ws` at FIRE time, so an unacked beat
    // landing in that window terminates the socket that just replaced it, and the
    // reconnect it triggers arrives back in the same state.
    const { socket, timers, sockets } = rig();
    frame(socket, { op: 10, d: { heartbeat_interval: 30_000 } });
    timers.tick(0); // one beat goes out; nothing ACKs it

    frame(socket, { op: 7 }); // RECONNECT: a new socket, and no HELLO on it yet
    expect(sockets.length).toBe(2);

    // Driven through `tick`, which honors clearInterval, rather than calling the
    // callback directly: only a fake that can REFUSE to run a cancelled timer can
    // tell a cleared interval from a live one.
    timers.tick(0);
    expect(sockets[1].terminated).toBe(0);
    expect(socket.terminated).toBe(0);

    // And the new socket's own heartbeat is the only one left armed.
    frame(sockets[1], { op: 10, d: { heartbeat_interval: 30_000 } });
    expect(timers.live()).toEqual([2]);
  });

  it('clears the old interval on an INVALID_SESSION reconnect too (L18)', () => {
    // The other entry point into reconnect() that never sees a close. It arms a
    // 1500 ms timer first, so the stale interval is live across that delay as
    // well as across the new socket's handshake: a strictly wider window than op
    // 7's, on the path a reconnect storm takes most often.
    const { socket, timers, sockets } = rig();
    frame(socket, { op: 10, d: { heartbeat_interval: 30_000 } });
    frame(socket, { op: 0, s: 5, t: 'READY', d: { session_id: 'sess-1' } });
    timers.tick(0);

    frame(socket, { op: 9, d: true });
    timers.armed[0].fn(); // the 1500 ms reconnect fires
    expect(sockets.length).toBe(2);

    timers.tick(0);
    expect(sockets[1].terminated).toBe(0);
    frame(sockets[1], { op: 10, d: { heartbeat_interval: 30_000 } });
    expect(timers.live()).toEqual([2]);
  });

  it('stops the heartbeat on close, so a reconnect does not stack a second one', () => {
    const { socket, timers } = rig();
    frame(socket, { op: 10, d: { heartbeat_interval: 30_000 } });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    socket.emit('close', 1006);

    // The interval handle armed by startHeartbeat is the one cleared.
    expect(timers.cleared).toEqual([1]);
  });
});

describe('Gateway resume', () => {
  it('captures the session from READY and RESUMEs to the resume URL after a drop', () => {
    const { socket, timers, factoryUrls, sockets } = rig();
    frame(socket, { op: 10, d: { heartbeat_interval: 30_000 } });
    frame(socket, {
      op: 0,
      s: 12,
      t: 'READY',
      d: { session_id: 'sess-1', resume_gateway_url: 'wss://resume.discord.gg' },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    socket.emit('close', 1006);
    timers.armed[0].fn(); // fire the 2000 ms reconnect

    // The old socket is torn down before the new one opens.
    expect(socket.listenersRemoved).toBe(1);
    expect(socket.closed).toBe(1);
    // The RESUME goes to the resume_gateway_url Discord handed back, not the
    // original gateway URL: reconnecting to the base URL loses the session.
    expect(factoryUrls[1]).toBe('wss://resume.discord.gg/?v=10&encoding=json');

    frame(sockets[1], { op: 10, d: { heartbeat_interval: 30_000 } });
    const resume = lastSent(sockets[1]);
    expect(resume.op).toBe(6); // RESUME, not IDENTIFY
    expect(resume.d).toEqual({ token: 'tok', session_id: 'sess-1', seq: 12 });
  });

  it('IDENTIFYs instead of RESUMEing when READY never gave a session', () => {
    const { socket, timers, factoryUrls, sockets } = rig();
    frame(socket, { op: 10, d: { heartbeat_interval: 30_000 } });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    socket.emit('close', 1006);
    timers.armed[0].fn();

    // No session id, so no resume URL either: back to the configured gateway.
    expect(factoryUrls[1]).toBe('wss://gateway.discord.gg/?v=10&encoding=json');
    frame(sockets[1], { op: 10, d: { heartbeat_interval: 30_000 } });
    expect(lastSent(sockets[1]).op).toBe(2); // IDENTIFY
  });

  it('re-identifies after a non-resumable INVALID_SESSION, and resumes after a resumable one', () => {
    for (const [resumable, expectedOp] of [
      [false, 2], // d=false: the session is gone, start a fresh IDENTIFY
      [true, 6], // d=true: Discord says the session survives, RESUME it
    ] as const) {
      const { socket, timers, sockets } = rig();
      frame(socket, { op: 10, d: { heartbeat_interval: 30_000 } });
      frame(socket, {
        op: 0,
        s: 5,
        t: 'READY',
        d: { session_id: 'sess-1', resume_gateway_url: 'wss://resume.discord.gg' },
      });

      frame(socket, { op: 9, d: resumable });

      // op 9 reconnects on its own short delay, not the 2000 ms close delay.
      expect(timers.armed.map((t) => t.ms)).toEqual([1500]);
      timers.armed[0].fn();
      frame(sockets[1], { op: 10, d: { heartbeat_interval: 30_000 } });
      expect(lastSent(sockets[1]).op).toBe(expectedOp);
    }
  });

  it('drops the dead session on a non-resumable INVALID_SESSION, so a later close re-identifies (L7)', () => {
    // The ledgered L7 defect. op 9 with d=false steered its OWN reconnect
    // correctly, but left `sessionId` and `resumeUrl` set, and the other two
    // reconnect paths (a socket close, op 7) both call `reconnect(true)`, where
    // connect() re-derives resuming from `this.sessionId !== null`. So a close
    // arriving before the next READY RESUMEd a session Discord had just killed.
    const { socket, timers, factoryUrls, sockets } = rig();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    frame(socket, { op: 10, d: { heartbeat_interval: 30_000 } });
    frame(socket, {
      op: 0,
      s: 5,
      t: 'READY',
      d: { session_id: 'sess-1', resume_gateway_url: 'wss://resume.discord.gg' },
    });

    frame(socket, { op: 9, d: false });
    timers.armed[0].fn(); // the op 9 reconnect, which already re-identified
    frame(sockets[1], { op: 10, d: { heartbeat_interval: 30_000 } });
    expect(lastSent(sockets[1]).op).toBe(2);

    // The arm that was broken: a close on the FRESH socket, before any READY has
    // handed out a new session.
    sockets[1].emit('close', 1006);
    const closeTimer = timers.armed[timers.armed.length - 1];
    expect(closeTimer.ms).toBe(2000);
    closeTimer.fn();

    // The dead session's resume endpoint must not be reused either.
    expect(factoryUrls[2]).toBe('wss://gateway.discord.gg/?v=10&encoding=json');
    frame(sockets[2], { op: 10, d: { heartbeat_interval: 30_000 } });
    expect(lastSent(sockets[2]).op).toBe(2); // IDENTIFY, not RESUME (op 6)

    // seq belongs to the dead session too: a fresh IDENTIFY heartbeats from
    // null, not from the last sequence of a session that no longer exists.
    const beat = timers.intervals[timers.intervals.length - 1];
    beat.fn();
    expect(lastSent(sockets[2])).toEqual({ op: 1, d: null });
  });

  it('re-identifies on op 7 after a non-resumable INVALID_SESSION too (L7)', () => {
    // The mirror of the close-path arm above. The L7 comment names BOTH reconnect
    // paths that call reconnect(true), and op 7 is the other one: Discord asks the
    // client to reconnect, and without the session cleared it would RESUME the
    // session it had just invalidated.
    const { socket, timers, factoryUrls, sockets } = rig();
    frame(socket, { op: 10, d: { heartbeat_interval: 30_000 } });
    frame(socket, {
      op: 0,
      s: 5,
      t: 'READY',
      d: { session_id: 'sess-1', resume_gateway_url: 'wss://resume.discord.gg' },
    });

    frame(socket, { op: 9, d: false });
    timers.armed[0].fn();
    frame(sockets[1], { op: 10, d: { heartbeat_interval: 30_000 } });
    expect(lastSent(sockets[1]).op).toBe(2);

    // op 7 reconnects immediately, with no timer of its own.
    frame(sockets[1], { op: 7 });
    expect(factoryUrls[2]).toBe('wss://gateway.discord.gg/?v=10&encoding=json');
    frame(sockets[2], { op: 10, d: { heartbeat_interval: 30_000 } });
    expect(lastSent(sockets[2]).op).toBe(2); // IDENTIFY, not RESUME
  });

  it('keeps the session on a RESUMABLE INVALID_SESSION, so a later close still resumes', () => {
    // The negative control for the L7 fix: clearing on d=false must not turn
    // into clearing on every op 9, which would throw away a session Discord
    // explicitly said survives and force a full re-IDENTIFY every time.
    const { socket, timers, factoryUrls, sockets } = rig();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    frame(socket, { op: 10, d: { heartbeat_interval: 30_000 } });
    frame(socket, {
      op: 0,
      s: 5,
      t: 'READY',
      d: { session_id: 'sess-1', resume_gateway_url: 'wss://resume.discord.gg' },
    });

    frame(socket, { op: 9, d: true });
    timers.armed[0].fn();
    expect(factoryUrls[1]).toBe('wss://resume.discord.gg/?v=10&encoding=json');
    frame(sockets[1], { op: 10, d: { heartbeat_interval: 30_000 } });
    expect(lastSent(sockets[1])).toEqual({
      op: 6,
      d: { token: 'tok', session_id: 'sess-1', seq: 5 },
    });
  });

  it('does not aim at the resume URL when READY gave one but no session id', () => {
    // A malformed READY is the only state where connect()'s own
    // `this.sessionId !== null` check does work its two consumers do not already
    // do: without it the bot would reconnect to the resume endpoint carrying no
    // session, which Discord answers with INVALID_SESSION rather than a resume.
    const { socket, timers, factoryUrls, sockets } = rig();
    frame(socket, { op: 10, d: { heartbeat_interval: 30_000 } });
    frame(socket, {
      op: 0,
      s: 4,
      t: 'READY',
      d: { resume_gateway_url: 'wss://resume.discord.gg' },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    socket.emit('close', 1006);
    timers.armed[0].fn();

    expect(factoryUrls[1]).toBe('wss://gateway.discord.gg/?v=10&encoding=json');
    frame(sockets[1], { op: 10, d: { heartbeat_interval: 30_000 } });
    expect(lastSent(sockets[1]).op).toBe(2); // IDENTIFY, not RESUME
  });

  it('reconnects immediately on op 7 RECONNECT, with no delay at all', () => {
    const { socket, timers, sockets } = rig();
    frame(socket, { op: 10, d: { heartbeat_interval: 30_000 } });
    frame(socket, { op: 0, s: 1, t: 'READY', d: { session_id: 'sess-1' } });

    frame(socket, { op: 7 });

    expect(timers.armed).toEqual([]); // op 7 means "now", not "in a moment"
    expect(sockets.length).toBe(2);
  });
});

describe('fatal gateway close codes', () => {
  it('names every code a reconnect can never recover from', () => {
    // The set by value, from the pure helper the shell reads. 4004 is a bad or
    // rotated token and 4014 a privileged intent switched off in the developer
    // portal: reconnecting on either is a doomed handshake repeated forever,
    // which is the request amplification this packet exists to stop.
    for (const code of [4004, 4010, 4011, 4012, 4013, 4014]) {
      expect({ code, fatal: isFatalCloseCode(code) }).toEqual({ code, fatal: true });
    }
  });

  it('leaves every recoverable close alone, including the fatal block neighbours', () => {
    // 4008 (rate limited) and 4009 (session timed out) sit directly under the
    // 4010 to 4014 block, so a range check written in place of the set would be
    // invisible without them. 1000, 1001 and 1006 are the ordinary closes every
    // production reconnect actually rides, and each one now decides whether the
    // process lives.
    for (const code of [1000, 1001, 1006, 4000, 4008, 4009]) {
      expect({ code, fatal: isFatalCloseCode(code) }).toEqual({ code, fatal: false });
    }
  });
});

describe('Gateway close handling', () => {
  // One test per code rather than one loop over all of them: a loop stops at the
  // first failing row, so a regression affecting several codes would report as one.
  // The whole set matters, not just 4014: 4004 is a bad or rotated token, and
  // reconnecting on it hammers Discord with a doomed handshake forever.
  for (const code of [4004, 4010, 4011, 4012, 4013, 4014]) {
    it(`exits 1 after fatal close ${code} instead of reconnecting`, () => {
      const { socket, timers, sockets, exits } = rig();
      const errors: unknown[][] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        errors.push(args);
      });

      socket.emit('close', code);

      expect(timers.armed).toEqual([]);
      expect(sockets.length).toBe(1);
      // D15/R13: the process ENDS so the container restart policy decides what
      // happens next. Staying up while syncing nothing is the failure mode this
      // replaces: no alert fires and the container looks healthy. Code 1 matches
      // the top-level fatal handler in bot/main.ts.
      expect(exits).toEqual([1]);
      // The log line is the only operator-visible signal that the bot stopped.
      expect(errors).toEqual([
        [
          `[bot] gateway closed with fatal code ${code}; not reconnecting, exiting so the restart policy can act`,
        ],
      ]);
    });
  }

  for (const code of [1000, 1001, 1006, 4000, 4009]) {
    it(`reconnects after non-fatal close ${code}, and actually opens the new socket`, () => {
      const { socket, timers, sockets, factoryUrls, exits } = rig();
      vi.spyOn(console, 'error').mockImplementation(() => {});

      socket.emit('close', code);

      expect(timers.armed.map((t) => t.ms)).toEqual([2000]);
      expect(sockets.length).toBe(1); // nothing until the delay elapses
      timers.armed[0].fn();
      // Firing the timer must genuinely reconnect: an empty callback used to
      // pass here, which would leave the bot silently offline after a drop.
      expect(sockets.length).toBe(2);
      expect(factoryUrls[1]).toBe('wss://gateway.discord.gg/?v=10&encoding=json');
      // The other half of the fatal arm: an ordinary drop must never end the
      // process. Widening the fatal set (or dropping the guard around the exit)
      // would turn every routine reconnect into a container restart.
      expect(exits).toEqual([]);
    });
  }

  it('tears the old socket down even when removeAllListeners throws', () => {
    // reconnect() wraps the teardown in an empty catch. Without it a socket that
    // rejects the teardown (a foreign implementation, or one already destroyed)
    // would stop the reconnect entirely and leave the bot offline for good.
    const { socket, timers, sockets } = rig();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    socket.removeAllListeners = () => {
      throw new Error('already destroyed');
    };

    socket.emit('close', 1006);
    timers.armed[0].fn();

    expect(sockets.length).toBe(2); // the reconnect still happened
  });
});

describe('Gateway send guard and dispatch', () => {
  it('sends nothing while the socket is not OPEN', () => {
    const { socket } = rig();
    socket.readyState = 0; // CONNECTING

    frame(socket, { op: 10, d: { heartbeat_interval: 30_000 } });

    // The IDENTIFY is dropped rather than thrown: sending on a CONNECTING ws
    // raises, and the reconnect path re-IDENTIFYs anyway.
    expect(socket.sent).toEqual([]);
  });

  it('requests the full member list with op 8', () => {
    const { socket, gateway } = rig();

    gateway.requestGuildMembers('g1');

    // query '' + limit 0 is what asks for EVERY member, online and offline; the
    // op 8 backfill is the only way large guilds learn about offline staff.
    expect(JSON.parse(socket.sent[socket.sent.length - 1])).toEqual({
      op: 8,
      d: { guild_id: 'g1', query: '', limit: 0, presences: true },
    });
  });

  it('forwards each DISPATCH to the handler and survives a throwing handler', () => {
    const seen: [string, Record<string, unknown>][] = [];
    const timers = fakeTimers();
    const socket = new FakeSocket('injected');
    const gateway = new Gateway(
      'tok',
      'wss://gateway.discord.gg',
      {
        onDispatch: (type, data) => {
          seen.push([type, data]);
          if (type === 'BOOM') throw new Error('handler exploded');
        },
      },
      () => socket as unknown as never,
      timers.seam,
    );
    gateway.connect(false);
    const errors: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });

    frame(socket, { op: 0, s: 1, t: 'GUILD_CREATE', d: { id: 'g1' } });
    frame(socket, { op: 0, s: 2, t: 'BOOM', d: {} });
    // A later frame must still be delivered: one bad handler call cannot kill
    // the socket's message pump.
    frame(socket, { op: 0, s: 3, t: 'GUILD_MEMBER_ADD', d: { user: { id: 'u1' } } });

    expect(seen.map(([t]) => t)).toEqual(['GUILD_CREATE', 'BOOM', 'GUILD_MEMBER_ADD']);
    expect(seen[0][1]).toEqual({ id: 'g1' });
    // The MESSAGE label, not the parse one. Without the inner try/catch around
    // onDispatch the throw still gets swallowed, by the outer handler in
    // connect(), and the pump still survives, so the delivery assertions above
    // pass either way. Only the log line separates the two catches.
    expect(errors).toEqual([['[bot] dispatch handler error', expect.any(Error)]]);
  });

  it('logs a socket error without tearing the connection down', () => {
    // The 'error' listener exists to keep an emitted socket error from becoming
    // an unhandled 'error' event, which in Node terminates the process. Nothing
    // else in the class references it, so only driving it proves it is wired.
    const { socket } = rig();
    const errors: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });

    socket.emit('error', new Error('ECONNRESET'));

    expect(errors[0][0]).toBe('[bot] gateway socket error');
    // No reconnect, no terminate: 'error' is followed by 'close', which owns that.
    expect(socket.terminated).toBe(0);
    frame(socket, { op: 10, d: { heartbeat_interval: 30_000 } });
    expect(lastSent(socket).op).toBe(2); // still usable
  });

  it('survives an unparseable frame', () => {
    const { socket } = rig();
    const errors: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });

    socket.emit('message', Buffer.from('{not json'));
    frame(socket, { op: 10, d: { heartbeat_interval: 30_000 } });

    expect(errors[0][0]).toBe('[bot] gateway parse error');
    expect(lastSent(socket).op).toBe(2); // the pump still works
  });
});
