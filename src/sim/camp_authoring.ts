import type { CampDef, CampStatMods, Entity, MobTemplate } from './types';

/** Custom-map mob authoring ceiling. Boss templates already exceed player cap. */
export const MAX_AUTHORED_CAMP_LEVEL = 80;

// Editor stat-modifier clamps. A multiplier well under 1 makes a trivially
// squishy mob and well over 1 a mini-boss; both are legitimate authoring, so
// the range is wide but bounded (a hostile document cannot mint a 10^6-hp mob).
export const MOB_STAT_MOD_MIN = 0.1;
export const MOB_STAT_MOD_MAX = 10;
// Authored respawn-delay bounds, in seconds (0 would respawn inside the corpse
// window and thrash; the ceiling is one real hour).
export const MIN_CAMP_RESPAWN_SECONDS = 1;
export const MAX_CAMP_RESPAWN_SECONDS = 3600;
/** Seed value when a maker turns the default respawn OFF (the realm default). */
export const DEFAULT_MOB_RESPAWN_SECONDS = 25;

/** The stat keys the Mob tool exposes, in panel order. */
export const CAMP_STAT_MOD_KEYS = [
  'health',
  'damage',
  'armor',
  'moveSpeed',
  'attackSpeed',
  'scale',
] as const satisfies readonly (keyof CampStatMods)[];

function statMod(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(MOB_STAT_MOD_MIN, Math.min(MOB_STAT_MOD_MAX, value as number));
}

/** True when the mods object would change nothing (every entry is 1 / absent). */
export function campStatModsAreStock(mods: CampStatMods | undefined): boolean {
  if (!mods) return true;
  return CAMP_STAT_MOD_KEYS.every((key) => statMod(mods[key]) === 1);
}

/**
 * Stamp a camp's authored tuning onto one freshly created member: stat
 * multipliers, the per-camp respawn delay, and a deep copy of the patrol route
 * (never an alias of the shared map document). Every arm is gated on an
 * authored field being present, so a stock camp's mobs come out of this
 * untouched, the parity contract for the shipped world's spawns.
 *
 * Shared by the live Sim spawn loop and the editor's frozen camp preview so
 * what the maker sees in the viewport is what playtest spawns.
 */
export function applyCampMobTuning(camp: CampDef, mob: Entity): void {
  const mods = camp.statMods;
  if (mods) {
    const health = statMod(mods.health);
    if (health !== 1) {
      mob.maxHp = Math.max(1, Math.round(mob.maxHp * health));
      mob.hp = mob.maxHp;
    }
    const damage = statMod(mods.damage);
    if (damage !== 1) {
      mob.weapon.min = Math.max(1, Math.round(mob.weapon.min * damage));
      mob.weapon.max = Math.max(mob.weapon.min, Math.round(mob.weapon.max * damage));
    }
    const armor = statMod(mods.armor);
    if (armor !== 1) mob.stats.armor = Math.max(0, Math.round(mob.stats.armor * armor));
    const moveSpeed = statMod(mods.moveSpeed);
    if (moveSpeed !== 1) mob.moveSpeed = mob.moveSpeed * moveSpeed;
    // A LOWER attackSpeed multiplier means faster swings (the field is a swing
    // interval in seconds), so the panel labels it as swing time, not haste.
    const attackSpeed = statMod(mods.attackSpeed);
    if (attackSpeed !== 1) mob.weapon.speed = Math.max(0.2, mob.weapon.speed * attackSpeed);
    const scale = statMod(mods.scale);
    if (scale !== 1) mob.scale = mob.scale * scale;
  }
  if (Number.isFinite(camp.respawnSeconds)) {
    mob.campRespawnSeconds = Math.max(
      MIN_CAMP_RESPAWN_SECONDS,
      Math.min(MAX_CAMP_RESPAWN_SECONDS, camp.respawnSeconds as number),
    );
  }
  if (camp.route && camp.route.points.length >= 2) {
    mob.route = {
      points: camp.route.points.map((point) => ({ ...point })),
      mode: camp.route.mode,
      speed: camp.route.speed,
    };
  }
}

export interface CampLevelRange {
  min: number;
  max: number;
  overridden: boolean;
}

function campLevel(value: number | undefined, fallback: number): number {
  const resolved = Number.isFinite(value) ? Math.round(value as number) : fallback;
  return Math.max(1, Math.min(MAX_AUTHORED_CAMP_LEVEL, resolved));
}

/** Resolve and normalize a camp's optional level override against its template. */
export function resolveCampLevelRange(camp: CampDef, template: MobTemplate): CampLevelRange {
  const overridden = camp.levelMin !== undefined || camp.levelMax !== undefined;
  const rawMin = campLevel(camp.levelMin, template.minLevel);
  const rawMax = campLevel(camp.levelMax, template.maxLevel);
  return {
    min: Math.min(rawMin, rawMax),
    max: Math.max(rawMin, rawMax),
    overridden,
  };
}
