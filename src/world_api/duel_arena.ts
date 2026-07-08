import type { ArenaCombatant, ArenaFormat, ArenaStanding, PlayerClass } from '../sim/types';

export interface DuelInfo {
  otherPid: number;
  otherName: string;
  state: 'countdown' | 'active';
}

export interface ArenaLadderEntry {
  pid: number;
  name: string;
  cls: PlayerClass;
  rating: number;
  wins: number;
  losses: number;
}

// Live 2v2 Fiesta state for the local player, polled by the HUD each frame.
export interface FiestaAugmentOffer {
  tier: 'silver' | 'gold' | 'prismatic';
  wave: number;
  choices: string[]; // augment ids; localized + described client-side
}
// One combatant's line on the scoreboard.
export interface FiestaScoreboardPlayer {
  pid: number;
  name: string;
  cls: PlayerClass;
  kills: number;
  down: boolean; // currently benched, awaiting respawn
  me: boolean;
}

// A ring power-up as the renderer/HUD sees it.
export interface FiestaPowerupView {
  id: number;
  defId: string; // POWERUPS id (localized client-side)
  x: number;
  z: number;
  state: 'spawning' | 'ready';
  frac: number; // spawning: telegraph progress 0..1; ready: lifetime remaining 0..1
  color: number; // orb/telegraph colour (hex)
}

export interface FiestaMatchInfo {
  team: 'A' | 'B';
  scoreA: number;
  scoreB: number;
  myScore: number; // my team's tally
  theirScore: number;
  scoreLimit: number;
  wave: number;
  totalWaves: number;
  // hazard ring, in WORLD coordinates so the renderer can draw it directly
  ring: { cx: number; cz: number; radius: number };
  down: boolean; // am I currently benched, awaiting respawn
  respawnIn: number; // whole seconds until I revive (0 if alive)
  augments: string[]; // augment ids I have locked in this bout
  offer: FiestaAugmentOffer | null; // a pending pick, if any
  augmentPending: number; // queued offers awaiting my next death (indicator)
  teamA: FiestaScoreboardPlayer[];
  teamB: FiestaScoreboardPlayer[];
  powerups: FiestaPowerupView[];
}

// One live Yumi cat as the renderer/HUD sees it. BOTH cats are always present
// on YumiMatchInfo (graphics-fairness invariant: enemy objective HP is
// actionable info, never hidden or delayed by any tier).
export interface YumiView {
  entityId: number;
  hp: number;
  maxHp: number;
  // world coordinates (beacon anchor + map marker even outside interest range)
  x: number;
  z: number;
  alive: boolean;
}

// One combatant's line on the Protect Yumi scoreboard.
export interface YumiScoreboardPlayer {
  pid: number;
  name: string;
  cls: PlayerClass;
  kills: number;
  deaths: number;
  down: boolean; // currently benched, awaiting respawn
  me: boolean;
}

// Live Protect Yumi state for the local player, polled by the HUD each frame.
// Offline the Sim builds it per frame; online ClientWorld folds the 1/s
// yumiStatus heartbeat + teleport events into its mirrored copy (the arena
// wire field alone is rate-limited and the enemy cat can leave interest range).
export interface YumiMatchInfo {
  team: 'A' | 'B'; // my team (A = blue, B = red)
  size: 3 | 5;
  phase: 'countdown' | 'active' | 'sudden' | 'over';
  matchElapsed: number; // whole seconds since GO (0 during countdown)
  teleportIn: number; // whole seconds until the next simultaneous teleport (0 once frozen)
  suddenDeathIn: number; // whole seconds until sudden death (0 once latched)
  damageTakenMult: number; // current cat damage-taken multiplier (1 before sudden death)
  down: boolean; // am I currently benched
  respawnIn: number; // whole seconds until I revive (0 if alive)
  yumiA: YumiView;
  yumiB: YumiView;
  teamA: YumiScoreboardPlayer[];
  teamB: YumiScoreboardPlayer[];
}

export interface ArenaInfo {
  // Backwards-compatible view of the currently selected/queued/matched bracket.
  rating: number;
  wins: number;
  losses: number;
  standings: Record<ArenaFormat, ArenaStanding>;
  format: ArenaFormat | null;
  queued: boolean;
  queueSize: number;
  // present only while in a match
  match: {
    format: ArenaFormat;
    state: 'countdown' | 'active' | 'over';
    oppName: string;
    oppClass: PlayerClass;
    oppLevel: number;
    oppPid: number;
    allies: ArenaCombatant[];
    enemies: ArenaCombatant[];
    returnIn?: number; // whole seconds left in the post-bout aftermath ('over')
    // present only for the 2v2 Fiesta party mode
    fiesta?: FiestaMatchInfo;
    // present only for the Protect Yumi brackets (yumi3/yumi5)
    yumi?: YumiMatchInfo;
  } | null;
  // Backwards-compatible live ladder for the currently selected bracket.
  ladder: ArenaLadderEntry[];
  // live standings of rated players currently online, best first, by bracket
  ladders: Record<ArenaFormat, ArenaLadderEntry[]>;
}

export interface IWorldDuelArena {
  duelInfo: DuelInfo | null;
  duelRequest(targetPid: number): void;
  duelAccept(): void;
  duelDecline(): void;
  arenaInfo: ArenaInfo | null;
  arenaQueueJoin(format?: ArenaFormat): void;
  arenaQueueLeave(): void;
  // 2v2 Fiesta: lock in one of the augments currently on offer
  arenaAugmentPick(augmentId: string): void;
}
