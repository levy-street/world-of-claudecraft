import type { DailyRewardHistory, DailyRewardStatus } from '../world_api';

export type DailyRewardsView =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      status: DailyRewardStatus;
      history: DailyRewardHistory;
      locked: boolean;
      lockReason: DailyRewardStatus['eligibility']['reason'];
    };

export type DailyRewardsInput =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'status'; status: DailyRewardStatus; history: DailyRewardHistory };

export function buildDailyRewardsView(input: DailyRewardsInput): DailyRewardsView {
  if (input.kind === 'loading') return { kind: 'loading' };
  if (input.kind === 'error') return { kind: 'error', message: input.message };
  return {
    kind: 'ready',
    status: input.status,
    history: input.history,
    locked: !input.status.eligibility.eligible,
    lockReason: input.status.eligibility.reason,
  };
}
