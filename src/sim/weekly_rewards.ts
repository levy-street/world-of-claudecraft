// Weekly choices. The host supplies the same calendar used by the Crucible.
// A completed week earns unopened slots; opening fixes an item after host persistence.
import { bagsFullError } from './bags';
import { HEROIC_DUNGEON_TUNING } from './content/dungeon_difficulty';
import { HEROIC_BOSS_LOOT } from './content/heroic_loot';
import { FURY_STOCK } from './content/pvp_honor';
import { DUNGEONS, ITEMS, MOBS } from './data';
import { createNpc } from './entity';
import { canEquipItem } from './equipment_rules';
import { VARKHUL_BOSS_ID } from './ignivar_raid_ids';
import { instanceLockoutMetas } from './instances/dungeons';
import { RAID_MIN_PLAYERS } from './item_level';
import { heroicLootItemId } from './loot/heroic_item';
import type { InstanceSlot, PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { NpcDef } from './types';
import {
  dist2d,
  type Entity,
  IGNIVAR_BOSS_ID,
  INTERACT_RANGE,
  NYTHRAXIS_BOSS_ID,
  type PlayerClass,
} from './types';

// Reserved singleton id (the 1_000_000_x band; see STATIC_WORLD_SERVICE_ENTITY_ID_MIN
// in types.ts): 1_000_000_004 went to the Last Keep spirit healer while this branch was
// in flight, so the keeper takes the next free slot. The healing dummies start at _010.
export const WEEKLY_KEEPER_ENTITY_ID = 1_000_000_005;
export const WEEKLY_KEEPER_ID = 'eastbrook_vault_keeper';
export const WEEKLY_POOL_IDS = [
  'raid',
  'raid_heroic',
  'dungeon',
  'dungeon_heroic',
  'world',
  'pvp',
] as const;
export type WeeklyPoolId = (typeof WEEKLY_POOL_IDS)[number];
export const WEEKLY_THRESHOLDS = {
  raid: [1, 2, 3],
  dungeon: [1, 4, 8],
  world: [2, 4, 8],
  pvp: [1, 3, 5],
} as const;
// Persisted index order. Append future encounters; never reorder existing entries.
export const WEEKLY_RAID_BOSSES: readonly string[] = [
  NYTHRAXIS_BOSS_ID,
  IGNIVAR_BOSS_ID,
  VARKHUL_BOSS_ID,
];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Ten years of earned weeks, with at most twelve choices per week. Only the
// oldest batch is sent in snapshots; a corrupt save cannot grow this unbounded.
export const WEEKLY_BACKLOG_LIMIT = 520;
export interface WeeklyChoice {
  pool: WeeklyPoolId;
  itemId?: string;
  opened?: true;
  /** Runtime only. Never serialized; an unacknowledged item stays off the wire. */
  pendingSave?: true;
  opening?: boolean;
}
export interface WeeklyVaultBatch {
  resetAtMs: number;
  choices: WeeklyChoice[];
  raidUnlocks?: number[];
}
export interface WeeklyRewardState {
  resetAtMs: number;
  claimSequence: number;
  raids: number[];
  dungeons: number[];
  world: number;
  pvp: number;
  raidUnlocks: number[];
  vaults: WeeklyVaultBatch[];
  overflowed: boolean;
  legacyPending?: number[];
}
export interface WeeklyRewardInfo {
  state: WeeklyRewardState;
  nowMs: number;
  canClaim: boolean;
  worldQuestsAvailable: boolean;
  readyWeeks: number;
}
export function emptyWeeklyRewards(resetAtMs = 0): WeeklyRewardState {
  return {
    resetAtMs,
    claimSequence: 0,
    raids: WEEKLY_RAID_BOSSES.map(() => 0),
    dungeons: [],
    world: 0,
    pvp: 0,
    raidUnlocks: WEEKLY_RAID_BOSSES.map(() => 0),
    vaults: [],
    overflowed: false,
  };
}
function bounded(n: unknown, max: number): number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? Math.min(n, max) : 0;
}
export function sanitizeWeeklyRewards(
  raw: unknown,
  publicView = false,
): WeeklyRewardState | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const state = emptyWeeklyRewards(bounded(r.resetAtMs, Number.MAX_SAFE_INTEGER));
  state.claimSequence = bounded(r.claimSequence, Number.MAX_SAFE_INTEGER);
  state.raids = state.raids.map((_, i) => bounded(Array.isArray(r.raids) ? r.raids[i] : 0, 2));
  state.dungeons = Array.isArray(r.dungeons)
    ? r.dungeons
        .slice(0, 8)
        .map((n) => bounded(n, 2))
        .filter(Boolean)
        .sort((a, b) => b - a)
    : [];
  state.world = bounded(r.world, 8);
  state.pvp = bounded(r.pvp, 5);
  state.raidUnlocks = state.raids.map((tier, i) =>
    Math.max(tier, bounded(Array.isArray(r.raidUnlocks) ? r.raidUnlocks[i] : 0, 2)),
  );
  state.overflowed = r.overflowed === true;
  const legacy = r.legacyPending ?? (!Array.isArray(r.vaults) ? r.pending : undefined);
  if (Array.isArray(legacy))
    state.legacyPending = WEEKLY_POOL_IDS.map((_, i) => bounded(legacy[i], 3));
  if (Array.isArray(r.vaults)) {
    for (const rawBatch of r.vaults.slice(0, WEEKLY_BACKLOG_LIMIT)) {
      if (!rawBatch || typeof rawBatch !== 'object') continue;
      const resetAtMs = bounded(rawBatch.resetAtMs, Number.MAX_SAFE_INTEGER);
      if (!resetAtMs || !Array.isArray(rawBatch.choices)) continue;
      const choices: WeeklyChoice[] = [];
      for (const choice of rawBatch.choices.slice(0, 12)) {
        if (!choice || !WEEKLY_POOL_IDS.includes(choice.pool)) continue;
        if (choice.itemId === undefined || (publicView && choice.opened !== true)) {
          choices.push({
            pool: choice.pool,
            ...(publicView && choice.opening === true ? { opening: true } : {}),
          });
          continue;
        }
        if (typeof choice.itemId !== 'string' || choice.itemId.length > 128) continue;
        const item = ITEMS[choice.itemId];
        if (
          item &&
          ['weapon', 'armor', 'held_offhand'].includes(item.kind) &&
          (item.quality === 'rare' || item.quality === 'epic')
        )
          choices.push({
            pool: choice.pool,
            itemId: choice.itemId,
            ...(choice.opened === true ? { opened: true as const } : {}),
          });
      }
      if (choices.length && !state.vaults.some((batch) => batch.resetAtMs === resetAtMs))
        state.vaults.push({
          resetAtMs,
          choices,
          ...(Array.isArray(rawBatch.raidUnlocks)
            ? { raidUnlocks: WEEKLY_RAID_BOSSES.map((_, i) => bounded(rawBatch.raidUnlocks[i], 2)) }
            : {}),
        });
    }
    state.vaults.sort((a, b) => a.resetAtMs - b.resetAtMs);
  }
  return state;
}
export function earnedWeeklyRolls(state: WeeklyRewardState): number[] {
  const earned = WEEKLY_POOL_IDS.map(() => 0);
  const tiers = [state.raids.filter(Boolean).sort((a, b) => b - a), state.dungeons];
  for (const [index, thresholds] of [WEEKLY_THRESHOLDS.raid, WEEKLY_THRESHOLDS.dungeon].entries()) {
    for (const required of thresholds) {
      const tier = tiers[index][required - 1];
      if (tier) earned[index * 2 + (tier === 2 ? 1 : 0)]++;
    }
  }
  earned[4] = WEEKLY_THRESHOLDS.world.filter((n) => state.world >= n).length;
  earned[5] = WEEKLY_THRESHOLDS.pvp.filter((n) => state.pvp >= n).length;
  return earned;
}
export function advanceWeeklyRewards(
  state: WeeklyRewardState,
  nowMs: number,
  nextReset: (now: number) => number,
  available: (pool: WeeklyPoolId) => boolean = () => true,
): void {
  if (!Number.isFinite(nowMs) || nowMs < 0) return;
  if (state.resetAtMs > nowMs) return;
  if (state.resetAtMs > 0) {
    const earned = earnedWeeklyRolls(state);
    const choices: WeeklyChoice[] = [];
    if (state.vaults.length < WEEKLY_BACKLOG_LIMIT) {
      for (const [i, count] of earned.entries()) {
        for (let slot = 0; slot < count; slot++) {
          const pool = WEEKLY_POOL_IDS[i];
          if (available(pool)) choices.push({ pool });
        }
      }
      if (choices.length)
        state.vaults.push({
          resetAtMs: state.resetAtMs,
          choices,
          raidUnlocks: [...state.raidUnlocks],
        });
    } else if (earned.some(Boolean)) state.overflowed = true;
    state.raids.fill(0);
    state.dungeons = [];
    state.world = state.pvp = 0;
  }
  const next = nextReset(nowMs);
  state.resetAtMs = Number.isSafeInteger(next) && next > nowMs ? next : Math.floor(nowMs) + WEEK_MS;
}
export function stateFor(ctx: SimContext, meta: PlayerMeta): WeeklyRewardState {
  meta.weeklyRewards ??= emptyWeeklyRewards();
  const state = meta.weeklyRewards;
  if (state.legacyPending) {
    const choices: WeeklyChoice[] = [];
    for (const [i, count] of state.legacyPending.entries()) {
      const pool = WEEKLY_POOL_IDS[i];
      if (!weeklyLootPool(pool, meta.cls).length) continue;
      const rowCount = choices.filter((c) => c.pool.split('_')[0] === pool.split('_')[0]).length;
      for (let n = 0; n < Math.min(count, 3 - rowCount); n++) choices.push({ pool });
    }
    if (choices.length)
      state.vaults.push({ resetAtMs: Math.max(1, state.resetAtMs - WEEK_MS), choices });
    delete state.legacyPending;
  }
  advanceWeeklyRewards(
    state,
    ctx.lockoutNowMs(),
    ctx.weeklyRaidResetMs,
    (pool) => weeklyLootPool(pool, meta.cls, state.raidUnlocks).length > 0,
  );
  return state;
}
export function nearWeeklyKeeper(ctx: SimContext, player: Entity): boolean {
  if (player.dead) return false;
  const npc = ctx.entities.get(WEEKLY_KEEPER_ENTITY_ID);
  return (
    npc?.templateId === WEEKLY_KEEPER_ID &&
    !npc.dead &&
    dist2d(player.pos, npc.pos) <= INTERACT_RANGE
  );
}
/** All conversation entry points share the same living, nearby keeper gate. */
export function talkToWeeklyKeeper(ctx: SimContext, npc: Entity, player: Entity): boolean {
  if (npc.templateId !== WEEKLY_KEEPER_ID) return false;
  if (npc.id === WEEKLY_KEEPER_ENTITY_ID && !npc.dead && nearWeeklyKeeper(ctx, player))
    ctx.emit({ type: 'weekly_rewards', pid: player.id });
  return true;
}
export function weeklyRewardInfoFor(ctx: SimContext, pid: number): WeeklyRewardInfo | null {
  const r = ctx.resolve(pid);
  if (!r || !nearWeeklyKeeper(ctx, r.e)) return null;
  const state = stateFor(ctx, r.meta);
  return {
    state: {
      resetAtMs: state.resetAtMs,
      claimSequence: state.claimSequence,
      world: state.world,
      pvp: state.pvp,
      overflowed: state.overflowed,
      raids: [...state.raids],
      dungeons: [...state.dungeons],
      raidUnlocks: [...state.raidUnlocks],
      vaults: state.vaults.slice(0, 1).map((batch) => ({
        resetAtMs: batch.resetAtMs,
        choices: batch.choices.map((choice) => ({
          pool: choice.pool,
          ...(choice.opened && !choice.pendingSave && choice.itemId
            ? { itemId: choice.itemId, opened: true as const }
            : {}),
          ...(choice.opening ? { opening: true } : {}),
        })),
      })),
    },
    nowMs: Math.floor(ctx.lockoutNowMs() / 1000) * 1000,
    canClaim: true,
    // Live whenever the previous raid tier holds something this class can wear
    // (every shipped class today); a class with no wearable piece sees the row
    // unavailable rather than an empty roll.
    worldQuestsAvailable: weeklyLootPool('world', r.meta.cls).length > 0,
    readyWeeks: state.vaults.length,
  };
}
// Call from #3847's creditWorldQuest after its once-only completion guard.
// No client command grants progress. Normal story quests never count here.
export function recordWeeklyWorldQuest(ctx: SimContext, pid: number): void {
  const meta = ctx.players.get(pid);
  if (!meta || meta.leaving) return;
  const state = stateFor(ctx, meta);
  state.world = Math.min(8, state.world + 1);
}
export function recordWeeklyPvpWin(ctx: SimContext, pid: number): void {
  const meta = ctx.players.get(pid);
  if (!meta || meta.leaving) return;
  const state = stateFor(ctx, meta);
  state.pvp = Math.min(5, state.pvp + 1);
}
export function recordWeeklyBossKill(
  ctx: SimContext,
  boss: Entity,
  recipients: readonly PlayerMeta[],
  inst: InstanceSlot | null,
): void {
  if (!inst || recipients.length === 0) return;
  const dungeon = DUNGEONS[inst.dungeonId];
  const tuning = HEROIC_DUNGEON_TUNING[inst.dungeonId];
  if (!dungeon || !tuning || tuning.finalBossId !== boss.templateId) return;
  const raid = (dungeon.suggestedPlayers ?? 0) >= RAID_MIN_PLAYERS;
  const eligible = new Map(recipients.map((meta) => [meta.entityId, meta]));
  for (const meta of instanceLockoutMetas(ctx, inst)) eligible.set(meta.entityId, meta);
  for (const meta of eligible.values()) {
    if (meta.leaving || (!recipients.includes(meta) && !inst.enteredBy.has(meta.entityId)))
      continue;
    const state = stateFor(ctx, meta);
    const tier = inst.difficulty === 'heroic' ? 2 : 1;
    if (raid) {
      const i = WEEKLY_RAID_BOSSES.indexOf(boss.templateId);
      if (i >= 0) {
        state.raids[i] = Math.max(state.raids[i], tier);
        state.raidUnlocks[i] = Math.max(state.raidUnlocks[i], tier);
      }
    } else {
      state.dungeons = [...state.dungeons, tier].sort((a, b) => b - a).slice(0, 8);
    }
  }
}
// Every loot-table id an instance's spawns drop at a difficulty (quest items and
// dead entries excluded); heroic swaps in the generated variant and adds the
// bespoke heroic boss table.
function collectInstanceLoot(
  dungeon: (typeof DUNGEONS)[keyof typeof DUNGEONS],
  difficulty: 'normal' | 'heroic',
  ids: Set<string>,
): void {
  for (const spawn of dungeon.spawns) {
    for (const entry of MOBS[spawn.mobId]?.loot ?? []) {
      if (
        entry.itemId &&
        !entry.questId &&
        entry.chance > 0 &&
        !(difficulty === 'heroic' && entry.normalOnly)
      )
        ids.add(heroicLootItemId(entry.itemId, difficulty === 'heroic'));
    }
    if (difficulty === 'heroic')
      for (const entry of HEROIC_BOSS_LOOT[spawn.mobId] ?? []) {
        if (entry.itemId && !entry.questId && entry.chance > 0) ids.add(entry.itemId);
      }
  }
}
// Exact catalog shared by preview and claim. Each eligible item is equally likely;
// class locks are respected, chase legendaries and non-equipment are excluded.
export function weeklyLootPool(
  pool: WeeklyPoolId,
  playerClass: PlayerClass,
  raidUnlocks?: readonly number[],
): string[] {
  const ids = new Set<string>();
  if (pool === 'pvp') for (const id of FURY_STOCK) ids.add(id);
  else if (pool === 'world') {
    // The world row is the catch-up shelf: every Normal drop of the previous raid
    // tier (Nythraxis, item level 29), ungated by kills because world quests earn
    // it, not the raid. The tier is pinned by tests/weekly_vault_world_row.test.ts.
    for (const dungeon of Object.values(DUNGEONS)) {
      if (HEROIC_DUNGEON_TUNING[dungeon.id]?.finalBossId !== NYTHRAXIS_BOSS_ID) continue;
      collectInstanceLoot(dungeon, 'normal', ids);
    }
  } else {
    const kind = pool.startsWith('raid') ? 'raid' : 'dungeon';
    const difficulty = pool.endsWith('heroic') ? 'heroic' : 'normal';
    for (const dungeon of Object.values(DUNGEONS)) {
      if (
        !HEROIC_DUNGEON_TUNING[dungeon.id] ||
        ((dungeon.suggestedPlayers ?? 0) >= RAID_MIN_PLAYERS ? 'raid' : 'dungeon') !== kind
      )
        continue;
      if (kind === 'raid' && raidUnlocks) {
        const index = WEEKLY_RAID_BOSSES.indexOf(HEROIC_DUNGEON_TUNING[dungeon.id].finalBossId);
        if (index < 0 || (raidUnlocks[index] ?? 0) < (difficulty === 'heroic' ? 2 : 1)) continue;
      }
      collectInstanceLoot(dungeon, difficulty, ids);
    }
  }
  return [...ids]
    .filter((id) => {
      const item = ITEMS[id];
      return (
        item &&
        (item.kind === 'weapon' || item.kind === 'armor' || item.kind === 'held_offhand') &&
        (item.quality === 'rare' || item.quality === 'epic') &&
        canEquipItem(playerClass, item) &&
        (!item.requiredClass || item.requiredClass.includes(playerClass))
      );
    })
    .sort();
}
export function claimWeeklyReward(
  ctx: SimContext,
  choiceKey: string,
  pid?: number,
  expectedToken?: string,
): void {
  const r = ctx.resolve(pid);
  if (!r || !nearWeeklyKeeper(ctx, r.e)) return;
  const state = stateFor(ctx, r.meta);
  const batch = state.vaults[0];
  if (
    !batch ||
    batch.resetAtMs > ctx.lockoutNowMs() ||
    state.claimSequence >= Number.MAX_SAFE_INTEGER
  )
    return;
  if (batch.choices.some((choice) => !choice.opened || choice.pendingSave || !choice.itemId))
    return;
  if (expectedToken !== undefined && expectedToken !== `${state.resetAtMs}:${state.claimSequence}`)
    return;
  const index = batch.choices.findIndex((_, i) => choiceKey === `${batch.resetAtMs}:${i}`);
  const choice = batch.choices[index];
  if (!choice?.itemId) return;
  const item = ITEMS[choice.itemId];
  if (!item || (item.requiredClass && !item.requiredClass.includes(r.meta.cls))) return;
  // Candidates are already fixed. Failed claims cannot reroll or consume the week.
  if (!ctx.canAddItem(choice.itemId, 1, r.e.id)) {
    bagsFullError(ctx, r.e.id);
    return;
  }
  state.vaults.shift();
  state.claimSequence++;
  state.overflowed = false;
  ctx.addItem(choice.itemId, 1, r.e.id);
}

export function spawnWeeklyKeeper(ctx: SimContext, def: NpcDef | undefined): void {
  const id = WEEKLY_KEEPER_ENTITY_ID;
  if (!def || ctx.entities.has(id)) return;
  ctx.addEntity(createNpc(id, def, ctx.groundPos(def.pos.x, def.pos.z)));
}

export {
  finishWeeklyRewardOpen,
  isWeeklyRewardOpeningCurrent,
  openWeeklyReward,
  prepareWeeklyRewardOpen,
  type WeeklyRewardOpening,
} from './weekly_reward_open';
