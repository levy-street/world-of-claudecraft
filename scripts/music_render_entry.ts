// Page-side entry for scripts/render_music.mjs: renders a procedural music
// theme from src/game/music.ts through an OfflineAudioContext using the exact
// same synth voices and mix chain (master gain, compressor, hall reverb) the
// in-game MusicDirector builds, so a saved WAV is the true in-game sound.
// Bundled with esbuild (iife) and injected into a headless browser page.
import { buildMusicThemes, MusicSynth, THEME_TRIM } from '../src/game/music';

interface RenderOpts {
  seconds?: number; // target length; rounded to whole loops of the theme
  transpose?: number; // semitones, mirrors Layer.transpose (combat layer)
  gain?: number; // post-render makeup gain for audition (in-game path unchanged)
}

interface RenderResult {
  sampleRate: number;
  seconds: number;
  loopSeconds: number;
  loops: number;
  bpm: number;
  peak: number; // linear 0..1 post-mix peak
  pcm16: string; // base64 of little-endian mono Int16 samples
}

async function renderMusicTheme(name: string, opts: RenderOpts = {}): Promise<RenderResult> {
  const themes = buildMusicThemes();
  const theme = themes[name];
  if (!theme) throw new Error(`unknown theme "${name}" (have: ${Object.keys(themes).join(', ')})`);

  const sampleRate = 44100;
  const spb = 60 / theme.bpm;
  const loopBeats = theme.bars * 4;
  const loopSeconds = loopBeats * spb;
  const target = opts.seconds ?? Math.max(loopSeconds * 2, 60);
  const loops = Math.max(1, Math.round(target / loopSeconds));
  const tail = 3; // let reverb and releases ring out
  const lead = 0.05;
  const seconds = lead + loops * loopSeconds + tail;
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);

  // Mirror MusicDirector.init(): master (0.15) -> compressor -> destination,
  // plus the generated 2.6s hall impulse on a 0.55 send.
  const master = ctx.createGain();
  master.gain.value = 0.15;
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 18;
  compressor.ratio.value = 2.2;
  compressor.attack.value = 0.015;
  compressor.release.value = 0.25;
  master.connect(compressor);
  compressor.connect(ctx.destination);

  const irSeconds = 2.6;
  const irLen = Math.floor(ctx.sampleRate * irSeconds);
  const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < irLen; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / irLen) ** 2.4;
    }
  }
  const reverb = ctx.createConvolver();
  reverb.buffer = ir;
  const reverbSend = ctx.createGain();
  reverbSend.gain.value = 0.55;
  reverbSend.connect(reverb);
  reverb.connect(master);

  const layerGain = ctx.createGain();
  layerGain.gain.value = THEME_TRIM[name] ?? 1;
  layerGain.connect(master);
  layerGain.connect(reverbSend);

  const synth = new MusicSynth(ctx);
  const layer = { gain: layerGain, transpose: opts.transpose ?? 0 };
  for (let loop = 0; loop < loops; loop++) {
    for (const evt of theme.events) {
      synth.playNote(evt, lead + (loop * loopBeats + evt.beat) * spb, spb, layer);
    }
  }

  const buf = await ctx.startRendering();
  const data = buf.getChannelData(0);
  const gain = opts.gain ?? 4.5; // about +13 dB: audible outside the game, no trimmed theme clips
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]) * gain;
    if (a > peak) peak = a;
  }
  const pcm = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i] * gain));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let b64 = '';
  const CHUNK = 30000; // multiple of 3 so concatenated base64 chunks stay valid
  for (let i = 0; i < bytes.length; i += CHUNK) {
    b64 += btoa(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return {
    sampleRate,
    seconds,
    loopSeconds,
    loops,
    bpm: theme.bpm,
    peak,
    pcm16: b64,
  };
}

(window as unknown as { renderMusicTheme: typeof renderMusicTheme }).renderMusicTheme =
  renderMusicTheme;
(window as unknown as { musicThemeNames: string[] }).musicThemeNames = Object.keys(
  buildMusicThemes(),
);
(window as unknown as { __ready: boolean }).__ready = true;
