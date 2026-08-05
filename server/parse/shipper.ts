// The batching shipper: records buffer in memory as objects, a timer (never
// the tick path) marshals up to a hard cap per cycle, gzips, and POSTs to the
// ingest service with the daily_rewards outbound shape (AbortSignal.timeout,
// non-throwing degradation). Failures fall to the disk spool; each successful
// cycle also replays one spooled batch, so backlogs drain gradually without
// ever bursting. The ChatLogger flush discipline throughout.
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
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
export const PARSE_SECRET_HEADER = 'x-woc-parse-secret';

export interface ShipperIdentity {
  realm: string;
  env: ParseEnv;
  build: string;
}

export class BatchShipper {
  private buffer: Record<string, unknown>[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
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
  ) {}

  /** Hot-path entry: O(1) push, flushing always happens on the timer. */
  enqueue(record: Record<string, unknown>): void {
    if (this.stopped) return;
    if (this.buffer.length >= MAX_BUFFER) {
      this.buffer.shift();
      this.counters.recordsDroppedOverflow++;
    }
    this.buffer.push(record);
    this.counters.recordsBuffered = this.buffer.length;
    if (this.buffer.length >= FLUSH_AT) void this.flush();
    else this.armTimer();
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;
    try {
      const records = this.buffer.splice(0, MARSHAL_CAP);
      this.counters.recordsBuffered = this.buffer.length;
      const gzipped = await this.marshal(records);
      const shipped = await this.ship(gzipped);
      if (!shipped) await this.spool.append(gzipped);
      else await this.replayOneSpooled();
    } catch (e) {
      console.error('[parse] flush failed:', e);
    } finally {
      this.flushing = false;
      if (this.buffer.length > 0) this.armTimer();
    }
  }

  /** Final flush at shutdown: one ship attempt, spool on failure. */
  async stop(): Promise<void> {
    this.stopped = true;
    while (this.buffer.length > 0) {
      const records = this.buffer.splice(0, MARSHAL_CAP);
      try {
        const gzipped = await this.marshal(records);
        const shipped = await this.ship(gzipped);
        if (!shipped) await this.spool.append(gzipped);
      } catch (e) {
        console.error('[parse] shutdown flush failed:', e);
        return;
      }
    }
    this.counters.recordsBuffered = 0;
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
      const headers: Record<string, string> = { 'content-type': 'application/x-ndjson' };
      if (this.ingestToken !== null) headers[PARSE_SECRET_HEADER] = this.ingestToken;
      const res = await this.fetchImpl(this.ingestUrl, {
        method: 'POST',
        headers,
        body: new Uint8Array(gzipped),
        signal: AbortSignal.timeout(SHIP_TIMEOUT_MS),
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
