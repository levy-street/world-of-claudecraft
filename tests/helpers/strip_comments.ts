/**
 * Comment stripper for source-scan pins, in the order-safe single-pass form
 * (the same tokenization as the local copy in tests/architecture.test.ts).
 *
 * A two-pass stripper that removes block comments FIRST treats a bare `/*`
 * inside a line comment as a block opener and swallows every real line down
 * to the next block closer in the file. src/main.ts carries exactly that
 * shape (a route-prose line comment near line 3144), which silently exempted
 * roughly 1,950 lines from every block-first sweep that read it. Stripping
 * line comments in the SAME pass closes that hole, and the single alternation
 * is immune in BOTH directions: a `//` inside a block comment cannot eat the
 * block's closer either, because each comment is consumed exactly once.
 *
 * Behavior, stated precisely:
 * - Block comments are blanked to spaces, so line count and the column
 *   offsets of following lines survive for offset-sensitive scans.
 * - Line comments are deleted to end of line (the newline survives).
 * - The not-after-a-colon guard keeps protocol strings (`http://`, `app://`)
 *   intact, the stripper bug this repo already shipped once (#2499). It is a
 *   LOOKBEHIND rather than the consuming `(^|[^:])` form: a consuming guard
 *   needs one unclaimed character before the `//`, and when a line comment
 *   immediately follows a block comment's closing marker the block arm has
 *   already eaten that character, so the line comment would survive and its
 *   text could satisfy a positive pin (gate-integrity finding, phase 11).
 * - Comment markers inside STRING literals are not understood (no stripper in
 *   this repo tokenizes strings); a `/*` inside a string still opens a
 *   phantom block in any pass order. Guards that pin such content must reason
 *   about it case by case.
 *
 * Many suites read through this one function, so its own behavior is pinned
 * by `strip_comments.test.ts` rather than only through its consumers.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|(?<=^|[^:])\/\/[^\n]*/gm, (m) =>
    m.startsWith('/*') ? m.replace(/[^\n]/g, ' ') : '',
  );
}
