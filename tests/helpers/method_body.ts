// The one shared bound for source pins over a class method's body.
//
// Slices `opener` through the method's own two-space closing brace: inner
// blocks close at deeper indents, so the first `\n  }` after the opener is
// the method end. Grew out of #2931, where three suites spelled this slice
// three ways and the flat `[^}]*` shape they replaced broke on the first
// brace-bearing sibling arm.
//
// Stated limit: a two-space-indented `}` inside a template literal would end
// the slice early. No hud.ts method does that today, and both anchors throw
// loudly when missing, so a renamed or restructured method fails here with a
// message instead of slicing an empty, vacuously passing span.
export function methodBody(source: string, opener: string): string {
  const start = source.indexOf(opener);
  if (start === -1) throw new Error(`methodBody: anchor not found: ${opener}`);
  const end = source.indexOf('\n  }', start);
  if (end === -1) throw new Error(`methodBody: no two-space close after: ${opener}`);
  return source.slice(start, end);
}
