export type MatrixTargetPolicy = 'enemy' | 'boss' | 'self' | 'activeTank' | 'accomplice';

export interface MatrixAction {
  ability: string;
  target?: MatrixTargetPolicy;
  aim?: 'target';
}

export interface MatrixActionContext {
  selfId: number;
  enemyId: number;
  bossId: number;
  activeTankId: number;
  accompliceId: number;
  positions: ReadonlyMap<number, { x: number; z: number }>;
}

export interface ResolvedMatrixAction {
  ability: string;
  targetId: number;
  aim?: { x: number; z: number };
}

function targetIdFor(policy: MatrixTargetPolicy, context: MatrixActionContext): number {
  if (policy === 'boss') return context.bossId;
  if (policy === 'self') return context.selfId;
  if (policy === 'activeTank') return context.activeTankId;
  if (policy === 'accomplice') return context.accompliceId;
  return context.enemyId;
}

export function resolveMatrixAction(
  action: MatrixAction,
  context: MatrixActionContext,
): ResolvedMatrixAction {
  const targetId = targetIdFor(action.target ?? 'enemy', context);
  if (action.aim !== 'target') return { ability: action.ability, targetId };
  const position = context.positions.get(targetId);
  if (!position) throw new Error(`No position for matrix target ${targetId}`);
  return { ability: action.ability, targetId, aim: { ...position } };
}

export function combatElapsed(now: number, combatStart: number): number {
  if (now < combatStart) throw new Error('Simulation time is before combat start');
  return now - combatStart;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function selectPairedBaselines<T>(
  baselines: readonly T[],
  limit: number,
  keyOf: (baseline: T) => string,
): T[] {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Paired baseline limit must be a positive integer');
  }
  return [...baselines]
    .sort((left, right) => {
      const leftKey = keyOf(left);
      const rightKey = keyOf(right);
      return hashString(leftKey) - hashString(rightKey) || leftKey.localeCompare(rightKey);
    })
    .slice(0, limit);
}

export function expandPairedPlans<T, V>(
  baselines: readonly T[],
  variants: readonly V[],
): { baseline: T; variant: V }[] {
  return baselines.flatMap((baseline) => variants.map((variant) => ({ baseline, variant })));
}

export interface SampleStats {
  n: number;
  mean: number;
  standardDeviation: number;
  confidence95: number;
}

export function sampleStats(values: readonly number[]): SampleStats {
  if (values.length === 0) {
    return { n: 0, mean: 0, standardDeviation: 0, confidence95: 0 };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (values.length === 1) {
    return { n: 1, mean, standardDeviation: 0, confidence95: 0 };
  }
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const standardDeviation = Math.sqrt(variance);
  return {
    n: values.length,
    mean,
    standardDeviation,
    confidence95: (1.96 * standardDeviation) / Math.sqrt(values.length),
  };
}
