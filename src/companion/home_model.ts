// Pure Companion Home view-model. No DOM, no fetch, no player-facing copy.
// Unit-tested against API shapes. Render layer owns i18n.

import type { ClaudiumBalance } from '../net/economy_sdk';
import type { CharacterSummary } from '../net/online';
import type {
  DailyRewardEligibilityView,
  DailyRewardSpinResult,
  DailyRewardStatus,
} from '../world_api/daily_rewards';

export type SpinAction =
  | { kind: 'disabled'; reason: DailyRewardEligibilityView['reason'] }
  | { kind: 'ready' }
  | { kind: 'claimed'; points: number; outcomeKey: string | null };

export interface CompanionRosterCard {
  readonly id: number;
  readonly name: string;
  readonly classId: string;
  readonly level: number;
  readonly online: boolean;
}

export interface CompanionHomeModel {
  readonly username: string;
  readonly day: string;
  readonly resetAt: string;
  readonly score: number;
  readonly rank: number | null;
  readonly spin: SpinAction;
  readonly eligibilityReason: DailyRewardEligibilityView['reason'];
  readonly claudium: number | null;
  readonly claudiumAvailable: boolean;
  readonly roster: readonly CompanionRosterCard[];
  readonly emptyRoster: boolean;
  readonly playUrl: string;
}

export function mapRoster(characters: readonly CharacterSummary[]): CompanionRosterCard[] {
  return characters.map((c) => ({
    id: c.id,
    name: c.name,
    classId: c.class,
    level: c.level,
    online: c.online,
  }));
}

export function mapSpinAction(status: DailyRewardStatus): SpinAction {
  if (status.spin.claimed) {
    return {
      kind: 'claimed',
      points: status.spin.points ?? 0,
      outcomeKey: status.spin.outcomeKey,
    };
  }
  if (!status.eligibility.eligible) {
    return { kind: 'disabled', reason: status.eligibility.reason };
  }
  return { kind: 'ready' };
}

export function mapClaudium(balance: ClaudiumBalance): {
  claudium: number | null;
  claudiumAvailable: boolean;
} {
  if (balance.available === false) {
    return { claudium: null, claudiumAvailable: false };
  }
  return {
    claudium: typeof balance.balance === 'number' ? balance.balance : null,
    claudiumAvailable: true,
  };
}

export function buildHomeModel(input: {
  username: string;
  daily: DailyRewardStatus;
  characters: readonly CharacterSummary[];
  claudium: ClaudiumBalance;
  playUrl?: string;
}): CompanionHomeModel {
  const roster = mapRoster(input.characters);
  const { claudium, claudiumAvailable } = mapClaudium(input.claudium);
  return {
    username: input.username,
    day: input.daily.day,
    resetAt: input.daily.resetAt,
    score: input.daily.score,
    rank: input.daily.rank,
    spin: mapSpinAction(input.daily),
    eligibilityReason: input.daily.eligibility.reason,
    claudium,
    claudiumAvailable,
    roster,
    emptyRoster: roster.length === 0,
    playUrl: input.playUrl ?? '/play',
  };
}

/** Apply a successful spin result onto an existing home model. */
export function applySpinResult(
  model: CompanionHomeModel,
  result: DailyRewardSpinResult,
): CompanionHomeModel {
  return buildHomeModel({
    username: model.username,
    daily: result,
    characters: model.roster.map((c) => ({
      id: c.id,
      name: c.name,
      class: c.classId as CharacterSummary['class'],
      level: c.level,
      skin: 0,
      online: c.online,
      forceRename: false,
    })),
    claudium: {
      available: model.claudiumAvailable,
      balance: model.claudium,
    },
    playUrl: model.playUrl,
  });
}

export function formatResetCountdown(resetAtIso: string, nowMs = Date.now()): string {
  const resetMs = Date.parse(resetAtIso);
  if (!Number.isFinite(resetMs)) return '';
  const delta = Math.max(0, resetMs - nowMs);
  const totalMin = Math.floor(delta / 60_000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours <= 0 && minutes <= 0) return 'soon';
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function formatClaudium(balance: number | null, available: boolean): string {
  if (!available || balance === null) return '-';
  return balance.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
