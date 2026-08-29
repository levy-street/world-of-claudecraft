// The STORAGE_PRICES boot knob (Bank Storage phase 09): one JSON env var that
// hands a validated StoragePricesOverride to the realm Sim at construction
// (server/sim_boot_config.ts passes it into new Sim). The shape is one JSON
// object of copper price lists, each at EXACTLY its compiled default's length:
//   {"bankExpansions":[12 ints],"bankSockets":[4 ints],"vaultUpgrades":[5 ints]}
// Boot-time only: the Sim ctor resolves the override once, so changing the env
// takes a process restart. Validation is strict and fail-safe PER DIMENSION: a
// dimension applies only as an array of the exact compiled length whose every
// entry is a safe integer >= 0 (Number.isSafeInteger; zero is legal, a
// magnitude past Number.MAX_SAFE_INTEGER is not), anything else drops that
// whole dimension back to the compiled default with a console.error at boot
// while a valid sibling still applies, and an unknown key is reported by name,
// so a rejected value or a typo can never look identical to unset.

import { DEFAULT_STORAGE_PRICES } from '../src/sim/storage_prices';
import type { StoragePricesOverride } from '../src/sim/types';

const DIMENSIONS = ['bankExpansions', 'bankSockets', 'vaultUpgrades'] as const;
type Dimension = (typeof DIMENSIONS)[number];

// Why one entry fails a dimension, named for the boot log. Number.isInteger
// rejects NaN/Infinity/fractions in one test; the safe-integer bound refuses
// magnitudes past Number.MAX_SAFE_INTEGER (a mistyped exponent like 1e300
// must reject loudly, never apply as an unpayable price); zero is a LEGAL
// price, so only strictly negative values are refused.
const entryProblem = (entry: unknown): string | null => {
  if (typeof entry !== 'number') return 'a non-number entry';
  if (!Number.isInteger(entry)) return 'a non-integer entry';
  if (!Number.isSafeInteger(entry)) return 'an unsafely large entry';
  if (entry < 0) return 'a negative entry';
  return null;
};

// Rejection strings ride the boot console verbatim, and an unknown KEY is
// operator-typed content: cap its echo (length and printable characters) so a
// pathological key cannot forge extra boot lines or flood the log, and cap the
// rejection list itself the same way.
const MAX_REJECTIONS = 8;
const describeKey = (key: string): string => {
  // Printable ASCII only: control characters (DEL included) and everything
  // non-ASCII render as '?', so a newline in a key cannot forge a boot line.
  const printable = [...key]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code <= 0x7e ? ch : '?';
    })
    .join('');
  return printable.length > 40 ? `${printable.slice(0, 40)}...` : printable;
};

/** Strict pure parser for the STORAGE_PRICES env var. Unset/blank raw is the
 *  one SILENT path (override undefined, no rejections: the compiled defaults
 *  apply); every other refusal returns a rejection string naming the problem,
 *  so an all-rejected value never comes back looking identical to unset. */
export function parseStoragePrices(raw: string | undefined): {
  override: StoragePricesOverride | undefined;
  rejections: string[];
} {
  // Trimmed first so a whitespace-only export stays on the silent-unset path
  // and can never half-parse (the empty-numeric env trap family).
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { override: undefined, rejections: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { override: undefined, rejections: ['the value is not valid JSON'] };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      override: undefined,
      rejections: ['the value must be a JSON object of price dimensions'],
    };
  }
  const rejections: string[] = [];
  const override: { -readonly [K in Dimension]?: number[] } = {};
  let applied = false;
  const entries = Object.entries(parsed);
  // '{}' must not become a SECOND silent path beside unset/blank: an exported
  // empty object is a set-but-inert knob, and silence is the unset signal, so
  // it reports like every other refusal (QA 09).
  if (entries.length === 0) {
    return { override: undefined, rejections: ['the object names no price dimensions'] };
  }
  for (const [key, value] of entries) {
    if (!(DIMENSIONS as readonly string[]).includes(key)) {
      // Reported, never skipped: a typo like bankExpansion must not silently
      // leave the operator on the defaults they meant to override. The key
      // echo is sanitized and bounded (describeKey): it is the one
      // operator-typed string these boot lines carry.
      rejections.push(`unknown key "${describeKey(key)}"`);
      continue;
    }
    const dim = key as Dimension;
    const expected = DEFAULT_STORAGE_PRICES[dim].length;
    if (!Array.isArray(value)) {
      rejections.push(`${dim} is not an array; the whole dimension falls back`);
      continue;
    }
    if (value.length !== expected) {
      rejections.push(
        `${dim} has ${value.length} entries, expected exactly ${expected}; the whole dimension falls back`,
      );
      continue;
    }
    let problem: string | null = null;
    for (const entry of value) {
      problem = entryProblem(entry);
      if (problem !== null) break;
    }
    if (problem !== null) {
      // One bad entry drops the WHOLE dimension; a price list never half-applies.
      rejections.push(`${dim} holds ${problem}; the whole dimension falls back`);
      continue;
    }
    override[dim] = [...value];
    applied = true;
  }
  // Cap the list so a JSON object with hundreds of junk keys cannot flood the
  // boot console; the summary line keeps the total honest.
  const capped =
    rejections.length > MAX_REJECTIONS
      ? [
          ...rejections.slice(0, MAX_REJECTIONS),
          `...and ${rejections.length - MAX_REJECTIONS} more rejection${
            rejections.length - MAX_REJECTIONS === 1 ? '' : 's'
          }`,
        ]
      : rejections;
  return { override: applied ? override : undefined, rejections: capped };
}

// Parsed ONCE at module load (the DB_POOL_MAX_CLIENTS idiom), with one boot
// line per outcome so an operator can tell applied, rejected, and unset apart
// from the console alone: every rejection is an error naming the knob, an
// applied override logs which dimensions it covers, and unset says nothing.
// Dev-channel English: log lines, never player text.
const bootParse = parseStoragePrices(process.env.STORAGE_PRICES);
for (const rejection of bootParse.rejections) {
  // The cap's '...and N more rejections' summary counts lines rather than
  // refusing a value, so the per-rejection defaults suffix would dangle on it.
  console.error(
    rejection.startsWith('...')
      ? `STORAGE_PRICES: ${rejection}`
      : `STORAGE_PRICES: ${rejection}; the compiled default prices apply for it.`,
  );
}
export const STORAGE_PRICES: StoragePricesOverride | undefined = bootParse.override;
if (STORAGE_PRICES !== undefined) {
  console.log(`storage prices: STORAGE_PRICES overrides ${Object.keys(STORAGE_PRICES).join(', ')}`);
}
