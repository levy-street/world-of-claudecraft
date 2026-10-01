// Pure view core for the mob inspect window (#mob-inspect-window): turns a
// creature's static template (family, rank, traits, loot table) plus the
// live stat block the authoritative sim answered with (IWorld.mobInspectInfo)
// into a DOM-free render model. The painter (mob_inspect_window.ts) only
// formats and paints it.
//
// The drop list mirrors the loot roller (src/sim/loot/loot_roll.ts rollLoot)
// rather than re-rolling anything: each plain entry is one independent
// chance roll; entries sharing a rollGroup are ONE draw partitioned by their
// chances, and groups that share items (one kill can award a second item from
// the shared list, since a later roll skips an already-won one) are solved
// together for exact per-kill odds (roll_group_odds_core.ts); a questId
// row only drops while the looter is on that quest; a normalOnly row skips a
// Heroic claim; coin rows roll 0.6x to 1.4x of the authored base. A mob that
// can be killed on a Heroic claim (it spawns in a heroic-capable instance, or
// carries a HEROIC_BOSS_LOOT table) also gets the whole Heroic table: the base
// rows minus normalOnly, each item swapped for its Heroic variant where that
// is an upgrade (heroicLootItemId, the roller's own swap), the heroicCopper
// coin base where authored, plus the boss's heroic-only append. NOT modeled:
// the post-roll quality upgrade (rollEnemyLootQuality), which changes a
// dropped copy's grade, never whether or what drops.
//
// Static content is read directly (the Loot Explorer precedent,
// src/ui/hud/loot_explorer/CLAUDE.md); only the per-spawn combat block needs
// the IWorld read, because instance tuning rewrites it at spawn.

import { HEROIC_BOSS_LOOT } from '../../../sim/content/heroic_loot';
import { MOBS } from '../../../sim/data';
import { HEROIC_DUNGEON_IDS } from '../../../sim/instances/difficulty';
import { heroicLootItemId } from '../../../sim/loot/heroic_item';
import {
  armorReduction,
  type Entity,
  type LootEntry,
  type MobFamily,
  type MobTemplate,
} from '../../../sim/types';
import type { MobInspectInfo } from '../../../world_api';
import { type TranslationKey, t } from '../../i18n';
import { type TargetRank, targetRankView } from '../../target_rank_view';
import { buildMobToDungeon } from '../loot_explorer/loot_explorer_view';
import { rollGroupClusters } from './roll_group_odds_core';

export type MobInspectStatsState = 'live' | 'pending' | 'unavailable';

export interface MobInspectStats {
  readonly weaponMin: number;
  readonly weaponMax: number;
  readonly attackSpeed: number;
  /** Average swing over the swing time. */
  readonly dps: number;
  readonly armor: number;
  /** Fraction (0..0.75) of the VIEWER's physical damage this armor removes. */
  readonly armorReduction: number;
}

export type MobInspectTrait = 'ccImmune' | 'slowImmune' | 'harvestable';

export interface MobInspectDropRow {
  readonly itemId: string;
  /** Per-kill probability, 0..1. */
  readonly chance: number;
  readonly questId: string | null;
  readonly normalOnly: boolean;
}

export interface MobInspectCoinRow {
  readonly min: number;
  readonly max: number;
  readonly chance: number;
}

/** A run of rows the painter draws together: the independent rows, or one
 *  cluster of exclusive roll groups (roll_group_odds_core.ts). A cluster of
 *  `rolls` 1 is one draw, so at most one of its rows drops per kill; a
 *  cluster of several rolls is pools that share items, rolled in turn with an
 *  already-won item skipped, so up to `rolls` DIFFERENT rows drop. Either way
 *  each row's chance is its exact per-kill odds. */
export interface MobInspectDropGroup {
  readonly exclusive: boolean;
  /** Draws behind the box: 0 for the independent rows. */
  readonly rolls: number;
  /** False when a cluster was too large to enumerate (summed chances shown). */
  readonly exact: boolean;
  readonly rows: readonly MobInspectDropRow[];
}

export interface MobInspectLootTable {
  readonly coins: readonly MobInspectCoinRow[];
  readonly groups: readonly MobInspectDropGroup[];
}

export interface MobInspectModel {
  readonly mobId: number;
  readonly templateId: string;
  readonly level: number;
  readonly maxHp: number;
  readonly rank: TargetRank;
  readonly rare: boolean;
  readonly worldBoss: boolean;
  readonly familyLabel: string;
  readonly statsState: MobInspectStatsState;
  readonly stats: MobInspectStats | null;
  readonly traits: readonly MobInspectTrait[];
  readonly loot: MobInspectLootTable;
  /** Rows that roll only on a Heroic claim; null when the mob has none. */
  readonly heroicLoot: MobInspectLootTable | null;
}

/** What the window knows about the inspected entity from the mirrored world. */
export interface MobInspectSubject {
  readonly id: number;
  readonly templateId: string;
  readonly level: number;
  readonly maxHp: number;
}

export interface MobInspectInput {
  readonly subject: MobInspectSubject;
  readonly viewerLevel: number;
  /** The live read's answer, or null when none has arrived. */
  readonly info: MobInspectInfo | null;
  /** True while the live read is still in flight. */
  readonly pending: boolean;
}

/** The inspect subject for a mirrored entity: an unowned mob only (never a
 *  player, NPC or anyone's pet), else null. */
export function mobInspectSubjectOf(
  e: Pick<Entity, 'id' | 'kind' | 'ownerId' | 'templateId' | 'level' | 'maxHp'> | null | undefined,
): MobInspectSubject | null {
  if (e?.kind !== 'mob' || e.ownerId !== null || !MOBS[e.templateId]) return null;
  return { id: e.id, templateId: e.templateId, level: e.level, maxHp: e.maxHp };
}

/** Creature-type label; demons have no guide.family entry (mob_tooltip_view). */
export function mobFamilyLabel(family: MobFamily): string {
  return family === 'demon'
    ? t('hudChrome.mobTooltip.familyDemon')
    : t(`guide.family.${family}.name` as TranslationKey);
}

function dropRow(entry: LootEntry & { itemId: string }): MobInspectDropRow {
  return {
    itemId: entry.itemId,
    chance: entry.chance,
    questId: entry.questId ?? null,
    normalOnly: entry.normalOnly === true,
  };
}

/** One loot table as the roller reads it. `useHeroicCopper` swaps a row's coin
 *  base for its heroicCopper, as a heroic claim does. Independent rows sort by
 *  chance (highest first, ties keep authored order) and list first; then each
 *  cluster of roll groups (groups that share items solved together, in roll
 *  order) lists its distinct items in first-appearance order. */
export function mobLootTable(
  entries: readonly LootEntry[],
  useHeroicCopper = false,
): MobInspectLootTable {
  const coins: MobInspectCoinRow[] = [];
  const independent: MobInspectDropRow[] = [];
  // Groups in ROLL order: the roller draws each on its first entry.
  const groups = new Map<string, LootEntry[]>();
  for (const entry of entries) {
    if (entry.rollGroup) {
      const group = groups.get(entry.rollGroup);
      if (group) group.push(entry);
      else groups.set(entry.rollGroup, [entry]);
      continue;
    }
    if (entry.copper) {
      const base =
        useHeroicCopper && entry.heroicCopper !== undefined ? entry.heroicCopper : entry.copper;
      coins.push({
        min: Math.ceil(base * 0.6),
        max: Math.ceil(base * 1.4),
        chance: entry.chance,
      });
    }
    if (entry.itemId) independent.push(dropRow(entry as LootEntry & { itemId: string }));
  }
  const sorted = independent
    .map((row, i) => ({ row, i }))
    .sort((a, b) => b.row.chance - a.row.chance || a.i - b.i)
    .map((x) => x.row);
  const out: MobInspectDropGroup[] = [];
  if (sorted.length > 0) out.push({ exclusive: false, rolls: 0, exact: true, rows: sorted });
  for (const cluster of rollGroupClusters(groups)) {
    const firstEntry = new Map<string, LootEntry>();
    for (const name of cluster.groups) {
      for (const entry of groups.get(name) ?? []) {
        if (entry.itemId && !firstEntry.has(entry.itemId)) firstEntry.set(entry.itemId, entry);
      }
    }
    const rows = cluster.itemIds.map((itemId) => {
      const entry = firstEntry.get(itemId) as LootEntry & { itemId: string };
      return { ...dropRow(entry), chance: cluster.odds.get(itemId) ?? 0 };
    });
    out.push({ exclusive: true, rolls: cluster.groups.length, exact: cluster.exact, rows });
  }
  return { coins, groups: out };
}

/** The mob's traits. Immunities come from the live read when there is one:
 *  combat checks the template flag OR the spawn's own flag (a promoted dungeon
 *  miniboss gains both at spawn), and only the authoritative sim knows the
 *  latter. Before the read lands, the template's flags are the best guess. */
export function mobInspectTraits(
  template: MobTemplate,
  info: Pick<MobInspectInfo, 'ccImmune' | 'slowImmune'> | null = null,
): MobInspectTrait[] {
  const traits: MobInspectTrait[] = [];
  if (info ? info.ccImmune : template.ccImmune) traits.push('ccImmune');
  if (info ? info.slowImmune : template.slowImmune) traits.push('slowImmune');
  if (template.componentTags && template.componentTags.length > 0) traits.push('harvestable');
  return traits;
}

function liveStats(info: MobInspectInfo, viewerLevel: number): MobInspectStats {
  const avg = (info.weaponMin + info.weaponMax) / 2;
  return {
    weaponMin: info.weaponMin,
    weaponMax: info.weaponMax,
    attackSpeed: info.attackSpeed,
    dps: info.attackSpeed > 0 ? avg / info.attackSpeed : 0,
    armor: info.armor,
    armorReduction: armorReduction(info.armor, Math.max(1, viewerLevel)),
  };
}

/** The whole window model, or null when the subject names no mob template.
 *  A live answer for a DIFFERENT mob than the subject is ignored (read as
 *  unavailable), never shown against the wrong creature. */
export function buildMobInspectModel(input: MobInspectInput): MobInspectModel | null {
  const { subject } = input;
  const template = MOBS[subject.templateId];
  if (!template) return null;
  const info = input.info && input.info.mobId === subject.id ? input.info : null;
  const statsState: MobInspectStatsState = info
    ? 'live'
    : input.pending
      ? 'pending'
      : 'unavailable';
  const heroicEntries = mobHeroicLootEntries(template);
  return {
    mobId: subject.id,
    templateId: template.id,
    level: info?.level ?? subject.level,
    maxHp: info?.maxHp ?? subject.maxHp,
    rank: targetRankView(template),
    rare: template.rare === true,
    worldBoss: template.worldBoss === true,
    familyLabel: mobFamilyLabel(template.family),
    statsState,
    stats: info ? liveStats(info, input.viewerLevel) : null,
    traits: mobInspectTraits(template, info),
    loot: mobLootTable(template.loot),
    heroicLoot: heroicEntries ? mobLootTable(heroicEntries, true) : null,
  };
}

let heroicCapable: ReadonlySet<string> | null = null;

/** Mob ids a Heroic claim can cover: every HEROIC_BOSS_LOOT owner plus every
 *  mob that spawns in a heroic-capable instance. Static, so built once. */
function heroicCapableMobs(): ReadonlySet<string> {
  if (!heroicCapable) {
    const ids = new Set(Object.keys(HEROIC_BOSS_LOOT));
    for (const [mobId, dungeonId] of buildMobToDungeon()) {
      if (HEROIC_DUNGEON_IDS.has(dungeonId)) ids.add(mobId);
    }
    heroicCapable = ids;
  }
  return heroicCapable;
}

/** The loot entries a Heroic claim rolls for this mob (the roller's heroic
 *  path: normalOnly rows skipped, items swapped to their Heroic variant,
 *  the boss's heroic append after), or null when no Heroic claim can cover it. */
export function mobHeroicLootEntries(template: MobTemplate): LootEntry[] | null {
  if (!heroicCapableMobs().has(template.id)) return null;
  const base = template.loot
    .filter((e) => !e.normalOnly)
    .map((e) => (e.itemId ? { ...e, itemId: heroicLootItemId(e.itemId, true) } : e));
  return [...base, ...(HEROIC_BOSS_LOOT[template.id] ?? [])];
}
