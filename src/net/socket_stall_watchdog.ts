// Client-side silent-stall watchdog for the online game socket. A network path
// that dies without a FIN or RST (a black-holed route, a NAT rebind, a captive
// Wi-Fi handoff) never delivers onclose: the browser keeps reporting OPEN until
// TCP gives up, which can take minutes, and the server's own keepalive sweep
// (server/keepalive_sweep.ts, a 30 s ping) only frees the server side. Until
// then the player sees a frozen world with no reconnect started. The server
// streams a snapshot to every in-world session on each 20 Hz broadcast, so a
// long silence on a live session means the path is dead; ClientWorld then
// retires the socket and drives the same close path a real drop takes
// (socketClosed), which starts the jittered reconnect backoff at once.
//
// Pure decision core: no socket, no DOM, no timers. Every timestamp rides in
// through the call arguments (ClientWorld passes performance.now()), so a test
// drives it with plain numbers; it never reads a clock or randomness itself.

// The silence that counts as a dead path. The real cadence is one frame per
// 50 ms; normal jitter and bufferbloat stretch single gaps to hundreds of ms,
// and the production server's worst event-loop stall over a two-week window
// measured 2.75 s (nodejs_eventloop_lag_max_seconds; its p99.9 was 0.15 s).
// The 8 s floor is about three times that worst stall and 160 missed frames,
// yet still detects a dead path an order of magnitude sooner than TCP or the
// keepalive. Each client draws its own window once, uniformly over
// [STALL_WINDOW_MS, STALL_WINDOW_MS + STALL_WINDOW_SPREAD_MS): a realm-wide
// silence (a longer server stall, a shutdown drain) then closes clients over a
// 4 s spread instead of on one 50 ms beat, on top of the reconnect jitter.
export const STALL_WINDOW_MS = 8_000;
export const STALL_WINDOW_SPREAD_MS = 4_000;

// rng is injected (ClientWorld passes Math.random) so a test pins the draw.
export function drawStallWindowMs(rng: () => number): number {
  return STALL_WINDOW_MS + rng() * STALL_WINDOW_SPREAD_MS;
}

// A poll gap longer than this means the client itself was frozen (a long main
// thread task, a suspended mobile WebView, background timer throttling): frames
// may be sitting unread in the queue behind the poll, so the silence proves
// nothing about the network. The window restarts instead. ClientWorld polls on
// its 50 ms input beat, so this is twenty missed beats.
export const STALL_MAX_POLL_GAP_MS = 1_000;

export class SocketStallWatchdog {
  // Arrival time of the newest frame on the current transport, or null while
  // disarmed (no frame yet, the session is not live, or the watchdog fired).
  private lastFrameAtMs: number | null = null;
  private lastPollAtMs: number | null = null;

  constructor(
    private readonly windowMs = STALL_WINDOW_MS,
    private readonly maxPollGapMs = STALL_MAX_POLL_GAP_MS,
  ) {}

  // Any inbound frame proves the path alive, but only an ARMING frame (a
  // snapshot: the stream whose cadence the window is sized from) arms a
  // disarmed watchdog. A server that accepts the socket and sends hello but
  // never streams snapshots (a session with no world entity, a tick body that
  // throws every tick) therefore never arms it: firing there would only loop
  // close, reconnect, hello forever, since hello resets the attempt count.
  noteFrame(nowMs: number, arms: boolean): void {
    if (arms || this.lastFrameAtMs !== null) this.lastFrameAtMs = nowMs;
  }

  // True exactly once per stall: the caller retires the socket and runs its
  // close path. `hidden` restarts the window, so time the app spent in the
  // background never counts (the foreground zombie-socket path owns that case).
  // `live` false (the session is not in-world: a close path already ran, or the
  // handshake has not completed) disarms until the next transport's first
  // snapshot, so the watchdog never fires on top of a close already handled.
  poll(nowMs: number, hidden: boolean, live: boolean): boolean {
    const prevPollAtMs = this.lastPollAtMs;
    this.lastPollAtMs = nowMs;
    if (this.lastFrameAtMs === null) return false;
    if (!live) {
      this.lastFrameAtMs = null;
      return false;
    }
    if (hidden || (prevPollAtMs !== null && nowMs - prevPollAtMs > this.maxPollGapMs)) {
      this.lastFrameAtMs = nowMs;
      return false;
    }
    if (nowMs - this.lastFrameAtMs < this.windowMs) return false;
    this.lastFrameAtMs = null;
    return true;
  }
}
