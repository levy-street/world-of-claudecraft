// One line for every rank of an ability, the way game wikis write it:
// "Heals for 42 to 51 / 76 to 90 / 122 to 144" instead of a section per rank.

// A value is a number (with an optional "to" range or % sign), a whole formula or a
// whole link. Formulas and links are kept in one piece so a slash never lands inside one.
const VALUE =
  /(<woc-math>[\s\S]*?<\/woc-math>|\[\[[^\]]*\]\]|\d[\d,]*(?:\.\d+)?%?(?: to \d[\d,]*(?:\.\d+)?%?)?)/;

/** Joins values that are not all the same with " / ", in rank order. */
export function rankValues(values: readonly (string | number)[]): string {
  const all = values.map(String);
  return all.every((v) => v === all[0]) ? all[0] : all.join(' / ');
}

/**
 * Merges the same sentence written once per rank. Words must match across ranks;
 * numbers that differ are listed in rank order and set in bold. Returns null when
 * the ranks say different things, so the caller can list them one by one.
 */
export function mergeRankText(texts: readonly string[]): string | null {
  if (!texts.length) return null;
  if (texts.every((t) => t === texts[0])) return texts[0];
  const parts = texts.map((t) => t.split(VALUE));
  if (parts.some((p) => p.length !== parts[0].length)) return null;
  let out = '';
  for (let i = 0; i < parts[0].length; i++) {
    const column = parts.map((p) => p[i]);
    const same = column.every((v) => v === column[0]);
    // Even slots are the words between values: they must agree.
    if (i % 2 === 0) {
      if (!same) return null;
      out += column[0];
    } else out += same ? column[0] : "'''" + column.join(' / ') + "'''";
  }
  return out;
}
