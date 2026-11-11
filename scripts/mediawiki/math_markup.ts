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

/** "Stat × a × frac(b, c)", followed by "= Stat × 0.4" or "≈ Stat × 0.4286" when there is
 *  more than one number to combine, so a reader never has to work out the order. */
export function scaledStat(stat: string, factors: Factor[]): string {
  if (!factors.length) return math(stat);
  const expr = factors.reduce(
    (text, f) => text + (typeof f === 'object' && 'div' in f ? ' ' : ' × ') + factorText(f),
    stat,
  );
  const single = factors.length === 1 && typeof factors[0] === 'number';
  if (single) return math(expr);
  const value = factors.reduce<number>((v, f) => v * factorValue(f), 1);
  const shown = Number(value.toFixed(4));
  return math(`${expr} ${shown === value ? '=' : '≈'} ${stat} × ${shown}`);
}
