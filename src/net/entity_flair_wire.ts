// Wire decode for a full identity record's "flair" fields: the cosmetic
// status badges the server stamps onto a player entity ($WOC holder tier,
// linked-Discord status, the developer badge, Curator standing, the
// AI-operated account mark plus a streamer's platform links, and the
// operator-applied Cheater tag). None of this carries gameplay weight; the
// sim never reads any of it (src/sim/types.ts, the Entity flair fields).
// Kept as its own DOM-free, ClientWorld-free module so the decode is
// unit-testable without a socket, and so online.ts stays a consumer rather
// than growing another decode block (the wire-decode sibling idiom,
// src/net/CLAUDE.md).
//
// Defensive by construction, the online.ts decode idiom: every field is
// re-validated, matching the exact per-field checks applySnapshot used
// inline before this extraction.

import { hasStreamerLink, normalizeStreamerLinks, type StreamerLinks } from '../sim/account_flair';
import { RELIQUARY_OBTAIN_COUNT_CAP } from '../sim/reliquary';

export interface EntityFlairWire {
  holderTier: number;
  holderBalance: number | undefined;
  discordTier: number;
  discordAvatar: string | undefined;
  discordName: string | undefined;
  discordJoined: number | undefined;
  discordRole: string | undefined;
  devTier: number;
  devMergedPrs: number | undefined;
  githubLogin: string | undefined;
  curatorRank: number;
  relicsOwned: number | undefined;
  relicsTotal: number | undefined;
  aiAccount: boolean;
  streamerLinks: StreamerLinks | undefined;
  cheaterMark: boolean;
}

/** Curator/relic counts (`crk`/`cro`/`crt`): the server only stamps counts of
 *  one and up, so a zero, negative, non-finite, or non-number value reads as
 *  absent, and a huge one clamps to the sim's obtain-count ceiling, so a
 *  misbehaving server can degrade a badge but never print a runaway digit
 *  string. Deliberately NO upper clamp to today's rank ladder: a newer
 *  server's rank 6 must keep reading as at-least-rank-5 on this client (the
 *  crt mixed-version rule). */
function wireCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const n = Math.floor(value);
  return n > 0 ? Math.min(n, RELIQUARY_OBTAIN_COUNT_CAP) : undefined;
}

/** Decode one full identity record's flair fields. `w` is the raw terse wire
 *  object (untyped by contract: every consumer re-validates before it renders
 *  a value, since a streamer link ends up in a `window.open`). */
export function decodeEntityFlairWire(w: Record<string, unknown>): EntityFlairWire {
  const streamerLinks = normalizeStreamerLinks(w.slk);
  return {
    holderTier: (w.ht as number | undefined) ?? 0,
    holderBalance: typeof w.hb === 'number' ? w.hb : undefined,
    discordTier: (w.dt as number | undefined) ?? 0,
    discordAvatar: typeof w.dav === 'string' ? w.dav : undefined,
    discordName: typeof w.dnm === 'string' ? w.dnm : undefined,
    discordJoined: typeof w.dj === 'number' ? w.dj : undefined,
    discordRole: typeof w.dr === 'string' ? w.dr : undefined,
    devTier: (w.dvt as number | undefined) ?? 0,
    devMergedPrs: typeof w.dvc === 'number' ? w.dvc : undefined,
    githubLogin: typeof w.dgl === 'string' ? w.dgl : undefined,
    curatorRank: wireCount(w.crk) ?? 0,
    relicsOwned: wireCount(w.cro),
    relicsTotal: wireCount(w.crt),
    aiAccount: w.ai === 1,
    streamerLinks: hasStreamerLink(streamerLinks) ? streamerLinks : undefined,
    cheaterMark: w.chm === 1,
  };
}
