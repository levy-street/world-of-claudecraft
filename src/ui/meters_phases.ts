// Boss Phase tracking and encounter phase filtering for combat meters.
// Enables raid testing and boss analysis per phase (e.g. Phase 1 vs Intermission vs Phase 2).

export interface PhaseMarker {
  name: string;
  startTimeSec: number;
  endTimeSec?: number;
}

export interface PhaseTallySnapshot {
  dmg: number;
  heal: number;
  dmgTaken: number;
  deaths: number;
  interrupts: number;
}

export function newPhaseTallySnapshot(): PhaseTallySnapshot {
  return {
    dmg: 0,
    heal: 0,
    dmgTaken: 0,
    deaths: 0,
    interrupts: 0,
  };
}

export class EncounterPhaseManager {
  private readonly phases: PhaseMarker[] = [];
  private currentPhaseName: string = 'Phase 1';

  constructor(startSec: number = 0) {
    this.phases.push({
      name: 'Phase 1',
      startTimeSec: startSec,
    });
  }

  get currentPhase(): string {
    return this.currentPhaseName;
  }

  get allPhases(): readonly PhaseMarker[] {
    return this.phases;
  }

  markPhase(name: string, nowSec: number): void {
    if (!name || name === this.currentPhaseName) return;

    // Close previous phase
    const prev = this.phases[this.phases.length - 1];
    if (prev && prev.endTimeSec === undefined) {
      prev.endTimeSec = nowSec;
    }

    this.currentPhaseName = name;
    this.phases.push({
      name,
      startTimeSec: nowSec,
    });
  }

  close(nowSec: number): void {
    const last = this.phases[this.phases.length - 1];
    if (last && last.endTimeSec === undefined) {
      last.endTimeSec = nowSec;
    }
  }

  phaseNames(): string[] {
    return this.phases.map((p) => p.name);
  }

  phaseDuration(name: string, encounterDurationSec: number): number {
    const p = this.phases.find((x) => x.name === name);
    if (!p) return encounterDurationSec;
    const end = p.endTimeSec ?? p.startTimeSec + encounterDurationSec;
    return Math.max(1, end - p.startTimeSec);
  }
}
