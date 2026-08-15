// The authored modular-character look as a WIRE + STORAGE payload, and its
// bounds validation.
//
// No IWorld facet, unlike most of this directory: an appearance is not
// something the world is ASKED for, it is a document that crosses the trust
// boundary, so there is nothing for Sim and ClientWorld to implement in
// parallel and no parity pin to hold. What this module exports is the
// validator both sides call.
//
// This module is the ONE home the server and the client share for the
// appearance payload's shape, mirroring src/world_api/action_bar.ts: it is
// DOM-free, sim-free and three.js-free (plain types only), so `server/` (which
// must not import `src/render/` or `src/ui/`) and the browser both validate
// untrusted looks through the same function.
//
// DIVISION OF LABOUR, and it matters:
//  - HERE lives the BOUNDS check (is this a plausible, small, well-shaped
//    document?). It runs server-side on every write, because the server stores
//    the value and broadcasts it to other players.
//  - The MEANING of each field (which hair styles exist, what range a slider
//    takes) lives with the renderer, in normalizeAppearance
//    (src/render/characters/modular.ts). Every consumer already runs it before
//    composing a body, so an out-of-range value that survives this bounds check
//    can only ever clamp to a valid look at render time, never break one.
// Keeping the enum tables out of here is deliberate: duplicating ~40 style
// lists server-side would drift the day a new haircut lands. What this module
// pins instead is the key SET, which is guarded against drift by a test
// (tests/appearance_wire_bounds.test.ts) that checks it against the renderer's
// DEFAULT_APPEARANCE.

/** Every field a stored/wire appearance may carry. Unknown keys are dropped:
 *  a character row is broadcast to other players, so it must never become a
 *  channel for arbitrary attacker-chosen text. */
export const APPEARANCE_WIRE_KEYS: readonly string[] = [
  'gender',
  'hair',
  'beard',
  'brows',
  'earrings',
  'earringMaterial',
  'skinHue',
  'skinSat',
  'skinLight',
  'hairHue',
  'hairSat',
  'hairLight',
  'face',
  'body',
  'mouth',
  'eyeShape',
  'ears',
  'lashes',
  'lashHue',
  'lashSat',
  'lashLight',
  'eyeHue',
  'eyeSat',
  'eyeLight',
  'lipstick',
  'blush',
  'eyeshadow',
  'outfit',
];

/** The slider names each nested map may carry: ALLOWLISTED, exactly like the
 *  top-level key set, and for the same reason the module header gives: a
 *  character row is broadcast to every player in view, so it must never become
 *  a channel for arbitrary attacker-chosen text. Bounding the maps by count and
 *  value type alone still let 32 keys of 48 characters ride per map, twice
 *  over, persisted and re-broadcast raw: an unmoderated text channel the chat
 *  filter never sees. Same drift guard as APPEARANCE_WIRE_KEYS:
 *  tests/appearance_wire_bounds.test.ts pins both lists against the renderer's
 *  own slider tables.
 *
 *  KEY names were only half of it. The VALUE charset (STYLE_ID_RE below) is the
 *  other, and together they are what make the wire budget a real ceiling rather
 *  than an estimate: APPEARANCE_MAX_WIRE_BYTES is now reachable by construction
 *  and pinned by a test, where the same document could previously run to 8 KB
 *  on control characters alone. */
export const APPEARANCE_FACE_SLIDER_KEYS: readonly string[] = [
  'nose',
  'eyes',
  'ears',
  'jaw',
  'brow',
  'cheeks',
  'chin',
  'smirk',
];
export const APPEARANCE_BODY_SLIDER_KEYS: readonly string[] = [
  'shoulders',
  'chest',
  'hips',
  'hands',
  'elbows',
  'knees',
  'feet',
];

/** Which slider allowlist a nested map validates against, keyed by its own
 *  top-level key. A lookup, not a two-way ternary: a ternary over two known
 *  keys quietly treats anything that is not 'face' as 'body', so a future
 *  third nested key would validate its sliders against the wrong allowlist
 *  instead of failing loudly. Here a key with no entry is simply not a nested
 *  map this module knows how to sanitize, and sanitizeAppearance drops it,
 *  same as any other value it does not recognize. */
const NESTED_SLIDER_KEYS: Record<string, readonly string[]> = {
  face: APPEARANCE_FACE_SLIDER_KEYS,
  body: APPEARANCE_BODY_SLIDER_KEYS,
};

/** Every string VALUE a look may carry is a style id: a short bare identifier
 *  the renderer matches against a fixed list ('warriorbraid', 'bloodforged',
 *  'default'). So bound the CHARSET, not just the length.
 *
 *  Length alone was the other half of the same hole the key allowlists closed.
 *  26 keys x 48 free-form UTF-16 units is ~1.2 K characters of attacker-chosen
 *  text, persisted on a character row and re-broadcast raw to every player in
 *  view, outside every chat filter, and with control characters (which
 *  JSON.stringify expands to six bytes each) it put the wire ceiling at 8 KB
 *  against reasoning that sizes the document at well under one. Bounding the
 *  charset closes the channel and the budget together: what survives is
 *  alphanumerics and underscore, which cannot spell an insult, cannot carry
 *  markup or a control code, and never escapes in JSON.
 *
 *  All 148 ids the renderer defines today are plain lowercase words, the
 *  longest 14 ('longcenterpart'), so this is comfortable headroom rather than a
 *  tight fit, and if a future id ever needs a character outside the class the
 *  drift guard in tests/appearance_wire_bounds.test.ts fails on it at CI time
 *  rather than a player's look silently not saving. */
const STYLE_ID_RE = /^[a-z0-9_]{1,24}$/;

/**
 * The largest document sanitizeAppearance can return, in UTF-8 bytes.
 *
 * A real ceiling, not an estimate, and tests/appearance_wire_bounds.test.ts
 * builds the maximal document and measures it rather than trusting this
 * constant. It is reachable by construction: every one of the 26 scalar keys
 * carrying a 24-character id (a string of 24 costs 26 with its quotes), and
 * both slider maps full of worst-case doubles, each 25 characters long. 25 is
 * the true longest JSON.stringify of any finite double, not 24: JSON uses
 * fixed notation down to 1e-6 exclusive, so a value just above that boundary
 * still prints in fixed form yet needs the full 17 significant digits, for
 * example -0.0000032101548324340437 (sign, "0.", five leading zeros, 17
 * digits).
 *
 * For scale, a default look is 586 bytes on the wire and a fully randomised one
 * about 911, which is where the "~0.6 KB" the identity-wire reasoning quotes
 * comes from. The gap between that and this is all numeric precision, and the
 * charset bound is what stops the gap being unbounded text.
 */
export const APPEARANCE_MAX_WIRE_BYTES = 1489;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One morph-slider map: allowlisted keys, finite numeric values. Values are
 *  NOT range-clamped here (normalizeAppearance owns the -1..1 rule); this
 *  keeps the document small, numeric, and free of foreign key names. */
function sanitizeSliderMap(
  value: unknown,
  allowed: readonly string[],
): Record<string, number> | null {
  if (!isPlainObject(value)) return null;
  const out: Record<string, number> = {};
  let kept = 0;
  for (const key of allowed) {
    if (!(key in value)) continue;
    const raw = value[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    out[key] = raw;
    kept++;
  }
  // Null, not {}, when nothing survived. A map that authors no slider is not a
  // slider map, and returning {} let it count toward the "did this document
  // author anything" tally below: `{"face":{}}` and `{"body":{"a":"x"}}` both
  // read as a design and spent the one-shot redesign token on a body nobody
  // chose. Same rule as the document itself, one level down.
  return kept > 0 ? out : null;
}

/**
 * Validate + bound an untrusted appearance payload. Returns a clean document
 * carrying only known keys with plausibly-typed values, or null when the input
 * is not a usable appearance at all. Never throws: a bad payload yields null so
 * the caller can answer 400 without crashing the request.
 *
 * Null covers TWO cases, and the second is load-bearing:
 *  - not an object, so there is nothing to read;
 *  - an object that contributed NO known key ({}, nothing but junk keys, or
 *    nothing but empty/junk slider maps such as `{"face":{}}`).
 *    An empty document is not a look. Accepting it let `{"appearance":{}}`
 *    spend a character's one-shot redesign token and store a body nobody
 *    authored: the reroll's whole precondition is that the player is choosing
 *    a design, so "chose nothing" has to be a 400, not a spent token.
 *
 * The result is NOT guaranteed to name real styles: see the note above: the
 * renderer's normalizeAppearance is what turns it into a valid body.
 */
export function sanitizeAppearance(value: unknown): Record<string, unknown> | null {
  if (!isPlainObject(value)) return null;
  const out: Record<string, unknown> = {};
  let kept = 0;
  for (const key of APPEARANCE_WIRE_KEYS) {
    if (!(key in value)) continue;
    const raw = value[key];
    const sliderKeys = NESTED_SLIDER_KEYS[key];
    if (sliderKeys) {
      const map = sanitizeSliderMap(raw, sliderKeys);
      if (map !== null) {
        out[key] = map;
        kept++;
      }
      continue;
    }
    if (typeof raw === 'boolean') out[key] = raw;
    else if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = raw;
    else if (typeof raw === 'string' && STYLE_ID_RE.test(raw)) out[key] = raw;
    // anything else (nested junk, a string that is not a bare style id, null)
    // is simply dropped
    else continue;
    kept++;
  }
  return kept > 0 ? out : null;
}

/**
 * Whether two looks are the same DOCUMENT, by value.
 *
 * The callers hold one look that came off an entity and one that came off a
 * fresh row read, so they are never the same object and `!==` elides nothing:
 * every reconnect would bust the wire memo and re-ship an identical look to
 * every player in view. Key ORDER is not normalized because both sides of every
 * comparison are built by sanitizeAppearance, which emits keys in
 * APPEARANCE_WIRE_KEYS order. A document that reached storage another way can
 * at worst compare unequal, which is the safe direction (a redundant resend,
 * never a stale body).
 */
export function sameAppearance(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
