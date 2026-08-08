// Masterwrought shared chase materials (Masterwrought phase 04): the faucets
// and gates for Wyrmfall Core and Maker's Ember. The item defs live in
// content/items.ts; the Sundered Essence extraction is its own sibling module
// (professions/sundering.ts). Consumers arrive with the apex recipe phases;
// until then this module is the complete income side of the system.
//
// Faucet map (rulings R4 / R9, docs/prd/masterwrought/state.md):
// - Wyrmfall Core: 1 to 3 per credited final-boss kill in the raid (either
//   difficulty) and the heroic five-mans, per participant, once per character
//   per source per reset day; rift A and S rank FIRST clears grant a
//   deterministic count once per character per day (rifts have no lockout;
//   the daily gate IS the cap); the Heroic Quartermaster sells one for
//   Heroic Marks (content/heroic_vendor.ts).
// - Maker's Ember: one per week per character, BANKABLE (missed weeks
//   accrue), granted on the first eligible endgame completion of the week
//   (raid boss, heroic final boss, or rift A/S clear).
//
// Determinism: the only randomness is ONE ctx.rng.int draw per credited
// eligible boss kill, and the call site (combat/damage.ts handleDeath) sits
// AFTER ctx.rollLoot returns, so the draw appends to the tick's sequence and
// never reorders loot rolls. The rift arm is deliberately draw-free, matching
// addRiftProgressionLoot's documented no-draw contract.
//
// Daily and weekly boundaries: everything keys on ctx.resetDay (the
// realm-local reset window; '' = no calendar known, nothing rolls over, the
// same contract as every other daily). The weekly boundary is DERIVED from
// resetDay by pure calendar math (the most recent weekly reset day on or
// before it), not from a second clock: the realm keeps exactly one reset
// boundary, per the phase 03 QA amendment.

import { HEROIC_DUNGEON_TUNING } from '../content/dungeon_difficulty';
import { instanceLockoutMetas } from '../instances/dungeons';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { NYTHRAXIS_BOSS_ID } from '../types';

export const WYRMFALL_CORE_ITEM_ID = 'wyrmfall_core';
export const SUNDERED_ESSENCE_ITEM_ID = 'sundered_essence';
export const MAKERS_EMBER_ITEM_ID = 'makers_ember';

// One rng draw per credited eligible final-boss kill; every participant of
// that kill shares the rolled count (recorded in state.md).
export const WYRMFALL_BOSS_MIN = 1;
export const WYRMFALL_BOSS_MAX = 3;

// Rift first-clear grants are deterministic (draw-free by design): the S rank
// pays the risk premium.
export const WYRMFALL_RIFT_COUNT: Readonly<Record<string, number>> = { A: 1, S: 2 };

// The daily-gate source token for the rift arm; instance arms use
// `${dungeonId}:${difficulty}` so the normal and heroic raid stay distinct
// sources, mirroring the difficulty-scoped raid lockout.
export const WYRMFALL_RIFT_SOURCE = 'rift';

// The civil weekday the ember week rolls on: Tuesday, the classic weekly
// reset day. Sunday = 0 to match the (days + 4) % 7 epoch arithmetic below.
export const EMBER_WEEK_RESET_DOW = 2;

// --- Pure calendar math (no Date, no clock, no Intl) -----------------------
// Howard Hinnant's days_from_civil: days since 1970-01-01 for a civil date.
// Pure integer arithmetic so the sim never touches the host Date machinery.
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor((yy >= 0 ? yy : yy - 399) / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

// The inverse (civil_from_days), used to render the week-anchor date string.
function civilFromDays(z: number): { y: number; m: number; d: number } {
  const zz = z + 719468;
  const era = Math.floor((zz >= 0 ? zz : zz - 146096) / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: m <= 2 ? y + 1 : y, m, d };
}

const RESET_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function resetDayToDayNumber(resetDay: string): number | null {
  const m = RESET_DAY_RE.exec(resetDay);
  if (!m) return null;
  return daysFromCivil(Number(m[1]), Number(m[2]), Number(m[3]));
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** The ember week a reset-day window belongs to, as the `YYYY-MM-DD` of the
 *  most recent weekly reset day (Tuesday) on or before it. '' in, '' out:
 *  no calendar known means no weekly boundary, the shared daily contract. */
export function emberWeekAnchorOf(resetDay: string): string {
  const dayNum = resetDayToDayNumber(resetDay);
  if (dayNum === null) return '';
  // 1970-01-01 was a Thursday; with Sunday = 0 that epoch day is dow 4.
  const dow = (((dayNum + 4) % 7) + 7) % 7;
  const back = (dow - EMBER_WEEK_RESET_DOW + 7) % 7;
  const { y, m, d } = civilFromDays(dayNum - back);
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Whole weeks from one week-anchor string to another (negative when `to`
 *  precedes `from`, 0 for the same week or unparseable input). */
export function emberWeeksBetween(from: string, to: string): number {
  const a = resetDayToDayNumber(from);
  const b = resetDayToDayNumber(to);
  if (a === null || b === null) return 0;
  return Math.floor((b - a) / 7);
}

// --- The daily gate ---------------------------------------------------------

/** Roll the wyrmfall daily window forward when the realm's reset day has
 *  moved (the delveDaily idiom): '' = unknown calendar, nothing rolls. */
export function refreshWyrmfallDaily(ctx: SimContext, meta: PlayerMeta): void {
  const today = ctx.resetDay;
  if (today && meta.wyrmfallDaily.date !== today) {
    meta.wyrmfallDaily = { date: today, sources: new Set() };
  }
}

// --- Maker's Ember ----------------------------------------------------------

/** The weekly keystone grant, run at every eligible endgame completion for a
 *  present participant. First-ever completion starts the accrual at one ember
 *  (no realm-age windfall); after that every elapsed week since the last
 *  granted week banks one more (R4: missed weeks accrue, uncapped). A stored
 *  anchor AHEAD of the current week (a rolled-back realm clock) grants
 *  nothing and self-heals when the calendar catches up. */
export function tryGrantMakersEmber(ctx: SimContext, meta: PlayerMeta): void {
  const anchor = emberWeekAnchorOf(ctx.resetDay);
  if (anchor === '') return;
  if (meta.emberWeekAnchor === '') {
    meta.emberWeekAnchor = anchor;
    ctx.addItem(MAKERS_EMBER_ITEM_ID, 1, meta.entityId);
    return;
  }
  const weeks = emberWeeksBetween(meta.emberWeekAnchor, anchor);
  if (weeks <= 0) return;
  meta.emberWeekAnchor = anchor;
  ctx.addItem(MAKERS_EMBER_ITEM_ID, weeks, meta.entityId);
}

// --- The boss faucet --------------------------------------------------------

/** Wyrmfall Cores for a final-boss kill, called from the death hub
 *  (combat/damage.ts) right after awardHeroicMarks with the same death-time
 *  participation snapshot. Eligible kills: the final boss of a HEROIC
 *  instance (the five-mans and the heroic raid, the awardHeroicMarks set) and
 *  the raid boss at normal difficulty (which pays no marks but is an endgame
 *  pillar for materials, ruling R4). Delivery mirrors the marks split:
 *  present at the corpse takes cores to bags, a participant who entered this
 *  run but is absent has them posted, roster membership alone is not income.
 *  The income gate is the per-character per-source reset-day window, NOT the
 *  lockout: the normal raid's kill-time lockout also strikes door-campers,
 *  and reusing it here would let one raid's gate shape leak into another's.
 *  Present participants also tick the weekly ember check: an eligible
 *  completion counts toward the keystone even when the core gate already
 *  closed today. */
export function awardWyrmfallCores(ctx: SimContext, mob: Entity, recipients: PlayerMeta[]): void {
  const inst = ctx.instances.find((i) => i.partyKey !== null && i.mobIds.includes(mob.id));
  if (!inst) return;
  const tuning = HEROIC_DUNGEON_TUNING[inst.dungeonId];
  const heroicFinal =
    inst.difficulty === 'heroic' && tuning !== undefined && mob.templateId === tuning.finalBossId;
  const normalRaidFinal = inst.difficulty !== 'heroic' && mob.templateId === NYTHRAXIS_BOSS_ID;
  if (!heroicFinal && !normalRaidFinal) return;
  // An uncredited death (empty participation snapshot) pays nobody, the
  // awardHeroicMarks rule, and draws nothing.
  if (recipients.length === 0) return;
  const count = ctx.rng.int(WYRMFALL_BOSS_MIN, WYRMFALL_BOSS_MAX);
  const sourceKey = `${inst.dungeonId}:${inst.difficulty}`;
  const presentIds = new Set(recipients.map((meta) => meta.entityId));
  const deliveryMetas = new Map<number, PlayerMeta>();
  for (const meta of instanceLockoutMetas(ctx, inst)) deliveryMetas.set(meta.entityId, meta);
  // A tap holder who left both party and instance before the kill remains in
  // the death snapshot and keeps their share (the marks precedent).
  for (const meta of recipients) deliveryMetas.set(meta.entityId, meta);
  for (const meta of deliveryMetas.values()) {
    const present = presentIds.has(meta.entityId);
    if (!present && !inst.enteredBy.has(meta.entityId)) continue;
    refreshWyrmfallDaily(ctx, meta);
    if (!meta.wyrmfallDaily.sources.has(sourceKey)) {
      meta.wyrmfallDaily.sources.add(sourceKey);
      if (present) ctx.addItem(WYRMFALL_CORE_ITEM_ID, count, meta.entityId);
      else ctx.mailWyrmfallCores(meta.entityId, count);
    }
    // The ember rides completion, not the core gate; absent participants
    // catch up through the bankable accrual on their next completion.
    if (present) tryGrantMakersEmber(ctx, meta);
  }
}

// --- The rift faucet --------------------------------------------------------

/** Materials for a WINNING rift first clear (called from completeRiftClear
 *  inside the claim.event arm): A and S rank grant the deterministic core
 *  count once per character per reset day across ALL rifts (ruling R9; the
 *  daily gate is the cap because rifts have no lockout), and every A/S
 *  participant ticks the weekly ember check. Draw-free on purpose. */
export function awardRiftFirstClearMaterials(
  ctx: SimContext,
  tier: string,
  participants: readonly number[],
): void {
  const count = WYRMFALL_RIFT_COUNT[tier] ?? 0;
  if (count === 0) return;
  for (const pid of participants) {
    const meta = ctx.players.get(pid);
    if (!meta) continue;
    refreshWyrmfallDaily(ctx, meta);
    if (!meta.wyrmfallDaily.sources.has(WYRMFALL_RIFT_SOURCE)) {
      meta.wyrmfallDaily.sources.add(WYRMFALL_RIFT_SOURCE);
      ctx.addItem(WYRMFALL_CORE_ITEM_ID, count, meta.entityId);
    }
    tryGrantMakersEmber(ctx, meta);
  }
}

/** The ember check alone, for an A/S rift clear that LOST the race
 *  (completeLosingRun's callers): losing the race forfeits the first-clear
 *  extras (the cores), but the run still cleared an endgame pillar, and the
 *  weekly keystone is mercy, not a race prize (ruling R4). */
export function grantRiftClearEmbers(
  ctx: SimContext,
  tier: string,
  participants: readonly number[],
): void {
  if (WYRMFALL_RIFT_COUNT[tier] === undefined) return;
  for (const pid of participants) {
    const meta = ctx.players.get(pid);
    if (meta) tryGrantMakersEmber(ctx, meta);
  }
}
