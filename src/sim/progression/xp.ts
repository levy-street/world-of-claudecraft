// XP / progression slice (G1b): the residual XP-shaping surface C1 deliberately
// left on Sim. C1 owns the grantXp core (src/sim/combat/damage.ts); this module
// holds the cosmetic `prestige` command and the rested-XP accrual
// (`updateRested` / `isResting`), MOVED verbatim out of sim.ts behind SimContext
// (move + import, not a rewrite). The XP curve formulas (xpForLevel / canPrestige)
// stay pure in ../types and are imported here.
import { PROPS } from '../data';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { canPrestige, DT, type Entity, MAX_LEVEL, xpForLevel } from '../types';

// Rested-XP tuning. Consumed only by updateRested / isResting below.
const RESTED_SECONDS_PER_GAME_HOUR = 60; // 1 in-game hour = 60 sim seconds
const RESTED_FILL_FRACTION = 0.05; // a full "bubble" = 5% of the level's XP-to-level
const RESTED_FILL_HOURS = 8; // accrued per this many in-game hours of resting
const RESTED_CAP_LEVELS = 1.5; // pool clamps to 1.5 levels of XP, the classic-era cap
const RESTED_INN_PADDING = 2; // yards of slack around the inn footprint that still counts as resting

// True while the player is standing in (or just beside) an inn footprint and
// out of combat — the classic "resting" state that accrues rested XP.
export function isResting(p: Entity): boolean {
  if (p.inCombat) return false;
  for (const b of PROPS.buildings) {
    if (b.kind !== 'inn') continue;
    // Point-in-rotated-rect: bring the player into the inn's local frame.
    const dx = p.pos.x - b.x;
    const dz = p.pos.z - b.z;
    const cos = Math.cos(-b.rot);
    const sin = Math.sin(-b.rot);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    if (
      Math.abs(lx) <= b.w / 2 + RESTED_INN_PADDING &&
      Math.abs(lz) <= b.d / 2 + RESTED_INN_PADDING
    )
      return true;
  }
  return false;
}

// Accrue rested XP while resting in an inn. Classic-era rate: 5% of the level's
// XP-to-level per 8 in-game hours, clamped to 1.5 levels. Deterministic —
// paced off DT, never wall-clock. No accrual at the cap (no level bar).
export function updateRested(p: Entity, meta: PlayerMeta): void {
  if (p.level >= MAX_LEVEL) return;
  const cap = RESTED_CAP_LEVELS * xpForLevel(p.level);
  if (meta.restedXp >= cap) {
    meta.restedXp = cap;
    return;
  }
  if (!isResting(p)) return;
  const fillSeconds = RESTED_FILL_HOURS * RESTED_SECONDS_PER_GAME_HOUR;
  const perSecond = (RESTED_FILL_FRACTION * xpForLevel(p.level)) / fillSeconds;
  meta.restedXp = Math.min(cap, meta.restedXp + perSecond * DT);
}

// Opt-in cosmetic prestige: only at the cap. Resets the level XP
// bar, bumps the prestige rank for a badge by the name + on the leaderboard,
// and deliberately leaves lifetimeXp, level, gear, talents, and learned
// abilities untouched — strictly cosmetic, zero power change (FR-6.1/6.3).
export function prestige(ctx: SimContext, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  // Authoritative anti-abuse gate: must be at the cap AND have earned a full
  // prestige bar of post-cap XP since the last rank. This caps prestigeRank at
  // what lifetimeXp supports, so spamming the `prestige` command (e.g. from a
  // hacked client) can never inflate the rank beyond XP actually earned.
  if (!canPrestige(r.e.level, r.meta.lifetimeXp, r.meta.prestigeRank)) return false;
  r.meta.xp = 0;
  r.meta.prestigeRank += 1;
  // The prestige rank is a persisted deed trigger input, so re-check.
  ctx.markDeedsDirty(r.meta.entityId);
  ctx.emit({
    type: 'log',
    pid: r.e.id,
    text: `You have prestiged! Prestige Rank ${r.meta.prestigeRank}.`,
    color: '#ffd100',
  });
  return true;
}
