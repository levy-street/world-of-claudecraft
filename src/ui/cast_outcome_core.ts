export type CastOutcomeKind = 'success' | 'interrupted' | 'failed';

export interface CastOutcomeState {
  kind: CastOutcomeKind;
  label: string;
}

export interface CastOutcomeDurations {
  successMs: number;
  failureMs: number;
}

export interface CastOutcomeEntry {
  abilityId: string;
  kind: CastOutcomeKind;
  expiresAt: number;
}

export interface CastOutcomeTracker {
  labelsByEntity: Map<number, string>;
  outcomesByEntity: Map<number, CastOutcomeEntry>;
}

export function createCastOutcomeTracker(): CastOutcomeTracker {
  return {
    labelsByEntity: new Map(),
    outcomesByEntity: new Map(),
  };
}

export function noteCastVisible(
  tracker: CastOutcomeTracker,
  entityId: number,
  abilityId: string,
): void {
  tracker.labelsByEntity.set(entityId, abilityId);
}

export function noteCastHidden(tracker: CastOutcomeTracker, entityId: number): void {
  tracker.labelsByEntity.delete(entityId);
}

export function noteCastStart(
  tracker: CastOutcomeTracker,
  entityId: number,
  abilityId: string,
): void {
  tracker.labelsByEntity.set(entityId, abilityId);
  tracker.outcomesByEntity.delete(entityId);
}

export function noteCastStop(
  tracker: CastOutcomeTracker,
  entityId: number,
  success: boolean,
  now: number,
  durations: CastOutcomeDurations,
): void {
  const abilityId = tracker.labelsByEntity.get(entityId);
  tracker.labelsByEntity.delete(entityId);
  if (!abilityId) return;
  const kind: CastOutcomeKind = success ? 'success' : 'interrupted';
  tracker.outcomesByEntity.set(entityId, {
    abilityId,
    kind,
    expiresAt: now + (success ? durations.successMs : durations.failureMs),
  });
}

export function startCastOutcome(
  tracker: CastOutcomeTracker,
  entityId: number,
  abilityId: string,
  kind: CastOutcomeKind,
  now: number,
  durations: CastOutcomeDurations,
): void {
  tracker.labelsByEntity.delete(entityId);
  tracker.outcomesByEntity.set(entityId, {
    abilityId,
    kind,
    expiresAt: now + (kind === 'success' ? durations.successMs : durations.failureMs),
  });
}

export function activeCastOutcome(
  tracker: CastOutcomeTracker,
  entityId: number,
  now: number,
  resolveLabel: (abilityId: string) => string,
): CastOutcomeState | undefined {
  const outcome = tracker.outcomesByEntity.get(entityId);
  if (!outcome) return undefined;
  if (now >= outcome.expiresAt) {
    tracker.outcomesByEntity.delete(entityId);
    return undefined;
  }
  return { kind: outcome.kind, label: resolveLabel(outcome.abilityId) };
}

export function pruneExpiredCastOutcomes(tracker: CastOutcomeTracker, now: number): void {
  for (const [entityId, outcome] of tracker.outcomesByEntity) {
    if (now >= outcome.expiresAt) tracker.outcomesByEntity.delete(entityId);
  }
}

export function clearCastOutcomeEntity(tracker: CastOutcomeTracker, entityId: number): void {
  tracker.labelsByEntity.delete(entityId);
  tracker.outcomesByEntity.delete(entityId);
}

export function reconcileCastOutcomeEntities(
  tracker: CastOutcomeTracker,
  liveEntityIds: { has(entityId: number): boolean },
): void {
  for (const id of tracker.labelsByEntity.keys()) {
    if (!liveEntityIds.has(id)) tracker.labelsByEntity.delete(id);
  }
  for (const id of tracker.outcomesByEntity.keys()) {
    if (!liveEntityIds.has(id)) tracker.outcomesByEntity.delete(id);
  }
}

export function resetCastOutcomeTracker(tracker: CastOutcomeTracker): void {
  tracker.labelsByEntity.clear();
  tracker.outcomesByEntity.clear();
}
