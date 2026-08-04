// Minimal Discord Gateway (v10) client over `ws` (already a project dep; no new
// dependency). Handles HELLO/heartbeat/ACK, IDENTIFY, RESUME on reconnect, and
// forwards DISPATCH events to a handler. The protocol opcode/payload logic lives
// in the pure ./logic module so it is unit-tested; this file is the IO shell.
import { WebSocket } from 'ws';
import {
  GATEWAY_OP,
  heartbeatIntervalMs,
  identifyPayload,
  isFatalCloseCode,
  requestGuildMembersPayload,
  resumePayload,
} from './logic';

export interface GatewayHandlers {
  onDispatch(type: string, data: Record<string, unknown>): void;
}

/** How long the default exit seam waits for the stderr drain before exiting
 *  anyway. Named and exported (the SERVER_CALL_TIMEOUT_MS pattern) so the suite
 *  pins the bound against a literal instead of re-reading the source. */
export const EXIT_DRAIN_BACKSTOP_MS = 1000;

/** Opens the gateway socket. Injected so tests can hand the Gateway a fake
 *  socket; production is the `ws` client this file already imports. The return
 *  type is `ws`'s own WebSocket so the `on('message'|'close'|'error', ...)`
 *  callbacks keep their contextual parameter types and `WebSocket.OPEN` stays
 *  reachable. */
export type GatewaySocketFactory = (url: string) => WebSocket;

/** The timers the reconnect delays and the heartbeat run on. Injected so tests
 *  can drive those paths on fake timers instead of real waits. */
export interface GatewayTimers {
  setTimeout: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  setInterval: (cb: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval: (id: ReturnType<typeof setInterval>) => void;
}

export class Gateway {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private acked = true;
  private resuming = false;

  constructor(
    private token: string,
    private gatewayUrl: string,
    private handlers: GatewayHandlers,
    // Socket + timers trail `handlers` with their production defaults, so
    // main.ts keeps constructing with the first three arguments and gets exactly
    // today's IO; tests pass a fake socket and fake timers instead. Each default
    // forwards to the global rather than capturing it, the same convention the
    // other two shells use (see bot/CLAUDE.md).
    private socketFactory: GatewaySocketFactory = (url) => new WebSocket(url),
    private timers: GatewayTimers = {
      setTimeout: (cb, ms) => setTimeout(cb, ms),
      setInterval: (cb, ms) => setInterval(cb, ms),
      clearInterval: (id) => clearInterval(id),
    },
    // The third seam, same convention: a fatal close ENDS the process (R13), and
    // a test cannot let the real `process.exit` run. The default drains stderr
    // before exiting: console.error writes to docker's log pipe asynchronously
    // and process.exit() discards queued writes, so a bare exit can eat the very
    // close-code line the crash loop's diagnosability depends on. Stream writes
    // settle in order, so the empty write's callback runs only after the queued
    // log line has been handed to the pipe. The drain is BOUNDED: stderr is a
    // pipe to the docker daemon, and a pipe nobody drains defers the callback
    // forever, which would leave a live process with a dead gateway while the
    // heartbeat task keeps the healthcheck green, the exact zombie this exit
    // exists to end. So exitCode is staged first (any other loop end still
    // exits nonzero) and an unref'd backstop timer exits with the log line
    // lost rather than not exiting at all.
    private exitProcess: (code: number) => void = (code) => {
      process.exitCode = code;
      const backstop = setTimeout(() => process.exit(code), EXIT_DRAIN_BACKSTOP_MS);
      (backstop as unknown as { unref?: () => void }).unref?.();
      process.stderr.write('', () => process.exit(code));
    },
  ) {}

  /**
   * Request a guild's full member list (op 8). Discord streams the members back
   * as GUILD_MEMBERS_CHUNK dispatches, so offline members (omitted from
   * GUILD_CREATE for large guilds) are delivered. Safe to call once the socket is
   * open (after IDENTIFY / GUILD_CREATE); a no-op if the socket is not open yet.
   */
  requestGuildMembers(guildId: string): void {
    this.send(requestGuildMembersPayload(guildId));
  }

  connect(resume = false): void {
    this.resuming = resume && this.sessionId !== null;
    const base = this.resuming && this.resumeUrl ? this.resumeUrl : this.gatewayUrl;
    const ws = this.socketFactory(`${base}/?v=10&encoding=json`);
    this.ws = ws;
    ws.on('message', (raw) => {
      try {
        this.onMessage(JSON.parse(raw.toString()));
      } catch (err) {
        console.error('[bot] gateway parse error', err);
      }
    });
    ws.on('close', (code) => this.onClose(code));
    ws.on('error', (err) => console.error('[bot] gateway socket error', err));
  }

  private onMessage(payload: Record<string, unknown>): void {
    if (typeof payload.s === 'number') this.seq = payload.s;
    switch (payload.op) {
      case GATEWAY_OP.HELLO: {
        this.startHeartbeat(heartbeatIntervalMs(payload));
        this.send(
          this.resuming && this.sessionId
            ? resumePayload(this.token, this.sessionId, this.seq)
            : identifyPayload(this.token),
        );
        break;
      }
      case GATEWAY_OP.HEARTBEAT:
        this.sendHeartbeat();
        break;
      case GATEWAY_OP.HEARTBEAT_ACK:
        this.acked = true;
        break;
      case GATEWAY_OP.INVALID_SESSION:
        // d=true means resumable; else re-identify after a short delay.
        this.resuming = payload.d === true;
        if (!this.resuming) {
          // L7: a NON-resumable INVALID_SESSION means Discord has destroyed the
          // session, so every artifact of it has to go. Clearing `resuming`
          // alone is not enough, because it only steers THIS reconnect: the
          // other two reconnect paths (a socket close, and op 7) both call
          // `reconnect(true)`, and `connect()` re-derives resuming from
          // `this.sessionId !== null`. Leaving the dead id behind therefore made
          // any close arriving before the next READY RESUME a session Discord
          // had just killed, which it answers with another INVALID_SESSION: a
          // wasted round trip in exactly the reconnect storms this packet exists
          // to tame. The resume URL and seq belong to the same dead session.
          this.sessionId = null;
          this.resumeUrl = null;
          this.seq = null;
        }
        this.timers.setTimeout(() => this.reconnect(this.resuming), 1500);
        break;
      case GATEWAY_OP.RECONNECT:
        this.reconnect(true);
        break;
      case GATEWAY_OP.DISPATCH: {
        const t = String(payload.t ?? '');
        const d = (payload.d ?? {}) as Record<string, unknown>;
        if (t === 'READY') {
          this.sessionId = typeof d.session_id === 'string' ? d.session_id : null;
          this.resumeUrl = typeof d.resume_gateway_url === 'string' ? d.resume_gateway_url : null;
        }
        try {
          this.handlers.onDispatch(t, d);
        } catch (err) {
          console.error('[bot] dispatch handler error', err);
        }
        break;
      }
      default:
        break;
    }
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.acked = true;
    this.heartbeatTimer = this.timers.setInterval(() => {
      if (!this.acked) {
        // No ACK since the last beat: the connection is a zombie. Drop + resume.
        this.ws?.terminate();
        return;
      }
      this.sendHeartbeat();
    }, intervalMs);
  }

  private sendHeartbeat(): void {
    this.acked = false;
    this.send({ op: GATEWAY_OP.HEARTBEAT, d: this.seq });
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) this.timers.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private send(obj: Record<string, unknown>): void {
    // NOTE for anyone injecting a socketFactory: OPEN is read from the `ws`
    // module imported above, not from the socket this returned. A fake whose
    // OPEN differs makes every send a silent no-op (no IDENTIFY, no heartbeat,
    // no error), which reads as a hung gateway rather than a wiring bug. The
    // suite avoids it by module-mocking `ws` so both sides are the same class.
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  private onClose(code: number): void {
    this.stopHeartbeat();
    if (isFatalCloseCode(code)) {
      // EXIT, rather than sit there as a live process doing nothing (D15/R13).
      // Every fatal code needs a human (a rotated token, an intent switched off
      // in the developer portal), and a bot that stays up while syncing nothing
      // is invisible: no alert fires and the container looks healthy. A nonzero
      // exit hands the decision to the restart policy, and the resulting crash
      // loop is the intended, VISIBLE outcome. Deliberately no retry limiter and
      // no backoff here: that would be this process quietly re-implementing the
      // supervisor it already has.
      console.error(
        `[bot] gateway closed with fatal code ${code}; not reconnecting, exiting so the restart policy can act`,
      );
      this.exitProcess(1);
      return;
    }
    this.timers.setTimeout(() => this.reconnect(true), 2000);
  }

  private reconnect(resume: boolean): void {
    // L18: stop the heartbeat FIRST. Two of the three paths into reconnect (op 7
    // and INVALID_SESSION) never saw a close, so onClose's stopHeartbeat did not
    // run, and `removeAllListeners()` below then strips the 'close' handler that
    // was the only other caller. The leaked interval's tick reads `this.ws` at
    // FIRE time, and connect() has reassigned it by then, so a stale unacked beat
    // terminates the socket that just replaced it.
    this.stopHeartbeat();
    try {
      this.ws?.removeAllListeners();
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.connect(resume);
  }
}
