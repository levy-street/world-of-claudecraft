// The adventure soundtrack, in two halves. The composition half is unchanged:
// every theme is still authored as note data (per-place leitmotifs, layered
// ostinati, multi-section forms) played by the MusicSynth voices, and that
// machinery keeps powering the music editor (music_editor.html) and the
// offline render pipeline (scripts/render_music.mjs). The runtime half no
// longer synthesizes: the shipped game streams the remastered mp3 renders of
// those themes (public/audio/music/, see music_tracks.ts) through looping
// media elements routed into one WebAudio graph, so zone changes crossfade
// exactly as before while playback costs no synthesis CPU and no up-front
// download. Each fight opens on one of the two battle themes at random.

import type { BiomeId } from '../sim/types';
import { resumeWhenAllowed } from './audio_unlock';
import { MUSIC_OVERRIDES } from './music_overrides.generated';
import { COMBAT_STREAM_URLS, pickCombatTrackIndex, ZONE_STREAM_URLS } from './music_tracks';

export type MusicZone =
  | 'town_eastbrook'
  | 'town_fenbridge'
  | 'town_highwatch'
  | 'vale'
  | 'vale_legacy'
  | 'marsh'
  | 'peaks'
  | 'dusk'
  | 'ember'
  | 'frost'
  | 'amber'
  | 'fen'
  | 'night'
  | 'haunt'
  | 'jungle'
  | 'garden'
  | 'gale'
  | 'farshore'
  | 'vale_cup'
  | 'dungeon_hollow_crypt'
  | 'dungeon_sunken_bastion'
  | 'dungeon_gravewyrm_sanctum'
  | 'rift_frost'
  | 'rift_ember'
  | 'rift_venom'
  | 'rift_bone'
  | 'rift_brute'
  | 'rift_void'
  | 'rift_storm'
  | 'rift_tide';

const TOWN_MUSIC: Record<string, MusicZone> = {
  eastbrook_vale: 'town_eastbrook',
  mirefen_marsh: 'town_fenbridge',
  thornpeak_heights: 'town_highwatch',
};

// Per-zone overworld overrides. Farshore Isle shares the vale biome palette
// but is the rift-scarred landfall where the breach story starts, so it gets
// its own vigil theme instead of the vale's playful loop.
const ZONE_MUSIC: Partial<Record<string, MusicZone>> = {
  farshore_isle: 'farshore',
};

// Every overworld biome resolves to a bespoke theme; the paint-only biomes
// that never anchor a shipped zone (beach/desert/volcano/cave) borrow the
// nearest-mood cue so a realm or custom-map zone always scores. tsc keeps
// this table exhaustive over BiomeId.
const BIOME_MUSIC: Record<BiomeId, MusicZone> = {
  vale: 'vale',
  marsh: 'marsh',
  peaks: 'peaks',
  dusk: 'dusk',
  ember: 'ember',
  frost: 'frost',
  amber: 'amber',
  fen: 'fen',
  night: 'night',
  haunt: 'haunt',
  jungle: 'jungle',
  garden: 'garden',
  gale: 'gale',
  beach: 'jungle',
  desert: 'ember',
  volcano: 'ember',
  cave: 'dusk',
};

// Procedural Rift floors carry a RiftTheme (src/sim/content/rift/themes.ts);
// the floor view ships the theme's display name, so the crawl cue is keyed by
// that name. tests/music.test.ts pins this table against RIFT_THEMES so a new
// or renamed archetype cannot silently fall back.
const RIFT_MUSIC: Record<string, MusicZone> = {
  Frostbound: 'rift_frost',
  Emberforge: 'rift_ember',
  Venomweald: 'rift_venom',
  Boneyard: 'rift_bone',
  Warcamp: 'rift_brute',
  Voidscar: 'rift_void',
  Stormspire: 'rift_storm',
  Sunken: 'rift_tide',
  // The authored set piece: hellfire halls read as the forge archetype.
  'Infernal Citadel': 'rift_ember',
};

/** Crawl cue for a procedural Rift floor, from RiftFloorView.themeName. */
export function riftMusicZoneForTheme(themeName: string): MusicZone {
  return RIFT_MUSIC[themeName] ?? 'rift_void';
}

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
  biome: BiomeId,
  inHub: boolean,
  inDungeon: boolean,
  dungeonId: string | null = null,
): MusicZone {
  const biomeLayer: MusicZone = BIOME_MUSIC[biome];
  if (inDungeon) return dungeonId ? dungeonMusicZoneForDungeon(dungeonId) : 'dungeon_hollow_crypt';
  // A hub without a dedicated town theme keeps its zone's own cue: Gullhaven
  // is the heart of the Farshore vigil, not a reason to fall back to the vale.
  if (inHub) return TOWN_MUSIC[zoneId] ?? ZONE_MUSIC[zoneId] ?? biomeLayer;
  return ZONE_MUSIC[zoneId] ?? biomeLayer;
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

/** The Sowfield: "Boots and Banners". D major, 108 bpm, 16 bars. The Vale Cup
 *  match-day tune (docs/prd/vale-cup.md): a jaunty harvest-festival stomp that
 *  stays kin to Eastbrook's D major so the walk-up crossfade from the vale
 *  never clashes. Oom-pah lute-and-bass under a whistling pipe tune, frame
 *  drum on the boots, wood block and shaker for the clapping stands, and a
 *  dulcimer answer in the back eight where the crowd starts singing along. */
function composeValeCup(): Theme {
  const ev: NoteEvent[] = [];
  const D = { root: 62 },
    G = { root: 55 },
    A = { root: 57 },
    Bm = { root: 59, minor: true };
  const chords: ChordDef[] = [D, G, D, A, D, G, A, D, Bm, G, D, A, G, D, A, D];

  chords.forEach((c, bar) => {
    const b0 = bar * 4;
    const t = triad(c);
    // oom-pah: bass root on 1 and 3, lute chord stabs on 2, 2.5, 4, 4.5
    pushNote(ev, b0, c.root - 24, 0.9, 0.55, 'bass');
    pushNote(ev, b0 + 2, c.root - 17, 0.9, 0.46, 'bass');
    for (const off of [1, 1.5, 3, 3.5]) {
      for (const n of t) pushNote(ev, b0 + off, n, 0.4, 0.2, 'lute');
    }
    // boots on the boards: frame drum 1 and 3, wood block offbeats, shaker run
    pushDrumHits(ev, b0, [0, 2], 'frameDrum', 0.5, 40);
    pushDrumHits(ev, b0, [1, 3], 'woodBlock', 0.3, 60);
    pushDrumHits(ev, b0, [0.5, 1.5, 2.5, 3.5], 'shaker', 0.16, 70);
    // the stands hum along in the back eight
    if (bar >= 8) {
      for (const n of t) pushNote(ev, b0, n - 12, 4.05, 0.16, 'strings');
      pushNote(ev, b0 + 2, t[2] - 5, 2, 0.12, 'horn');
    }
  });

  // pipe tune: an eight-bar kick-about phrase, then answered up the octave
  const phraseA: Phrase = [
    [0, 74, 0.5],
    [0.5, 76, 0.5],
    [1, 78, 1],
    [2, 74, 1],
    [3, 69, 1],
    [4, 71, 0.5],
    [4.5, 74, 0.5],
    [5, 79, 1.5],
    [6.5, 78, 0.5],
    [7, 74, 1],
    [8, 74, 0.5],
    [8.5, 76, 0.5],
    [9, 78, 1],
    [10, 81, 1],
    [11, 78, 1],
    [12, 76, 0.5],
    [12.5, 74, 0.5],
    [13, 76, 1.5],
    [14.5, 73, 0.5],
    [15, 74, 1],
    [16, 78, 0.5],
    [16.5, 79, 0.5],
    [17, 81, 1],
    [18, 78, 1],
    [19, 74, 1],
    [20, 76, 0.5],
    [20.5, 78, 0.5],
    [21, 79, 1.5],
    [22.5, 78, 0.5],
    [23, 76, 1],
    [24, 74, 0.5],
    [24.5, 73, 0.5],
    [25, 74, 1],
    [26, 76, 1],
    [27, 78, 1],
    [28, 74, 2.5],
    [31, 69, 1],
  ];
  pushPhrase(ev, 0, phraseA, 0.4, 'pipe');
  // the dulcimer picks the tune up an octave over the humming stands
  pushPhrase(
    ev,
    32,
    phraseA.map(([b, m, d]) => [b, m + 12, d] as [number, number, number]),
    0.3,
    'dulcimer',
  );
  // and the pipe rides along in harmony a third below
  pushPhrase(
    ev,
    32,
    phraseA.map(([b, m, d]) => [b, m - 3, d] as [number, number, number]),
    0.22,
    'pipe',
  );

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 108, bars: 16, events: ev };
}

// ---------------------------------------------------------------------------
// The eleven new-world themes. Every zone the world grid added carries its own
// through-composed cue grown from its look and lore (the briefs live in each
// zone's content module): a vigil for the besieged landfall isle, a lydian
// hymn for the sealed hollow, a gallop for the drake wastes, and so on. Each
// states a leitmotif, develops it over terraced sections, and loops without a
// dead seam, exactly like the original three-zone set.
// ---------------------------------------------------------------------------

/** Farshore Isle: "The Bell of Gullhaven". A aeolian, 72 bpm, 24 bars, ABA'.
 *  The landfall isle holds its shore against the breaks: a fishing town
 *  turned redoubt, wardens at the barricades, and a bell that finds you
 *  before the town does. Harp surf rolls under an oboe lament for the tired
 *  defenders; the middle eight turns to C major (the muster fire, the
 *  wardens holding) with a horn resolve theme; the reprise brings the
 *  lament back over a far war drum. The bell itself tells the island's
 *  warning code across the form: one toll for the fields, two for the
 *  cliffs, three when it is too close to outrun. */
function composeFarshore(): Theme {
  const ev: NoteEvent[] = [];
  type BarSpec = { root: number; surf: number[]; pad: number[] };
  // surf: the harp's rolling eighth figure, out with the wave and back
  const Am: BarSpec = { root: 45, surf: [45, 52, 57, 60, 64, 60, 57, 52], pad: [57, 60, 64] };
  const Fma7: BarSpec = { root: 41, surf: [41, 48, 53, 57, 60, 57, 53, 48], pad: [53, 57, 60] };
  const C: BarSpec = { root: 36, surf: [36, 43, 48, 52, 55, 52, 48, 43], pad: [55, 60, 64] };
  const G: BarSpec = { root: 43, surf: [43, 50, 55, 59, 62, 59, 55, 50], pad: [55, 59, 62] };
  const Dm7: BarSpec = { root: 38, surf: [38, 45, 50, 53, 57, 53, 50, 45], pad: [53, 57, 62] };
  const Em: BarSpec = { root: 40, surf: [40, 47, 52, 55, 59, 55, 52, 47], pad: [55, 59, 64] };
  const E: BarSpec = { root: 40, surf: [40, 47, 52, 56, 59, 56, 52, 47], pad: [56, 59, 64] };
  const A8: BarSpec[] = [Am, Fma7, C, G, Am, Dm7, Em, Am];
  const B8: BarSpec[] = [C, G, Am, Fma7, C, Fma7, G, E];
  const bars: BarSpec[] = [...A8, ...B8, ...A8];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const inB = bar >= 8 && bar < 16;
    const inA2 = bar >= 16;
    // grey-water pad, breathing every two bars; strings thicken the resolve
    if (bar % 2 === 0) pushVoicing(ev, b0, c.pad, 8.2, 0.12, 'pad');
    if (inB) pushVoicing(ev, b0, [c.pad[0] - 12, c.pad[2] - 12], 4.05, 0.1, 'strings');
    // bass: the tide pulling at the pilings
    pushNote(ev, b0, c.root, 2.2, 0.3, 'bass');
    if (bar % 2 === 1) pushNote(ev, b0 + 2.5, c.root + 7, 1.2, 0.16, 'bass');
    // harp surf: each wave crests mid-bar and falls back
    for (const [i, m] of c.surf.entries()) {
      const swell = i <= 4 ? i : 8 - i;
      pushNote(ev, b0 + i * 0.5, m, 0.55, 0.09 + swell * 0.02, 'harp');
    }
    // the muster: drums only where the wardens stand (B), else a far break
    if (inB) {
      pushDrumHits(ev, b0, [0, 2], 'frameDrum', 0.1, 44);
      if (bar % 2 === 1) pushNote(ev, b0, 38, 0.9, 0.12, 'warDrum');
    } else if (bar % 4 === 3) {
      pushNote(ev, b0 + 3.25, 38, 0.8, inA2 ? 0.12 : 0.08, 'warDrum');
    }
    // rigging clicks off the grid, gulls in the reprise
    if (bar % 8 === 5) pushDrumHits(ev, b0, [1.75, 3.5], 'woodBlock', 0.05, 70);
    if (inA2 && bar % 4 === 1) pushNote(ev, b0 + 2.25, 84, 0.9, 0.05, 'tinyBell');
  });

  // the bell's warning code paces the form: one toll, two tolls, three
  pushNote(ev, 0, 57, 3.5, 0.13, 'bell');
  pushNote(ev, 32, 57, 3.5, 0.13, 'bell');
  pushNote(ev, 33.5, 57, 3.5, 0.11, 'bell');
  pushNote(ev, 64, 57, 3.5, 0.13, 'bell');
  pushNote(ev, 65.5, 57, 3.5, 0.11, 'bell');
  pushNote(ev, 67, 57, 3.5, 0.1, 'bell');

  // the lament: an oboe for a town that has been waiting a long while
  const lament: Phrase = [
    [0, 64, 1.5],
    [1.5, 67, 0.5],
    [2, 69, 2],
    [4, 72, 1],
    [5, 71, 0.5],
    [5.5, 69, 0.5],
    [6, 67, 2],
    [8, 69, 1],
    [9, 72, 1],
    [10, 76, 1.5],
    [11.5, 74, 0.5],
    [12, 72, 1],
    [13, 69, 1],
    [14, 71, 2],
    [16, 72, 1.5],
    [17.5, 71, 0.5],
    [18, 69, 1],
    [19, 67, 1],
    [20, 65, 1],
    [21, 62, 1],
    [22, 64, 2],
    [24, 67, 1.5],
    [25.5, 64, 0.5],
    [26, 62, 1],
    [27, 59, 1],
    [28, 57, 3.5],
  ];
  pushPhrase(ev, 0, lament, 0.2, 'oboe');
  // the wardens: a horn theme rising in fourths over the muster fire
  const wardens: Phrase = [
    [0, 60, 1],
    [1, 65, 1],
    [2, 67, 1.5],
    [3.5, 65, 0.5],
    [4, 64, 1],
    [5, 62, 1],
    [6, 64, 2],
    [8, 64, 1],
    [9, 69, 1],
    [10, 72, 2],
    [12, 69, 1],
    [13, 65, 1],
    [14, 67, 2],
    [16, 67, 1.5],
    [17.5, 64, 0.5],
    [18, 60, 1],
    [19, 64, 1],
    [20, 65, 2],
    [22, 62, 2],
    [24, 62, 1],
    [25, 64, 1],
    [26, 67, 1.5],
    [27.5, 64, 0.5],
    [28, 64, 1],
    [29, 68, 1.5],
    [30.5, 71, 1.5],
  ];
  pushPhrase(ev, 32, wardens, 0.19, 'horn');
  // reprise: the flute keeps the lament company over the far drum
  pushPhrase(ev, 64, lament, 0.22, 'flute');
  pushPhrase(ev, 64, lament, 0.1, 'harp');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 72, bars: 24, events: ev };
}

/** Veiled Hollow: "Under the Eldergleam". F lydian, 66 bpm, 24 bars, ABA'.
 *  A valley sealed beneath the mountains in permanent dusk, glowing flora,
 *  a town grown around the roots of a great tree. The lydian fourth keeps
 *  the air raised and wondering: dulcimer-and-bell glimmer for the wisps, a
 *  serene flute hymn for Eldergleam, and a middle eight that sinks to D
 *  minor for the corrupted fringe (the Sunken Court), where a reed grieves
 *  over a wounded choir drone before the seal holds and the light returns. */
function composeDusk(): Theme {
  const ev: NoteEvent[] = [];
  type BarSpec = { root: number; glim: number[]; pad: number[] };
  const F: BarSpec = { root: 41, glim: [53, 57, 60, 65, 71, 76], pad: [53, 57, 60] };
  const Gof: BarSpec = { root: 41, glim: [53, 59, 62, 65, 67, 74], pad: [55, 59, 62] };
  const Am7: BarSpec = { root: 45, glim: [52, 57, 60, 64, 67, 72], pad: [55, 60, 64] };
  const C: BarSpec = { root: 36, glim: [52, 55, 60, 64, 67, 72], pad: [52, 55, 60] };
  const Em7: BarSpec = { root: 40, glim: [52, 55, 59, 62, 66, 71], pad: [52, 59, 62] };
  const Dm: BarSpec = { root: 38, glim: [50, 53, 57, 62, 65, 69], pad: [50, 53, 57] };
  const Bb: BarSpec = { root: 34, glim: [50, 53, 58, 62, 65, 70], pad: [50, 53, 58] };
  const Gm: BarSpec = { root: 43, glim: [50, 55, 58, 62, 67, 70], pad: [50, 55, 58] };
  const A5: BarSpec = { root: 45, glim: [52, 57, 61, 64, 69, 73], pad: [52, 57, 61] };
  const A8: BarSpec[] = [F, Gof, Am7, F, C, Em7, Gof, F];
  const B8: BarSpec[] = [Dm, Bb, Gm, Dm, Bb, Gm, A5, A5];
  const bars: BarSpec[] = [...A8, ...B8, ...A8];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const inB = bar >= 8 && bar < 16;
    const inA2 = bar >= 16;
    // the hollow's held breath: pad every two bars, old magic in the choir
    if (bar % 2 === 0) pushVoicing(ev, b0, c.pad, 8.2, 0.14, 'pad');
    if ((inB || inA2) && bar % 2 === 0) {
      pushNote(ev, b0, c.root - (c.root > 40 ? 12 : 0), 8.2, inB ? 0.11 : 0.07, 'choir');
      if (inB) pushNote(ev, b0, c.root + 7 - (c.root > 40 ? 12 : 0), 8.2, 0.07, 'choir');
    }
    pushNote(ev, b0, c.root, 2.6, 0.28, 'bass');
    if (bar % 2 === 1) pushNote(ev, b0 + 2.5, c.root + 7, 1.2, 0.14, 'bass');
    // wisplight: a dulcimer climb that never lands, bells drifting above it
    if (!inB) {
      for (const [i, m] of c.glim.entries()) {
        pushNote(ev, b0 + i * 0.5, m, 0.7, 0.08 + (i % 2 === 0 ? 0.04 : 0), 'dulcimer');
      }
      if (bar % 2 === 1) pushNote(ev, b0 + 2.25, c.glim[5] + 12, 1.1, 0.06, 'tinyBell');
      if (bar % 4 === 2) pushNote(ev, b0 + 3.5, c.glim[4] + 12, 1.1, 0.05, 'tinyBell');
    } else {
      // the corrupted fringe: the glimmer stops, spore-slow piano drops fall
      const dropBeats = bar % 2 === 0 ? [0.75, 2.25, 3.5] : [1.25, 2.75, 3.25];
      for (const [i, t] of dropBeats.entries()) {
        pushNote(ev, b0 + t, c.glim[[1, 3, 2][i]], 1.2, 0.13, 'piano');
      }
      // a minor-second shimmer for the wound in the seal
      if (bar % 2 === 0) pushVoicing(ev, b0, [69, 70], 8.2, 0.05, 'strings');
    }
    // harp roots the grove on phrase starts
    if (bar % 4 === 0) {
      for (const [i, m] of [c.glim[0], c.glim[2], c.glim[3]].entries()) {
        pushNote(ev, b0 + i * 0.17, m, 1.4, 0.1, 'harp');
      }
    }
  });

  // the Eldergleam hymn, floating on the lydian fourth
  const hymn: Phrase = [
    [0, 65, 1],
    [1, 69, 1],
    [2, 71, 1.5],
    [3.5, 72, 0.5],
    [4, 72, 2],
    [6, 71, 1],
    [7, 69, 1],
    [8, 67, 1],
    [9, 71, 1],
    [10, 74, 2],
    [12, 72, 1],
    [13, 71, 1],
    [14, 69, 2],
    [16, 64, 1],
    [17, 69, 1],
    [18, 72, 1.5],
    [19.5, 74, 0.5],
    [20, 76, 2],
    [22, 74, 1],
    [23, 72, 1],
    [24, 71, 1.5],
    [25.5, 69, 0.5],
    [26, 67, 1],
    [27, 64, 1],
    [28, 65, 3.5],
  ];
  pushPhrase(ev, 0, hymn, 0.24, 'flute');
  // the Sunken Court: a reed grieving under the wounded drone
  const grief: Phrase = [
    [0, 62, 1.5],
    [1.5, 60, 0.5],
    [2, 58, 1],
    [3, 57, 1],
    [4, 55, 2],
    [6, 53, 1],
    [7, 55, 1],
    [8, 57, 1],
    [9, 58, 1],
    [10, 62, 1.5],
    [11.5, 60, 0.5],
    [12, 58, 1],
    [13, 55, 1],
    [14, 53, 2],
    [16, 58, 1],
    [17, 62, 1],
    [18, 65, 1.5],
    [19.5, 64, 0.5],
    [20, 62, 1],
    [21, 58, 1],
    [22, 57, 2],
    [24, 57, 1],
    [25, 61, 1],
    [26, 64, 1.5],
    [27.5, 61, 0.5],
    [28, 61, 2],
  ];
  pushPhrase(ev, 32, grief, 0.15, 'reed');
  // reprise: the hymn returns with a pipe descant, the seal holding
  pushPhrase(ev, 64, hymn, 0.22, 'flute');
  const descant: Phrase = [
    [0, 77, 2],
    [2, 79, 2],
    [4, 83, 3],
    [8, 79, 2],
    [10, 77, 2],
    [12, 77, 3],
  ];
  pushPhrase(ev, 80, descant, 0.07, 'pipe');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 66, bars: 24, events: ev };
}

/** Drakelands: "Ash and Wingbeat". E phrygian dominant, 104 bpm, 16 bars.
 *  Cinder desert, troll fires in the dunes, drakes on the thermals. A
 *  galloping drum floor under an E pedal that leans on the flat two; a reed
 *  snake-charmer line for the heat, a wide horn call for the wings over the
 *  caldera, and a breakdown that strips back to the gallop so the loop
 *  rides straight back into the dunes. */
function composeEmber(): Theme {
  const ev: NoteEvent[] = [];
  // E F G# A B C D: the raised third against the flat two is the desert
  for (let bar = 0; bar < 16; bar++) {
    const b0 = bar * 4;
    const inCall = bar >= 8 && bar < 12; // the drake over the caldera
    const inBreak = bar >= 12; // dunes again, wind and hoofbeat
    // the gallop: war drum on the stride, frame drum in the dust
    pushDrumHits(ev, b0, [0, 2], 'warDrum', inCall ? 0.2 : 0.16, 38);
    pushDrumHits(ev, b0, [0.75, 1, 2.75, 3], 'frameDrum', 0.12, 45);
    if (!inBreak) pushDrumHits(ev, b0, [1.5, 3.5], 'frameDrum', 0.08, 45);
    // bass rides E, leaning on F (the flat two) at the bar turn
    pushNote(ev, b0, 40, 0.9, 0.36, 'bass');
    pushNote(ev, b0 + 1.5, 40, 0.45, 0.2, 'bass');
    pushNote(ev, b0 + 2.5, bar % 2 === 1 ? 41 : 44, 0.45, 0.22, 'bass');
    pushNote(ev, b0 + 3.5, 40, 0.4, 0.18, 'bass');
    // heat shimmer: a staccato sixteenth cell on E F G# F
    if (!inBreak) {
      for (let i = 0; i < 16; i++) {
        pushNote(
          ev,
          b0 + i * 0.25,
          52 + [0, 1, 4, 1][i % 4],
          0.18,
          i % 4 === 0 ? 0.18 : 0.1,
          'stacc',
        );
      }
    }
    // troll-fire drone
    if (bar % 2 === 0) {
      pushNote(ev, b0, 40, 8.2, 0.12, 'choir');
      pushNote(ev, b0, 47, 8.2, 0.07, 'choir');
    }
    // thresholds of the Wyrmgate
    if (bar % 4 === 0) pushVoicing(ev, b0, [52, 59], 0.6, 0.2, 'brassStab');
    if (bar % 8 === 0) pushNote(ev, b0, 38, 1, 0.4, 'timpani');
    if (bar % 8 === 7) {
      for (const [i, t] of [3, 3.25, 3.5, 3.75].entries()) {
        pushNote(ev, b0 + t, 38, 0.3, 0.18 + i * 0.05, 'timpani');
      }
    }
    if (inCall && bar % 2 === 0) pushNote(ev, b0, 70, 3.5, 0.08, 'cymSwell');
  }

  // the snake line: narrow, bending around the flat two and raised third
  const snake: Phrase = [
    [0, 64, 1],
    [1, 65, 0.5],
    [1.5, 64, 0.5],
    [2, 62, 0.5],
    [2.5, 60, 0.5],
    [3, 62, 1],
    [4, 64, 1],
    [5, 68, 1],
    [6, 69, 1.5],
    [7.5, 68, 0.5],
    [8, 65, 1],
    [9, 64, 0.5],
    [9.5, 62, 0.5],
    [10, 60, 1],
    [11, 62, 1],
    [12, 64, 1.5],
    [13.5, 62, 0.5],
    [14, 64, 2],
  ];
  pushPhrase(ev, 16, snake, 0.16, 'reed');
  // the wingbeat: a horn call in wide open intervals
  const wings: Phrase = [
    [0, 52, 1],
    [1, 59, 1],
    [2, 64, 2],
    [4, 62, 1],
    [5, 59, 1],
    [6, 52, 2],
    [8, 52, 1],
    [9, 59, 1],
    [10, 65, 1.5],
    [11.5, 64, 0.5],
    [12, 62, 1],
    [13, 60, 1],
    [14, 59, 2],
  ];
  pushPhrase(ev, 32, wings, 0.22, 'horn');
  // the breakdown keeps the snake low while the dunes empty out
  pushPhrase(
    ev,
    48,
    snake.slice(0, 8).map(([b, m, d]) => [b, m - 12, d] as Phrase[number]),
    0.12,
    'reed',
  );
  // diminished riser back into the gallop
  for (const [i, m] of [52, 53, 56, 58].entries()) {
    pushNote(ev, 62 + i * 0.5, m, 0.4, 0.14, 'stacc');
  }

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 104, bars: 16, events: ev };
}

/** Frostveil: "The Aurora Steps". G lydian, 58 bpm, 24 bars, ABA'. Snow
 *  swallows every sound, so almost nothing here is struck: pads and string
 *  air over a slow bass, piano flakes, and tiny bells for the lights
 *  walking the sky. The lydian sharp four IS the aurora color. The middle
 *  eight deepens to E minor (the cold itself, awake and listening) under a
 *  low choir; the reprise brings one soft heartbeat drum: something alive
 *  inside all that white. */
function composeFrost(): Theme {
  const ev: NoteEvent[] = [];
  type BarSpec = { root: number; pad: number[]; flake: number[]; air: number[] };
  const G: BarSpec = {
    root: 43,
    pad: [55, 59, 62],
    flake: [43, 55, 62, 66, 71, 78],
    air: [74, 81],
  };
  const AofG: BarSpec = {
    root: 43,
    pad: [57, 61, 64],
    flake: [45, 57, 61, 64, 69, 76],
    air: [73, 81],
  };
  const Bm7: BarSpec = {
    root: 47,
    pad: [59, 62, 66],
    flake: [47, 59, 62, 66, 71, 74],
    air: [74, 78],
  };
  const D: BarSpec = {
    root: 38,
    pad: [57, 62, 66],
    flake: [38, 50, 57, 62, 66, 74],
    air: [74, 81],
  };
  const Em: BarSpec = {
    root: 40,
    pad: [55, 59, 64],
    flake: [40, 52, 59, 64, 67, 71],
    air: [71, 79],
  };
  const Cma7: BarSpec = {
    root: 36,
    pad: [55, 60, 64],
    flake: [36, 48, 55, 60, 64, 71],
    air: [72, 79],
  };
  const A8: BarSpec[] = [G, AofG, Bm7, G, Cma7, D, AofG, G];
  const B8: BarSpec[] = [Em, Cma7, D, Em, Cma7, Bm7, D, D];
  const bars: BarSpec[] = [...A8, ...B8, ...A8];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const inB = bar >= 8 && bar < 16;
    const inA2 = bar >= 16;
    // the snowfield: pad and high string air, nothing moving fast
    if (bar % 2 === 0) pushVoicing(ev, b0, c.pad, 8.2, 0.14, 'pad');
    if (bar % 2 === 0) pushVoicing(ev, b0, c.air, 8.2, inB ? 0.05 : 0.08, 'strings');
    if (inB && bar % 2 === 0) {
      pushNote(ev, b0, c.root - 12 < 28 ? c.root : c.root - 12, 8.2, 0.12, 'choir');
    }
    pushNote(ev, b0, c.root, 3, 0.26, 'bass');
    // snowflakes: sparse piano, never twice in the same place
    const dropBeats = bar % 2 === 0 ? [0.5, 1.75, 3.25] : [1.25, 2.5, 3.75];
    const order = bar % 2 === 0 ? [2, 4, 5] : [3, 5, 4];
    for (const [i, di] of order.entries()) {
      pushNote(ev, b0 + dropBeats[i], c.flake[di], 1.3, 0.13, 'piano');
    }
    if (bar % 4 === 0) pushNote(ev, b0 + 0.5, c.flake[0], 1.8, 0.1, 'piano');
    // the lights walking: bells stepping up the lydian fourth
    if (!inB && bar % 2 === 1) {
      pushNote(ev, b0 + 1.25, c.flake[4] + 12, 1.2, 0.06, 'tinyBell');
      pushNote(ev, b0 + 2.75, c.flake[5] + 12, 1.2, 0.05, 'tinyBell');
    }
    // one heartbeat, only in the reprise
    if (inA2 && bar % 4 === 2) pushNote(ev, b0, 38, 1.2, 0.09, 'frameDrum');
    // harp thaw at the section seams
    if (bar % 8 === 7) {
      for (const [i, m] of [c.flake[1], c.flake[2], c.flake[3], c.flake[4]].entries()) {
        pushNote(ev, b0 + 2.6 + i * 0.35, m, 1.2, 0.09, 'harp');
      }
    }
  });

  // the flute over the terraces, leaning on the sharp four (C#)
  const steps: Phrase = [
    [0, 74, 2],
    [2, 78, 1],
    [3, 79, 1],
    [4, 81, 2],
    [6, 79, 1],
    [7, 78, 1],
    [8, 73, 2],
    [10, 74, 1],
    [11, 78, 1],
    [12, 74, 2],
    [14, 71, 1],
    [15, 69, 1],
    [16, 71, 1.5],
    [17.5, 72, 0.5],
    [18, 74, 1],
    [19, 78, 1],
    [20, 79, 2],
    [22, 78, 1],
    [23, 74, 1],
    [24, 73, 1],
    [25, 71, 1],
    [26, 69, 1],
    [27, 71, 1],
    [28, 67, 3.5],
  ];
  pushPhrase(ev, 0, steps, 0.2, 'flute');
  // the cold, awake: low strings answer in E minor while the sky listens
  const listening: Phrase = [
    [0, 64, 2],
    [2, 67, 1],
    [3, 71, 1],
    [4, 72, 2],
    [6, 71, 1],
    [7, 67, 1],
    [8, 66, 2],
    [10, 62, 1],
    [11, 66, 1],
    [12, 64, 3],
    [16, 64, 1],
    [17, 67, 1],
    [18, 72, 1.5],
    [19.5, 71, 0.5],
    [20, 69, 1],
    [21, 66, 1],
    [22, 67, 2],
    [24, 66, 1],
    [25, 67, 1],
    [26, 69, 1.5],
    [27.5, 66, 0.5],
    [28, 66, 2],
  ];
  pushPhrase(ev, 32, listening, 0.17, 'strings');
  // reprise: the steps again, a pipe echoing from across the tarn
  pushPhrase(ev, 64, steps, 0.18, 'flute');
  pushPhrase(
    ev,
    72,
    [
      [0, 79, 0.5],
      [0.5, 78, 0.5],
      [1, 74, 1.5],
    ],
    0.06,
    'pipe',
  );

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 58, bars: 24, events: ev };
}

/** Amberfall: "The Leaves That Stay". F major, 84 bpm, 24 bars in a 12/8
 *  lilt, ABA'. Eternal autumn: every leaf gold, none ever falling. A warm
 *  harvest pastoral (rocking lute, oboe tune, dulcimer lamplight, a shrine
 *  bell at the pass) whose middle eight admits the catch in the premise:
 *  the relative minor for leaves that stay because they cannot let go,
 *  before the orchard warms the tune back up. */
function composeAmber(): Theme {
  const ev: NoteEvent[] = [];
  const T = 1 / 3;
  type BarSpec = { root: number; mid?: number; arp: number[]; keys: number[] };
  const F: BarSpec = { root: 41, arp: [53, 60, 65, 69], keys: [53, 57, 60, 65] };
  const Dm7: BarSpec = { root: 38, arp: [50, 57, 62, 65], keys: [50, 57, 60, 65] };
  const Bb: BarSpec = { root: 34, arp: [46, 53, 58, 62], keys: [46, 58, 62, 65] };
  const Csus: BarSpec = { root: 36, arp: [48, 55, 60, 65], keys: [48, 60, 65, 67] };
  const C: BarSpec = { root: 36, arp: [48, 55, 60, 64], keys: [48, 55, 60, 64] };
  const Gm7: BarSpec = { root: 43, arp: [43, 50, 58, 62], keys: [43, 53, 58, 62] };
  const FofA: BarSpec = { root: 45, mid: 48, arp: [57, 60, 65, 69], keys: [57, 60, 65, 69] };
  const A8: BarSpec[] = [F, Dm7, Bb, Csus, F, Gm7, C, F];
  const B8: BarSpec[] = [Dm7, Bb, FofA, C, Dm7, Gm7, Bb, C];
  const bars: BarSpec[] = [...A8, ...B8, ...A8];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const inB = bar >= 8 && bar < 16;
    const next = bars[(bar + 1) % bars.length];
    // rocking orchard lute, one triplet per beat
    for (let beat = 0; beat < 4; beat++) {
      const low = beat % 2 === 0 ? c.arp[0] : c.arp[1];
      pushNote(ev, b0 + beat, low, 0.4, 0.16, 'lute');
      pushNote(ev, b0 + beat + T, beat === 3 ? c.arp[2] : c.arp[3], 0.3, 0.1, 'lute');
      pushNote(ev, b0 + beat + 2 * T, beat === 3 ? c.arp[1] : c.arp[2], 0.3, 0.1, 'lute');
    }
    // honey-gold strings on the even bars; dulcimer lamplight between
    if (bar % 2 === 0) {
      pushVoicing(ev, b0, c.keys.slice(1), 4.05, inB ? 0.09 : 0.12, 'strings');
    } else {
      pushNote(ev, b0 + 1 + T, c.arp[3] + 12, 0.3, 0.08, 'dulcimer');
      pushNote(ev, b0 + 3 + 2 * T, c.arp[2] + 12, 0.3, 0.07, 'dulcimer');
    }
    // easy bass, walking into the next bar
    pushNote(ev, b0, c.root, 1.4, 0.3, 'bass');
    pushNote(ev, b0 + 2, c.mid ?? c.root + 7, 1.0, 0.18, 'bass');
    pushNote(ev, b0 + 3 + 2 * T, next.root + (next.root < 40 ? 12 : 0) - 2, 0.3, 0.12, 'bass');
    // harvest-cart pulse
    pushDrumHits(ev, b0, [0, 2], 'frameDrum', 0.09, 43);
    if (bar % 4 === 3) pushNote(ev, b0 + 3 + T, 72, 0.15, 0.06, 'woodBlock');
    // the shrine bell at the Goldmelt, once per section
    if (bar % 8 === 7) pushNote(ev, b0 + 3, 65, 3, 0.09, 'bell');
  });

  // the harvest tune: an oboe with its sleeves rolled up
  const harvest: Phrase = [
    [0, 69, 2 * T],
    [2 * T, 72, T],
    [1, 74, 1],
    [2, 72, 2 * T],
    [2 + 2 * T, 69, T],
    [3, 67, 1],
    [4, 65, 1 + 2 * T],
    [5 + 2 * T, 67, T],
    [6, 69, 1],
    [7, 62, 1],
    [8, 62, 2 * T],
    [8 + 2 * T, 65, T],
    [9, 70, 1],
    [10, 69, 2 * T],
    [10 + 2 * T, 67, T],
    [11, 65, 1],
    [12, 67, 1],
    [13, 69, 2 * T],
    [13 + 2 * T, 65, T],
    [14, 65, 2],
    [16, 69, 2 * T],
    [16 + 2 * T, 72, T],
    [17, 74, 1],
    [18, 76, 2 * T],
    [18 + 2 * T, 74, T],
    [19, 72, 1],
    [20, 70, 1 + 2 * T],
    [21 + 2 * T, 69, T],
    [22, 67, 1],
    [23, 65, 1],
    [24, 64, 2 * T],
    [24 + 2 * T, 65, T],
    [25, 67, 1],
    [26, 69, 2 * T],
    [26 + 2 * T, 62, T],
    [27, 64, 1],
    [28, 65, 3],
  ];
  pushPhrase(ev, 0, harvest, 0.2, 'oboe');
  // the leaves that cannot let go: flute in the relative minor
  const stay: Phrase = [
    [0, 65, 1],
    [1, 69, 1 + 2 * T],
    [2 + 2 * T, 67, T],
    [3, 65, 1],
    [4, 62, 2 * T],
    [4 + 2 * T, 65, T],
    [5, 69, 1],
    [6, 72, 1 + 2 * T],
    [7 + 2 * T, 70, T],
    [8, 69, 1],
    [9, 65, 2 * T],
    [9 + 2 * T, 60, T],
    [10, 65, 2],
    [12, 64, 1],
    [13, 67, 2 * T],
    [13 + 2 * T, 64, T],
    [14, 62, 1],
    [15, 60, 1],
    [16, 62, 1],
    [17, 65, 1],
    [18, 69, 1 + 2 * T],
    [19 + 2 * T, 67, T],
    [20, 67, 1],
    [21, 64, 0.5],
    [21.5, 62, 0.5],
    [22, 62, 2],
    [24, 58, 1],
    [25, 62, 1],
    [26, 65, 2 * T],
    [26 + 2 * T, 64, T],
    [27, 64, 1],
    [28, 60, 2.5],
  ];
  pushPhrase(ev, 32, stay, 0.24, 'flute');
  // reprise with the dulcimer picking the tune up an octave
  pushPhrase(ev, 64, harvest, 0.18, 'oboe');
  pushPhrase(
    ev,
    64,
    harvest.map(([b, m, d]) => [b, m + 12, d] as Phrase[number]),
    0.08,
    'dulcimer',
  );

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 84, bars: 24, events: ev };
}

/** Willowfen: "Dragonfly Morning". E major, 88 bpm, 16 bars in a 12/8 lilt.
 *  The bright fen: bog pools humming with dragonflies and bees, willows,
 *  the island town inside its ring moat. A sunlit idyll: rocking lute
 *  barcarolle, a whistled pipe tune, shaker wings and wood-block pops, and
 *  a flute answer up the octave as the morning opens out. */
function composeFen(): Theme {
  const ev: NoteEvent[] = [];
  const T = 1 / 3;
  type BarSpec = { root: number; mid?: number; arp: number[]; keys: number[] };
  const E: BarSpec = { root: 40, arp: [52, 59, 64, 68], keys: [52, 56, 59, 64] };
  const A: BarSpec = { root: 45, arp: [45, 52, 61, 64], keys: [45, 57, 61, 64] };
  const B: BarSpec = { root: 47, arp: [47, 54, 59, 63], keys: [47, 59, 63, 66] };
  const C$m7: BarSpec = { root: 37, arp: [49, 56, 61, 64], keys: [49, 59, 61, 64] };
  const G$m7: BarSpec = { root: 44, arp: [44, 51, 59, 63], keys: [44, 54, 59, 63] };
  const EofB: BarSpec = { root: 47, mid: 52, arp: [59, 64, 68, 71], keys: [59, 64, 68, 71] };
  const A8: BarSpec[] = [E, A, B, E, C$m7, A, B, E];
  const B8: BarSpec[] = [E, G$m7, A, EofB, C$m7, A, B, E];
  const bars: BarSpec[] = [...A8, ...B8];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const back = bar >= 8;
    // the barcarolle rock, low-high-mid, one triplet per beat
    for (let beat = 0; beat < 4; beat++) {
      const low = beat % 2 === 0 ? c.arp[0] : c.arp[1];
      pushNote(ev, b0 + beat, low, 0.4, 0.16, 'lute');
      pushNote(ev, b0 + beat + T, beat === 3 ? c.arp[2] : c.arp[3], 0.3, 0.1, 'lute');
      pushNote(ev, b0 + beat + 2 * T, beat === 3 ? c.arp[1] : c.arp[2], 0.3, 0.1, 'lute');
    }
    // wings: shaker on the lilt, a wood-block pop where a frog jumps
    pushDrumHits(ev, b0, [T, 1 + T, 2 + T, 3 + T], 'shaker', 0.1, 70);
    pushDrumHits(ev, b0, [0, 2], 'frameDrum', 0.09, 43);
    if (bar % 4 === 2) pushNote(ev, b0 + 3 + 2 * T, 72, 0.15, 0.08, 'woodBlock');
    // easy bass
    pushNote(ev, b0, c.root, 1.4, 0.3, 'bass');
    pushNote(ev, b0 + 2, c.mid ?? c.root + 7, 1.0, 0.18, 'bass');
    // morning warmth behind the back eight
    if (back && bar % 2 === 0) pushVoicing(ev, b0, c.keys.slice(1), 4.05, 0.1, 'strings');
    // lily bells
    if (bar % 8 === 7) pushNote(ev, b0 + 3 + T, 88, 0.9, 0.06, 'tinyBell');
    // harp ripple on phrase starts
    if (bar % 4 === 0) {
      for (const [i, m] of [c.arp[1], c.arp[2], c.arp[3]].entries()) {
        pushNote(ev, b0 + i * 0.17, m, 1.1, 0.09, 'harp');
      }
    }
  });

  // the whistled tune, easy as a morning with nowhere to be
  const whistle: Phrase = [
    [0, 71, 2 * T],
    [2 * T, 73, T],
    [1, 75, 1],
    [2, 71, 2 * T],
    [2 + 2 * T, 68, T],
    [3, 64, 1],
    [4, 66, 2 * T],
    [4 + 2 * T, 68, T],
    [5, 69, 1],
    [6, 68, 1 + 2 * T],
    [7 + 2 * T, 66, T],
    [8, 66, 2 * T],
    [8 + 2 * T, 68, T],
    [9, 71, 1],
    [10, 73, 2 * T],
    [10 + 2 * T, 71, T],
    [11, 69, 1],
    [12, 68, 1],
    [13, 66, 2 * T],
    [13 + 2 * T, 63, T],
    [14, 64, 2],
    [16, 64, 2 * T],
    [16 + 2 * T, 68, T],
    [17, 71, 1],
    [18, 75, 2 * T],
    [18 + 2 * T, 73, T],
    [19, 71, 1],
    [20, 73, 1 + 2 * T],
    [21 + 2 * T, 75, T],
    [22, 76, 1],
    [23, 73, 1],
    [24, 71, 2 * T],
    [24 + 2 * T, 68, T],
    [25, 66, 1],
    [26, 68, 2 * T],
    [26 + 2 * T, 71, T],
    [27, 66, 1],
    [28, 64, 3],
  ];
  pushPhrase(ev, 0, whistle, 0.26, 'pipe');
  // the flute takes the morning up the octave over the strings
  pushPhrase(
    ev,
    32,
    whistle.map(([b, m, d]) => [b, m + 12 > 88 ? m : m + 12, d] as Phrase[number]),
    0.2,
    'flute',
  );
  pushPhrase(ev, 32, whistle, 0.1, 'dulcimer');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 88, bars: 16, events: ev };
}

/** Nightbloom: "The Realm Is Dreaming". B aeolian, 60 bpm, 24 bars, ABA'.
 *  Violet downs under a luminous sky; the air itself dreams. A weightless
 *  nocturne: drifting choir, constellation bells on the pentatonic, harp
 *  rolls, piano fragments, and a flute that moves in long floating arcs.
 *  The middle eight lifts to D major over the Moonwell before settling
 *  back; a deep drum stirs once in a while under the Sleepless Barrow. */
function composeNight(): Theme {
  const ev: NoteEvent[] = [];
  type BarSpec = { root: number; pad: number[]; stars: number[] };
  const Bm: BarSpec = { root: 47, pad: [59, 62, 66], stars: [74, 78, 81, 86] };
  const G: BarSpec = { root: 43, pad: [59, 62, 67], stars: [74, 79, 83, 86] };
  const D: BarSpec = { root: 38, pad: [57, 62, 66], stars: [74, 78, 81, 86] };
  const A: BarSpec = { root: 45, pad: [57, 61, 64], stars: [73, 76, 81, 85] };
  const Em7: BarSpec = { root: 40, pad: [55, 59, 62], stars: [74, 79, 83, 86] };
  const F$m: BarSpec = { root: 42, pad: [57, 61, 66], stars: [73, 78, 81, 85] };
  const A8: BarSpec[] = [Bm, G, D, A, Bm, Em7, F$m, Bm];
  const B8: BarSpec[] = [D, G, A, D, G, Em7, A, F$m];
  const bars: BarSpec[] = [...A8, ...B8, ...A8];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const inB = bar >= 8 && bar < 16;
    // the dreaming air: choir dyads breathing every two bars
    if (bar % 2 === 0) {
      pushNote(ev, b0, c.pad[0] - 12, 8.2, 0.12, 'choir');
      pushNote(ev, b0, c.pad[2] - 12, 8.2, 0.08, 'choir');
      pushVoicing(ev, b0, c.pad, 8.2, 0.1, 'pad');
    }
    pushNote(ev, b0, c.root, 3, 0.24, 'bass');
    // constellations: bells wandering the pentatonic, never hurried
    const starBeats = bar % 2 === 0 ? [0.75, 2.25] : [1.5, 3.25];
    for (const [i, t] of starBeats.entries()) {
      pushNote(ev, b0 + t, c.stars[(bar + i * 2) % 4], 1.4, 0.06, 'tinyBell');
    }
    // moonlit piano fragments on the odd bars
    if (bar % 2 === 1) {
      pushNote(ev, b0 + 0.5, c.pad[1], 1.6, 0.12, 'piano');
      pushNote(ev, b0 + 2.25, c.pad[2] - 12, 1.6, 0.09, 'piano');
      pushNote(ev, b0 + 3.25, c.pad[0], 1.4, 0.08, 'piano');
    }
    // harp rolls at phrase starts, rising like slow fireflies
    if (bar % 4 === 0) {
      for (const [i, m] of [c.root, c.pad[0], c.pad[1], c.pad[2] + 12].entries()) {
        pushNote(ev, b0 + i * 0.22, m, 1.6, 0.1, 'harp');
      }
    }
    // the Sleepless Barrow turns over in its dream
    if (bar % 8 === 4) pushNote(ev, b0, 38, 1.4, 0.1, 'warDrum');
    // moonwell shimmer in the lift
    if (inB && bar % 2 === 1) pushNote(ev, b0 + 1.75, c.stars[3], 1.6, 0.05, 'tinyBell');
  });

  // the dream arc: a flute in long weightless spans
  const dream: Phrase = [
    [0, 66, 3],
    [3, 69, 1],
    [4, 71, 3],
    [7, 74, 1],
    [8, 74, 2],
    [10, 73, 1],
    [11, 69, 1],
    [12, 66, 3.5],
    [16, 66, 2],
    [18, 71, 1],
    [19, 74, 1],
    [20, 78, 2.5],
    [22.5, 76, 0.5],
    [23, 74, 1],
    [24, 73, 2],
    [26, 71, 1],
    [27, 69, 1],
    [28, 66, 3.5],
  ];
  pushPhrase(ev, 0, dream, 0.2, 'flute');
  // the Moonwell: the same soul in D major, strings underneath
  const moonwell: Phrase = [
    [0, 74, 2],
    [2, 78, 1],
    [3, 79, 1],
    [4, 79, 1.5],
    [5.5, 78, 0.5],
    [6, 74, 2],
    [8, 76, 1],
    [9, 79, 1],
    [10, 81, 2],
    [12, 78, 1],
    [13, 74, 1],
    [14, 76, 2],
    [16, 74, 2],
    [18, 71, 1],
    [19, 74, 1],
    [20, 76, 1.5],
    [21.5, 74, 0.5],
    [22, 71, 2],
    [24, 69, 1],
    [25, 71, 1],
    [26, 73, 1.5],
    [27.5, 71, 0.5],
    [28, 73, 2],
  ];
  pushPhrase(ev, 32, moonwell, 0.16, 'flute');
  pushPhrase(
    ev,
    32,
    moonwell.map(([b, m, d]) => [b, m - 12, d] as Phrase[number]),
    0.08,
    'strings',
  );
  // reprise: the arc again with a harp shadow
  pushPhrase(ev, 64, dream, 0.18, 'flute');
  pushPhrase(ev, 64, dream, 0.09, 'harp');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 60, bars: 24, events: ev };
}

/** Wraithwood: "Do Not Answer". F# phrygian, 72 bpm, 16 bars. A drowned-grey
 *  wood where the canopy closes over the road like a lid and things between
 *  the trunks watch. Sparse dread: a half-step creep around the tonic, a
 *  minor-second string shimmer, knocks from nothing in particular, wraith
 *  sighs falling two notes at a time, and a chapel hymn that keeps trying
 *  to start and keeps stopping mid-line. One high bell, twice: the wood
 *  calling a name. Do not answer. */
function composeHaunt(): Theme {
  const ev: NoteEvent[] = [];
  type BarSpec = { bass: number; pad: number[]; creep: [number, number][] };
  const creepF$: [number, number][] = [
    [0, 54],
    [0.5, 55],
    [1, 54],
    [2, 54],
    [2.5, 55],
    [3, 57],
  ];
  const creepG: [number, number][] = [
    [0, 55],
    [0.5, 57],
    [1, 55],
    [2, 55],
    [2.5, 54],
    [3, 55],
  ];
  const F$m: BarSpec = { bass: 42, pad: [54, 57, 61], creep: creepF$ };
  const Gma: BarSpec = { bass: 43, pad: [55, 59, 62], creep: creepG };
  const Bm: BarSpec = {
    bass: 47,
    pad: [54, 59, 62],
    creep: [
      [0, 54],
      [0.5, 57],
      [1, 54],
      [2, 54],
      [2.5, 59],
      [3, 57],
    ],
  };
  const D5: BarSpec = {
    bass: 38,
    pad: [54, 57, 62],
    creep: [
      [0, 54],
      [0.5, 57],
      [1, 54],
      [2, 54],
      [2.5, 57],
      [3, 59],
    ],
  };
  const C$5: BarSpec = {
    bass: 49,
    pad: [49, 56, 61],
    creep: [
      [0, 53],
      [0.5, 54],
      [1, 53],
      [2, 53],
      [2.5, 54],
      [3, 56],
    ],
  };
  const bars: BarSpec[] = [
    F$m,
    Gma,
    F$m,
    Bm,
    D5,
    C$5,
    Gma,
    F$m,
    F$m,
    Bm,
    D5,
    F$m,
    Gma,
    F$m,
    C$5,
    F$m,
  ];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const late = bar >= 8;
    // the lid: an unmoving F# above whatever walks underneath
    if (bar % 2 === 0) pushPedal(ev, b0, 66, 'choir', 0.13);
    pushVoicing(ev, b0, c.pad, 4.05, 0.09, 'pad');
    pushNote(ev, b0, c.bass, 2.2, 0.28, 'bass');
    pushNote(ev, b0 + 2.75, c.bass, 0.5, 0.15, 'bass');
    // the creep between the trunks
    for (const [t, m] of c.creep) {
      pushNote(ev, b0 + t, m, 0.4, t === 0 ? 0.17 : 0.11, 'stacc');
    }
    // rain that never quite stops
    if (bar % 2 === 1) {
      pushNote(ev, b0 + 1.25, c.pad[1] + 12, 1.1, 0.08, 'piano');
      pushNote(ev, b0 + 3.5, c.pad[0] + 12, 1.1, 0.06, 'piano');
    }
    // knocks from the dark, never on the beat you expect
    if (bar % 4 === 1) pushDrumHits(ev, b0, [1.75, 2.25], 'woodBlock', 0.07, 70);
    if (bar % 8 === 6) pushNote(ev, b0 + 3.25, 70, 0.2, 0.06, 'woodBlock');
    // something heavy shifting its weight, more often the deeper you go
    pushNote(ev, b0, 38, 0.9, late ? 0.16 : 0.11, 'warDrum');
    if (late) pushNote(ev, b0 + 2.5, 38, 0.7, 0.1, 'warDrum');
    // the wrongness shimmer
    if (bar >= 4 && bar < 8) pushVoicing(ev, b0, [66, 67], 4.05, 0.05, 'strings');
    if (bar >= 12) pushVoicing(ev, b0, [73, 74], 4.05, 0.05, 'strings');
    // wraith sighs: two falling notes, farther off each time
    if (bar % 4 === 2) {
      pushNote(ev, b0 + 1, 78, 1.5, 0.06, 'choir');
      pushNote(ev, b0 + 2.5, 77, 1.5, 0.05, 'choir');
    }
  });

  // the Mournstone hymn keeps breaking off mid-line
  const hymn: Phrase = [
    [0, 66, 1],
    [1, 69, 1],
    [2, 68, 1.5],
    [4, 66, 1],
    [5, 64, 1],
    [6, 62, 1.5],
  ];
  pushPhrase(ev, 8, hymn, 0.1, 'reed');
  pushPhrase(ev, 40, hymn.slice(0, 3), 0.09, 'reed');
  // the wood calls a name, twice, high and far away
  pushNote(ev, 27, 90, 1.4, 0.05, 'tinyBell');
  pushNote(ev, 59, 90, 1.4, 0.05, 'tinyBell');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 72, bars: 16, events: ev };
}

/** Palmreach: "The Emerald Tangle". G mixolydian, 96 bpm, 16 bars. Coral
 *  beach into a jungle so green it eats the horizon. An interlocking
 *  hand-percussion floor (frame drum, wood block, shaker), a marimba-style
 *  dulcimer ostinato on the pentatonic, a sun-bright pipe call answered by
 *  bird-flourish flutes, and in the back eight the Sunken Idol's horn
 *  fifths and a surf swell under the canopy. */
function composeJungle(): Theme {
  const ev: NoteEvent[] = [];
  type BarSpec = { root: number; ost: number[] };
  const G: BarSpec = { root: 43, ost: [55, 62, 67, 69, 74, 69, 67, 62] };
  const F: BarSpec = { root: 41, ost: [53, 60, 65, 67, 72, 67, 65, 60] };
  const CofG: BarSpec = { root: 43, ost: [55, 60, 64, 67, 72, 67, 64, 60] };
  const Dm7: BarSpec = { root: 38, ost: [50, 57, 62, 65, 69, 65, 62, 57] };
  const bars: BarSpec[] = [G, G, F, CofG, G, Dm7, F, G, G, CofG, F, G, Dm7, F, CofG, G];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const back = bar >= 8;
    // the tangle groove: three hands that never collide
    pushDrumHits(ev, b0, [0, 1.5, 2.5], 'frameDrum', 0.14, 41);
    pushDrumHits(ev, b0, [1, 3.25], 'woodBlock', 0.09, 64);
    pushDrumHits(ev, b0, [0.5, 1.5, 2.5, 3.5], 'shaker', 0.12, 70);
    if (bar % 4 === 3) pushNote(ev, b0 + 3.75, 41, 0.2, 0.1, 'frameDrum');
    // syncopated bass out of the roots
    pushNote(ev, b0, c.root, 1.2, 0.32, 'bass');
    pushNote(ev, b0 + 1.5, c.root + 7, 0.7, 0.2, 'bass');
    pushNote(ev, b0 + 3, c.root, 0.7, 0.22, 'bass');
    // marimba canopy: the dulcimer ostinato in running eighths
    for (const [i, m] of c.ost.entries()) {
      pushNote(ev, b0 + i * 0.5, m, 0.4, i % 4 === 0 ? 0.14 : 0.09, 'dulcimer');
    }
    // the idol below the lagoon
    if (back) {
      if (bar % 2 === 0) {
        pushNote(ev, b0, c.root + 12, 4.1, 0.14, 'horn');
        pushNote(ev, b0 + 0.02, c.root + 19, 4.1, 0.1, 'horn');
      }
      if (bar % 8 === 0) pushNote(ev, b0, 70, 3, 0.07, 'cymSwell');
    }
    if (bar % 8 === 7) {
      for (const [i, t] of [3, 3.25, 3.5, 3.75].entries()) {
        pushNote(ev, b0 + t, 41, 0.2, 0.1 + i * 0.03, 'frameDrum');
      }
    }
  });

  // the sun call: a pipe over the strand
  const call: Phrase = [
    [0, 67, 0.5],
    [0.5, 69, 0.5],
    [1, 74, 1],
    [2, 72, 0.5],
    [2.5, 69, 0.5],
    [3, 67, 1],
    [4, 65, 0.5],
    [4.5, 67, 0.5],
    [5, 72, 1.5],
    [6.5, 69, 0.5],
    [7, 67, 1],
    [8, 67, 0.5],
    [8.5, 71, 0.5],
    [9, 74, 1],
    [10, 76, 0.5],
    [10.5, 74, 0.5],
    [11, 72, 1],
    [12, 69, 0.5],
    [12.5, 72, 0.5],
    [13, 67, 1.5],
    [14.5, 65, 0.5],
    [15, 67, 1],
  ];
  pushPhrase(ev, 16, call, 0.28, 'pipe');
  // birds answering out of the canopy
  for (const [start, top] of [
    [34.5, 86],
    [46.5, 84],
  ] as const) {
    for (const [i, off] of [0, -2, -5, -7].entries()) {
      pushNote(ev, start + i * 0.25, top + off, 0.22, 0.12 - i * 0.015, 'flute');
    }
  }
  // the call again over the idol horns, harmonized a third below
  pushPhrase(ev, 48, call, 0.26, 'pipe');
  pushPhrase(
    ev,
    48,
    call.map(([b, m, d]) => [b, m - 3, d] as Phrase[number]),
    0.14,
    'dulcimer',
  );

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 96, bars: 16, events: ev };
}

/** Evergarden: "Still Trimmed". A major, 92 bpm, 24 bars, ABA'. A century
 *  without its gardener and the hedges are still perfect. A courtly minuet
 *  (dulcimer alberti for the harpsichord, elegant strings, a mannered oboe
 *  tune with turns) whose middle eight steps into the Great Maze: F# minor,
 *  shear-snip wood blocks, and a creeping staccato that follows YOU. One
 *  out-of-key glint on the bells now and then: topiary should not turn its
 *  head. The reprise is the same tea party, slightly too composed. */
function composeGarden(): Theme {
  const ev: NoteEvent[] = [];
  type BarSpec = { root: number; mid?: number; alb: number[]; keys: number[] };
  const A: BarSpec = { root: 45, alb: [57, 64, 61, 64], keys: [57, 61, 64, 69] };
  const D: BarSpec = { root: 38, alb: [50, 62, 57, 62], keys: [50, 57, 62, 66] };
  const E: BarSpec = { root: 40, alb: [52, 64, 59, 64], keys: [52, 59, 64, 68] };
  const F$m: BarSpec = { root: 42, alb: [54, 61, 57, 61], keys: [54, 61, 64, 69] };
  const Bm: BarSpec = { root: 47, alb: [47, 59, 54, 59], keys: [47, 59, 62, 66] };
  const C$m: BarSpec = { root: 37, alb: [49, 61, 56, 61], keys: [49, 61, 64, 68] };
  const A8: BarSpec[] = [A, D, E, A, F$m, D, E, A];
  const B8: BarSpec[] = [F$m, C$m, D, F$m, Bm, C$m, E, E];
  const bars: BarSpec[] = [...A8, ...B8, ...A8];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const inMaze = bar >= 8 && bar < 16;
    if (!inMaze) {
      // the tea party: alberti dulcimer, poised strings, a curtsy bass
      for (let i = 0; i < 8; i++) {
        pushNote(ev, b0 + i * 0.5, c.alb[i % 4], 0.45, i % 2 === 0 ? 0.13 : 0.09, 'dulcimer');
      }
      if (bar % 2 === 0) pushVoicing(ev, b0, c.keys.slice(1), 4.05, 0.11, 'strings');
      pushNote(ev, b0, c.root, 1.2, 0.3, 'bass');
      pushNote(ev, b0 + 2, c.mid ?? c.root + 7, 0.9, 0.2, 'bass');
      pushNote(ev, b0 + 3, c.root, 0.7, 0.16, 'bass');
      // piano manners on the and-of-two
      if (bar % 2 === 1) pushVoicing(ev, b0 + 2.5, c.keys.slice(1), 1.2, 0.08, 'piano');
      // the glint: one D# where no D# belongs, and nothing acknowledges it
      if (bar % 8 === 5) pushNote(ev, b0 + 3.25, 75, 1.1, 0.06, 'tinyBell');
    } else {
      // the Great Maze: the hedge walks with you
      pushVoicing(ev, b0, c.keys.slice(0, 3), 4.05, 0.1, 'pad');
      pushNote(ev, b0, c.root, 2.2, 0.28, 'bass');
      pushNote(ev, b0 + 2.75, c.root, 0.5, 0.15, 'bass');
      for (const [i, off] of [0, 0.5, 1, 2, 2.5, 3].entries()) {
        pushNote(ev, b0 + off, c.alb[[0, 2, 0, 0, 2, 3][i]], 0.35, i === 0 ? 0.15 : 0.1, 'stacc');
      }
      // the shears, still trimming, just out of sight
      pushDrumHits(ev, b0, [2.75, 3], 'woodBlock', 0.08, 72);
      if (bar % 2 === 1) pushNote(ev, b0 + 1.25, 72, 0.2, 0.05, 'woodBlock');
      if (bar % 4 === 2) pushNote(ev, b0, 38, 0.9, 0.1, 'warDrum');
    }
  });

  // the minuet: mannered, with little turns like clipped rosebuds
  const minuet: Phrase = [
    [0, 69, 1],
    [1, 73, 0.5],
    [1.5, 74, 0.5],
    [2, 76, 1],
    [3, 73, 1],
    [4, 74, 0.5],
    [4.5, 73, 0.5],
    [5, 71, 1],
    [6, 69, 1],
    [7, 66, 1],
    [8, 68, 1],
    [9, 71, 1],
    [10, 76, 1.5],
    [11.5, 74, 0.5],
    [12, 73, 1],
    [13, 71, 0.5],
    [13.5, 69, 0.5],
    [14, 69, 2],
    [16, 74, 1],
    [17, 73, 0.5],
    [17.5, 74, 0.5],
    [18, 78, 1],
    [19, 76, 1],
    [20, 74, 1],
    [21, 73, 0.5],
    [21.5, 71, 0.5],
    [22, 73, 2],
    [24, 71, 1],
    [25, 69, 0.5],
    [25.5, 68, 0.5],
    [26, 69, 1],
    [27, 64, 1],
    [28, 66, 0.5],
    [28.5, 68, 0.5],
    [29, 69, 2.5],
  ];
  pushPhrase(ev, 0, minuet, 0.2, 'oboe');
  // in the maze the tune follows a corridor down, always one turn behind
  const maze: Phrase = [
    [0, 66, 1],
    [1, 64, 0.5],
    [1.5, 66, 0.5],
    [2, 69, 1.5],
    [3.5, 68, 0.5],
    [4, 64, 1],
    [5, 61, 1],
    [6, 61, 2],
    [8, 62, 1],
    [9, 66, 1],
    [10, 69, 1.5],
    [11.5, 68, 0.5],
    [12, 66, 1],
    [13, 62, 1],
    [14, 61, 2],
    [16, 59, 1],
    [17, 62, 1],
    [18, 66, 1.5],
    [19.5, 64, 0.5],
    [20, 64, 1],
    [21, 61, 1],
    [22, 59, 2],
    [24, 61, 1],
    [25, 64, 1],
    [26, 68, 1.5],
    [27.5, 66, 0.5],
    [28, 68, 2],
  ];
  pushPhrase(ev, 32, maze, 0.16, 'flute');
  // reprise: the same tea, poured the same way, watched the same way
  pushPhrase(ev, 64, minuet, 0.19, 'oboe');
  pushPhrase(
    ev,
    64,
    minuet.map(([b, m, d]) => [b, m - 12, d] as Phrase[number]),
    0.07,
    'strings',
  );

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 92, bars: 24, events: ev };
}

/** Galecrest: "The Beacon Never Dies". D mixolydian, 84 bpm, 24 bars, ABA'.
 *  A headland where the wind has never once stopped and the Old Beacon has
 *  never once gone out. An open-fifth drone the whole way through (the
 *  gale), a salt-worn fiddle ballad in the oboe with the mixolydian flat
 *  seven, strummed lute, surf booms off The Shear, cymbal gusts, and a
 *  single beacon bell at each section turn. The middle eight walks the
 *  Wreckfields in B minor before the light swings back around. */
function composeGale(): Theme {
  const ev: NoteEvent[] = [];
  type BarSpec = { root: number; strum: number[]; keys: number[] };
  const D: BarSpec = { root: 38, strum: [50, 57, 62, 66], keys: [57, 62, 66] };
  const C: BarSpec = { root: 36, strum: [48, 55, 60, 64], keys: [55, 60, 64] };
  const G: BarSpec = { root: 43, strum: [43, 55, 59, 62], keys: [55, 59, 62] };
  const Am7: BarSpec = { root: 45, strum: [45, 52, 60, 64], keys: [52, 60, 64] };
  const Bm: BarSpec = { root: 47, strum: [47, 54, 59, 62], keys: [54, 59, 62] };
  const Em7: BarSpec = { root: 40, strum: [40, 52, 59, 62], keys: [52, 59, 62] };
  const A8: BarSpec[] = [D, D, C, G, D, Am7, C, D];
  const B8: BarSpec[] = [Bm, G, D, Am7, Bm, Em7, G, Am7];
  const bars: BarSpec[] = [...A8, ...B8, ...A8];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const inB = bar >= 8 && bar < 16;
    // the gale: an open fifth that never stops blowing
    if (bar % 2 === 0) {
      pushNote(ev, b0, 50, 8.2, 0.16, 'pad');
      pushNote(ev, b0, 57, 8.2, 0.1, 'pad');
    }
    // the strum: wind through standing rigging
    for (const off of [0, 1, 1.5, 2, 3, 3.5]) {
      for (const n of off === 0 || off === 2 ? c.strum : c.strum.slice(1)) {
        pushNote(ev, b0 + off, n, 0.35, off === 0 ? 0.11 : 0.07, 'lute');
      }
    }
    pushNote(ev, b0, c.root, 1.4, 0.32, 'bass');
    pushNote(ev, b0 + 2, c.root + 7, 1.0, 0.2, 'bass');
    // surf on The Shear, a boom every other bar
    if (bar % 2 === 1) pushNote(ev, b0 + 3, 38, 1.1, 0.14, 'warDrum');
    pushDrumHits(ev, b0, [0, 2], 'frameDrum', 0.1, 43);
    // gusts
    if (bar % 4 === 0) pushNote(ev, b0, 70, 3.5, inB ? 0.05 : 0.07, 'cymSwell');
    // the downs hum under the wreckfields walk
    if (inB && bar % 2 === 0) {
      pushVoicing(ev, b0, c.keys, 8.2, 0.09, 'strings');
      pushNote(ev, b0, c.root - (c.root > 41 ? 12 : 0), 8.2, 0.08, 'choir');
    }
  });

  // the beacon bell at each turn of the light
  for (const b of [0, 32, 64]) pushNote(ev, b, 62, 3.5, 0.11, 'bell');

  // the fiddle ballad: salt-worn, flat seven leaning into the wind
  const ballad: Phrase = [
    [0, 62, 1],
    [1, 66, 1],
    [2, 69, 1.5],
    [3.5, 67, 0.5],
    [4, 66, 1],
    [5, 62, 1],
    [6, 60, 2],
    [8, 57, 1],
    [9, 62, 1],
    [10, 66, 1.5],
    [11.5, 69, 0.5],
    [12, 67, 1],
    [13, 66, 1],
    [14, 64, 2],
    [16, 62, 1],
    [17, 66, 1],
    [18, 71, 1.5],
    [19.5, 69, 0.5],
    [20, 69, 1],
    [21, 67, 0.5],
    [21.5, 66, 0.5],
    [22, 64, 2],
    [24, 60, 1],
    [25, 64, 1],
    [26, 67, 1],
    [27, 64, 1],
    [28, 62, 3.5],
  ];
  pushPhrase(ev, 0, ballad, 0.21, 'oboe');
  // the wreckfields: the ballad's ghost in B minor, low and slow
  const wrecks: Phrase = [
    [0, 62, 1.5],
    [1.5, 59, 0.5],
    [2, 57, 1],
    [3, 54, 1],
    [4, 55, 2],
    [6, 59, 1],
    [7, 62, 1],
    [8, 64, 1.5],
    [9.5, 62, 0.5],
    [10, 59, 1],
    [11, 57, 1],
    [12, 54, 3],
    [16, 55, 1],
    [17, 59, 1],
    [18, 62, 1.5],
    [19.5, 64, 0.5],
    [20, 62, 1],
    [21, 59, 1],
    [22, 57, 2],
    [24, 55, 1],
    [25, 57, 1],
    [26, 59, 1],
    [27, 62, 1],
    [28, 64, 2],
  ];
  pushPhrase(ev, 32, wrecks, 0.14, 'reed');
  // reprise: ballad in octaves, the pipe riding the top of the gale
  pushPhrase(ev, 64, ballad, 0.19, 'oboe');
  pushPhrase(
    ev,
    64,
    ballad.map(([b, m, d]) => [b, m + 12, d] as Phrase[number]),
    0.09,
    'pipe',
  );

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 84, bars: 24, events: ev };
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
// The eight Rift crawls. A procedural Rift floor rolls one environment
// archetype (content/rift/themes.ts) and the cue follows it, so a single run
// can descend from a hoarfrost vault into a war camp into the abyss. Each
// crawl is a tight sixteen-bar loop built to sit UNDER gameplay the way the
// dungeon set does: drone plus identity percussion plus one motif, escalating
// in its back half toward the boss floor without ever grabbing the wheel.
// ---------------------------------------------------------------------------

/** Rift, Frostbound: "Hoarfrost Vault". E minor, 92 bpm, 16 bars. A tomb
 *  with all its echoes frozen: a cold pad leaning a half step onto F and
 *  back, icicle bells dripping down the same three notes, a muffled pulse
 *  under the floor, and glassy piano drops. The slow-aura boss telegraphs
 *  in the writing: everything here arrives slightly later than you expect. */
function composeRiftFrost(): Theme {
  const ev: NoteEvent[] = [];
  type BarSpec = { bass: number; pad: number[]; drip: number[] };
  const Em: BarSpec = { bass: 40, pad: [52, 59, 64], drip: [76, 71, 67] };
  const Fma: BarSpec = { bass: 41, pad: [53, 60, 65], drip: [77, 72, 69] };
  const Cma: BarSpec = { bass: 36, pad: [52, 60, 64], drip: [76, 72, 67] };
  const B5: BarSpec = { bass: 47, pad: [54, 59, 63], drip: [75, 71, 66] };
  const bars: BarSpec[] = [Em, Em, Fma, Em, Cma, B5, Fma, Em, Em, Fma, Cma, Em, B5, Em, Fma, Em];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const late = bar >= 8;
    if (bar % 2 === 0) pushVoicing(ev, b0, c.pad, 8.2, 0.13, 'pad');
    pushNote(ev, b0, c.bass, 2.6, 0.28, 'bass');
    // the vault pulse: muffled, off the downbeat, late like everything here
    pushNote(ev, b0 + 0.25, 38, 1, late ? 0.15 : 0.11, 'frameDrum');
    if (late) pushNote(ev, b0 + 2.25, 38, 0.8, 0.09, 'frameDrum');
    // icicles: the same three notes, dripping behind the beat
    const dripBeats = bar % 2 === 0 ? [1.25, 2.75, 3.5] : [0.75, 2.25, 3.75];
    for (const [i, t] of dripBeats.entries()) {
      pushNote(ev, b0 + t, c.drip[i], 1.1, 0.07, 'tinyBell');
    }
    // glassy piano under the drip line
    if (bar % 2 === 1) {
      pushNote(ev, b0 + 0.5, c.pad[1], 1.4, 0.12, 'piano');
      pushNote(ev, b0 + 3, c.pad[0], 1.2, 0.09, 'piano');
    }
    // cold breath in the deep half
    if (late && bar % 2 === 0) {
      pushNote(ev, b0, c.bass - (c.bass > 40 ? 12 : 0), 8.2, 0.1, 'choir');
    }
    // frost cracking across the ceiling at the phrase turns
    if (bar % 8 === 7) {
      for (const [i, m] of [64, 63, 59, 55].entries()) {
        pushNote(ev, b0 + 2.5 + i * 0.375, m, 0.35, 0.12, 'stacc');
      }
    }
  });

  // the warden's line: a strings figure that keeps freezing mid-gesture
  const frozen: Phrase = [
    [0, 64, 2],
    [2, 67, 1],
    [3, 66, 3],
    [8, 67, 2],
    [10, 71, 1],
    [11, 69, 3],
    [16, 72, 2],
    [18, 71, 1],
    [19, 67, 1],
    [20, 66, 3.5],
    [24, 64, 1],
    [25, 63, 1],
    [26, 64, 4],
  ];
  pushPhrase(ev, 16, frozen, 0.15, 'strings');
  pushPhrase(ev, 48, frozen.slice(0, 6), 0.13, 'strings');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 92, bars: 16, events: ev };
}

/** Rift, Emberforge: "The Anvil Below". D phrygian dominant, 112 bpm, 16
 *  bars. A forge that never went out: anvil strikes on a work rhythm,
 *  bellows drums, a bass that hammers the flat two against the raised
 *  third, molten brass stabs on the thresholds, and a low smith's chant.
 *  The back half stokes the coals for the tyrant on the dais. */
function composeRiftEmber(): Theme {
  const ev: NoteEvent[] = [];
  // D Eb F# G A Bb C
  for (let bar = 0; bar < 16; bar++) {
    const b0 = bar * 4;
    const late = bar >= 8;
    // the anvil: wood block strikes on the smith's count
    pushDrumHits(ev, b0, [0, 0.75, 1.5, 2.5], 'woodBlock', 0.11, 74);
    if (late) pushNote(ev, b0 + 3.25, 74, 0.2, 0.09, 'woodBlock');
    // the bellows
    pushNote(ev, b0, 38, 0.9, 0.26, 'warDrum');
    pushNote(ev, b0 + 2, 38, 0.9, late ? 0.24 : 0.18, 'warDrum');
    pushDrumHits(ev, b0, [1, 3], 'frameDrum', 0.11, 45);
    // hammer bass: D pounding, Eb on the recoil
    pushNote(ev, b0, 38, 0.7, 0.36, 'bass');
    pushNote(ev, b0 + 1, 38, 0.45, 0.2, 'bass');
    pushNote(ev, b0 + 2.5, bar % 2 === 1 ? 39 : 42, 0.45, 0.22, 'bass');
    pushNote(ev, b0 + 3.5, 38, 0.4, 0.18, 'bass');
    // forge drone
    if (bar % 2 === 0) {
      pushNote(ev, b0, 50, 8.2, 0.12, 'choir');
      pushNote(ev, b0, 57, 8.2, 0.07, 'choir');
    }
    // molten light off the dais
    if (bar % 4 === 0) pushVoicing(ev, b0, [50, 57], 0.6, 0.22, 'brassStab');
    if (late && bar % 4 === 2) pushVoicing(ev, b0 + 2, [50, 57], 0.4, 0.16, 'brassStab');
    if (bar % 8 === 0) pushNote(ev, b0, 38, 1, 0.42, 'timpani');
    if (bar % 8 === 7) {
      for (const [i, t] of [3, 3.25, 3.5, 3.75].entries()) {
        pushNote(ev, b0 + t, 38, 0.3, 0.18 + i * 0.05, 'timpani');
      }
    }
    if (late && bar % 4 === 0) pushNote(ev, b0, 70, 2.5, 0.08, 'cymSwell');
  }

  // the smith's chant, low and singed
  const chant: Phrase = [
    [0, 62, 1],
    [1, 63, 0.5],
    [1.5, 62, 0.5],
    [2, 60, 1],
    [3, 58, 1],
    [4, 57, 2],
    [6, 60, 1],
    [7, 62, 1],
    [8, 63, 1.5],
    [9.5, 62, 0.5],
    [10, 60, 1],
    [11, 58, 1],
    [12, 62, 1],
    [13, 60, 0.5],
    [13.5, 58, 0.5],
    [14, 57, 2],
  ];
  pushPhrase(ev, 16, chant, 0.14, 'reed');
  pushPhrase(
    ev,
    48,
    chant.map(([b, m, d]) => [b, m + 12, d] as Phrase[number]),
    0.13,
    'reed',
  );

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 112, bars: 16, events: ev };
}

/** Rift, Venomweald: "Broodhollow". F# minor, 96 bpm, 16 bars. An overgrown
 *  temple gone green-dark: skittering staccato legs that never land where
 *  the last set did, web-muted harp, a clammy reed swell bending a half
 *  step, wood-tick percussion, and a venom-drip square lead sliding down
 *  chromatic steps while the brood mother listens. */
function composeRiftVenom(): Theme {
  const ev: NoteEvent[] = [];
  type BarSpec = { bass: number; pad: number[]; legs: [number, number][] };
  const F$m: BarSpec = {
    bass: 42,
    pad: [54, 57, 61],
    legs: [
      [0, 54],
      [0.25, 57],
      [0.75, 54],
      [2, 56],
      [2.25, 57],
      [3.25, 54],
    ],
  };
  const Dma: BarSpec = {
    bass: 38,
    pad: [54, 57, 62],
    legs: [
      [0.5, 57],
      [0.75, 62],
      [1.75, 57],
      [2.5, 61],
      [2.75, 62],
      [3.5, 57],
    ],
  };
  const G$5: BarSpec = {
    bass: 44,
    pad: [56, 59, 63],
    legs: [
      [0.25, 56],
      [0.5, 59],
      [1.5, 56],
      [2.25, 58],
      [2.5, 59],
      [3.75, 56],
    ],
  };
  const C$5: BarSpec = {
    bass: 37,
    pad: [56, 61, 64],
    legs: [
      [0, 56],
      [0.25, 61],
      [1.25, 56],
      [2, 60],
      [2.25, 61],
      [3, 56],
    ],
  };
  const bars: BarSpec[] = [
    F$m,
    F$m,
    Dma,
    F$m,
    G$5,
    C$5,
    Dma,
    F$m,
    F$m,
    Dma,
    G$5,
    F$m,
    C$5,
    F$m,
    Dma,
    F$m,
  ];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const late = bar >= 8;
    if (bar % 2 === 0) pushVoicing(ev, b0, c.pad, 8.2, 0.11, 'pad');
    pushNote(ev, b0, c.bass, 2.4, 0.28, 'bass');
    pushNote(ev, b0 + 2.75, c.bass, 0.5, 0.14, 'bass');
    // the legs, more of them the deeper you go
    for (const [t, m] of c.legs) {
      pushNote(ev, b0 + t, m, 0.2, 0.13, 'stacc');
      if (late) pushNote(ev, b0 + t + 0.125, m + 12, 0.15, 0.07, 'stacc');
    }
    // ticks in the webbing
    if (bar % 2 === 1) pushDrumHits(ev, b0, [1.25, 1.5, 3.25], 'woodBlock', 0.06, 70);
    // web-muted harp, plucking single low threads
    pushNote(ev, b0 + (bar % 2 === 0 ? 1.5 : 2.5), c.pad[0] - 12, 1, 0.11, 'harp');
    // the clammy swell: a reed bending up a half step and giving up
    if (bar % 4 === 2) {
      pushNote(ev, b0, c.pad[2], 1.5, 0.08, 'reed');
      pushNote(ev, b0 + 1.5, c.pad[2] + 1, 2, 0.07, 'reed');
    }
    // brood pulse
    pushNote(ev, b0, 38, 0.9, late ? 0.15 : 0.1, 'warDrum');
    if (late && bar % 2 === 1) pushNote(ev, b0 + 1.75, 38, 0.7, 0.09, 'warDrum');
  });

  // venom working its way down, one chromatic drip at a time
  const drip: Phrase = [
    [0, 66, 1.5],
    [1.5, 65, 0.5],
    [2, 64, 1],
    [3, 63, 1],
    [4, 61, 2],
    [8, 69, 1.5],
    [9.5, 68, 0.5],
    [10, 66, 1],
    [11, 64, 1],
    [12, 61, 2],
    [16, 71, 1],
    [17, 69, 0.5],
    [17.5, 68, 0.5],
    [18, 66, 1],
    [19, 65, 1],
    [20, 64, 3],
    [24, 63, 1],
    [25, 62, 1],
    [26, 61, 4],
  ];
  pushPhrase(ev, 16, drip, 0.11, 'squareLead');
  pushPhrase(ev, 48, drip.slice(0, 5), 0.1, 'squareLead');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 96, bars: 16, events: ev };
}

/** Rift, Boneyard: "Ossuary Waltz". G harmonic minor, 108 bpm, 16 bars. The
 *  dead here were STACKED, and something taught them rhythm: a dry dance
 *  over a crypt drone, bone clicks for castanets, a skeletal dulcimer tune
 *  with the harmonic-minor sharp seven grinning through it, grave-choir
 *  hums, and a bell that remembers the funerals it rang for. */
function composeRiftBone(): Theme {
  const ev: NoteEvent[] = [];
  type BarSpec = { bass: number; pad: number[]; step: number[] };
  const Gm: BarSpec = { bass: 43, pad: [55, 58, 62], step: [55, 62, 58, 62] };
  const Cm: BarSpec = { bass: 36, pad: [55, 60, 63], step: [48, 60, 55, 60] };
  const D7: BarSpec = { bass: 38, pad: [54, 57, 62], step: [50, 62, 57, 62] };
  const Eb: BarSpec = { bass: 39, pad: [55, 58, 63], step: [51, 63, 58, 63] };
  const bars: BarSpec[] = [Gm, Gm, Cm, D7, Gm, Eb, D7, Gm, Gm, Cm, Eb, Gm, D7, Gm, D7, Gm];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const late = bar >= 8;
    // the dance: oom on one and three, dry chords answering
    pushNote(ev, b0, c.bass, 0.9, 0.32, 'bass');
    pushNote(ev, b0 + 2, c.bass, 0.7, 0.22, 'bass');
    for (const off of [1, 1.5, 3, 3.5]) {
      pushNote(ev, b0 + off, c.step[Math.floor(off) === 1 ? 1 : 3], 0.3, 0.1, 'lute');
    }
    // castanets of knuckle and shin
    pushDrumHits(ev, b0, [0.5, 1.75, 2.5, 3.75], 'woodBlock', 0.09, 72);
    if (late) pushDrumHits(ev, b0, [1.25, 3.25], 'woodBlock', 0.06, 68);
    pushNote(ev, b0, 38, 0.9, late ? 0.18 : 0.13, 'warDrum');
    // crypt drone and the hum of the stacked dead
    if (bar % 2 === 0) pushVoicing(ev, b0, c.pad, 8.2, 0.1, 'pad');
    if (bar % 4 === 3) {
      pushNote(ev, b0, c.pad[0] - 12, 4.1, 0.11, 'choir');
      pushNote(ev, b0 + 2, c.pad[1] - 12, 2.1, 0.08, 'choir');
    }
    if (bar % 8 === 0) pushNote(ev, b0, 55, 3.5, 0.12, 'bell');
    if (bar % 8 === 7) {
      for (const [i, t] of [3, 3.25, 3.5, 3.75].entries()) {
        pushNote(ev, b0 + t, 38, 0.3, 0.15 + i * 0.04, 'timpani');
      }
    }
  });

  // the skeletal tune: harmonic minor, F# grinning at the cadence
  const danceLine: Phrase = [
    [0, 67, 1],
    [1, 70, 0.5],
    [1.5, 67, 0.5],
    [2, 63, 1],
    [3, 62, 1],
    [4, 60, 1],
    [5, 63, 0.5],
    [5.5, 62, 0.5],
    [6, 60, 1],
    [7, 58, 1],
    [8, 55, 1],
    [9, 58, 0.5],
    [9.5, 62, 0.5],
    [10, 66, 1.5],
    [11.5, 67, 0.5],
    [12, 67, 1],
    [13, 66, 0.5],
    [13.5, 62, 0.5],
    [14, 67, 2],
    [16, 70, 1],
    [17, 67, 0.5],
    [17.5, 70, 0.5],
    [18, 72, 1.5],
    [19.5, 70, 0.5],
    [20, 68, 1],
    [21, 67, 0.5],
    [21.5, 66, 0.5],
    [22, 67, 2],
    [24, 63, 1],
    [25, 66, 1],
    [26, 67, 0.5],
    [26.5, 66, 0.5],
    [27, 62, 1],
    [28, 55, 3],
  ];
  pushPhrase(ev, 16, danceLine, 0.15, 'dulcimer');
  // the reprise gets only the tune's first half: the full line would spill
  // past the sixteen-bar loop seam
  const danceHead = danceLine.filter(([b]) => b < 16);
  pushPhrase(ev, 48, danceHead, 0.13, 'dulcimer');
  pushPhrase(
    ev,
    48,
    danceHead.map(([b, m, d]) => [b, m - 12, d] as Phrase[number]),
    0.07,
    'reed',
  );

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 108, bars: 16, events: ev };
}

/** Rift, Warcamp: "Skulls for the Warlord". E minor, 116 bpm, 16 bars. A
 *  sanctum turned muster ground: the whole floor is a drum line. War drums
 *  four to the bar, a riff that bares its teeth on the flat six, warhorn
 *  fifths held long over the din, a grunt chant in the low choir, and
 *  timpani breaks at the gates. The back half doubles the stomp for the
 *  rampage on the dais. */
function composeRiftBrute(): Theme {
  const ev: NoteEvent[] = [];
  for (let bar = 0; bar < 16; bar++) {
    const b0 = bar * 4;
    const late = bar >= 8;
    // the stomp
    pushDrumHits(ev, b0, [0, 1, 2, 3], 'warDrum', late ? 0.24 : 0.19, 38);
    pushDrumHits(ev, b0, [0.5, 2.5], 'frameDrum', 0.12, 45);
    if (late) pushDrumHits(ev, b0, [1.5, 3.5], 'frameDrum', 0.1, 45);
    // the riff: E E G E / E C B E, teeth on the C
    const riff = bar % 2 === 0 ? [40, 40, 43, 40] : [40, 48, 47, 40];
    for (const [i, m] of riff.entries()) {
      pushNote(ev, b0 + i, m, 0.6, i === 0 ? 0.36 : 0.24, 'bass');
    }
    // grunt chant on the war god's two notes
    if (bar % 2 === 0) {
      pushNote(ev, b0, 40, 1.8, 0.14, 'choir');
      pushNote(ev, b0 + 2, 43, 1.8, 0.12, 'choir');
    }
    // warhorns over the camp
    if (bar % 4 === 0) {
      pushNote(ev, b0, 52, 3.5, 0.2, 'horn');
      pushNote(ev, b0 + 0.02, 59, 3.5, 0.15, 'horn');
    }
    if (bar % 4 === 2) pushVoicing(ev, b0, [52, 59], 0.6, 0.22, 'brassStab');
    // gate breaks
    if (bar % 8 === 0) pushNote(ev, b0, 38, 1, 0.45, 'timpani');
    if (bar % 8 === 7) {
      const fill = bar === 15 ? [2, 2.5, 3, 3.25, 3.5, 3.75] : [3, 3.25, 3.5, 3.75];
      for (const [i, t] of fill.entries()) {
        pushNote(ev, b0 + t, 38, 0.3, 0.18 + i * 0.05, 'timpani');
      }
    }
    if (late && bar % 4 === 0) pushNote(ev, b0, 70, 2, 0.09, 'cymSwell');
  }

  // the warcall: a squared-off line the camp bellows back
  const warcall: Phrase = [
    [0, 64, 1],
    [1, 64, 0.5],
    [1.5, 67, 0.5],
    [2, 64, 1],
    [3, 62, 1],
    [4, 60, 1.5],
    [5.5, 62, 0.5],
    [6, 64, 2],
    [8, 67, 1],
    [9, 64, 0.5],
    [9.5, 67, 0.5],
    [10, 69, 1.5],
    [11.5, 67, 0.5],
    [12, 64, 1],
    [13, 62, 1],
    [14, 64, 2],
  ];
  pushPhrase(ev, 16, warcall, 0.14, 'reed');
  pushPhrase(
    ev,
    48,
    warcall.map(([b, m, d]) => [b, m + 12, d] as Phrase[number]),
    0.12,
    'squareLead',
  );

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 116, bars: 16, events: ev };
}

/** Rift, Voidscar: "The Unlit Door". A phrygian, 84 bpm, 16 bars. The
 *  sanctum's geometry stopped agreeing with itself: a drone that will not
 *  resolve its flat two, choir clusters that swell out of nothing, harp
 *  fragments falling in whole tones, a far alien lead repeating a question,
 *  and almost no pulse at all, just a heart somewhere behind the walls. */
function composeRiftVoid(): Theme {
  const ev: NoteEvent[] = [];
  type BarSpec = { bass: number; cluster: number[]; frag: number[] };
  const A5: BarSpec = { bass: 45, cluster: [57, 58, 64], frag: [69, 67, 65, 63] };
  const Bb: BarSpec = { bass: 46, cluster: [58, 62, 65], frag: [70, 68, 66, 64] };
  const Gm: BarSpec = { bass: 43, cluster: [55, 58, 62], frag: [67, 65, 63, 62] };
  const Fma: BarSpec = { bass: 41, cluster: [53, 57, 60], frag: [65, 64, 62, 60] };
  const bars: BarSpec[] = [A5, A5, Bb, A5, Gm, Fma, Bb, A5, A5, Bb, Gm, A5, Fma, Bb, A5, A5];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const late = bar >= 8;
    // the unresolved drone
    if (bar % 2 === 0) {
      pushNote(ev, b0, c.bass - 12, 8.4, 0.2, 'strings');
      pushNote(ev, b0, c.bass - 5, 8.4, 0.12, 'strings');
    }
    pushNote(ev, b0, c.bass - 12 < 30 ? c.bass : c.bass - 12, 3, 0.24, 'bass');
    // clusters that arrive from nowhere and leave the same way
    if (bar % 2 === 1) pushVoicing(ev, b0 + 1, c.cluster, 3, late ? 0.09 : 0.07, 'choir');
    // whole-tone shards falling past the door
    const fragStart = bar % 2 === 0 ? 1.5 : 0.75;
    for (const [i, m] of c.frag.entries()) {
      pushNote(ev, b0 + fragStart + i * 0.5, m, 0.7, 0.08 - i * 0.01, 'harp');
    }
    // a heart behind the walls, not yours
    if (bar % 4 === 2) pushNote(ev, b0 + 1.25, 38, 1, 0.11, 'warDrum');
    if (late && bar % 4 === 0) pushNote(ev, b0 + 3.25, 38, 0.9, 0.09, 'warDrum');
    // the door breathes
    if (bar % 8 === 4) pushNote(ev, b0, 70, 3.5, 0.06, 'cymSwell');
    // wrongness dyad, high and thin, deeper half only
    if (late && bar % 2 === 0) pushVoicing(ev, b0, [75, 76], 8.2, 0.045, 'strings');
  });

  // the question, asked twice, never answered
  const question: Phrase = [
    [0, 69, 1.5],
    [1.5, 70, 0.5],
    [2, 69, 1],
    [3, 65, 1],
    [4, 63, 2.5],
    [8, 69, 1.5],
    [9.5, 70, 0.5],
    [10, 72, 1],
    [11, 70, 1],
    [12, 69, 3],
  ];
  pushPhrase(ev, 16, question, 0.1, 'squareLead');
  pushPhrase(
    ev,
    48,
    question.map(([b, m, d]) => [b, m + 12 > 86 ? m : m + 12, d] as Phrase[number]),
    0.08,
    'squareLead',
  );

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 84, bars: 16, events: ev };
}

/** Rift, Stormspire: "Spirefall". B minor, 120 bpm, 16 bars. A bastion up
 *  inside its own thunderhead: driving staccato eighths that never let the
 *  charge dissipate, harp updrafts, horn calls across the parapets, cymbal
 *  swells breaking like fronts, and timpani thunder that answers a bar
 *  late, the way thunder does. */
function composeRiftStorm(): Theme {
  const ev: NoteEvent[] = [];
  type BarSpec = { root: number; ost: number[]; up: number[] };
  const Bm: BarSpec = { root: 47, ost: [59, 66, 71, 66], up: [47, 54, 59, 62, 66, 71, 74, 78] };
  const G: BarSpec = { root: 43, ost: [55, 62, 67, 62], up: [43, 50, 55, 59, 62, 67, 71, 74] };
  const D: BarSpec = { root: 38, ost: [62, 66, 69, 66], up: [38, 50, 57, 62, 66, 69, 74, 78] };
  const A: BarSpec = { root: 45, ost: [57, 64, 69, 64], up: [45, 52, 57, 61, 64, 69, 73, 76] };
  const Em: BarSpec = { root: 40, ost: [64, 67, 71, 67], up: [40, 52, 59, 64, 67, 71, 76, 79] };
  const bars: BarSpec[] = [Bm, Bm, G, D, Bm, Em, A, Bm, Bm, G, D, A, Em, G, A, Bm];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const late = bar >= 8;
    // the charge: driving eighths
    for (let i = 0; i < 8; i++) {
      pushNote(ev, b0 + i * 0.5, c.ost[i % 4], 0.28, i % 4 === 0 ? 0.2 : 0.12, 'stacc');
    }
    pushNote(ev, b0, c.root, 1.2, 0.34, 'bass');
    pushNote(ev, b0 + 2, c.root, 0.8, 0.24, 'bass');
    pushNote(ev, b0 + 3, c.root + 7, 0.7, 0.2, 'bass');
    pushDrumHits(ev, b0, [0, 2], 'warDrum', late ? 0.2 : 0.16, 38);
    pushDrumHits(ev, b0, [1, 3], 'frameDrum', 0.11, 45);
    // fronts breaking over the spire
    if (bar % 4 === 0) pushNote(ev, b0, 70, 3.5, 0.08, 'cymSwell');
    // thunder answers a bar late
    if (bar % 4 === 1) pushNote(ev, b0 + 0.5, 38, 1, 0.3, 'timpani');
    // updrafts
    if (bar % 4 === 3) {
      for (const [i, m] of c.up.entries()) {
        pushNote(ev, b0 + i * 0.25, m, 0.3, 0.07 + i * 0.008, 'harp');
      }
    }
    // the parapet call
    if (late && bar % 4 === 0) {
      pushNote(ev, b0, c.root + 12, 2.5, 0.16, 'horn');
      pushNote(ev, b0 + 0.02, c.root + 19, 2.5, 0.12, 'horn');
    }
    if (bar % 2 === 0) pushVoicing(ev, b0, [c.ost[0], c.ost[2]], 4.05, 0.07, 'strings');
  });

  // the storm line: pipes cutting across the wind shear
  const shear: Phrase = [
    [0, 71, 0.5],
    [0.5, 74, 0.5],
    [1, 78, 1],
    [2, 76, 0.5],
    [2.5, 74, 0.5],
    [3, 71, 1],
    [4, 69, 0.5],
    [4.5, 71, 0.5],
    [5, 74, 1.5],
    [6.5, 71, 0.5],
    [7, 69, 1],
    [8, 67, 0.5],
    [8.5, 71, 0.5],
    [9, 74, 1],
    [10, 78, 1],
    [11, 76, 1],
    [12, 74, 0.5],
    [12.5, 73, 0.5],
    [13, 74, 1.5],
    [14.5, 71, 0.5],
    [15, 71, 1],
  ];
  pushPhrase(ev, 16, shear, 0.16, 'pipe');
  pushPhrase(ev, 48, shear, 0.15, 'pipe');
  pushPhrase(
    ev,
    48,
    shear.map(([b, m, d]) => [b, m - 12, d] as Phrase[number]),
    0.08,
    'strings',
  );

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 120, bars: 16, events: ev };
}

/** Rift, Sunken: "Pressure of the Deep". A minor, 72 bpm, 16 bars. A temple
 *  the ocean kept: the lowest drone in the soundtrack, slow harp water
 *  moving through the naves, one sonar bell every four bars, a drowned
 *  choir, and a leviathan figure turning over far below. Muffled timpani
 *  where the hull of the world flexes. The deep half adds weight, not
 *  speed: down here nothing hurries. */
function composeRiftTide(): Theme {
  const ev: NoteEvent[] = [];
  type BarSpec = { bass: number; pad: number[]; flow: number[] };
  const Am: BarSpec = { bass: 33, pad: [52, 57, 60], flow: [45, 52, 57, 60, 64, 60, 57, 52] };
  const Fma: BarSpec = { bass: 41, pad: [53, 57, 60], flow: [41, 48, 53, 57, 60, 57, 53, 48] };
  const Dm: BarSpec = { bass: 38, pad: [50, 53, 57], flow: [38, 45, 50, 53, 57, 53, 50, 45] };
  const Em: BarSpec = { bass: 40, pad: [52, 55, 59], flow: [40, 47, 52, 55, 59, 55, 52, 47] };
  const bars: BarSpec[] = [Am, Am, Fma, Am, Dm, Em, Fma, Am, Am, Fma, Dm, Am, Em, Fma, Em, Am];

  bars.forEach((c, bar) => {
    const b0 = bar * 4;
    const deep = bar >= 8;
    // the pressure: pad over the lowest bass in the score
    if (bar % 2 === 0) pushVoicing(ev, b0, c.pad, 8.2, 0.13, 'pad');
    pushNote(ev, b0, c.bass, 3.2, 0.3, 'bass');
    // water through the naves
    for (const [i, m] of c.flow.entries()) {
      const swell = i <= 4 ? i : 8 - i;
      pushNote(ev, b0 + i * 0.5, m, 0.6, 0.07 + swell * 0.015, 'harp');
    }
    // the drowned congregation
    if (deep && bar % 2 === 0) {
      pushNote(ev, b0, c.pad[0] - 12, 8.2, 0.11, 'choir');
      pushNote(ev, b0, c.pad[1] - 12, 8.2, 0.07, 'choir');
    }
    // the hull of the world flexing
    if (bar % 4 === 2) pushNote(ev, b0 + 1.5, 38, 1.2, deep ? 0.2 : 0.14, 'timpani');
    if (deep && bar % 4 === 0) pushNote(ev, b0 + 3, 38, 0.9, 0.1, 'warDrum');
    // sonar: one bell, every four bars, always the same distance away
    if (bar % 4 === 0) pushNote(ev, b0 + 2, 76, 2, 0.06, 'tinyBell');
  });

  // the leviathan turning over, far below the floor
  const leviathan: Phrase = [
    [0, 45, 2],
    [2, 48, 1],
    [3, 47, 1],
    [4, 45, 3],
    [8, 48, 2],
    [10, 52, 1],
    [11, 50, 1],
    [12, 48, 1],
    [13, 47, 1],
    [14, 45, 2],
  ];
  pushPhrase(ev, 16, leviathan, 0.13, 'squareLead');
  pushPhrase(ev, 48, leviathan, 0.12, 'squareLead');
  // a reed dirge drifts once across the deep half
  const dirge: Phrase = [
    [0, 64, 1.5],
    [1.5, 62, 0.5],
    [2, 60, 1],
    [3, 59, 1],
    [4, 57, 2],
    [6, 55, 1],
    [7, 59, 1],
    [8, 60, 1.5],
    [9.5, 59, 0.5],
    [10, 57, 3],
  ];
  pushPhrase(ev, 36, dirge, 0.1, 'reed');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 72, bars: 16, events: ev };
}

// ---------------------------------------------------------------------------
// Battle music. Every variant grows from the original combat cue's DNA: the
// pounding staccato eighth cell from D3 (root, root, flat three, root, five,
// root, flat three, four), timpani on one, three, and the and-of-four pickup,
// and bare horn fifths. Orchestral tension in the classic MMO mold: no drum
// kit backbeat, no song melody; percussion, brass gestures, and string
// agitato that sit under gameplay. All written from D (the runtime used to
// transpose the active cue onto each zone's tonal center; the streamed
// remasters play as recorded). The alternates are registered as extra themes
// purely so the render tool can audition them; in game, combat now streams
// one of the two remastered battle tracks (see music_tracks.ts).
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
const STORAGE_KEY = 'ev_music_on';

// All remasters are mastered to one loudness (about -15 LUFS), so streamed
// cues share a single level through the master gain; 0.5 matches the level
// the Sowfield file tracks already play at.
const STREAM_LEVEL = 0.5;
// Pause a stream once it has been silent this long: the slowest fade time
// constant in play (FADE_SECONDS / 3, about 0.73s) has decayed below 0.5%
// (under -45 dB) by then, and a paused element stops decoding and
// downloading. Playback later resumes from the same position, so re-entering
// a zone picks its theme back up mid-phrase.
const STREAM_PAUSE_AFTER_S = 4;
const STREAM_KEEPER_MS = 500;

export function buildMusicThemes(withOverrides = true): Record<string, Theme> {
  const composed: Record<string, Theme> = {
    town_eastbrook: composeTownEastbrook(),
    town_fenbridge: composeTownFenbridge(),
    town_highwatch: composeTownHighwatch(),
    vale: composeVale(),
    vale_legacy: composeLegacyVale(),
    marsh: composeMarsh(),
    peaks: composePeaks(),
    dusk: composeDusk(),
    ember: composeEmber(),
    frost: composeFrost(),
    amber: composeAmber(),
    fen: composeFen(),
    night: composeNight(),
    haunt: composeHaunt(),
    jungle: composeJungle(),
    garden: composeGarden(),
    gale: composeGale(),
    farshore: composeFarshore(),
    vale_cup: composeValeCup(),
    dungeon_hollow_crypt: composeDungeonHollowCrypt(),
    dungeon_sunken_bastion: composeDungeonSunkenBastion(),
    dungeon_gravewyrm_sanctum: composeDungeonGravewyrmSanctum(),
    rift_frost: composeRiftFrost(),
    rift_ember: composeRiftEmber(),
    rift_venom: composeRiftVenom(),
    rift_bone: composeRiftBone(),
    rift_brute: composeRiftBrute(),
    rift_void: composeRiftVoid(),
    rift_storm: composeRiftStorm(),
    rift_tide: composeRiftTide(),
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
  // ESTIMATED (not yet measured): the Sowfield tune is voiced close to the
  // Eastbrook town density (lute strum + oom-pah bass + drums + pipe lead), so
  // it starts near the town reference. Recompute with scripts/render_music.mjs
  // + the gated-RMS pass alongside the next soundtrack measurement batch.
  vale_cup: 1.4,
  dungeon_hollow_crypt: 2.95,
  dungeon_sunken_bastion: 2.95,
  dungeon_gravewyrm_sanctum: 1.8,
  combat: 1.35,
  // The nineteen new-environment cues, MEASURED by the same gated-RMS pass:
  // rendered at trim 1 via scripts/render_music.mjs, then
  // scripts/music_gated_rms.mjs (400ms windows, -15dB gate) against the
  // Eastbrook town reference.
  dusk: 1.45,
  ember: 2.2,
  frost: 1.48,
  amber: 2.57,
  fen: 2.42,
  night: 1.69,
  haunt: 2.93,
  jungle: 2.83,
  garden: 2.86,
  gale: 2.24,
  farshore: 1.57,
  rift_frost: 1.98,
  rift_ember: 2.58,
  rift_venom: 2.36,
  rift_bone: 2.48,
  rift_brute: 1.93,
  rift_void: 3.39,
  rift_storm: 2.77,
  rift_tide: 1.9,
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

// One streamed cue: a looping media element (progressive download, decoded on
// demand) behind its own crossfade gain. el stays null until the cue is first
// audible (and always in plain-Node tests, which have no Audio constructor);
// targets still track for the logic either way.
interface StreamTrack {
  url: string;
  el: HTMLAudioElement | null;
  gain: GainNode;
  target: number; // logical 0..1; the master gain applies the shared level
  silentAt: number; // ctx.currentTime the cue went silent; -1 while audible
}

export class MusicDirector {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bossGain: GainNode | null = null;
  private bossBuffer: AudioBuffer | null = null;
  private bossSource: AudioBufferSourceNode | null = null;
  private bossElement: HTMLAudioElement | null = null;
  private bossLoading = false;
  private zoneStreams: Partial<Record<MusicZone, StreamTrack>> = {};
  private combatStreams: StreamTrack[] = [];
  private combatIdx = 0;
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
  // Sowfield area music: two looped mp3s ('waiting' before a game, 'match' once
  // one has kicked off) that crossfade against each other and duck the procedural
  // score while you stand at the stadium. Same file-track pattern as the boss loop.
  private sowfieldWaitingEl: HTMLAudioElement | null = null;
  private sowfieldMatchEl: HTMLAudioElement | null = null;
  private sowfieldWaitingGain: GainNode | null = null;
  private sowfieldMatchGain: GainNode | null = null;
  private sowfieldSrcMade = false;
  private sowfieldTrack: 'waiting' | 'match' | null = null;

  get enabled(): boolean {
    return this._enabled;
  }

  // master gain target given the enabled flag and volume (base STREAM_LEVEL).
  // The dedicated Nythraxis track owns the mix while active.
  private masterTarget(): number {
    if (!this._enabled || this._menuPaused || this.bossActive || this.sowfieldTrack !== null)
      return 0;
    return STREAM_LEVEL * this._vol;
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
    // handing the mix back must revive paused streams now, not a tick later
    if (!on) this.streamKeeper();
  }

  resetForDungeonEntry(dungeonId: string | null, zone?: MusicZone): void {
    if (!dungeonId) return;
    // Real dungeons and delves resolve their cue from the instance id; a
    // procedural Rift floor has no DUNGEON_MUSIC row (its cue follows the
    // floor's RiftTheme), so the HUD passes the resolved zone explicitly.
    const cueZone = zone ?? dungeonMusicZoneForDungeon(dungeonId);
    // A fresh dungeon run starts its cue from the top (unlike overworld zones,
    // which resume mid-track when you cross back in).
    const el = this.zoneStreams[cueZone]?.el;
    if (el) {
      try {
        el.currentTime = 0;
      } catch {
        /* browser may reject seeking before metadata */
      }
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
      resumeWhenAllowed(this.ctx);
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

  /** Drive the Sowfield area music: 'waiting' before a game, 'match' once one has
   *  kicked off, null when you are away from the stadium. Idempotent; the HUD calls
   *  it every frame. Crossfades the two tracks and ducks the procedural score while
   *  active. */
  setSowfieldTrack(track: 'waiting' | 'match' | null): void {
    if (track === this.sowfieldTrack) {
      this.applySowfield();
      return;
    }
    const enteringOrLeaving = (this.sowfieldTrack === null) !== (track === null);
    this.sowfieldTrack = track;
    this.applySowfield();
    if (this.ctx && this.master && enteringOrLeaving) {
      this.master.gain.setTargetAtTime(
        this.masterTarget(),
        this.ctx.currentTime,
        track ? 0.4 : 0.7,
      );
    }
    // walking away from the stadium must revive paused streams now
    if (enteringOrLeaving && track === null) this.streamKeeper();
  }

  private ensureSowfieldElements(): void {
    if (this.sowfieldSrcMade || !this.ctx || typeof Audio !== 'function') return;
    this.sowfieldSrcMade = true;
    const mk = (url: string, gain: GainNode | null): HTMLAudioElement => {
      const el = new Audio(url);
      el.loop = true;
      el.preload = 'auto';
      try {
        const src = this.ctx?.createMediaElementSource(el);
        if (src && gain) src.connect(gain);
      } catch {
        /* element already wired or unsupported */
      }
      return el;
    };
    this.sowfieldWaitingEl = mk('/audio/sowfield-waiting.mp3', this.sowfieldWaitingGain);
    this.sowfieldMatchEl = mk('/audio/sowfield-match.mp3', this.sowfieldMatchGain);
  }

  private applySowfield(): void {
    if (!this.ctx) return;
    const active = this.sowfieldTrack !== null && this._enabled && !this._menuPaused;
    const level = 0.5 * this._vol;
    if (active) {
      resumeWhenAllowed(this.ctx);
      this.ensureSowfieldElements();
      void this.sowfieldWaitingEl?.play().catch(() => {});
      void this.sowfieldMatchEl?.play().catch(() => {});
    }
    const wTarget = active && this.sowfieldTrack === 'waiting' ? level : 0;
    const mTarget = active && this.sowfieldTrack === 'match' ? level : 0;
    if (this.sowfieldWaitingGain)
      this.sowfieldWaitingGain.gain.setTargetAtTime(wTarget, this.ctx.currentTime, 0.5);
    if (this.sowfieldMatchGain)
      this.sowfieldMatchGain.gain.setTargetAtTime(mTarget, this.ctx.currentTime, 0.5);
    if (!active && this.sowfieldSrcMade) {
      // Fade to silence, then pause once we are truly away (guard against a quick
      // re-entry flipping the track back on before the timeout fires).
      window.setTimeout(() => {
        if (this.sowfieldTrack === null) {
          this.sowfieldWaitingEl?.pause();
          this.sowfieldMatchEl?.pause();
        }
      }, 700);
    }
  }

  /** Set music volume (0..1). Safe before init(); applied to the master gain. */
  setVolume(v: number): void {
    this._vol = Math.min(1, Math.max(0, v));
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.masterTarget(), this.ctx.currentTime, 0.2);
    }
    this.applyBossPlayback();
    this.applySowfield();
    // leaving volume 0 must revive paused streams now, not a tick later
    if (this.streamsAudible()) this.streamKeeper();
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
    this.sowfieldWaitingGain = ctx.createGain();
    this.sowfieldWaitingGain.gain.value = 0;
    this.sowfieldWaitingGain.connect(compressor);
    this.sowfieldMatchGain = ctx.createGain();
    this.sowfieldMatchGain.gain.value = 0;
    this.sowfieldMatchGain.connect(compressor);

    // Register both battle themes now (and warm their downloads whenever the
    // mix is audible, see streamKeeper): a fight can start at any moment and
    // its opening hit must not wait on a first-byte fetch. Zone streams are
    // made lazily on first activation instead; a zone change always has the
    // old theme's crossfade window to cover the new stream spinning up.
    for (const url of COMBAT_STREAM_URLS) {
      const stream = this.makeStream(url);
      if (stream) this.combatStreams.push(stream);
    }
    this.timer = window.setInterval(() => this.streamKeeper(), STREAM_KEEPER_MS);
    this.streamKeeper();
  }

  /** Build one streamed cue's bookkeeping and crossfade gain. The media
   *  element itself is created on the first audible activation
   *  (ensureElement), so a muted player never downloads anything. */
  private makeStream(url: string): StreamTrack | null {
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);
    return { url, el: null, gain, target: 0, silentAt: 0 };
  }

  /** Create and wire the looping, progressively-downloaded media element. */
  private ensureElement(stream: StreamTrack): void {
    if (stream.el || !this.ctx || typeof Audio !== 'function') return;
    const el = new Audio(stream.url);
    el.loop = true;
    el.preload = 'auto';
    try {
      this.ctx.createMediaElementSource(el).connect(stream.gain);
    } catch {
      // Without a graph route the element would play at full volume outside
      // every gain, duck, and mute in the mix; silence is the safer failure.
      el.muted = true;
    }
    stream.el = el;
  }

  private ensureZoneStream(zone: MusicZone): void {
    if (this.zoneStreams[zone]) return;
    const url = ZONE_STREAM_URLS[zone];
    if (!url) return;
    const stream = this.makeStream(url);
    if (stream) this.zoneStreams[zone] = stream;
  }

  // Streams are audible only when nothing has the master ducked to zero: the
  // toggle, the menu fade, the volume slider, and the dedicated boss and
  // Sowfield file tracks (which own the mix while active). While inaudible,
  // streams pause instead of decoding silence.
  private streamsAudible(): boolean {
    return (
      this._enabled &&
      !this._menuPaused &&
      this._vol > 0 &&
      !this.bossActive &&
      this.sowfieldTrack === null
    );
  }

  private setStreamTarget(stream: StreamTrack, target: number, fadeSeconds: number): void {
    if (!this.ctx || stream.target === target) return;
    stream.target = target;
    stream.gain.gain.setTargetAtTime(target, this.ctx.currentTime, fadeSeconds);
    if (target > 0) {
      stream.silentAt = -1;
      // While the mix is inaudible do not start the download; the keeper
      // revives the stream the moment it is audible again.
      if (!this.streamsAudible()) return;
      resumeWhenAllowed(this.ctx);
      this.ensureElement(stream);
      if (stream.el) void stream.el.play().catch(() => {});
    } else {
      stream.silentAt = this.ctx.currentTime;
    }
  }

  private *allStreams(): Iterable<StreamTrack> {
    for (const stream of Object.values(this.zoneStreams)) yield stream;
    yield* this.combatStreams;
  }

  // Runs every STREAM_KEEPER_MS (and directly on unmute, menu close, volume
  // restore, and boss/Sowfield handback so revival is instant): pauses cues
  // that finished fading out, so an inaudible stream costs no decoding or
  // bandwidth, revives active cues that a refused autoplay, a tab restore,
  // or a mute window left paused, and keeps the battle themes' downloads
  // warm whenever the mix is audible.
  private streamKeeper(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const audibleBase = this.streamsAudible();
    const now = ctx.currentTime;
    if (audibleBase) for (const stream of this.combatStreams) this.ensureElement(stream);
    for (const stream of this.allStreams()) {
      if (audibleBase && stream.target > 0) {
        stream.silentAt = -1;
        this.ensureElement(stream);
        if (stream.el?.paused) {
          resumeWhenAllowed(ctx);
          void stream.el.play().catch(() => {});
        }
      } else if (stream.silentAt < 0) {
        stream.silentAt = now;
      } else if (stream.el && !stream.el.paused && now - stream.silentAt > STREAM_PAUSE_AFTER_S) {
        stream.el.pause();
      }
    }
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
    this.applySowfield();
    // re-enabling must revive paused streams now, not a keeper tick later
    if (on) this.streamKeeper();
  }

  /** Fade out while the game menu is open; does not change the music toggle. */
  pauseForMenu(): void {
    if (this._menuPaused) return;
    this._menuPaused = true;
    if (!this.ctx) return;
    resumeWhenAllowed(this.ctx);
    if (this.master) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    }
    this.applyBossPlayback();
    this.applySowfield();
  }

  /** Restore playback after closing the game menu. */
  resumeFromMenu(): void {
    if (!this._menuPaused) return;
    this._menuPaused = false;
    if (!this.ctx) return;
    resumeWhenAllowed(this.ctx);
    if (this.master) {
      this.master.gain.setTargetAtTime(this.masterTarget(), this.ctx.currentTime, 0.35);
    }
    this.applyBossPlayback();
    this.applySowfield();
    // closing the menu must revive paused streams now, not a keeper tick later
    this.streamKeeper();
  }

  // called every frame by the HUD; cheap unless the state changed
  update(zone: MusicZone, inCombat: boolean): void {
    if (!this.ctx) return;
    if (zone === this.zone && inCombat === this.combat) return;
    const combatStarting = inCombat && !this.combat;
    this.zone = zone;
    this.combat = inCombat;
    // Combat music replaces the zone theme rather than layering over it: the
    // zone is silenced for the duration of combat and fades back in when it
    // ends. Fade out faster than fade in so instance music does not bleed
    // into the world.
    if (!inCombat) this.ensureZoneStream(zone);
    for (const [name, stream] of Object.entries(this.zoneStreams) as [MusicZone, StreamTrack][]) {
      const target = name === zone && !inCombat ? 1 : 0;
      this.setStreamTarget(stream, target, target > 0 ? FADE_SECONDS / 3 : 0.35);
    }
    // Each fight opens on one of the battle themes, chosen at random per
    // fight and restarted from the top so the opening hit lands; the pick
    // then holds for the whole fight, even across a zone border mid-chase.
    // A pull chained within the previous fight's fade-out (element not yet
    // paused) continues from position instead: rewinding an audibly fading
    // track would jump-cut, and rolling combat reads as one long fight.
    if (combatStarting && this.combatStreams.length > 0) {
      this.combatIdx = pickCombatTrackIndex(this.combatStreams.length, Math.random);
      const el = this.combatStreams[this.combatIdx].el;
      if (el?.paused) {
        try {
          el.currentTime = 0;
        } catch {
          /* browser may reject seeking before metadata */
        }
      }
    }
    this.combatStreams.forEach((stream, idx) => {
      const target = inCombat && idx === this.combatIdx ? 1 : 0;
      this.setStreamTarget(stream, target, target > 0 ? 0.35 : FADE_SECONDS / 3);
    });
  }
}

export const music = new MusicDirector();
