import type { HcKnockKind, PlayerClass } from '../sim/types';

export type { HcKnockKind };

export interface HcStandingView { races: number; wins: number; best: number | null; }
export interface HcRacerView { name: string; cls: PlayerClass; bot: boolean; you: boolean; progress: number; finished: boolean; place: number | null; left: boolean; }
export interface HcMatchInfo { state: 'countdown' | 'active' | 'over'; countdown: number; clock: number; timeLeft: number; section: string; checkpoint: number; finished: boolean; place: number | null; falls: number; racers: HcRacerView[]; }
export interface HcInfo { queued: { position: number } | null; standing: HcStandingView | null; match: HcMatchInfo | null; }
export interface IWorldHodrics { hcInfo: HcInfo | null; hcQueueJoin(): void; hcQueueLeave(): void; hcPracticeStart(): boolean; }
