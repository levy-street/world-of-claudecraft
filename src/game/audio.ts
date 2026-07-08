// Procedural WebAudio sound effects — no audio files.

const SFX_BASE_GAIN = 0.32; // master level at full volume

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private vol = 1; // 0..1, set from the settings menu (applied to the master gain)

  /** Set SFX volume (0..1). Safe before init(); applied when the context exists. */
  setVolume(v: number): void {
    this.vol = Math.min(1, Math.max(0, v));
    if (this.master) this.master.gain.value = SFX_BASE_GAIN * this.vol;
  }

  get volume(): number {
    return this.vol;
  }

  init(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = SFX_BASE_GAIN * this.vol;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  private noise(
    duration: number,
    filterFreq: number,
    gain: number,
    decay = 0.9,
    filterType: BiquadFilterType = 'lowpass',
  ): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration * decay);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, duration);
  }

  private tone(
    freq: number,
    duration: number,
    gain: number,
    type: OscillatorType = 'sine',
    delay = 0,
    slideTo?: number,
  ): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  meleeHit(crit = false): void {
    this.noise(0.12, 900, crit ? 0.5 : 0.3);
    this.tone(110 + Math.random() * 40, 0.08, crit ? 0.3 : 0.16, 'triangle');
    if (crit) this.noise(0.2, 2400, 0.2, 0.6, 'highpass');
  }

  meleeMiss(): void {
    this.noise(0.16, 1800, 0.12, 0.8, 'bandpass');
  }

  hitTaken(): void {
    this.noise(0.1, 500, 0.25);
    this.tone(80, 0.1, 0.2, 'square');
  }

  fire(): void {
    this.noise(0.45, 700, 0.32, 0.8);
    this.tone(160, 0.35, 0.2, 'sawtooth', 0, 60);
  }

  frost(): void {
    this.noise(0.35, 4500, 0.18, 0.7, 'highpass');
    this.tone(1300, 0.3, 0.12, 'sine', 0, 700);
    this.tone(1750, 0.25, 0.08, 'sine', 0.04, 900);
  }

  arcane(): void {
    this.tone(620, 0.22, 0.14, 'sine', 0, 850);
    this.tone(930, 0.22, 0.1, 'sine', 0.05, 1240);
  }

  castStart(): void {
    this.tone(300, 0.2, 0.06, 'sine', 0, 420);
  }

  levelUp(): void {
    const notes = [392, 523, 659, 784, 1046];
    notes.forEach((f, i) => {
      this.tone(f, 0.5, 0.18, 'triangle', i * 0.09);
    });
    this.noise(0.8, 5000, 0.06, 0.95, 'highpass');
  }

  questAccept(): void {
    this.tone(660, 0.18, 0.14, 'triangle');
    this.tone(880, 0.25, 0.14, 'triangle', 0.1);
  }

  questDone(): void {
    [523, 659, 784].forEach((f, i) => {
      this.tone(f, 0.35, 0.16, 'triangle', i * 0.12);
    });
  }

  coin(): void {
    this.tone(2200, 0.1, 0.12, 'square');
    this.tone(2800, 0.14, 0.1, 'square', 0.05);
  }

  lootItem(): void {
    this.noise(0.12, 1200, 0.14, 0.8, 'bandpass');
  }

  death(): void {
    this.tone(220, 1.4, 0.22, 'sawtooth', 0, 55);
    this.noise(1.2, 300, 0.18, 0.95);
  }

  aggro(): void {
    this.tone(140, 0.3, 0.14, 'sawtooth', 0, 90);
    this.noise(0.25, 600, 0.12, 0.8);
  }

  drink(): void {
    [0, 0.25, 0.5].forEach((d) => {
      this.tone(420 + Math.random() * 80, 0.12, 0.08, 'sine', d, 280);
    });
  }

  eat(): void {
    [0, 0.3].forEach(() => {
      this.noise(0.1, 800, 0.1, 0.8, 'bandpass');
    });
  }

  click(): void {
    this.tone(1400, 0.05, 0.08, 'square');
  }

  error(): void {
    this.tone(220, 0.15, 0.1, 'square', 0, 180);
  }

  sheep(): void {
    this.tone(620, 0.4, 0.13, 'sawtooth', 0, 520);
  }

  bagOpen(): void {
    // leather flap + soft clasp
    this.noise(0.09, 1400, 0.16, 0.7);
    this.tone(660, 0.05, 0.06, 'triangle', 0.03);
  }

  bagClose(): void {
    this.noise(0.08, 900, 0.14, 0.7);
    this.tone(440, 0.05, 0.06, 'triangle', 0.01);
  }

  whisper(): void {
    this.tone(1175, 0.09, 0.09, 'sine');
    this.tone(1568, 0.12, 0.07, 'sine', 0.07);
  }

  duelChallenge(): void {
    // war horn: two rising fifths
    this.tone(196, 0.35, 0.2, 'sawtooth');
    this.tone(294, 0.45, 0.2, 'sawtooth', 0.18);
  }

  duelCountdownTick(): void {
    this.tone(880, 0.07, 0.12, 'square');
  }

  duelStart(): void {
    // gong + cymbal wash
    this.tone(220, 0.7, 0.28, 'triangle', 0, 110);
    this.noise(0.4, 3000, 0.14, 0.5, 'highpass');
  }

  duelEnd(): void {
    this.tone(392, 0.18, 0.18, 'triangle');
    this.tone(523, 0.3, 0.18, 'triangle', 0.12);
  }

  // ---- 2v2 Fiesta — bright, arcade-y, dopamine-forward cues ---------------

  // A takedown landed: punchy stinger, brighter the bigger the moment (tier
  // 0 = plain kill … 3 = first blood / shutdown / spree).
  fiestaWord(tier = 0): void {
    const base = [523, 587, 659, 784][Math.min(3, tier)];
    this.tone(base, 0.16, 0.2, 'square');
    this.tone(base * 1.5, 0.22, 0.16, 'triangle', 0.05);
    if (tier >= 2) {
      this.tone(base * 2, 0.3, 0.14, 'triangle', 0.1);
      this.noise(0.35, 5200, 0.1, 0.7, 'highpass');
    }
  }

  // Your team scored a point — quick, satisfying blip (higher when it's yours).
  fiestaScorePing(mine: boolean): void {
    this.tone(mine ? 1320 : 740, 0.08, 0.12, 'square');
    if (mine) this.tone(1760, 0.12, 0.1, 'square', 0.05);
  }

  // A new augment wave drops: triumphant rising fanfare — the party escalates.
  fiestaWave(): void {
    [523, 659, 784, 1046].forEach((f, i) => {
      this.tone(f, 0.4, 0.18, 'triangle', i * 0.08);
    });
    this.noise(0.6, 5000, 0.08, 0.9, 'highpass');
  }

  // Locked in an augment: sparkly power-up swell.
  fiestaAugment(): void {
    this.tone(660, 0.25, 0.16, 'sine', 0, 1100);
    this.tone(990, 0.3, 0.12, 'sine', 0.06, 1480);
    this.noise(0.4, 6000, 0.07, 0.85, 'highpass');
  }

  // You went down — short descending "aww", not punishing.
  fiestaDown(): void {
    this.tone(440, 0.3, 0.16, 'sawtooth', 0, 180);
  }

  // You're back in — quick upward pop.
  fiestaRevive(): void {
    this.tone(523, 0.12, 0.14, 'triangle', 0, 784);
    this.tone(784, 0.18, 0.12, 'triangle', 0.08);
  }
}

export const audio = new GameAudio();
