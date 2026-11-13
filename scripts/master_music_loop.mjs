// Masters one generated music take into a shipping loop for
// public/audio/music/: finds a seamless loop (a head point and a tail point
// whose sound and rhythm match, before any generated fade-out), crossfades the
// tail over the head so the media element's loop jump lands mid-phrase,
// matches the loudness of the existing boss cues, and encodes the repo's music
// format (MP3, 48 kHz stereo, 192 kbps). Offline asset tooling; FFmpeg comes
// from ffmpeg-static, PATH is the fallback.
//
//   node scripts/master_music_loop.mjs <in> <out.mp3> [--lufs -14] [--fade 3]
//        [--min-length 90] [--search 70] [--head-search 12] [--length-bias 0.5] [--seam <seam.mp3>]
//
// --seam also writes the last 8 s of the loop followed by its first 8 s, the
// one stretch a listener needs to judge the loop jump.
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const SR = 48000;
const HOP = 1024; // about 21 ms
const FFT = 2048;
const BANDS = 24;

function ffmpegPath() {
  try {
    return require('ffmpeg-static');
  } catch {
    return 'ffmpeg';
  }
}

export function decodeStereo(file) {
  const raw = execFileSync(
    ffmpegPath(),
    ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '2', '-ar', String(SR), '-f', 'f32le', '-'],
    { maxBuffer: 1 << 30 },
  );
  const inter = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  const n = inter.length / 2;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    l[i] = inter[2 * i];
    r[i] = inter[2 * i + 1];
  }
  return { l, r, n };
}

function fftMag(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** Per hop: log band energies (timbre and harmony), frame RMS and spectral flux (rhythm). */
export function features(mono) {
  const frames = Math.floor((mono.length - FFT) / HOP);
  const edges = [];
  for (let b = 0; b <= BANDS; b++) {
    // Log-spaced bands from 40 Hz to 16 kHz.
    const hz = 40 * (16000 / 40) ** (b / BANDS);
    edges.push(Math.max(1, Math.round((hz / SR) * FFT)));
  }
  const bands = new Float32Array(frames * BANDS);
  const rms = new Float32Array(frames);
  const flux = new Float32Array(frames);
  const win = new Float32Array(FFT);
  for (let i = 0; i < FFT; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT);
  const re = new Float64Array(FFT);
  const im = new Float64Array(FFT);
  const chroma = new Float32Array(frames * 12);
  // Pitch class of each FFT bin from 60 Hz to 2.5 kHz (the harmony's range).
  const binClass = new Int8Array(FFT / 2).fill(-1);
  for (let k = 1; k < FFT / 2; k++) {
    const hz = (k * SR) / FFT;
    if (hz < 60 || hz > 2500) continue;
    binClass[k] = ((Math.round(12 * Math.log2(hz / 440)) % 12) + 12) % 12;
  }
  let prev = new Float32Array(FFT / 2);
  for (let f = 0; f < frames; f++) {
    const s = f * HOP;
    let e = 0;
    for (let i = 0; i < FFT; i++) {
      const v = mono[s + i];
      e += v * v;
      re[i] = v * win[i];
      im[i] = 0;
    }
    rms[f] = Math.sqrt(e / FFT);
    fftMag(re, im);
    const mag = new Float32Array(FFT / 2);
    let fl = 0;
    for (let k = 0; k < FFT / 2; k++) {
      mag[k] = Math.hypot(re[k], im[k]);
      const d = Math.log1p(mag[k]) - Math.log1p(prev[k]);
      if (d > 0) fl += d;
    }
    flux[f] = fl;
    prev = mag;
    for (let b = 0; b < BANDS; b++) {
      let sum = 0;
      for (let k = edges[b]; k < Math.max(edges[b] + 1, edges[b + 1]); k++) sum += mag[k] * mag[k];
      bands[f * BANDS + b] = Math.log10(sum + 1e-9);
    }
    for (let k = 0; k < FFT / 2; k++) {
      if (binClass[k] >= 0) chroma[f * 12 + binClass[k]] += mag[k] * mag[k];
    }
  }
  const smooth = Math.round((0.5 * SR) / HOP);
  return {
    frames,
    rms,
    flux,
    bands: movingAverage(bands, BANDS, frames, smooth),
    chroma: movingAverage(chroma, 12, frames, smooth),
  };
}

/** Each of `dims` columns averaged over the `span` hops starting at each hop. */
function movingAverage(data, dims, frames, span) {
  const out = new Float32Array(data.length);
  for (let d = 0; d < dims; d++) {
    let acc = 0;
    for (let f = frames - 1; f >= 0; f--) {
      acc += data[f * dims + d];
      if (f + span < frames) acc -= data[(f + span) * dims + d];
      out[f * dims + d] = acc / Math.min(span, frames - f);
    }
  }
  return out;
}

function cosine(v, a, b, dims) {
  let num = 0;
  let na = 0;
  let nb = 0;
  for (let k = 0; k < dims; k++) {
    const x = v[a * dims + k];
    const y = v[b * dims + k];
    num += x * y;
    na += x * x;
    nb += y * y;
  }
  return num / Math.sqrt(na * nb + 1e-18);
}

function db(x) {
  return 20 * Math.log10(x + 1e-9);
}

/** Smoothed loudness per hop over a one-second window, in dB. */
export function loudnessCurve(rms) {
  const w = Math.round(SR / HOP);
  const out = new Float32Array(rms.length);
  let acc = 0;
  for (let i = 0; i < rms.length; i++) {
    acc += rms[i] * rms[i];
    if (i >= w) acc -= rms[i - w] * rms[i - w];
    out[i] = db(Math.sqrt(Math.max(0, acc) / Math.min(i + 1, w)));
  }
  return out;
}

/**
 * How alike the W hops after a and after b sound: rhythm (the onset curves
 * correlated hop by hop, so the beats line up), harmony (the half-second
 * chroma at four points) and timbre (the half-second band levels at the same
 * points, 1 meaning 10 dB apart on average). Higher is better.
 */
export function seamScore(ft, a, b, w) {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < w; i++) {
    ma += ft.flux[a + i];
    mb += ft.flux[b + i];
  }
  ma /= w;
  mb /= w;
  let num = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < w; i++) {
    const x = ft.flux[a + i] - ma;
    const y = ft.flux[b + i] - mb;
    num += x * y;
    va += x * x;
    vb += y * y;
  }
  const rhythm = num / Math.sqrt(va * vb + 1e-12);
  let harmony = 0;
  let dist = 0;
  const points = 4;
  for (let p = 0; p < points; p++) {
    const o = Math.floor((p * w) / points);
    harmony += cosine(ft.chroma, a + o, b + o, 12);
    let d2 = 0;
    for (let k = 0; k < BANDS; k++) {
      const d = ft.bands[(a + o) * BANDS + k] - ft.bands[(b + o) * BANDS + k];
      d2 += d * d;
    }
    dist += Math.sqrt(d2 / BANDS);
  }
  return rhythm + harmony / points - (0.5 * dist) / points;
}

export function findLoop(ft, opts) {
  const sec = SR / HOP;
  const loud = loudnessCurve(ft.rms);
  const sorted = Array.from(loud).sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length * 0.6)];
  const fadeHops = Math.round(opts.fade * sec);
  const w = Math.round(4 * sec);
  // The usable end: the last hop still near the track's body loudness (a
  // generated take nearly always fades or rings out at the end).
  let end = ft.frames - 1;
  while (end > 0 && loud[end] < median - 6) end--;
  const cMax = end - fadeHops - w;
  // The head: the first hop near the body loudness, give or take a breath, so a
  // fade-in never opens the fight.
  let h0 = 0;
  while (h0 < ft.frames && loud[h0] < median - 9) h0++;
  h0 = Math.max(0, h0 - Math.round(0.25 * sec));
  const minLen = Math.round(opts.minLength * sec);
  const cMin = Math.max(h0 + minLen, cMax - Math.round(opts.search * sec));
  if (cMin >= cMax) throw new Error('take too short for a loop of the asked length');
  // A longer loop wears better over a long fight, so a later cut earns a small
  // bonus over an equally good earlier one.
  const span = Math.max(1, cMax - cMin);
  const lengthBonus = (c) => opts.lengthBias * ((c - cMin) / span);
  let best = { score: -Infinity, raw: 0, h: h0, c: cMax };
  const hSpan = Math.round(opts.headSearch * sec);
  const consider = (h, c) => {
    const raw = seamScore(ft, c, h, w);
    const score = raw + lengthBonus(c);
    if (score > best.score) best = { score, raw, h, c };
  };
  for (let h = h0; h <= h0 + hSpan; h += 2) {
    for (let c = cMin; c <= cMax; c += 2) consider(h, c);
  }
  const coarse = best;
  for (let h = Math.max(0, coarse.h - 2); h <= coarse.h + 2; h++) {
    for (let c = coarse.c - 2; c <= Math.min(cMax, coarse.c + 2); c++) consider(h, c);
  }
  return { ...best, end, h0, median };
}

function render(src, headS, cutS, fadeS) {
  const len = cutS - headS;
  const fade = fadeS;
  const out = { l: new Float32Array(len), r: new Float32Array(len) };
  for (const ch of ['l', 'r']) {
    const x = src[ch];
    const y = out[ch];
    for (let i = 0; i < len; i++) y[i] = x[headS + i];
    // Equal-power crossfade: the tail past the cut fades out over the head.
    for (let i = 0; i < fade; i++) {
      const t = (i + 0.5) / fade;
      const gin = Math.sin((t * Math.PI) / 2);
      const gout = Math.cos((t * Math.PI) / 2);
      y[i] = x[headS + i] * gin + x[cutS + i] * gout;
    }
  }
  return out;
}

function encode(pcm, outFile, gainDb) {
  const n = pcm.l.length;
  const inter = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    inter[2 * i] = pcm.l[i];
    inter[2 * i + 1] = pcm.r[i];
  }
  execFileSync(
    ffmpegPath(),
    [
      '-v',
      'error',
      '-y',
      '-f',
      'f32le',
      '-ar',
      String(SR),
      '-ac',
      '2',
      '-i',
      '-',
      '-af',
      `volume=${gainDb.toFixed(2)}dB,alimiter=limit=0.891:attack=5:release=60:level=false`,
      '-ar',
      String(SR),
      '-c:a',
      'libmp3lame',
      '-b:a',
      '192k',
      '-map_metadata',
      '-1',
      outFile,
    ],
    { input: Buffer.from(inter.buffer), maxBuffer: 1 << 30 },
  );
}

function measureLufs(file) {
  const r = spawnSync(
    ffmpegPath(),
    ['-hide_banner', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const text = r.stderr ?? '';
  const summary = text.slice(text.lastIndexOf('Summary:'));
  const i = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
  const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]);
  return { i, peak };
}

function parseArgs(argv) {
  const opts = {
    lufs: -14,
    fade: 3,
    minLength: 90,
    search: 70,
    headSearch: 12,
    lengthBias: 0.5,
    seam: null,
    files: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lufs') opts.lufs = Number(argv[++i]);
    else if (a === '--fade') opts.fade = Number(argv[++i]);
    else if (a === '--min-length') opts.minLength = Number(argv[++i]);
    else if (a === '--seam') opts.seam = argv[++i];
    else if (a === '--search') opts.search = Number(argv[++i]);
    else if (a === '--head-search') opts.headSearch = Number(argv[++i]);
    else if (a === '--length-bias') opts.lengthBias = Number(argv[++i]);
    else opts.files.push(a);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [inFile, outFile] = opts.files;
  if (!inFile || !outFile) {
    console.error(
      'usage: master_music_loop.mjs <in> <out.mp3> [--lufs -14] [--fade 3] [--min-length 90] [--seam f]',
    );
    process.exit(1);
  }
  const src = decodeStereo(inFile);
  const mono = new Float32Array(src.n);
  for (let i = 0; i < src.n; i++) mono[i] = 0.5 * (src.l[i] + src.r[i]);
  const ft = features(mono);
  const loop = findLoop(ft, opts);
  const headS = loop.h * HOP;
  const cutS = loop.c * HOP;
  const pcm = render(src, headS, cutS, Math.round(opts.fade * SR));
  // First pass at unity gain to measure, then the gain that lands the target.
  encode(pcm, outFile, 0);
  const before = measureLufs(outFile);
  encode(pcm, outFile, opts.lufs - before.i);
  const after = measureLufs(outFile);
  if (opts.seam) {
    const n = pcm.l.length;
    const k = 8 * SR;
    const seam = { l: new Float32Array(2 * k), r: new Float32Array(2 * k) };
    for (const ch of ['l', 'r']) {
      seam[ch].set(pcm[ch].subarray(n - k), 0);
      seam[ch].set(pcm[ch].subarray(0, k), k);
    }
    encode(seam, opts.seam, opts.lufs - before.i);
  }
  console.log(
    JSON.stringify({
      in: inFile,
      out: outFile,
      headSeconds: +(headS / SR).toFixed(3),
      cutSeconds: +(cutS / SR).toFixed(3),
      loopSeconds: +((cutS - headS) / SR).toFixed(2),
      usableEndSeconds: +((loop.end * HOP) / SR).toFixed(2),
      seamScore: +loop.raw.toFixed(3),
      lufs: after.i,
      peak: after.peak,
    }),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[Error]', err.message);
    process.exit(1);
  });
}
