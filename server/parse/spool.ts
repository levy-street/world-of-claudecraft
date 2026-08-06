// Bounded on-disk batch spool: the durability layer between the recorder and
// the ingest service. Already-gzipped batches land here when a ship fails (or
// at shutdown) and replay in order when the service is reachable again. The
// spool is the only thing that looks unbounded and is not: past the byte cap
// the OLDEST batch is evicted, counted, and telemetry (never gameplay) is shed.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ParseCounters } from './counters';

const SPOOL_PREFIX = 'batch-';
const SPOOL_SUFFIX = '.ndjson.gz';

export class BatchSpool {
  private seq = 0;
  private ready: Promise<void>;

  constructor(
    private readonly dir: string,
    private readonly maxBytes: number,
    private readonly counters: ParseCounters,
  ) {
    this.ready = fs
      .mkdir(dir, { recursive: true })
      .then(() => this.recomputeBytes())
      .catch((e) => {
        console.error('[parse] spool dir create failed:', e);
      });
  }

  /** Persist one gzipped batch; evicts oldest past the cap. Never throws. */
  async append(gzipped: Buffer): Promise<void> {
    try {
      await this.ready;
      const name = `${SPOOL_PREFIX}${Date.now()}-${(this.seq++).toString().padStart(6, '0')}${SPOOL_SUFFIX}`;
      await fs.writeFile(path.join(this.dir, name), gzipped);
      this.counters.batchesSpooled++;
      this.counters.spoolBytes += gzipped.length;
      await this.evictPastCap();
    } catch (e) {
      console.error('[parse] spool append failed:', e);
    }
  }

  /** Oldest spooled batch, or null. Never throws. */
  async peekOldest(): Promise<{ name: string; data: Buffer } | null> {
    try {
      await this.ready;
      const names = await this.sortedNames();
      const name = names[0];
      if (name === undefined) return null;
      return { name, data: await fs.readFile(path.join(this.dir, name)) };
    } catch (e) {
      console.error('[parse] spool read failed:', e);
      return null;
    }
  }

  /** Delete a shipped (or corrupt) batch file. Never throws. Byte accounting
   * moves only on a SUCCESSFUL unlink: a persistent unlink failure (say a
   * read-only mount) must not drift spoolBytes below reality, or the byte cap
   * stops bounding disk. */
  async remove(name: string): Promise<void> {
    try {
      const file = path.join(this.dir, name);
      const stat = await fs.stat(file).catch(() => null);
      const unlinked = await fs.unlink(file).then(
        () => true,
        () => false,
      );
      if (unlinked && stat !== null) {
        this.counters.spoolBytes = Math.max(0, this.counters.spoolBytes - stat.size);
      }
    } catch (e) {
      console.error('[parse] spool remove failed:', e);
    }
  }

  private async sortedNames(): Promise<string[]> {
    const entries = await fs.readdir(this.dir);
    return entries.filter((n) => n.startsWith(SPOOL_PREFIX) && n.endsWith(SPOOL_SUFFIX)).sort();
  }

  private async recomputeBytes(): Promise<void> {
    let total = 0;
    for (const name of await this.sortedNames()) {
      const stat = await fs.stat(path.join(this.dir, name)).catch(() => null);
      if (stat !== null) total += stat.size;
    }
    this.counters.spoolBytes = total;
  }

  private async evictPastCap(): Promise<void> {
    while (this.counters.spoolBytes > this.maxBytes) {
      const names = await this.sortedNames();
      const oldest = names[0];
      if (oldest === undefined) {
        await this.recomputeBytes();
        return;
      }
      await this.remove(oldest);
      this.counters.batchesSpoolDropped++;
    }
  }
}
