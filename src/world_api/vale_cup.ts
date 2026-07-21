// IWorldValeCup: the Vale Cup boarball minigame facet (docs/prd/vale-cup.md).
// Snapshot reads + queue commands. Layer-agnostic: type-only sim imports, no
// t(), no DOM (guarded by tests/architecture.test.ts).
import type { ArenaCombatant, SportRole, VcBracket, VcNationId } from '../sim/types';

// One fighter's line on the team sheet.
export interface VcRosterPlayer {
  pid: number;
  name: string;
  role: SportRole;
  me: boolean;
  bot: boolean;
  ready: boolean; // has readied up in the pre-match briefing
  wins: number; // lifetime cup wins (past form, shown on the betting card); 0 for bots
  losses: number; // lifetime cup losses
  guild: string; // the guild banner this fighter entered under ('' if none / private)
}

// 'briefing' is the pre-match rules screen: fighters are placed and kitted, the
// overlay shows the rules and role kit, and players ready up (bots auto-ready)
// or are auto-readied when the briefing timer expires; then 'countdown'.
export type VcPhase = 'briefing' | 'countdown' | 'active' | 'goal' | 'golden' | 'over';

// The parimutuel spectator pool as one viewer sees it. Odds/percentages are
// derived in the UI from the two pool totals; `my*` reflect the viewer's wager.
export interface VcBetInfo {
  open: boolean; // betting currently accepted (the briefing window)
  poolA: number; // total copper staked on team A
  poolB: number; // total copper staked on team B
  count: number; // distinct bettors
  myStake: number; // the viewer's current stake (0 if none)
  mySide: 'A' | 'B' | null; // the side the viewer backed
}

export interface VcMatchInfo {
  id: number;
  phase: VcPhase;
  // whole seconds: countdown until kickoff, or remaining match/golden time
  countdown: number;
  timeLeft: number;
  golden: boolean;
  scoreA: number;
  scoreB: number;
  nationA: VcNationId;
  nationB: VcNationId;
  // true when both sides picked the same banner and B plays the away palette
  awayPalette: boolean;
  team: 'A' | 'B' | null; // my side (null for the walk-up live view)
  teamA: VcRosterPlayer[];
  teamB: VcRosterPlayer[];
  ballId: number | null; // the ball entity id (position rides the entity wire)
  kickoffTeam: 'A' | 'B';
  holderPid: number | null; // keeper currently gripping the ball, if any
  returnIn?: number; // whole seconds left in the post-match aftermath ('over')
  briefingLeft: number; // whole seconds until auto-ready (present during 'briefing')
  iAmReady: boolean; // I have readied up (drives the briefing button state)
  bets: VcBetInfo; // the live spectator wagering pool
  // World-space offset of this match's pitch from the Sowfield. {0,0} for the one
  // real match; a far offset for a private practice instance, so the renderer can
  // draw the pitch copy where the practicing player actually is.
  origin: { x: number; z: number };
}

// The running match as the persistent indicator / window sees it (realm-wide).
export interface VcLiveMatch {
  id: number;
  bracket: VcBracket;
  clock: number; // whole seconds elapsed since kickoff
  scoreA: number;
  scoreB: number;
  nationA: VcNationId;
  nationB: VcNationId;
}

export interface VcStanding {
  wins: number;
  losses: number;
  draws: number;
}

// A player's lifetime parimutuel betting record (net copper may be negative).
export interface VcBetRecord {
  wins: number;
  losses: number;
  net: number;
}

export interface VcBoardEntry {
  name: string;
  wins: number;
}

// A guild's line on the Vale Cup guild leaderboard (wins/losses earned by its
// members entering under the banner). A live board aggregated from the guild's
// currently-online members, so it reflects who is connected, not a full ledger.
export interface VcGuildBoardEntry {
  name: string;
  wins: number;
  losses: number;
}

export interface CupInfo {
  standing: VcStanding;
  queued: boolean;
  bracket: VcBracket | null; // my queued bracket
  nation: VcNationId | null; // my picked banner
  role: SportRole | null; // my picked role
  position: number; // 1-based queue position within my bracket (0 = not queued)
  queueSizes: Record<VcBracket, number>; // fighters waiting per bracket
  deserterFor: number; // Groundskeeper's lockout seconds remaining (0 = clear)
  match: VcMatchInfo | null; // present while I am in a match
  // Present when I am NOT playing but am standing at the Sowfield with a match on:
  // the walk-up spectator view that drives the betting banner/card. team is null.
  spectate: VcMatchInfo | null;
  betRecord: VcBetRecord; // my lifetime betting record
  live: VcLiveMatch | null; // the stadium's running match, if any
  board: VcBoardEntry[]; // winners board (online top wins), best first
  guildBoard: VcGuildBoardEntry[]; // guild leaderboard (online guilds by cup wins)
  myGuild: string | null; // my guild name, if any (drives the "enter as guild" option)
  guildStanding: { wins: number; losses: number }; // my cup W/L earned under a banner
  // Names of players currently off in a private practice instance (the HUD shows
  // this in the Sowfield region, since their bodies are not on the physical pitch).
  practicing: string[];
}

export interface IWorldValeCup {
  // null = online mirror not yet synced
  cupInfo: CupInfo | null;
  // enterAsGuild flies your guild banner: guild members entering this way credit
  // their guild's Vale Cup leaderboard on a rated result (no-op if you have no
  // guild). Solo or party (leader queues); the party may be mixed-guild.
  vcupQueueJoin(
    bracket: VcBracket,
    nation: VcNationId,
    role: SportRole,
    enterAsGuild: boolean,
  ): void;
  vcupQueueLeave(): void;
  // change the picked role/banner while waiting in the queue
  vcupSetRole(role: SportRole): void;
  // Ready up during the pre-match briefing (auto-ready fires at the timer).
  vcupReady(): void;
  // Place (or top up) a parimutuel wager on a side during the briefing window.
  // Spectators only, standing at the Sowfield; amount is copper.
  vcupBet(side: 'A' | 'B', amount: number): void;
  // Start a PRIVATE practice bout against bots on an instanced pitch copy, in
  // parallel with the real match and other practices (works online and off).
  vcupPracticeStart(bracket: VcBracket): void;
}

export type { ArenaCombatant };
