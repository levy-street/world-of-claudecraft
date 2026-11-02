import type { NoteEvent, Phrase, Theme } from './music_notes';
import { pushNote, pushPhrase, pushVoicing } from './music_notes';

/** A bar of the Gourdlight town theme: its bass root (midi, octave 2) and its chord
 *  tones (semitones above the root, the root itself first). */
interface GourdlightBar {
  root: number;
  tones: number[];
}

const Dm: GourdlightBar = { root: 38, tones: [0, 3, 7] };
const Gm: GourdlightBar = { root: 43, tones: [0, 3, 7] };
const Gm6: GourdlightBar = { root: 43, tones: [0, 3, 7, 9] };
const A: GourdlightBar = { root: 45, tones: [0, 4, 7] };
const A7: GourdlightBar = { root: 45, tones: [0, 4, 7, 10] };
const Bb: GourdlightBar = { root: 46, tones: [0, 4, 7] };
const F: GourdlightBar = { root: 41, tones: [0, 4, 7] };
const C: GourdlightBar = { root: 36, tones: [0, 4, 7] };
const Edim: GourdlightBar = { root: 40, tones: [0, 3, 6, 9] };

/** The music box's tune for the A section (eight bars, D minor): a rising sigh with a
 *  sly chromatic neighbour, answered a fourth up, then a turn home onto the dominant. */
const TUNE_A: Phrase = [
  [0, 74, 0.5],
  [0.5, 77, 0.5],
  [1, 81, 1],
  [2, 82, 0.5],
  [2.5, 81, 0.5],
  [3, 80, 0.5],
  [3.5, 81, 0.5],
  [4, 77, 1.5],
  [5.5, 76, 0.5],
  [6, 74, 1],
  [7, 69, 1],
  [8, 79, 0.5],
  [8.5, 82, 0.5],
  [9, 86, 1],
  [10, 82, 0.5],
  [10.5, 81, 0.5],
  [11, 79, 1],
  [12, 76, 0.5],
  [12.5, 79, 0.5],
  [13, 77, 0.5],
  [13.5, 76, 0.5],
  [14, 73, 1.5],
  [15.5, 76, 0.5],
  [16, 74, 0.5],
  [16.5, 77, 0.5],
  [17, 81, 1],
  [18, 86, 0.5],
  [18.5, 85, 0.5],
  [19, 86, 1],
  [20, 82, 1.5],
  [21.5, 81, 0.5],
  [22, 77, 1],
  [23, 74, 1],
  [24, 79, 0.5],
  [24.5, 76, 0.5],
  [25, 82, 1],
  [26, 81, 0.5],
  [26.5, 79, 0.5],
  [27, 76, 1],
  [28, 73, 1],
  [29, 76, 1],
  [30, 81, 2],
];

/** The B section: the tune opens out into the relative major and climbs to the
 *  diminished turn before the dominant. */
const TUNE_B: Phrase = [
  [0, 77, 1],
  [1, 74, 0.5],
  [1.5, 77, 0.5],
  [2, 82, 2],
  [4, 81, 1],
  [5, 77, 0.5],
  [5.5, 81, 0.5],
  [6, 84, 2],
  [8, 82, 1],
  [9, 79, 0.5],
  [9.5, 82, 0.5],
  [10, 86, 1.5],
  [11.5, 84, 0.5],
  [12, 81, 3],
  [15, 77, 1],
  [16, 82, 0.5],
  [16.5, 81, 0.5],
  [17, 79, 0.5],
  [17.5, 77, 0.5],
  [18, 74, 2],
  [20, 79, 1],
  [21, 82, 1],
  [22, 86, 1],
  [23, 82, 1],
  [24, 76, 1],
  [25, 79, 1],
  [26, 82, 1],
  [27, 85, 1],
  [28, 88, 2],
  [30, 85, 0.5],
  [30.5, 81, 0.5],
  [31, 76, 1],
];

/** The bridge's eerie whistle: a slow chromatic slide down over the walking bass. */
const WHISTLE: Phrase = [
  [0, 86, 2],
  [2, 85, 2],
  [4, 84, 2],
  [6, 83, 2],
  [8, 82, 3],
  [11, 81, 1],
  [12, 81, 4],
  [16, 77, 2],
  [18, 76, 2],
  [20, 74, 2],
  [22, 73, 2],
  [24, 76, 4],
];

/** The music box's pickup that leads the bridge back to the top of the loop. */
const PICKUP: Phrase = [
  [0, 81, 0.5],
  [0.5, 80, 0.5],
  [1, 81, 0.5],
  [1.5, 85, 0.5],
  [2, 88, 0.5],
  [2.5, 85, 0.5],
  [3, 81, 0.5],
  [3.5, 76, 0.5],
];

/** Gourdlight Eve in the towns: "Lanterns on the Hollow Road". D minor, 104 bpm,
 *  32 bars. Eerie and festive at once: a music-box tune over a skipping pizzicato,
 *  low strings and a soft choir of lantern-lit "oo"s that gathers on the repeat,
 *  a bridge where the bass walks down in semitones under a ghostly whistle and a
 *  clock ticks in the woodblock, then a sly pickup back to the top. An original
 *  composition for this game's seasonal event. Composed here, beside music.ts (a
 *  monolith ratchet target), and registered through music_sibling_themes.ts. */
export function composeTownGourdlight(): Theme {
  const ev: NoteEvent[] = [];
  const sectionA = [Dm, Dm, Gm, A7, Dm, Bb, Gm6, A];
  const sectionB = [Bb, F, Gm, Dm, Bb, Gm, Edim, A];
  const bridge = [Dm, C, Bb, A, Dm, Gm, A7, A];
  const bars = [...sectionA, ...sectionB, ...sectionA, ...bridge];
  // the bridge's walking bass, a semitone a beat-pair down from D to A and back up
  const walk = [50, 49, 48, 47, 46, 45, 44, 45];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const inBridge = bar >= 24;
    const repeat = bar >= 16;
    const pc = c.tones.map((t) => c.root + t);
    // low strings: the root and fifth held under the bar, a breath louder on the repeat
    pushVoicing(ev, b0, [c.root, c.root + 7], 4.1, repeat ? 0.1 : 0.08, 'strings');
    pushNote(ev, b0, c.root + 12 + c.tones[1], 4.1, 0.045, 'pad');
    // the bass pluck: root on the one, fifth on the three
    pushNote(ev, b0, c.root, 0.9, 0.3, 'bass');
    pushNote(ev, b0 + 2, c.root + 7, 0.9, 0.22, 'bass');
    if (inBridge) {
      // the bridge walks: pizzicato quarter notes stepping down by semitones
      const w = walk[bar - 24];
      for (let i = 0; i < 4; i++) {
        pushNote(ev, b0 + i, i % 2 === 0 ? w : w + 7, 0.3, i === 0 ? 0.19 : 0.13, 'stacc');
      }
      // the clock in the woodblock, tick-tock
      pushNote(ev, b0 + 0.5, 74, 0.2, 0.07, 'woodBlock');
      pushNote(ev, b0 + 1.5, 70, 0.2, 0.05, 'woodBlock');
      pushNote(ev, b0 + 2.5, 74, 0.2, 0.07, 'woodBlock');
      pushNote(ev, b0 + 3.5, 70, 0.2, 0.05, 'woodBlock');
    } else {
      // the skipping pizzicato: root, fifth, octave, a hop, round each chord
      const skip: [number, number, number][] = [
        [0, pc[0] + 12, 0.18],
        [0.75, pc[2] + 12, 0.1],
        [1, pc[1] + 12, 0.14],
        [1.5, pc[2] + 12, 0.12],
        [2, pc[0] + 24, 0.16],
        [2.75, pc[2] + 12, 0.1],
        [3, pc[1] + 12, 0.13],
        [3.5, pc[0] + 12, 0.11],
      ];
      for (const [t, m, v] of skip) pushNote(ev, b0 + t, m, 0.25, v, 'stacc');
      // a bony tap on the off-beats
      pushNote(ev, b0 + 1.5, 77, 0.2, 0.045, 'woodBlock');
      pushNote(ev, b0 + 3.5, 77, 0.2, 0.04, 'woodBlock');
    }
    // the choir of lanterns: the chord's upper tones as a soft "oo", from the repeat on
    if (repeat) {
      pushVoicing(
        ev,
        b0,
        pc.slice(0, 3).map((m) => m + 24),
        4.1,
        inBridge ? 0.085 : 0.065,
        'choir',
      );
    }
    // the section seams: a soft timpani roll home and a swell into each new section
    if (bar % 8 === 0) pushNote(ev, b0, 38, 1.2, 0.26, 'timpani');
    if (bar % 8 === 7) pushNote(ev, b0 + 2, 60, 2, 0.06, 'cymSwell');
  });

  // the music box (and a harp an octave under it on the repeat)
  pushPhrase(ev, 0, TUNE_A, 0.2, 'tinyBell');
  pushPhrase(ev, 32, TUNE_B, 0.19, 'tinyBell');
  pushPhrase(ev, 64, TUNE_A, 0.2, 'tinyBell');
  pushPhrase(
    ev,
    64,
    TUNE_A.map(([b, m, d]): [number, number, number] => [b, m - 12, d]),
    0.1,
    'harp',
  );
  // the bridge: a bell tolls, the ghost whistles, and the box sneaks back in
  pushNote(ev, 96, 62, 3, 0.12, 'bell');
  pushNote(ev, 112, 62, 3, 0.1, 'bell');
  pushPhrase(ev, 96, WHISTLE, 0.07, 'pipe');
  pushPhrase(ev, 124, PICKUP, 0.17, 'tinyBell');

  ev.sort((a, b) => a.beat - b.beat || a.midi - b.midi);
  return { bpm: 104, bars: 32, events: ev };
}
