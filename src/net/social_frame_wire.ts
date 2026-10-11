// Wire decode for the `social` frame's mirror shape, extracted from online.ts
// so the version-skew normalization is a pure, unit-testable table and the
// coordinator stays a one-line consumer.
//
// The pledge-board fields are normalized with defaults so an older server's
// frame (no pledge board) still yields a fully-shaped mirror: settings read as
// accepting (the feature's default), no open pledges, tier 0, no standing
// pledge. The friend/block/ignore lists default to empty for the same reason.
import type { SocialInfo } from '../world_api';
import { decodeGuildPledgeSettings } from './guild_board_wire';

/** The `social` frame as it arrives (loosely typed at the trust boundary). */
export interface SocialFrameLike {
  friends?: SocialInfo['friends'];
  friendsCursor?: unknown;
  friendsNextCursor?: unknown;
  blocks?: SocialInfo['blocks'];
  blocksCursor?: unknown;
  blocksNextCursor?: unknown;
  blocksUnavailable?: unknown;
  ignores?: SocialInfo['ignores'];
  guild?:
    | (Omit<NonNullable<SocialInfo['guild']>, 'pledgeSettings' | 'pledges' | 'tier'> &
        Partial<Pick<NonNullable<SocialInfo['guild']>, 'pledgeSettings' | 'pledges' | 'tier'>>)
    | null;
  myPledge?: SocialInfo['myPledge'];
}

export function socialInfoFromFrame(msg: SocialFrameLike): SocialInfo {
  const guild = msg.guild
    ? {
        ...msg.guild,
        pledgeSettings: decodeGuildPledgeSettings(msg.guild.pledgeSettings),
        pledges: msg.guild.pledges ?? [],
        tier: msg.guild.tier ?? 0,
      }
    : null;
  return {
    friends: msg.friends ?? [],
    ...(Number.isSafeInteger(msg.friendsCursor) && (msg.friendsCursor as number) >= 0
      ? { friendsCursor: msg.friendsCursor as number }
      : {}),
    ...(Number.isSafeInteger(msg.friendsNextCursor) && (msg.friendsNextCursor as number) > 0
      ? { friendsNextCursor: msg.friendsNextCursor as number }
      : {}),
    blocks: msg.blocks ?? [],
    ...(Number.isSafeInteger(msg.blocksCursor) && (msg.blocksCursor as number) >= 0
      ? { blocksCursor: msg.blocksCursor as number }
      : {}),
    ...(Number.isSafeInteger(msg.blocksNextCursor) && (msg.blocksNextCursor as number) > 0
      ? { blocksNextCursor: msg.blocksNextCursor as number }
      : {}),
    ...(typeof msg.blocksUnavailable === 'boolean'
      ? { blocksUnavailable: msg.blocksUnavailable }
      : {}),
    ignores: msg.ignores ?? [],
    guild,
    myPledge: msg.myPledge ?? null,
  };
}

/** Updates only the already-known page; position messages never add friends. */
export function applySocialPositions(social: SocialInfo | null, list: unknown): void {
  if (!social || !Array.isArray(list)) return;
  const byId = new Map<
    number,
    {
      x: number;
      z: number;
      zone: string;
      status: import('../world_api').PresenceStatus;
      title?: string | null;
    }
  >();
  for (const row of list) {
    if (
      !row ||
      typeof row !== 'object' ||
      !Number.isSafeInteger(row.id) ||
      !Number.isFinite(row.x) ||
      !Number.isFinite(row.z) ||
      typeof row.zone !== 'string' ||
      !['online', 'combat', 'dungeon', 'dead', 'afk'].includes(row.status)
    )
      continue;
    byId.set(row.id, row);
  }
  for (const member of [...social.friends, ...(social.guild?.members ?? [])]) {
    const update = byId.get(member.id);
    if (!update) continue;
    member.x = update.x;
    member.z = update.z;
    member.zone = update.zone;
    member.status = update.status;
    member.online = true;
    if (update.title === null || typeof update.title === 'string')
      member.activeTitle = update.title;
  }
}
