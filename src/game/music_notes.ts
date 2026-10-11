// The note-event primitives every theme in music.ts is composed from: the
// instrument union the synth voices answer to, the NoteEvent/Theme shapes a
// composed loop is made of, and the small push* helpers that write notes,
// phrases, chords, pedals and drum hits into an event list. They are pure data
// builders with no WebAudio or DOM behind them, so the music editor, the
// offline render pipeline and tests can compose and assert on themes without
// standing up an audio graph. They live beside MusicDirector rather than
// inside music.ts because that file is a monolith ratchet target.
export type Inst =
  | 'strings'
  | 'flute'
  | 'harp'
  | 'horn'
  | 'choir'
  | 'bell'
  | 'timpani'
  | 'bass'
  | 'stacc'
  | 'pad'
  | 'lute'
  | 'dulcimer'
  | 'frameDrum'
  | 'warDrum'
  | 'reed'
  | 'pipe'
  | 'squareLead'
  | 'woodBlock'
  | 'tinyBell'
  | 'piano'
  | 'shaker'
  | 'brassStab'
  | 'cymSwell'
  | 'oboe';

// Every synth voice, for tools (the music editor) that offer instrument
// choices. Keep in sync with the Inst union above.
export const INSTRUMENTS: Inst[] = [
  'strings',
  'flute',
  'harp',
  'horn',
  'choir',
  'bell',
  'timpani',
  'bass',
  'stacc',
  'pad',
  'lute',
  'dulcimer',
  'frameDrum',
  'warDrum',
  'reed',
  'pipe',
  'squareLead',
  'woodBlock',
  'tinyBell',
  'piano',
  'shaker',
  'brassStab',
  'cymSwell',
  'oboe',
];

export interface NoteEvent {
  beat: number; // quarter-note position in the loop
  midi: number;
  dur: number; // beats
  vel: number; // 0..1
  inst: Inst;
}

export interface Theme {
  bpm: number;
  bars: number; // 4/4
  events: NoteEvent[];
}

export const mtof = (m: number): number => 440 * 2 ** ((m - 69) / 12);

// ---------------------------------------------------------------------------
// Composition helpers
// ---------------------------------------------------------------------------

export interface ChordDef {
  root: number; // midi (octave 4 area)
  minor?: boolean;
}

export function triad(c: ChordDef): number[] {
  return [c.root, c.root + (c.minor ? 3 : 4), c.root + 7];
}

export function pushNote(
  out: NoteEvent[],
  beat: number,
  midi: number,
  dur: number,
  vel: number,
  inst: Inst,
): void {
  out.push({ beat, midi, dur, vel, inst });
}

// melody phrases written as [beatOffset, midi, durBeats]
export type Phrase = [number, number, number][];

export function pushPhrase(
  out: NoteEvent[],
  startBeat: number,
  phrase: Phrase,
  vel: number,
  inst: Inst,
): void {
  for (const [b, m, d] of phrase) pushNote(out, startBeat + b, m, d, vel, inst);
}

export function pushRepeated(
  out: NoteEvent[],
  startBeat: number,
  notes: number[],
  step: number,
  dur: number,
  vel: number,
  inst: Inst,
): void {
  for (const [i, m] of notes.entries()) {
    pushNote(out, startBeat + i * step, m, dur, vel, inst);
  }
}

export function pushDrumHits(
  out: NoteEvent[],
  startBeat: number,
  offsets: number[],
  inst: Inst,
  vel: number,
  midi = 42,
): void {
  for (const [i, b] of offsets.entries()) {
    pushNote(out, startBeat + b, midi, 0.22, vel * (i % 2 === 0 ? 1 : 0.78), inst);
  }
}

export function pushPedal(
  out: NoteEvent[],
  beat: number,
  root: number,
  inst: Inst,
  vel: number,
): void {
  pushNote(out, beat, root - 24, 4.1, vel, inst);
  pushNote(out, beat, root - 17, 4.1, vel * 0.62, inst);
}

// explicit chord voicing: absolute midi pitches sounded together
export function pushVoicing(
  out: NoteEvent[],
  beat: number,
  midis: number[],
  dur: number,
  vel: number,
  inst: Inst,
): void {
  for (const m of midis) pushNote(out, beat, m, dur, vel, inst);
}
