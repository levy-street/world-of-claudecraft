// The guild bank TRANSACTION HISTORY mirror: the client-side state machine
// behind IWorld.guildBankLog() / guildBankLogOlder() on the online world. A
// pure sibling of online.ts (DOM-free, socket-free, clock-injected): it holds
// the loaded pages for ONE filter kind, decides when a request is due, and
// merges answers; ClientWorld is a thin consumer that hands it the clock and
// puts the request it returns on the wire. That split is what keeps the
// paging and filter rules unit-testable in Node (tests/guild_bank_log_mirror)
// without a WebSocket, and keeps online.ts under its ratchet.
//
// The contract, in the order things happen:
//   - READ (the pane paints): the newest window of the CURRENT kind is
//     re-requested once per TTL (a per-frame repaint sends nothing inside it;
//     a request that never answered ages into exactly one retry). Reading a
//     DIFFERENT kind drops everything and requests that kind's newest window
//     at once: the loaded pages belong to a filter, and rows gathered under
//     one label must never be shown under another.
//   - OLDER (the pane's "show older" click): one request for the rows before
//     the oldest loaded id, only when there is something to ask for (rows are
//     loaded, the server said `more`, no older page is already in flight).
//   - ANSWER: a refusal replaces everything with the refused state (authority
//     was lost; no page of any kind may survive it). A success is matched
//     against what was asked: a newest-window answer is MERGED over the loaded
//     rows, an older-page answer is APPENDED, and an answer to a question this
//     kind is no longer asking (a stale filter, a cursor nobody is waiting on)
//     is dropped.
//
// MERGING THE NEWEST WINDOW over loaded older pages is the one subtle step. A
// refresh returns the newest N rows. When it OVERLAPS the loaded rows (shares
// an id, or fits entirely above them with no gap the server reports), the
// union is a contiguous history and the older pages are kept. When it does
// NOT overlap and the server says more rows exist beyond it, there is a gap
// between the refreshed window and the pages loaded earlier (more than a
// window's worth of ops landed since), and the older pages are DROPPED rather
// than shown with a silent hole: a history with a missing stretch is exactly
// the shape a trust surface must never take.

import type { GuildBankLogEntry, GuildBankLogKind, GuildBankLogView } from '../world_api';
import {
  decodeGuildBankLogFrame,
  GUILD_BANK_LOG_TTL_MS,
  type GuildBankLogFrame,
  type GuildBankLogRequest,
} from './guild_bank_log_wire';

const EMPTY: readonly GuildBankLogEntry[] = Object.freeze([]);

export class GuildBankLogMirror {
  private kind: GuildBankLogKind = 'all';
  /** Newest first, de-duplicated by id, contiguous from the newest window
   *  down through every older page appended so far. */
  private entries: readonly GuildBankLogEntry[] = EMPTY;
  private state: 'idle' | 'ready' | 'refused' = 'idle';
  /** The server's word on whether rows older than the last entry exist. */
  private more = false;
  /** SEND time of the last newest-window request, null before the first: the
   *  ONE gate on re-requesting it (idempotent inside the TTL, one retry past
   *  it). Null rather than 0 so the gate does not depend on the clock's epoch
   *  (a fresh mirror on a small injected clock must still ask). */
  private headSentAt: number | null = null;
  /** The older-page request in flight: its cursor and send time, or null. */
  private older: { before: number; sentAt: number } | null = null;

  /**
   * Read the view for `kind` and say whether a newest-window request is due
   * (the caller sends it). Never sends itself: the returned request is the
   * whole side effect, which is what makes this exact and testable.
   */
  read(
    kind: GuildBankLogKind,
    now: number,
  ): { view: GuildBankLogView; request: GuildBankLogRequest | null } {
    if (kind !== this.kind) {
      this.reset();
      this.kind = kind;
    }
    let request: GuildBankLogRequest | null = null;
    if (this.headSentAt === null || now - this.headSentAt >= GUILD_BANK_LOG_TTL_MS) {
      this.headSentAt = now;
      request = { cmd: 'guild_bank_log', kind: this.kind };
    }
    // An older-page request that never answered ages out on the same clock, so
    // a dropped frame can never wedge the footer on "loading older".
    if (this.older !== null && now - this.older.sentAt >= GUILD_BANK_LOG_TTL_MS) this.older = null;
    return { view: this.view(), request };
  }

  /**
   * The next older page's request, or null when there is nothing to ask for:
   * nothing loaded yet, the server said the loaded rows reach the start, an
   * older page is already in flight, or the read was refused.
   */
  requestOlder(now: number): GuildBankLogRequest | null {
    if (this.state !== 'ready' || !this.more || this.older !== null) return null;
    const oldest = this.entries[this.entries.length - 1];
    if (oldest === undefined) return null;
    this.older = { before: oldest.id, sentAt: now };
    return { cmd: 'guild_bank_log', kind: this.kind, before: oldest.id };
  }

  /** Feed one incoming message; true when it was a gbanklog frame (consumed). */
  receive(msg: unknown): boolean {
    const frame = decodeGuildBankLogFrame(msg);
    if (frame === null) return false;
    this.install(frame);
    return true;
  }

  /** Drop every loaded page and re-arm both request gates. The rows belong to
   *  a guild and a gate this client may no longer have. The kind is kept: it is
   *  the viewer's filter choice, not server state. */
  reset(): void {
    this.entries = EMPTY;
    this.state = 'idle';
    this.more = false;
    this.headSentAt = null;
    this.older = null;
  }

  private view(): GuildBankLogView {
    return {
      state: this.state === 'idle' ? 'loading' : this.state,
      kind: this.kind,
      entries: this.entries,
      more: this.more,
      olderPending: this.older !== null,
    };
  }

  private install(frame: GuildBankLogFrame): void {
    if (frame.refused) {
      // Authority was lost: no page of any kind survives, and the refusal
      // keeps saying so until a fresh answer replaces it.
      this.entries = EMPTY;
      this.state = 'refused';
      this.more = false;
      this.older = null;
      return;
    }
    // An answer for a filter the pane is no longer showing: dropped, never
    // installed under the wrong label. A frame that states NO kind comes from
    // a server that predates paging and answers the newest window of
    // everything; it is accepted under any chip rather than dropped forever
    // (the pane would otherwise sit on loading, re-requesting once per TTL).
    if (frame.kind !== null && frame.kind !== this.kind) return;
    if (frame.before === null) {
      this.installHead(frame);
      return;
    }
    // An older page nobody is waiting on (a stale cursor, a duplicate answer,
    // a reset in between): dropped.
    if (this.older === null || this.older.before !== frame.before) return;
    this.older = null;
    // The cursor must STILL be the oldest loaded id. A newest-window refresh
    // with no overlap can replace the rows while this page is in flight (the
    // race the review probed: head 200..151, cursor 151 out, refresh lands
    // 260..211, then 150..101 arrives); appending it under rows it is not
    // contiguous with would seat a hole that every later overlapping refresh
    // preserves. Dropped instead, and the footer offers older rows again.
    if (this.entries[this.entries.length - 1]?.id !== frame.before) return;
    const before = frame.before;
    const below = frame.entries.filter((e) => e.id < before);
    this.entries = Object.freeze([...this.entries, ...below]);
    this.more = frame.more;
    this.state = 'ready';
  }

  private installHead(frame: GuildBankLogFrame): void {
    const head = frame.entries;
    const wasReady = this.state === 'ready';
    this.state = 'ready';
    if (!wasReady || this.entries.length === 0 || head.length === 0) {
      // First answer (or a refresh over nothing): the window IS the history.
      this.entries = Object.freeze([...head]);
      this.more = frame.more;
      return;
    }
    const headOldest = head[head.length - 1].id;
    const seen = new Set(head.map((e) => e.id));
    if (!this.entries.some((e) => seen.has(e.id))) {
      // No overlap with the loaded rows: either a gap (more than a window's
      // worth of ops landed since the loaded pages were read, so nothing
      // below the window is known to be contiguous with it) or the window is
      // the whole history now. Either way the window replaces the pages
      // rather than being shown above a hole, and an older page still in
      // flight for the OLD rows is forgotten with them (its answer would be
      // dropped by the oldest-id check anyway; clearing it lets the footer
      // offer older rows again at once).
      this.entries = Object.freeze([...head]);
      this.more = frame.more;
      this.older = null;
      return;
    }
    // Contiguous: the window plus every loaded row older than it. `more`
    // stays the OLDEST page's word (the window's `more` only says rows exist
    // below the window, which the kept pages already are).
    const kept = this.entries.filter((e) => e.id < headOldest);
    this.entries = Object.freeze([...head, ...kept]);
    if (kept.length === 0) this.more = frame.more;
  }
}
