export interface DailyRewardTaskView {
  id: string;
  title: string;
  description: string;
  points: number;
  multiplier?: number | null;
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

export interface DailyRewardLeaderboardPage {
  day: string;
  leaders: DailyRewardLeaderboardEntry[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
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
  leaderboardTotal: number;
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
  dailyRewardLeaderboard(page?: number, pageSize?: number): Promise<DailyRewardLeaderboardPage>;
  spinDailyReward(): Promise<DailyRewardSpinResult>;
  dailyRewardHistory(): Promise<DailyRewardHistory>;
}
