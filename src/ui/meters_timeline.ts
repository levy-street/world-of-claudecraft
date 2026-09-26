// Lightweight Combat Timeline model and renderer.
// Stores timestamped key encounter events (deaths, phase changes, interrupts, dispels)
// and renders a clean, compact timeline view.

import { fmtDuration } from './meters_format';

export interface TimelineEvent {
  timeSec: number;
  type: 'death' | 'phase' | 'interrupt' | 'dispel' | 'cooldown';
  label: string;
  source?: string;
  target?: string;
  badge?: string;
}

export const TIMELINE_CAP = 100;

export class EncounterTimeline {
  private readonly events: TimelineEvent[] = [];

  addEvent(event: TimelineEvent): void {
    this.events.push(event);
    if (this.events.length > TIMELINE_CAP) {
      this.events.shift();
    }
  }

  getEvents(): readonly TimelineEvent[] {
    return this.events;
  }

  clear(): void {
    this.events.length = 0;
  }
}

export interface TimelineRenderRow {
  timeFormatted: string;
  type: string;
  label: string;
  detail: string;
  icon: string;
}

export function buildTimelineRows(
  events: readonly TimelineEvent[],
  fightStartSec: number,
): TimelineRenderRow[] {
  return events.map((ev) => {
    const relSec = Math.max(0, ev.timeSec - fightStartSec);
    const timeFormatted = fmtDuration(relSec);

    let icon = '';
    let detail = '';

    if (ev.type === 'death') {
      icon = '[D]';
      detail = ev.source ? `killed by ${ev.source}` : 'died';
    } else if (ev.type === 'phase') {
      icon = '[P]';
      detail = 'Encounter Phase Transition';
    } else if (ev.type === 'interrupt') {
      icon = '[Int]';
      detail = ev.target ? `${ev.source ?? 'Player'} interrupted ${ev.target}` : 'Interrupt';
    } else if (ev.type === 'dispel') {
      icon = '[Disp]';
      detail = ev.target ? `${ev.source ?? 'Player'} dispelled ${ev.target}` : 'Dispel';
    } else {
      icon = '[*]';
      detail = ev.source ?? '';
    }

    return {
      timeFormatted,
      type: ev.type,
      label: ev.label,
      detail,
      icon,
    };
  });
}
