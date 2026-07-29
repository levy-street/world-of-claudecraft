// Measures each realm HDRI's ambient energy: the number that decides how bright
// that realm's NIGHT is, and the source of REALM_SKY_IRRADIANCE in
// src/render/day_night_core.ts.
//
// Why this exists. Night brightness per realm looked arbitrary: the Vale and
// Thornpeak read as night while Willowfen, Palmreach and Evergarden read as an
// overcast afternoon, at the identical ambient scale. The cause is not the
// grade at all, it is that the IBL is the realm's own sky and those skies are
// not remotely equal in energy: measured, they span twenty-two fold. Scaling
// each realm's IBL toward a reference at night is what equalizes it, and this
// is where those numbers come from, so they are auditable rather than guessed.
//
// The IBL is diffuse irradiance, so what matters is the SOLID-ANGLE-WEIGHTED
// mean radiance over the sphere: a latlong row near the pole covers far less
// sky than one at the horizon. sky.ts's own gain and clamp are applied exactly
// as the dome shader applies them, so the measurement is of what the renderer
// actually integrates, not of the raw file.
//
//   node scripts/hdri_irradiance.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'env');

/** Minimal Radiance .hdr (RGBE) reader: header, then RLE or flat scanlines. */
function readHdr(buf) {
  let pos = 0;
  const line = () => {
    let s = '';
    while (buf[pos] !== 0x0a) s += String.fromCharCode(buf[pos++]);
    pos++;
    return s;
  };
  if (!line().startsWith('#?')) throw new Error('not radiance');
  // Radiance headers run to a blank line, then one resolution line.
  while (line() !== '') {
    // header key=value rows; none of them affect the irradiance measurement
  }
  const dims = line().trim().split(/\s+/); // -Y H +X W
  const height = Number(dims[1]);
  const width = Number(dims[3]);
  const data = new Float32Array(width * height * 3);

  const rgbe = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    // new-style RLE scanline?
    if (width >= 8 && width < 32768 && buf[pos] === 2 && buf[pos + 1] === 2) {
      pos += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < width) {
          let count = buf[pos++];
          if (count > 128) {
            const value = buf[pos++];
            count -= 128;
            for (let i = 0; i < count; i++) rgbe[x++ * 4 + c] = value;
          } else {
            for (let i = 0; i < count; i++) rgbe[x++ * 4 + c] = buf[pos++];
          }
        }
      }
    } else {
      for (let x = 0; x < width; x++) {
        rgbe[x * 4 + 0] = buf[pos++];
        rgbe[x * 4 + 1] = buf[pos++];
        rgbe[x * 4 + 2] = buf[pos++];
        rgbe[x * 4 + 3] = buf[pos++];
      }
    }
    for (let x = 0; x < width; x++) {
      const e = rgbe[x * 4 + 3];
      const f = e === 0 ? 0 : 2 ** (e - 136); // 2^(e-128) / 256
      const o = (y * width + x) * 3;
      data[o] = rgbe[x * 4] * f;
      data[o + 1] = rgbe[x * 4 + 1] * f;
      data[o + 2] = rgbe[x * 4 + 2] * f;
    }
  }
  return { width, height, data };
}

/** Solid-angle-weighted mean radiance, with sky.ts's gain and clamp applied. */
function irradiance(img, gain, clamp) {
  let sum = 0;
  let weight = 0;
  for (let y = 0; y < img.height; y++) {
    // latlong: row y maps to polar angle theta, weight by sin(theta)
    const theta = ((y + 0.5) / img.height) * Math.PI;
    const w = Math.sin(theta);
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 3;
      const r = Math.min(img.data[o] * gain, clamp);
      const g = Math.min(img.data[o + 1] * gain, clamp);
      const b = Math.min(img.data[o + 2] * gain, clamp);
      sum += (0.2126 * r + 0.7152 * g + 0.0722 * b) * w;
      weight += w;
    }
  }
  return sum / weight;
}

const TUNE = {
  vale: [0.6, 2.0],
  marsh: [0.6, 2.2],
  peaks: [0.48, 1.7],
  dusk: [0.55, 2.2],
  ember: [0.5, 2.0],
  frost: [0.5, 2.0],
  amber: [0.55, 2.2],
  fen: [0.6, 2.6],
  night: [0.55, 2.2],
  haunt: [0.6, 1.8],
  jungle: [0.62, 2.6],
  garden: [0.6, 2.6],
  gale: [0.6, 2.6],
  farshore: [0.6, 2.6],
};
const HDRI = {
  vale: 'vale_day',
  marsh: 'marsh_overcast',
  peaks: 'peaks_dawn',
  dusk: 'hollow_dusk',
  ember: 'ember_storm',
  frost: 'frost_twilight',
  amber: 'amber_sunset',
  fen: 'fen_day',
  night: 'nightbloom_dream',
  haunt: 'wraithwood_gloom',
  jungle: 'palmreach_day',
  garden: 'evergarden_day',
  gale: 'galecrest_day',
  farshore: 'farshore_day',
};

const rows = [];
for (const [biome, file] of Object.entries(HDRI)) {
  const img = readHdr(readFileSync(path.join(DIR, `${file}_1k.hdr`)));
  const [gain, clamp] = TUNE[biome];
  rows.push({ biome, file, E: irradiance(img, gain, clamp) });
}
rows.sort((a, b) => a.E - b.E);
// The Vale is the reference: Eastbrook's night reads correctly, and every realm
// measured at or below it also reads correctly, while every realm above it
// reads too bright. That split is what makes the Vale the natural datum.
const reference = rows.find((r) => r.biome === 'vale').E;
console.log('reference (vale_day):', reference.toFixed(4), '\n');
console.log('realm      hdri                   irradiance   vs vale   night IBL scale');
for (const r of rows) {
  console.log(
    r.biome.padEnd(10),
    r.file.padEnd(22),
    r.E.toFixed(4).padStart(10),
    `${(r.E / reference).toFixed(2)}x`.padStart(9),
    Math.min(1, reference / r.E)
      .toFixed(3)
      .padStart(17),
  );
}
console.log('\npaste into REALM_SKY_IRRADIANCE (src/render/day_night_core.ts):');
for (const r of rows.slice().sort((a, b) => a.biome.localeCompare(b.biome))) {
  console.log(`  ${r.biome}: ${r.E.toFixed(4)}, // ${r.file}`);
}
