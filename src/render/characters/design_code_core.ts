// Character design code: one stable, named value per changeable creator
// feature, so a finished look can be written down, shared, and imported.
//
// The code is a single human-readable line, `WOC1; body=female; skin=27/46/68;
// ...`: a versioned header, then `field=value` pairs, one per feature the
// creator can change. Field ids and value spellings are a WIRE FORMAT: they
// must stay stable across releases (rename a model field if you must, never a
// code field), and anything new lands as a new field id so old codes keep
// importing. Body proportions are deliberately absent: they are Fit Studio
// authoring data the game's creator cannot change, so a code neither carries
// nor overwrites them. The importer therefore keeps the body it found, which
// is what randomize does too; reset is the one whole-look action that returns
// the proportions to neutral along with everything else.
//
// Pure core (RENDER_PURE_CORES): no DOM, no Three, no i18n, no clock, no
// randomness. Decode failures are stable discriminators the UI localizes.
import {
  BEARD_STYLES,
  BLUSH_SHADES,
  BROW_STYLES,
  EAR_STYLES,
  EARRING_MATERIAL_IDS,
  EARRING_STYLES,
  EYE_STYLES,
  FACE_SLIDERS,
  type FaceSlider,
  HAIR_STYLES,
  LIP_SHADES,
  MOUTH_STYLES,
  type ModularAppearance,
  normalizeAppearance,
  OUTFIT_COLORWAY_IDS,
  SHADOW_SHADES,
} from './modular';

/** The versioned header every code starts with. Bump the digit only for a
 *  change old importers cannot survive; additive fields do not need one. */
export const DESIGN_CODE_HEADER = 'WOC1';

/** Paste cap, matching the talent build importer's guard: nothing legitimate
 *  is anywhere near this long, and it bounds the parse work on a hostile
 *  paste. */
export const DESIGN_CODE_MAX_LENGTH = 8192;

/** One decimal place: enough that every preset and slider survives the round
 *  trip exactly (hue tolerance is 2 degrees, sat/light 0.02, sliders 0.05),
 *  short enough that the code stays readable. */
const fmt = (n: number): string => String(Math.round(n * 10) / 10);

/** How far a decoded channel may drift from its normalized (clamped) value
 *  before the field counts as coerced: just past the encoder's own rounding,
 *  so honest round-trips never trip it. */
const HUE_EPS = 0.06;
const UNIT_EPS = 0.0006;

type StylePick =
  | 'gender'
  | 'hair'
  | 'beard'
  | 'brows'
  | 'eyeShape'
  | 'ears'
  | 'mouth'
  | 'earrings'
  | 'earringMaterial'
  | 'lipstick'
  | 'blush'
  | 'eyeshadow'
  | 'outfit';

type ColorTriple = readonly [
  hue: keyof ModularAppearance,
  sat: keyof ModularAppearance,
  light: keyof ModularAppearance,
];

interface DesignField {
  /** Stable wire id, the `field` half of `field=value`. */
  readonly id: string;
  readonly encode: (a: ModularAppearance) => string;
  /** Parse `raw` onto the draft. False means the VALUE does not parse at all
   *  (the code is damaged); an unrecognized but well-formed value still
   *  applies and is reported as coerced after normalization instead. `warn`
   *  collects sub-entries this field dropped (unknown face sliders). */
  readonly apply: (
    draft: Partial<ModularAppearance>,
    raw: string,
    warn: (entry: string) => void,
  ) => boolean;
  /** Whether normalization kept the applied value (false = out of range or
   *  off the style list, so the import fell back for this field). */
  readonly kept: (draft: Partial<ModularAppearance>, normalized: ModularAppearance) => boolean;
}

function pickField(id: string, key: StylePick, options: readonly string[]): DesignField {
  // `options` is not consulted at parse time on purpose: normalizeAppearance
  // is the one authority on what falls back (it also maps legacy style ids),
  // and `kept` sees the outcome. The list is still taken so the registry
  // documents, per field, which catalog its values come from.
  void options;
  return {
    id,
    encode: (a) => String(a[key]),
    apply: (draft, raw) => {
      const v = raw.trim().toLowerCase();
      // Same charset as the wire's STYLE_ID_RE (src/world_api/appearance.ts):
      // a value the server could never store must not parse here, and a value
      // the wire would accept (a leading digit included) must never turn the
      // whole paste into "malformed", it just coerces that one field.
      if (!/^[a-z0-9_]{1,24}$/.test(v)) return false;
      (draft as Record<string, unknown>)[key] = v;
      return true;
    },
    kept: (draft, normalized) => draft[key] === normalized[key],
  };
}

function colorField(id: string, [hueKey, satKey, lightKey]: ColorTriple): DesignField {
  return {
    id,
    encode: (a) =>
      `${fmt(a[hueKey] as number)}/${fmt((a[satKey] as number) * 100)}/${fmt((a[lightKey] as number) * 100)}`,
    apply: (draft, raw) => {
      // An empty component is rejected, not read as zero: Number('') is 0,
      // which would silently import a truncated `27//68` as saturation 0 and
      // in-range zeroes never show up in `coerced`. Damage stays loud.
      const texts = raw.split('/').map((p) => p.trim());
      if (texts.length !== 3 || texts.some((p) => p === '')) return false;
      const parts = texts.map(Number);
      if (parts.some((n) => !Number.isFinite(n))) return false;
      const d = draft as Record<string, unknown>;
      d[hueKey] = parts[0];
      d[satKey] = parts[1] / 100;
      d[lightKey] = parts[2] / 100;
      return true;
    },
    kept: (draft, normalized) =>
      Math.abs((draft[hueKey] as number) - (normalized[hueKey] as number)) <= HUE_EPS &&
      Math.abs((draft[satKey] as number) - (normalized[satKey] as number)) <= UNIT_EPS &&
      Math.abs((draft[lightKey] as number) - (normalized[lightKey] as number)) <= UNIT_EPS,
  };
}

const lashesField: DesignField = {
  id: 'lashes',
  encode: (a) => (a.lashes ? 'on' : 'off'),
  apply: (draft, raw) => {
    const v = raw.trim().toLowerCase();
    if (v === 'on' || v === 'true' || v === '1') draft.lashes = true;
    else if (v === 'off' || v === 'false' || v === '0') draft.lashes = false;
    else return false;
    return true;
  },
  kept: (draft, normalized) => draft.lashes === normalized.lashes,
};

const faceField: DesignField = {
  id: 'face',
  // Only the moved sliders are written (`nose:-40,jaw:20`); a sculpted-default
  // face encodes as the empty value, so the field is still visibly present.
  encode: (a) =>
    FACE_SLIDERS.filter((k) => Math.round((a.face?.[k] ?? 0) * 100) !== 0)
      .map((k) => `${k}:${Math.round((a.face?.[k] ?? 0) * 100)}`)
      .join(','),
  apply: (draft, raw, warn) => {
    const face: Partial<Record<FaceSlider, number>> = {};
    const body = raw.trim();
    if (body !== '') {
      for (const part of body.split(',')) {
        const m = part.trim().match(/^([a-z]+)\s*:\s*(-?\d+(?:\.\d+)?)$/i);
        if (!m) return false;
        const key = m[1].toLowerCase() as FaceSlider;
        if (!FACE_SLIDERS.includes(key)) {
          warn(`face.${m[1]}`);
          continue;
        }
        face[key] = Number(m[2]) / 100;
      }
    }
    draft.face = face as ModularAppearance['face'];
    return true;
  },
  kept: (draft, normalized) =>
    FACE_SLIDERS.every(
      (k) => Math.abs((draft.face?.[k] ?? 0) - (normalized.face[k] ?? 0)) <= UNIT_EPS * 10,
    ),
};

/** The registry: every changeable creator feature, its stable wire id, and
 *  its value codec, in the order the exported code lists them. The creator's
 *  row set and this table must move together; tests/design_code.test.ts pins
 *  the id set. */
export const DESIGN_FIELDS: readonly DesignField[] = [
  // `body` is the body PICK (the Body tab's male/female segment), not the
  // proportions. Ids are frozen, so this one is spent: sculpted proportions,
  // if they ever become a player-facing choice, need a new id of their own.
  pickField('body', 'gender', ['male', 'female']),
  colorField('skin', ['skinHue', 'skinSat', 'skinLight']),
  pickField('eyes', 'eyeShape', EYE_STYLES),
  colorField('eyecol', ['eyeHue', 'eyeSat', 'eyeLight']),
  pickField('brows', 'brows', BROW_STYLES),
  pickField('mouth', 'mouth', MOUTH_STYLES),
  pickField('ears', 'ears', EAR_STYLES),
  lashesField,
  colorField('lashcol', ['lashHue', 'lashSat', 'lashLight']),
  faceField,
  pickField('hair', 'hair', HAIR_STYLES),
  colorField('haircol', ['hairHue', 'hairSat', 'hairLight']),
  pickField('beard', 'beard', BEARD_STYLES),
  pickField('outfit', 'outfit', OUTFIT_COLORWAY_IDS),
  pickField('lips', 'lipstick', LIP_SHADES),
  pickField('blush', 'blush', BLUSH_SHADES),
  pickField('shadow', 'eyeshadow', SHADOW_SHADES),
  pickField('earrings', 'earrings', EARRING_STYLES),
  pickField('jewel', 'earringMaterial', EARRING_MATERIAL_IDS),
];

/** Serialize a look as a shareable one-line code. The input is normalized
 *  first, so the emitted values are always in range and re-importable
 *  verbatim. */
export function encodeDesignCode(appearance: Partial<ModularAppearance> | null): string {
  const a = normalizeAppearance(appearance);
  return `${DESIGN_CODE_HEADER}; ${DESIGN_FIELDS.map((f) => `${f.id}=${f.encode(a)}`).join('; ')}`;
}

export type DesignCodeError = 'empty' | 'header' | 'version' | 'malformed';

export interface DecodedDesignCode {
  ok: true;
  /** The imported look, normalized. Body proportions are the neutral default:
   *  the caller keeps the current body, mirroring randomize/reset. */
  appearance: ModularAppearance;
  /** Well-formed entries this version does not know (a newer build's additive
   *  field, an unknown face slider): imported around, worth a soft notice. */
  ignored: string[];
  /** Fields whose value was off the catalog or out of range and fell back to
   *  the default under normalization. */
  coerced: string[];
}

export interface DesignCodeFailure {
  ok: false;
  reason: DesignCodeError;
}

/** Parse a pasted code. Tolerant where sharing mangles things (case, extra
 *  whitespace, line breaks between fields, a trailing separator); strict where
 *  damage means data loss (a token with no `=`, an unreadable value, a header
 *  from a future format). Missing fields take the default look's value, so a
 *  short code is a valid design, not an error. */
export function decodeDesignCode(raw: string): DecodedDesignCode | DesignCodeFailure {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
  if (raw.length > DESIGN_CODE_MAX_LENGTH) return { ok: false, reason: 'malformed' };
  const tokens = raw
    .split(/[;\n\r]+/)
    .map((t) => t.trim())
    .filter((t) => t !== '');
  if (tokens.length === 0) return { ok: false, reason: 'empty' };

  const header = tokens[0].match(/^woc(\d+)$/i);
  if (!header) return { ok: false, reason: 'header' };
  if (Number(header[1]) !== 1) return { ok: false, reason: 'version' };

  const byId = new Map(DESIGN_FIELDS.map((f) => [f.id, f]));
  const draft: Partial<ModularAppearance> = {};
  const applied: DesignField[] = [];
  const ignored: string[] = [];
  const warn = (entry: string) => ignored.push(entry);

  for (const token of tokens.slice(1)) {
    // The id half accepts digits and underscores even though no field uses
    // them today: every shipped client is frozen with THIS regex, so an id
    // like `hair2` added later must land in `ignored` on an old build rather
    // than failing the whole paste, which is the format's forward-compat
    // promise.
    const m = token.match(/^([a-z][a-z0-9_]*)\s*=\s*(.*)$/i);
    if (!m) return { ok: false, reason: 'malformed' };
    const field = byId.get(m[1].toLowerCase());
    if (!field) {
      ignored.push(m[1].toLowerCase());
      continue;
    }
    if (!field.apply(draft, m[2], warn)) return { ok: false, reason: 'malformed' };
    if (!applied.includes(field)) applied.push(field);
  }

  const appearance = normalizeAppearance(draft);
  const coerced = applied.filter((f) => !f.kept(draft, appearance)).map((f) => f.id);
  return { ok: true, appearance, ignored, coerced };
}
