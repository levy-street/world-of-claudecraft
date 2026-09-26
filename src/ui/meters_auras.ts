// Buff and Debuff uptime tracking for combat analysis.
// Records aura application and removal timestamps, computing total duration,
// uptime percentage, application count, source, and target.

export interface AuraUptimeEntry {
  name: string;
  targetId: number;
  targetName: string;
  sourceId?: number;
  sourceName?: string;
  isBuff: boolean;
  applications: number;
  uptimeSeconds: number;
  uptimePercent: number;
}

interface ActiveAuraInstance {
  gainedAtSec: number;
  sourceId?: number;
  sourceName?: string;
}

export class AuraUptimeTracker {
  // key: `${targetId}:${auraName}` -> list of active instances or aggregate stats
  private readonly active = new Map<string, ActiveAuraInstance>();
  private readonly totalUptime = new Map<
    string,
    {
      name: string;
      targetId: number;
      targetName: string;
      sourceId?: number;
      sourceName?: string;
      isBuff: boolean;
      applications: number;
      closedUptimeSec: number;
    }
  >();

  private key(targetId: number, auraName: string): string {
    return `${targetId}:${auraName}`;
  }

  recordAura(
    targetId: number,
    targetName: string,
    auraName: string,
    gained: boolean,
    nowSec: number,
    isBuff: boolean,
    sourceId?: number,
    sourceName?: string,
  ): void {
    const k = this.key(targetId, auraName);

    if (gained) {
      let rec = this.totalUptime.get(k);
      if (!rec) {
        rec = {
          name: auraName,
          targetId,
          targetName,
          sourceId,
          sourceName,
          isBuff,
          applications: 0,
          closedUptimeSec: 0,
        };
        this.totalUptime.set(k, rec);
      }
      rec.applications += 1;
      if (sourceName) rec.sourceName = sourceName;
      if (sourceId !== undefined) rec.sourceId = sourceId;

      this.active.set(k, {
        gainedAtSec: nowSec,
        sourceId,
        sourceName,
      });
    } else {
      // Aura faded
      const act = this.active.get(k);
      if (act) {
        const dur = Math.max(0, nowSec - act.gainedAtSec);
        const rec = this.totalUptime.get(k);
        if (rec) {
          rec.closedUptimeSec += dur;
        }
        this.active.delete(k);
      }
    }
  }

  getEntries(
    targetId: number | null,
    fightDurationSec: number,
    nowSec: number,
    isBuffFilter?: boolean,
  ): AuraUptimeEntry[] {
    const results: AuraUptimeEntry[] = [];
    const dur = Math.max(1, fightDurationSec);

    for (const [k, rec] of this.totalUptime) {
      if (targetId !== null && rec.targetId !== targetId) continue;
      if (isBuffFilter !== undefined && rec.isBuff !== isBuffFilter) continue;

      let totalSec = rec.closedUptimeSec;
      const act = this.active.get(k);
      if (act) {
        totalSec += Math.max(0, nowSec - act.gainedAtSec);
      }

      totalSec = Math.min(dur, totalSec);
      const uptimePercent = Math.min(100, Math.round((totalSec / dur) * 1000) / 10);

      results.push({
        name: rec.name,
        targetId: rec.targetId,
        targetName: rec.targetName,
        sourceId: rec.sourceId,
        sourceName: rec.sourceName,
        isBuff: rec.isBuff,
        applications: rec.applications,
        uptimeSeconds: Math.round(totalSec * 10) / 10,
        uptimePercent,
      });
    }

    // Sort descending by uptime %
    results.sort((a, b) => b.uptimePercent - a.uptimePercent);
    return results;
  }

  clear(): void {
    this.active.clear();
    this.totalUptime.clear();
  }
}
