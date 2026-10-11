// Versioned, fixed routes: a geometry/physics change must mint a new version
// before its times can share a ladder. Old points-board records stay separate.
export const GLIDER_SCOREBOARD_COURSES = [
  { key: 'downs', courseId: 'galecrest_windrider_slalom' },
  { key: 'valleys', courseId: 'galecrest_practice_valleys' },
  { key: 'switchbacks', courseId: 'galecrest_practice_switchbacks' },
] as const;
export const GLIDER_SCORE_VERSION = 2;
export const GLIDER_RANKINGS_BOARD_ID = 'glider_launch_rankings';

export function gliderScoreboardId(courseId: string, period: 'daily' | 'lifetime'): string | null {
  const course = GLIDER_SCOREBOARD_COURSES.find((entry) => entry.courseId === courseId);
  return course ? `glider_${course.key}_v${GLIDER_SCORE_VERSION}_${period}` : null;
}

export function gliderScoreboardInfo(boardId: string) {
  for (const course of GLIDER_SCOREBOARD_COURSES) {
    for (const period of ['daily', 'lifetime'] as const) {
      if (gliderScoreboardId(course.courseId, period) === boardId) return { ...course, period };
    }
  }
  return null;
}
