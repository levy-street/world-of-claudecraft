// Flat per-craft skill tracking (issue #1126). A player has one independent skill
// value for each of the ten crafts on the ring (see content/professions.ts). This is
// a flat model on purpose: no conserved-mass economy yet, so gains are purely
// additive and never draw down another craft's value. The wheel/mass-conservation
// mechanic (a later issue) will extend this file rather than replace it.
//
// Free-floor rule: crafting at the common tier never costs anything, regardless of
// whether conserved mass exists yet. Since this module has no cost/spend path at
// all (skill only ever goes up), that rule holds trivially: there is nothing here
// that could charge a common-tier craft.
//
// This module is `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/game/net
// imports, no Math.random/Date.now, host-agnostic so it runs offline, on the
// server, and in the headless RL env unchanged.

import { CRAFT_RING } from '../content/professions';
import type { SimContext } from '../sim_context';

/** Per-craft skill values, keyed by CraftDef.id. Every craft is always present. */
export type CraftSkills = Record<string, number>;

/** A fresh all-zero skill record covering every craft on the ring. */
export function emptyCraftSkills(): CraftSkills {
  const skills: CraftSkills = {};
  for (const craft of CRAFT_RING) skills[craft.id] = 0;
  return skills;
}

/** Backfill a persisted/partial record so every ring craft has an entry, without
 *  disturbing any value already present (additive back-compat: an older save with
 *  fewer or zero craft keys loads cleanly at 0 for the missing ones). */
export function normalizeCraftSkills(
  saved: Record<string, number> | undefined | null,
): CraftSkills {
  const skills = emptyCraftSkills();
  if (!saved) return skills;
  for (const craft of CRAFT_RING) {
    const value = saved[craft.id];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) skills[craft.id] = value;
  }
  return skills;
}

/** Additive-only skill gain for exactly one craft. Never touches any other craft's
 *  value (each of the ten crafts is an independent counter). A non-positive amount
 *  is a no-op; skill never goes negative. */
export function gainCraftSkill(skills: CraftSkills, craftId: string, amount: number): void {
  if (!(craftId in skills) || !(amount > 0)) return;
  skills[craftId] += amount;
}

/** Read surface: a copy of a player's ten craft skill values, keyed by craft id.
 *  Backs the IWorld `craftSkills` read (progression_xp facet). */
export function craftSkillsFor(ctx: SimContext, pid: number): CraftSkills {
  const meta = ctx.players.get(pid);
  return meta ? { ...meta.craftSkills } : emptyCraftSkills();
}
