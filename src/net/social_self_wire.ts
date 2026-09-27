// The social / PvP / market / mail cohort of the snapshot self record: the
// delta-omitted readouts ClientWorld mirrors for IWorldTrade, IWorldDuelArena,
// IWorldBattleground, IWorldDungeonFinder, IWorldCardMinigame, IWorldMarket,
// IWorldMail and IWorldWorldPvp. Every key here is delta-omitted (server
// selfWireJson `maybe(...)`): an ABSENT key means UNCHANGED and keeps the prior
// mirror, so omission never wipes an open window; an explicit null is each
// key's own "nothing" (no trade, no duel, no queue). Valid records are adopted
// BY REFERENCE, exactly as the inline decode did before the move (the
// bank_snapshot_wire.ts convention).
//
// Moved out of ClientWorld.applySnapshot (the monolith ratchet: extract, then
// lower) so a new self readout lands here, not as another inline line in
// online.ts. IWorldSocialGraph.socialInfo has NO snapshot key: it is set only
// by the social/socialpos frames and is deliberately not part of this cohort.

import type {
  ArenaInfo,
  BgInfo,
  CardMinigameInfo,
  DuelInfo,
  DungeonFinderBoard,
  DungeonFinderInfo,
  HillInfo,
  MailInfo,
  MarketInfo,
  TradeInfo,
  WorldPvpInfo,
} from '../world_api';

/** The mirrors this cohort writes; the concrete ClientWorld satisfies it
 *  structurally. */
export interface SocialSelfMirrors {
  tradeInfo: TradeInfo | null;
  duelInfo: DuelInfo | null;
  arenaInfo: ArenaInfo | null;
  bgInfo: BgInfo | null;
  dungeonFinderInfo: DungeonFinderInfo | null;
  dungeonFinderBoard: DungeonFinderBoard | null;
  cardMinigameInfo: CardMinigameInfo;
  honor: number;
  lifetimeHonor: number;
  marketInfo: MarketInfo | null;
  marketCollectPending: boolean;
  mailInfo: MailInfo | null;
  mailUnread: number;
  worldPvpInfo: WorldPvpInfo | null;
  hillInfo: HillInfo | null;
}

/** The self-record keys this cohort reads (the server's terse names). */
export interface SocialSelfRecord {
  trade?: unknown;
  duel?: unknown;
  arena?: unknown;
  bg?: unknown;
  df?: unknown;
  dfb?: unknown;
  cardDuel?: unknown;
  honor?: unknown;
  lhonor?: unknown;
  market?: unknown;
  mktU?: unknown;
  mail?: unknown;
  mailU?: unknown;
  wpvp?: unknown;
  hill?: unknown;
}

const numberOrZero = (v: unknown): number => (typeof v === 'number' ? v : 0);

export function applySocialSelfWire(target: SocialSelfMirrors, s: SocialSelfRecord): void {
  if (s.trade !== undefined) target.tradeInfo = s.trade as TradeInfo | null;
  if (s.duel !== undefined) target.duelInfo = s.duel as DuelInfo | null;
  if (s.arena !== undefined) target.arenaInfo = s.arena as ArenaInfo | null;
  if (s.bg !== undefined) target.bgInfo = s.bg as BgInfo | null;
  if (s.df !== undefined) target.dungeonFinderInfo = s.df as DungeonFinderInfo | null;
  if (s.dfb !== undefined) target.dungeonFinderBoard = s.dfb as DungeonFinderBoard | null;
  if (s.cardDuel !== undefined) target.cardMinigameInfo = s.cardDuel as CardMinigameInfo;
  if (s.honor !== undefined) target.honor = numberOrZero(s.honor);
  if (s.lhonor !== undefined) target.lifetimeHonor = numberOrZero(s.lhonor);
  if (s.market !== undefined) target.marketInfo = s.market as MarketInfo | null;
  if (s.mktU !== undefined) target.marketCollectPending = !!s.mktU;
  if (s.mail !== undefined) target.mailInfo = s.mail as MailInfo | null;
  if (s.mailU !== undefined) target.mailUnread = numberOrZero(s.mailU);
  // World PvP (/pvp): the flag readout the World PvP tab paints. Same delta
  // contract; null before the server has answered for this character.
  if (s.wpvp !== undefined) target.worldPvpInfo = s.wpvp as WorldPvpInfo | null;
  // King of the Hill: the standing hill from this viewer's seat. Same delta
  // contract; null while no hill stands.
  if (s.hill !== undefined) target.hillInfo = s.hill as HillInfo | null;
}
