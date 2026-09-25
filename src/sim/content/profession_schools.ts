// Profession Schools (rank-gated crafting institutions): data-as-code, exempt
// from module-first size rules per root CLAUDE.md (a declarative table, not
// logic). Mechanics live in ../professions/schools.ts behind the SimContext
// seam.
//
// Scope, per the adopted feature request (community doc "Profession Schools:
// rank-gated crafting institutions"): systems and data model only for this
// first pass. No enchant effects, recipes, or balance numbers are authored
// here; those come later as separate content passes once the school itself
// has shipped. First implementation: the Enchanters School.
//
// An institution is anchored at an existing, already-placed NPC rather than
// new world geometry: `enchanting` (content/professions.ts CRAFT_RING) has no
// physical station of its own (../professions/stations.ts), and its two
// existing trainer-taught recipes (the tool-effect charms) are already taught
// at the Eastbrook toolworks because that craft's work is sold there as tool
// upgrades (see the fallback-order note in ../professions/training.ts). Tinker
// Gizzel, the toolworks master, is the Enchanters School's schoolmaster for
// the same reason: it keeps this pass to systems and data (no new placement,
// no new render asset) while still anchoring the school at a real, walkable
// world location a player can stand in front of.
//
// Membership is per school: a player may hold points in several schools at
// once, but only the school they have SWORN allegiance to (swearAllegiance)
// can climb past its `swornOnly` ranks (see ../professions/schools.ts
// schoolRankIndexFor). Points are earned by submitting a rotating task
// (delivery contract, dungeon/Rift-sourced materials contract, or a
// party-gated weekly contract) at a cooldown, never by crafting itself: this
// keeps the school's own reward loop independent of the (still separate)
// recipe-gating extensibility point on ProfessionRecipeRecord
// (../professions/types.ts schoolId/schoolRankReq), which no shipped recipe
// uses yet.
//
// Naming audit (the IP rule): "Enchanters School" and its six rank names
// (Initiate/Apprentice/Journeyman/Adept/Master/Grandmaster) were web-verified
// against the seven wikis, verdict CLEAR/GENERIC, no collision; full verdict
// and recorded neighbours (WoW's own profession-tier ladder, Ultima Online's
// near-identical rank set) in docs/design/naming-audit.md, "Profession
// Schools: the Enchanters School".

import type { StationType } from '../types';

export type SchoolTaskKind = 'daily' | 'contract' | 'materials' | 'weekly_group';

/** One rung on a school's rank ladder. `swornOnly` ranks are reachable only
 *  while the player's swornSchoolId equals the school (see schoolRankIndexFor);
 *  every player who is a plain member (not sworn) caps out at the highest rank
 *  WITHOUT `swornOnly`, no matter how many points they hold. */
export interface SchoolRankDef {
  id: string;
  name: string;
  pointsRequired: number;
  swornOnly?: true;
}

/** A rotating task a school member can submit for points: a delivery of
 *  `requiredCount` of `requiredItemId`, consumed on success. `weekly_group`
 *  tasks additionally require the submitter to be in a party of at least
 *  `minPartySize` (the "weekly group task" the feature request names); every
 *  other kind is solo. `cooldownSeconds` is a flat per-player, per-task
 *  cooldown (../professions/school_persist.ts persists the remaining time
 *  across logout, the node_persist.ts scheme), not a calendar-day reset: the
 *  task rotates by cooldown alone, so no host calendar seam is needed for
 *  this first pass. */
export interface SchoolTaskDef {
  id: string;
  schoolId: string;
  kind: SchoolTaskKind;
  requiredItemId: string;
  requiredCount: number;
  points: number;
  cooldownSeconds: number;
  minPartySize?: number;
}

/** A profession school: a physical institution gating rare recipes behind
 *  membership + rank (the gating itself is the recipe-side extensibility
 *  point above; nothing in this table grants a recipe yet). `professionId` is
 *  a CraftDef id on CRAFT_RING (content/professions.ts). `joinProficiency` is
 *  the flat craft skill (../professions/wheel.ts CraftSkills) required to
 *  join as an Initiate. */
export interface ProfessionSchoolDef {
  id: string;
  professionId: string;
  name: string;
  npcId: string;
  zoneId: string;
  /** The physical station type the schoolmaster stands at (../professions/
   *  stations.ts isAtStation gates every membership action on proximity to
   *  one). `enchanting` itself has no station of its own; see the header. */
  stationType: StationType;
  joinProficiency: number;
  ranks: readonly SchoolRankDef[];
  taskIds: readonly string[];
}

const DAY_SECONDS = 24 * 60 * 60;
const WEEK_SECONDS = 7 * DAY_SECONDS;

export const ENCHANTERS_SCHOOL_ID = 'enchanters_school';

// Ranks: Initiate is the free join rank (0 points); Adept is the highest rank
// a plain (unsworn) member can reach; Master and Grandmaster are swornOnly,
// the feature request's "only your sworn school reaches the top ranks" rule.
export const ENCHANTERS_SCHOOL_RANKS: readonly SchoolRankDef[] = Object.freeze([
  { id: 'initiate', name: 'Initiate', pointsRequired: 0 },
  { id: 'apprentice', name: 'Apprentice', pointsRequired: 60 },
  { id: 'journeyman', name: 'Journeyman', pointsRequired: 180 },
  { id: 'adept', name: 'Adept', pointsRequired: 400 },
  { id: 'master', name: 'Master', pointsRequired: 750, swornOnly: true },
  { id: 'grandmaster', name: 'Grandmaster', pointsRequired: 1300, swornOnly: true },
]);

// Reuses shipped, already-catalogued enchanting reagents (content/enchants.ts)
// rather than inventing new materials: arcane_dust is the common base-tier
// reagent, arcane_essence the mid reagent, arcane_shard the epic-disenchant
// premium reagent the feature request's "sourcing materials from dungeons and
// Rifts" objective maps onto (epics are raid/Rift-tier drops).
export const SCHOOL_TASKS: readonly SchoolTaskDef[] = Object.freeze([
  {
    id: 'school_task_enchanters_daily_dust',
    schoolId: ENCHANTERS_SCHOOL_ID,
    kind: 'daily',
    requiredItemId: 'arcane_dust',
    requiredCount: 10,
    points: 15,
    cooldownSeconds: DAY_SECONDS,
  },
  {
    id: 'school_task_enchanters_contract_essence',
    schoolId: ENCHANTERS_SCHOOL_ID,
    kind: 'contract',
    requiredItemId: 'arcane_essence',
    requiredCount: 5,
    points: 30,
    cooldownSeconds: DAY_SECONDS,
  },
  {
    id: 'school_task_enchanters_materials_shard',
    schoolId: ENCHANTERS_SCHOOL_ID,
    kind: 'materials',
    requiredItemId: 'arcane_shard',
    requiredCount: 2,
    points: 50,
    cooldownSeconds: DAY_SECONDS,
  },
  {
    id: 'school_task_enchanters_weekly_group',
    schoolId: ENCHANTERS_SCHOOL_ID,
    kind: 'weekly_group',
    requiredItemId: 'arcane_shard',
    requiredCount: 3,
    points: 150,
    cooldownSeconds: WEEK_SECONDS,
    minPartySize: 2,
  },
]);

export const PROFESSION_SCHOOLS: readonly ProfessionSchoolDef[] = Object.freeze([
  {
    id: ENCHANTERS_SCHOOL_ID,
    professionId: 'enchanting',
    name: 'Enchanters School',
    npcId: 'tinker_gizzel',
    zoneId: 'eastbrook_vale',
    stationType: 'toolworks',
    joinProficiency: 25,
    ranks: ENCHANTERS_SCHOOL_RANKS,
    taskIds: SCHOOL_TASKS.filter((t) => t.schoolId === ENCHANTERS_SCHOOL_ID).map((t) => t.id),
  },
]);

const SCHOOLS_BY_ID: ReadonlyMap<string, ProfessionSchoolDef> = new Map(
  PROFESSION_SCHOOLS.map((s) => [s.id, s]),
);
const TASKS_BY_ID: ReadonlyMap<string, SchoolTaskDef> = new Map(SCHOOL_TASKS.map((t) => [t.id, t]));

export function schoolById(schoolId: string): ProfessionSchoolDef | undefined {
  return SCHOOLS_BY_ID.get(schoolId);
}

export function schoolTaskById(taskId: string): SchoolTaskDef | undefined {
  return TASKS_BY_ID.get(taskId);
}

export function schoolTasksFor(schoolId: string): SchoolTaskDef[] {
  return SCHOOL_TASKS.filter((t) => t.schoolId === schoolId);
}
