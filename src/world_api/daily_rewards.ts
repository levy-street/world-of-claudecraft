export interface DailyRewardTaskView {
  id: string;
  title: string;
  description: string;
  points: number;
  completed: boolean;
  locked: boolean;
}

export interface DailyRewardSpinView {
  claimed: boolean;
  points: number | null;
  outcomeKey: string | null;
  claimedAt: string | null;
}

export interface DailyRewardLeaderboardEntry {
  rank: number;
  name: string;
  points: number;
  me: boolean;
}

export interface DailyRewardPayoutLogEntry {
  day: string;
  rank: number;
  name: string;
  points: number;
  prizePercent: number;
  prizeUsd: number;
  status: string;
  txSignature: string | null;
  paidAt: string | null;
}

export interface DailyRewardEligibilityView {
  eligible: boolean;
  reason: 'eligible' | 'no_wallet' | 'under_minimum' | 'price_unavailable';
  walletPubkey: string | null;
  wocBalance: number | null;
  wocUsdPrice: number | null;
  usdValue: number | null;
  minUsd: number;
}

export interface DailyRewardStatus {
  day: string;
  resetAt: string;
  prizePoolUsd: number;
  prizePoolSol: number | null;
  eligibility: DailyRewardEligibilityView;
  score: number;
  rank: number | null;
  spin: DailyRewardSpinView;
  tasks: DailyRewardTaskView[];
  leaderboard: DailyRewardLeaderboardEntry[];
}

export interface DailyRewardSpinResult extends DailyRewardStatus {
  awardedPoints: number;
  outcomeKey: string;
}

export interface DailyRewardHistory {
  payouts: DailyRewardPayoutLogEntry[];
}

export interface IWorldDailyRewards {
  dailyRewards(): Promise<DailyRewardStatus>;
  spinDailyReward(): Promise<DailyRewardSpinResult>;
  dailyRewardHistory(): Promise<DailyRewardHistory>;
}
