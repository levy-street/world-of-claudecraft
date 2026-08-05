// Source Cave spec types: the pure, JSON-serializable description of one
// generated cave (module list + placed contributor mobs + reward chest). No
// engine wiring lives here; a later phase consumes this spec to spawn entities,
// and it crosses the server/client wire, so every field stays a plain value.

/** One contributor as fed into the cave generator. */
export interface SourceCaveRosterEntry {
  /** Contributor login (GitHub handle); rides Entity.name verbatim in later phases. */
  login: string;
  /** Merged pull request count; drives the Source Cave contributor tier profile. */
  mergedPrs: number;
  /** 1-based competitive rank within the roster (1 = top contributor = the boss). */
  rank: number;
}

/** Fixed encounter role; intentionally independent from a contributor's live PR tier. */
export type SourceCaveCombatTier =
  | 'unranked'
  | 'tinkerer'
  | 'artificer'
  | 'runesmith'
  | 'architect'
  | 'worldwright';

/** One placed contributor mob in a generated cave. Coordinates are module-local. */
export interface SourceCaveMobSpec {
  login: string;
  mergedPrs: number;
  rank: number;
  /** Mob level from the contributor tier profile. */
  level: number;
  /** Elite when the contributor tier profile or boss overlay marks it elite. */
  elite: boolean;
  /** The single rank-1 contributor is the cave boss, ringed around the arena centre. */
  boss: boolean;
  /** Selected into the fixed damage budget; false is a staged overflow guardian. */
  combatant: boolean;
  /** Fixed power/wave role for a combatant; null for an overflow guardian. */
  combatTier: SourceCaveCombatTier | null;
  /** Always 0: the cave is one arena room (SourceCaveSpec.modules has one entry). */
  moduleIndex: number;
  /** Arena-local x, in a concentric ring around the centre (add the module z-offset for world space). */
  x: number;
  /** Arena-local z, in a concentric ring around the centre (add the module z-offset for world space). */
  z: number;
}

/** A complete, JSON-serializable Source Cave. */
export interface SourceCaveSpec {
  /** Always a single delve module id: the one arena room (source_cave_arena). */
  modules: string[];
  /** Contributor mobs, ringed outward from the reboot button at the arena centre. */
  mobs: SourceCaveMobSpec[];
  /** Reward chest position: the arena's centre dais, where the reboot button starts. */
  chestPos: { x: number; z: number };
}

export type SourceCaveEncounterPhase =
  | 'idle'
  | 'countdown'
  | 'active'
  | 'intermission'
  | 'breached'
  | 'cleared';

/** Runtime-only encounter state stored on the owning InstanceSlot. */
export interface SourceCaveEncounterState {
  phase: SourceCaveEncounterPhase;
  started: boolean;
  breached: boolean;
  cleared: boolean;
  waves: number[][];
  /** Immutable flattened wave ids for hot-path progress and wire reads. */
  combatMobIds: number[];
  /** Visible overflow guardians, distributed across waves for staged retirement. */
  spectatorMobIdsByWave: number[][];
  /** Overflow guardians deliberately pulled before breach; permanent extra combatants. */
  awakenedGuardianMobIds: Set<number>;
  retiredSpectatorWaves: Set<number>;
  activatedWaves: Set<number>;
  activeMobIds: Set<number>;
  /** Player who started the reboot, used as each paced wave's initial target. */
  initialTargetId: number | null;
  nextWaveAt: number | null;
  confirmationPid: number | null;
  confirmationUntil: number;
  wipeResetAt: number | null;
}
