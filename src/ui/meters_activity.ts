// Combat Activity and Active Time calculation.
//
// FORMULA AND DESIGN RATIONALE:
// Rather than defining activity as raw "alive time" or dropping activity on every
// millisecond between GCDs, combat activity is tracked as windows of engagement.
// When a player performs a combat action (damages, heals, or casts), an active window
// [t, t + GRACE_PERIOD] opens. Consecutive actions within GRACE_PERIOD merge into a
// single continuous active interval.
//
// GRACE_PERIOD = 3.5 seconds.
// This comfortably covers:
// - Standard Global Cooldown (1.0s - 1.5s)
// - Long cast times (2.0s - 3.0s, e.g. Holy Light, Pyroblast)
// - Brief repositioning / stutter steps during boss encounters
//
// At evaluation time:
// 1. All intervals are clamped to the fight bounds [fightStart, fightStart + fightDuration].
// 2. Overlapping or contiguous intervals are merged.
// 3. Active Time = sum of merged interval durations.
// 4. Activity % = clamp(0, 100, (Active Time / Fight Duration) * 100).

export const ACTIVITY_GRACE_PERIOD_SEC = 3.5;

export interface ActivityInterval {
  start: number; // seconds
  end: number; // seconds
}

export interface PlayerActivityResult {
  activeSeconds: number;
  activityPercent: number;
}

export class PlayerActivityTracker {
  private readonly actions = new Map<number, number[]>();

  recordAction(pid: number, timeSec: number): void {
    let list = this.actions.get(pid);
    if (!list) {
      list = [];
      this.actions.set(pid, list);
    }
    list.push(timeSec);
  }

  calculateActivity(
    pid: number,
    fightStartSec: number,
    fightDurationSec: number,
  ): PlayerActivityResult {
    if (fightDurationSec <= 0) {
      return { activeSeconds: 0, activityPercent: 0 };
    }

    const actionTimes = this.actions.get(pid);
    if (!actionTimes || actionTimes.length === 0) {
      return { activeSeconds: 0, activityPercent: 0 };
    }

    // Build raw intervals
    const fightEndSec = fightStartSec + fightDurationSec;
    const rawIntervals: ActivityInterval[] = [];

    for (const t of actionTimes) {
      const start = Math.max(fightStartSec, t);
      const end = Math.min(fightEndSec, t + ACTIVITY_GRACE_PERIOD_SEC);
      if (end > start) {
        rawIntervals.push({ start, end });
      }
    }

    if (rawIntervals.length === 0) {
      return { activeSeconds: 0, activityPercent: 0 };
    }

    // Sort intervals by start time
    rawIntervals.sort((a, b) => a.start - b.start);

    // Merge overlapping intervals
    const merged: ActivityInterval[] = [rawIntervals[0]];
    for (let i = 1; i < rawIntervals.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = rawIntervals[i];
      if (curr.start <= prev.end) {
        prev.end = Math.max(prev.end, curr.end);
      } else {
        merged.push(curr);
      }
    }

    let activeSeconds = 0;
    for (const interval of merged) {
      activeSeconds += interval.end - interval.start;
    }

    // Clamp activeSeconds to duration
    activeSeconds = Math.min(fightDurationSec, Math.max(0, activeSeconds));
    const activityPercent = Math.min(
      100,
      Math.round((activeSeconds / fightDurationSec) * 1000) / 10,
    );

    return {
      activeSeconds,
      activityPercent,
    };
  }

  clear(): void {
    this.actions.clear();
  }
}
