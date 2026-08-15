// Pure scraper for DECLARED vitest timeouts in a test file's source text.
// Consumed by tests/suite_duration_budget.test.ts (the anti-whale ratchet) and
// driven directly by that consumer's inline source fixtures, so the parsing
// semantics are pinned by execution rather than assumed. The guard is this
// module's paired test, deliberately in one place: the fixtures below it are
// the parser's specification.
//
// The parser is a masking scanner, not a bare regex, because the first cut's
// unanchored regexes were caught counting spawn options
// (execFileSync(..., { timeout: 300_000 })), ordinary function arguments
// (someOptions({...}, 120_000)), fixture objects inside test bodies, and
// numbers inside string literals. Pass 1 masks comments and string CONTENTS
// (indices preserved), so nothing quoted can ever count; pass 2 finds
// REGISTRATION HEADS (it/test/bench/describe, their .each curried form and
// dotted modifiers, the four hooks, and vi.setConfig), bracket-matches each
// call's argument span, splits it at top-level commas, and reads timeouts only
// from the two places vitest defines them:
//   - a trailing numeric (or FLAG ? full : diet ternary) argument; the DIET
//     (second) arm counts, because that is the PR-time allowance, and the
//     sweep arm runs on the nightly, which runs the whole suite regardless;
//   - a top-level options-object argument's timeout / testTimeout /
//     hookTimeout keys (vi.setConfig's object counts the same way, since a
//     file-wide testTimeout is a per-test allowance on every test in the
//     file).
// A timeout bound to a BARE identifier resolves through a same-file
// `const NAME = <number>` binding when one exists (two suites declare their
// hook budgets that way); anything unresolvable is reported in `unparsed`
// rather than silently skipped, and the consumer fails the suite on it, so
// moving an allowance behind an opaque constant cannot evade the ledger.
//
// Values at or below the repo default testTimeout (20s, vite.config.ts) are
// ignored: a declaration that lowers a test's allowance is not added
// allowance (vitest's HOOK default is 10s, so a 10-to-20s hook declaration is
// technically added allowance this floor ignores; recorded, accepted).
// Deliberate limitations, stated where the consumer states its contract: this
// reads ALLOWANCES, not runtimes; describe-body collection work and it.each
// expansion are invisible; a describe-level timeout counts ONCE though it
// applies to every case in the block; hook timeouts count as single
// allowances (a hook is a serial chain too).

export interface DeclaredTimeouts {
  perTest: number[];
  sum: number;
  /** Timeout declarations bound to bare identifiers this parser cannot read. */
  unparsed: string[];
}

// Count only allowances strictly above the repo default testTimeout of 20s.
const MIN_COUNTED_MS = 20_001;

// The dotted suffix is restricted to vitest's REAL modifiers: an unrestricted
// `(?:\.\w+)*` let an ordinary method call on a local variable named `test`
// (tests/lockpick_controller.test.ts has `test.controller.end(...)`) parse as
// a registration head and mint phantom allowances from its numeric arguments.
const HEAD_RE =
  /(?:\b(?:it|test|bench|describe)\b(?:\.(?:only|skip|todo|fails|concurrent|sequential|shuffle|each|for|skipIf|runIf|extend)\b)*|\b(?:beforeAll|beforeEach|afterAll|afterEach)\b|\bvi\.setConfig)\s*\(/g;

/**
 * Replace comment text and string CONTENTS with spaces, preserving length and
 * indices. Template literals mask to spaces too, with `${` re-entering code
 * state so brackets inside interpolations still balance.
 */
export function maskCommentsAndStrings(source: string): string {
  const out = source.split('');
  type State = 'code' | 'line' | 'block' | 'single' | 'double' | 'template' | 'regex';
  const stack: State[] = [];
  let state: State = 'code';
  // The last significant code character, for the division-vs-regex-literal
  // decision: a `/` after a value continues an expression (division); after an
  // operator, opener, or line start it begins a regex literal. Without this
  // state a regex containing an odd number of quotes (`/it's/`) flipped the
  // scanner into string state and silently masked the rest of the file.
  let lastCode = '';
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line';
        out[i] = ' ';
      } else if (ch === '/' && next === '*') {
        state = 'block';
        out[i] = ' ';
      } else if (ch === '/' && (lastCode === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(lastCode))) {
        state = 'regex';
        inClass = false;
      } else if (ch === "'") state = 'single';
      else if (ch === '"') state = 'double';
      else if (ch === '`') state = 'template';
      else if (ch === '}' && stack.length > 0) {
        // Close of a template interpolation: back into the template.
        state = stack.pop() as State;
      }
      if (state === 'code' && !/\s/.test(ch)) lastCode = ch;
      continue;
    }
    if (state === 'regex') {
      if (ch === '\\') {
        out[i] = ' ';
        if (i + 1 < source.length && source[i + 1] !== '\n') out[i + 1] = ' ';
        i++;
        continue;
      }
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      if ((ch === '/' && !inClass) || ch === '\n') {
        state = 'code';
        lastCode = '/';
        continue;
      }
      out[i] = ' ';
      continue;
    }
    if (state === 'line') {
      if (ch === '\n') state = 'code';
      else out[i] = ' ';
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i++;
        state = 'code';
      } else if (ch !== '\n') out[i] = ' ';
      continue;
    }
    // Inside a string. Quotes stay visible; contents mask to spaces.
    if (ch === '\\') {
      out[i] = ' ';
      if (i + 1 < source.length && source[i + 1] !== '\n') out[i + 1] = ' ';
      i++;
      continue;
    }
    if (state === 'single' && ch === "'") state = 'code';
    else if (state === 'double' && ch === '"') state = 'code';
    else if (state === 'template' && ch === '`') state = 'code';
    else if (state === 'template' && ch === '$' && next === '{') {
      out[i] = ' ';
      // Leave the `{` visible so bracket depth stays balanced with the `}`.
      stack.push('template');
      state = 'code';
      i++;
    } else if (ch !== '\n') out[i] = ' ';
  }
  return out.join('');
}

/** Index just past the matching close paren, or -1 when unbalanced. */
function matchParen(masked: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Split a call's argument span at top-level commas (masked indices). */
function splitArgs(masked: string, start: number, end: number): { from: number; to: number }[] {
  const args: { from: number; to: number }[] = [];
  let depth = 0;
  let from = start;
  for (let i = start; i < end; i++) {
    const ch = masked[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      args.push({ from, to: i });
      from = i + 1;
    }
  }
  if (end > from) args.push({ from, to: end });
  return args;
}

const NUMERIC_ARG_RE = /^\s*([0-9][0-9_]*)\s*,?\s*$/;
const TERNARY_ARG_RE = /^\s*[A-Za-z_$][\w$.]*\s*\?\s*([0-9][0-9_]*)\s*:\s*([0-9][0-9_]*)\s*,?\s*$/;
const IDENT_ARG_RE = /^\s*([A-Za-z_$][\w$.]*)\s*,?\s*$/;
const OPTION_KEY_RE =
  /\b(timeout|testTimeout|hookTimeout):\s*(?:[A-Za-z_$][\w$.]*\s*\?\s*([0-9][0-9_]*)\s*:\s*([0-9][0-9_]*)|([0-9][0-9_]*)|([A-Za-z_$][\w$.]*))/g;

export function declaredTimeouts(source: string): DeclaredTimeouts {
  const masked = maskCommentsAndStrings(source);
  const perTest: number[] = [];
  const unparsed: string[] = [];
  const record = (value: number) => {
    if (value >= MIN_COUNTED_MS) perTest.push(value);
  };
  const resolveConst = (name: string): number | null => {
    const short = name.split('.').pop() ?? name;
    const binding = masked.match(
      new RegExp(`\\bconst\\s+${short.replace(/\$/g, '\\$')}\\s*=\\s*([0-9][0-9_]*)\\s*[;\\n]`),
    );
    return binding ? Number(binding[1].replace(/_/g, '')) : null;
  };

  for (const head of masked.matchAll(HEAD_RE)) {
    const isSetConfig = head[0].includes('setConfig');
    const isHook = /^(?:before|after)/.test(head[0]);
    let open = head.index + head[0].length - 1;
    let close = matchParen(masked, open);
    if (close < 0) continue;
    // The curried it.each(TABLE)('title', fn, timeout) form: the registration
    // arguments live in the SECOND call group.
    const following = masked.slice(close).match(/^\s*\(/);
    if (following && !isSetConfig && !isHook) {
      open = close + following[0].length - 1;
      close = matchParen(masked, open);
      if (close < 0) continue;
    }
    const args = splitArgs(masked, open + 1, close - 1);
    for (const [argIndex, arg] of args.entries()) {
      const maskedArg = masked.slice(arg.from, arg.to);
      const sourceArg = source.slice(arg.from, arg.to);
      const trimmed = maskedArg.trim();
      if (trimmed.startsWith('{')) {
        // A top-level options object (or setConfig's config object): read its
        // timeout keys at the object's own top level only, so a nested
        // fixture cannot count.
        const inner = maskedArg.slice(maskedArg.indexOf('{') + 1);
        let cut = inner.length;
        {
          let depth = 0;
          for (let i = 0; i < inner.length; i++) {
            const ch = inner[i];
            if (ch === '(' || ch === '[' || ch === '{') depth++;
            else if (ch === ')' || ch === ']' || ch === '}') {
              if (depth === 0) {
                cut = i;
                break;
              }
              depth--;
            }
          }
        }
        const top = inner
          .slice(0, cut)
          .replace(/[[{(][\s\S]*?[)\]}]/g, (m) => ' '.repeat(m.length));
        for (const key of top.matchAll(OPTION_KEY_RE)) {
          if (key[5]) {
            const resolved = resolveConst(key[5]);
            if (resolved !== null) record(resolved);
            else unparsed.push(`${key[1]}: ${key[5]}`);
          } else {
            const value = Number((key[3] ?? key[4]).replace(/_/g, ''));
            record(value);
          }
        }
        continue;
      }
      // Only a LAST argument can be the trailing timeout form.
      if (argIndex !== args.length - 1 || argIndex === 0 || isSetConfig) continue;
      const numeric = maskedArg.match(NUMERIC_ARG_RE);
      if (numeric) {
        record(Number(numeric[1].replace(/_/g, '')));
        continue;
      }
      const ternary = maskedArg.match(TERNARY_ARG_RE);
      if (ternary) {
        record(Number(ternary[2].replace(/_/g, '')));
        continue;
      }
      const ident = maskedArg.match(IDENT_ARG_RE);
      // A trailing bare identifier: POSITION decides whether it is a timeout,
      // not the name (a name gate was caught letting `it('x', fn, BUDGET)`
      // slip through green). When the PREVIOUS argument is a function literal,
      // the trailing identifier occupies vitest's timeout slot and must
      // resolve or fail; when the previous argument is an options object or a
      // string, the trailing identifier is a test-fn reference and is skipped.
      // The timeout-looking-name check stays as a fallback trigger for
      // unusual shapes (a fn REFERENCE in the middle slot).
      if (ident && !isSetConfig) {
        const prev =
          argIndex > 0 ? masked.slice(args[argIndex - 1].from, args[argIndex - 1].to).trim() : '';
        const prevIsFunction = /^(?:async\b|function\b|\()/.test(prev);
        if (prevIsFunction || /TIMEOUT|_MS$/i.test(ident[1])) {
          const resolved = resolveConst(ident[1]);
          if (resolved !== null) record(resolved);
          else unparsed.push(`trailing ${ident[1]} (${sourceArg.trim().slice(0, 40)})`);
        }
      }
    }
  }
  return { perTest, sum: perTest.reduce((total, value) => total + value, 0), unparsed };
}
