// Pure, host-agnostic view model for the Profession Schools board (rank-gated
// crafting institutions; first implementation: the Enchanters School, see
// src/sim/content/profession_schools.ts and src/sim/professions/schools.ts).
//
// The pure-core half of the pure-core + thin-consumer split (reference
// commission_order_view.ts, this family's closest sibling): walks the FULL
// school catalog (not just the viewer's memberships) so a not-yet-joined
// school still gets a row with a Join affordance, decorates each with the
// viewer's own membership (from the IWorld `professionSchools` projection)
// and the flat craft skill the join gate reads, and buckets the viewer's
// rotating tasks (already scoped to joined schools by the sim/server) under
// their owning school. DOM/i18n-free so tests/profession_school_view.test.ts
// can drive it directly.

import { PROFESSION_SCHOOLS, type SchoolTaskKind } from '../../../sim/content/profession_schools';
import type { ItemDef } from '../../../sim/types';
import type { PlayerProfessionSchoolsView } from '../../../world_api/professions';

export interface ProfessionSchoolTaskRow {
  taskId: string;
  schoolId: string;
  kind: SchoolTaskKind;
  requiredItemId: string;
  item?: ItemDef;
  requiredCount: number;
  points: number;
  /** Seconds until this task may be submitted again; 0 means submittable now. */
  readySeconds: number;
  ready: boolean;
}

export interface ProfessionSchoolRow {
  schoolId: string;
  professionId: string;
  /** True once the viewer holds a membership row (any points, any rank). */
  joined: boolean;
  points: number;
  /** The rank id the viewer's points resolve to; null while not a member. */
  rankId: string | null;
  sworn: boolean;
  /** Points needed for the next reachable rank; null once no higher rank is
   *  reachable (either the true top rank, or the highest rank without
   *  swornOnly while unsworn, in which case only swearing allegiance opens
   *  more headroom). Also null while not a member. */
  nextRankPoints: number | null;
  /** The flat craft skill required to join as an Initiate (content). */
  joinProficiency: number;
  /** The viewer's own flat craft skill in this school's profession right now. */
  playerCraftSkill: number;
  /** Whether the viewer's craft skill alone would let them join right now
   *  (the join gate's OTHER precondition, standing at the schoolmaster's
   *  station, has no IWorld read and is left to the sim's silent no-op: this
   *  is a hint, never a promise). Meaningless once already joined. */
  qualifiesToJoin: boolean;
  /** This school's rotating tasks, present only while joined (the IWorld
   *  projection already scopes tasks to joined schools). */
  tasks: readonly ProfessionSchoolTaskRow[];
}

export interface ProfessionSchoolsModel {
  schools: readonly ProfessionSchoolRow[];
}

/**
 * Build the school board model from the viewer's IWorld `professionSchools`
 * projection, the item table (for a task's required-item display), and the
 * viewer's flat craft skills (for the join-qualification hint). Read-only:
 * never mutates any of its inputs.
 */
export function buildProfessionSchoolsModel(
  view: PlayerProfessionSchoolsView,
  items: Record<string, ItemDef>,
  craftSkills: Readonly<Record<string, number>> = {},
): ProfessionSchoolsModel {
  const membershipBySchool = new Map(view.memberships.map((m) => [m.schoolId, m]));
  const tasksBySchool = new Map<string, ProfessionSchoolTaskRow[]>();
  for (const task of view.tasks) {
    const row: ProfessionSchoolTaskRow = {
      taskId: task.taskId,
      schoolId: task.schoolId,
      kind: task.kind,
      requiredItemId: task.requiredItemId,
      item: items[task.requiredItemId],
      requiredCount: task.requiredCount,
      points: task.points,
      readySeconds: task.readySeconds,
      ready: task.readySeconds === 0,
    };
    const list = tasksBySchool.get(task.schoolId);
    if (list) list.push(row);
    else tasksBySchool.set(task.schoolId, [row]);
  }
  const schools: ProfessionSchoolRow[] = PROFESSION_SCHOOLS.map((school) => {
    const membership = membershipBySchool.get(school.id);
    const playerCraftSkill = craftSkills[school.professionId] ?? 0;
    return {
      schoolId: school.id,
      professionId: school.professionId,
      joined: membership !== undefined,
      points: membership?.points ?? 0,
      rankId: membership?.rankId ?? null,
      sworn: membership?.sworn ?? false,
      nextRankPoints: membership?.nextRankPoints ?? null,
      joinProficiency: school.joinProficiency,
      playerCraftSkill,
      qualifiesToJoin: playerCraftSkill >= school.joinProficiency,
      tasks: tasksBySchool.get(school.id) ?? [],
    };
  });
  return { schools };
}
