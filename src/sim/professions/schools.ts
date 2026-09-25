// Profession Schools (rank-gated crafting institutions, first implementation:
// the Enchanters School). Membership, sworn allegiance, and the rotating
// task/points loop; the content table lives in content/profession_schools.ts,
// never here (see its header for the scope + anchor-NPC rationale).
//
// This module is `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/
// game/net imports, no Math.random/Date.now, no Sim import (PlayerMeta
// arrives type-only, the crafting.ts/training.ts idiom). Every action gates
// on standing within STATION_RADIUS of the school's anchor station
// (stations.ts isAtStation), the training.ts proximity precedent. Draws NO
// rng.

import {
  type ProfessionSchoolDef,
  type SchoolTaskDef,
  type SchoolTaskKind,
  schoolById,
  schoolTaskById,
} from '../content/profession_schools';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { applySchoolTaskReadiness, serializeSchoolTaskReadiness } from './school_persist';
import { isAtStation } from './stations';

/** Live per-player Profession Schools state (PlayerMeta.professionSchool).
 *  Absent for a character who has never interacted with a school
 *  (zero-default omission, the toolEffectSlots precedent). */
export interface ProfessionSchoolPlayerState {
  /** schoolId -> accumulated points. A key's presence IS membership; points
   *  never decrease and are never capped (schoolRankIndexFor caps the
   *  RANK a point total resolves to, never the total itself). */
  memberships: Record<string, number>;
  /** The one school, among memberships, whose swornOnly ranks are reachable.
   *  Null until the player has sworn to any school. */
  swornSchoolId: string | null;
  /** taskId -> the ABSOLUTE sim.time at or after which that task may be
   *  submitted again (the node_persist.ts readiness idiom). */
  taskReadyAt: Record<string, number>;
}

/** The sparse CharacterState fragment this state persists as. */
export interface SavedProfessionSchoolState {
  memberships?: Record<string, number>;
  swornSchoolId?: string;
  schoolTaskCooldowns?: Record<string, number>;
}

export function freshProfessionSchoolState(): ProfessionSchoolPlayerState {
  return { memberships: {}, swornSchoolId: null, taskReadyAt: {} };
}

// Corruption guard on load: PROFESSION_SCHOOLS ships exactly one school
// today, so a saved membership map anywhere near this size is a hand-edit or
// bad write, not real play (the known_recipe_ids MAX_KNOWN_RECIPE_IDS
// precedent).
const MAX_TRACKED_SCHOOLS = 64;

function sanitizeMemberships(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  let count = 0;
  for (const [schoolId, points] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= MAX_TRACKED_SCHOOLS) break;
    if (!schoolById(schoolId)) continue;
    if (typeof points !== 'number' || !Number.isFinite(points) || points < 0) continue;
    out[schoolId] = points;
    count++;
  }
  return out;
}

/** Load-side rebuild: anchors persisted task cooldowns at the current clock
 *  (applySchoolTaskReadiness) and drops any membership/allegiance a saved row
 *  no longer resolves against the live catalog. Always returns a fresh
 *  object; an absent/malformed `saved` loads to the fresh-character default. */
export function loadProfessionSchoolState(
  saved: SavedProfessionSchoolState | undefined | null,
  now: number,
): ProfessionSchoolPlayerState {
  const memberships = sanitizeMemberships(saved?.memberships);
  const swornSchoolId =
    saved?.swornSchoolId &&
    memberships[saved.swornSchoolId] !== undefined &&
    schoolById(saved.swornSchoolId)
      ? saved.swornSchoolId
      : null;
  return {
    memberships,
    swornSchoolId,
    taskReadyAt: applySchoolTaskReadiness(saved?.schoolTaskCooldowns, now),
  };
}

/** The sparse CharacterState fragment for one save: absent entirely for a
 *  character who has never joined a school. */
export function professionSchoolSaveFragment(
  state: ProfessionSchoolPlayerState | undefined,
  now: number,
): { professionSchool?: SavedProfessionSchoolState } {
  if (!state || Object.keys(state.memberships).length === 0) return {};
  const out: SavedProfessionSchoolState = { memberships: state.memberships };
  if (state.swornSchoolId) out.swornSchoolId = state.swornSchoolId;
  const cooldowns = serializeSchoolTaskReadiness(state.taskReadyAt, now);
  if (cooldowns) out.schoolTaskCooldowns = cooldowns;
  return { professionSchool: out };
}

function ensureSchoolState(meta: PlayerMeta): ProfessionSchoolPlayerState {
  if (!meta.professionSchool) meta.professionSchool = freshProfessionSchoolState();
  return meta.professionSchool;
}

/** The rank index `points` resolves to for `school`: the highest rank whose
 *  pointsRequired <= points, skipping every `swornOnly` rank unless `sworn`.
 *  Ranks are authored in ascending pointsRequired order (content/
 *  profession_schools.ts), so a plain walk taking the max eligible index is
 *  exact: an unsworn member simply never becomes eligible for a swornOnly
 *  rung, however many points they hold. */
export function schoolRankIndexFor(
  school: ProfessionSchoolDef,
  points: number,
  sworn: boolean,
): number {
  let index = 0;
  for (let i = 0; i < school.ranks.length; i++) {
    const rank = school.ranks[i];
    if (rank.swornOnly && !sworn) continue;
    if (points >= rank.pointsRequired) index = i;
  }
  return index;
}

/** True while `pid` may join `schoolId` right now: the school exists, they
 *  are not already a member, their flat craft skill in the school's
 *  profession meets joinProficiency, and they stand at the schoolmaster's
 *  station. */
export function canJoinProfessionSchool(ctx: SimContext, pid: number, schoolId: string): boolean {
  const school = schoolById(schoolId);
  if (!school) return false;
  const r = ctx.resolve(pid);
  if (!r) return false;
  if (r.meta.professionSchool?.memberships[schoolId] !== undefined) return false;
  const skill = r.meta.craftSkills[school.professionId] ?? 0;
  if (skill < school.joinProficiency) return false;
  return isAtStation(ctx.stationPlacements, r.e.pos, school.stationType);
}

/** Join `schoolId` as an Initiate (0 points). Silent no-op on any refused
 *  precondition (the deeds.ts setActiveTitle/setActiveBorder precedent: a
 *  membership action carries no cost to refund, so there is nothing a toast
 *  needs to explain beyond the affordance simply not being offered). */
export function joinProfessionSchool(ctx: SimContext, pid: number, schoolId: string): void {
  if (!canJoinProfessionSchool(ctx, pid, schoolId)) return;
  const r = ctx.resolve(pid);
  if (!r) return;
  ensureSchoolState(r.meta).memberships[schoolId] = 0;
}

/** Swear allegiance to `schoolId`: the ONE school (among memberships) whose
 *  swornOnly ranks become reachable. Requires standing membership and the
 *  same station proximity join does; silent no-op otherwise (the same
 *  precedent as joinProfessionSchool). Re-swearing to the already-sworn
 *  school, or switching to a different school already joined, both succeed:
 *  "switching fields is a real decision" per the feature request, never a
 *  point loss (memberships keep every school's own points). */
export function swearAllegiance(ctx: SimContext, pid: number, schoolId: string): void {
  const school = schoolById(schoolId);
  if (!school) return;
  const r = ctx.resolve(pid);
  if (!r) return;
  const state = r.meta.professionSchool;
  if (!state || state.memberships[schoolId] === undefined) return;
  if (!isAtStation(ctx.stationPlacements, r.e.pos, school.stationType)) return;
  state.swornSchoolId = schoolId;
}

export type SchoolTaskDenyReason =
  | 'unknown_task'
  | 'not_a_member'
  | 'out_of_range'
  | 'on_cooldown'
  | 'party_required'
  | 'insufficient_materials';

export interface SchoolTaskOutcome {
  ok: boolean;
  schoolId: string;
  taskId: string;
  reason?: SchoolTaskDenyReason;
  pointsAwarded?: number;
}

/**
 * Submit one rotating school task: on success, consumes `requiredCount` of
 * `requiredItemId` (all-or-nothing, the craftItem reagent-check precedent:
 * countItem gates BEFORE removeItem ever runs), awards `points` to the
 * player's membership total, and starts the task's own cooldown. Deny order
 * mirrors resolveTrain's replay-safety discipline (cheapest/most-decisive
 * checks first, no side effect on any deny arm):
 * 1. unknown taskId: 'unknown_task' (schoolId reports empty, nothing to name);
 * 2. not a member of the task's school: 'not_a_member';
 * 3. not at the school's anchor station: 'out_of_range';
 * 4. still on cooldown: 'on_cooldown';
 * 5. a weekly_group task with too small a party: 'party_required';
 * 6. materials short: 'insufficient_materials';
 * 7. otherwise ok.
 * Emits the personal, text-free `schoolTaskResult` event on EVERY outcome
 * (unlike trainRecipe's silent-deny arms above): unlike a membership action,
 * a task submission risks the player's materials, so a refused attempt still
 * owes feedback explaining nothing was consumed.
 */
export function submitSchoolTask(ctx: SimContext, pid: number, taskId: string): SchoolTaskOutcome {
  const outcome = resolveSchoolTaskSubmission(ctx, pid, taskId);
  const entityId = ctx.resolve(pid)?.e.id ?? pid;
  ctx.emit({
    type: 'schoolTaskResult',
    pid: entityId,
    ok: outcome.ok,
    schoolId: outcome.schoolId,
    taskId: outcome.taskId,
    reason: outcome.reason,
    pointsAwarded: outcome.pointsAwarded,
  });
  return outcome;
}

function resolveSchoolTaskSubmission(
  ctx: SimContext,
  pid: number,
  taskId: string,
): SchoolTaskOutcome {
  const task = schoolTaskById(taskId);
  if (!task) return { ok: false, schoolId: '', taskId, reason: 'unknown_task' };
  const school = schoolById(task.schoolId);
  if (!school) return { ok: false, schoolId: task.schoolId, taskId, reason: 'unknown_task' };
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, schoolId: school.id, taskId, reason: 'not_a_member' };
  const state = ensureSchoolState(r.meta);
  if (state.memberships[school.id] === undefined) {
    return { ok: false, schoolId: school.id, taskId, reason: 'not_a_member' };
  }
  if (!isAtStation(ctx.stationPlacements, r.e.pos, school.stationType)) {
    return { ok: false, schoolId: school.id, taskId, reason: 'out_of_range' };
  }
  const readyAt = state.taskReadyAt[taskId];
  if (readyAt !== undefined && readyAt > ctx.time) {
    return { ok: false, schoolId: school.id, taskId, reason: 'on_cooldown' };
  }
  if (task.minPartySize) {
    const party = ctx.partyOf(pid);
    if (!party || party.members.length < task.minPartySize) {
      return { ok: false, schoolId: school.id, taskId, reason: 'party_required' };
    }
  }
  if (ctx.countItem(task.requiredItemId, pid) < task.requiredCount) {
    return { ok: false, schoolId: school.id, taskId, reason: 'insufficient_materials' };
  }
  ctx.removeItem(task.requiredItemId, task.requiredCount, pid);
  state.memberships[school.id] += task.points;
  state.taskReadyAt[taskId] = ctx.time + task.cooldownSeconds;
  return { ok: true, schoolId: school.id, taskId, pointsAwarded: task.points };
}

/** One school membership as the HUD reads it: current points, the rank they
 *  resolve to right now, and (when a higher reachable rank exists) the points
 *  needed for it. `nextRankPoints` is null exactly when the player already
 *  sits at the highest rank reachable given their sworn status: either the
 *  catalog's true top rank, or (unsworn) the highest rank WITHOUT
 *  `swornOnly`, in which case swearing allegiance is what unlocks more,
 *  never further points alone. */
export interface SchoolMembershipView {
  schoolId: string;
  points: number;
  rankId: string;
  rankName: string;
  sworn: boolean;
  nextRankPoints: number | null;
}

/** One rotating task as the HUD reads it, scoped to schools the viewer has
 *  joined. `readySeconds` is 0 exactly when the task may be submitted now. */
export interface SchoolTaskView {
  taskId: string;
  schoolId: string;
  kind: SchoolTaskKind;
  requiredItemId: string;
  requiredCount: number;
  points: number;
  readySeconds: number;
}

export interface PlayerProfessionSchoolsView {
  memberships: readonly SchoolMembershipView[];
  tasks: readonly SchoolTaskView[];
}

const membershipViewFor = (
  schoolId: string,
  points: number,
  swornSchoolId: string | null,
): SchoolMembershipView | null => {
  const school = schoolById(schoolId);
  if (!school) return null;
  const sworn = swornSchoolId === schoolId;
  const rankIndex = schoolRankIndexFor(school, points, sworn);
  const rank = school.ranks[rankIndex];
  const nextReachable = school.ranks
    .slice(rankIndex + 1)
    .find((candidate) => !candidate.swornOnly || sworn);
  return {
    schoolId,
    points,
    rankId: rank.id,
    rankName: rank.name,
    sworn,
    nextRankPoints: nextReachable ? nextReachable.pointsRequired : null,
  };
};

/** Pure builder both hosts share: offline `Sim` calls it directly over live
 *  PlayerMeta; online `ClientWorld` calls it over its mirrored `schools`
 *  self-delta fields (the professionsState precedent), so the two can never
 *  compute a rank differently. */
export function professionSchoolsView(
  memberships: Readonly<Record<string, number>>,
  swornSchoolId: string | null,
  taskReadyAt: Readonly<Record<string, number>>,
  now: number,
): PlayerProfessionSchoolsView {
  const membershipViews = Object.entries(memberships)
    .map(([schoolId, points]) => membershipViewFor(schoolId, points, swornSchoolId))
    .filter((m): m is SchoolMembershipView => m !== null)
    .sort((a, b) => (a.schoolId < b.schoolId ? -1 : a.schoolId > b.schoolId ? 1 : 0));
  const tasks = membershipViews.flatMap((m) => {
    const school = schoolById(m.schoolId);
    if (!school) return [];
    return school.taskIds.map((taskId) => {
      const task = schoolTaskById(taskId);
      if (!task) return null;
      const readyAt = taskReadyAt[taskId];
      const readySeconds = readyAt !== undefined ? Math.max(0, readyAt - now) : 0;
      return {
        taskId,
        schoolId: task.schoolId,
        kind: task.kind,
        requiredItemId: task.requiredItemId,
        requiredCount: task.requiredCount,
        points: task.points,
        readySeconds,
      };
    });
  });
  return {
    memberships: membershipViews,
    tasks: tasks.filter((t): t is SchoolTaskView => t !== null),
  };
}

/** Sim-facing convenience: builds the view straight off SimContext for `pid`. */
export function professionSchoolsViewFor(
  ctx: SimContext,
  pid: number,
): PlayerProfessionSchoolsView {
  const state = ctx.resolve(pid)?.meta.professionSchool ?? freshProfessionSchoolState();
  return professionSchoolsView(state.memberships, state.swornSchoolId, state.taskReadyAt, ctx.time);
}
