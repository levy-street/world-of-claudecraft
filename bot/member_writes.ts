// The two member-facing WRITE paths, plus the decision the member-update event
// feeds them. Extracted out of main.ts rather than written there because
// `main.ts` calls `main()` at module scope, so nothing inside it is reachable
// from a test (ledger item L8 says to extract instead of reaching for a
// source-text pin, the same move R6 made for the cadence constants).
//
// The rule all three share is D5, diff before write: the bot pushed a nickname
// PATCH for every linked online member on every sweep whether or not anything had
// changed, and Discord answered each PATCH with a GUILD_MEMBER_UPDATE that the
// handler turned into a members-meta POST back into the game. So one unchanged
// member cost a Discord write, a gateway event and a game write, five minutes
// apart, forever. Diffing first collapses the steady state to nothing at all.
//
// Every cache update here happens ONLY after the write actually succeeded, which
// is the pattern computeRoleSync's caller already used: a cache written
// optimistically would claim a failed write had landed, and the retry that would
// have fixed it next sweep never happens.
//
// IO arrives as injected callbacks, so all of this is unit-tested without a
// network, a Discord token, or a clock.

import {
  changedMemberMeta,
  chunk,
  isSelfNickEcho,
  MEMBERS_META_BATCH,
  type MemberMetaRecord,
  memberMetaChanged,
  nicknameNeedsWrite,
} from './logic';

/** The caches a nickname write reads and, on success, updates. */
export interface NicknameCaches {
  /** Raw `member.nick` per member, null when they have none set. */
  memberNicks: Map<string, string | null>;
  /** Display name per member (nick, else global_name, else username). */
  memberNames: Map<string, string>;
  /** The nick THIS bot last wrote, used only to recognize our own echo. */
  lastWrittenNick: Map<string, string>;
}

export interface NicknameWriteIo {
  /** Rejects on a failed PATCH, the way the Discord shell already behaves. */
  setNickname: (userId: string, nick: string) => Promise<unknown>;
  onError?: (error: unknown) => void;
}

/**
 * Send a member's nickname PATCH, but only when the computed nick actually
 * differs from the nick we last observed for them. Returns what happened, so a
 * caller (and a test) can tell a skipped write from a failed one.
 *
 * On success all three caches move together: the raw nick, because that is what
 * the next sweep diffs against; the display name, because after our PATCH the
 * member's nick IS this value, so the echo Discord sends back carries nothing
 * new; and lastWrittenNick, which is what lets that echo be recognized.
 */
export async function writeMemberNickname(
  userId: string,
  nick: string,
  caches: NicknameCaches,
  io: NicknameWriteIo,
): Promise<'skipped' | 'written' | 'failed'> {
  if (!nicknameNeedsWrite(nick, caches.memberNicks.get(userId))) return 'skipped';
  try {
    await io.setNickname(userId, nick);
  } catch (error) {
    // Deliberately NOT touching a cache here. Leaving the observed nick as it was
    // is what makes the next sweep try again instead of believing this landed.
    io.onError?.(error);
    return 'failed';
  }
  caches.memberNicks.set(userId, nick);
  caches.memberNames.set(userId, nick);
  caches.lastWrittenNick.set(userId, nick);
  return 'written';
}

export interface MetaPushIo {
  /**
   * Answers null for a failed push rather than rejecting, matching the game
   * client's envelope handling. The return value is therefore the ONLY success
   * signal available, and marking a batch clean without reading it would strand
   * every member in it until some later unrelated field happened to move.
   */
  pushMembersMeta: (records: MemberMetaRecord[]) => Promise<unknown>;
  /**
   * Called once per ACCEPTED batch with the ids it carried and the raw response,
   * so a caller can read the linkage signal riding on it (the response reports
   * which accepted ids had no link row). Optional, and deliberately not called
   * for a refused batch: a refusal says nothing about linkage, and inferring
   * from one would let a transport failure empty the sweep's member set.
   *
   * A callback rather than a widened return type because the two consumers want
   * different things: the caller of these functions wants the records that
   * landed, and this wants the response, per batch, while the batching loop
   * still knows which ids were in it.
   */
  onBatchOutcome?: (batchIds: string[], result: unknown) => void;
}

/**
 * Whether a push result means the server did NOT take the records.
 *
 * Both nullish shapes count, and the distinction matters: `call()` returns null
 * for a transport or envelope failure, but it also returns `env.data` verbatim on
 * a success envelope, so a body with no data reads as `undefined`. A `!== null`
 * check alone would treat that as accepted and mark the batch clean. Diffing made
 * this sharper than it used to be: before, every sweep re-pushed the whole roster,
 * so a dropped push healed itself within one interval; now a batch wrongly marked
 * clean stays suppressed until the record changes again or the bot restarts.
 */
export function pushRejected(result: unknown): boolean {
  return result === null || result === undefined;
}

/**
 * Push exactly the members whose meta changed since the last SUCCESSFUL push,
 * still batched under the byte cap the roster push has always used. In steady
 * state nothing has changed, so this sends no request at all. Returns the records
 * that were actually accepted.
 *
 * A failed batch stops the run rather than skipping ahead: the members in it keep
 * their old cache entries and are retried next sweep, and pressing on would just
 * spend more requests against a server that has already refused one.
 */
export async function pushChangedMemberMeta(
  records: readonly MemberMetaRecord[],
  lastPushed: Map<string, MemberMetaRecord>,
  io: MetaPushIo,
  batchSize: number = MEMBERS_META_BATCH,
): Promise<MemberMetaRecord[]> {
  const pushed: MemberMetaRecord[] = [];
  for (const batch of chunk(changedMemberMeta(records, lastPushed), batchSize)) {
    const result = await io.pushMembersMeta(batch);
    if (pushRejected(result)) return pushed;
    for (const record of batch) {
      lastPushed.set(record.discord_user_id, record);
      pushed.push(record);
    }
    // AFTER the cache moves, so an observer cannot be undone by the write that
    // follows it. The batch stays cached even for ids the server could not apply
    // (L14): leaving them dirty would re-push most of the guild every sweep, so
    // the correction rides the linkage signal instead.
    io.onBatchOutcome?.(
      batch.map((record) => record.discord_user_id),
      result,
    );
  }
  return pushed;
}

/**
 * Push ONE member's meta if it changed. Used where a live event re-resolves a
 * single member's flair, so a role grant reflects in game without waiting for the
 * sweep.
 */
export async function pushOneMemberMeta(
  record: MemberMetaRecord,
  lastPushed: Map<string, MemberMetaRecord>,
  io: MetaPushIo,
): Promise<boolean> {
  if (!memberMetaChanged(record, lastPushed.get(record.discord_user_id))) return false;
  const result = await io.pushMembersMeta([record]);
  if (pushRejected(result)) return false;
  lastPushed.set(record.discord_user_id, record);
  io.onBatchOutcome?.([record.discord_user_id], result);
  return true;
}

/**
 * How long the roster push may keep trusting its diff cache before one sweep is
 * forced to re-push everything.
 *
 * An hour against the 5 minute sweep means eleven diffed sweeps and one full
 * one, so the steady state still sends nothing for eleven twelfths of the time
 * and the load this phase removed stays removed. It is the ceiling on how long a
 * divergence can last, so it is chosen to be short enough that an operator does
 * not notice and long enough that it is not the load.
 */
export const FULL_RESYNC_INTERVAL_MS = 60 * 60_000;

/**
 * Whether this sweep must re-push the WHOLE roster rather than only what changed.
 *
 * The diff cache is one-sided: it records what the bot BELIEVES the server holds,
 * and nothing tells it when that belief goes stale. The server can lose the
 * values behind the bot's back and the bot will never re-assert them, because
 * the record it is diffing against has not moved. Three ways in, all real:
 *  - a member who is in the guild but has not linked a game account. The stored
 *    meta is written by an UPDATE against the link row, so the push applies to
 *    zero rows, yet the endpoint counts it as accepted. When they link LATER,
 *    the fresh row carries no join date and no staff flair, and the sweep has
 *    already marked them clean.
 *  - unlinking and relinking, which drops the row and inserts a new one with
 *    both meta columns null.
 *  - anything that edits the table out of band: a restore from backup, a
 *    moderation delete.
 * Before this phase every sweep re-pushed the whole roster, so all three healed
 * within one interval and nobody had to enumerate them. Diffing removed that
 * property, and this bounds how long its absence can last, which is why it is a
 * TIME since the last full push rather than a count of sweeps: the task is also
 * kicked by GUILD_CREATE and the member backfill, so a reconnect storm would
 * otherwise race the counter and re-push hardest exactly when it should not.
 */
export function dueForFullResync(
  lastFullAtMs: number,
  nowMs: number,
  everyMs: number = FULL_RESYNC_INTERVAL_MS,
): boolean {
  if (!Number.isFinite(lastFullAtMs) || !Number.isFinite(nowMs)) return true;
  const every = Number.isFinite(everyMs) && everyMs > 0 ? everyMs : FULL_RESYNC_INTERVAL_MS;
  // A clock that went BACKWARDS (an NTP correction) reads as a huge negative
  // elapsed, which would postpone the resync rather than trigger it. Re-syncing
  // is the safe answer to not knowing how much time passed.
  const elapsed = nowMs - lastFullAtMs;
  if (elapsed < 0) return true;
  return elapsed >= every;
}

/**
 * Drop the whole diff cache when the interval is up, and answer the timestamp to
 * carry forward.
 *
 * The DECISION is dueForFullResync; this is the transition it exists to drive,
 * here rather than in main.ts because main.ts runs `main()` at module scope and
 * nothing in it can be reached from a test. Forgetting the restamp there would
 * make every later sweep a full re-push, which is exactly the load D5 removed,
 * and no assertion could have said so.
 */
export function fullResyncIfDue(
  lastFullAtMs: number,
  nowMs: number,
  lastPushed: Map<string, MemberMetaRecord>,
  everyMs: number = FULL_RESYNC_INTERVAL_MS,
): number {
  if (!dueForFullResync(lastFullAtMs, nowMs, everyMs)) return lastFullAtMs;
  lastPushed.clear();
  return nowMs;
}

/**
 * The refresh-then-push pair the roster sweep runs, with the ordering that makes
 * it correct and the catch that keeps it from being all-or-nothing.
 *
 * ORDERED, because the push reads the special-role index the refresh rebuilds, so
 * a push that ran first would publish the previous sweep's flair. But a failed
 * refresh must NOT take the push with it: before this phase the GUILD_CREATE and
 * member-backfill paths called the push directly, with no Discord REST call in
 * front of it, and folding them into one task gave them the guild-roles GET as a
 * precondition they never had. A reconnect storm is exactly when that GET fails.
 *
 * Extracted for the same reason as everything else here: the arm that matters is
 * "the refresh threw and the push still ran", and inside main.ts nothing can say
 * so. A source pin cannot either, since a catch that rethrows looks identical.
 */
export async function refreshThenPushMeta(io: {
  refresh: () => Promise<unknown>;
  push: () => Promise<unknown>;
  onRefreshError: (error: unknown) => void;
}): Promise<void> {
  try {
    await io.refresh();
  } catch (error) {
    io.onRefreshError(error);
  }
  await io.push();
}

/**
 * Forget everything the diffs remember about a member, for use when they leave
 * the guild or their stored flair is cleared.
 *
 * This is small enough to inline at its two call sites and is a named function
 * anyway, because getting it wrong is invisible: leave a member's last-pushed
 * record behind and a REJOIN is diffed against their pre-departure state, so the
 * push that would restore their flair is suppressed and the game keeps showing
 * them as cleared indefinitely. A test can state that; a line inside main.ts,
 * which runs main() at module scope, cannot be reached to state anything.
 */
export function forgetMember(
  caches: NicknameCaches,
  lastPushed: Map<string, MemberMetaRecord>,
  userId: string,
): void {
  caches.memberNicks.delete(userId);
  caches.lastWrittenNick.delete(userId);
  lastPushed.delete(userId);
}

/** What a GUILD_MEMBER_UPDATE should do to the caches, and whether it pushes. */
export interface MemberUpdateDecision {
  /** The member's new role set, or null when the payload carried none. */
  roles: string[] | null;
  /** The member's new raw nick, null when they have none. */
  nick: string | null;
  displayName: string;
  /** False when this update is only our own nickname write coming back. */
  push: boolean;
  /**
   * True when an echo was recognized, meaning the caller must DROP this member's
   * lastWrittenNick entry.
   *
   * One PATCH produces exactly one echo, so the record of it has served its
   * purpose the moment it suppresses that echo. Keeping it lets a later
   * third-party rename BACK to the same value be misread as ours: a moderator
   * renames the member away (a real change, pushed), then back to the value we
   * once wrote, and that second update is dropped even though it is theirs. The
   * roster sweep repairs the record within one interval, because the caller moves
   * the display name whether or not it pushes, so this is stale flair rather than
   * lost flair. Consuming the entry removes the window entirely.
   */
  forgetWrittenNick: boolean;
}

/**
 * Decide what an incoming GUILD_MEMBER_UPDATE means. The caches are read, never
 * written: the caller applies the decision, so the ordering (judge against the
 * OLD cached roles, then move them) cannot be got wrong by accident here.
 *
 * `push` is false only for our own echo. Discord emits one of these for every
 * nickname PATCH the bot makes, and answering it with a members-meta POST is the
 * bot generating load against itself. A third-party change (a role granted, a
 * moderator renaming someone to a value we did not write) is not an echo and
 * still pushes.
 */
export function decideMemberUpdate(
  payload: Record<string, unknown>,
  user: Record<string, unknown>,
  cached: { roles: readonly string[]; lastWrittenNick: string | undefined },
  parse: {
    roles: (payload: Record<string, unknown>) => string[] | null;
    displayName: (payload: Record<string, unknown>, user: Record<string, unknown>) => string;
  },
): MemberUpdateDecision {
  const roles = parse.roles(payload);
  const nick = nickOf(payload);
  const echo = isSelfNickEcho(
    { nick, roleIds: roles ?? cached.roles },
    cached.lastWrittenNick,
    cached.roles,
  );
  return {
    roles,
    nick,
    displayName: parse.displayName(payload, user),
    push: !echo,
    forgetWrittenNick: echo,
  };
}

/** The member's RAW server nickname, or null when they have none set. */
export function nickOf(member: Record<string, unknown>): string | null {
  return typeof member.nick === 'string' ? member.nick : null;
}

/**
 * The name the game shows for a member: their guild nickname, else their Discord
 * display name, else their username. Moved here with the write paths so the value
 * a members-meta record carries is decided in one tested place.
 */
export function displayNameOf(
  member: Record<string, unknown>,
  user: Record<string, unknown>,
): string {
  const nick = typeof member.nick === 'string' ? member.nick : '';
  const global = typeof user.global_name === 'string' ? user.global_name : '';
  const username = typeof user.username === 'string' ? user.username : '';
  return nick || global || username || 'Member';
}
