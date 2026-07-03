// Procedural adventure soundtrack: no audio files, pure WebAudio synthesis.
// Eastbrook Vale keeps its original themes (town, vale, vale_legacy). Every
// other cue is through-composed to modern JRPG dynamics: per-place leitmotifs
// grown from the zone's look and lore, layered ostinati, extended harmony,
// and multi-section forms (Mirefen's waterlogged requiem, Fenbridge's hearth
// lilt, Thornpeak's cold anthem, Highwatch's watch march, three dungeon
// crawls, and an A minor battle theme that transposes onto every zone key).
// Each theme is a composed multi-track loop scheduled with a lookahead
// timer; zone changes crossfade.

import { MUSIC_OVERRIDES } from './music_overrides.generated';

export type MusicZone =
  | 'town_eastbrook'
  | 'town_fenbridge'
  | 'town_highwatch'
  | 'vale'
  | 'vale_legacy'
  | 'marsh'
  | 'peaks'
  | 'dungeon_hollow_crypt'
  | 'dungeon_sunken_bastion'
  | 'dungeon_gravewyrm_sanctum';

const TOWN_MUSIC: Record<string, MusicZone> = {
  eastbrook_vale: 'town_eastbrook',
  mirefen_marsh: 'town_fenbridge',
  thornpeak_heights: 'town_highwatch',
};

// Per-zone overworld overrides (empty: every zone plays its biome theme, so
// Thornpeak Heights gets the dedicated peaks anthem; vale_legacy remains
// available as a layer but is no longer routed anywhere).
const ZONE_MUSIC: Partial<Record<string, MusicZone>> = {};

const DUNGEON_MUSIC: Record<string, MusicZone> = {
  hollow_crypt: 'dungeon_hollow_crypt',
  sunken_bastion: 'dungeon_sunken_bastion',
  gravewyrm_sanctum: 'dungeon_gravewyrm_sanctum',
};

export function dungeonMusicZoneForDungeon(dungeonId: string): MusicZone {
  return DUNGEON_MUSIC[dungeonId] ?? 'dungeon_hollow_crypt';
}

export function shouldResetMusicForDungeonEntry(
  previousDungeonId: string | null,
  nextDungeonId: string | null,
): boolean {
  return nextDungeonId !== null && previousDungeonId !== nextDungeonId;
}

/** Pick the soundtrack layer from world position context. */
export function musicZoneForLocation(
  zoneId: string,
  biome: 'vale' | 'marsh' | 'peaks',
  inHub: boolean,
  inDungeon: boolean,
  dungeonId: string | null = null,
): MusicZone {
  if (inDungeon) return dungeonId ? dungeonMusicZoneForDungeon(dungeonId) : 'dungeon_hollow_crypt';
  if (inHub) return TOWN_MUSIC[zoneId] ?? biome;
  return ZONE_MUSIC[zoneId] ?? biome;
}

type Inst =
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

interface Layer {
  theme: Theme;
  gain: GainNode;
  target: number; // logical 0..1; the gain node gets target * trim
  anchor: number;
  nextIdx: number;
  loopCount: number;
  transpose: number;
  trim: number; // measured per-theme loudness trim (THEME_TRIM)
}

const mtof = (m: number): number => 440 * 2 ** ((m - 69) / 12);

// ---------------------------------------------------------------------------
// Composition helpers
// ---------------------------------------------------------------------------

interface ChordDef {
  root: number; // midi (octave 4 area)
  minor?: boolean;
}

function triad(c: ChordDef): number[] {
  return [c.root, c.root + (c.minor ? 3 : 4), c.root + 7];
}

function pushNote(
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
type Phrase = [number, number, number][];

function pushPhrase(
  out: NoteEvent[],
  startBeat: number,
  phrase: Phrase,
  vel: number,
  inst: Inst,
): void {
  for (const [b, m, d] of phrase) pushNote(out, startBeat + b, m, d, vel, inst);
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

function composeTownEastbrook(): Theme {
  const ev: NoteEvent[] = [];
  // D major, warm and pastoral
  const D = { root: 62 },
    A = { root: 57 },
    Bm = { root: 59, minor: true };
  const G = { root: 55 },
    F$m = { root: 54, minor: true };
  const chords: ChordDef[] = [D, A, Bm, G, D, G, A, D, D, F$m, G, D, Bm, G, A, D];

  chords.forEach((c, bar) => {
    const b0 = bar * 4;
    const t = triad(c);
    // string pad: whole-bar triad, octave below
    for (const n of t) pushNote(ev, b0, n - 12, 4.05, 0.3, 'strings');
    // cello bass: root on 1 and 3
    pushNote(ev, b0, c.root - 24, 1.8, 0.5, 'bass');
    pushNote(ev, b0 + 2, c.root - 24, 1.8, 0.42, 'bass');
    // harp: flowing eighth arpeggio root-3rd-5th-octave and back
    const arp = [t[0], t[1], t[2], t[0] + 12, t[2], t[1], t[0], t[1]];
    for (const [i, n] of arp.entries()) {
      pushNote(ev, b0 + i * 0.5, n, 0.5, 0.34, 'harp');
    }
    // horn counterline in the back half of each section
    if (bar % 8 >= 4) {
      pushNote(ev, b0, c.root - 12, 2, 0.16, 'horn');
      pushNote(ev, b0 + 2, c.root - 5, 2, 0.14, 'horn');
    }
  });

  // flute melody (two 8-bar phrases)
  const phraseA: Phrase = [
    [0, 69, 1],
    [1, 74, 1],
    [2, 76, 1],
    [3, 78, 1],
    [4, 78, 1.5],
    [5.5, 76, 0.5],
    [6, 74, 2],
    [8, 76, 1],
    [9, 78, 1],
    [10, 79, 1],
    [11, 78, 1],
    [12, 76, 3],
    [16, 74, 1],
    [17, 78, 1],
    [18, 81, 1.5],
    [19.5, 79, 0.5],
    [20, 78, 1.5],
    [21.5, 76, 0.5],
    [22, 74, 1],
    [23, 76, 1],
    [24, 78, 2],
    [26, 76, 2],
    [28, 74, 3],
  ];
  const phraseB: Phrase = [
    [0, 81, 1],
    [1, 78, 1],
    [2, 79, 1],
    [3, 81, 1],
    [4, 83, 1.5],
    [5.5, 81, 0.5],
    [6, 79, 1],
    [7, 78, 1],
    [8, 79, 1],
    [9, 78, 1],
    [10, 76, 1],
    [11, 79, 1],
    [12, 78, 3],
    [16, 71, 1],
    [17, 74, 1],
    [18, 78, 1],
    [19, 81, 1],
    [20, 79, 1.5],
    [21.5, 78, 0.5],
    [22, 76, 1],
    [23, 79, 1],
    [24, 78, 2],
    [26, 76, 2],
    [28, 74, 4],
  ];
  pushPhrase(ev, 0, phraseA, 0.34, 'flute');
  pushPhrase(ev, 32, phraseB, 0.34, 'flute');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 80, bars: 16, events: ev };
}

function pushRepeated(
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

function pushDrumHits(
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

function pushPedal(out: NoteEvent[], beat: number, root: number, inst: Inst, vel: number): void {
  pushNote(out, beat, root - 24, 4.1, vel, inst);
  pushNote(out, beat, root - 17, 4.1, vel * 0.62, inst);
}

// explicit chord voicing: absolute midi pitches sounded together
function pushVoicing(
  out: NoteEvent[],
  beat: number,
  midis: number[],
  dur: number,
  vel: number,
  inst: Inst,
): void {
  for (const m of midis) pushNote(out, beat, m, dur, vel, inst);
}

function composeTownFenbridge(): Theme {
  const ev: NoteEvent[] = [];
  // "Dry Boots and Lamplight". G major, 88 bpm, 24 bars in a 12/8 lilt (the
  // beat grid carries triplets). Fenbridge is a stubborn garrison bridge-town
  // holding the only dry road through a drowned country, and its music is the
  // warm pocket inside the marsh requiem: piano hearth chords, a rocking lute
  // barcarolle, a folk reed tune with a falling-triad motto, and a wistful
  // flute middle section for the rain outside the walls. G major is the
  // relative major of the marsh's E minor so the town gate crossfade stays kin.
  const T = 1 / 3;
  // app: the diatonic approach tone the walking bass takes INTO this chord.
  // mid: the beat-two bass note, a fifth above the bass except on the slash
  // chord (D/F#), where the bass note is the chord's third and +7 would land
  // outside the key. ring: the beat-2.5 piano echo voicing, kept clear of a
  // semitone under the tune's beat-3 note.
  type BarSpec = {
    root: number;
    app: number;
    mid?: number;
    arp: number[];
    keys: number[];
    ring?: number[];
  };
  const G: BarSpec = {
    root: 43,
    app: 42,
    arp: [55, 62, 67, 71],
    keys: [55, 59, 62, 69],
    ring: [62, 69],
  };
  const Em7: BarSpec = { root: 40, app: 42, arp: [52, 59, 64, 67], keys: [52, 59, 62, 67] };
  const Cma7: BarSpec = {
    root: 36,
    app: 38,
    arp: [48, 55, 64, 74],
    keys: [48, 60, 64, 71],
    ring: [60, 64],
  };
  const Dma: BarSpec = { root: 38, app: 36, arp: [50, 57, 62, 66], keys: [50, 57, 66, 69] };
  const Bm7: BarSpec = { root: 47, app: 45, arp: [47, 54, 62, 66], keys: [47, 57, 62, 66] };
  const Am7: BarSpec = { root: 45, app: 47, arp: [45, 52, 60, 64], keys: [45, 55, 60, 64] };
  const Cma: BarSpec = { root: 36, app: 38, arp: [48, 55, 60, 64], keys: [48, 55, 64, 67] };
  const DF$: BarSpec = {
    root: 42,
    app: 45,
    mid: 45,
    arp: [54, 57, 62, 66],
    keys: [54, 62, 66, 69],
  };
  const A8: BarSpec[] = [G, Em7, Cma7, Dma, G, Bm7, Am7, G];
  const B8: BarSpec[] = [Em7, Cma7, G, DF$, Em7, Am7, Cma, G];
  const bars: BarSpec[] = [...A8, ...B8, ...A8];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const next = bars[(bar + 1) % bars.length];
    // rocking lute barcarolle: one triplet per beat, low-high-mid; beat 4
    // rocks lower so it never crowds the tune's cadence note
    for (let beat = 0; beat < 4; beat++) {
      const low = beat % 2 === 0 ? c.arp[0] : c.arp[1];
      pushNote(ev, b0 + beat, low, 0.4, 0.17, 'lute');
      pushNote(ev, b0 + beat + T, beat === 3 ? c.arp[2] : c.arp[3], 0.3, 0.1, 'lute');
      pushNote(ev, b0 + beat + 2 * T, beat === 3 ? c.arp[1] : c.arp[2], 0.3, 0.11, 'lute');
    }
    // hearth piano on alternating bars, dulcimer lamplight between
    if (bar % 2 === 0) {
      pushVoicing(ev, b0, c.keys, 2.6, 0.12, 'piano');
      pushVoicing(ev, b0 + 2.5, c.ring ?? c.keys.slice(1), 1.2, 0.08, 'piano');
    } else {
      pushNote(ev, b0 + 1 + T, c.arp[3] + 12, 0.3, 0.09, 'dulcimer');
      pushNote(ev, b0 + 3 + 2 * T, c.arp[2] + 12, 0.3, 0.07, 'dulcimer');
    }
    // easy bass with a walking approach into the next bar
    pushNote(ev, b0, c.root, 1.4, 0.3, 'bass');
    pushNote(ev, b0 + 2, c.mid ?? c.root + 7, 1.0, 0.18, 'bass');
    pushNote(ev, b0 + 3 + 2 * T, next.app, 0.3, 0.13, 'bass');
    // soft tavern pulse
    pushDrumHits(ev, b0, [0, 2], 'frameDrum', 0.1, 43);
    pushNote(ev, b0 + 1 + 2 * T, 43, 0.2, 0.05, 'frameDrum');
    if (bar % 4 === 3) pushNote(ev, b0 + 3 + T, 72, 0.15, 0.07, 'woodBlock');
    if (bar % 8 === 7) pushNote(ev, b0 + 3 + T, 83, 0.9, 0.07, 'tinyBell');
  });

  // A tune (reed): the dry-boots motto, a falling G triad answered in step
  const tuneA: Phrase = [
    [0, 74, 2 * T],
    [2 * T, 71, T],
    [1, 67, 1],
    [2, 69, 2 * T],
    [2 + 2 * T, 71, T],
    [3, 72, 1],
    [4, 71, 1 + 2 * T],
    [5 + 2 * T, 69, T],
    [6, 67, 1],
    [7, 64, 1],
    [8, 64, 2 * T],
    [8 + 2 * T, 66, T],
    [9, 67, 1],
    [10, 69, 2 * T],
    [10 + 2 * T, 71, T],
    [11, 72, 1],
    [12, 71, 1],
    [13, 69, 2 * T],
    [13 + 2 * T, 66, T],
    [14, 69, 2],
    [16, 74, 2 * T],
    [16 + 2 * T, 71, T],
    [17, 67, 1],
    [18, 69, 2 * T],
    [18 + 2 * T, 71, T],
    [19, 72, 1],
    [20, 74, 1 + 2 * T],
    [21 + 2 * T, 76, T],
    [22, 78, 1],
    [23, 74, 1],
    [24, 76, 2 * T],
    [24 + 2 * T, 72, T],
    [25, 69, 1],
    [26, 66, 2 * T],
    [26 + 2 * T, 67, T],
    [27, 69, 1],
    [28, 67, 3],
  ];
  pushPhrase(ev, 0, tuneA, 0.28, 'flute');
  pushPhrase(ev, 0, tuneA, 0.12, 'dulcimer');
  // B tune (flute): rain on the lamplit window, ending on a folk flat seven
  const tuneB: Phrase = [
    [0, 71, 1],
    [1, 76, 1 + 2 * T],
    [2 + 2 * T, 74, T],
    [3, 71, 1],
    [4, 72, 2 * T],
    [4 + 2 * T, 74, T],
    [5, 76, 1],
    [6, 79, 1 + 2 * T],
    [7 + 2 * T, 78, T],
    [8, 74, 1],
    [9, 71, 2 * T],
    [9 + 2 * T, 67, T],
    [10, 74, 2],
    [12, 69, 1],
    [13, 66, 2 * T],
    [13 + 2 * T, 69, T],
    [14, 74, 1],
    [15, 76, 1],
    [16, 79, 1 + 2 * T],
    [17 + 2 * T, 78, T],
    [18, 76, 1],
    [19, 71, 1],
    [20, 72, 1],
    [21, 76, 1],
    [22, 69, 2],
    [24, 71, 2 * T],
    [24 + 2 * T, 72, T],
    [25, 74, 1],
    [26, 76, 2 * T],
    [26 + 2 * T, 78, T],
    [27, 72, 1],
    [28, 71, 1],
    [29, 67, 2.5],
  ];
  pushPhrase(ev, 32, tuneB, 0.28, 'flute');
  // reprise with a quiet pipe descant floating over the last phrase
  pushPhrase(ev, 64, tuneA, 0.26, 'flute');
  pushPhrase(ev, 64, tuneA, 0.11, 'dulcimer');
  const descant: Phrase = [
    [0, 79, 2],
    [2, 81, 2],
    [4, 78, 3],
    [8, 76, 2],
    [10, 78, 2],
    [12, 79, 3],
  ];
  pushPhrase(ev, 80, descant, 0.06, 'flute');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 88, bars: 24, events: ev };
}

function composeTownHighwatch(): Theme {
  const ev: NoteEvent[] = [];
  // "Two Hundred Years of Watch". B minor, 96 bpm, 20 bars: an eight-bar
  // horn chorale march (duty on the wall), an eight-bar pipe descant lift
  // (hope over the parapet, half-cadencing on the watch fires), and a
  // four-bar coda where the chapel bell tolls under the motto. Highwatch is
  // a two-century garrison holding the roof of the world: dignity, grit,
  // hearth-warmth inside the wind. B minor is the relative minor of the
  // peaks anthem so gate crossfades stay kin.
  // mid: the beat-two bass note; a fifth above the bass except on inversion
  // bars (A/C#, D/F#), where the bass note is the chord's third and a literal
  // +7 would land outside the key
  type BarSpec = { root: number; mid?: number; keys: number[]; tri: number[] };
  const Bm: BarSpec = { root: 47, keys: [47, 59, 62, 66], tri: [59, 62, 66] };
  const G: BarSpec = { root: 43, keys: [43, 59, 62, 67], tri: [59, 62, 67] };
  const D: BarSpec = { root: 38, keys: [50, 57, 62, 66], tri: [57, 62, 66] };
  const A: BarSpec = { root: 45, keys: [45, 57, 61, 64], tri: [57, 61, 64] };
  const Em7: BarSpec = { root: 40, keys: [40, 55, 59, 62], tri: [55, 59, 64] };
  const F$m: BarSpec = { root: 42, keys: [42, 54, 61, 66], tri: [54, 61, 66] };
  const AC$: BarSpec = { root: 49, mid: 52, keys: [49, 57, 64, 69], tri: [57, 61, 64] };
  const DF$: BarSpec = { root: 42, mid: 45, keys: [54, 62, 66, 69], tri: [54, 62, 66] };
  const F$5: BarSpec = { root: 42, keys: [42, 54, 61, 66], tri: [54, 61, 66] };
  const A8: BarSpec[] = [Bm, G, D, A, Bm, Em7, A, Bm];
  const B8: BarSpec[] = [D, AC$, Bm, F$m, G, DF$, Em7, F$5];
  const coda: BarSpec[] = [G, DF$, A, Bm];
  const bars: BarSpec[] = [...A8, ...B8, ...coda];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const inB = bar >= 8 && bar < 16;
    const inCoda = bar >= 16;
    // sustained strings glue with the piano hearth under it
    pushVoicing(ev, b0, c.tri, 4.05, 0.11, 'strings');
    pushVoicing(ev, b0, c.keys, 2.2, 0.12, 'piano');
    if (bar % 2 === 1) pushVoicing(ev, b0 + 2.5, c.keys.slice(1), 1.2, 0.07, 'piano');
    // dotted march bass
    pushNote(ev, b0, c.root, 0.7, 0.34, 'bass');
    pushNote(ev, b0 + 0.75, c.root, 0.25, 0.16, 'bass');
    pushNote(ev, b0 + 2, c.mid ?? c.root + 7, 0.7, 0.24, 'bass');
    pushNote(ev, b0 + 3.5, c.root, 0.45, 0.16, 'bass');
    // parade drums, softened for the descant, proud again in the coda
    if (!inB) {
      pushDrumHits(ev, b0, [0, 1, 2, 3], 'frameDrum', inCoda ? 0.13 : 0.11, 45);
      pushNote(ev, b0 + 2.75, 45, 0.2, 0.05, 'frameDrum');
      if (bar % 4 === 0) pushNote(ev, b0, 38, 0.9, 0.16, 'warDrum');
    } else {
      pushDrumHits(ev, b0, [0, 2], 'frameDrum', 0.08, 45);
      // harp keeps the lift moving
      for (const [i, t] of [0.5, 1.5, 2.5, 3.5].entries()) {
        pushNote(ev, b0 + t, c.keys[1 + (i % 3)], 0.8, 0.11, 'harp');
      }
    }
    if (bar % 8 === 3) pushNote(ev, b0 + 3.5, 38, 0.45, 0.24, 'timpani');
    if (bar === 15) {
      for (const [i, t] of [3, 3.5, 3.75].entries()) {
        pushNote(ev, b0 + t, 38, 0.3, 0.2 + i * 0.06, 'timpani');
      }
    }
  });

  // A: the horn chorale in two voices, the watch motto
  const motto: Phrase = [
    [0, 66, 1],
    [1, 71, 1.5],
    [2.5, 69, 0.5],
    [3, 66, 1],
    [4, 67, 2],
    [6, 71, 1],
    [7, 74, 1],
    [8, 69, 1.5],
    [9.5, 66, 0.5],
    [10, 62, 2],
    [12, 64, 1],
    [13, 69, 1],
    [14, 73, 1],
    [15, 76, 1],
    [16, 74, 1.5],
    [17.5, 73, 0.5],
    [18, 71, 1],
    [19, 66, 1],
    [20, 67, 1],
    [21, 71, 1.5],
    [22.5, 69, 0.5],
    [23, 67, 1],
    [24, 71, 1],
    [25, 67, 1],
    [26, 69, 1],
    [27, 73, 1],
    [28, 71, 3.5],
  ];
  const mottoLow: Phrase = [
    [0, 62, 1],
    [1, 62, 1.5],
    [2.5, 66, 0.5],
    [3, 62, 1],
    [4, 62, 2],
    [6, 67, 1],
    [7, 71, 1],
    [8, 66, 1.5],
    [9.5, 62, 0.5],
    [10, 57, 2],
    [12, 61, 1],
    [13, 64, 1],
    [14, 69, 1],
    [15, 73, 1],
    [16, 66, 2],
    [18, 66, 1],
    [19, 62, 1],
    [20, 64, 1],
    [21, 67, 1.5],
    [22.5, 64, 0.5],
    [23, 64, 1],
    [24, 67, 1],
    [25, 61, 1],
    [26, 64, 1],
    [27, 69, 1],
    [28, 66, 3.5],
  ];
  pushPhrase(ev, 0, motto, 0.2, 'horn');
  pushPhrase(ev, 0, mottoLow, 0.11, 'horn');
  // B: the pipe descant over the wall, ending on the watch-fire half cadence
  const descant: Phrase = [
    [0, 78, 1],
    [1, 76, 0.5],
    [1.5, 74, 0.5],
    [2, 81, 2],
    [4, 79, 1.5],
    [5.5, 78, 0.5],
    [6, 76, 2],
    [8, 74, 1],
    [9, 78, 1],
    [10, 83, 1.5],
    [11.5, 81, 0.5],
    [12, 81, 1],
    [13, 78, 1],
    [14, 73, 2],
    [16, 71, 1],
    [17, 74, 1],
    [18, 79, 1.5],
    [19.5, 78, 0.5],
    [20, 78, 1],
    [21, 74, 0.5],
    [21.5, 69, 0.5],
    [22, 74, 2],
    [24, 76, 1.5],
    [25.5, 74, 0.5],
    [26, 71, 1],
    [27, 67, 1],
    [28, 69, 1],
    [29, 71, 1],
    [30, 73, 2],
  ];
  pushPhrase(ev, 32, descant, 0.18, 'pipe');
  // coda: motto head in octaves while the chapel bell tolls
  const codaLine: Phrase = [
    [0, 74, 1],
    [1, 71, 1.5],
    [2.5, 73, 0.5],
    [3, 74, 1],
    [4, 69, 1],
    [5, 66, 1],
    [6, 74, 2],
    [8, 73, 1],
    [9, 76, 1],
    [10, 78, 2],
    [12, 71, 4],
  ];
  pushPhrase(ev, 64, codaLine, 0.2, 'horn');
  pushPhrase(
    ev,
    64,
    codaLine.map(([b, m, d]) => [b, m + 12, d] as Phrase[number]),
    0.1,
    'pipe',
  );
  pushNote(ev, 64, 59, 3, 0.12, 'bell');
  pushNote(ev, 72, 59, 3, 0.12, 'bell');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 96, bars: 20, events: ev };
}

function composeVale(): Theme {
  const ev: NoteEvent[] = [];
  // A dorian overworld: playful and looping, with sparse orchestral depth.
  const Am = { root: 57, minor: true },
    G = { root: 55 },
    D = { root: 62 },
    C = { root: 60 },
    Em = { root: 52, minor: true };
  const chords: ChordDef[] = [Am, G, D, Am, C, G, Em, Am, Am, C, D, G, Am, Em, G, Am];

  chords.forEach((c, bar) => {
    const b0 = bar * 4;
    const t = triad(c);
    if (bar % 2 === 0) pushPedal(ev, b0, c.root, 'pad', 0.17);
    pushNote(ev, b0, c.root - 24, 1.5, 0.28, 'bass');
    pushNote(ev, b0 + 2, c.root - 19, 1.2, 0.2, 'bass');
    const lilt = [t[0], t[2], t[1] + 12, t[2], t[0] + 12, t[2], t[1] + 12, t[2]];
    pushRepeated(ev, b0, lilt, 0.5, 0.24, 0.18, 'lute');
    if (bar % 2 === 1)
      pushRepeated(ev, b0 + 0.25, [t[2] + 12, t[0] + 24, t[1] + 12], 1, 0.18, 0.12, 'dulcimer');
    if (bar % 4 === 0 || bar % 4 === 2) pushDrumHits(ev, b0, [0, 1.5, 2.5], 'frameDrum', 0.09, 44);
  });

  const motifA: Phrase = [
    [0, 69, 0.5],
    [0.5, 72, 0.5],
    [1, 74, 1],
    [2, 76, 0.5],
    [2.5, 74, 0.5],
    [3, 72, 1],
    [4, 69, 0.5],
    [4.5, 67, 0.5],
    [5, 69, 1],
    [6, 72, 0.5],
    [6.5, 74, 0.5],
    [7, 76, 1],
    [8, 79, 0.5],
    [8.5, 76, 0.5],
    [9, 74, 1],
    [10, 72, 0.5],
    [10.5, 69, 0.5],
    [11, 67, 1],
    [12, 69, 0.5],
    [12.5, 72, 0.5],
    [13, 74, 1],
    [14, 72, 0.5],
    [14.5, 69, 0.5],
    [15, 69, 1],
  ];
  const motifB: Phrase = [
    [0, 76, 0.5],
    [0.5, 79, 0.5],
    [1, 81, 1],
    [2, 79, 0.5],
    [2.5, 76, 0.5],
    [3, 74, 1],
    [4, 72, 0.5],
    [4.5, 74, 0.5],
    [5, 76, 1],
    [6, 79, 0.5],
    [6.5, 81, 0.5],
    [7, 84, 1],
    [8, 81, 0.5],
    [8.5, 79, 0.5],
    [9, 76, 1],
    [10, 74, 0.5],
    [10.5, 72, 0.5],
    [11, 69, 1],
    [12, 67, 0.5],
    [12.5, 69, 0.5],
    [13, 72, 1],
    [14, 74, 0.5],
    [14.5, 72, 0.5],
    [15, 69, 1],
  ];
  pushPhrase(ev, 4, motifA, 0.16, 'pipe');
  pushPhrase(
    ev,
    20,
    motifA.map(([b, m, d]) => [b, m - 12, d] as Phrase[number]),
    0.11,
    'reed',
  );
  pushPhrase(ev, 36, motifB, 0.15, 'squareLead');
  pushPhrase(ev, 52, motifA, 0.14, 'pipe');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 92, bars: 16, events: ev };
}

function composeLegacyVale(): Theme {
  const ev: NoteEvent[] = [];
  // Original Eastbrook Vale wilderness theme from before the per-zone soundtrack expansion.
  const Am = { root: 57, minor: true },
    C = { root: 60 },
    G = { root: 55 };
  const Em = { root: 52, minor: true },
    Dmaj = { root: 62 },
    F = { root: 53 };
  const chords: ChordDef[] = [Am, Am, C, G, Am, Em, G, Am, Am, C, Dmaj, Am, F, C, Em, Am];

  chords.forEach((c, bar) => {
    const b0 = bar * 4;
    const t = triad(c);
    if (bar % 2 === 0) {
      pushNote(ev, b0, c.root - 24, 8.4, 0.4, 'strings');
      pushNote(ev, b0, c.root - 17, 8.4, 0.26, 'strings');
    }
    for (const n of t) pushNote(ev, b0, n - 12, 4.05, 0.16, 'choir');
    pushNote(ev, b0, c.root - 12, 1.5, 0.3, 'bass');
    if (bar % 4 === 1) pushNote(ev, b0 + 2, c.root - 5, 1.8, 0.24, 'bass');
    if (bar % 4 === 3) pushNote(ev, b0 + 2.5, c.root - 10, 1.4, 0.22, 'bass');
    if (bar % 4 === 2) {
      for (const [i, n] of [t[2], t[0] + 12, t[1] + 12].entries()) {
        pushNote(ev, b0 + 1 + i * 0.5, n, 0.5, 0.2, 'harp');
      }
    }
  });

  const motifs: [number, Phrase][] = [
    [
      4,
      [
        [0, 69, 1],
        [1, 71, 1],
        [2, 72, 1.5],
        [3.5, 71, 0.5],
        [4, 67, 2],
        [6, 64, 2],
      ],
    ],
    [
      20,
      [
        [0, 76, 1.5],
        [1.5, 74, 0.5],
        [2, 72, 1],
        [3, 71, 1],
        [4, 69, 3],
      ],
    ],
    [
      36,
      [
        [0, 72, 1],
        [1, 74, 1],
        [2, 76, 1.5],
        [3.5, 74, 0.5],
        [4, 72, 1],
        [5, 69, 1],
        [6, 71, 3],
      ],
    ],
    [
      52,
      [
        [0, 69, 1],
        [1, 72, 1],
        [2, 71, 1],
        [3, 67, 1],
        [4, 69, 4],
      ],
    ],
  ];
  for (const [start, ph] of motifs) pushPhrase(ev, start, ph, 0.26, 'flute');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 66, bars: 16, events: ev };
}

function composeMarsh(): Theme {
  const ev: NoteEvent[] = [];
  // "The Water Remembers". E aeolian, 76 bpm, ABA' over 24 bars. Mirefen is a
  // drowned country: perpetual overcast, grey-green fog, dead raised from the
  // lakes, a chapel that sank with its congregation. The writing is a slow
  // waterlogged requiem: piano droplets over deep pedals, a low choir for the
  // drowned, a reed dirge that the flute answers from the relative major
  // before the mist closes back in. Wood clicks and rain bells keep the fen's
  // old identity at the edges.
  type BarSpec = {
    root: number; // pedal and bass root, octave 3 area
    pad: number[]; // sustained color voicing
    drop: number[]; // piano droplet pitches, low to high
  };
  const Em: BarSpec = { root: 52, pad: [52, 59, 66], drop: [40, 52, 59, 64, 71, 78] };
  const Cma7: BarSpec = { root: 48, pad: [52, 59, 64], drop: [36, 48, 55, 64, 71, 76] };
  const Am7: BarSpec = { root: 45, pad: [52, 60, 67], drop: [33, 45, 52, 60, 67, 72] };
  const EmG: BarSpec = { root: 43, pad: [55, 59, 64], drop: [31, 43, 52, 59, 64, 67] };
  const Bm7: BarSpec = { root: 47, pad: [54, 59, 62], drop: [35, 47, 54, 62, 66, 69] };
  const Dma: BarSpec = { root: 50, pad: [54, 57, 62], drop: [38, 50, 57, 62, 66, 74] };
  const Gma: BarSpec = { root: 43, pad: [55, 59, 62], drop: [31, 43, 50, 59, 62, 67] };
  const A8: BarSpec[] = [Em, Em, Cma7, Am7, EmG, Cma7, Bm7, Em];
  const B8: BarSpec[] = [Cma7, Dma, Gma, Em, Am7, Bm7, Dma, Em];
  const bars: BarSpec[] = [...A8, ...B8, ...A8];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const inB = bar >= 8 && bar < 16;
    const inA2 = bar >= 16;
    // deep water pedal every two bars; the choir of the drowned joins in B
    // and in the final section
    if (bar % 2 === 0) pushPedal(ev, b0, c.root < 52 ? c.root + 12 : c.root, 'strings', 0.2);
    if ((inB || inA2) && bar % 2 === 0) {
      pushNote(ev, b0, c.root - 12, 8.2, 0.1, 'choir');
      pushNote(ev, b0, c.root - 5, 8.2, 0.06, 'choir');
    }
    // slow bass breath: root, then a drift to the fifth
    pushNote(ev, b0, c.root - 12, 2.6, 0.3, 'bass');
    if (bar % 2 === 1) pushNote(ev, b0 + 2.5, c.root - 5, 1.2, 0.16, 'bass');
    // piano droplets: sparse syncopated chord tones falling like water from
    // the reeds, alternating placement so no two bars drip alike
    const dropBeats = bar % 2 === 0 ? [0.5, 1.75, 2.5, 3.25] : [0.75, 1.5, 2.75, 3.5];
    const order = bar % 2 === 0 ? [1, 3, 5, 4] : [2, 4, 5, 3];
    for (const [i, di] of order.entries()) {
      pushNote(ev, b0 + dropBeats[i], c.drop[di], 1.1, 0.15, 'piano');
    }
    // a deep anchor note under the phrase-start droplets
    if (bar % 4 === 0) pushNote(ev, b0 + 0.5, c.drop[0], 1.6, 0.12, 'piano');
    // fen identity: soft wood clicks off the grid, a low frame drum far away
    if (bar % 2 === 1) pushDrumHits(ev, b0, [1.75, 3.25], 'woodBlock', 0.06, 70);
    if (bar % 8 === 6) pushNote(ev, b0 + 3, 43, 0.25, 0.08, 'frameDrum');
    // rain bells in the reprise only: the mist thinning for a moment
    if (inA2 && bar % 2 === 0) {
      pushNote(ev, b0 + 2.25, c.pad[2] + 12, 0.8, 0.06, 'tinyBell');
    }
    if (inA2) {
      // harp counterline rising against the sinking bass
      for (const i of [0, 1, 2, 3]) {
        pushNote(ev, b0 + i + 0.5, c.pad[i % 3] + (i === 3 ? 12 : 0), 0.8, 0.1, 'harp');
      }
    }
  });

  // A section dirge (reed): narrow, grieving, ending unresolved on the tonic
  const dirge: Phrase = [
    [0, 67, 1.5],
    [1.5, 69, 0.5],
    [2, 71, 2],
    [4, 72, 1],
    [5, 71, 0.5],
    [5.5, 69, 0.5],
    [6, 64, 2],
    [9, 64, 0.5],
    [9.5, 66, 0.5],
    [10, 67, 1],
    [11, 69, 1],
    [12, 71, 2],
    [14, 67, 1],
    [15, 64, 1],
    [16, 66, 1.5],
    [17.5, 67, 0.5],
    [18, 66, 1],
    [19, 62, 1],
    [20, 64, 3.5],
  ];
  pushPhrase(
    ev,
    8,
    dirge.map(([b, m, d]) => [b, m + 12, d] as Phrase[number]),
    0.21,
    'flute',
  );
  pushPhrase(ev, 8, dirge, 0.12, 'harp');
  // B section: the flute lifts into G major light over the water, then sinks
  const lift: Phrase = [
    [0, 76, 1.5],
    [1.5, 74, 0.5],
    [2, 72, 1],
    [3, 71, 1],
    [4, 69, 1],
    [5, 71, 0.5],
    [5.5, 74, 0.5],
    [6, 78, 1.5],
    [7.5, 76, 0.5],
    [8, 74, 1],
    [9, 79, 1.5],
    [10.5, 78, 0.5],
    [11, 76, 1],
    [12, 71, 2.5],
    [14.5, 69, 0.5],
    [15, 67, 1],
    [16, 69, 1],
    [17, 72, 1],
    [18, 76, 1.5],
    [19.5, 74, 0.5],
    [20, 74, 1.5],
    [21.5, 71, 0.5],
    [22, 66, 2],
    [24, 67, 1],
    [25, 69, 1],
    [26, 71, 1],
    [27, 74, 1],
    [28, 76, 2.5],
    [30.5, 71, 1.5],
  ];
  pushPhrase(ev, 32, lift, 0.26, 'flute');
  // reprise: the dirge returns, flute above, harp lighting the attacks
  pushPhrase(
    ev,
    72,
    dirge.map(([b, m, d]) => [b, m + 12, d] as Phrase[number]),
    0.19,
    'flute',
  );
  pushPhrase(ev, 72, dirge, 0.11, 'harp');
  // section seams: a slow harp roll up from the deep
  for (const seam of [31, 63]) {
    for (const [i, m] of [40, 47, 52, 59].entries()) {
      pushNote(ev, seam + i * 0.17, m, 1.4, 0.12, 'harp');
    }
  }

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 76, bars: 24, events: ev };
}

function composePeaks(): Theme {
  const ev: NoteEvent[] = [];
  // "The Mountain Listens". D major, 100 bpm, 24 bars: anthem / awe / anthem
  // in octaves. Thornpeak is thin bright dawn air over a buried dread: snow,
  // the longest sightlines in the game, a two-hundred-year watch, and a
  // half-woken wyrm under the summit. The A section is a wide-interval horn
  // anthem over a marching string ostinato; the B section turns to B minor,
  // slows the motor, and lets a distant pipe echo the anthem off the cliffs;
  // the reprise states the anthem in horn and pipe octaves with full drums.
  // air: the high choir dyad (root and fifth of the chord, octave 4-5).
  // mid: the beat-three bass note; a fifth above the bass except on the
  // D/F# slash bar, where the bass note is the chord's third.
  type BarSpec = { root: number; mid?: number; ost: number[]; tri: number[]; air: number[] };
  const D: BarSpec = { root: 38, ost: [62, 69, 74, 69], tri: [62, 66, 69], air: [69, 76] };
  const G: BarSpec = { root: 43, ost: [67, 74, 79, 74], tri: [62, 67, 71], air: [67, 74] };
  const A: BarSpec = { root: 45, ost: [69, 76, 81, 76], tri: [61, 64, 69], air: [69, 76] };
  const Asus: BarSpec = { root: 45, ost: [69, 76, 81, 76], tri: [62, 64, 69], air: [69, 76] };
  const Bm: BarSpec = { root: 47, ost: [59, 66, 71, 66], tri: [62, 66, 71], air: [71, 78] };
  const DF$: BarSpec = {
    root: 42,
    mid: 45,
    ost: [66, 69, 74, 69],
    tri: [62, 66, 69],
    air: [69, 74],
  };
  const Em7: BarSpec = { root: 40, ost: [64, 71, 76, 71], tri: [59, 64, 67], air: [67, 74] };
  const A8: BarSpec[] = [D, D, G, A, D, Bm, G, Asus];
  const B8: BarSpec[] = [Bm, G, DF$, A, Bm, G, Em7, Asus];
  // the reprise closes on the dominant so the loop turns around V to I
  const C8: BarSpec[] = [D, D, G, A, D, Bm, G, A];
  const bars: BarSpec[] = [...A8, ...B8, ...C8];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const inB = bar >= 8 && bar < 16;
    const inC = bar >= 16;
    if (!inB) {
      // marching eighth ostinato: root, fifth, octave, fifth
      for (let i = 0; i < 8; i++) {
        pushNote(ev, b0 + i * 0.5, c.ost[i % 4], 0.26, i % 4 === 0 ? 0.2 : 0.13, 'stacc');
      }
    } else {
      // the awe section thins the motor to lute quarters
      for (const i of [0, 1, 2, 3]) {
        pushNote(ev, b0 + i, c.ost[i % 4] - 12, 0.7, 0.13, 'lute');
      }
    }
    pushNote(ev, b0, c.root, 1.5, 0.36, 'bass');
    pushNote(ev, b0 + 2, c.root, 0.75, 0.24, 'bass');
    pushNote(ev, b0 + 3, c.mid ?? c.root + 7, 0.75, 0.22, 'bass');
    // altitude: high choir breath over the anthem, low choir under the awe
    if (bar % 2 === 0) {
      if (inB) pushNote(ev, b0, c.root + 12, 8.2, 0.1, 'choir');
      else pushVoicing(ev, b0, c.air, 8.2, inC ? 0.1 : 0.07, 'choir');
    }
    if (inC) pushVoicing(ev, b0, c.tri, 4.05, 0.12, 'strings');
    // field drums, held back in the awe section
    if (!inB) {
      pushDrumHits(ev, b0, [0, 2], 'warDrum', inC ? 0.2 : 0.16, 38);
      pushDrumHits(ev, b0, [1, 3], 'frameDrum', 0.12, 45);
      if (bar % 2 === 1) pushNote(ev, b0 + 3.5, 45, 0.2, 0.08, 'frameDrum');
    } else {
      pushDrumHits(ev, b0, [0], 'frameDrum', 0.09, 45);
    }
    if (bar % 4 === 0) pushNote(ev, b0 + 2.25, 86, 1.2, 0.06, 'tinyBell');
    if (bar % 8 === 7) {
      for (const [i, t] of [3, 3.25, 3.5, 3.75].entries()) {
        pushNote(ev, b0 + t, 38, 0.3, 0.18 + i * 0.05, 'timpani');
      }
    }
    if (bar % 8 === 0) pushNote(ev, b0, 38, 1, 0.42, 'timpani');
  });

  // the anthem: wide intervals, a rising fourth call and a sus resolution
  const anthem: Phrase = [
    [0, 62, 1],
    [1, 69, 1],
    [2, 74, 1.5],
    [3.5, 71, 0.5],
    [4, 69, 1.5],
    [5.5, 66, 0.5],
    [6, 69, 1],
    [7, 71, 1],
    [8, 71, 1],
    [9, 74, 1],
    [10, 67, 2],
    [12, 69, 1],
    [13, 73, 1],
    [14, 76, 2],
    [16, 78, 1.5],
    [17.5, 76, 0.5],
    [18, 74, 1],
    [19, 69, 1],
    [20, 71, 1.5],
    [21.5, 73, 0.5],
    [22, 74, 1],
    [23, 66, 1],
    [24, 67, 1],
    [25, 71, 1],
    [26, 74, 1.5],
    [27.5, 76, 0.5],
    [28, 76, 1.5],
    [29.5, 74, 0.5],
    [30, 73, 2],
  ];
  pushPhrase(ev, 0, anthem, 0.22, 'horn');
  // stabs follow the bar harmony: D fifths on D bars, G fifths on G bars
  for (const [b, dyad] of [
    [0, [62, 69]],
    [8, [67, 74]],
    [16, [62, 69]],
    [24, [67, 74]],
  ] as const) {
    pushVoicing(ev, b, [...dyad], 0.5, 0.15, 'brassStab');
  }
  // the awe: strings lead in B minor while the mountain listens
  const awe: Phrase = [
    [0, 74, 1],
    [1, 73, 0.5],
    [1.5, 71, 0.5],
    [2, 78, 2],
    [4, 79, 1.5],
    [5.5, 78, 0.5],
    [6, 76, 1],
    [7, 74, 1],
    [8, 81, 1],
    [9, 78, 0.5],
    [9.5, 74, 0.5],
    [10, 76, 2],
    [12, 73, 1],
    [13, 76, 1],
    [14, 69, 2],
    [16, 71, 1],
    [17, 74, 0.5],
    [17.5, 78, 0.5],
    [18, 83, 1.5],
    [19.5, 81, 0.5],
    [20, 79, 1],
    [21, 78, 0.5],
    [21.5, 76, 0.5],
    [22, 74, 1],
    [23, 71, 1],
    [24, 76, 1.5],
    [25.5, 78, 0.5],
    [26, 79, 1],
    [27, 78, 0.5],
    [27.5, 76, 0.5],
    [28, 74, 1.5],
    [29.5, 76, 0.5],
    [30, 73, 1],
    [31, 76, 1],
  ];
  pushPhrase(ev, 32, awe, 0.2, 'strings');
  pushPhrase(
    ev,
    56,
    awe.slice(25).map(([b, m, d]) => [b - 24, m + 12, d] as Phrase[number]),
    0.07,
    'flute',
  );
  // a far pipe echoes the anthem's falling call off the cliffs
  pushPhrase(
    ev,
    42,
    [
      [0, 86, 0.5],
      [0.5, 81, 0.5],
      [1, 78, 1.5],
    ],
    0.07,
    'pipe',
  );
  // reprise: anthem in octaves over the full field
  pushPhrase(ev, 64, anthem, 0.22, 'horn');
  pushPhrase(
    ev,
    64,
    anthem.map(([b, m, d]) => [b, m + 12, d] as Phrase[number]),
    0.13,
    'pipe',
  );

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 100, bars: 24, events: ev };
}

/** Hollow Crypt: "Sleep, Neighbors". D minor over a phrygian creep, 100 bpm.
 *  A violated village graveyard: a funeral bell tolls over an unmoving D
 *  pedal, the chapel hymn starts and breaks off, bones skitter in the wood
 *  blocks, and in the second half a piano lament grieves for the neighbors
 *  raised out of their own graves. Intimate dread, not yet apocalypse. */
function composeDungeonHollowCrypt(): Theme {
  const ev: NoteEvent[] = [];
  type BarSpec = { bass: number; pad: number[]; creep: [number, number][] };
  const creepD: [number, number][] = [
    [0, 50],
    [0.5, 51],
    [1, 50],
    [2, 50],
    [2.5, 51],
    [3, 53],
  ];
  const creepEb: [number, number][] = [
    [0, 51],
    [0.5, 53],
    [1, 51],
    [2, 51],
    [2.5, 50],
    [3, 51],
  ];
  const Dm: BarSpec = { bass: 38, pad: [50, 53, 57], creep: creepD };
  const Eb: BarSpec = { bass: 39, pad: [51, 55, 58], creep: creepEb };
  const Bb: BarSpec = {
    bass: 34,
    pad: [50, 53, 58],
    creep: [
      [0, 50],
      [0.5, 53],
      [1, 50],
      [2, 50],
      [2.5, 53],
      [3, 55],
    ],
  };
  const Gm: BarSpec = {
    bass: 43,
    pad: [50, 55, 58],
    creep: [
      [0, 50],
      [0.5, 53],
      [1, 50],
      [2, 50],
      [2.5, 55],
      [3, 53],
    ],
  };
  const A5: BarSpec = {
    bass: 45,
    pad: [45, 52, 57],
    creep: [
      [0, 49],
      [0.5, 50],
      [1, 49],
      [2, 49],
      [2.5, 50],
      [3, 52],
    ],
  };
  const bars: BarSpec[] = [Dm, Eb, Dm, Bb, Gm, A5, Eb, Dm, Dm, Bb, Gm, Dm, Eb, Dm, A5, Dm];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const late = bar >= 8;
    // the grave pedal never moves: D beneath whatever walks above it
    if (bar % 2 === 0) pushPedal(ev, b0, 62, 'choir', 0.14);
    pushVoicing(ev, b0, c.pad, 4.05, 0.09, 'pad');
    pushNote(ev, b0, c.bass, 2.2, 0.3, 'bass');
    pushNote(ev, b0 + 2.75, c.bass, 0.5, 0.16, 'bass');
    // phrygian creep, half-step shadows around the tonic
    for (const [t, m] of c.creep) {
      pushNote(ev, b0 + t, m, 0.4, t === 0 ? 0.18 : 0.12, 'stacc');
    }
    // a slow heart under the floor, louder the deeper the crawl goes
    pushNote(ev, b0, 38, 0.9, late ? 0.19 : 0.13, 'warDrum');
    pushNote(ev, b0 + 0.75, 38, 0.7, late ? 0.13 : 0.09, 'warDrum');
    // bone skitter
    if (bar % 4 === 2) pushDrumHits(ev, b0, [1.25, 1.5], 'woodBlock', 0.07, 70);
    if (bar % 4 === 0) pushNote(ev, b0 + 3.25, 70, 0.2, 0.06, 'woodBlock');
    // wrongness: a minor-second string shimmer behind the middle phrases
    if (bar >= 4 && bar < 8) pushVoicing(ev, b0, [57, 58], 4.05, 0.055, 'strings');
    if (bar >= 12) pushVoicing(ev, b0, [69, 70], 4.05, 0.05, 'strings');
  });

  // the bell and the hymn that breaks off mid-line
  for (const b of [0, 16, 32, 48]) pushNote(ev, b, 62, 3.5, 0.13, 'bell');
  const hymn: Phrase = [
    [0, 62, 1],
    [1, 65, 1],
    [2, 64, 1.5],
    [4, 62, 1],
    [5, 60, 1],
    [6, 58, 1.5],
  ];
  pushPhrase(ev, 8, hymn, 0.1, 'reed');
  // the lament: a piano grieving by name in the second half
  const lament: Phrase = [
    [0, 69, 1.5],
    [1.5, 67, 0.5],
    [2, 65, 1],
    [3, 64, 1],
    [4, 65, 1],
    [5, 62, 1],
    [6, 74, 1.5],
    [7.5, 72, 0.5],
    [8, 70, 1.5],
    [9.5, 69, 0.5],
    [10, 67, 2],
    [12, 65, 1],
    [13, 64, 0.5],
    [13.5, 65, 0.5],
    [14, 69, 2],
    [16, 67, 1],
    [17, 70, 1],
    [18, 75, 1.5],
    [19.5, 74, 0.5],
    [20, 74, 1],
    [21, 69, 1],
    [22, 65, 2],
    [24, 64, 1.5],
    [25.5, 65, 0.5],
    [26, 64, 1],
    [27, 62, 1],
    [28, 62, 3.5],
  ];
  pushPhrase(ev, 32, lament, 0.17, 'piano');
  pushNote(ev, 28, 86, 1.4, 0.05, 'tinyBell');
  pushNote(ev, 60, 86, 1.4, 0.05, 'tinyBell');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 100, bars: 16, events: ev };
}

/** Sunken Bastion: "The Drowning Dark". E minor passacaglia, 116 bpm.
 *  The keep drowned with its honor intact: a lament ground bass (E, D, C, B)
 *  repeats while water textures pile on in four-bar tides: harp sixteenths,
 *  the mistcaller's dirge, the drowned choir with drums, then rising staccato
 *  runs, and the loop empties back to the still surface. Knight-Commander
 *  Olen's fanfare surfaces twice, rusted but noble. */
function composeDungeonSunkenBastion(): Theme {
  const ev: NoteEvent[] = [];
  for (let bar = 0; bar < 16; bar++) {
    const b0 = bar * 4;
    const even = bar % 2 === 1; // second bar of each ground cycle
    // the ground: E . D | C . B, honor sinking a step at a time
    if (!even) {
      pushNote(ev, b0, 40, 1.4, 0.34, 'bass');
      pushNote(ev, b0 + 2, 40, 0.9, 0.22, 'bass');
      pushNote(ev, b0 + 3, 38, 0.9, 0.26, 'bass');
    } else {
      pushNote(ev, b0, 36, 1.4, 0.34, 'bass');
      pushNote(ev, b0 + 2, 35, 0.9, 0.24, 'bass');
      pushNote(ev, b0 + 3, 35, 0.9, 0.2, 'bass');
    }
    if (bar % 2 === 0) pushPedal(ev, b0, 52, 'pad', 0.15);
    // water: harp sixteenths climbing inside each bar
    const flow = even ? [48, 55, 64, 71, 47, 54, 59, 66] : [52, 59, 64, 71, 59, 64, 71, 76];
    for (let i = 0; i < 16; i++) {
      pushNote(
        ev,
        b0 + i * 0.25,
        flow[(i < 8 ? 0 : 4) + (i % 4)],
        0.3,
        i % 4 === 0 ? 0.12 : 0.08,
        'harp',
      );
    }
    // tide three: the drowned stand up
    if (bar >= 8) {
      if (even) {
        pushNote(ev, b0, 36, 2, 0.12, 'choir');
        pushNote(ev, b0 + 2, 35, 2.1, 0.12, 'choir');
        pushNote(ev, b0, 52, 2, 0.08, 'choir');
        pushNote(ev, b0 + 2, 54, 2.1, 0.08, 'choir');
      } else {
        pushNote(ev, b0, 40, 4.1, 0.12, 'choir');
        pushNote(ev, b0, 52, 4.1, 0.08, 'choir');
      }
      pushDrumHits(ev, b0, [0, 2.5], 'warDrum', 0.17, 38);
      pushDrumHits(ev, b0, [1, 3], 'frameDrum', 0.1, 45);
    }
    // tide four: the water rises up the walls
    if (bar >= 12) {
      const run = even ? [48, 50, 52, 55, 57, 59, 60, 64] : [52, 54, 55, 57, 59, 60, 62, 64];
      for (const [i, m] of run.entries()) {
        pushNote(ev, b0 + i * 0.25, m + (bar >= 14 ? 12 : 0), 0.2, 0.15, 'stacc');
      }
    }
    if (bar < 4 && bar % 2 === 0) pushNote(ev, b0 + 3.25, 88, 1.2, 0.05, 'tinyBell');
  }
  // the dirge, then its echo an octave up as the pressure builds
  const dirge: Phrase = [
    [0, 71, 1.5],
    [1.5, 69, 0.5],
    [2, 67, 1],
    [3, 66, 1],
    [4, 69, 1],
    [5, 67, 0.5],
    [5.5, 64, 0.5],
    [6, 66, 1],
    [7, 59, 1],
    [8, 64, 1],
    [9, 67, 1],
    [10, 71, 1.5],
    [11.5, 72, 0.5],
    [12, 72, 1],
    [13, 71, 0.5],
    [13.5, 67, 0.5],
    [14, 66, 2],
  ];
  pushPhrase(ev, 16, dirge, 0.15, 'reed');
  pushPhrase(
    ev,
    32,
    dirge.map(([b, m, d]) => [b, m + 12, d] as Phrase[number]),
    0.14,
    'pipe',
  );
  // Olen's fanfare: a knight's call through rusted plate
  for (const b of [36, 52]) {
    pushVoicing(ev, b, [52, 59], 0.5, 0.2, 'brassStab');
    pushVoicing(ev, b + 0.75, [52, 59], 0.25, 0.14, 'brassStab');
    pushVoicing(ev, b + 1, [55, 62], 1, 0.18, 'brassStab');
  }
  for (const [i, t] of [2.5, 3, 3.25, 3.5, 3.75].entries()) {
    pushNote(ev, 60 + t, 38, 0.3, 0.18 + i * 0.04, 'timpani');
  }

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 116, bars: 16, events: ev };
}

/** Gravewyrm Sanctum: "It Breathes Below". B phrygian, 126 bpm. The final
 *  crawl is a ritual procession over a heartbeat: paired war-drum thumps,
 *  a cult chant that a lower choir answers back, phrygian staccato risers,
 *  brass on the chamber thresholds, and a serpent figure slithering in the
 *  low square lead as the party nears the dais. */
function composeDungeonGravewyrmSanctum(): Theme {
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

// ---------------------------------------------------------------------------
// Battle music. Every variant grows from the original combat cue's DNA: the
// pounding staccato eighth cell from D3 (root, root, flat three, root, five,
// root, flat three, four), timpani on one, three, and the and-of-four pickup,
// and bare horn fifths. Orchestral tension in the classic MMO mold: no drum
// kit backbeat, no song melody; percussion, brass gestures, and string
// agitato that sit under gameplay. All written from D so COMBAT_TRANSPOSE can
// move the active cue onto each zone's tonal center. The alternates are
// registered as extra themes purely so the render tool can audition them;
// only the layer named 'combat' ever plays in game.
// ---------------------------------------------------------------------------

const COMBAT_CELL = [0, 0, 3, 0, 7, 0, 3, 5];

function pushCombatCell(out: NoteEvent[], b0: number, base: number, vel: number): void {
  for (const [i, s] of COMBAT_CELL.entries()) {
    pushNote(out, b0 + i * 0.5, base + s, 0.4, vel, 'stacc');
  }
}

function pushCombatTimpani(out: NoteEvent[], b0: number, scale = 1): void {
  pushNote(out, b0, 38, 1, 0.55 * scale, 'timpani');
  pushNote(out, b0 + 2, 38, 1, 0.4 * scale, 'timpani');
  pushNote(out, b0 + 3.5, 38, 0.5, 0.3 * scale, 'timpani');
}

/** "Vanguard" (the default): the original cue grown into sixteen bars. The
 *  first four bars ARE the original texture over a new bass shadow; four-bar
 *  terraces then add the octave agitato, war drums, and a rising-fourth war
 *  call; the music shifts up a half step for a two-bar shock answered by low
 *  brass, returns home, marches bVI to bVII back up, hits a three-bar tutti,
 *  and the last bar strikes once, breathes for two beats, and drops straight
 *  back into the pounding cell so chain pulls never hear a dead seam. */
function composeCombat(): Theme {
  const ev: NoteEvent[] = [];
  const bassAt = (b0: number, root: number): void => {
    pushNote(ev, b0, root, 0.6, 0.44, 'bass');
    pushNote(ev, b0 + 2, root, 0.5, 0.32, 'bass');
    pushNote(ev, b0 + 3.5, root, 0.4, 0.26, 'bass');
  };

  // bars 1-4: the original, with the bass shadowing the timpani skeleton
  for (let bar = 0; bar < 4; bar++) {
    const b0 = bar * 4;
    pushCombatTimpani(ev, b0);
    pushCombatCell(ev, b0, 50, 0.26);
    bassAt(b0, 38);
    if (bar % 2 === 1) {
      pushNote(ev, b0, 50, 1.6, 0.2, 'horn');
      pushNote(ev, b0 + 0.02, 57, 1.6, 0.16, 'horn');
    }
  }
  pushNote(ev, 14, 70, 2, 0.1, 'cymSwell');

  // bars 5-8: octave agitato, war drums, and the rising-fourth war call
  for (let bar = 4; bar < 8; bar++) {
    const b0 = bar * 4;
    pushCombatTimpani(ev, b0);
    if (bar < 7) {
      pushCombatCell(ev, b0, 50, 0.26);
      pushCombatCell(ev, b0, 62, 0.12);
    } else {
      // the last eighth of the terrace belongs to the run into the shock
      for (const [i, st] of COMBAT_CELL.slice(0, 7).entries()) {
        pushNote(ev, b0 + i * 0.5, 50 + st, 0.4, 0.26, 'stacc');
        pushNote(ev, b0 + i * 0.5, 62 + st, 0.4, 0.12, 'stacc');
      }
    }
    bassAt(b0, 38);
    pushNote(ev, b0, 38, 0.9, 0.2, 'warDrum');
    pushNote(ev, b0 + 2.5, 38, 0.7, 0.16, 'warDrum');
    if (bar % 2 === 0) {
      pushNote(ev, b0, 50, 1.6, 0.18, 'horn');
      pushNote(ev, b0 + 0.02, 57, 1.6, 0.14, 'horn');
    } else {
      pushNote(ev, b0, 50, 3.5, 0.12, 'horn');
      pushNote(ev, b0, 57, 1, 0.2, 'horn');
      pushNote(ev, b0 + 1, 62, 2.5, 0.22, 'horn');
    }
  }
  // diminished ascent into the shock: D, F, A-flat, B-flat
  for (const [i, m] of [50, 53, 56, 58].entries()) {
    pushNote(ev, 31 + i * 0.25, m, 0.2, 0.2, 'stacc');
  }

  // bars 9-10: everything a half step up, low brass and a crash answer
  for (const bar of [8, 9]) {
    const b0 = bar * 4;
    pushCombatTimpani(ev, b0);
    pushCombatCell(ev, b0, 51, 0.26);
    if (bar === 9) pushCombatCell(ev, b0, 63, 0.12);
    bassAt(b0, 39);
    pushNote(ev, b0, 38, 0.9, 0.2, 'warDrum');
    pushNote(ev, b0 + 2.5, 38, 0.7, 0.16, 'warDrum');
  }
  pushVoicing(ev, 32, [39, 46], 0.75, 0.3, 'brassStab');
  pushNote(ev, 32, 70, 0.12, 0.16, 'cymSwell');
  pushNote(ev, 36, 51, 1.6, 0.18, 'horn');
  pushNote(ev, 36.02, 58, 1.6, 0.14, 'horn');

  // bar 11: home again, hitting harder
  pushCombatTimpani(ev, 40);
  pushCombatCell(ev, 40, 50, 0.26);
  pushCombatCell(ev, 40, 62, 0.12);
  bassAt(40, 38);
  pushVoicing(ev, 40, [38, 45], 0.75, 0.28, 'brassStab');
  pushNote(ev, 40, 38, 0.9, 0.22, 'warDrum');
  pushNote(ev, 42.5, 38, 0.7, 0.16, 'warDrum');

  // bar 12: the march home, half a bar of B-flat, half of C
  pushNote(ev, 44, 38, 1, 0.5, 'timpani');
  pushNote(ev, 46, 38, 1, 0.45, 'timpani');
  for (const [i, s] of [0, 0, 3, 0].entries()) {
    pushNote(ev, 44 + i * 0.5, 46 + s, 0.4, 0.26, 'stacc');
    pushNote(ev, 46 + i * 0.5, 48 + s, 0.4, 0.26, 'stacc');
  }
  pushNote(ev, 44, 34, 0.9, 0.42, 'bass');
  pushNote(ev, 46, 36, 0.9, 0.42, 'bass');
  pushVoicing(ev, 44, [46, 53], 0.6, 0.26, 'brassStab');
  pushVoicing(ev, 46, [48, 55], 0.6, 0.28, 'brassStab');
  for (const [i, t] of [3, 3.25, 3.5, 3.75].entries()) {
    pushNote(ev, 44 + t, 38, 0.3, 0.22 + i * 0.05, 'timpani');
  }

  // bars 13-15: tutti
  for (let bar = 12; bar < 15; bar++) {
    const b0 = bar * 4;
    pushCombatTimpani(ev, b0);
    pushCombatCell(ev, b0, 50, 0.3);
    pushCombatCell(ev, b0, 62, 0.16);
    bassAt(b0, 38);
    pushNote(ev, b0, 38, 0.9, 0.26, 'warDrum');
    pushNote(ev, b0 + 1.5, 38, 0.7, 0.2, 'warDrum');
    pushNote(ev, b0 + 3, 38, 0.7, 0.22, 'warDrum');
    pushDrumHits(ev, b0, [0.75, 2.75], 'frameDrum', 0.1, 45);
    pushNote(ev, b0, 50, 2, 0.18, 'horn');
    pushNote(ev, b0 + 0.02, 57, 2, 0.15, 'horn');
    pushNote(ev, b0 + 0.04, 62, 2, 0.12, 'horn');
    if (bar === 13) pushVoicing(ev, b0 + 2.5, [38, 45], 0.4, 0.24, 'brassStab');
  }
  pushNote(ev, 58, 70, 2, 0.12, 'cymSwell');
  for (const [i, m] of [53, 55, 57, 60, 62].entries()) {
    pushNote(ev, 58.75 + i * 0.25, m, 0.2, 0.22, 'stacc');
  }

  // bar 16: one tutti strike, two beats of air, and the pickup back in
  pushVoicing(ev, 60, [38, 45, 50], 1, 0.34, 'brassStab');
  pushNote(ev, 60, 38, 1, 0.6, 'timpani');
  pushNote(ev, 60, 70, 0.12, 0.22, 'cymSwell');
  pushNote(ev, 62, 38, 0.5, 0.3, 'bass');
  pushNote(ev, 63.5, 38, 0.5, 0.3, 'timpani');
  pushNote(ev, 63.75, 38, 0.4, 0.2, 'warDrum');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 126, bars: 16, events: ev };
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Director
// ---------------------------------------------------------------------------

const FADE_SECONDS = 2.2;
const LOOKAHEAD = 0.6;
const STORAGE_KEY = 'ev_music_on';

// The combat cue is written from D3 exactly like the original; transpose it
// onto each zone's tonal center so the crossfade never fights the theme
// underneath (all shifts upward, matching the original table's register):
//   town_eastbrook  0 -> D (Eastbrook is D major)
//   town_fenbridge  5 -> G (Fenbridge is G major)
//   town_highwatch  9 -> B (Highwatch is B minor)
//   vale  7 -> A (vale is A dorian)
//   vale_legacy  7 -> A (original vale is A dorian)
//   marsh  2 -> E (marsh is E aeolian)
//   peaks  0 -> D (peaks anthem is D major)
//   dungeon_hollow_crypt      0 -> D
//   dungeon_sunken_bastion    2 -> E
//   dungeon_gravewyrm_sanctum 9 -> B
const COMBAT_TRANSPOSE: Record<MusicZone, number> = {
  town_eastbrook: 0,
  town_fenbridge: 5,
  town_highwatch: 9,
  vale: 7,
  vale_legacy: 7,
  marsh: 2,
  peaks: 0,
  dungeon_hollow_crypt: 0,
  dungeon_sunken_bastion: 2,
  dungeon_gravewyrm_sanctum: 9,
};

export function buildMusicThemes(withOverrides = true): Record<string, Theme> {
  const composed: Record<string, Theme> = {
    town_eastbrook: composeTownEastbrook(),
    town_fenbridge: composeTownFenbridge(),
    town_highwatch: composeTownHighwatch(),
    vale: composeVale(),
    vale_legacy: composeLegacyVale(),
    marsh: composeMarsh(),
    peaks: composePeaks(),
    dungeon_hollow_crypt: composeDungeonHollowCrypt(),
    dungeon_sunken_bastion: composeDungeonSunkenBastion(),
    dungeon_gravewyrm_sanctum: composeDungeonGravewyrmSanctum(),
    combat: composeCombat(),
  };
  if (!withOverrides) return composed;
  // themes edited and saved from the music editor take precedence
  return { ...composed, ...MUSIC_OVERRIDES };
}

// Per-theme loudness trims, applied to each layer's gain so every cue plays
// at the same perceived level. Values are MEASURED, not guessed: each theme
// was rendered offline through the exact in-game chain, its gated windowed
// RMS computed (400ms windows, windows more than 15 dB under the loudest
// gated out so drop bars and quiet middles do not skew the level), and the
// trim set to match the Eastbrook town theme, the loudest cue and the game's
// reference. Recompute with scripts/render_music.mjs plus a gated-RMS pass
// whenever a composition changes materially.
export const THEME_TRIM: Record<string, number> = {
  town_eastbrook: 1.0,
  town_fenbridge: 1.65,
  town_highwatch: 2.15,
  vale: 3.3,
  vale_legacy: 1.35,
  marsh: 1.85,
  peaks: 2.05,
  dungeon_hollow_crypt: 2.95,
  dungeon_sunken_bastion: 2.95,
  dungeon_gravewyrm_sanctum: 1.8,
  combat: 1.35,
};

export class MusicSynth {
  constructor(private ctx: BaseAudioContext) {}

  playNote(
    evt: NoteEvent,
    when: number,
    spb: number,
    layer: Pick<Layer, 'gain' | 'transpose'>,
  ): void {
    const freq = mtof(evt.midi + layer.transpose);
    const dur = Math.max(0.1, evt.dur * spb);
    const out = layer.gain;
    switch (evt.inst) {
      case 'strings':
        this.strings(when, freq, dur, evt.vel, out);
        break;
      case 'flute':
        this.flute(when, freq, dur, evt.vel, out);
        break;
      case 'harp':
        this.pluck(when, freq, evt.vel, out, 1.4);
        break;
      case 'bass':
        this.pluck(when, freq, evt.vel, out, 0.9, true);
        break;
      case 'horn':
        this.horn(when, freq, dur, evt.vel, out);
        break;
      case 'choir':
        this.choir(when, freq, dur, evt.vel, out);
        break;
      case 'bell':
        this.bell(when, freq, evt.vel, out);
        break;
      case 'timpani':
        this.timpani(when, freq, evt.vel, out);
        break;
      case 'stacc':
        this.strings(when, freq, Math.min(dur, 0.22), evt.vel, out, 0.02);
        break;
      case 'pad':
        this.pad(when, freq, dur, evt.vel, out);
        break;
      case 'lute':
        this.lute(when, freq, evt.vel, out);
        break;
      case 'dulcimer':
        this.dulcimer(when, freq, evt.vel, out);
        break;
      case 'frameDrum':
        this.frameDrum(when, evt.vel, out);
        break;
      case 'warDrum':
        this.warDrum(when, evt.vel, out);
        break;
      case 'reed':
        this.reed(when, freq, dur, evt.vel, out);
        break;
      case 'pipe':
        this.pipe(when, freq, dur, evt.vel, out);
        break;
      case 'squareLead':
        this.squareLead(when, freq, dur, evt.vel, out);
        break;
      case 'woodBlock':
        this.woodBlock(when, evt.vel, out);
        break;
      case 'tinyBell':
        this.tinyBell(when, freq, evt.vel, out);
        break;
      case 'piano':
        this.piano(when, freq, dur, evt.vel, out);
        break;
      case 'shaker':
        this.shaker(when, evt.vel, out);
        break;
      case 'brassStab':
        this.brassStab(when, freq, dur, evt.vel, out);
        break;
      case 'cymSwell':
        this.cymSwell(when, dur, evt.vel, out);
        break;
      case 'oboe':
        this.oboe(when, freq, dur, evt.vel, out);
        break;
    }
  }

  // Folk oboe: a detuned sawtooth pair through a reedy formant with delayed
  // vibrato, plus a triangle carrying the fundamental. The same chorused-saw
  // richness as the strings voice, shaped into a warm double-reed lead.
  private oboe(when: number, freq: number, dur: number, vel: number, out: GainNode): void {
    const ctx = this.ctx;
    const g = this.adsr(when, dur, vel * 0.17, 0.055, 0.22);
    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.value = Math.min(2400, 600 + freq * 2.2);
    formant.Q.value = 0.9;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2800;
    formant.connect(lp).connect(g).connect(out);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vibGain = ctx.createGain();
    vibGain.gain.setValueAtTime(0, when);
    vibGain.gain.linearRampToValueAtTime(freq * 0.004, when + 0.3);
    vib.connect(vibGain);
    for (const det of [-5, 4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      vibGain.connect(o.frequency);
      o.connect(formant);
      o.start(when);
      o.stop(when + dur + 0.4);
    }
    // the fundamental body the narrow formant would otherwise thin out
    const subGain = ctx.createGain();
    subGain.gain.value = 0.35;
    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.value = freq;
    vibGain.connect(sub.frequency);
    sub.connect(subGain).connect(lp);
    sub.start(when);
    sub.stop(when + dur + 0.4);
    vib.start(when);
    vib.stop(when + dur + 0.4);
  }

  // Suspended-cymbal swell: highpassed noise rising over the note's duration
  // and ringing out past it. A short duration reads as a crash.
  private cymSwell(when: number, dur: number, vel: number, out: GainNode): void {
    const ctx = this.ctx;
    const ring = 1.4;
    const len = Math.floor(ctx.sampleRate * (dur + ring));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(
      Math.max(0.001, vel * 0.26),
      when + Math.max(0.03, dur * 0.8),
    );
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + ring);
    src.connect(hp).connect(g).connect(out);
    src.start(when);
  }

  // Felt piano: a few detuned partials with register-scaled decay plus a soft
  // hammer-noise transient; the damper lifts at note end like a real pedal.
  private piano(when: number, freq: number, dur: number, vel: number, out: GainNode): void {
    const ctx = this.ctx;
    const naturalDecay = Math.min(5.2, Math.max(1.2, 380 / freq));
    const body = ctx.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.value = Math.min(5600, 1400 + freq * 4);
    body.Q.value = 0.35;
    body.connect(out);
    // stretched, inharmonic partial stack; the fundamental is a detuned
    // unison pair so exposed notes shimmer instead of reading as a bare sine
    const partials: ReadonlyArray<readonly [number, number, number, number]> = [
      [1, 0.62, 1, -3],
      [1.0005, 0.62, 1, 3],
      [2.003, 0.5, 0.58, 2],
      [3.006, 0.2, 0.36, -4],
      [4.012, 0.09, 0.24, 5],
      [5.02, 0.05, 0.17, -6],
      [7.03, 0.025, 0.12, 4],
    ];
    for (const [ratio, amp, decayMul, cents] of partials) {
      const decay = Math.min(naturalDecay * decayMul, dur + 0.35);
      const g = ctx.createGain();
      const peak = vel * 0.24 * amp;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(peak, when + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(0.14, decay));
      const o = ctx.createOscillator();
      o.type = ratio < 1.01 ? 'triangle' : 'sine';
      o.frequency.value = freq * ratio;
      o.detune.value = cents;
      o.connect(g).connect(body);
      o.start(when);
      o.stop(when + Math.max(0.14, decay) + 0.1);
    }
    // two-part hammer: a low felt thump and a soft brightness transient
    const hammerLen = Math.floor(ctx.sampleRate * 0.016);
    const buf = ctx.createBuffer(1, hammerLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < hammerLen; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / hammerLen);
    const hammer = ctx.createBufferSource();
    hammer.buffer = buf;
    const bright = ctx.createBiquadFilter();
    bright.type = 'bandpass';
    bright.frequency.value = Math.min(3200, freq * 4);
    bright.Q.value = 0.9;
    const bg = ctx.createGain();
    bg.gain.value = vel * 0.035;
    hammer.connect(bright).connect(bg).connect(out);
    const thump = ctx.createBufferSource();
    thump.buffer = buf;
    const tlp = ctx.createBiquadFilter();
    tlp.type = 'lowpass';
    tlp.frequency.value = 260;
    const tg = ctx.createGain();
    tg.gain.value = vel * 0.05;
    thump.connect(tlp).connect(tg).connect(out);
    hammer.start(when);
    thump.start(when);
  }

  // Shaker/hat: a short burst of highpassed noise for light rhythmic drive.
  private shaker(when: number, vel: number, out: GainNode): void {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 0.055);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 1.8;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.22, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
    src.connect(hp).connect(g).connect(out);
    src.start(when);
  }

  // Brass stab: detuned saw section with a fast bite, brighter and punchier
  // than the soft legato horn; for accents and battle hits.
  private brassStab(when: number, freq: number, dur: number, vel: number, out: GainNode): void {
    const ctx = this.ctx;
    const g = this.adsr(when, Math.min(dur, 0.8), vel * 0.16, 0.02, 0.14);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(3400, 700 + freq * 3), when);
    lp.frequency.exponentialRampToValueAtTime(Math.min(1900, 500 + freq * 2), when + 0.28);
    lp.Q.value = 0.7;
    lp.connect(g).connect(out);
    for (const det of [-8, 0, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(lp);
      o.start(when);
      o.stop(when + Math.min(dur, 0.8) + 0.3);
    }
    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.value = freq * 0.5;
    const sg = ctx.createGain();
    sg.gain.value = 0.3;
    sub.connect(sg).connect(lp);
    sub.start(when);
    sub.stop(when + Math.min(dur, 0.8) + 0.3);
  }

  private adsr(when: number, dur: number, peak: number, attack: number, release: number): GainNode {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    g.gain.setValueAtTime(peak, Math.max(when + attack, when + dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + release);
    return g;
  }

  private strings(
    when: number,
    freq: number,
    dur: number,
    vel: number,
    out: GainNode,
    attack = 0.3,
  ): void {
    const ctx = this.ctx;
    const g = this.adsr(when, dur, vel * 0.16, attack, 0.7);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 750 + freq * 2;
    lp.connect(g).connect(out);
    for (const det of [-6, 5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(lp);
      o.start(when);
      o.stop(when + dur + 0.9);
    }
  }

  private flute(when: number, freq: number, dur: number, vel: number, out: GainNode): void {
    const ctx = this.ctx;
    const g = this.adsr(when, dur, vel * 0.3, 0.07, 0.22);
    g.connect(out);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = freq;
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(0, when);
    lfoGain.gain.linearRampToValueAtTime(freq * 0.006, when + 0.35);
    lfo.connect(lfoGain);
    lfoGain.connect(o.frequency);
    lfoGain.connect(o2.frequency);
    o.connect(g);
    o2.connect(g2).connect(g);
    for (const osc of [o, o2, lfo]) {
      osc.start(when);
      osc.stop(when + dur + 0.4);
    }
  }

  private pluck(
    when: number,
    freq: number,
    vel: number,
    out: GainNode,
    decay: number,
    dark = false,
  ): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * (dark ? 0.3 : 0.22), when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = dark ? 600 : 2600;
    lp.connect(g).connect(out);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    o.connect(lp);
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(vel * 0.05, when);
    g2.gain.exponentialRampToValueAtTime(0.0001, when + decay * 0.5);
    o2.connect(g2).connect(out);
    o.start(when);
    o.stop(when + decay + 0.1);
    o2.start(when);
    o2.stop(when + decay + 0.1);
  }

  private horn(when: number, freq: number, dur: number, vel: number, out: GainNode): void {
    const ctx = this.ctx;
    const g = this.adsr(when, dur, vel * 0.2, 0.09, 0.3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 640;
    lp.connect(g).connect(out);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = freq;
    o.connect(lp);
    o2.connect(lp);
    o.start(when);
    o.stop(when + dur + 0.5);
    o2.start(when);
    o2.stop(when + dur + 0.5);
  }

  private choir(when: number, freq: number, dur: number, vel: number, out: GainNode): void {
    const ctx = this.ctx;
    const g = this.adsr(when, dur, vel * 0.13, 0.7, 1.1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 580;
    bp.Q.value = 0.6;
    bp.connect(g).connect(out);
    for (const det of [-9, 0, 8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(bp);
      o.start(when);
      o.stop(when + dur + 1.3);
    }
  }

  private pad(when: number, freq: number, dur: number, vel: number, out: GainNode): void {
    const ctx = this.ctx;
    const g = this.adsr(when, dur, vel * 0.24, 0.75, 1.15);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(1400, 380 + freq * 1.1);
    lp.Q.value = 0.35;
    lp.connect(g).connect(out);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = freq;
    const g2 = ctx.createGain();
    g2.gain.value = 0.28;
    o.connect(lp);
    o2.connect(g2).connect(lp);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = freq * 0.0025;
    lfo.connect(lfoGain);
    lfoGain.connect(o.frequency);
    lfoGain.connect(o2.frequency);
    for (const osc of [o, o2, lfo]) {
      osc.start(when);
      osc.stop(when + dur + 1.3);
    }
  }

  private lute(when: number, freq: number, vel: number, out: GainNode): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.2, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.05);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 120;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2100;
    hp.connect(lp).connect(g).connect(out);

    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2.01;
    const g2 = ctx.createGain();
    g2.gain.value = 0.16;
    o.connect(hp);
    o2.connect(g2).connect(hp);

    // tiny pitch bend gives plucked-string life without needing samples.
    o.frequency.setValueAtTime(freq * 1.01, when);
    o.frequency.exponentialRampToValueAtTime(freq, when + 0.08);
    o.start(when);
    o.stop(when + 1.15);
    o2.start(when);
    o2.stop(when + 0.8);
  }

  private dulcimer(when: number, freq: number, vel: number, out: GainNode): void {
    const ctx = this.ctx;
    const body = ctx.createBiquadFilter();
    body.type = 'bandpass';
    body.frequency.value = Math.min(4200, freq * 3.2);
    body.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.18, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.8);
    body.connect(g).connect(out);

    for (const [ratio, amp, decay] of [
      [1, 1, 1.8],
      [2.01, 0.35, 1.1],
      [3.02, 0.12, 0.7],
    ] as const) {
      const og = ctx.createGain();
      og.gain.setValueAtTime(amp, when);
      og.gain.exponentialRampToValueAtTime(0.0001, when + decay);
      const o = ctx.createOscillator();
      o.type = ratio === 1 ? 'triangle' : 'sine';
      o.frequency.value = freq * ratio;
      o.connect(og).connect(body);
      o.start(when);
      o.stop(when + decay + 0.1);
    }
  }

  private reed(when: number, freq: number, dur: number, vel: number, out: GainNode): void {
    const ctx = this.ctx;
    const g = this.adsr(when, dur, vel * 0.16, 0.04, 0.18);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(1800, 420 + freq * 1.8);
    bp.Q.value = 1.1;
    bp.connect(g).connect(out);
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = freq * 0.5;
    const g2 = ctx.createGain();
    g2.gain.value = 0.2;
    o.connect(bp);
    o2.connect(g2).connect(bp);
    o.start(when);
    o.stop(when + dur + 0.25);
    o2.start(when);
    o2.stop(when + dur + 0.25);
  }

  private pipe(when: number, freq: number, dur: number, vel: number, out: GainNode): void {
    const ctx = this.ctx;
    const g = this.adsr(when, dur, vel * 0.22, 0.035, 0.28);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    lp.connect(g).connect(out);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const airy = ctx.createOscillator();
    airy.type = 'triangle';
    airy.frequency.value = freq * 2;
    const airyGain = ctx.createGain();
    airyGain.gain.value = 0.08;
    o.connect(lp);
    airy.connect(airyGain).connect(lp);
    o.start(when);
    o.stop(when + dur + 0.35);
    airy.start(when);
    airy.stop(when + dur + 0.35);
  }

  private squareLead(when: number, freq: number, dur: number, vel: number, out: GainNode): void {
    const ctx = this.ctx;
    const g = this.adsr(when, Math.min(dur, 0.7), vel * 0.14, 0.012, 0.08);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(3600, 900 + freq * 2.4);
    lp.Q.value = 0.45;
    lp.connect(g).connect(out);

    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = freq * 0.5;
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6.4;
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(0, when);
    lfoGain.gain.linearRampToValueAtTime(freq * 0.0035, when + 0.05);
    lfo.connect(lfoGain);
    lfoGain.connect(o.frequency);
    o.connect(lp);
    o2.connect(g2).connect(lp);
    for (const osc of [o, o2, lfo]) {
      osc.start(when);
      osc.stop(when + dur + 0.12);
    }
  }

  private tinyBell(when: number, freq: number, vel: number, out: GainNode): void {
    const ctx = this.ctx;
    for (const [ratio, amp, dec] of [
      [1, 0.16, 1.1],
      [2.01, 0.06, 0.7],
      [3.01, 0.025, 0.42],
    ] as const) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel * amp, when);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dec);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * ratio;
      o.connect(g).connect(out);
      o.start(when);
      o.stop(when + dec + 0.1);
    }
  }

  private woodBlock(when: number, vel: number, out: GainNode): void {
    const ctx = this.ctx;
    const body = ctx.createBiquadFilter();
    body.type = 'bandpass';
    body.frequency.value = 960;
    body.Q.value = 5.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.35, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.08);
    body.connect(g).connect(out);

    const noiseLen = Math.floor(ctx.sampleRate * 0.035);
    const buf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++)
      data[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen) ** 2.2;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(body);
    src.start(when);

    const tick = ctx.createOscillator();
    tick.type = 'triangle';
    tick.frequency.value = 1180;
    tick.connect(body);
    tick.start(when);
    tick.stop(when + 0.06);
  }

  private frameDrum(when: number, vel: number, out: GainNode): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.45, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.28);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.7;
    bp.connect(g).connect(out);

    const noiseLen = Math.floor(ctx.sampleRate * 0.09);
    const buf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++)
      data[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen) ** 1.6;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(bp);
    src.start(when);

    const tone = ctx.createOscillator();
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(vel * 0.08, when);
    tg.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
    tone.type = 'sine';
    tone.frequency.value = 140;
    tone.connect(tg).connect(out);
    tone.start(when);
    tone.stop(when + 0.24);
  }

  private warDrum(when: number, vel: number, out: GainNode): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.48, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.4);
    g.connect(out);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(82, when);
    o.frequency.exponentialRampToValueAtTime(43, when + 0.42);
    o.connect(g);
    o.start(when);
    o.stop(when + 1.45);

    const clickLen = Math.floor(ctx.sampleRate * 0.045);
    const buf = ctx.createBuffer(1, clickLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < clickLen; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / clickLen);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    const ng = ctx.createGain();
    ng.gain.value = vel * 0.3;
    src.connect(lp).connect(ng).connect(out);
    src.start(when);
  }

  private bell(when: number, freq: number, vel: number, out: GainNode): void {
    const ctx = this.ctx;
    for (const [ratio, amp, dec] of [
      [1, 0.22, 3.4],
      [2.0, 0.08, 2.2],
      [2.76, 0.06, 1.4],
    ] as const) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel * amp, when);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dec);
      g.connect(out);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * ratio * 0.5;
      o.connect(g);
      o.start(when);
      o.stop(when + dec + 0.1);
    }
  }

  private timpani(when: number, _freq: number, vel: number, out: GainNode): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.5, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.0);
    g.connect(out);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(mtof(38), when);
    o.frequency.exponentialRampToValueAtTime(mtof(38) * 0.55, when + 0.32);
    o.connect(g);
    o.start(when);
    o.stop(when + 1.1);
    const noiseLen = Math.floor(ctx.sampleRate * 0.08);
    const buf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    const ng = ctx.createGain();
    ng.gain.value = vel * 0.5;
    src.connect(lp).connect(ng).connect(out);
    src.start(when);
  }
}

export class MusicDirector {
  private ctx: AudioContext | null = null;
  private synth: MusicSynth | null = null;
  private master: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbSend: GainNode | null = null;
  private bossGain: GainNode | null = null;
  private bossBuffer: AudioBuffer | null = null;
  private bossSource: AudioBufferSourceNode | null = null;
  private bossElement: HTMLAudioElement | null = null;
  private bossLoading = false;
  private layers: Record<string, Layer> = {};
  private timer: number | undefined;
  // null until the first update() so the initial state always applies
  private zone: MusicZone | null = null;
  private combat = false;
  // try/catch: sandboxed documents throw on the localStorage property access itself
  private _enabled = (() => {
    try {
      return typeof localStorage === 'undefined' || localStorage.getItem(STORAGE_KEY) !== '0';
    } catch {
      return true;
    }
  })();
  private _vol = 1; // 0..1 volume, set from the settings menu
  private _menuPaused = false; // temporary mute while the game menu is open
  // Boss-fight override: a looped file track routed through the same AudioContext
  // that user gestures already unlock for the procedural soundtrack.
  private bossActive = false;

  get enabled(): boolean {
    return this._enabled;
  }

  // master gain target given the enabled flag and volume (base level 0.15).
  // The dedicated Nythraxis track owns the mix while active.
  private masterTarget(): number {
    if (!this._enabled || this._menuPaused || this.bossActive) return 0;
    return 0.15 * this._vol;
  }

  /** Engage/disengage the dedicated boss-fight loop. Idempotent; called every
   *  frame by the HUD. Ducks the procedural score while active. */
  setBossCombat(on: boolean): void {
    if (on === this.bossActive) {
      if (on) this.applyBossPlayback();
      return;
    }
    this.bossActive = on;
    if (on) this.ensureBossBuffer();
    if (!on) this.stopBossSource();
    this.applyBossPlayback();
    if (this.ctx && this.master)
      this.master.gain.setTargetAtTime(this.masterTarget(), this.ctx.currentTime, on ? 0.4 : 0.7);
  }

  resetForDungeonEntry(dungeonId: string | null): void {
    if (!dungeonId) return;
    const zone = dungeonMusicZoneForDungeon(dungeonId);
    const layer = this.layers[zone];
    if (layer) {
      layer.anchor = this.ctx?.currentTime ?? 0;
      layer.nextIdx = -1;
      layer.loopCount = 0;
    }
    if (this.bossElement) {
      try {
        this.bossElement.currentTime = 0;
      } catch {
        /* browser may reject seeking before metadata */
      }
    }
    this.stopBossSource();
  }

  private applyBossPlayback(): void {
    if (!this.ctx || !this.bossGain) return;
    const target = this.bossActive && this._enabled && !this._menuPaused ? 0.6 * this._vol : 0;
    this.bossGain.gain.setTargetAtTime(target, this.ctx.currentTime, target > 0 ? 0.25 : 0.12);
    if (target > 0) {
      void this.ctx.resume?.();
      const element = this.ensureBossElement();
      if (element) {
        element.volume = target;
        void element.play().catch(() => {
          this.ensureBossBuffer();
          this.startBossSource();
        });
        this.stopBossSource();
      } else {
        this.ensureBossBuffer();
        this.startBossSource();
      }
    } else {
      if (this.bossElement) this.bossElement.pause();
      this.stopBossSource();
    }
  }

  private ensureBossElement(): HTMLAudioElement | null {
    if (this.bossElement) return this.bossElement;
    if (typeof Audio !== 'function') return null;
    const el = new Audio('/audio/dungeon-boss-fight.mp3');
    el.loop = true;
    el.preload = 'auto';
    this.bossElement = el;
    return el;
  }

  private ensureBossBuffer(): void {
    const ctx = this.ctx;
    if (!ctx || this.bossBuffer || this.bossLoading || typeof fetch !== 'function') return;
    this.bossLoading = true;
    void fetch('/audio/dungeon-boss-fight.mp3')
      .then((res) => res.arrayBuffer())
      .then((bytes) => ctx.decodeAudioData(bytes))
      .then((buffer) => {
        this.bossBuffer = buffer;
        this.bossLoading = false;
        this.applyBossPlayback();
      })
      .catch(() => {
        this.bossLoading = false;
      });
  }

  private startBossSource(): void {
    const ctx = this.ctx;
    if (!ctx || !this.bossGain || !this.bossBuffer || this.bossSource) return;
    const src = ctx.createBufferSource();
    src.buffer = this.bossBuffer;
    src.loop = true;
    src.connect(this.bossGain);
    src.start();
    this.bossSource = src;
  }

  private stopBossSource(): void {
    if (!this.bossSource) return;
    try {
      this.bossSource.stop();
    } catch {
      /* already stopped */
    }
    this.bossSource.disconnect();
    this.bossSource = null;
  }

  /** Set music volume (0..1). Safe before init(); applied to the master gain. */
  setVolume(v: number): void {
    this._vol = Math.min(1, Math.max(0, v));
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.masterTarget(), this.ctx.currentTime, 0.2);
    }
    this.applyBossPlayback();
  }

  get volume(): number {
    return this._vol;
  }

  init(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.synth = new MusicSynth(ctx);
    this.master = ctx.createGain();
    this.master.gain.value = this.masterTarget();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 2.2;
    compressor.attack.value = 0.015;
    compressor.release.value = 0.25;
    this.master.connect(compressor);
    compressor.connect(ctx.destination);
    this.bossGain = ctx.createGain();
    this.bossGain.gain.value = 0;
    this.bossGain.connect(compressor);

    // generated hall impulse response
    const seconds = 2.6;
    const len = Math.floor(ctx.sampleRate * seconds);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.4;
      }
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.55;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);

    const themes = buildMusicThemes();
    for (const [name, theme] of Object.entries(themes)) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.master);
      gain.connect(this.reverbSend);
      this.layers[name] = {
        theme,
        gain,
        target: 0,
        anchor: 0,
        nextIdx: -1,
        loopCount: 0,
        transpose: 0,
        trim: THEME_TRIM[name] ?? 1,
      };
    }
    this.timer = window.setInterval(() => this.tickScheduler(), 110);
  }

  setEnabled(on: boolean): void {
    this._enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    } catch {
      /* private mode */
    }
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.masterTarget(), this.ctx.currentTime, 0.3);
    }
    this.applyBossPlayback();
  }

  /** Fade out while the game menu is open; does not change the music toggle. */
  pauseForMenu(): void {
    if (this._menuPaused) return;
    this._menuPaused = true;
    if (!this.ctx) return;
    void this.ctx.resume();
    if (this.master) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    }
    this.applyBossPlayback();
  }

  /** Restore playback after closing the game menu. */
  resumeFromMenu(): void {
    if (!this._menuPaused) return;
    this._menuPaused = false;
    if (!this.ctx) return;
    void this.ctx.resume();
    if (this.master) {
      this.master.gain.setTargetAtTime(this.masterTarget(), this.ctx.currentTime, 0.35);
    }
    this.applyBossPlayback();
  }

  // called every frame by the HUD; cheap unless the state changed
  update(zone: MusicZone, inCombat: boolean): void {
    if (!this.ctx) return;
    if (zone === this.zone && inCombat === this.combat) return;
    this.zone = zone;
    this.combat = inCombat;
    const now = this.ctx.currentTime;
    for (const [name, layer] of Object.entries(this.layers)) {
      if (name === 'combat') continue;
      // combat music replaces the zone theme rather than layering over it: the
      // zone is silenced for the duration of combat and fades back in when it ends
      const target = name === zone ? (inCombat ? 0 : 1) : 0;
      if (layer.target !== target) {
        layer.target = target;
        // fade out faster than fade in so instance music doesn't bleed into the world
        const fade = target > 0 ? FADE_SECONDS / 3 : 0.35;
        layer.gain.gain.setTargetAtTime(target * layer.trim, now, fade);
        if (target === 0) layer.nextIdx = -1;
      }
    }
    const combatLayer = this.layers.combat;
    // ostinato follows the zone's tonal center (see COMBAT_TRANSPOSE) — kept
    // current on every zone crossing, not just when combat starts, so being
    // chased across a border can't leave it in the previous zone's key
    if (inCombat) combatLayer.transpose = COMBAT_TRANSPOSE[zone];
    const combatTarget = inCombat ? 1 : 0;
    if (combatLayer.target !== combatTarget) {
      combatLayer.target = combatTarget;
      combatLayer.gain.gain.setTargetAtTime(
        combatTarget * combatLayer.trim,
        now,
        inCombat ? 0.35 : FADE_SECONDS / 3,
      );
    }
  }

  private tickScheduler(): void {
    const ctx = this.ctx;
    if (!ctx || !this._enabled) return;
    const horizon = ctx.currentTime + LOOKAHEAD;
    for (const layer of Object.values(this.layers)) {
      // schedule only active layers — don't keep pumping long dungeon notes
      // while a fading-out gain node is still above zero
      if (layer.target <= 0.001) {
        layer.nextIdx = -1;
        continue;
      }
      const spb = 60 / layer.theme.bpm;
      const loopBeats = layer.theme.bars * 4;
      if (layer.nextIdx === -1) {
        layer.anchor = ctx.currentTime + 0.15;
        layer.nextIdx = 0;
        layer.loopCount = 0;
      }
      for (let guard = 0; guard < 220; guard++) {
        const evt = layer.theme.events[layer.nextIdx];
        const when = layer.anchor + (layer.loopCount * loopBeats + evt.beat) * spb;
        if (when > horizon) break;
        if (when >= ctx.currentTime - 0.03) {
          this.synth!.playNote(evt, when, spb, layer);
        }
        layer.nextIdx++;
        if (layer.nextIdx >= layer.theme.events.length) {
          layer.nextIdx = 0;
          layer.loopCount++;
        }
      }
    }
  }
}

export const music = new MusicDirector();
