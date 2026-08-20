import type { NoteEvent, Theme } from './music';

type Instrument = NoteEvent['inst'];

export const IGNIVAR_RAID_THEME_KEYS = [
  'ignivar_forge_approach',
  'ignivar_raid_arena',
  'ignivar_inner_crucible',
] as const;

export type IgnivarRaidThemeKey = (typeof IGNIVAR_RAID_THEME_KEYS)[number];

// The four-note "first tempering" idea binds the three rooms together. Each
// arrangement keeps the same semitone contour while changing register,
// orchestration, and rhythmic scale to suit the room.
export const IGNIVAR_FORGE_LEITMOTIF_INTERVALS = [0, 3, 1, 7] as const;

function note(
  events: NoteEvent[],
  beat: number,
  midi: number,
  dur: number,
  vel: number,
  inst: Instrument,
): void {
  events.push({ beat, midi, dur, vel, inst });
}

function minorTriad(root: number): readonly [number, number, number] {
  return [root, root + 3, root + 7];
}

function addForgeLeitmotif(
  events: NoteEvent[],
  startBeat: number,
  root: number,
  step: number,
  velocity: number,
  inst: Instrument,
): void {
  IGNIVAR_FORGE_LEITMOTIF_INTERVALS.forEach((interval, index) => {
    note(events, startBeat + index * step, root + interval, step * 0.82, velocity, inst);
  });
}

function addAnvilSignature(
  events: NoteEvent[],
  barBeat: number,
  root: number,
  velocity: number,
): void {
  const strikes = [0, 1.5, 2.5, 3.5];
  for (const strike of strikes) {
    note(events, barBeat + strike, root, 0.12, velocity, 'woodBlock');
  }
}

function finish(bpm: number, bars: number, events: NoteEvent[]): Theme {
  events.sort((a, b) => a.beat - b.beat || a.midi - b.midi);
  return { bpm, bars, events };
}

/** Halls of the First Tempering: restrained machinery slowly waking up. */
export function composeIgnivarForgeApproach(): Theme {
  const events: NoteEvent[] = [];
  const roots = [38, 39, 38, 36, 38, 41, 39, 36, 38, 39, 43, 41, 38, 36, 39, 38];

  roots.forEach((root, bar) => {
    const beat = bar * 4;
    const chord = minorTriad(root + 12);
    note(events, beat, root, 3.8, 0.35, 'bass');
    note(events, beat, chord[0], 3.9, 0.16, 'pad');
    note(events, beat, chord[1], 3.9, 0.13, 'pad');
    note(events, beat, chord[2], 3.9, 0.12, 'pad');
    addAnvilSignature(events, beat, root + 24, bar % 4 === 0 ? 0.42 : 0.28);

    // The assembly line ticks in eighth notes, but leaves the end of each
    // fourth bar open so the room breathes before the next machine starts.
    if (bar % 4 !== 3) {
      const pattern = [chord[0], chord[2], chord[1], chord[2]];
      for (let index = 0; index < 8; index++) {
        note(
          events,
          beat + index * 0.5,
          pattern[index % pattern.length] + 12,
          0.32,
          0.18,
          'dulcimer',
        );
      }
    }
    if (bar % 2 === 0) {
      note(events, beat, root - 12, 0.3, 0.34, 'frameDrum');
      note(events, beat + 2.5, root - 12, 0.24, 0.23, 'frameDrum');
    }
  });

  for (const start of [0, 16, 32, 48]) {
    addForgeLeitmotif(events, start + 0.5, 62, 1, 0.29, 'reed');
    addForgeLeitmotif(events, start + 8.5, 60, 1, 0.22, 'reed');
  }
  return finish(76, 16, events);
}

/** Ignivar's arena: the same forge language turned into a watchful war hymn. */
export function composeIgnivarRaidArena(): Theme {
  const events: NoteEvent[] = [];
  const roots = [40, 40, 41, 38, 40, 43, 41, 38, 40, 45, 43, 41, 40, 38, 41, 40];

  roots.forEach((root, bar) => {
    const beat = bar * 4;
    const chord = minorTriad(root + 12);
    for (const pitch of chord) note(events, beat, pitch, 3.8, 0.2, 'choir');
    note(events, beat, root, 1.7, 0.44, 'bass');
    note(events, beat + 2, root, 1.7, 0.36, 'bass');
    note(events, beat, root - 12, 0.28, 0.5, 'timpani');
    note(events, beat + 2, root - 12, 0.24, 0.35, 'timpani');
    addAnvilSignature(events, beat, root + 24, bar % 4 === 0 ? 0.5 : 0.32);

    if (bar >= 4) {
      const pulse = [chord[0], chord[0], chord[1], chord[2]];
      for (let index = 0; index < 8; index++) {
        note(events, beat + index * 0.5, pulse[index % pulse.length] + 12, 0.25, 0.2, 'stacc');
      }
    }
    if (bar % 4 === 3) {
      note(events, beat + 3, root + 31, 0.7, 0.2, 'cymSwell');
    }
  });

  for (const start of [0, 16, 32, 48]) {
    addForgeLeitmotif(events, start, 64, 1, 0.4, 'horn');
    addForgeLeitmotif(events, start + 8, 67, 1, 0.3, 'horn');
  }
  return finish(88, 16, events);
}

/** Varkhul's crucible: the leitmotif at monumental half-time. */
export function composeIgnivarInnerCrucible(): Theme {
  const events: NoteEvent[] = [];
  const roots = [36, 37, 36, 34, 36, 39, 37, 34, 36, 41, 39, 37, 36, 34, 37, 36];

  roots.forEach((root, bar) => {
    const beat = bar * 4;
    const chord = minorTriad(root + 12);
    note(events, beat, root - 10, 3.9, 0.4, 'bass');
    for (const pitch of chord) {
      note(events, beat, pitch, 4.05, 0.2, 'strings');
      note(events, beat, pitch + 12, 4.05, 0.13, 'choir');
    }
    note(events, beat, root - 12, 0.42, bar % 4 === 0 ? 0.64 : 0.42, 'warDrum');
    note(events, beat + 3, root - 12, 0.3, 0.28, 'warDrum');
    addAnvilSignature(events, beat, root + 24, bar % 4 === 0 ? 0.48 : 0.26);

    if (bar % 4 === 2) {
      note(events, beat, root + 31, 3.5, 0.2, 'bell');
    }
    if (bar >= 8) {
      note(events, beat, chord[0] + 12, 1.8, 0.22, 'horn');
      note(events, beat + 2, chord[2] + 12, 1.8, 0.2, 'horn');
    }
  });

  for (const start of [0, 16, 32, 48]) {
    addForgeLeitmotif(events, start, 60, 2, 0.33, 'brassStab');
    addForgeLeitmotif(events, start + 8, 55, 2, 0.24, 'horn');
  }
  return finish(64, 16, events);
}

export function buildIgnivarRaidThemes(): Record<IgnivarRaidThemeKey, Theme> {
  return {
    ignivar_forge_approach: composeIgnivarForgeApproach(),
    ignivar_raid_arena: composeIgnivarRaidArena(),
    ignivar_inner_crucible: composeIgnivarInnerCrucible(),
  };
}
