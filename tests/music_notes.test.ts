import { describe, expect, it } from 'vitest';
import {
  INSTRUMENTS,
  mtof,
  type NoteEvent,
  pushDrumHits,
  pushNote,
  pushPedal,
  pushPhrase,
  pushRepeated,
  pushVoicing,
  triad,
} from '../src/game/music_notes';

describe('note-event primitives', () => {
  it('mtof tunes midi 69 to A440 and doubles an octave up', () => {
    expect(mtof(69)).toBeCloseTo(440, 6);
    expect(mtof(81)).toBeCloseTo(880, 6);
    expect(mtof(57)).toBeCloseTo(220, 6);
  });

  it('triad spells a major third and a minor third over the same root', () => {
    expect(triad({ root: 60 })).toEqual([60, 64, 67]);
    expect(triad({ root: 60, minor: true })).toEqual([60, 63, 67]);
  });

  it('pushNote appends one event with every field carried through', () => {
    const out: NoteEvent[] = [];
    pushNote(out, 2.5, 64, 0.75, 0.4, 'flute');
    expect(out).toEqual([{ beat: 2.5, midi: 64, dur: 0.75, vel: 0.4, inst: 'flute' }]);
  });

  it('pushPhrase offsets every note by the start beat and keeps its own duration', () => {
    const out: NoteEvent[] = [];
    pushPhrase(
      out,
      8,
      [
        [0, 60, 1],
        [1.5, 62, 0.5],
      ],
      0.3,
      'harp',
    );
    expect(out.map((n) => [n.beat, n.midi, n.dur])).toEqual([
      [8, 60, 1],
      [9.5, 62, 0.5],
    ]);
    expect(out.every((n) => n.vel === 0.3 && n.inst === 'harp')).toBe(true);
  });

  it('pushRepeated walks the notes one step apart from the start beat', () => {
    const out: NoteEvent[] = [];
    pushRepeated(out, 4, [60, 62, 64], 0.5, 0.4, 0.2, 'lute');
    expect(out.map((n) => n.beat)).toEqual([4, 4.5, 5]);
    expect(out.map((n) => n.midi)).toEqual([60, 62, 64]);
    expect(out.every((n) => n.dur === 0.4 && n.vel === 0.2)).toBe(true);
  });

  it('pushDrumHits defaults to the hi-hat pitch and softens every off hit', () => {
    const out: NoteEvent[] = [];
    pushDrumHits(out, 2, [0, 0.5, 1], 'shaker', 0.5);
    expect(out.map((n) => n.beat)).toEqual([2, 2.5, 3]);
    expect(out.map((n) => n.midi)).toEqual([42, 42, 42]);
    expect(out.map((n) => n.vel)).toEqual([0.5, 0.5 * 0.78, 0.5]);
  });

  it('pushDrumHits takes an explicit drum pitch over the default', () => {
    const out: NoteEvent[] = [];
    pushDrumHits(out, 0, [0], 'warDrum', 0.6, 38);
    expect(out[0].midi).toBe(38);
  });

  it('pushPedal sounds the root two octaves down under its fifth', () => {
    const out: NoteEvent[] = [];
    pushPedal(out, 16, 60, 'bass', 0.5);
    expect(out.map((n) => n.midi)).toEqual([36, 43]);
    expect(out.map((n) => n.beat)).toEqual([16, 16]);
    expect(out.map((n) => n.vel)).toEqual([0.5, 0.5 * 0.62]);
    expect(out.every((n) => n.dur === 4.1)).toBe(true);
  });

  it('pushVoicing sounds every pitch on the same beat', () => {
    const out: NoteEvent[] = [];
    pushVoicing(out, 12, [60, 64, 67], 0.9, 0.25, 'brassStab');
    expect(out.map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(out.every((n) => n.beat === 12 && n.dur === 0.9 && n.vel === 0.25)).toBe(true);
  });

  it('every helper appends rather than replacing what a composer already wrote', () => {
    const out: NoteEvent[] = [];
    pushNote(out, 0, 60, 1, 0.3, 'strings');
    pushVoicing(out, 1, [60, 67], 1, 0.3, 'strings');
    pushPedal(out, 2, 60, 'bass', 0.3);
    expect(out).toHaveLength(5);
  });

  it('INSTRUMENTS lists every voice once, for the tools that offer a choice', () => {
    expect(INSTRUMENTS.length).toBeGreaterThan(0);
    expect(new Set(INSTRUMENTS).size).toBe(INSTRUMENTS.length);
    expect(INSTRUMENTS).toContain('strings');
    expect(INSTRUMENTS).toContain('oboe');
  });
});
