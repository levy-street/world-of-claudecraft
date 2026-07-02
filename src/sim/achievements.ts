type AchievementCounterKey = 'kills' | 'deaths' | 'xpGained' | 'questsCompleted' | 'levelUps';

export type AchievementCriterion =
  | { kind: 'level'; value: number }
  | { kind: 'lifetimeXp'; value: number }
  | { kind: 'counter'; counter: AchievementCounterKey; value: number };

export interface AchievementDef {
  id: string;
  nameKey: `achievements.${string}.name`;
  descriptionKey: `achievements.${string}.description`;
  points: number;
  criterion: AchievementCriterion;
}

export interface AchievementState {
  unlocked: string[];
  points: number;
}

export interface AchievementEvaluationInput {
  level: number;
  lifetimeXp: number;
  counters: Record<AchievementCounterKey, number>;
}

export const ACHIEVEMENTS = [
  {
    id: 'level_10',
    nameKey: 'achievements.level_10.name',
    descriptionKey: 'achievements.level_10.description',
    points: 10,
    criterion: { kind: 'level', value: 10 },
  },
  {
    id: 'level_20',
    nameKey: 'achievements.level_20.name',
    descriptionKey: 'achievements.level_20.description',
    points: 20,
    criterion: { kind: 'level', value: 20 },
  },
  {
    id: 'lifetime_xp_1000',
    nameKey: 'achievements.lifetime_xp_1000.name',
    descriptionKey: 'achievements.lifetime_xp_1000.description',
    points: 5,
    criterion: { kind: 'lifetimeXp', value: 1_000 },
  },
  {
    id: 'kills_10',
    nameKey: 'achievements.kills_10.name',
    descriptionKey: 'achievements.kills_10.description',
    points: 10,
    criterion: { kind: 'counter', counter: 'kills', value: 10 },
  },
] as const satisfies readonly AchievementDef[];

const ACHIEVEMENT_BY_ID: ReadonlyMap<string, AchievementDef> = new Map(
  ACHIEVEMENTS.map<[string, AchievementDef]>((achievement) => [achievement.id, achievement]),
);
const ACHIEVEMENT_ORDER: ReadonlyMap<string, number> = new Map(
  ACHIEVEMENTS.map<[string, number]>((achievement, i) => [achievement.id, i]),
);

export function emptyAchievementState(): AchievementState {
  return { unlocked: [], points: 0 };
}

export function cloneAchievementState(state: AchievementState): AchievementState {
  return { unlocked: [...state.unlocked], points: state.points };
}

export function normalizeAchievementState(
  state?: Partial<AchievementState> | null,
): AchievementState {
  const seen = new Set<string>();
  const unlocked: string[] = [];
  for (const id of state?.unlocked ?? []) {
    if (!ACHIEVEMENT_BY_ID.has(id) || seen.has(id)) continue;
    seen.add(id);
    unlocked.push(id);
  }
  unlocked.sort(compareAchievementIds);
  return { unlocked, points: pointsFor(unlocked) };
}

export function unlockAchievement(state: AchievementState, achievementId: string): boolean {
  if (!ACHIEVEMENT_BY_ID.has(achievementId) || state.unlocked.includes(achievementId)) return false;
  state.unlocked.push(achievementId);
  state.unlocked.sort(compareAchievementIds);
  state.points = pointsFor(state.unlocked);
  return true;
}

export function evaluateAchievements(input: AchievementEvaluationInput): string[] {
  return ACHIEVEMENTS.filter((achievement) => criterionMet(achievement.criterion, input)).map(
    (achievement) => achievement.id,
  );
}

export function applyAchievementEvaluation(
  state: AchievementState,
  input: AchievementEvaluationInput,
): string[] {
  const newlyUnlocked: string[] = [];
  for (const achievementId of evaluateAchievements(input)) {
    if (unlockAchievement(state, achievementId)) newlyUnlocked.push(achievementId);
  }
  return newlyUnlocked;
}

function criterionMet(criterion: AchievementCriterion, input: AchievementEvaluationInput): boolean {
  switch (criterion.kind) {
    case 'level':
      return input.level >= criterion.value;
    case 'lifetimeXp':
      return input.lifetimeXp >= criterion.value;
    case 'counter':
      return input.counters[criterion.counter] >= criterion.value;
  }
}

function compareAchievementIds(a: string, b: string): number {
  return (
    (ACHIEVEMENT_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER) -
    (ACHIEVEMENT_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER)
  );
}

function pointsFor(unlocked: readonly string[]): number {
  return unlocked.reduce((sum, id) => sum + (ACHIEVEMENT_BY_ID.get(id)?.points ?? 0), 0);
}
