// Buffered chat-log writer. Chat is bursty, so rows are batched into a single
// multi-row INSERT (every few seconds or 100 rows, whichever comes first)
// instead of paying one DB round-trip per message.

export interface ChatLogRow {
  accountId: number;
  characterId: number;
  characterName: string;
  channel: string;
  message: string;
}

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_AT = 100; // flush early once this many rows are buffered
const MAX_BUFFER = 5000; // hard cap so an unreachable DB can't grow memory forever

export class ChatLogger {
  private buffer: ChatLogRow[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(private readonly write: (rows: ChatLogRow[]) => Promise<void>) {}

  log(row: ChatLogRow): void {
    this.buffer.push(row);
    if (this.buffer.length > MAX_BUFFER) this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
    if (this.buffer.length >= FLUSH_AT) {
      void this.flush();
    } else {
      this.armTimer();
    }
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.flushing || this.buffer.length === 0) return;
    const rows = this.buffer;
    this.buffer = [];
    this.flushing = true;
    try {
      await this.write(rows);
    } catch (err) {
      console.error('chat log flush failed:', err);
      // re-queue (capped) so a brief DB hiccup doesn't lose chat
      this.buffer = rows.concat(this.buffer).slice(-MAX_BUFFER);
    } finally {
      this.flushing = false;
      if (this.buffer.length > 0) this.armTimer();
    }
  }

  // Final flush for graceful shutdown.
  async stop(): Promise<void> {
    await this.flush();
  }

  private armTimer(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref?.();
  }
}
