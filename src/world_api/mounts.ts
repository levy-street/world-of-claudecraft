import type { CourseRunState } from '../sim/types';

// One ranked row of a Skytrial time-trial leaderboard (realm-scoped, fastest
// first). Computed server-side from mount_trial_records; the client only displays.
export interface MountTrialLeaderEntry {
  rank: number;
  name: string;
  cls: string;
  level: number;
  ticks: number; // best run, integer sim ticks (÷20 = seconds)
}

// Live multi-racer (party) race state for the local player, polled by the HUD.
export interface RaceParticipant {
  pid: number;
  name: string;
  gate: number; // gates cleared so far
  total: number; // total gates in the run (checkpoints × laps)
  place: number; // finishing place once done (0 = still racing)
  done: boolean;
  dnf: boolean; // dropped out (left their mount / quit)
  me: boolean;
}
export interface RaceInfo {
  raceId: number;
  courseId: string;
  state: 'countdown' | 'active' | 'done';
  countdown: number; // whole seconds until GO (0 once racing)
  participants: RaceParticipant[]; // sorted: leaders/finishers first
}

export interface WagerMember {
  pid: number;
  name: string;
}
// Live state of the soft-currency wager lobby the player is in. The pot is
// uniform-ante × member count; `launched` flips when the race is staged (the HUD
// then hands off to RaceInfo). `anteCharterId` is a charter_<mountId> item or null.
export interface WagerInfo {
  lobbyId: number;
  hostPid: number;
  isHost: boolean;
  courseId: string;
  anteCopper: number;
  anteCharterId: string | null;
  launched: boolean;
  potCopper: number;
  potCharters: number;
  members: WagerMember[];
}

export interface IWorldMounts {
  // $WOC holder travel mounts. Eligibility (`player.mountTier`, 0-11) and the
  // active steed (`player.mountId`) are read directly off the player Entity —
  // both are server-set and ride the wire like `skin`/`holderTier`. `mountCast`
  // is the in-progress summon (off-entity, session/self-only) for the cast bar.
  // summonMount begins the cast (or instantly swaps while already mounted);
  // dismissMount throws you off. The server re-validates every summon against the
  // wallet's live balance, so a client cannot ride a mount it doesn't hold.
  mountCast: { id: string; remaining: number; total: number } | null;
  summonMount(mountId: string): void;
  dismissMount(): void;
  // Mount-activity course runs (hoop / time-trial / race). `courseRun` is the
  // server-authoritative in-progress run (null when idle); the HUD draws the
  // timer/gate overlay from it. startCourse begins one (server gates flyer-only
  // + eligibility); abortCourse bails.
  courseRun: CourseRunState | null;
  startCourse(courseId: string): void;
  abortCourse(): void;
  // Skytrial best times. `mountTrialBests` is this character's best run per course
  // (ticks), for the launcher + "new best" feedback; the realm leaderboard is
  // fetched on demand (server-computed from mount_trial_records).
  mountTrialBests: Record<string, number>;
  mountTrialLeaderboard(trackId: string): Promise<MountTrialLeaderEntry[]>;
  // Multi-racer races: the leader starts one for their party (or solo); placement
  // is by finish order on a synchronized countdown→GO. `raceInfo` is the live
  // state for the HUD panel (null when not in a race).
  raceInfo: RaceInfo | null;
  startRace(courseId: string): void;
  // Mount Charters — the earned (non-$WOC) ownership track. `earnedMounts` are
  // mount ids permanently owned via a redeemed Charter (summonable regardless of
  // holdings); `mintCharter` strikes a tradeable deed for a mount the wallet
  // currently covers. Redeeming a Charter goes through the normal useItem path.
  earnedMounts: string[];
  mintCharter(mountId: string): void;
  // Soft-currency Wager Races — stake in-game gold (+ an optional Mount Charter)
  // on a PvP race; winner takes the pot. `wagerInfo` is the live lobby/pot state
  // (null when not in a wager). `proposeWagerRace` opens a staked lobby (charges
  // the host); others `wagerJoin`/`wagerDecline` an invite (join is the only point
  // they pay); the host `launchWagerRace`s once ≥2 have staked; anyone can
  // `wagerLeave` before launch (refunded). NO real money / $WOC.
  wagerInfo: WagerInfo | null;
  proposeWagerRace(courseId: string, anteCopper: number, anteCharterId: string | null): void;
  wagerJoin(): void;
  wagerDecline(): void;
  wagerLeave(): void;
  launchWagerRace(): void;
}
