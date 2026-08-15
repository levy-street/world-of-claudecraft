import type { Entity } from '../sim/types';

export interface DrainChannelVisualPlan {
  targetId: number;
  duration: number;
  demonic: boolean;
}

export function drainChannelVisualPlan(
  entity: Pick<
    Entity,
    'id' | 'castingAbility' | 'channeling' | 'castTargetId' | 'castRemaining' | 'dead' | 'auras'
  >,
): DrainChannelVisualPlan | null {
  if (
    entity.dead ||
    entity.castingAbility !== 'drain_life' ||
    !entity.channeling ||
    entity.castTargetId === null
  ) {
    return null;
  }
  return {
    targetId: entity.castTargetId,
    duration: Math.max(0.05, entity.castRemaining),
    demonic: entity.auras.some(
      (aura) => aura.kind === 'affliction_possession' && aura.remaining > 0,
    ),
  };
}

// Dynamic entity state is broadcast at 20 Hz and distance-throttled to at
// worst every fourth tick. Keep a fresh start cue authoritative for one full
// worst-case interval so an older same-target snapshot cannot shorten it.
const START_RECONCILE_DELAY = 0.25;

/**
 * Event stops outrun throttled remote snapshots. This latch prevents a stale
 * "still channeling" snapshot from resurrecting a tether after its stop cue.
 */
export class DrainChannelStopLatch {
  private readonly pending = new Map<
    number,
    { mode: 'started' | 'stopped'; targetId: number; reconcileAt: number }
  >();

  noteEvent(sourceId: number, targetId: number, duration: number, now: number): void {
    this.pending.set(sourceId, {
      mode: duration <= 0 ? 'stopped' : 'started',
      targetId,
      reconcileAt: now + START_RECONCILE_DELAY,
    });
  }

  allowsSnapshot(sourceId: number, targetId: number | null, now: number): boolean {
    const pending = this.pending.get(sourceId);
    if (!pending) return targetId !== null;

    if (pending.mode === 'started') {
      if (now < pending.reconcileAt) return false;
      this.pending.delete(sourceId);
      return targetId !== null;
    }

    if (targetId === null) {
      this.pending.delete(sourceId);
      return false;
    }
    if (targetId === pending.targetId && now < pending.reconcileAt) return false;

    // A different target is necessarily newer. The same target is accepted
    // after one worst-case replication window so a filtered recast start (or
    // stop) cannot leave the visual latched forever.
    this.pending.delete(sourceId);
    return true;
  }

  delete(sourceId: number): void {
    this.pending.delete(sourceId);
  }

  prune(sources: { has(sourceId: number): boolean }): void {
    for (const sourceId of this.pending.keys()) {
      if (!sources.has(sourceId)) this.pending.delete(sourceId);
    }
  }

  clear(): void {
    this.pending.clear();
  }
}
