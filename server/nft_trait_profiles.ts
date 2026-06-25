// Pure, host-agnostic trait inference: turn an NFT's metadata attributes into the
// game's procedural SkinDesignSpec (3 colours + pattern + finish + density + glow),
// which renders through the EXISTING designer path (no new render code). Only the
// server uses this, at claim time; the derived spec is stored in creator_skins so
// the body look is fixed at claim. Deterministic: the same token always yields the
// same spec, so it is fully unit-testable against real metadata fixtures.
//
// Marquee collections get hand-authored profiles (high fidelity on the rarity-
// defining traits); everything else uses a generic mapper that keys on the common
// OpenSea trait conventions and falls back to a deterministic colour hash. The
// generic fallback is real logic (never random, never a stub): every input maps to
// a valid, stable, faithful-in-palette spec.
import {
  normalizeDesignSpec, defaultDesignSpec,
  SKIN_PATTERNS, type SkinDesignSpec, type SkinPattern, type SkinFinish, type SkinDensity,
} from '../src/world_api';
import type { NftAttribute } from './nft_ownership';

export interface TraitProfile {
  id: string;
  toDesignSpec(attrs: NftAttribute[]): SkinDesignSpec;
}

// --- deterministic colour utilities (no RNG) ------------------------------------

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hslToHex(hDeg: number, s: number, l: number): string {
  const h = ((hDeg % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const r = Math.round(hue(h + 1 / 3) * 255);
  const g = Math.round(hue(h) * 255);
  const b = Math.round(hue(h - 1 / 3) * 255);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** A stable colour derived from a seed string (so unknown trait values still get
 *  a consistent, distinct look). */
function hashColor(seed: string, sat = 0.5, light = 0.5): string {
  return hslToHex(fnv1a(seed) % 360, sat, light);
}

function pickFrom<T>(arr: readonly T[], seed: string): T {
  return arr[fnv1a(seed) % arr.length]!;
}

// Common colour words -> hex, so a "Gold"/"Blue" trait reads true rather than hashed.
const COLOR_WORDS: Record<string, string> = {
  gold: '#d4af37', 'solid gold': '#d4af37', golden: '#d4af37', silver: '#c0c0c0', steel: '#8a8f98',
  bronze: '#cd7f32', copper: '#b87333', white: '#ededed', cream: '#e8dcc0', black: '#262626',
  gray: '#8a8a8a', grey: '#8a8a8a', brown: '#6b4a2b', 'dark brown': '#4a3320', tan: '#cdab7e',
  red: '#b0402f', crimson: '#9b1c2e', orange: '#ff8c2a', yellow: '#ffd23c', green: '#3f8f3a',
  'army green': '#4b5320', blue: '#4f86d1', 'new punk blue': '#2f4fd1', aquamarine: '#7fffd4',
  purple: '#7a4fd1', pink: '#e69ec0', teal: '#2aa8a8', cyan: '#34e0e0', zombie: '#6f8f3a',
  alien: '#9fe8e8', robot: '#8a8f98', cheetah: '#d39a4a', noise: '#9a9a9a', death: '#3a3f46',
};

function colorForWord(value: string): string {
  const key = value.toLowerCase().trim();
  if (COLOR_WORDS[key]) return COLOR_WORDS[key]!;
  for (const [word, hex] of Object.entries(COLOR_WORDS)) {
    if (key.includes(word)) return hex;
  }
  return hashColor(value, 0.5, 0.5);
}

// Clothing/outfit words -> body pattern.
const CLOTHES_PATTERN: Array<[RegExp, SkinPattern]> = [
  [/strip|sailor|service|navy|tee/i, 'stripes'],
  [/tweed|suit|prom|dress|knit|sweater|wool/i, 'weave'],
  [/hawaii|tie ?dye|floral|spot|leopard/i, 'spots'],
  [/scale|dragon|fish/i, 'scales'],
  [/rune|wizard|robe|toga|cloak/i, 'runes'],
  [/diamond|argyle/i, 'diamond'],
  [/hex|tech|cyber/i, 'hex'],
  [/chevron|sport|track|jersey/i, 'chevron'],
];

function clothesPattern(value: string, seed: string): SkinPattern {
  for (const [re, pat] of CLOTHES_PATTERN) if (re.test(value)) return pat;
  return pickFrom(SKIN_PATTERNS, seed);
}

// --- attribute access -----------------------------------------------------------

class Attrs {
  private readonly map = new Map<string, string[]>();
  constructor(attrs: NftAttribute[]) {
    for (const a of attrs) {
      const key = a.trait_type.toLowerCase().trim();
      const list = this.map.get(key) ?? [];
      list.push(a.value);
      this.map.set(key, list);
    }
  }
  /** First value for any of the given trait-type aliases (lower-cased lookup). */
  get(...types: string[]): string | null {
    for (const t of types) {
      const v = this.map.get(t.toLowerCase());
      if (v && v.length > 0) return v[0]!;
    }
    return null;
  }
  /** Every attribute value, for accessory-style collections + the hash seed. */
  values(): string[] {
    return [...this.map.values()].flat();
  }
  seed(): string {
    return this.values().join('|') || 'empty';
  }
}

function glowFromEyes(eyes: string | null): string | null {
  if (!eyes) return null;
  if (/laser/i.test(eyes)) return '#ff2a2a';
  if (/beam|blue/i.test(eyes)) return '#2aa8ff';
  if (/holo|holographic/i.test(eyes)) return '#9b7cff';
  if (/zombie|toxic|green/i.test(eyes)) return '#7cff5a';
  return null;
}

// --- BAYC --------------------------------------------------------------------

const BAYC: TraitProfile = {
  id: 'bayc',
  toDesignSpec(raw): SkinDesignSpec {
    const a = new Attrs(raw);
    const fur = a.get('fur') ?? '';
    const eyes = a.get('eyes');
    const background = a.get('background');
    const clothes = a.get('clothes', 'clothing') ?? '';
    let finish: SkinFinish = 'satin';
    let emissive: string | null = glowFromEyes(eyes);
    const f = fur.toLowerCase();
    if (/solid gold|gold/.test(f) || /robot|death bot|noise|cyber/.test(f)) finish = 'metallic';
    if (/trippy|dmt|psychedelic|noise|rainbow/.test(f)) emissive = emissive ?? '#ff4fd8';
    if (/zombie/.test(f)) emissive = emissive ?? '#7cff5a';
    const primary = fur ? colorForWord(fur) : '#6b4a2b';
    const secondary = /trippy|dmt|rainbow/.test(f) ? '#4ff0ff' : hslToHex(fnv1a(fur || 'fur') % 360, 0.4, 0.28);
    const accent = background ? colorForWord(background) : '#caa84b';
    const pattern: SkinPattern = /trippy|dmt|noise/.test(f) ? 'spots' : clothesPattern(clothes, a.seed());
    const density: SkinDensity = /trippy|dmt|noise/.test(f) ? 'high' : 'medium';
    return normalizeDesignSpec({ primary, secondary, accent, pattern, finish, density, emissive })
      ?? defaultDesignSpec();
  },
};

// --- CryptoPunks -------------------------------------------------------------

const PUNK_TYPE_BASE: Record<string, { primary: string; finish: SkinFinish; emissive: string | null }> = {
  alien: { primary: '#9fe8e8', finish: 'satin', emissive: '#6fe9e9' },
  ape: { primary: '#5f7a3a', finish: 'matte', emissive: null },
  zombie: { primary: '#7f9a5a', finish: 'matte', emissive: '#7cff5a' },
  male: { primary: '#c89a6a', finish: 'matte', emissive: null },
  female: { primary: '#d2a378', finish: 'satin', emissive: null },
};

const CRYPTOPUNKS: TraitProfile = {
  id: 'cryptopunks',
  toDesignSpec(raw): SkinDesignSpec {
    const a = new Attrs(raw);
    const type = (a.get('type', 'gender') ?? 'male').toLowerCase();
    const base = PUNK_TYPE_BASE[type] ?? PUNK_TYPE_BASE.male!;
    const accessories = a.values().map((v) => v.toLowerCase());
    const has = (re: RegExp): boolean => accessories.some((v) => re.test(v));
    let accent = '#caa84b';
    let pattern: SkinPattern = 'solid';
    let finish = base.finish;
    let emissive = base.emissive;
    if (has(/mohawk/)) { accent = '#ff3030'; pattern = 'chevron'; }
    if (has(/wild hair|crazy hair|frumpy/)) pattern = 'runes';
    if (has(/3d glasses|vr/)) { accent = '#2aa8ff'; emissive = emissive ?? '#2aa8ff'; }
    if (has(/gold chain|medical mask/)) { accent = '#d4af37'; finish = 'metallic'; }
    if (has(/pipe|cigarette|vape|cigar/)) accent = '#b0884a';
    const secondary = hslToHex(fnv1a(type) % 360, 0.35, 0.26);
    return normalizeDesignSpec({ primary: base.primary, secondary, accent, pattern, finish, density: 'medium', emissive })
      ?? defaultDesignSpec();
  },
};

// --- Generic mapper ----------------------------------------------------------

const GENERIC: TraitProfile = {
  id: 'generic',
  toDesignSpec(raw): SkinDesignSpec {
    const a = new Attrs(raw);
    const seed = a.seed();
    const baseTrait = a.get('fur', 'skin', 'body', 'base', 'type', 'background color');
    const primary = baseTrait ? colorForWord(baseTrait) : hashColor(`primary:${seed}`, 0.5, 0.5);
    const bg = a.get('background', 'back');
    const accent = bg ? colorForWord(bg) : hashColor(`accent:${seed}`, 0.6, 0.55);
    const secondary = hashColor(`secondary:${seed}`, 0.4, 0.28);
    const clothes = a.get('clothes', 'clothing', 'outfit', 'shirt', 'body');
    const pattern = clothes ? clothesPattern(clothes, seed) : pickFrom(SKIN_PATTERNS, seed);
    const emissive = glowFromEyes(a.get('eyes', 'eye'));
    const finish: SkinFinish = /metal|robot|gold|chrome|steel/i.test(baseTrait ?? '') ? 'metallic' : 'satin';
    return normalizeDesignSpec({ primary, secondary, accent, pattern, finish, density: 'medium', emissive })
      ?? defaultDesignSpec();
  },
};

const PROFILES = new Map<string, TraitProfile>([
  [BAYC.id, BAYC],
  [CRYPTOPUNKS.id, CRYPTOPUNKS],
  [GENERIC.id, GENERIC],
]);

/** Look up a trait profile by id, falling back to the generic mapper for an
 *  unknown id (so an allow-listed collection without a hand profile still renders). */
export function traitProfile(id: string): TraitProfile {
  return PROFILES.get(id) ?? GENERIC;
}

/** Derive the procedural SkinDesignSpec for a token from its attributes. */
export function designSpecForTraits(profileId: string, attrs: NftAttribute[]): SkinDesignSpec {
  return traitProfile(profileId).toDesignSpec(attrs);
}
