// Where the code-owned source-writer capability meets a real connection string.
//
// server/material_source_writer.ts composes the STARTUP OPTION itself; this leaf
// answers the one question that composition cannot: what the caller's own
// options actually are when the connection string carries them in its URI.
//
// The problem it exists for. `new Pool({ connectionString, options })` does NOT
// mean "these options": node-postgres re-parses the connection string and
// assigns the parsed fields OVER the config object, so a URI carrying
// `?options=-c%20search_path%3Dfoo` silently WINS over the `options` property
// and the capability would never be announced (every guarded write would then
// abort, loudly, but for the wrong reason). So the URI's own options are LIFTED
// out of the string, carried through `withMaterialSourceWriterOption` (which
// appends the capability last and preserves the operator's bytes), and the
// lifted pair is REMOVED from the string so nothing can re-override the result.
//
// What it deliberately does NOT do:
//   * It never normalizes, re-encodes or re-serializes a connection string. The
//     string is returned BYTE-IDENTICAL unless an `options` pair was actually
//     found, and even then only that pair's bytes (and a now-empty `?`) are
//     spliced out. A URL round trip would rewrite escapes elsewhere in the
//     string, including inside a password.
//   * It never reads env, opens a connection, or logs. No message here carries
//     the connection string or any part of it: a connection string is a
//     credential.
//   * It does not understand libpq keyword/value strings (`host=... options=...`).
//     Those have no `?` query, so they are returned untouched with the
//     capability on the `options` property. If node-postgres ever parses an
//     `options` keyword out of such a string it would override the property and
//     the guard would REFUSE the write: fail-closed and loud, never a silently
//     unaudited write.

import { withMaterialSourceWriterOption } from './material_source_writer';

/** A connection string plus the startup options to pass beside it. */
export interface MaterialSourceConnection {
  /** The caller's string, byte-identical unless an `options` pair was lifted. */
  readonly connectionString: string;
  /** The caller's own options with the writer capability appended last. */
  readonly options: string;
}

const OPTIONS_PARAM = 'options';

// Static, and deliberately free of the connection string: a malformed escape is
// an operator diagnostic, and echoing the string would leak the credential it
// carries.
const UNDECODABLE_REFUSAL =
  'material source writer: the connection string carries an options parameter with a malformed ' +
  'percent escape, so its value cannot be preserved; fix the connection string';

/**
 * Query-parameter decoding as both node-postgres parsers read it: `+` is a
 * space (application/x-www-form-urlencoded, what both `querystring` and
 * `URLSearchParams` do) and percent escapes decode. Null means the value cannot
 * be decoded at all, which is a refusal rather than a guess.
 */
function decodeParam(text: string): string | null {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

/**
 * The startup configuration for one source-aware connection.
 *
 * The FIRST `options` pair wins when a string somehow carries several
 * (`URLSearchParams.get` semantics), and every one of them is removed from the
 * returned string: leaving a duplicate behind would let it override the
 * composed value, which is the whole failure this function exists to prevent.
 *
 * @throws if an `options` value carries a malformed percent escape, or (through
 * the composer) if the operator's options end in an unpaired backslash.
 */
export function materialSourceConnection(connectionString: string): MaterialSourceConnection {
  const queryStart = connectionString.indexOf('?');
  if (queryStart < 0) {
    return { connectionString, options: withMaterialSourceWriterOption(undefined) };
  }
  const hashStart = connectionString.indexOf('#', queryStart);
  const queryEnd = hashStart < 0 ? connectionString.length : hashStart;

  const kept: string[] = [];
  let carried: string | undefined;
  for (const pair of connectionString.slice(queryStart + 1, queryEnd).split('&')) {
    const equals = pair.indexOf('=');
    const key = decodeParam(equals < 0 ? pair : pair.slice(0, equals));
    if (key !== OPTIONS_PARAM) {
      kept.push(pair);
      continue;
    }
    if (carried !== undefined) continue; // a later duplicate is dropped, not read
    const value = equals < 0 ? '' : decodeParam(pair.slice(equals + 1));
    if (value === null) throw new Error(UNDECODABLE_REFUSAL);
    carried = value;
  }
  if (carried === undefined) {
    return { connectionString, options: withMaterialSourceWriterOption(undefined) };
  }

  const rest = kept.join('&');
  const head = connectionString.slice(0, queryStart);
  const tail = connectionString.slice(queryEnd);
  return {
    connectionString: rest.length === 0 ? `${head}${tail}` : `${head}?${rest}${tail}`,
    options: withMaterialSourceWriterOption(carried),
  };
}
