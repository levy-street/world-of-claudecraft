// Text sanitation shared by the client perf-report ingest (server/perf_report.ts).
//
// Its whole reason to exist is one Postgres rule: U+0000 is REJECTED in a text
// parameter and in a jsonb value alike, so a single NUL anywhere in a beacon
// fails the entire INSERT and loses the whole report rather than one field. The
// other C0 controls and DEL are not legitimate in any field this ingest stores
// either, so the same pass drops them all. Stripped rather than rejected, on
// the same principle as every other clamp in the ingest: a beacon is never
// refused over its diagnostics.
//
// Pure and dependency-free, so tests/server/perf_report_text.test.ts exercises
// it directly without a request, a pool, or a clock.

/** Whether a string carries a C0 control character or DEL. */
function hasControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * The string without C0 controls and DEL.
 *
 * Written as a code scan rather than a regex literal: a character class over
 * this range is itself a lint error, and the fast path (the overwhelming
 * majority of reports carry none) costs one pass with no allocation.
 */
export function stripControlChars(text: string): string {
  if (!hasControlChar(text)) return text;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x20 && code !== 0x7f) out += text[i];
  }
  return out;
}

/**
 * Strip control characters from every string in a parsed JSON value, KEYS
 * included, in place.
 *
 * The columns the ingest clamps field by field are only half the exposure:
 * raw_summary is jsonb and round-trips client-shaped objects, and jsonb rejects
 * a backslash-u-0000 escape exactly as a text parameter rejects the raw
 * character, with the same one-report-lost result. Keys matter as much as
 * values, since a beacon controls both.
 *
 * Iterative rather than recursive: the input is attacker-shaped, and a nesting
 * depth that JSON.parse accepts must not be able to overflow the walker's own
 * stack. Cycle-free by contract, which is what JSON.parse output always is.
 */
export function stripJsonControlChars<T>(value: T): T {
  if (typeof value === 'string') return stripControlChars(value) as unknown as T;
  if (!value || typeof value !== 'object') return value;
  const stack: object[] = [value];
  while (stack.length > 0) {
    const node = stack.pop() as object;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const entry: unknown = node[i];
        if (typeof entry === 'string') node[i] = stripControlChars(entry);
        else if (entry && typeof entry === 'object') stack.push(entry);
      }
      continue;
    }
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const raw: unknown = record[key];
      const entry = typeof raw === 'string' ? stripControlChars(raw) : raw;
      if (entry && typeof entry === 'object') stack.push(entry as object);
      const cleanKey = stripControlChars(key);
      if (cleanKey === key) {
        if (entry !== raw) record[key] = entry;
        continue;
      }
      delete record[key];
      // defineProperty, never assignment: a key that strips down to __proto__
      // would otherwise reach Object.prototype's setter and swap the object's
      // prototype instead of adding a property.
      Object.defineProperty(record, cleanKey, {
        value: entry,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  }
  return value;
}
