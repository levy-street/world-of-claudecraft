// Pure view core for Lantern Hall's guild window: the week's three contract notices (the boss
// portrait, the week's counter, the reward), the board's weekly tally, the seal count and the
// reset countdown; the quartermaster's counter is its sibling core (guild_quartermaster_view.ts).
// DOM-free; the painter (guild_hall_window.ts) renders exactly what this shapes. Reads the world
// only through the IWorld members it names (guildContracts, inventory, deedsEarned, the weekly
// reset, the player's name, and for the counter the held mounts and the account's weapon skins),
// so a test drives it with a plain object.

import {
  GUILD_CONTRACTS_BY_ID,
  type GuildContractDef,
  type GuildContractKind,
} from '../../../sim/content/guild_contracts';
import type { GuildContractsView } from '../../../sim/guild_contracts';
import type { InvSlot } from '../../../sim/types';
import { deedDesc, deedName } from '../../deed_i18n';
import { FINDER_PORTRAIT_DIR } from '../../dungeon_finder_view';
import { mobDisplayName } from '../../entity_display_core';
import { dungeonDisplayName } from '../../entity_i18n';
import { formatList, formatNumber, t } from '../../i18n';
import {
  buildGuildShopView,
  type GuildShopInput,
  type GuildShopView,
  lanternSeals,
  sealCount,
} from './guild_quartermaster_view';

export { lanternSeals };

export type GuildHallTab = 'contracts' | 'quartermaster';

export interface GuildHallWorld {
  readonly guildContracts: GuildContractsView;
  readonly inventory: readonly InvSlot[];
  readonly deedsEarned: ReadonlyMap<string, string>;
  ownedMounts(): readonly string[];
  ridingTrained(): boolean;
  readonly accountCosmetics: { readonly weaponSkinIds: readonly string[] };
  readonly weeklyQuestResetAtMs: number;
  readonly player: { readonly name: string };
}

export interface GuildContractCardView {
  id: string;
  kind: GuildContractKind;
  kindLabel: string;
  /** The boss the contract is posted against (a heroic clear's: the dungeon's final boss). */
  boss: string;
  /** Its prerendered portrait still, the one the dungeon finder shows (FINDER_PORTRAIT_DIR). */
  portraitUrl: string;
  dungeon: string;
  goal: string;
  /** The task's own Book of Deeds condition, a sentence of its own (empty for the rest). */
  detail: string;
  reward: string;
  /** "Reward: 3 Lantern Seals". */
  rewardLine: string;
  done: boolean;
  stateLabel: string;
  /** This week's completions of the contract, out of the times it pays in a week. */
  progressDone: number;
  progressTotal: number;
  progressText: string;
}

export interface GuildHallView {
  title: string;
  tabs: { id: GuildHallTab; label: string; selected: boolean }[];
  seals: number;
  sealsText: string;
  /** The seal chip's hover card: what seals are for. */
  sealsTip: string;
  resetText: string;
  intro: string;
  noticesLabel: string;
  contracts: GuildContractCardView[];
  emptyText: string | null;
  lifetimeText: string;
  /** The board's weekly tally: the posted contracts done, out of the posted. */
  weekDone: number;
  weekTotal: number;
  weekProgressText: string;
  weekProgressAria: string;
  shop: GuildShopView;
}

const whole = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });

/** Days and hours until the weekly reset, the locale's own unit words. */
export function guildResetText(resetAtMs: number, nowMs: number): string {
  if (!(resetAtMs > 0)) return t('hudChrome.guildHall.resetSoon');
  const seconds = Math.max(0, Math.floor((resetAtMs - nowMs) / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const parts: string[] = [];
  if (days > 0) parts.push(formatNumber(days, { style: 'unit', unit: 'day', unitDisplay: 'long' }));
  parts.push(formatNumber(hours, { style: 'unit', unit: 'hour', unitDisplay: 'long' }));
  return t('hudChrome.guildHall.resetIn', { time: formatList(parts) });
}

function contractGoal(contract: GuildContractDef): string {
  const dungeon = dungeonDisplayName(contract.dungeonId);
  const boss = mobDisplayName(contract.mobId);
  if (contract.kind === 'boss') return t('hudChrome.guildHall.goals.boss', { boss, dungeon });
  if (contract.kind === 'heroic') return t('hudChrome.guildHall.goals.heroic', { boss, dungeon });
  return t('hudChrome.guildHall.goals.task', {
    task: deedName(contract.taskDeedId ?? ''),
    dungeon,
  });
}

/** A contract pays once a week (src/sim/guild_contracts.ts): its counter is out of one. */
const COMPLETIONS_PER_WEEK = 1;

export function buildGuildContractCard(
  contract: GuildContractDef,
  done: boolean,
): GuildContractCardView {
  const reward = sealCount(contract.seals);
  const progressDone = done ? COMPLETIONS_PER_WEEK : 0;
  return {
    id: contract.id,
    kind: contract.kind,
    kindLabel: t(`hudChrome.guildHall.kinds.${contract.kind}`),
    boss: mobDisplayName(contract.mobId),
    portraitUrl: `${FINDER_PORTRAIT_DIR}/${contract.mobId}.webp`,
    dungeon: dungeonDisplayName(contract.dungeonId),
    goal: contractGoal(contract),
    detail: contract.kind === 'task' && contract.taskDeedId ? deedDesc(contract.taskDeedId) : '',
    reward,
    rewardLine: t('hudChrome.guildHall.board.rewardLine', { reward }),
    done,
    stateLabel: done ? t('hudChrome.guildHall.done') : t('hudChrome.guildHall.open'),
    progressDone,
    progressTotal: COMPLETIONS_PER_WEEK,
    progressText: t('hudChrome.guildHall.board.cardProgress', {
      done: whole(progressDone),
      total: whole(COMPLETIONS_PER_WEEK),
    }),
  };
}

/** The contract's short name for the completion toast. */
export function guildContractLabel(contractId: string): string {
  const contract = GUILD_CONTRACTS_BY_ID[contractId];
  if (!contract) return '';
  return t('hudChrome.guildHall.contractLabel', {
    kind: t(`hudChrome.guildHall.kinds.${contract.kind}`),
    dungeon: dungeonDisplayName(contract.dungeonId),
  });
}

/** What the quartermaster's counter reads from the world: the seals, the name its nameplate
 *  preview wears, and the three ledgers its offers can already be owned in. */
export function guildShopInput(world: GuildHallWorld, seals: number): GuildShopInput {
  return {
    seals,
    playerName: world.player.name,
    deedsEarned: world.deedsEarned,
    ownedMounts: world.ownedMounts(),
    weaponSkinIds: world.accountCosmetics.weaponSkinIds,
    ridingTrained: world.ridingTrained(),
  };
}

export function buildGuildHallView(
  world: GuildHallWorld,
  nowMs: number,
  tab: GuildHallTab,
  selectedOffer: string | null = null,
): GuildHallView {
  const board = world.guildContracts;
  const seals = lanternSeals(world.inventory);
  const contracts = board.offered
    .map((id) => GUILD_CONTRACTS_BY_ID[id])
    .filter((contract): contract is GuildContractDef => !!contract)
    .map((contract) => buildGuildContractCard(contract, board.done.includes(contract.id)));
  const weekDone = contracts.filter((card) => card.done).length;
  return {
    title: t('hudChrome.guildHall.title'),
    tabs: (['contracts', 'quartermaster'] as const).map((id) => ({
      id,
      label: t(`hudChrome.guildHall.tabs.${id}`),
      selected: id === tab,
    })),
    seals,
    sealsText: t('hudChrome.guildHall.seals', { count: whole(seals) }),
    sealsTip: t('hudChrome.guildHall.board.sealsTip'),
    resetText: guildResetText(world.weeklyQuestResetAtMs, nowMs),
    intro:
      tab === 'contracts'
        ? t('hudChrome.guildHall.contractsIntro')
        : t('hudChrome.guildHall.quartermasterIntro'),
    noticesLabel: t('hudChrome.guildHall.board.noticesLabel'),
    contracts,
    emptyText: contracts.length === 0 ? t('hudChrome.guildHall.emptyBoard') : null,
    lifetimeText: t('hudChrome.guildHall.lifetime', { count: whole(board.lifetime) }),
    weekDone,
    weekTotal: contracts.length,
    weekProgressText: t('hudChrome.guildHall.board.weekProgress', {
      done: whole(weekDone),
      total: whole(contracts.length),
    }),
    weekProgressAria: t('hudChrome.guildHall.board.weekProgressAria'),
    shop: buildGuildShopView(guildShopInput(world, seals), selectedOffer),
  };
}
