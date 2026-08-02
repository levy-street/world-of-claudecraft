// Pure Companion Home view-model. No DOM, no fetch, no player-facing copy.
// Unit-tested against API shapes. Render layer owns i18n.

import type { ClaudiumBalance } from '../net/economy_sdk';
import type { CharacterSummary, RealmDirectory, RealmEntry } from '../net/online';
import type { DeedsLeaderboardPage } from '../sim/leaderboard_page';
import type {
  DailyRewardEligibilityView,
  DailyRewardHistory,
  DailyRewardPayoutLogEntry,
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
  /** Realm display name; empty when the directory had no name for the fetch. */
  readonly realm: string;
}

export type DeedsStanding =
  | { kind: 'unavailable' }
  | { kind: 'unranked' }
  | { kind: 'rank'; rank: number; topPercent: number; renown: number | null };

export interface CompanionHistoryRow {
  readonly day: string;
  readonly rank: number;
  readonly points: number;
  readonly prizeUsd: number;
  readonly status: string;
  readonly txSignature: string | null;
  readonly paidAt: string | null;
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
  /** True when the roster spans more than one realm name. */
  readonly multiRealm: boolean;
  readonly deeds: DeedsStanding;
  readonly history: readonly CompanionHistoryRow[];
  readonly playUrl: string;
}

export function mapRoster(
  characters: readonly CharacterSummary[],
  realm = '',
): CompanionRosterCard[] {
  return characters.map((c) => ({
    id: c.id,
    name: c.name,
    classId: c.class,
    level: c.level,
    online: c.online,
    realm,
  }));
}

/**
 * Which realms to fan out character fetches for.
 * Prefer realms the directory says have characters; if counts are empty or all
 * zero, fetch every listed realm (or a single synthetic home when the directory
 * has no entries).
 */
export function realmsToFetch(directory: RealmDirectory, homeUrl = ''): readonly RealmEntry[] {
  if (directory.realms.length === 0) {
    return [
      {
        name: directory.current || 'Home',
        url: homeUrl,
        type: 'Normal',
      },
    ];
  }
  const withChars = directory.realms.filter((r) => (directory.characters[r.name] ?? 0) > 0);
  if (withChars.length > 0) return withChars;
  return directory.realms;
}

/** Merge per-realm character lists, de-duping by realm+id, online first then name. */
export function mergeRosterCards(batches: readonly CompanionRosterCard[]): CompanionRosterCard[] {
  const seen = new Set<string>();
  const out: CompanionRosterCard[] = [];
  for (const card of batches) {
    const key = `${card.realm}\0${card.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  out.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    const realmCmp = a.realm.localeCompare(b.realm);
    if (realmCmp !== 0) return realmCmp;
    return a.name.localeCompare(b.name);
  });
  return out;
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

export function mapDeedsStanding(page: DeedsLeaderboardPage | null): DeedsStanding {
  if (!page) return { kind: 'unavailable' };
  if (!page.self) return { kind: 'unranked' };
  return {
    kind: 'rank',
    rank: page.self.rank,
    topPercent: page.self.topPercent,
    renown: typeof page.self.renown === 'number' ? page.self.renown : null,
  };
}

export function mapHistory(history: DailyRewardHistory | null, limit = 7): CompanionHistoryRow[] {
  if (!history) return [];
  const rows = history.payouts.map((p: DailyRewardPayoutLogEntry) => ({
    day: p.day,
    rank: p.rank,
    points: p.points,
    prizeUsd: p.prizeUsd,
    status: p.status,
    txSignature: p.txSignature,
    paidAt: p.paidAt,
  }));
  // Newest day first when the server returns chronological or reverse; sort by day desc.
  rows.sort((a, b) => b.day.localeCompare(a.day));
  return rows.slice(0, Math.max(0, limit));
}

export function buildHomeModel(input: {
  username: string;
  daily: DailyRewardStatus;
  characters?: readonly CharacterSummary[];
  roster?: readonly CompanionRosterCard[];
  claudium: ClaudiumBalance;
  deeds?: DeedsLeaderboardPage | null;
  history?: DailyRewardHistory | null;
  playUrl?: string;
}): CompanionHomeModel {
  const roster = input.roster ?? mapRoster(input.characters ?? [], '');
  const { claudium, claudiumAvailable } = mapClaudium(input.claudium);
  const realmNames = new Set(roster.map((c) => c.realm).filter((r) => r.length > 0));
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
    multiRealm: realmNames.size > 1,
    deeds: mapDeedsStanding(input.deeds ?? null),
    history: mapHistory(input.history ?? null),
    playUrl: input.playUrl ?? '/play',
  };
}

/** Apply a successful spin result onto an existing home model. */
export function applySpinResult(
  model: CompanionHomeModel,
  result: DailyRewardSpinResult,
): CompanionHomeModel {
  const next = buildHomeModel({
    username: model.username,
    daily: result,
    roster: model.roster,
    claudium: {
      available: model.claudiumAvailable,
      balance: model.claudium,
    },
    playUrl: model.playUrl,
  });
  return {
    ...next,
    deeds: model.deeds,
    history: model.history,
  };
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

export function formatPrizeUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '-';
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
