import { sanitizeWeeklyRewards, type WeeklyRewardInfo } from '../sim/weekly_rewards';

/** Owner-only delta decoder. Malformed input closes the pane rather than granting authority. */
export function decodeWeeklyRewardInfo(raw: unknown): WeeklyRewardInfo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const state = sanitizeWeeklyRewards(value.state);
  if (
    !state ||
    typeof value.nowMs !== 'number' ||
    !Number.isSafeInteger(value.nowMs) ||
    value.nowMs < 0 ||
    typeof value.canClaim !== 'boolean' ||
    typeof value.worldQuestsAvailable !== 'boolean'
  )
    return null;
  return {
    state,
    nowMs: value.nowMs,
    canClaim: value.canClaim,
    worldQuestsAvailable: value.worldQuestsAvailable,
    readyWeeks:
      typeof value.readyWeeks === 'number' && Number.isSafeInteger(value.readyWeeks)
        ? Math.max(0, Math.min(520, value.readyWeeks))
        : state.vaults.length,
  };
}
