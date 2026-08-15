// The role-sync sweep cycle: one paced flex-batch slice per run, and what each
// answered member gets (the tier-role diff, the level-on-name nickname, the
// diff-guarded meta follow-up).
//
// Extracted from bot/main.ts so the composed-behavior suite
// (tests/discord_bot_sweep_cycle.test.ts) drives the PRODUCTION unit instead of
// a hand-kept mirror: main.ts calls main() at module scope, so nothing declared
// inside it is reachable from a test, and the D5/D6 properties this loop
// carries (zero writes on an unchanged pass, linked-set-only asks, one slice of
// writes per tick) are exactly the incident class the packet exists to prevent.
// main.ts binds the deps (config values, the guild-scoped Discord writes, the
// live guild-state maps) and registers the task; it decides nothing.

import type { LinkedSweep } from './linked_sweep';
import { buildLevelNick, computeRoleSync, type FlexData } from './logic';
import { type NicknameCaches, writeMemberNickname } from './member_writes';
import type { FlexBatchResult } from './server_client';

/** The three guild-member writes the cycle issues, guild id already bound. */
export interface SweepDiscordWrites {
  addMemberRole: (userId: string, roleId: string) => Promise<unknown>;
  removeMemberRole: (userId: string, roleId: string) => Promise<unknown>;
  setNickname: (userId: string, nick: string) => Promise<unknown>;
}

export interface SweepCycleDeps {
  linkedSweep: LinkedSweep;
  /** Wall clock; injected so the suite drives the cycle on a synthetic one. */
  now: () => number;
  /** cfg.sweepSliceSize: how many members one slice may write to. */
  sliceSize: number;
  /** cfg.roleSyncIntervalMs: the pass window nextSlice paces against. */
  passIntervalMs: number;
  /** cfg.syncNicknames: the level-on-name nickname sync opt-out. */
  syncNicknames: boolean;
  /**
   * LIVE views of main.ts guild state, shared by reference: the gateway
   * handlers keep writing them while the cycle reads them, and the role loops
   * below write memberRoles back so a later diff sees the applied change.
   */
  tierRoleIds: ReadonlyMap<number, string>;
  memberRoles: Map<string, string[]>;
  nickCaches: NicknameCaches;
  /** The members-meta diff cache; the cycle only ever evicts from it. */
  lastPushedMeta: { delete(id: string): boolean };
  discord: SweepDiscordWrites;
  /** One flex-batch ask; null (or undefined) is ServerClient's failure shape. */
  flexBatch: (ids: readonly string[]) => Promise<FlexBatchResult | null | undefined>;
  /** The diff-guarded single-member meta push (main.ts pushMemberMeta). */
  pushMemberMeta: (userId: string) => Promise<void>;
  /** Dev-channel error sink; production binds console.error. */
  onError: (message: string, error: unknown) => void;
}

export interface SweepCycle {
  syncRolesFor: (userId: string, flex: FlexData & { linked: boolean }) => Promise<void>;
  runSweepSlice: () => Promise<boolean>;
}

export function createSweepCycle(deps: SweepCycleDeps): SweepCycle {
  // The flex payload arrives as an ARGUMENT rather than being fetched here. It
  // used to be one GET per member per sweep, which at a thousand concurrent
  // players was a thousand uncached server reads every five minutes; the sweep
  // below asks about a whole slice in one flex-batch request instead. What this
  // function does with the payload is unchanged.
  const syncRolesFor = async (
    userId: string,
    flex: FlexData & { linked: boolean },
  ): Promise<void> => {
    if (!flex.linked) return;
    const { toAdd, toRemove } =
      deps.tierRoleIds.size > 0
        ? computeRoleSync({
            tier: flex.statusTier,
            memberRoleIds: deps.memberRoles.get(userId) ?? [],
            tierRoleIds: deps.tierRoleIds,
          })
        : { toAdd: [] as string[], toRemove: [] as string[] };
    // Only update the cached role set when the Discord API call actually
    // succeeds, so a failed add/remove is retried on the next sync (not masked
    // by a cache that wrongly claims success).
    for (const roleId of toAdd) {
      try {
        await deps.discord.addMemberRole(userId, roleId);
        deps.memberRoles.set(userId, [...(deps.memberRoles.get(userId) ?? []), roleId]);
      } catch (e) {
        deps.onError('[bot] addMemberRole failed', e);
      }
    }
    for (const roleId of toRemove) {
      try {
        await deps.discord.removeMemberRole(userId, roleId);
        deps.memberRoles.set(
          userId,
          (deps.memberRoles.get(userId) ?? []).filter((r) => r !== roleId),
        );
      } catch (e) {
        deps.onError('[bot] removeMemberRole failed', e);
      }
    }
    // Attach the in-game level + class icon to the member's Discord nickname.
    // The base name fallback can be the member's already-suffixed live nick
    // (flex.username is null for older links), so buildLevelNick strips any
    // existing suffix first to stay idempotent across re-syncs.
    if (deps.syncNicknames && flex.character) {
      const base = flex.username ?? deps.nickCaches.memberNames.get(userId) ?? 'Member';
      const nick = buildLevelNick(base, flex.character.level, flex.character.class);
      // D5: only PATCH when the computed nick actually differs from the nick we
      // last observed. This is the incident's biggest single source of load: the
      // write was unconditional, so every linked online member was PATCHed every
      // sweep forever, and each PATCH made Discord emit a GUILD_MEMBER_UPDATE that
      // the update handler turned into a members-meta POST back into the game.
      const outcome = await writeMemberNickname(userId, nick, deps.nickCaches, {
        setNickname: (id, value) => deps.discord.setNickname(id, value),
        onError: (e) => deps.onError('[bot] setNickname failed', e),
      });
      // A successful rename has to reach the game NOW, not on the next sweep.
      // The name in a members-meta record is player-visible: the server stores it
      // and emits it as the in-world Discord nameplate. Before the echo was
      // suppressed, Discord's own GUILD_MEMBER_UPDATE was what carried it, within
      // seconds; suppressing that without replacing it would leave the nameplate
      // showing the old level for up to a whole role-sync interval.
      // It cannot re-open the echo loop: this push is diff-guarded, so it happens
      // exactly once, and the echo that follows finds the record already pushed.
      if (outcome === 'written') await deps.pushMemberMeta(userId);
    }
  };

  /**
   * ONE slice of the sweep, which is what the role-sync task runs.
   *
   * The sweep this replaces did the whole population in a single run: it walked
   * every online member, spent one server read each, and queued whatever Discord
   * writes came out of them all at once. That is the shape that turned a slow
   * minute into a storm, because the burst lands on the rate governor's queues
   * faster than they drain and every later run piles onto the same queues.
   * Handing back one bounded slice per run turns the same work into a spread:
   * linked_sweep decides WHICH members, the scheduler decides WHEN, and neither
   * needs to know about the other.
   *
   * Returns whether it did work, which is the scheduler's didWork signal: a
   * slice snaps the cadence back to the slice interval so the rest of the pass
   * follows promptly, and an empty run decays it toward the full sweep interval
   * so an idle bot is not paying for a wake every three seconds.
   */
  const runSweepSlice = async (): Promise<boolean> => {
    const slice = deps.linkedSweep.nextSlice(deps.now(), deps.sliceSize, deps.passIntervalMs);
    if (slice === null) return false;
    const result = await deps.flexBatch(slice.ids);
    if (result == null) {
      // server_client answers null for a failed call rather than throwing, so
      // this is the only failure signal there is (`== null` because a success
      // envelope with no data field resolves to undefined, which observed
      // nothing either). Nothing was observed, so no belief may move: the
      // slice goes back to be re-served, and the run counts as empty so the
      // cadence backs off instead of retrying every three seconds against a
      // server that is already refusing.
      deps.linkedSweep.restoreSlice(slice);
      return false;
    }
    // The roster gate keeps a stale answer from re-adding a member a departure
    // or the seed prune removed while this request was in flight.
    const outcome = deps.linkedSweep.applyFlexBatchResult(slice.ids, result, (id) =>
      deps.memberRoles.has(id),
    );
    // A member whose link row is new has meta the bot believes it already
    // pushed, attached to a row that no longer exists. Dropping the cached
    // record BEFORE syncing them is what lets the nickname write's own push
    // through; leaving it would suppress their join date and staff flair until
    // the hourly resync.
    for (const id of outcome.metaStale) deps.lastPushedMeta.delete(id);
    const asked = new Set(slice.ids);
    for (const member of result.members) {
      // Only ids this slice actually asked about AND still in the guild: the
      // sweep's writes are driven by the answer, an answer carrying an id
      // nobody asked for must not be able to aim a role write at an arbitrary
      // guild member, and a member who departed while the slice was in flight
      // must not get one last doomed 404 pass (their re-add is already gated
      // on the same roster).
      if (!asked.has(member.discord_user_id) || !deps.memberRoles.has(member.discord_user_id)) {
        continue;
      }
      try {
        await syncRolesFor(member.discord_user_id, member);
      } catch (e) {
        // Per member, so one refusal (a governor-blocked write, an open breaker)
        // costs that member's turn and not the rest of the slice. Their caches
        // are left untouched by the write paths, so the next pass retries them.
        deps.onError(`[bot] sweep sync failed for ${member.discord_user_id}`, e);
      }
    }
    return true;
  };

  return { syncRolesFor, runSweepSlice };
}
