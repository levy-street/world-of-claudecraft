// The per-guild HOLDER INDEX behind the unsettled gate and the escrow refusal
// arm: which live sessions hold unflushed work on which guild's book, with
// each holder's contribution (server/guild_bank_settle_gate.ts
// holderContribution) cached until its log changes. The gate used to walk
// every live session per gated op and fold every matching log; at the realm
// session cap and the op guard's rate that is tens of millions of session
// probes per second, so the index is maintained at the four places a mark or
// a log changes instead:
//
//   touch(session, guild)   an op landed (the mark was set, the log grew)
//   resync(session)         a save committed (a prefix was consumed, a mark
//                           may have cleared) or a rollback undid the log
//   dropGuild(guild)        the guild disbanded (every mark cleared)
//   dropSession(session)    the session left the realm
//
// A cached contribution is invalidated (never patched) on touch and resync,
// and recomputed lazily from the live log on the next read. Anything less
// exact is unsafe: a commit that consumed one entry while an op pushed
// another leaves the log the same LENGTH with different contents, and a
// length-keyed cache would then report the old deposit as unsettled and the
// new one as settled, which is exactly the consume the gate exists to refuse.
//
// The same module owns the flush coalescing: one flush in flight per holder
// (queued or running, however long the per-character save queue holds it),
// with a single re-arm behind it that fires only if the holder still carries
// work when the flush settles. Refusals cost their sender one op-guard token,
// so anything looser lets one officer stack saves on a dirty guildmate.

import type { GuildBankOpDelta } from '../src/sim/guild_bank';
import {
  contributesTo,
  type GuildBookContribution,
  type GuildBookDependency,
  holderContribution,
  SETTLED_BOOK,
  sumContributions,
  type UnsettledGuildBook,
} from './guild_bank_settle_gate';

/** The slice of a live session the index reads (structural, so GameServer's
 *  ClientSession satisfies it without the type dragging the whole class in). */
export interface GuildBookHolderSession {
  readonly escrowQuarantined: boolean;
  readonly left: boolean;
  readonly dirtyGuildBanks: ReadonlyMap<number, number>;
  readonly unflushedGuildBankOps: ReadonlyMap<number, readonly GuildBankOpDelta[]>;
}

/** How many holders one refusal may flush. The contributing filter normally
 *  leaves one; the bound is the ceiling for a book many officers are feeding
 *  at once, so a refusal can never fan out across a whole online guild. */
export const GUILD_BOOK_FLUSH_FAN_OUT_MAX = 4;

export class GuildBookHolderIndex<S extends GuildBookHolderSession> {
  // guild -> holder -> cached contribution, null while stale.
  private readonly byGuild = new Map<number, Map<S, GuildBookContribution | null>>();
  private readonly bySession = new Map<S, Set<number>>();

  /** An op landed on this guild's book for this session: index it and drop
   *  its cached contribution. */
  touch(session: S, guildId: number): void {
    let holders = this.byGuild.get(guildId);
    if (!holders) {
      holders = new Map();
      this.byGuild.set(guildId, holders);
    }
    holders.set(session, null);
    let guilds = this.bySession.get(session);
    if (!guilds) {
      guilds = new Set();
      this.bySession.set(session, guilds);
    }
    guilds.add(guildId);
  }

  /** The session's marks or logs changed outside an op (a commit consumed a
   *  prefix, a rollback undid the log): keep it indexed where it is still
   *  dirty with a stale contribution, drop it where it is not. */
  resync(session: S): void {
    const guilds = this.bySession.get(session);
    if (!guilds) return;
    for (const guildId of [...guilds]) {
      if (session.dirtyGuildBanks.has(guildId)) {
        this.byGuild.get(guildId)?.set(session, null);
        continue;
      }
      this.remove(session, guildId, guilds);
    }
  }

  /** The guild disbanded: every session's mark for it cleared. */
  dropGuild(guildId: number): void {
    const holders = this.byGuild.get(guildId);
    if (!holders) return;
    for (const session of holders.keys()) {
      const guilds = this.bySession.get(session);
      guilds?.delete(guildId);
      if (guilds && guilds.size === 0) this.bySession.delete(session);
    }
    this.byGuild.delete(guildId);
  }

  /** The session left the realm. */
  dropSession(session: S): void {
    const guilds = this.bySession.get(session);
    if (!guilds) return;
    for (const guildId of [...guilds]) this.remove(session, guildId, guilds);
  }

  /** Sessions other than `except` holding unflushed work on this guild's
   *  book. A quarantined session is never a holder: its work was undone on the
   *  live book the moment it was quarantined. A LEAVING session's work is
   *  still on the live book until its leave flush commits, so the gate counts
   *  it (`includeLeaving: true`); the escrow refusal arm does not, because a
   *  departing session is neither one to wait on nor one to flush again. */
  holders(guildId: number, except: S | null, opts: { readonly includeLeaving: boolean }): S[] {
    const out: S[] = [];
    const holders = this.byGuild.get(guildId);
    if (!holders) return out;
    for (const session of holders.keys()) {
      if (session === except || session.escrowQuarantined) continue;
      if (session.left && !opts.includeLeaving) continue;
      if (!session.dirtyGuildBanks.has(guildId)) continue;
      out.push(session);
    }
    return out;
  }

  /** The sum of every OTHER holder's contribution on this guild's book, the
   *  gate's input. Leaving sessions included: their work is live until their
   *  leave flush commits. */
  unsettled(guildId: number, except: S | null): UnsettledGuildBook {
    const holders = this.byGuild.get(guildId);
    if (!holders) return SETTLED_BOOK;
    const contributions: GuildBookContribution[] = [];
    for (const session of this.holders(guildId, except, { includeLeaving: true })) {
      contributions.push(this.contribution(holders, session, guildId));
    }
    return contributions.length === 0 ? SETTLED_BOOK : sumContributions(contributions);
  }

  /** The holders a refusal should flush: the ones whose work FEEDS the named
   *  dependency (every holder when none is named), never a leaving or
   *  quarantined one, and at most `max` of them. */
  contributors(
    guildId: number,
    except: S | null,
    dependency: GuildBookDependency | null,
    max = GUILD_BOOK_FLUSH_FAN_OUT_MAX,
  ): S[] {
    const out: S[] = [];
    const holders = this.byGuild.get(guildId);
    if (!holders) return out;
    for (const session of this.holders(guildId, except, { includeLeaving: false })) {
      if (out.length >= max) break;
      if (
        dependency === null ||
        contributesTo(this.contribution(holders, session, guildId), dependency)
      ) {
        out.push(session);
      }
    }
    return out;
  }

  /** How many guilds have at least one indexed holder (a leak pin for tests). */
  get size(): number {
    return this.byGuild.size;
  }

  private contribution(
    holders: Map<S, GuildBookContribution | null>,
    session: S,
    guildId: number,
  ): GuildBookContribution {
    let cached = holders.get(session) ?? null;
    if (cached === null) {
      cached = holderContribution(session.unflushedGuildBankOps.get(guildId) ?? []);
      holders.set(session, cached);
    }
    return cached;
  }

  private remove(session: S, guildId: number, guilds: Set<number>): void {
    const holders = this.byGuild.get(guildId);
    holders?.delete(session);
    if (holders && holders.size === 0) this.byGuild.delete(guildId);
    guilds.delete(guildId);
    if (guilds.size === 0) this.bySession.delete(session);
  }
}

/** The flush state a holder session carries. */
export interface GuildBookFlushSession {
  guildBookFlushInFlight: boolean;
  guildBookFlushRearm: boolean;
  readonly left: boolean;
  readonly escrowQuarantined: boolean;
  readonly dirtyGuildBanks: ReadonlyMap<number, number>;
}

/** Flush one holder, coalesced: while a flush is queued or running for it,
 *  a further request only arms ONE follow-up, which fires when the flush
 *  settles and only if the holder still carries work then. `save` must never
 *  reject (the host wraps its own logging around the real save). */
export function requestGuildBookFlush<S extends GuildBookFlushSession>(
  session: S,
  save: (session: S) => Promise<unknown>,
): void {
  if (session.left || session.escrowQuarantined) return;
  if (session.guildBookFlushInFlight) {
    session.guildBookFlushRearm = true;
    return;
  }
  session.guildBookFlushInFlight = true;
  session.guildBookFlushRearm = false;
  void save(session).then(
    () => settle(session, save),
    () => settle(session, save),
  );
}

function settle<S extends GuildBookFlushSession>(
  session: S,
  save: (session: S) => Promise<unknown>,
): void {
  session.guildBookFlushInFlight = false;
  const again = session.guildBookFlushRearm;
  session.guildBookFlushRearm = false;
  if (again && session.dirtyGuildBanks.size > 0) requestGuildBookFlush(session, save);
}
