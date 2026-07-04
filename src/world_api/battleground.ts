// IWorldBattleground: the 5v5 Gravemarch battleground facet
// (docs/prd/battlegrounds.md). Snapshot reads + queue/spectate commands.
// Like every world_api facet this file is layer-agnostic: type-only sim
// imports, no t(), no DOM (guarded by tests/architecture.test.ts).
import type { ArenaCombatant, PlayerClass } from '../sim/types';

export type BgTeamId = 'A' | 'B';

// One fighter's line on the match scoreboard.
export interface BgScoreboardPlayer {
  pid: number;
  name: string;
  cls: PlayerClass;
  kills: number;
  deaths: number;
  down: boolean; // currently benched, awaiting respawn
  respawnIn: number; // whole seconds until they revive (0 if alive)
  me: boolean;
  bot: boolean;
}

// A Bulwark or Warstone as the HUD/map sees it. Coordinates are WORLD
// coordinates (the match's slot origin plus the layout position) so painters
// and the renderer can use them directly.
export interface BgStructureView {
  id: string;
  team: BgTeamId;
  kind: 'warstone' | 'bulwark';
  lane: 'west' | 'east' | null;
  tier: 'outer' | 'inner' | null;
  x: number;
  z: number;
  hpFrac: number; // 0..1 (0 when destroyed)
  alive: boolean;
  // true while structural protection applies (outer bulwark still standing, or
  // warstone with no opened lane): the structure cannot be damaged yet
  shielded: boolean;
}

export interface BgKnellView {
  alive: boolean;
  spawnsIn: number; // whole seconds until it (re)appears (0 when up)
  x: number;
  z: number;
}

// A teammate's live position for the schematic map (own team only; enemies are
// never leaked here: you see enemy champions only through normal snapshots).
export interface BgAllyPosition {
  pid: number;
  x: number;
  z: number;
}

export interface BgMatchInfo {
  id: number;
  state: 'countdown' | 'active' | 'over';
  countdown: number; // whole seconds until the fight starts (0 once active)
  timeLeft: number; // whole seconds until the match cap resolves it
  team: BgTeamId; // my team: 'A' = Ember Company (south), 'B' = Pale Company (north)
  killsA: number;
  killsB: number;
  structures: BgStructureView[];
  knell: BgKnellView;
  // 'X' silenced the Knell: that team's next waves march empowered (seconds left)
  knellSilencedBy: BgTeamId | null;
  knellSilencedFor: number;
  teamA: BgScoreboardPlayer[];
  teamB: BgScoreboardPlayer[];
  down: boolean; // am I currently benched, awaiting respawn
  respawnIn: number; // whole seconds until I revive (0 if alive)
  allies: BgAllyPosition[];
  // the match's slot origin, so painters can map world coords to the map sheet
  origin: { x: number; z: number };
  rated: boolean; // false when bots backfilled the teams
  returnIn?: number; // whole seconds left in the post-match aftermath ('over')
  outcome?: 'win' | 'loss' | 'draw'; // present during 'over', my perspective
}

// A running match, for the HUD indicator and the window's Watch list.
export interface BgLiveMatch {
  id: number;
  elapsed: number; // whole seconds since the fight started
  killsA: number;
  killsB: number;
  structuresDownA: number; // team A structures destroyed (by team B)
  structuresDownB: number;
  players: number; // human fighters still connected
}

export interface BgLadderEntry {
  pid: number;
  name: string;
  cls: PlayerClass;
  rating: number;
  wins: number;
  losses: number;
}

export interface BgStanding {
  rating: number;
  wins: number;
  losses: number;
}

export interface BgInfo {
  standing: BgStanding;
  queued: boolean;
  queueSize: number; // fighters waiting realm-wide (self included while queued)
  position: number; // my queue position (1-based; 0 when not queued)
  waitSec: number; // whole seconds I have been waiting (0 when not queued)
  deserterFor: number; // Deserter's Knell seconds remaining (0 = may queue)
  match: BgMatchInfo | null; // present only while in a match
  liveMatches: BgLiveMatch[]; // running matches on this realm, for spectating
  ladder: BgLadderEntry[]; // live standings of rated players online, best first
  spectating: number | null; // match id I am watching, if any
}

export interface IWorldBattleground {
  // null = offline world not applicable / online mirror not yet synced
  bgInfo: BgInfo | null;
  bgQueueJoin(): void;
  bgQueueLeave(): void;
  bgSpectate(matchId: number): void;
  bgSpectateNext(): void;
  bgSpectateLeave(): void;
  // Offline practice bout against and alongside scripted bots (fiesta-practice
  // precedent). The online world implements this as a no-op.
  bgPracticeStart(): void;
}

// Re-export the shared combatant shape battleground events reuse.
export type { ArenaCombatant };
