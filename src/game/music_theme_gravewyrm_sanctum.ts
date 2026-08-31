import type { NoteEvent, Phrase, Theme } from './music';
import { pushDrumHits, pushNote, pushPhrase, pushVoicing } from './music';

/** Gravewyrm Sanctum: "It Breathes Below". B phrygian, 126 bpm. The final
 *  crawl is a ritual procession over a heartbeat: paired war-drum thumps,
 *  a cult chant that a lower choir answers back, phrygian staccato risers,
 *  brass on the chamber thresholds, and a serpent figure slithering in the
 *  low square lead as the party nears the dais. */
export function composeDungeonGravewyrmSanctum(): Theme {
  const ev: NoteEvent[] = [];
  type BarSpec = { root: number; drone: number; chant: number[]; cell: number[] };
  const B5: BarSpec = { root: 35, drone: 35, chant: [59, 60, 59, 57], cell: [0, 1, 3, 1] };
  const Cma: BarSpec = { root: 36, drone: 36, chant: [60, 62, 60, 59], cell: [0, 2, 4, 2] };
  const Em: BarSpec = { root: 40, drone: 40, chant: [64, 66, 64, 62], cell: [0, 2, 3, 2] };
  const D5: BarSpec = { root: 38, drone: 38, chant: [62, 64, 62, 60], cell: [0, 2, 4, 2] };
  const Gma: BarSpec = { root: 43, drone: 43, chant: [67, 69, 67, 66], cell: [0, 2, 4, 2] };
  const bars: BarSpec[] = [B5, Cma, B5, Cma, Em, Cma, D5, B5, B5, Cma, Gma, Em, Cma, D5, Cma, B5];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    // the heartbeat: paired thumps, lub-dub, twice a bar
    pushNote(ev, b0, 38, 0.9, 0.29, 'warDrum');
    pushNote(ev, b0 + 0.375, 38, 0.7, 0.19, 'warDrum');
    pushNote(ev, b0 + 2, 38, 0.9, 0.25, 'warDrum');
    pushNote(ev, b0 + 2.375, 38, 0.7, 0.17, 'warDrum');
    // drone and bass
    pushNote(ev, b0, c.drone, 4.1, 0.16, 'choir');
    pushNote(ev, b0, c.drone + 7, 4.1, 0.1, 'choir');
    pushNote(ev, b0, c.root + 12, 0.9, 0.4, 'bass');
    pushNote(ev, b0 + 1.5, c.root + 12, 0.45, 0.22, 'bass');
    pushNote(ev, b0 + 2.5, c.root + 19, 0.45, 0.2, 'bass');
    pushNote(ev, b0 + 3.5, c.root + 12, 0.4, 0.18, 'bass');
    // the chant, and the thing beneath chanting back
    for (const [i, m] of c.chant.entries()) {
      pushNote(ev, b0 + i, m, 0.9, 0.13, 'choir');
    }
    if (bar % 4 === 3) {
      pushNote(ev, b0 + 2, c.chant[0] - 24, 1, 0.13, 'choir');
      pushNote(ev, b0 + 3, c.chant[1] - 24, 1, 0.13, 'choir');
    }
    // phrygian risers
    for (let i = 0; i < 16; i++) {
      pushNote(
        ev,
        b0 + i * 0.25,
        c.root + 24 + c.cell[i % 4],
        0.18,
        i % 4 === 0 ? 0.2 : 0.12,
        'stacc',
      );
    }
    // thresholds
    pushVoicing(ev, b0, [c.root + 24, c.root + 31], 0.75, 0.24, 'brassStab');
    if (bar % 4 === 3)
      pushVoicing(ev, b0 + 2.5, [c.root + 24, c.root + 31], 0.4, 0.18, 'brassStab');
    if (bar % 2 === 1) pushDrumHits(ev, b0, [1.25, 3.25], 'woodBlock', 0.08, 70);
    if (bar % 8 === 0) pushNote(ev, b0, 38, 1, 0.45, 'timpani');
    if (bar % 8 === 7) {
      const fill = bar === 15 ? [2, 2.5, 3, 3.25, 3.5, 3.75] : [3, 3.25, 3.5, 3.75];
      for (const [i, t] of fill.entries()) {
        pushNote(ev, b0 + t, 38, 0.3, 0.18 + i * 0.05, 'timpani');
      }
    }
  });

  pushNote(ev, 0, 59, 3.5, 0.15, 'bell');
  pushNote(ev, 32, 59, 3.5, 0.15, 'bell');
  // the incantation
  const incant: Phrase = [
    [0, 64, 0.5],
    [0.5, 67, 0.5],
    [1, 66, 0.5],
    [1.5, 64, 0.5],
    [2, 67, 1],
    [3, 69, 1],
    [4, 67, 1.5],
    [5.5, 64, 0.5],
    [6, 72, 1],
    [7, 71, 1],
    [8, 69, 1],
    [9, 66, 0.5],
    [9.5, 62, 0.5],
    [10, 74, 1.5],
    [11.5, 72, 0.5],
    [12, 72, 1],
    [13, 71, 0.5],
    [13.5, 69, 0.5],
    [14, 71, 2],
  ];
  pushPhrase(ev, 16, incant, 0.14, 'reed');
  // a distant wail on the phrygian second, sighing down onto the B root
  pushPhrase(
    ev,
    32,
    [
      [0, 84, 2],
      [2, 83, 2],
    ],
    0.06,
    'pipe',
  );
  pushPhrase(
    ev,
    44,
    [
      [0, 79, 2],
      [2, 78, 2],
    ],
    0.06,
    'pipe',
  );
  // the serpent below, slithering in the low square
  const serpent: Phrase = [
    [0, 48, 1],
    [1, 50, 0.5],
    [1.5, 52, 0.5],
    [2, 50, 1],
    [3, 48, 1],
    [4, 50, 1],
    [5, 52, 0.5],
    [5.5, 54, 0.5],
    [6, 52, 1],
    [7, 50, 1],
    [8, 48, 0.75],
    [8.75, 48, 0.25],
    [9, 52, 1],
    [10, 50, 0.5],
    [10.5, 48, 0.5],
    [11, 47, 1],
    [12, 47, 2.5],
  ];
  pushPhrase(ev, 48, serpent, 0.12, 'squareLead');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 126, bars: 16, events: ev };
}
