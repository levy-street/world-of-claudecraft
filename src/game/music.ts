// Procedural adventure soundtrack — no audio files, pure WebAudio synthesis.
// Eastbrook keeps the original town theme intact. Every other zone pushes
// harder toward original old-school medieval MMO colors: lute/dulcimer loops,
// pipe/reed/square leads, wood-block ticks, frame drums, and faster dungeons.
// Each theme is a composed multi-track loop scheduled with a lookahead
// timer; zone changes crossfade.

export type MusicZone =
  | 'town_eastbrook' | 'town_fenbridge' | 'town_highwatch'
  | 'vale' | 'vale_legacy' | 'marsh' | 'peaks'
  | 'dungeon_hollow_crypt' | 'dungeon_sunken_bastion' | 'dungeon_gravewyrm_sanctum';

const TOWN_MUSIC: Record<string, MusicZone> = {
  eastbrook_vale: 'town_eastbrook',
  mirefen_marsh: 'town_fenbridge',
  thornpeak_heights: 'town_highwatch',
};

const ZONE_MUSIC: Partial<Record<string, MusicZone>> = {
  thornpeak_heights: 'vale_legacy',
};

const DUNGEON_MUSIC: Record<string, MusicZone> = {
  hollow_crypt: 'dungeon_hollow_crypt',
  sunken_bastion: 'dungeon_sunken_bastion',
  gravewyrm_sanctum: 'dungeon_gravewyrm_sanctum',
};

export function dungeonMusicZoneForDungeon(dungeonId: string): MusicZone {
  return DUNGEON_MUSIC[dungeonId] ?? 'dungeon_hollow_crypt';
}

export function shouldResetMusicForDungeonEntry(previousDungeonId: string | null, nextDungeonId: string | null): boolean {
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

type Inst = 'strings' | 'flute' | 'harp' | 'horn' | 'choir' | 'bell' | 'timpani' | 'bass' | 'stacc' | 'pad'
  | 'lute' | 'dulcimer' | 'frameDrum' | 'warDrum' | 'reed' | 'pipe'
  | 'squareLead' | 'woodBlock' | 'tinyBell';

interface NoteEvent {
  beat: number; // quarter-note position in the loop
  midi: number;
  dur: number; // beats
  vel: number; // 0..1
  inst: Inst;
}

interface Theme {
  bpm: number;
  bars: number; // 4/4
  events: NoteEvent[];
}

interface Layer {
  theme: Theme;
  gain: GainNode;
  target: number;
  anchor: number;
  nextIdx: number;
  loopCount: number;
  transpose: number;
}

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

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

function pushNote(out: NoteEvent[], beat: number, midi: number, dur: number, vel: number, inst: Inst): void {
  out.push({ beat, midi, dur, vel, inst });
}

// melody phrases written as [beatOffset, midi, durBeats]
type Phrase = [number, number, number][];

function pushPhrase(out: NoteEvent[], startBeat: number, phrase: Phrase, vel: number, inst: Inst): void {
  for (const [b, m, d] of phrase) pushNote(out, startBeat + b, m, d, vel, inst);
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

function composeTownEastbrook(): Theme {
  const ev: NoteEvent[] = [];
  // D major, warm and pastoral
  const D = { root: 62 }, A = { root: 57 }, Bm = { root: 59, minor: true };
  const G = { root: 55 }, F$m = { root: 54, minor: true };
  const chords: ChordDef[] = [D, A, Bm, G, D, G, A, D, D, F$m, G, D, Bm, G, A, D];

  chords.forEach((c, bar) => {
    const b0 = bar * 4;
    const t = triad(c);
    // string pad: whole-bar triad, octave below
    for (const n of t) pushNote(ev, b0, n - 12, 4.05, 0.30, 'strings');
    // cello bass: root on 1 and 3
    pushNote(ev, b0, c.root - 24, 1.8, 0.5, 'bass');
    pushNote(ev, b0 + 2, c.root - 24, 1.8, 0.42, 'bass');
    // harp: flowing eighth arpeggio root-3rd-5th-octave and back
    const arp = [t[0], t[1], t[2], t[0] + 12, t[2], t[1], t[0], t[1]];
    arp.forEach((n, i) => pushNote(ev, b0 + i * 0.5, n, 0.5, 0.34, 'harp'));
    // horn counterline in the back half of each section
    if (bar % 8 >= 4) {
      pushNote(ev, b0, c.root - 12, 2, 0.16, 'horn');
      pushNote(ev, b0 + 2, c.root - 5, 2, 0.14, 'horn');
    }
  });

  // flute melody (two 8-bar phrases)
  const phraseA: Phrase = [
    [0, 69, 1], [1, 74, 1], [2, 76, 1], [3, 78, 1],
    [4, 78, 1.5], [5.5, 76, 0.5], [6, 74, 2],
    [8, 76, 1], [9, 78, 1], [10, 79, 1], [11, 78, 1],
    [12, 76, 3],
    [16, 74, 1], [17, 78, 1], [18, 81, 1.5], [19.5, 79, 0.5],
    [20, 78, 1.5], [21.5, 76, 0.5], [22, 74, 1], [23, 76, 1],
    [24, 78, 2], [26, 76, 2], [28, 74, 3],
  ];
  const phraseB: Phrase = [
    [0, 81, 1], [1, 78, 1], [2, 79, 1], [3, 81, 1],
    [4, 83, 1.5], [5.5, 81, 0.5], [6, 79, 1], [7, 78, 1],
    [8, 79, 1], [9, 78, 1], [10, 76, 1], [11, 79, 1],
    [12, 78, 3],
    [16, 71, 1], [17, 74, 1], [18, 78, 1], [19, 81, 1],
    [20, 79, 1.5], [21.5, 78, 0.5], [22, 76, 1], [23, 79, 1],
    [24, 78, 2], [26, 76, 2], [28, 74, 4],
  ];
  pushPhrase(ev, 0, phraseA, 0.34, 'flute');
  pushPhrase(ev, 32, phraseB, 0.34, 'flute');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 80, bars: 16, events: ev };
}

function pushRepeated(out: NoteEvent[], startBeat: number, notes: number[], step: number, dur: number, vel: number, inst: Inst): void {
  notes.forEach((m, i) => pushNote(out, startBeat + i * step, m, dur, vel, inst));
}

function pushDrumHits(out: NoteEvent[], startBeat: number, offsets: number[], inst: Inst, vel: number, midi = 42): void {
  offsets.forEach((b, i) => pushNote(out, startBeat + b, midi, 0.22, vel * (i % 2 === 0 ? 1 : 0.78), inst));
}

function pushPedal(out: NoteEvent[], beat: number, root: number, inst: Inst, vel: number): void {
  pushNote(out, beat, root - 24, 4.1, vel, inst);
  pushNote(out, beat, root - 17, 4.1, vel * 0.62, inst);
}

function composeTownFenbridge(): Theme {
  const ev: NoteEvent[] = [];
  // F mixolydian market-town: deliberate old-school medieval MIDI flavor.
  // The lead is original, short, and hooky; the accompaniment leans lute,
  // dulcimer, frame drum, and square/reed color rather than orchestral wash.
  const F = { root: 65 }, Eb = { root: 63 }, Bb = { root: 58 }, C = { root: 60 }, Dm = { root: 62, minor: true };
  const chords: ChordDef[] = [F, Eb, Bb, F, Dm, Bb, C, F, F, Bb, Eb, F, Dm, C, Bb, F];

  chords.forEach((c, bar) => {
    const b0 = bar * 4;
    const t = triad(c);
    // Less cinematic pad, more clear looping MIDI harmony.
    pushNote(ev, b0, c.root - 12, 4.05, 0.08, 'pad');
    pushNote(ev, b0, c.root - 5, 4.05, 0.06, 'pad');
    pushNote(ev, b0, c.root - 24, 1.6, 0.32, 'bass');
    pushNote(ev, b0 + 2, c.root - 19, 1.2, 0.23, 'bass');

    // Alternating lute/dulcimer motor, intentionally square and memorable.
    const low = [t[0] - 12, t[2] - 12, t[1] - 12, t[2] - 12, t[0], t[2] - 12, t[1] - 12, t[2] - 12];
    pushRepeated(ev, b0, low, 0.5, 0.28, 0.22, 'lute');
    const high = [t[2] + 12, t[1] + 12, t[0] + 12, t[1] + 12];
    pushRepeated(ev, b0 + 0.25, high, 1, 0.2, 0.12, 'dulcimer');

    // Tavern pulse: bouncy but not modern.
    pushDrumHits(ev, b0, [0, 1.5, 2.5, 3.5], 'frameDrum', bar % 4 === 3 ? 0.16 : 0.12, 43);
    if (bar % 4 === 3) pushNote(ev, b0 + 3.75, 72, 0.15, 0.11, 'woodBlock');
  });

  const hookA: Phrase = [
    [0, 77, 0.5], [0.5, 75, 0.5], [1, 72, 1], [2, 70, 0.5], [2.5, 72, 0.5], [3, 75, 1],
    [4, 77, 0.5], [4.5, 80, 0.5], [5, 79, 1], [6, 75, 0.5], [6.5, 72, 0.5], [7, 70, 1],
    [8, 72, 0.5], [8.5, 75, 0.5], [9, 77, 1], [10, 80, 0.5], [10.5, 79, 0.5], [11, 77, 1],
    [12, 75, 0.5], [12.5, 72, 0.5], [13, 70, 1], [14, 72, 0.5], [14.5, 75, 0.5], [15, 77, 1],
  ];
  const hookB: Phrase = [
    [0, 84, 0.5], [0.5, 82, 0.5], [1, 80, 0.5], [1.5, 77, 0.5], [2, 75, 1], [3, 77, 1],
    [4, 80, 0.5], [4.5, 79, 0.5], [5, 77, 1], [6, 75, 0.5], [6.5, 72, 0.5], [7, 75, 1],
    [8, 77, 0.5], [8.5, 80, 0.5], [9, 82, 0.5], [9.5, 84, 0.5], [10, 82, 1], [11, 79, 1],
    [12, 80, 0.5], [12.5, 77, 0.5], [13, 75, 1], [14, 72, 0.5], [14.5, 75, 0.5], [15, 77, 1],
  ];
  pushPhrase(ev, 0, hookA, 0.18, 'pipe');
  pushPhrase(ev, 16, hookA.map(([b, m, d]) => [b, m - 12, d] as Phrase[number]), 0.12, 'reed');
  pushPhrase(ev, 32, hookB, 0.18, 'squareLead');
  pushPhrase(ev, 48, hookA, 0.14, 'pipe');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 96, bars: 16, events: ev };
}

function composeTownHighwatch(): Theme {
  const ev: NoteEvent[] = [];
  // B minor highland watch post: faster medieval march with pipe/reed hooks,
  // blocky harmony, and field percussion instead of a slow cinematic cue.
  const Bm = { root: 59, minor: true }, G = { root: 55 }, A = { root: 57 }, D = { root: 62 };
  const Em = { root: 52, minor: true }, Fsm = { root: 54, minor: true };
  const chords: ChordDef[] = [Bm, G, A, Bm, D, A, Em, Fsm, Bm, G, D, A, Em, G, Fsm, Bm];

  chords.forEach((c, bar) => {
    const b0 = bar * 4;
    const t = triad(c);
    pushPedal(ev, b0, c.root, 'strings', 0.15);
    if (bar % 2 === 0) {
      pushNote(ev, b0, c.root - 12, 2.8, 0.14, 'horn');
      pushNote(ev, b0 + 0.03, c.root - 5, 2.8, 0.10, 'horn');
    }
    pushNote(ev, b0, c.root - 24, 1.2, 0.42, 'bass');
    pushNote(ev, b0 + 1.5, c.root - 17, 0.9, 0.28, 'bass');
    pushNote(ev, b0 + 2.5, c.root - 12, 0.8, 0.24, 'bass');

    const chop = [t[0], t[2], t[0] + 12, t[1] + 12, t[2] + 12, t[1] + 12, t[0] + 12, t[2]];
    pushRepeated(ev, b0, chop, 0.5, 0.16, 0.18, bar % 4 < 2 ? 'dulcimer' : 'lute');
    pushDrumHits(ev, b0, [0, 0.75, 1.5, 2, 2.75, 3.5], 'frameDrum', 0.14, 45);
    if (bar % 4 === 3) pushNote(ev, b0 + 3.5, 38, 0.45, 0.22, 'timpani');
  });

  const pipes: Phrase = [
    [0, 74, 0.5], [0.5, 76, 0.5], [1, 78, 1], [2, 76, 0.5], [2.5, 74, 0.5], [3, 71, 1],
    [4, 74, 0.5], [4.5, 78, 0.5], [5, 81, 1], [6, 79, 0.5], [6.5, 78, 0.5], [7, 76, 1],
    [8, 78, 0.5], [8.5, 81, 0.5], [9, 83, 1], [10, 81, 0.5], [10.5, 78, 0.5], [11, 76, 1],
    [12, 74, 0.5], [12.5, 76, 0.5], [13, 78, 1], [14, 76, 0.5], [14.5, 74, 0.5], [15, 71, 1],
  ];
  const answer: Phrase = [
    [0, 71, 1], [1, 74, 0.5], [1.5, 76, 0.5], [2, 78, 1], [3, 76, 1],
    [4, 74, 0.5], [4.5, 71, 0.5], [5, 69, 1], [6, 71, 0.5], [6.5, 74, 0.5], [7, 76, 1],
    [8, 78, 0.5], [8.5, 76, 0.5], [9, 74, 1], [10, 71, 0.5], [10.5, 69, 0.5], [11, 71, 1],
    [12, 74, 0.5], [12.5, 76, 0.5], [13, 78, 1], [14, 76, 0.5], [14.5, 74, 0.5], [15, 71, 1],
  ];
  pushPhrase(ev, 0, pipes, 0.17, 'pipe');
  pushPhrase(ev, 16, answer, 0.15, 'reed');
  pushPhrase(ev, 32, pipes, 0.14, 'squareLead');
  pushPhrase(ev, 48, answer, 0.16, 'horn');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 104, bars: 16, events: ev };
}

function composeVale(): Theme {
  const ev: NoteEvent[] = [];
  // A dorian overworld: playful and looping, with sparse orchestral depth.
  const Am = { root: 57, minor: true }, G = { root: 55 }, D = { root: 62 }, C = { root: 60 }, Em = { root: 52, minor: true };
  const chords: ChordDef[] = [Am, G, D, Am, C, G, Em, Am, Am, C, D, G, Am, Em, G, Am];

  chords.forEach((c, bar) => {
    const b0 = bar * 4;
    const t = triad(c);
    if (bar % 2 === 0) pushPedal(ev, b0, c.root, 'pad', 0.17);
    pushNote(ev, b0, c.root - 24, 1.5, 0.28, 'bass');
    pushNote(ev, b0 + 2, c.root - 19, 1.2, 0.20, 'bass');
    const lilt = [t[0], t[2], t[1] + 12, t[2], t[0] + 12, t[2], t[1] + 12, t[2]];
    pushRepeated(ev, b0, lilt, 0.5, 0.24, 0.18, 'lute');
    if (bar % 2 === 1) pushRepeated(ev, b0 + 0.25, [t[2] + 12, t[0] + 24, t[1] + 12], 1, 0.18, 0.12, 'dulcimer');
    if (bar % 4 === 0 || bar % 4 === 2) pushDrumHits(ev, b0, [0, 1.5, 2.5], 'frameDrum', 0.09, 44);
  });

  const motifA: Phrase = [
    [0, 69, 0.5], [0.5, 72, 0.5], [1, 74, 1], [2, 76, 0.5], [2.5, 74, 0.5], [3, 72, 1],
    [4, 69, 0.5], [4.5, 67, 0.5], [5, 69, 1], [6, 72, 0.5], [6.5, 74, 0.5], [7, 76, 1],
    [8, 79, 0.5], [8.5, 76, 0.5], [9, 74, 1], [10, 72, 0.5], [10.5, 69, 0.5], [11, 67, 1],
    [12, 69, 0.5], [12.5, 72, 0.5], [13, 74, 1], [14, 72, 0.5], [14.5, 69, 0.5], [15, 69, 1],
  ];
  const motifB: Phrase = [
    [0, 76, 0.5], [0.5, 79, 0.5], [1, 81, 1], [2, 79, 0.5], [2.5, 76, 0.5], [3, 74, 1],
    [4, 72, 0.5], [4.5, 74, 0.5], [5, 76, 1], [6, 79, 0.5], [6.5, 81, 0.5], [7, 84, 1],
    [8, 81, 0.5], [8.5, 79, 0.5], [9, 76, 1], [10, 74, 0.5], [10.5, 72, 0.5], [11, 69, 1],
    [12, 67, 0.5], [12.5, 69, 0.5], [13, 72, 1], [14, 74, 0.5], [14.5, 72, 0.5], [15, 69, 1],
  ];
  pushPhrase(ev, 4, motifA, 0.16, 'pipe');
  pushPhrase(ev, 20, motifA.map(([b, m, d]) => [b, m - 12, d] as Phrase[number]), 0.11, 'reed');
  pushPhrase(ev, 36, motifB, 0.15, 'squareLead');
  pushPhrase(ev, 52, motifA, 0.14, 'pipe');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 92, bars: 16, events: ev };
}

function composeLegacyVale(): Theme {
  const ev: NoteEvent[] = [];
  // Original Eastbrook Vale wilderness theme from before the per-zone soundtrack expansion.
  const Am = { root: 57, minor: true }, C = { root: 60 }, G = { root: 55 };
  const Em = { root: 52, minor: true }, Dmaj = { root: 62 }, F = { root: 53 };
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
      [t[2], t[0] + 12, t[1] + 12].forEach((n, i) => pushNote(ev, b0 + 1 + i * 0.5, n, 0.5, 0.2, 'harp'));
    }
  });

  const motifs: [number, Phrase][] = [
    [4, [[0, 69, 1], [1, 71, 1], [2, 72, 1.5], [3.5, 71, 0.5], [4, 67, 2], [6, 64, 2]]],
    [20, [[0, 76, 1.5], [1.5, 74, 0.5], [2, 72, 1], [3, 71, 1], [4, 69, 3]]],
    [36, [[0, 72, 1], [1, 74, 1], [2, 76, 1.5], [3.5, 74, 0.5], [4, 72, 1], [5, 69, 1], [6, 71, 3]]],
    [52, [[0, 69, 1], [1, 72, 1], [2, 71, 1], [3, 67, 1], [4, 69, 4]]],
  ];
  for (const [start, ph] of motifs) pushPhrase(ev, start, ph, 0.26, 'flute');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 66, bars: 16, events: ev };
}

function composeMarsh(): Theme {
  const ev: NoteEvent[] = [];
  // E aeolian swamp: darker but still old-school, with croaky reed and wood clicks.
  const Em = { root: 52, minor: true }, C = { root: 60 }, D = { root: 62 }, Am = { root: 57, minor: true }, Bm = { root: 59, minor: true };
  const chords: ChordDef[] = [Em, Em, C, D, Em, Am, Bm, Em, C, Em, D, C, Am, Bm, D, Em];

  chords.forEach((c, bar) => {
    const b0 = bar * 4;
    const t = triad(c);
    if (bar % 2 === 0) {
      pushPedal(ev, b0, c.root, 'pad', 0.20);
      pushNote(ev, b0, c.root - 12, 4.1, 0.08, 'choir');
    }
    pushNote(ev, b0, c.root - 24, 1.8, 0.34, 'bass');
    pushNote(ev, b0 + 2.5, c.root - 22, 1, 0.18, 'bass');
    const crawl = [t[0] - 12, t[1] - 12, t[2] - 12, t[1] - 12, t[0], t[1] - 12, t[2] - 12, t[1] - 12];
    pushRepeated(ev, b0, crawl, 0.5, 0.22, 0.14, 'lute');
    if (bar % 2 === 1) pushRepeated(ev, b0 + 0.75, [t[0] + 12, t[1] + 12, t[2] + 12], 1, 0.15, 0.10, 'tinyBell');
    pushDrumHits(ev, b0, [0.5, 1.75, 3.25], 'woodBlock', 0.10, 70);
    if (bar % 4 === 3) pushNote(ev, b0 + 3, 43, 0.25, 0.11, 'frameDrum');
  });

  const reedA: Phrase = [
    [0, 64, 0.5], [0.5, 67, 0.5], [1, 66, 1], [2, 64, 0.5], [2.5, 62, 0.5], [3, 64, 1],
    [4, 67, 0.5], [4.5, 69, 0.5], [5, 67, 1], [6, 64, 0.5], [6.5, 62, 0.5], [7, 59, 1],
    [8, 62, 0.5], [8.5, 64, 0.5], [9, 67, 1], [10, 66, 0.5], [10.5, 64, 0.5], [11, 62, 1],
    [12, 59, 0.5], [12.5, 62, 0.5], [13, 64, 1], [14, 62, 0.5], [14.5, 59, 0.5], [15, 64, 1],
  ];
  const pipeB: Phrase = [
    [0, 76, 0.5], [0.5, 74, 0.5], [1, 71, 1], [2, 72, 0.5], [2.5, 74, 0.5], [3, 76, 1],
    [4, 79, 0.5], [4.5, 76, 0.5], [5, 74, 1], [6, 72, 0.5], [6.5, 71, 0.5], [7, 69, 1],
    [8, 71, 0.5], [8.5, 72, 0.5], [9, 74, 1], [10, 76, 0.5], [10.5, 74, 0.5], [11, 72, 1],
    [12, 71, 0.5], [12.5, 69, 0.5], [13, 67, 1], [14, 66, 0.5], [14.5, 64, 0.5], [15, 64, 1],
  ];
  pushPhrase(ev, 8, reedA, 0.14, 'reed');
  pushPhrase(ev, 24, reedA, 0.11, 'squareLead');
  pushPhrase(ev, 40, pipeB, 0.13, 'pipe');
  pushPhrase(ev, 56, reedA.slice(0, 18), 0.12, 'reed');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 84, bars: 16, events: ev };
}

function composePeaks(): Theme {
  const ev: NoteEvent[] = [];
  // G mixolydian mountain route: quick heroic folk, bright pipe, square counterline.
  const G = { root: 55 }, F = { root: 53 }, C = { root: 60 }, D = { root: 62 }, Em = { root: 52, minor: true };
  const chords: ChordDef[] = [G, F, C, G, D, C, G, F, G, C, D, G, Em, C, D, G];

  chords.forEach((c, bar) => {
    const b0 = bar * 4;
    const t = triad(c);
    pushPedal(ev, b0, c.root, 'choir', 0.09);
    if (bar % 2 === 0) {
      pushNote(ev, b0, c.root - 12, 2, 0.18, 'horn');
      pushNote(ev, b0 + 0.02, c.root - 5, 2, 0.13, 'horn');
    }
    pushNote(ev, b0, c.root - 24, 1.2, 0.36, 'bass');
    pushNote(ev, b0 + 2, c.root - 17, 1, 0.24, 'bass');
    const climb = [t[0], t[1], t[2], t[0] + 12, t[2], t[1], t[0], t[2]];
    pushRepeated(ev, b0, climb, 0.5, 0.16, 0.20, 'dulcimer');
    if (bar % 4 >= 2) pushRepeated(ev, b0 + 0.25, climb.map(n => n - 12), 0.5, 0.16, 0.13, 'lute');
    pushDrumHits(ev, b0, [0, 1, 2, 3], 'frameDrum', 0.10, 46);
  });

  const peakHook: Phrase = [
    [0, 79, 0.5], [0.5, 81, 0.5], [1, 84, 1], [2, 86, 0.5], [2.5, 84, 0.5], [3, 81, 1],
    [4, 79, 0.5], [4.5, 77, 0.5], [5, 79, 1], [6, 81, 0.5], [6.5, 84, 0.5], [7, 86, 1],
    [8, 88, 0.5], [8.5, 86, 0.5], [9, 84, 1], [10, 81, 0.5], [10.5, 79, 0.5], [11, 77, 1],
    [12, 79, 0.5], [12.5, 81, 0.5], [13, 84, 1], [14, 81, 0.5], [14.5, 79, 0.5], [15, 79, 1],
  ];
  const counter: Phrase = [
    [0, 67, 0.5], [0.5, 71, 0.5], [1, 74, 0.5], [1.5, 71, 0.5], [2, 67, 1], [3, 69, 1],
    [4, 71, 0.5], [4.5, 74, 0.5], [5, 76, 0.5], [5.5, 74, 0.5], [6, 71, 1], [7, 67, 1],
    [8, 69, 0.5], [8.5, 71, 0.5], [9, 74, 1], [10, 76, 0.5], [10.5, 74, 0.5], [11, 71, 1],
    [12, 67, 0.5], [12.5, 69, 0.5], [13, 71, 1], [14, 74, 0.5], [14.5, 71, 0.5], [15, 67, 1],
  ];
  pushPhrase(ev, 0, peakHook, 0.16, 'pipe');
  pushPhrase(ev, 16, counter, 0.13, 'squareLead');
  pushPhrase(ev, 32, peakHook, 0.15, 'flute');
  pushPhrase(ev, 48, counter, 0.15, 'horn');
  pushNote(ev, 0, 91, 2.2, 0.09, 'tinyBell');
  pushNote(ev, 32, 91, 2.2, 0.08, 'tinyBell');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 112, bars: 16, events: ev };
}

function composeDungeonFight(
  chords: ChordDef[],
  bpm: number,
  hook: Phrase,
  figureRoot: number,
  opts: {
    mode: 'crypt' | 'sunken' | 'wyrm';
    lead: Inst;
    doubleTime?: boolean;
  },
): Theme {
  const ev: NoteEvent[] = [];
  const bars = chords.length;

  chords.forEach((c, bar) => {
    const b0 = bar * 4;
    const t = triad(c);
    // Keep dungeon writing much more active: ostinato + drums + eerie modal color.
    pushNote(ev, b0, c.root - 24, 4.05, opts.mode === 'wyrm' ? 0.34 : 0.28, 'choir');
    pushNote(ev, b0, c.root - 17, 4.05, 0.20, 'choir');
    pushNote(ev, b0, c.root - 12, 2.1, 0.18, 'strings');
    pushNote(ev, b0 + 2, c.root - 10, 2.1, 0.14, 'strings');
    pushNote(ev, b0, c.root - 24, 0.9, 0.46, 'bass');
    pushNote(ev, b0 + 1.5, c.root - 19, 0.7, 0.28, 'bass');
    pushNote(ev, b0 + 2.5, c.root - 17, 0.7, 0.26, 'bass');

    const ost = opts.doubleTime
      ? [0, 1, 0, 3, 0, 6, 5, 3, 0, 1, 0, 3, 7, 6, 5, 3]
      : [0, 1, 0, 3, 0, 6, 5, 3];
    ost.forEach((s, i) => pushNote(ev, b0 + i * (opts.doubleTime ? 0.25 : 0.5), figureRoot + s, opts.doubleTime ? 0.18 : 0.28, 0.20, i % 2 === 0 ? 'stacc' : opts.lead));

    pushDrumHits(ev, b0, opts.mode === 'crypt' ? [0, 1.5, 2.5, 3.5] : [0, 0.75, 1.5, 2, 2.75, 3.5], 'warDrum', opts.mode === 'wyrm' ? 0.34 : 0.26, 38);
    pushDrumHits(ev, b0, [0.5, 1.25, 2.25, 3.25], 'woodBlock', 0.11, 70);
    if (bar % 2 === 0) {
      pushNote(ev, b0, c.root - 12, 1.1, 0.20, 'horn');
      pushNote(ev, b0 + 0.02, c.root - 5, 1.1, 0.16, 'horn');
    }
    if (bar % 2 === 1) pushRepeated(ev, b0 + 0.25, [t[2] + 12, t[1] + 12, t[0] + 12, t[1] + 12], 0.75, 0.13, 0.12, 'dulcimer');
  });

  // Lead appears twice per loop with a lower response; phrases are original modal fragments.
  pushPhrase(ev, 0, hook, 0.18, opts.lead);
  pushPhrase(ev, bars * 2, hook.map(([b, m, d]) => [b, m - 12, d] as Phrase[number]), 0.12, 'reed');
  for (let b = 0; b < bars * 4; b += 4) {
    if (b % 8 === 0) pushNote(ev, b, figureRoot + 12, 1.6, 0.08, 'tinyBell');
  }

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm, bars, events: ev };
}

/** Hollow Crypt — D phrygian, now a faster skeletal dance rather than ambience. */
function composeDungeonHollowCrypt(): Theme {
  const Dm = { root: 62, minor: true }, Eb = { root: 63 }, Gm = { root: 55, minor: true };
  const Bb = { root: 58 }, A = { root: 57 };
  const hook: Phrase = [
    [0, 74, 0.5], [0.5, 75, 0.5], [1, 74, 0.5], [1.5, 70, 0.5], [2, 69, 1], [3, 74, 1],
    [4, 77, 0.5], [4.5, 75, 0.5], [5, 74, 0.5], [5.5, 70, 0.5], [6, 69, 1], [7, 62, 1],
  ];
  return composeDungeonFight([Dm, Eb, Dm, Gm, Bb, A, Eb, Dm], 128, hook, 62, { mode: 'crypt', lead: 'squareLead' });
}

/** Sunken Bastion — E phrygian, high-BPM flooded fortress chase. */
function composeDungeonSunkenBastion(): Theme {
  const Em = { root: 64, minor: true }, F = { root: 65 }, Am = { root: 57, minor: true };
  const C = { root: 60 }, B = { root: 59 };
  const hook: Phrase = [
    [0, 76, 0.25], [0.25, 77, 0.25], [0.5, 76, 0.5], [1, 72, 0.5], [1.5, 71, 0.5], [2, 76, 0.5], [2.5, 79, 0.5], [3, 77, 1],
    [4, 76, 0.5], [4.5, 72, 0.5], [5, 71, 0.5], [5.5, 67, 0.5], [6, 71, 0.5], [6.5, 72, 0.5], [7, 76, 1],
  ];
  return composeDungeonFight([Em, F, Em, Am, C, B, F, Em], 136, hook, 64, { mode: 'sunken', lead: 'reed', doubleTime: true });
}

/** Gravewyrm Sanctum — B phrygian boss route, fastest and most percussive. */
function composeDungeonGravewyrmSanctum(): Theme {
  const Bm = { root: 59, minor: true }, C = { root: 60 }, Em = { root: 52, minor: true };
  const G = { root: 55 }, Fsm = { root: 54, minor: true };
  const hook: Phrase = [
    [0, 71, 0.25], [0.25, 72, 0.25], [0.5, 71, 0.25], [0.75, 67, 0.25], [1, 66, 0.5], [1.5, 67, 0.5], [2, 71, 0.5], [2.5, 74, 0.5], [3, 72, 1],
    [4, 71, 0.25], [4.25, 72, 0.25], [4.5, 74, 0.5], [5, 78, 0.5], [5.5, 74, 0.5], [6, 72, 0.5], [6.5, 71, 0.5], [7, 66, 1],
  ];
  return composeDungeonFight([Bm, C, Bm, Em, G, Fsm, C, Bm], 152, hook, 59, { mode: 'wyrm', lead: 'squareLead', doubleTime: true });
}

function composeCombat(): Theme {
  const ev: NoteEvent[] = [];
  // percussion + ostinato layer, transposed to the active theme's key at play
  for (let bar = 0; bar < 4; bar++) {
    const b0 = bar * 4;
    pushNote(ev, b0, 38, 1, 0.55, 'timpani');
    pushNote(ev, b0 + 2, 38, 1, 0.4, 'timpani');
    pushNote(ev, b0 + 3.5, 38, 0.5, 0.3, 'timpani');
    // driving staccato eighths: 1-1-b3-1-5-1-b3-4 in semitones from D3
    const steps = [0, 0, 3, 0, 7, 0, 3, 5];
    steps.forEach((s, i) => pushNote(ev, b0 + i * 0.5, 50 + s, 0.4, 0.26, 'stacc'));
    if (bar % 2 === 1) {
      pushNote(ev, b0, 50, 1.6, 0.2, 'horn');
      pushNote(ev, b0 + 0.02, 57, 1.6, 0.16, 'horn');
    }
  }
  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 126, bars: 4, events: ev };
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Director
// ---------------------------------------------------------------------------

const FADE_SECONDS = 2.2;
const LOOKAHEAD = 0.6;
const STORAGE_KEY = 'ev_music_on';

// The combat ostinato is written from D3; transpose it onto each zone's tonal
// center so it never fights the theme underneath:
//   town_eastbrook  0 → D (Eastbrook is D major)
//   town_fenbridge  3 → F
//   town_highwatch  9 → B (B minor)
//   vale  7 → A (vale is A dorian)
//   vale_legacy 7 → A (original vale is A dorian)
//   marsh 2 → E (marsh is E aeolian)
//   peaks 5 → G (peaks is rooted on G in bare fifths)
//   dungeon_hollow_crypt      0 → D phrygian
//   dungeon_sunken_bastion    2 → E phrygian
//   dungeon_gravewyrm_sanctum 9 → B phrygian
const COMBAT_TRANSPOSE: Record<MusicZone, number> = {
  town_eastbrook: 0,
  town_fenbridge: 3,
  town_highwatch: 9,
  vale: 7,
  vale_legacy: 7,
  marsh: 2,
  peaks: 5,
  dungeon_hollow_crypt: 0,
  dungeon_sunken_bastion: 2,
  dungeon_gravewyrm_sanctum: 9,
};

function buildMusicThemes(): Record<string, Theme> {
  return {
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
}

class MusicSynth {
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
      case 'strings': this.strings(when, freq, dur, evt.vel, out); break;
      case 'flute': this.flute(when, freq, dur, evt.vel, out); break;
      case 'harp': this.pluck(when, freq, evt.vel, out, 1.4); break;
      case 'bass': this.pluck(when, freq, evt.vel, out, 0.9, true); break;
      case 'horn': this.horn(when, freq, dur, evt.vel, out); break;
      case 'choir': this.choir(when, freq, dur, evt.vel, out); break;
      case 'bell': this.bell(when, freq, evt.vel, out); break;
      case 'timpani': this.timpani(when, freq, evt.vel, out); break;
      case 'stacc': this.strings(when, freq, Math.min(dur, 0.22), evt.vel, out, 0.02); break;
      case 'pad': this.pad(when, freq, dur, evt.vel, out); break;
      case 'lute': this.lute(when, freq, evt.vel, out); break;
      case 'dulcimer': this.dulcimer(when, freq, evt.vel, out); break;
      case 'frameDrum': this.frameDrum(when, evt.vel, out); break;
      case 'warDrum': this.warDrum(when, evt.vel, out); break;
      case 'reed': this.reed(when, freq, dur, evt.vel, out); break;
      case 'pipe': this.pipe(when, freq, dur, evt.vel, out); break;
      case 'squareLead': this.squareLead(when, freq, dur, evt.vel, out); break;
      case 'woodBlock': this.woodBlock(when, evt.vel, out); break;
      case 'tinyBell': this.tinyBell(when, freq, evt.vel, out); break;
    }
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

  private strings(when: number, freq: number, dur: number, vel: number, out: GainNode, attack = 0.3): void {
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

  private pluck(when: number, freq: number, vel: number, out: GainNode, decay: number, dark = false): void {
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
    o.start(when); o.stop(when + dur + 0.5);
    o2.start(when); o2.stop(when + dur + 0.5);
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

    for (const [ratio, amp, decay] of [[1, 1, 1.8], [2.01, 0.35, 1.1], [3.02, 0.12, 0.7]] as const) {
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
    for (const [ratio, amp, dec] of [[1, 0.16, 1.1], [2.01, 0.06, 0.7], [3.01, 0.025, 0.42]] as const) {
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
    for (let i = 0; i < noiseLen; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / noiseLen, 2.2);
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
    for (let i = 0; i < noiseLen; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / noiseLen, 1.6);
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
    for (const [ratio, amp, dec] of [[1, 0.22, 3.4], [2.0, 0.08, 2.2], [2.76, 0.06, 1.4]] as const) {
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
  private _enabled = (typeof localStorage === 'undefined') ? true : localStorage.getItem(STORAGE_KEY) !== '0';
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
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.masterTarget(), this.ctx.currentTime, on ? 0.4 : 0.7);
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
      try { this.bossElement.currentTime = 0; } catch { /* browser may reject seeking before metadata */ }
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
    }
    else {
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
      .catch(() => { this.bossLoading = false; });
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
    try { this.bossSource.stop(); } catch { /* already stopped */ }
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
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
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
      this.layers[name] = { theme, gain, target: 0, anchor: 0, nextIdx: -1, loopCount: 0, transpose: 0 };
    }
    this.timer = window.setInterval(() => this.tickScheduler(), 110);
  }

  setEnabled(on: boolean): void {
    this._enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    } catch { /* private mode */ }
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
        layer.gain.gain.setTargetAtTime(target, now, fade);
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
      combatLayer.gain.gain.setTargetAtTime(combatTarget, now, inCombat ? 0.35 : FADE_SECONDS / 3);
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
