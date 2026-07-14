// Radical "skin suit" atlas generator. Turns a class base body atlas into a
// glossy form-fitting suit by GRADIENT-MAPPING its luminance onto a themed
// color ramp: the original hues are discarded and replaced by one uniform
// material whose form is defined purely by shading, which reads as a skin suit
// (latex / chrome / bio). A per-model themed ramp keeps the set cohesive while
// making each class distinct. Pure sharp raw-pixel work, no external services.
//
// Player skins are texture swaps on the SAME class rig (same UVs), so a gradient
// map is UV-safe by construction: every pixel keeps its position, only its color
// changes. This is the most radical change possible within the swap-atlas system.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Ramp stops are { t: 0..1 luminance, c: [r,g,b] 0..255 }, sorted by t.
// gamma shapes contrast (<1 lifts mids), sheen adds a white specular blow-out on
// the brightest pixels for a wet/glossy suit highlight.
function lerp(a, b, u) {
  return a + (b - a) * u;
}

function sampleRamp(ramp, t) {
  if (t <= ramp[0].t) return ramp[0].c;
  if (t >= ramp[ramp.length - 1].t) return ramp[ramp.length - 1].c;
  for (let i = 1; i < ramp.length; i++) {
    if (t <= ramp[i].t) {
      const a = ramp[i - 1];
      const b = ramp[i];
      const u = (t - a.t) / (b.t - a.t || 1);
      return [lerp(a.c[0], b.c[0], u), lerp(a.c[1], b.c[1], u), lerp(a.c[2], b.c[2], u)];
    }
  }
  return ramp[ramp.length - 1].c;
}

/** Gradient-map a base atlas onto a themed ramp. Preserves alpha. */
export async function gradientMapAtlas(basePath, outPath, theme, { size = 1024 } = {}) {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(basePath)
    .resize(size, size)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels; // 4 (RGBA)
  const out = Buffer.alloc(data.length);
  const gamma = theme.gamma ?? 1;
  const sheen = theme.sheen ?? 0;
  const sheenStart = theme.sheenStart ?? 0.82;
  for (let i = 0; i < data.length; i += ch) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = ch === 4 ? data[i + 3] : 255;
    // Perceptual luminance, normalized, gamma-shaped.
    let L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    L = L ** gamma;
    let [cr, cg, cb] = sampleRamp(theme.ramp, L);
    if (sheen > 0 && L > sheenStart) {
      const s = ((L - sheenStart) / (1 - sheenStart)) * sheen;
      cr = lerp(cr, 255, s);
      cg = lerp(cg, 255, s);
      cb = lerp(cb, 255, s);
    }
    out[i] = Math.max(0, Math.min(255, Math.round(cr)));
    out[i + 1] = Math.max(0, Math.min(255, Math.round(cg)));
    out[i + 2] = Math.max(0, Math.min(255, Math.round(cb)));
    if (ch === 4) out[i + 3] = a;
  }
  mkdirSync(dirname(outPath), { recursive: true });
  await sharp(out, { raw: { width: info.width, height: info.height, channels: ch } })
    .png()
    .toFile(outPath);
  return outPath;
}

// Per-model Tripo texture prompts for the REAL-generation path
// (skinset --set <name> --tripo). Each describes an armor/robe material fitting
// the class + the set theme; Tripo re-textures the class model from it and the
// pipeline composites the parts into a drop-in atlas (lib/tripo_skin.mjs). These
// replace the procedural gradient-map look with genuine AI-painted skins in the
// same registered slots.
export const SUIT_PROMPTS = {
  prismatic: {
    knight:
      'molten obsidian plate armor with glowing orange lava cracks and ember glow, dark fantasy',
    paladin: 'radiant golden holy plate armor, gleaming polished gold, warm white light, ornate',
    ranger: 'venomous dark green leather armor, toxic acid-green glow, hooded forest scout',
    rogue: 'glossy void-purple leather armor, violet and magenta sheen, shadowy assassin',
    mage: 'arcane frost robes, deep blue crystalline fabric, glowing cyan magical runes',
    barbarian: 'storm cobalt fur and hide armor, crackling electric blue lightning, tribal',
    druid: 'verdant emerald bark armor, living wood and leaves, glowing amber nature magic',
  },
  chrome: {
    knight: 'liquid chrome steel plate armor, polished mirror metal, faint red rim light',
    paladin: 'black chrome armor with gold trim, glossy dark metal, gold highlights',
    ranger: 'brushed steel armor, cool metallic surfaces, faint green rim glow',
    rogue: 'dark liquid chrome leather armor, violet metallic sheen, sleek',
    mage: 'silver chrome robes, icy blue metallic highlights, reflective',
    barbarian: 'gunmetal chrome hide armor, electric blue metal rim, rugged',
    druid: 'chromed bark armor, metallic green rim light, silvered antlers',
  },
};

// Class MODELS (7) and the class visual keys that share each (9 classes). The
// three caster classes share the mage model+atlas, so they share its suit.
export const MODEL_CLASSES = {
  knight: ['warrior'],
  paladin: ['paladin'],
  ranger: ['hunter'],
  rogue: ['rogue'],
  mage: ['priest', 'mage', 'warlock'],
  barbarian: ['shaman'],
  druid: ['druid'],
};

// The "Prismatic Vanguard" set: one glossy skin-suit theme per class model,
// each a 3 or 4 stop ramp from a near-black shadow through the class hue to a
// bright rim, plus a wet sheen. Cohesive line, distinct identity per model.
export const SUIT_SETS = {
  prismatic: {
    label: 'Prismatic Vanguard',
    suffix: 'suit_prismatic',
    themes: {
      // warrior: molten obsidian (black -> crimson -> ember gold)
      knight: {
        gamma: 0.9,
        sheen: 0.7,
        ramp: [
          { t: 0.0, c: [10, 8, 10] },
          { t: 0.45, c: [90, 20, 24] },
          { t: 0.75, c: [210, 70, 40] },
          { t: 1.0, c: [255, 190, 90] },
        ],
      },
      // paladin: radiant gold (bronze -> gold -> white)
      paladin: {
        gamma: 0.85,
        sheen: 0.85,
        ramp: [
          { t: 0.0, c: [24, 18, 8] },
          { t: 0.4, c: [120, 84, 24] },
          { t: 0.72, c: [220, 176, 70] },
          { t: 1.0, c: [255, 240, 200] },
        ],
      },
      // hunter: venom (black -> deep green -> acid)
      ranger: {
        gamma: 0.95,
        sheen: 0.6,
        ramp: [
          { t: 0.0, c: [8, 12, 8] },
          { t: 0.45, c: [24, 70, 34] },
          { t: 0.78, c: [90, 200, 70] },
          { t: 1.0, c: [200, 255, 150] },
        ],
      },
      // rogue: void latex (black -> violet -> magenta, high gloss)
      rogue: {
        gamma: 1.0,
        sheen: 0.9,
        ramp: [
          { t: 0.0, c: [8, 6, 12] },
          { t: 0.5, c: [56, 24, 84] },
          { t: 0.8, c: [150, 50, 170] },
          { t: 1.0, c: [255, 150, 240] },
        ],
      },
      // caster trio: arcane frost-chrome (deep blue -> cyan -> white)
      mage: {
        gamma: 0.88,
        sheen: 0.85,
        ramp: [
          { t: 0.0, c: [10, 14, 26] },
          { t: 0.45, c: [30, 70, 130] },
          { t: 0.75, c: [90, 180, 230] },
          { t: 1.0, c: [230, 250, 255] },
        ],
      },
      // shaman: storm cobalt (indigo -> electric blue -> pale)
      barbarian: {
        gamma: 0.92,
        sheen: 0.75,
        ramp: [
          { t: 0.0, c: [12, 10, 22] },
          { t: 0.45, c: [36, 44, 110] },
          { t: 0.76, c: [70, 120, 220] },
          { t: 1.0, c: [200, 220, 255] },
        ],
      },
      // druid: verdant bio (bark -> emerald -> amber bloom)
      druid: {
        gamma: 0.9,
        sheen: 0.55,
        ramp: [
          { t: 0.0, c: [16, 14, 10] },
          { t: 0.42, c: [30, 74, 44] },
          { t: 0.74, c: [80, 170, 90] },
          { t: 1.0, c: [220, 210, 120] },
        ],
      },
    },
  },
  // A second, colder set: liquid chrome with a class-tinted rim.
  chrome: {
    label: 'Liquid Chrome',
    suffix: 'suit_chrome',
    themes: {},
  },
};

// Fill the chrome set: a shared steel ramp with a per-model tinted highlight.
{
  const rimTints = {
    knight: [255, 120, 90],
    paladin: [255, 220, 140],
    ranger: [140, 255, 160],
    rogue: [220, 130, 255],
    mage: [140, 210, 255],
    barbarian: [130, 170, 255],
    druid: [180, 255, 150],
  };
  for (const [model, rim] of Object.entries(rimTints)) {
    SUIT_SETS.chrome.themes[model] = {
      gamma: 0.8,
      sheen: 0.95,
      sheenStart: 0.86,
      ramp: [
        { t: 0.0, c: [14, 16, 20] },
        { t: 0.4, c: [70, 78, 90] },
        { t: 0.68, c: [150, 160, 175] },
        { t: 0.9, c: rim },
        { t: 1.0, c: [255, 255, 255] },
      ],
    };
  }
}
