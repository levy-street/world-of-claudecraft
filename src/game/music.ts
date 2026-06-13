// Procedural orchestral soundtrack — no audio files, pure WebAudio synthesis.
// Inspired by vanilla-WoW zone scoring: a pastoral town theme, a wilderness
// theme per biome (vale, marsh, peaks), a dread-laden dungeon theme, and a
// percussion layer that fades in during combat. Each theme is a composed
// multi-track loop scheduled with a lookahead timer; zone changes crossfade.

export type MusicZone = 'town' | 'vale' | 'marsh' | 'peaks' | 'dungeon';

type Inst = 'strings' | 'flute' | 'harp' | 'horn' | 'choir' | 'bell' | 'timpani' | 'bass' | 'stacc';

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

function composeTown(): Theme {
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

function composeVale(): Theme {
  const ev: NoteEvent[] = [];
  // A dorian, spacious and mysterious
  const Am = { root: 57, minor: true }, C = { root: 60 }, G = { root: 55 };
  const Em = { root: 52, minor: true }, Dmaj = { root: 62 }, F = { root: 53 };
  const chords: ChordDef[] = [Am, Am, C, G, Am, Em, G, Am, Am, C, Dmaj, Am, F, C, Em, Am];

  chords.forEach((c, bar) => {
    const b0 = bar * 4;
    const t = triad(c);
    // deep drone every other bar (overlapping sustains)
    if (bar % 2 === 0) {
      pushNote(ev, b0, c.root - 24, 8.4, 0.4, 'strings');
      pushNote(ev, b0, c.root - 17, 8.4, 0.26, 'strings');
    }
    // soft choir on chord tones
    for (const n of t) pushNote(ev, b0, n - 12, 4.05, 0.16, 'choir');
    // wandering cello
    pushNote(ev, b0, c.root - 12, 1.5, 0.3, 'bass');
    if (bar % 4 === 1) pushNote(ev, b0 + 2, c.root - 5, 1.8, 0.24, 'bass');
    if (bar % 4 === 3) pushNote(ev, b0 + 2.5, c.root - 10, 1.4, 0.22, 'bass');
    // harp glints, sparse
    if (bar % 4 === 2) {
      [t[2], t[0] + 12, t[1] + 12].forEach((n, i) => pushNote(ev, b0 + 1 + i * 0.5, n, 0.5, 0.2, 'harp'));
    }
  });

  // distant flute motifs with long silences
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
  // E aeolian, low and waterlogged — the fen at dusk
  const Em = { root: 52, minor: true }, Am = { root: 57, minor: true };
  const Bm = { root: 59, minor: true }, C = { root: 60 }, G = { root: 55 }, Dmaj = { root: 62 };
  const chords: ChordDef[] = [Em, Em, Am, Em, C, G, Bm, Em, Em, Am, C, Em, Dmaj, Bm, Am, Em];

  chords.forEach((c, bar) => {
    const b0 = bar * 4;
    const t = triad(c);
    // long overlapping low drones every other bar — the marsh breathing
    if (bar % 2 === 0) {
      pushNote(ev, b0, c.root - 24, 8.6, 0.42, 'strings');
      pushNote(ev, b0, c.root - 17, 8.6, 0.22, 'strings');
    }
    // hollow half-light choir: root + fifth only, no third — damp and open
    if (bar % 2 === 0) {
      pushNote(ev, b0, c.root - 12, 4.1, 0.14, 'choir');
      pushNote(ev, b0, c.root - 5, 4.1, 0.1, 'choir');
    }
    // slow cello: root on the downbeat, a sagging step late in some bars
    pushNote(ev, b0, c.root - 12, 2.2, 0.28, 'bass');
    if (bar % 4 === 2) pushNote(ev, b0 + 2.5, c.root - 14, 1.6, 0.2, 'bass');
    // drip-plucks: lone high harp notes at uneven offsets, like water falling
    if (bar % 4 === 1) pushNote(ev, b0 + 1.5, t[2] + 12, 0.5, 0.16, 'harp');
    if (bar % 4 === 3) {
      pushNote(ev, b0 + 0.5, t[0] + 24, 0.5, 0.14, 'harp');
      pushNote(ev, b0 + 2.75, t[1] + 12, 0.5, 0.12, 'harp');
    }
  });

  // a half-heard flute, low in its register, only twice a loop
  const motifs: [number, Phrase][] = [
    [12, [[0, 64, 1.5], [1.5, 67, 0.5], [2, 66, 2], [4, 64, 3]]],
    [44, [[0, 67, 1], [1, 64, 1], [2, 62, 1.5], [3.5, 64, 3]]],
  ];
  for (const [start, ph] of motifs) pushPhrase(ev, start, ph, 0.2, 'flute');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 56, bars: 16, events: ev };
}

function composePeaks(): Theme {
  const ev: NoteEvent[] = [];
  // G with a flat seventh, harmonized in bare fifths (no thirds) —
  // vast, cold, heroic. Roots: G, C, D, F.
  const roots = [55, 55, 60, 55, 62, 60, 55, 53, 55, 60, 62, 55, 53, 60, 62, 55];

  roots.forEach((r, bar) => {
    const b0 = bar * 4;
    // wind pad: open fifth in the choir, swelling across each bar
    pushNote(ev, b0, r, 4.2, 0.15, 'choir');
    pushNote(ev, b0, r + 7, 4.2, 0.12, 'choir');
    if (bar % 2 === 0) pushNote(ev, b0, r + 12, 4.2, 0.08, 'choir');
    // thin high string shimmer on the off bars, an octave above the pad
    if (bar % 2 === 1) pushNote(ev, b0, r + 12, 4.3, 0.14, 'strings');
    // granite bass: root, then the fifth below on the off bars
    pushNote(ev, b0, r - 24, 2.4, 0.4, 'bass');
    if (bar % 2 === 1) pushNote(ev, b0 + 2, r - 17, 1.8, 0.3, 'bass');
    // far-off horn calls in open fifths every fourth bar
    if (bar % 4 === 0) {
      pushNote(ev, b0, r - 12, 3, 0.18, 'horn');
      pushNote(ev, b0 + 0.02, r - 5, 3, 0.14, 'horn');
    }
  });

  // high flute over the wind — thirdless (G A C D F) so the harmony stays cold
  const motifs: [number, Phrase][] = [
    [8, [[0, 79, 2], [2, 81, 2], [4, 86, 3], [7, 84, 1], [8, 86, 4]]],
    [40, [[0, 86, 2], [2, 84, 1], [3, 81, 1], [4, 79, 2], [6, 77, 1], [7, 79, 4]]],
  ];
  for (const [start, ph] of motifs) pushPhrase(ev, start, ph, 0.22, 'flute');

  // two glassy bell glints per loop, on the G bars
  pushNote(ev, 0, 79, 4, 0.12, 'bell');
  pushNote(ev, 32, 79, 4, 0.1, 'bell');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 60, bars: 16, events: ev };
}

function composeDungeon(): Theme {
  const ev: NoteEvent[] = [];
  // D phrygian, dread and stone
  const Dm = { root: 62, minor: true }, Eb = { root: 63 }, Gm = { root: 55, minor: true };
  const Bb = { root: 58 }, Amaj = { root: 57 };
  const chords: ChordDef[] = [Dm, Dm, Eb, Dm, Gm, Bb, Amaj, Dm];

  chords.forEach((c, bar) => {
    const b0 = bar * 4;
    // cavern choir
    pushNote(ev, b0, c.root - 24, 4.3, 0.46, 'choir');
    pushNote(ev, b0, c.root - 17, 4.3, 0.3, 'choir');
    if (bar % 2 === 1) pushNote(ev, b0, c.root - 12, 4.3, 0.18, 'choir');
    // heartbeat timpani
    pushNote(ev, b0, 38, 1, 0.5, 'timpani');
    if (bar % 2 === 1) pushNote(ev, b0 + 2.5, 38, 1, 0.3, 'timpani');
  });
  // tolling bells
  const tolls: [number, number][] = [[0, 74], [8, 69], [16, 77], [24, 69], [28, 74]];
  for (const [b, m] of tolls) pushNote(ev, b, m, 6, 0.2, 'bell');
  // unsettling string figure
  const figure: Phrase = [[0, 62, 0.5], [0.5, 63, 0.5], [1, 62, 1.5]];
  pushPhrase(ev, 10, figure, 0.3, 'stacc');
  pushPhrase(ev, 26, figure, 0.3, 'stacc');

  ev.sort((a, b) => a.beat - b.beat);
  return { bpm: 54, bars: 8, events: ev };
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
// Director
// ---------------------------------------------------------------------------

const FADE_SECONDS = 2.2;
const LOOKAHEAD = 0.6;
const STORAGE_KEY = 'ev_music_on';

// The combat ostinato is written from D3; transpose it onto each zone's tonal
// center so it never fights the theme underneath:
//   town  0 → D (town is D major)
//   vale  7 → A (vale is A dorian; same value the old wilds layer used)
//   marsh 2 → E (marsh is E aeolian; the ostinato becomes E minor pentatonic)
//   peaks 5 → G (peaks is rooted on G in bare fifths — no third to clash with)
//   dungeon 0 → D (dungeon is D phrygian)
const COMBAT_TRANSPOSE: Record<MusicZone, number> = {
  town: 0,
  vale: 7,
  marsh: 2,
  peaks: 5,
  dungeon: 0,
};

export class MusicDirector {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbSend: GainNode | null = null;
  private layers: Record<string, Layer> = {};
  private timer: number | undefined;
  // null until the first update() so the initial state always applies — a
  // 'town' sentinel matched the real starting zone and left spawn silent
  private zone: MusicZone | null = null;
  private combat = false;
  private _enabled = (typeof localStorage === 'undefined') ? true : localStorage.getItem(STORAGE_KEY) !== '0';
  private _vol = 1; // 0..1 volume, set from the settings menu

  get enabled(): boolean {
    return this._enabled;
  }

  // master gain target given the enabled flag and volume (base level 0.15)
  private masterTarget(): number {
    return this._enabled ? 0.15 * this._vol : 0;
  }

  /** Set music volume (0..1). Safe before init(); applied to the master gain. */
  setVolume(v: number): void {
    this._vol = Math.min(1, Math.max(0, v));
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.masterTarget(), this.ctx.currentTime, 0.2);
    }
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
    this.master.connect(ctx.destination);

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

    const themes: Record<string, Theme> = {
      town: composeTown(),
      vale: composeVale(),
      marsh: composeMarsh(),
      peaks: composePeaks(),
      dungeon: composeDungeon(),
      combat: composeCombat(),
    };
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
      // the zone theme keeps playing (quieter) under the combat layer
      const target = name === zone ? (inCombat ? 0.45 : 1) : 0;
      if (layer.target !== target) {
        layer.target = target;
        layer.gain.gain.setTargetAtTime(target, now, FADE_SECONDS / 3);
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
      const audible = layer.target > 0.001 || layer.gain.gain.value > 0.004;
      if (!audible) {
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
          this.playNote(evt, when, spb, layer);
        }
        layer.nextIdx++;
        if (layer.nextIdx >= layer.theme.events.length) {
          layer.nextIdx = 0;
          layer.loopCount++;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Instruments
  // -------------------------------------------------------------------------

  private playNote(evt: NoteEvent, when: number, spb: number, layer: Layer): void {
    const ctx = this.ctx!;
    const freq = mtof(evt.midi + layer.transpose);
    const dur = Math.max(0.1, evt.dur * spb);
    const out = layer.gain;
    switch (evt.inst) {
      case 'strings': this.strings(ctx, when, freq, dur, evt.vel, out); break;
      case 'flute': this.flute(ctx, when, freq, dur, evt.vel, out); break;
      case 'harp': this.pluck(ctx, when, freq, evt.vel, out, 1.4); break;
      case 'bass': this.pluck(ctx, when, freq, evt.vel, out, 0.9, true); break;
      case 'horn': this.horn(ctx, when, freq, dur, evt.vel, out); break;
      case 'choir': this.choir(ctx, when, freq, dur, evt.vel, out); break;
      case 'bell': this.bell(ctx, when, freq, evt.vel, out); break;
      case 'timpani': this.timpani(ctx, when, freq, evt.vel, out); break;
      case 'stacc': this.strings(ctx, when, freq, Math.min(dur, 0.22), evt.vel, out, 0.02); break;
    }
  }

  private adsr(ctx: AudioContext, when: number, dur: number, peak: number, attack: number, release: number): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    g.gain.setValueAtTime(peak, Math.max(when + attack, when + dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + release);
    return g;
  }

  private strings(ctx: AudioContext, when: number, freq: number, dur: number, vel: number, out: GainNode, attack = 0.3): void {
    const g = this.adsr(ctx, when, dur, vel * 0.16, attack, 0.7);
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

  private flute(ctx: AudioContext, when: number, freq: number, dur: number, vel: number, out: GainNode): void {
    const g = this.adsr(ctx, when, dur, vel * 0.3, 0.07, 0.22);
    g.connect(out);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = freq;
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    // gentle vibrato that blooms after the attack
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

  private pluck(ctx: AudioContext, when: number, freq: number, vel: number, out: GainNode, decay: number, dark = false): void {
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

  private horn(ctx: AudioContext, when: number, freq: number, dur: number, vel: number, out: GainNode): void {
    const g = this.adsr(ctx, when, dur, vel * 0.2, 0.09, 0.3);
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

  private choir(ctx: AudioContext, when: number, freq: number, dur: number, vel: number, out: GainNode): void {
    const g = this.adsr(ctx, when, dur, vel * 0.13, 0.7, 1.1);
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

  private bell(ctx: AudioContext, when: number, freq: number, vel: number, out: GainNode): void {
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

  private timpani(ctx: AudioContext, when: number, freq: number, vel: number, out: GainNode): void {
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
    // mallet thump
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

export const music = new MusicDirector();
