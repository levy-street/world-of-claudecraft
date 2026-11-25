// Formulas in the encyclopedia are written as <woc-math> blocks so the reader and
// MediaWiki can draw real fractions instead of an ambiguous "a × b / c" line.
// Inside a block, `frac(top, bottom)` is a stacked fraction; everything else is text.
// The parts of a fraction must not contain parentheses or commas.

export type Factor = number | { frac: [number | string, number | string] } | { div: number };

export const frac = (top: number | string, bottom: number | string) => `frac(${top}, ${bottom})`;
export const math = (expr: string) => `<woc-math>${expr}</woc-math>`;

const factorText = (f: Factor) =>
  typeof f === 'number' ? String(f) : 'frac' in f ? frac(f.frac[0], f.frac[1]) : `÷ ${f.div}`;

const factorValue = (f: Factor) =>
  typeof f === 'number' ? f : 'frac' in f ? Number(f.frac[0]) / Number(f.frac[1]) : 1 / f.div;

const percent = (value: number) => `${Number((value * 100).toFixed(1))}%`;

/** A bonus written the short way, "(+ 8% Ranged Attack Power)", with its working (and an
 *  optional note) shown when the reader points at it. Attribute text must not hold quotes. */
export function bonus(label: string, expr: string, note = ''): string {
  return `<woc-math label="+ ${label}"${note ? ` note="${note}"` : ''}>${expr}</woc-math>`;
}

/** "(+ 8% Stat)" for a plain share of a stat, such as 0.08 × Ranged Attack Power. */
export const share = (fraction: number, stat: string, note = '') =>
  bonus(`${percent(fraction)} ${stat}`, `${stat} × ${fraction}`, note);

/** A power bonus. The page shows the short label, "(+ 85.7% Healing Power)", and the
 *  full working appears when the reader points at it. The working is
 *  "Stat × a × frac(b, c)", followed by "= Stat × 0.4" or "≈ Stat × 0.4286" when there is
 *  more than one number to combine, so a reader never has to work out the order. */
export function scaledStat(stat: string, factors: Factor[]): string {
  const labelled = (value: number, expr: string) =>
    bonus(`${percent(value)} ${stat}`, expr, 'Rounded to the nearest whole number.');
  if (!factors.length) return labelled(1, stat);
  const expr = factors.reduce(
    (text, f) => text + (typeof f === 'object' && 'div' in f ? ' ' : ' × ') + factorText(f),
    stat,
  );
  const single = factors.length === 1 && typeof factors[0] === 'number';
  if (single) return labelled(factors[0] as number, expr);
  const value = factors.reduce<number>((v, f) => v * factorValue(f), 1);
  const shown = Number(value.toFixed(4));
  return labelled(value, `${expr} ${shown === value ? '=' : '≈'} ${stat} × ${shown}`);
}
