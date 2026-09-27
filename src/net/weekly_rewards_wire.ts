import { sanitizeWeeklyRewards, type WeeklyRewardInfo } from '../sim/weekly_rewards';

export type { WeeklyRewardInfo } from '../sim/weekly_rewards';

/** Build tokenized commands from the current mirror; the server owns all outcomes. */
export function sendWeekly(
  info: WeeklyRewardInfo | null,
  choice: string,
  action: 'open' | 'claim',
  send: (command: {
    cmd: 'weekly_reward_open' | 'weekly_reward_claim';
    choice: string;
    token: string;
    tables?: readonly string[];
  }) => void,
  table?: string | readonly string[],
): void {
  const state = info?.state;
  if (!state) return;
  const token = `${state.resetAtMs}:${state.claimSequence}`;
  if (action === 'open')
    send({
      cmd: 'weekly_reward_open',
      choice,
      token,
      ...(table ? { tables: typeof table === 'string' ? [table] : [...table] } : {}),
    });
  else send({ cmd: 'weekly_reward_claim', choice, token });
}

/** Owner-only delta decoder. Malformed input closes the pane rather than granting authority. */
export function decodeWeeklyRewardInfo(raw: unknown): WeeklyRewardInfo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const state = sanitizeWeeklyRewards(value.state, true);
  if (
    !state ||
    typeof value.nowMs !== 'number' ||
    !Number.isSafeInteger(value.nowMs) ||
    value.nowMs < 0 ||
    typeof value.playerLevel !== 'number' ||
    !Number.isSafeInteger(value.playerLevel) ||
    value.playerLevel < 1 ||
    typeof value.canClaim !== 'boolean' ||
    typeof value.worldQuestsAvailable !== 'boolean'
  )
    return null;
  return {
    state,
    nowMs: value.nowMs,
    playerLevel: value.playerLevel,
    canClaim: value.canClaim,
    worldQuestsAvailable: value.worldQuestsAvailable,
    readyWeeks:
      typeof value.readyWeeks === 'number' && Number.isSafeInteger(value.readyWeeks)
        ? Math.max(0, Math.min(520, value.readyWeeks))
        : state.vaults.length,
  };
}
