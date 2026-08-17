// Does the image build context still carry everything vite.config.ts imports?
//
// The Dockerfile copies the repo through .dockerignore, which excludes
// `scripts/*` wholesale and then allowlists individual files. vite.config.ts
// imports several of those at module scope, so a `vite build` inside the image
// FAILS TO LOAD ITS OWN CONFIG the moment someone adds an import whose target
// is not on the allowlist. That has now shipped twice (build_bundle_pregen.mjs,
// then the ci_balanced_sequencer.mjs chain), because CI builds with the whole
// repo present and never exercises the .dockerignore filter.
//
// These two helpers are the machine-checkable half of that contract:
// collectLocalImportClosure walks what the config actually imports, and
// isIgnoredByDockerignore answers whether the filter would drop it. Both are
// pure so tests/dockerignore_context.test.ts can drive them off fixtures as
// well as off the real repo.

// One .dockerignore pattern as an anchored RegExp.
//
// Docker's matcher is Go filepath.Match plus `**`, evaluated against a
// context-relative, slash-separated path. A pattern that matches a DIRECTORY
// also excludes everything beneath it, which is why every pattern here is
// suffixed with an optional `/...` tail: that tail is what makes the real
// `scripts/*` line exclude `scripts/lib/foo.mjs`, and it is exactly why the
// `!scripts/lib/` line below it has to exist at all.
function patternToRegExp(pattern) {
  const trimmed = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
  let source = '';
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === '*') {
      if (trimmed[i + 1] === '*') {
        i++;
        if (trimmed[i + 1] === '/') {
          i++;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}(?:/.*)?$`);
}

/** Would .dockerignore drop `path` from the build context? Last match wins, and
 *  a `!` line un-drops it, which is how the allowlist under `scripts/*` works. */
export function isIgnoredByDockerignore(dockerignore, path) {
  let ignored = false;
  for (const rawLine of String(dockerignore).split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    const body = (negated ? line.slice(1) : line).trim();
    if (!body) continue;
    if (patternToRegExp(body).test(path)) ignored = !negated;
  }
  return ignored;
}

// Relative specifiers only: a bare specifier is a package resolved from
// node_modules, which the image installs itself and .dockerignore never filters.
const LOCAL_SPECIFIER = /(?:from\s*|import\s*\(\s*)['"](\.[^'"]+)['"]/g;

function resolveRelative(fromPath, specifier) {
  const segments = fromPath.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  return segments.join('/');
}

/** Every repo-relative file reachable from `entry` through relative imports,
 *  entry included. `readFile` returns null for a path that is not a readable
 *  source file, which ends that branch of the walk. */
export function collectLocalImportClosure(entry, readFile) {
  const seen = new Set();
  const closure = [];
  const pending = [entry];
  while (pending.length > 0) {
    const path = pending.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    const source = readFile(path);
    if (source === null || source === undefined) continue;
    closure.push(path);
    for (const match of String(source).matchAll(LOCAL_SPECIFIER)) {
      pending.push(resolveRelative(path, match[1]));
    }
  }
  return closure;
}
