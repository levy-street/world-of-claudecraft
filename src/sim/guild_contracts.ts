// Lantern Hall's weekly dungeon contracts (content/guild_contracts.ts): the week's board, each
// character's progress on it, the credit the dungeon kills feed it, the Lantern Seals it pays,
// and the save shape.
//
// The module owns the rule set behind the SimContext seam. The week is the realm's weekly reset
// week (weekly_quests.ts, derived from the host-fed reset day, so every host agrees); the board
// is picked from the pools by the week's number alone. Nothing here draws randomness. The one
// credit entry (onKillForGuildContracts) is called from the deeds kill-credit path
// (deeds.ts onMobKillCreditForDeeds) with the same recipients the Book of Deeds credits, and
// the encounter tasks the evaluator judged met on that kill; the milestone deeds are granted
// through the caller's `grant`, so this module never imports the deeds evaluator.

import {
  GUILD_BOSS_CONTRACTS,
  GUILD_CONTRACT_MILESTONES,
  GUILD_CONTRACTS,
  GUILD_CONTRACTS_BY_ID,
  GUILD_HEROIC_CONTRACTS,
  GUILD_TASK_CONTRACTS,
  type GuildContractDef,
  LANTERN_SEAL_ITEM_ID,
} from './content/guild_contracts';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { Entity } from './types';
import { weeklyQuestWeekForResetDay } from './weekly_quests';

/** A character's standing with the board: the week it was last read, the contracts done that
 *  week, and every contract ever done (the milestone deeds' count). */
export interface GuildContractProgress {
  week: string;
  done: string[];
  lifetime: number;
}

/** The week's number from its id ('wk_<n>'), or null for a malformed id. */
function weekNumber(week: string): number | null {
  const match = /^wk_(-?\d+)$/.exec(week);
  return match ? Number(match[1]) : null;
}

function pick<T>(pool: readonly T[], index: number): T {
  return pool[((index % pool.length) + pool.length) % pool.length];
}

/** The board for a week: one named-boss, one Heroic and one encounter-task contract, the
 *  same for every host (empty for a malformed week). Consecutive weeks walk each pool by a
 *  stride prime to its length, so every contract comes round and no two weeks in a row match. */
export function guildContractsForWeek(week: string): GuildContractDef[] {
  const n = weekNumber(week);
  if (n === null) return [];
  return [
    pick(GUILD_BOSS_CONTRACTS, n * 7 + 3),
    pick(GUILD_HEROIC_CONTRACTS, n * 3 + 1),
    pick(GUILD_TASK_CONTRACTS, n * 3 + 2),
  ];
}

export function currentGuildContractWeek(ctx: Pick<SimContext, 'resetDay'>): string {
  return weeklyQuestWeekForResetDay(ctx.resetDay);
}

/** The character's progress, rolled to the current week (a past week's done list clears; the
 *  lifetime count stays). Creates the record on first use. */
export function guildContractProgress(
  ctx: Pick<SimContext, 'resetDay'>,
  meta: PlayerMeta,
): GuildContractProgress {
  const week = currentGuildContractWeek(ctx);
  const progress = meta.guildContracts;
  if (!progress) {
    meta.guildContracts = { week, done: [], lifetime: 0 };
    return meta.guildContracts;
  }
  if (progress.week !== week) {
    progress.week = week;
    progress.done = [];
    meta.wireRev++;
  }
  return progress;
}

/** The read the window draws: the week, its three contracts' ids, which are done, the count. */
export interface GuildContractsView {
  readonly week: string;
  readonly offered: readonly string[];
  readonly done: readonly string[];
  readonly lifetime: number;
}

export function guildContractsView(
  ctx: Pick<SimContext, 'resetDay'>,
  meta: PlayerMeta | undefined,
): GuildContractsView {
  const week = currentGuildContractWeek(ctx);
  const offered = guildContractsForWeek(week).map((contract) => contract.id);
  const progress = meta?.guildContracts;
  const current = progress && progress.week === week;
  return {
    week,
    offered,
    done: current ? [...progress.done] : [],
    lifetime: progress?.lifetime ?? 0,
  };
}

// the bosses any contract can name, so every other kill leaves at once
const CONTRACT_BOSSES: ReadonlySet<string> = new Set(GUILD_CONTRACTS.map((c) => c.mobId));

function completes(
  contract: GuildContractDef,
  mob: Entity,
  heroic: boolean,
  tasks: readonly string[],
): boolean {
  if (contract.mobId !== mob.templateId) return false;
  if (contract.kind === 'boss') return true;
  if (contract.kind === 'heroic') return heroic;
  return contract.taskDeedId !== undefined && tasks.includes(contract.taskDeedId);
}

/** Pay one contract to one character: marked done for the week, the seals into the bags, the
 *  milestone deeds through `grant`, a personal event for the client's toast. */
function payContract(
  ctx: SimContext,
  meta: PlayerMeta,
  contract: GuildContractDef,
  grant: (meta: PlayerMeta, deedId: string) => void,
): void {
  const progress = guildContractProgress(ctx, meta);
  if (progress.done.includes(contract.id)) return;
  progress.done.push(contract.id);
  progress.lifetime++;
  meta.wireRev++;
  ctx.addItem(LANTERN_SEAL_ITEM_ID, contract.seals, meta.entityId);
  ctx.emit({
    type: 'guildContractDone',
    contractId: contract.id,
    seals: contract.seals,
    pid: meta.entityId,
  });
  for (const milestone of GUILD_CONTRACT_MILESTONES) {
    if (progress.lifetime >= milestone.count) grant(meta, milestone.deedId);
  }
}

/**
 * A credited boss kill (deeds.ts onMobKillCreditForDeeds): `recipients` are the kill's
 * eligible roster (named-boss and Heroic contracts), `taskRecipients` the encounter's (the
 * task contracts, the Book's own envelope), `tasks` the encounter deeds whose conditions this
 * kill met, `heroic` whether the kill fell in a Heroic instance.
 */
export function onKillForGuildContracts(
  ctx: SimContext,
  mob: Entity,
  heroic: boolean,
  recipients: readonly PlayerMeta[],
  taskRecipients: readonly PlayerMeta[],
  tasks: readonly string[],
  grant: (meta: PlayerMeta, deedId: string) => void,
): void {
  if (!CONTRACT_BOSSES.has(mob.templateId)) return;
  for (const contract of guildContractsForWeek(currentGuildContractWeek(ctx))) {
    if (!completes(contract, mob, heroic, tasks)) continue;
    const paid = contract.kind === 'task' ? taskRecipients : recipients;
    for (const meta of paid) payContract(ctx, meta, contract, grant);
  }
}

// ---- persistence and wire ---------------------------------------------------

/** Accept only a well-formed record; done ids that name no contract are dropped. */
export function sanitizeGuildContractProgress(value: unknown): GuildContractProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Partial<GuildContractProgress>;
  if (typeof row.week !== 'string' || weekNumber(row.week) === null) return null;
  const done = Array.isArray(row.done)
    ? [
        ...new Set(
          row.done.filter(
            (id): id is string => typeof id === 'string' && !!GUILD_CONTRACTS_BY_ID[id],
          ),
        ),
      ]
    : [];
  const lifetime =
    typeof row.lifetime === 'number' && Number.isFinite(row.lifetime)
      ? Math.max(0, Math.min(1_000_000, Math.floor(row.lifetime)))
      : 0;
  return { week: row.week, done, lifetime: Math.max(lifetime, done.length) };
}

export function savedGuildContractProgress(meta: PlayerMeta): GuildContractProgress | undefined {
  const progress = meta.guildContracts;
  if (!progress || (progress.lifetime === 0 && progress.done.length === 0)) return undefined;
  return { week: progress.week, done: [...progress.done], lifetime: progress.lifetime };
}
