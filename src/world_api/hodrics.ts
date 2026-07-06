// Hodric's Castle Gauntlet facet: the obstacle-race queue, the live race view
// the HUD polls each frame, and the offline practice hook. Implemented by the
// offline Sim (source of truth) and mirrored by the online ClientWorld from
// the `hc` self-snapshot key.

import type { HcKnockKind, PlayerClass } from '../sim/types';

export type { HcKnockKind };

export interface HcStandingView {
  races: number;
  wins: number;
  best: number | null; // fastest personal finish, seconds
}

// One racer's line on the live progress board. Enemies in a race are just
// rivals: everyone's progress is public, that is the fun of it.
export interface HcRacerView {
  name: string;
  cls: PlayerClass;
  bot: boolean;
  you: boolean;
  progress: number; // 0..1 along THIS round's course
  finished: boolean; // crossed this round's line (qualified, or crowned)
  place: number | null; // FINAL match placement 1..N once assigned
  eliminated: boolean; // cut in an earlier round; watching from the gallery
  left: boolean;
}

export interface HcMatchInfo {
  state: 'countdown' | 'active' | 'intermission' | 'over';
  round: number; // 1..rounds
  rounds: number; // the show length (3)
  qualify: number; // how many advance out of THIS round
  courseSeed: number; // this round's generated-course seed (render rebuilds on change)
  countdown: number; // whole seconds left on the plates ('countdown' only)
  clock: number; // elapsed race seconds this round
  timeLeft: number; // seconds until this round's cap ranks the unfinished
  section: string; // course section id under the local racer (HUD label key)
  checkpoint: number; // last banked checkpoint index this round
  finished: boolean;
  place: number | null;
  eliminated: boolean; // you, watching from the gallery
  falls: number;
  racers: HcRacerView[]; // placement-then-progress order
}

export interface HcInfo {
  queued: { position: number } | null;
  standing: HcStandingView | null; // null until the first race is on the books
  match: HcMatchInfo | null;
}

export interface IWorldHodrics {
  hcInfo: HcInfo | null;
  hcQueueJoin(): void;
  hcQueueLeave(): void;
  // Offline practice race against Lord Hodric's court (no-op online).
  hcPracticeStart(): boolean;
}
