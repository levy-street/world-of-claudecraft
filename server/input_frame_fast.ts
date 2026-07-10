// Zero-allocation-ish fast path for the single hottest inbound frame shape.
//
// Every connected client streams movement intent at 20 Hz, so at N players the
// server runs N*20 JSON.parse calls per second on the main thread before the
// sim sees anything. Those frames are tiny and near-uniform:
//
//   {"t":"input","seq":123,"mi":{"f":1,"tl":0,...},"facing":-1.57}
//
// This parser accepts EXACTLY that grammar (any subset/order of the seven mi
// flags, optional seq, optional facing, no whitespace, no other keys) and
// returns the same object JSON.parse would. Anything else, including any
// whitespace or an unknown key, returns null and the caller falls back to
// JSON.parse, so unusual-but-valid client encodings keep byte-for-byte
// identical semantics through the slow path. Numbers are parsed with
// Number(slice), the same string-to-number semantics JSON.parse applies, so a
// matched frame is indistinguishable from a JSON.parse of the same bytes.
//
// The dispatcher treats a fast-parsed frame and a JSON.parse'd frame
// identically; tests/server/input_frame_fast.test.ts fuzzes equivalence.

const PREFIX = '{"t":"input"';

// mi flag keys the sim's parseMoveInputFrame reads (src/sim/move_input.ts).
// A frame with any OTHER mi key falls back to JSON.parse (the sim ignores
// unknown keys, but the fallback keeps this parser trivially conservative).
const MI_KEYS = new Set(['f', 'b', 'tl', 'tr', 'sl', 'sr', 'j']);

interface FastInputFrame {
  t: 'input';
  seq?: number;
  mi?: Record<string, number>;
  facing?: number;
}

// Scan a JSON number (optional -, digits, optional .digits, optional e[+-]digits)
// starting at i; returns the exclusive end index, or i if none.
function numberEnd(raw: string, i: number): number {
  let j = i;
  if (raw.charCodeAt(j) === 45 /* - */) j++;
  const d0 = j;
  while (j < raw.length) {
    const c = raw.charCodeAt(j);
    if (c >= 48 && c <= 57) j++;
    else break;
  }
  if (j === d0) return i; // no integer digits
  // JSON integers are 0 | [1-9][0-9]*: a leading zero followed by more digits
  // ("007") is not JSON, so it must fall back (and be rejected) like any
  // other non-JSON shape, keeping "accepted implies JSON.parse-identical"
  // exactly true.
  if (j - d0 > 1 && raw.charCodeAt(d0) === 48 /* 0 */) return i;
  if (raw.charCodeAt(j) === 46 /* . */) {
    j++;
    const f0 = j;
    while (j < raw.length) {
      const c = raw.charCodeAt(j);
      if (c >= 48 && c <= 57) j++;
      else break;
    }
    if (j === f0) return i; // bare trailing dot is not JSON
  }
  const e = raw.charCodeAt(j);
  if (e === 101 /* e */ || e === 69 /* E */) {
    let k = j + 1;
    const s = raw.charCodeAt(k);
    if (s === 43 /* + */ || s === 45 /* - */) k++;
    const e0 = k;
    while (k < raw.length) {
      const c = raw.charCodeAt(k);
      if (c >= 48 && c <= 57) k++;
      else break;
    }
    if (k === e0) return i;
    j = k;
  }
  return j;
}

/**
 * Parse a canonical movement-input frame, or return null to signal "use
 * JSON.parse". Null NEVER means "invalid message": it only means this fast
 * path does not cover the byte shape.
 */
export function parseInputFrameFast(raw: string): FastInputFrame | null {
  if (!raw.startsWith(PREFIX)) return null;
  const out: FastInputFrame = { t: 'input' };
  let i = PREFIX.length;
  // zero or more of: ,"seq":N  ,"mi":{...}  ,"facing":N   then }
  for (;;) {
    const c = raw.charCodeAt(i);
    if (c === 125 /* } */) {
      return i + 1 === raw.length ? out : null;
    }
    if (c !== 44 /* , */) return null;
    i++;
    if (raw.startsWith('"seq":', i) && out.seq === undefined) {
      i += 6;
      const end = numberEnd(raw, i);
      if (end === i) return null;
      out.seq = Number(raw.slice(i, end));
      i = end;
    } else if (raw.startsWith('"facing":', i) && out.facing === undefined) {
      i += 9;
      const end = numberEnd(raw, i);
      if (end === i) return null;
      out.facing = Number(raw.slice(i, end));
      i = end;
    } else if (raw.startsWith('"mi":{', i) && out.mi === undefined) {
      i += 6;
      const mi: Record<string, number> = {};
      out.mi = mi;
      if (raw.charCodeAt(i) === 125 /* } */) {
        i++;
        continue;
      }
      for (;;) {
        if (raw.charCodeAt(i) !== 34 /* " */) return null;
        const keyEnd = raw.indexOf('"', i + 1);
        if (keyEnd < 0) return null;
        const key = raw.slice(i + 1, keyEnd);
        if (!MI_KEYS.has(key)) return null;
        i = keyEnd + 1;
        if (raw.charCodeAt(i) !== 58 /* : */) return null;
        i++;
        const end = numberEnd(raw, i);
        if (end === i) return null;
        // Last-key-wins like JSON.parse, so duplicate keys stay equivalent.
        mi[key] = Number(raw.slice(i, end));
        i = end;
        const sep = raw.charCodeAt(i);
        if (sep === 44 /* , */) {
          i++;
          continue;
        }
        if (sep === 125 /* } */) {
          i++;
          break;
        }
        return null;
      }
    } else {
      return null;
    }
  }
}
