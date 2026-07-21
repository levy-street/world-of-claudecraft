// Unit tests for the pure path-pattern helper (server/http/path_pattern.ts):
// the compiler, the no-regex routing guard, the single-trailing-slash
// normalizer, and the no-regex matcher. These are host-agnostic and need none
// of the fake-http / fakeCtx helpers; the helper is pure.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compilePattern, matchPattern, normalizePath } from '../../../server/http/path_pattern';

describe('normalizePath', () => {
  it('strips exactly one trailing slash', () => {
    expect(normalizePath('/api/characters/')).toBe('/api/characters');
    expect(normalizePath('/api/x/:id/')).toBe('/api/x/:id');
  });

  it('preserves the root "/"', () => {
    expect(normalizePath('/')).toBe('/');
  });

  it('leaves a path without a trailing slash untouched', () => {
    expect(normalizePath('/api/characters')).toBe('/api/characters');
  });

  it('strips only ONE slash and does not collapse internal slashes', () => {
    // Two trailing slashes lose exactly one; an internal double slash is kept.
    expect(normalizePath('/api/x//')).toBe('/api/x/');
    expect(normalizePath('/api//x')).toBe('/api//x');
  });

  it('does not decode percent-encoding or resolve ".."', () => {
    expect(normalizePath('/api/%2e%2e/admin')).toBe('/api/%2e%2e/admin');
    expect(normalizePath('/api/../admin')).toBe('/api/../admin');
  });
});

describe('compilePattern: literal patterns', () => {
  it('compiles a fully static path to literal segments', () => {
    const p = compilePattern('/api/characters');
    expect(p.isStatic).toBe(true);
    expect(p.paramNames).toEqual([]);
    expect(p.segments).toEqual([
      { kind: 'literal', value: 'api' },
      { kind: 'literal', value: 'characters' },
    ]);
    expect(p.raw).toBe('/api/characters');
  });

  it('compiles the root "/" to zero segments', () => {
    const p = compilePattern('/');
    expect(p.isStatic).toBe(true);
    expect(p.segments).toEqual([]);
    expect(p.paramNames).toEqual([]);
  });

  it('tolerates a single trailing slash (compiles like the slashless form)', () => {
    expect(compilePattern('/api/characters/').segments).toEqual(
      compilePattern('/api/characters').segments,
    );
  });

  it('allows a literal dot (matched by equality, not as a wildcard)', () => {
    const p = compilePattern('/.well-known/openid-configuration');
    expect(p.isStatic).toBe(true);
    expect(p.segments[0]).toEqual({ kind: 'literal', value: '.well-known' });
  });
});

describe('compilePattern: param patterns', () => {
  it('captures a single ":name" param', () => {
    const p = compilePattern('/api/characters/:id');
    expect(p.isStatic).toBe(false);
    expect(p.paramNames).toEqual(['id']);
    expect(p.segments).toEqual([
      { kind: 'literal', value: 'api' },
      { kind: 'literal', value: 'characters' },
      { kind: 'param', name: 'id' },
    ]);
  });

  it('preserves param-name declaration order', () => {
    const p = compilePattern('/a/:foo/b/:bar');
    expect(p.paramNames).toEqual(['foo', 'bar']);
  });

  it('accepts underscore-led and mixed-case param names', () => {
    expect(compilePattern('/x/:_id').paramNames).toEqual(['_id']);
    expect(compilePattern('/x/:userId2').paramNames).toEqual(['userId2']);
  });
});

describe('compilePattern: the no-regex routing guard THROWS', () => {
  it('rejects an alternation group "(a|b)"', () => {
    expect(() => compilePattern('/a/(b|c)')).toThrow();
  });

  it('rejects a wildcard "*"', () => {
    expect(() => compilePattern('/a/*')).toThrow();
  });

  it('rejects a bare ":"', () => {
    expect(() => compilePattern('/a/:')).toThrow();
  });

  it('rejects a malformed param name ":1bad"', () => {
    expect(() => compilePattern('/a/:1bad')).toThrow();
  });

  it('rejects regex anchors "/^x$/"', () => {
    expect(() => compilePattern('/^x$/')).toThrow();
  });

  it('rejects a duplicate param name ":id/:id"', () => {
    expect(() => compilePattern('/a/:id/:id')).toThrow();
  });

  it('rejects a reserved param name (__proto__, constructor, prototype)', () => {
    expect(() => compilePattern('/a/:__proto__')).toThrow();
    expect(() => compilePattern('/a/:constructor')).toThrow();
    expect(() => compilePattern('/a/:prototype')).toThrow();
  });

  it('rejects a ":" that is not at the start of a segment', () => {
    expect(() => compilePattern('/a/x:y')).toThrow();
  });

  it('rejects an internal empty segment (double slash)', () => {
    expect(() => compilePattern('/a//b')).toThrow();
  });

  it('rejects a path that does not start with "/"', () => {
    expect(() => compilePattern('a/b')).toThrow();
    expect(() => compilePattern('')).toThrow();
  });

  it('rejects the real admin enum-alternation route (restructured to :param + schema in the migrated admin surface)', () => {
    expect(() =>
      compilePattern('/admin/api/moderation/accounts/:id/(suspend|unsuspend|ban|unban)'),
    ).toThrow();
  });
});

describe('matchPattern', () => {
  it('matches a static pattern and returns no params', () => {
    const p = compilePattern('/api/characters');
    expect(matchPattern(p, '/api/characters')).toEqual({});
    expect(matchPattern(p, '/api/guilds')).toBeNull();
  });

  it('captures a param value', () => {
    const p = compilePattern('/api/characters/:id');
    expect(matchPattern(p, '/api/characters/42')).toEqual({ id: '42' });
  });

  it('returns null on a segment-count mismatch', () => {
    const p = compilePattern('/api/characters/:id');
    expect(matchPattern(p, '/api/characters')).toBeNull();
    expect(matchPattern(p, '/api/characters/42/extra')).toBeNull();
  });

  it('does not capture an empty segment for a param', () => {
    // A normalized path never has a trailing slash, but a param must still never
    // capture an empty segment (so a stray '//' cannot satisfy a ":name").
    const p = compilePattern('/a/:id');
    expect(matchPattern(p, '/a/')).toBeNull();
  });

  it('does not collapse internal slashes', () => {
    const p = compilePattern('/a/b');
    expect(matchPattern(p, '/a//b')).toBeNull();
  });

  it('captures a value containing regex-special characters as a literal string', () => {
    // Proves matching is string equality, not regex: an id like "a.b+c" (every
    // char a regex metacharacter) is captured verbatim, not interpreted.
    const p = compilePattern('/api/x/:id');
    expect(matchPattern(p, '/api/x/a.b+c')).toEqual({ id: 'a.b+c' });
    expect(matchPattern(p, '/api/x/(weird)')).toEqual({ id: '(weird)' });
  });

  it('captures multiple params in declaration order', () => {
    // A regression that dropped or swapped the second capture (a mis-keyed
    // assignment or an off-by-one over the segments) would otherwise pass.
    const p = compilePattern('/a/:foo/b/:bar');
    expect(matchPattern(p, '/a/1/b/2')).toEqual({ foo: '1', bar: '2' });
  });

  it('returns a null-prototype params object (no inherited keys leak)', () => {
    // matchPattern accumulates into an Object.create(null) bag so a downstream
    // lookup by an untrusted key can never read an inherited Object.prototype
    // member; belt-and-suspenders on top of the reserved-param-name guard.
    const params = matchPattern(compilePattern('/api/x/:id'), '/api/x/42');
    expect(params).not.toBeNull();
    expect(Object.getPrototypeOf(params)).toBeNull();
    expect((params as Record<string, unknown>).toString).toBeUndefined();
  });
});

describe('no regex usage (structural)', () => {
  it('neither path_pattern.ts nor router.ts uses a regular expression', () => {
    // The guard and the matcher are no-regex by construction: char-by-char
    // validation and string-equality matching. This scans both source files for
    // the RegExp identifier AND the regex-bearing string methods, so a future
    // regression that reintroduced a regex (via `new RegExp`, a regex literal
    // passed to .match/.replace/.split, or .test/.exec) fails the gate, not just
    // a literal `new RegExp`.
    const sources: Record<string, string> = {
      'path_pattern.ts': readFileSync(
        new URL('../../../server/http/path_pattern.ts', import.meta.url),
        'utf8',
      ),
      'router.ts': readFileSync(new URL('../../../server/http/router.ts', import.meta.url), 'utf8'),
    };
    const forbidden = [
      'RegExp',
      '.test(',
      '.exec(',
      '.match(',
      '.matchAll(',
      '.replace(',
      '.replaceAll(',
      '.search(',
      '.split(/',
    ];
    for (const [name, src] of Object.entries(sources)) {
      for (const token of forbidden) {
        expect(src, `${name} must not contain ${token}`).not.toContain(token);
      }
    }
  });
});

describe('server-only purity (structural)', () => {
  it('imports nothing from a parent dir (src/sim/render/ui/game/net) or a node builtin', () => {
    // Criterion 16: the router and its helper stay pure server-only descriptor
    // code so compose/errors/dispatch own every req/res write. They may import only sibling
    // './' modules; a parent-relative import ('../') or any node: builtin import
    // is forbidden. The match signatures take no req/res, so tsc already
    // guarantees the no-req/res half of the invariant; this pins the imports.
    const sources: Record<string, string> = {
      'path_pattern.ts': readFileSync(
        new URL('../../../server/http/path_pattern.ts', import.meta.url),
        'utf8',
      ),
      'router.ts': readFileSync(new URL('../../../server/http/router.ts', import.meta.url), 'utf8'),
    };
    const forbidden = ["from '../", 'from "../', "from 'node:", 'from "node:', 'require('];
    for (const [name, src] of Object.entries(sources)) {
      for (const token of forbidden) {
        expect(src, `${name} must not import via ${token}`).not.toContain(token);
      }
    }
  });
});
