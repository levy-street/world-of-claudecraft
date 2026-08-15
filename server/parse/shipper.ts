// The batching shipper: records buffer in memory as objects, a timer (never
// the tick path) marshals up to a hard cap per cycle, gzips, and POSTs to the
// ingest service with the daily_rewards outbound shape (AbortSignal.timeout,
// non-throwing degradation). Failures fall to the disk spool; each successful
// cycle also replays one spooled batch, so backlogs drain gradually without
// ever bursting. The ChatLogger flush discipline throughout.

import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import type { BatchHeader, ParseEnv } from './contract';
import { CONTRACT_VERSION } from './contract';
import type { ParseCounters } from './counters';
import type { BatchSpool } from './spool';

const gzipAsync = promisify(gzip);

const FLUSH_INTERVAL_MS = 2000;
/** Flush early once this many records are buffered. */
const FLUSH_AT = 500;
/** Never marshal more than this many records in one synchronous pass. */
const MARSHAL_CAP = 1000;
/** Hard buffer cap so an unreachable service cannot grow memory forever. */
const MAX_BUFFER = 50_000;
const SHIP_TIMEOUT_MS = 5000;
/** A quiet realm still drains its spool backlog on this cadence. */
const SPOOL_REPLAY_INTERVAL_MS = 15_000;
/**
 * Wall-clock budget for the shutdown drain, matching the deadline discipline
 * of the neighbouring shutdown steps (stopSteamMirror(5000) and friends): past
 * it, remaining batches spool WITHOUT a ship attempt, so a wedged ingest URL
 * can never hold up the chat-log flush and pool drain behind it.
 */
const STOP_DEADLINE_MS = 5000;
export const PARSE_SECRET_HEADER = 'x-woc-parse-secret';

export interface ShipperIdentity {
  realm: string;
  env: ParseEnv;
  build: string;
}

export class BatchShipper {
  private buffer: Record<string, unknown>[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private replayTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private immediateScheduled = false;
  private stopped = false;
  private seq = 0;
  private readonly bootId = randomBytes(6).toString('base64url');

  constructor(
    private readonly identity: ShipperIdentity,
    private readonly ingestUrl: string,
    private readonly ingestToken: string | null,
    private readonly spool: BatchSpool,
    private readonly counters: ParseCounters,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Hot-path entry: O(1) push. Flushing (including the marshal's stringify
   * loop) always happens off the caller's stack: the FLUSH_AT early trigger
   * schedules a setImmediate rather than flushing inline, so the recorder's
   * observe pass never pays serialization cost against its budget. */
  enqueue(record: Record<string, unknown>): void {
    if (this.stopped) return;
    if (this.buffer.length >= MAX_BUFFER) {
      this.buffer.shift();
      this.counters.recordsDroppedOverflow++;
    }
    this.buffer.push(record);
    this.counters.recordsBuffered = this.buffer.length;
    if (this.buffer.length >= FLUSH_AT) {
      if (!this.immediateScheduled) {
        this.immediateScheduled = true;
        setImmediate(() => {
          this.immediateScheduled = false;
          void this.flush();
        });
      }
    } else {
      this.armTimer();
    }
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlight !== null || this.buffer.length === 0) return;
    // Track the in-flight cycle so stop() can await it: records spliced out by
    // a running flush would otherwise be owned by no observable promise and a
    // process exit could lose them, neither shipped nor spooled.
    const run = this.flushCycle();
    this.inFlight = run;
    try {
      await run;
    } finally {
      if (this.inFlight === run) this.inFlight = null;
      if (this.buffer.length > 0 && !this.stopped) this.armTimer();
    }
  }

  /** Starts the idle spool-replay heartbeat; separate from the constructor so
   * tests drive replay deterministically via flush(). */
  startReplayHeartbeat(): void {
    if (this.replayTimer !== null || this.stopped) return;
    this.replayTimer = setInterval(() => {
      if (this.inFlight === null && !this.stopped) void this.replayOneSpooled();
    }, SPOOL_REPLAY_INTERVAL_MS);
    this.replayTimer.unref?.();
  }

  /** Final drain at shutdown: awaits any in-flight cycle, then ships until the
   * deadline and spools everything after it. Bounded by construction. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.replayTimer !== null) {
      clearInterval(this.replayTimer);
      this.replayTimer = null;
    }
    const deadline = this.now() + STOP_DEADLINE_MS;
    if (this.inFlight !== null) {
      await this.inFlight.catch(() => undefined);
    }
    while (this.buffer.length > 0) {
      const records = this.buffer.splice(0, MARSHAL_CAP);
      try {
        const gzipped = await this.marshal(records);
        const shipped = this.now() < deadline ? await this.ship(gzipped) : false;
        if (!shipped) await this.spool.append(gzipped);
      } catch (e) {
        console.error('[parse] shutdown flush failed:', e);
        return;
      }
    }
    this.counters.recordsBuffered = 0;
  }

  private async flushCycle(): Promise<void> {
    try {
      const records = this.buffer.splice(0, MARSHAL_CAP);
      this.counters.recordsBuffered = this.buffer.length;
      const gzipped = await this.marshal(records);
      const shipped = await this.ship(gzipped);
      if (!shipped) await this.spool.append(gzipped);
      else await this.replayOneSpooled();
    } catch (e) {
      console.error('[parse] flush failed:', e);
    }
  }

  private async marshal(records: Record<string, unknown>[]): Promise<Buffer> {
    const header: BatchHeader = {
      t: 'batch',
      v: CONTRACT_VERSION,
      batchId: `${this.bootId}-${this.seq++}`,
      realm: this.identity.realm,
      env: this.identity.env,
      build: this.identity.build,
      sentAtMs: Date.now(),
    };
    const lines = [JSON.stringify(header)];
    for (const record of records) lines.push(JSON.stringify(record));
    return (await gzipAsync(Buffer.from(lines.join('\n'), 'utf8'))) as Buffer;
  }

  private async ship(gzipped: Buffer): Promise<boolean> {
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/x-ndjson',
        // Self-describing body: a proxy or standards-compliant receiver can
        // tell the payload is compressed without out-of-band agreement.
        'content-encoding': 'gzip',
      };
      if (this.ingestToken !== null) headers[PARSE_SECRET_HEADER] = this.ingestToken;
      const res = await this.fetchImpl(this.ingestUrl, {
        method: 'POST',
        headers,
        body: new Uint8Array(gzipped),
        signal: AbortSignal.timeout(SHIP_TIMEOUT_MS),
        // A cross-origin redirect forwards custom headers (only Authorization
        // and Cookie are stripped), so following one could hand the secret and
        // the telemetry body to an http origin. Refuse redirects outright.
        redirect: 'error',
      });
      if (!res.ok) {
        this.counters.batchesShipFailed++;
        return false;
      }
      this.counters.batchesShipped++;
      return true;
    } catch {
      this.counters.batchesShipFailed++;
      return false;
    }
  }

  private async replayOneSpooled(): Promise<void> {
    const oldest = await this.spool.peekOldest();
    if (oldest === null) return;
    const shipped = await this.ship(oldest.data);
    if (shipped) {
      await this.spool.remove(oldest.name);
      this.counters.batchesReplayed++;
    }
  }

  private armTimer(): void {
    if (this.timer !== null || this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_INTERVAL_MS);
    this.timer.unref?.();
  }
}
