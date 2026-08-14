/**
 * Source with its full-line `//` comments removed, for guards that pin a
 * literal line of code.
 *
 * The rule these guards share: the code a source-scan pin names is routinely
 * explained in prose right beside itself, so a raw-text scan can be satisfied
 * by a commented-out line or by the sentence describing it, and the pin then
 * stays green over code that is no longer there. Stripping full lines only is
 * deliberate: a trailing comment leaves the statement in front of it intact,
 * which is exactly what a pin matches on.
 *
 * Many suites read through this one function (`grep -rl
 * code_without_line_comments tests/` enumerates them), so its own behaviour is
 * pinned by `code_without_line_comments.test.ts` rather than only through its
 * consumers: a regression that returned the input unchanged would otherwise
 * soften all of those pins at once with nothing going red. A few older raw
 * reads remain (the manifest parse in `prewarm_policy.test.ts`, for one); route
 * a pin through here when you touch one.
 *
 * Residual, stated rather than implied: only `//` lines go. A pin's text
 * sitting inside a block comment or a JSDoc line still satisfies it.
 */
export function codeWithoutLineComments(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}
