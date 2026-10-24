import { FINDER_ACTIVITIES } from '../content/dungeon_finder';
import {
  QUEUE_BALANCE_CAP,
  QUEUE_BOSS_POINTS,
  QUEUE_COMPLETION_POINTS,
  QUEUE_DAILY_POINT_CAP,
  QUEUE_REWARDS,
  QUEUE_REWARDS_ENABLED,
  type QueueRewardId,
} from '../content/queue_rewards';

export interface QueueRewardsState {
  balance: number;
  unlocked: QueueRewardId[];
  equipped: QueueRewardId | null;
  day: string;
  earnedToday: number;
  credited: Record<string, string[]>;
}
const int = (v: unknown, max: number) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? Math.min(v, max) : 0;
const rewardId = (v: unknown): v is QueueRewardId => QUEUE_REWARDS.some((r) => r.id === v);
export function loadQueueRewards(value?: unknown): QueueRewardsState {
  const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const unlocked = QUEUE_REWARDS.filter(
    (r) => Array.isArray(v.unlocked) && v.unlocked.includes(r.id),
  ).map((r) => r.id);
  const credited: Record<string, string[]> = {};
  const rows =
    v.credited && typeof v.credited === 'object' ? (v.credited as Record<string, unknown>) : {};
  for (const activity of FINDER_ACTIVITIES) {
    const entries = rows[activity.id];
    if (!Array.isArray(entries)) continue;
    const allowed = [...activity.encounters.map((e) => e.mobId), 'completion'];
    const selected = allowed.filter((id) => entries.includes(id));
    if (selected.length) credited[activity.id] = selected;
  }
  return {
    balance: int(v.balance, QUEUE_BALANCE_CAP),
    unlocked,
    equipped: rewardId(v.equipped) && unlocked.includes(v.equipped) ? v.equipped : null,
    day: typeof v.day === 'string' && /^(?:\d{4}-\d{2}-\d{2}|offline)$/.test(v.day) ? v.day : '',
    earnedToday: int(v.earnedToday, QUEUE_DAILY_POINT_CAP),
    credited,
  };
}
export function savedQueueRewards(state?: QueueRewardsState): { queueRewards?: QueueRewardsState } {
  if (!state) return {};
  return state.balance || state.unlocked.length || state.day
    ? {
        queueRewards: {
          ...state,
          unlocked: [...state.unlocked],
          credited: Object.fromEntries(Object.entries(state.credited).map(([k, v]) => [k, [...v]])),
        },
      }
    : {};
}
export function grantQueueEncounter(
  state: QueueRewardsState,
  resetDay: string,
  activityId: string,
  mobId: string,
): number {
  if (!QUEUE_REWARDS_ENABLED) return 0;
  const activity = FINDER_ACTIVITIES.find((a) => a.id === activityId);
  const encounter = activity?.encounters.find((e) => e.mobId === mobId);
  if (!activity || !encounter) return 0;
  const day = resetDay || state.day || 'offline';
  if (state.day && state.day !== 'offline' && day < state.day) return 0;
  if (day !== state.day) {
    const hadOfflineCredits = state.day === 'offline';
    state.day = day;
    if (!hadOfflineCredits) {
      state.earnedToday = 0;
      state.credited = {};
    }
  }
  const credits = state.credited[activityId] ?? [];
  state.credited[activityId] = credits;
  if (credits.includes(mobId)) return 0;
  credits.push(mobId);
  let points = QUEUE_BOSS_POINTS;
  if (encounter.final && !credits.includes('completion')) {
    credits.push('completion');
    points += QUEUE_COMPLETION_POINTS;
  }
  const earned = Math.min(
    points,
    QUEUE_DAILY_POINT_CAP - state.earnedToday,
    QUEUE_BALANCE_CAP - state.balance,
  );
  state.earnedToday += earned;
  state.balance += earned;
  return earned;
}
export function changeQueueReward(
  state: QueueRewardsState,
  id: string | null,
  buy: boolean,
): boolean {
  if (!QUEUE_REWARDS_ENABLED) return false;
  if (id === null && !buy) {
    state.equipped = null;
    return true;
  }
  const reward = QUEUE_REWARDS.find((r) => r.id === id);
  if (!reward) return false;
  if (buy) {
    if (state.unlocked.includes(reward.id) || state.balance < reward.cost) return false;
    state.balance -= reward.cost;
    state.unlocked.push(reward.id);
  }
  if (!state.unlocked.includes(reward.id)) return false;
  state.equipped = reward.id;
  return true;
}
