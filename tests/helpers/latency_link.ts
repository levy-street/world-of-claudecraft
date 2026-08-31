// A per-direction message pipe modeling the WebSocket the online client talks
// over, driven by a VirtualClock so a latency scenario is reproducible frame for
// frame.
//
// The transport is TCP: ORDERED and LOSSLESS. This link therefore never drops or
// reorders a message on its own. What it does model is the delay envelope and
// head-of-line blocking: delivery time is
//   deliverAt = max(previousDeliverAt, sentAt + baseMs + jitter, stallUntil)
// so a message that draws a long delay stalls every message queued behind it,
// exactly as a delayed TCP segment holds back the bytes after it. Jitter is
// drawn from a seeded Rng (one stream per direction), never Math.random, so the
// whole delivery schedule replays identically.
//
// The two scripted controls are explicit rather than probabilistic: `stall`
// pushes a congestion burst into the pipe, and `disconnect` models the link
// dropping, after which nothing already queued is ever delivered. Payloads are
// raw wire JSON strings and pass through byte-identical.

import { Rng } from '../../src/sim/rng';
import type { CancelHandle, VirtualClock } from './virtual_clock';

const UTF8 = new TextEncoder();

export type LinkDirection = 'toServer' | 'toClient';

export interface DirectionConfig {
  /** One-way delay floor in ms. */
  baseMs: number;
  /** Upper bound of the added jitter in ms (drawn uniformly from [0, jitterMs)). */
  jitterMs: number;
  /** Seed for this direction's jitter stream. */
  seed: number;
}

export interface LatencyLinkConfig {
  toServer: DirectionConfig;
  toClient: DirectionConfig;
}

interface Queued {
  payload: string;
  bytes: number;
  sentAt: number;
  deliverAt: number;
}

interface DirectionState {
  baseMs: number;
  jitterMs: number;
  rng: Rng;
  queue: Queued[];
  /** Delivery time of the last message ADMITTED to the queue (the monotonicity
   *  floor: nothing may be delivered before the message ahead of it). */
  lastDeliverAt: number;
  stallUntil: number;
  timer: CancelHandle | null;
  deliver: ((payload: string) => void) | null;
}

export class LatencyLink {
  private readonly clock: VirtualClock;
  private readonly dirs: Record<LinkDirection, DirectionState>;
  private live = true;

  constructor(clock: VirtualClock, config: LatencyLinkConfig) {
    this.clock = clock;
    this.dirs = {
      toServer: LatencyLink.makeDirection(config.toServer),
      toClient: LatencyLink.makeDirection(config.toClient),
    };
  }

  private static makeDirection(cfg: DirectionConfig): DirectionState {
    if (cfg.baseMs < 0 || cfg.jitterMs < 0) throw new Error('LatencyLink delays must be >= 0');
    return {
      baseMs: cfg.baseMs,
      jitterMs: cfg.jitterMs,
      rng: new Rng(cfg.seed),
      queue: [],
      lastDeliverAt: Number.NEGATIVE_INFINITY,
      stallUntil: Number.NEGATIVE_INFINITY,
      timer: null,
      deliver: null,
    };
  }

  /** Client to server (an input frame or a command). */
  clientSend(payload: string): void {
    this.send('toServer', payload);
  }

  /** Server to client (a snapshot or an event frame). */
  serverSend(payload: string): void {
    this.send('toClient', payload);
  }

  onDeliverToServer(cb: (payload: string) => void): void {
    this.dirs.toServer.deliver = cb;
  }

  onDeliverToClient(cb: (payload: string) => void): void {
    this.dirs.toClient.deliver = cb;
  }

  /**
   * Hold every delivery in `direction` until `untilMs`, including messages
   * already in flight: that is what makes it a congestion burst rather than a
   * per-message delay. Order is preserved (clamping a monotone sequence up to a
   * floor leaves it monotone).
   */
  stall(direction: LinkDirection, untilMs: number): void {
    const dir = this.dirs[direction];
    dir.stallUntil = Math.max(dir.stallUntil, untilMs);
    for (const msg of dir.queue) msg.deliverAt = Math.max(msg.deliverAt, dir.stallUntil);
    dir.lastDeliverAt = Math.max(dir.lastDeliverAt, dir.stallUntil);
    this.arm(direction);
  }

  /** Re-point the delay envelope mid-scenario (a latency spike or recovery). */
  setLatency(direction: LinkDirection, baseMs: number, jitterMs: number): void {
    if (baseMs < 0 || jitterMs < 0) throw new Error('LatencyLink delays must be >= 0');
    const dir = this.dirs[direction];
    dir.baseMs = baseMs;
    dir.jitterMs = jitterMs;
  }

  /** Drop the link. Nothing queued is delivered and later sends are ignored. */
  disconnect(): void {
    this.live = false;
    for (const direction of ['toServer', 'toClient'] as LinkDirection[]) {
      const dir = this.dirs[direction];
      this.clock.cancel(dir.timer);
      dir.timer = null;
      dir.queue.length = 0;
    }
  }

  get connected(): boolean {
    return this.live;
  }

  /** Messages still in flight in one direction. */
  pending(direction: LinkDirection): number {
    return this.dirs[direction].queue.length;
  }

  /** UTF-8 payload bytes still in flight in one direction. */
  pendingBytes(direction: LinkDirection): number {
    let bytes = 0;
    for (const message of this.dirs[direction].queue) bytes += message.bytes;
    return bytes;
  }

  /** When the message at the head of the queue is due (null when empty). */
  nextDeliveryAt(direction: LinkDirection): number | null {
    const head = this.dirs[direction].queue[0];
    return head ? head.deliverAt : null;
  }

  private send(direction: LinkDirection, payload: string): void {
    if (!this.live) return;
    const dir = this.dirs[direction];
    const sentAt = this.clock.now();
    const jitter = dir.jitterMs > 0 ? dir.rng.next() * dir.jitterMs : 0;
    const deliverAt = Math.max(sentAt + dir.baseMs + jitter, dir.lastDeliverAt, dir.stallUntil);
    dir.lastDeliverAt = deliverAt;
    dir.queue.push({
      payload,
      bytes: UTF8.encode(payload).byteLength,
      sentAt,
      deliverAt,
    });
    this.arm(direction);
  }

  /** One armed timer per direction, always at the head message's due time. */
  private arm(direction: LinkDirection): void {
    const dir = this.dirs[direction];
    this.clock.cancel(dir.timer);
    dir.timer = null;
    const head = dir.queue[0];
    if (!head) return;
    dir.timer = this.clock.schedule(head.deliverAt, () => {
      dir.timer = null;
      this.drain(direction);
    });
  }

  private drain(direction: LinkDirection): void {
    const dir = this.dirs[direction];
    while (this.live && dir.queue.length > 0 && dir.queue[0].deliverAt <= this.clock.now()) {
      const msg = dir.queue.shift() as Queued;
      dir.deliver?.(msg.payload);
    }
    if (this.live) this.arm(direction);
  }
}
