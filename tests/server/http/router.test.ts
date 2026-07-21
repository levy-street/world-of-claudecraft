// Unit tests for the in-house table router (server/http/router.ts): exact and
// param matching, static-beats-dynamic precedence, HEAD-as-GET and synthesized
// OPTIONS, the 405 + Allow set, single-trailing-slash normalization, and the
// build-time registration guards. The router is a PURE (method, path) ->
// MatchResult function, so these tests need no fake req/res.
import { describe, expect, it } from 'vitest';
import { createRouter, type RoutePattern } from '../../../server/http/router';

// A tiny route fixture: just a method + path plus a label so a match can be
// identified. The router is generic over `R extends RoutePattern`.
interface Fixture extends RoutePattern {
  label: string;
}
const route = (method: RoutePattern['method'], path: string): Fixture => ({
  method,
  path,
  label: `${method} ${path}`,
});

describe('createRouter: exact and param matching', () => {
  it('matches an exact static route with no params', () => {
    const r = createRouter([route('GET', '/api/characters')]);
    const m = r.match('GET', '/api/characters');
    expect(m.kind).toBe('matched');
    if (m.kind !== 'matched') return;
    expect(m.route.label).toBe('GET /api/characters');
    expect(m.params).toEqual({});
    expect(m.head).toBe(false);
  });

  it('matches a param route and captures the param', () => {
    const r = createRouter([route('DELETE', '/api/characters/:id')]);
    const m = r.match('DELETE', '/api/characters/42');
    expect(m.kind).toBe('matched');
    if (m.kind !== 'matched') return;
    expect(m.params).toEqual({ id: '42' });
    expect(m.route.label).toBe('DELETE /api/characters/:id');
  });

  it('returns notFound for an unknown path under a real method', () => {
    const r = createRouter([route('GET', '/api/characters')]);
    expect(r.match('GET', '/api/nope').kind).toBe('notFound');
  });
});

describe('createRouter: static beats dynamic', () => {
  it('prefers a literal segment over a :param at the same position', () => {
    const r = createRouter([route('GET', '/api/x/:id'), route('GET', '/api/x/special')]);
    const exact = r.match('GET', '/api/x/special');
    expect(exact.kind).toBe('matched');
    if (exact.kind === 'matched') expect(exact.route.label).toBe('GET /api/x/special');
    const param = r.match('GET', '/api/x/42');
    expect(param.kind).toBe('matched');
    if (param.kind === 'matched') {
      expect(param.route.label).toBe('GET /api/x/:id');
      expect(param.params).toEqual({ id: '42' });
    }
  });
});

describe('createRouter: HEAD is served as GET', () => {
  it('matches a HEAD request against the GET route with head: true', () => {
    const r = createRouter([route('GET', '/api/characters')]);
    const m = r.match('HEAD', '/api/characters');
    expect(m.kind).toBe('matched');
    if (m.kind !== 'matched') return;
    expect(m.head).toBe(true);
    expect(m.route.label).toBe('GET /api/characters');
  });

  it('matches a HEAD request against a PARAM GET route with head: true and captures the param', () => {
    const r = createRouter([route('GET', '/api/x/:id')]);
    const m = r.match('HEAD', '/api/x/42');
    expect(m.kind).toBe('matched');
    if (m.kind !== 'matched') return;
    expect(m.head).toBe(true);
    expect(m.params).toEqual({ id: '42' });
    expect(m.route.label).toBe('GET /api/x/:id');
  });

  it('does not match HEAD on a path that has no GET route', () => {
    const r = createRouter([route('POST', '/api/x')]);
    const m = r.match('HEAD', '/api/x');
    expect(m.kind).toBe('methodNotAllowed');
    // No GET means no synthesized HEAD in the Allow set.
    if (m.kind === 'methodNotAllowed') expect(m.allow).toEqual(['POST', 'OPTIONS']);
  });
});

describe('createRouter: 405 + Allow set', () => {
  it('returns methodNotAllowed with the full Allow list (synthesized HEAD + OPTIONS)', () => {
    const r = createRouter([route('GET', '/api/characters'), route('POST', '/api/characters')]);
    const m = r.match('DELETE', '/api/characters');
    expect(m.kind).toBe('methodNotAllowed');
    if (m.kind !== 'methodNotAllowed') return;
    expect(m.allow).toEqual(['GET', 'HEAD', 'POST', 'OPTIONS']);
  });

  it('returns 405 for an unsupported method token on a known path', () => {
    const r = createRouter([route('GET', '/api/characters')]);
    const m = r.match('BREW', '/api/characters');
    expect(m.kind).toBe('methodNotAllowed');
    if (m.kind === 'methodNotAllowed') expect(m.allow).toEqual(['GET', 'HEAD', 'OPTIONS']);
  });

  it('405s a wrong real method on a dynamic (param) route with the right Allow set', () => {
    // The canonical wrong-method-on-a-resource case: the 405 + Allow flows
    // through the dynamic matchPattern scan in computeAllow, not a static hit.
    const r = createRouter([
      route('GET', '/api/characters/:id'),
      route('DELETE', '/api/characters/:id'),
    ]);
    const m = r.match('POST', '/api/characters/42');
    expect(m.kind).toBe('methodNotAllowed');
    if (m.kind === 'methodNotAllowed')
      expect(m.allow).toEqual(['GET', 'HEAD', 'DELETE', 'OPTIONS']);
  });
});

describe('createRouter: synthesized OPTIONS', () => {
  it('synthesizes an options allow set on a known path', () => {
    const r = createRouter([route('GET', '/api/characters'), route('POST', '/api/characters')]);
    const m = r.match('OPTIONS', '/api/characters');
    expect(m.kind).toBe('options');
    if (m.kind === 'options') expect(m.allow).toEqual(['GET', 'HEAD', 'POST', 'OPTIONS']);
  });

  it('returns notFound for OPTIONS on an unknown path', () => {
    const r = createRouter([route('GET', '/api/characters')]);
    expect(r.match('OPTIONS', '/api/nope').kind).toBe('notFound');
  });

  it('synthesizes OPTIONS for a param path too', () => {
    const r = createRouter([route('DELETE', '/api/characters/:id')]);
    const m = r.match('OPTIONS', '/api/characters/42');
    expect(m.kind).toBe('options');
    if (m.kind === 'options') expect(m.allow).toEqual(['DELETE', 'OPTIONS']);
  });
});

describe('createRouter: trailing-slash normalization', () => {
  it('matches a single-trailing-slash request against the slashless route', () => {
    const r = createRouter([route('GET', '/api/characters')]);
    expect(r.match('GET', '/api/characters/').kind).toBe('matched');
  });

  it('normalizes a trailing slash on a param request', () => {
    const r = createRouter([route('DELETE', '/api/characters/:id')]);
    const m = r.match('DELETE', '/api/characters/42/');
    expect(m.kind).toBe('matched');
    if (m.kind === 'matched') expect(m.params).toEqual({ id: '42' });
  });

  it('preserves the root "/" route', () => {
    const r = createRouter([route('GET', '/')]);
    expect(r.match('GET', '/').kind).toBe('matched');
    expect(r.match('GET', '/x').kind).toBe('notFound');
  });
});

describe('createRouter: registration guards', () => {
  it('throws on a duplicate (method, path)', () => {
    expect(() => createRouter([route('GET', '/a'), route('GET', '/a')])).toThrow();
  });

  it('treats a slashed and slashless duplicate as the same route', () => {
    expect(() => createRouter([route('GET', '/a'), route('GET', '/a/')])).toThrow();
  });

  it('allows the same path under different methods', () => {
    expect(() => createRouter([route('GET', '/a'), route('POST', '/a')])).not.toThrow();
  });

  it('throws when registering a synthesized method (HEAD or OPTIONS)', () => {
    expect(() => createRouter([route('HEAD', '/a')])).toThrow();
    expect(() => createRouter([route('OPTIONS', '/a')])).toThrow();
  });

  it('throws on two param patterns of the same shape (the second would be unreachable)', () => {
    // '/a/:x' and '/a/:y' match the identical request set; the second would be
    // silently shadowed, so the build-time guard rejects it.
    expect(() => createRouter([route('GET', '/a/:x'), route('GET', '/a/:y')])).toThrow();
  });

  it('allows two dynamic patterns of different shape and resolves them in registration order', () => {
    // '/:resource/special' and '/characters/:id' have different shapes and both
    // match '/characters/special'; the FIRST registered wins. Ordering overlaps
    // by specificity is the registry's responsibility, not the router's.
    const r = createRouter([route('GET', '/:resource/special'), route('GET', '/characters/:id')]);
    const m = r.match('GET', '/characters/special');
    expect(m.kind).toBe('matched');
    if (m.kind === 'matched') {
      expect(m.route.label).toBe('GET /:resource/special');
      expect(m.params).toEqual({ resource: 'characters' });
    }
  });

  it('throws on the real admin enum-alternation route (rejected by the no-regex guard)', () => {
    expect(() =>
      createRouter([
        route('POST', '/admin/api/moderation/accounts/:id/(suspend|unsuspend|ban|unban)'),
      ]),
    ).toThrow();
  });
});

describe('createRouter: real multi-method paths (OPTIONS/405 Allow synthesis)', () => {
  // Mirrors the surface inventory: the paths registered under more than
  // one method. The Allow set is sorted by the canonical method order.
  const r = createRouter([
    route('GET', '/api/characters'),
    route('POST', '/api/characters'),
    route('POST', '/api/account/companion-token'),
    route('GET', '/api/account/companion-token'),
    route('DELETE', '/api/account/companion-token'),
    route('POST', '/api/wallet/link'),
    route('DELETE', '/api/wallet/link'),
    route('GET', '/api/discord'),
    route('DELETE', '/api/discord'),
  ]);

  it('synthesizes OPTIONS for a three-method path', () => {
    const m = r.match('OPTIONS', '/api/account/companion-token');
    expect(m.kind).toBe('options');
    if (m.kind === 'options') {
      expect(m.allow).toEqual(['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS']);
    }
  });

  it('405s a wrong method on a POST+DELETE path with the right Allow set', () => {
    const m = r.match('GET', '/api/wallet/link');
    expect(m.kind).toBe('methodNotAllowed');
    if (m.kind === 'methodNotAllowed') expect(m.allow).toEqual(['POST', 'DELETE', 'OPTIONS']);
  });

  it('synthesizes HEAD on a GET+DELETE path', () => {
    const m = r.match('OPTIONS', '/api/discord');
    expect(m.kind).toBe('options');
    if (m.kind === 'options') expect(m.allow).toEqual(['GET', 'HEAD', 'DELETE', 'OPTIONS']);
  });
});

describe('createRouter: METHOD_ORDER covers PUT and PATCH', () => {
  it('sorts PUT and PATCH into their canonical Allow positions (between POST and DELETE)', () => {
    // PUT=3 and PATCH=4 in METHOD_ORDER are otherwise never exercised; a wrong
    // order constant for either would slip through every other Allow assertion.
    const r = createRouter([
      route('GET', '/api/x'),
      route('PUT', '/api/x'),
      route('PATCH', '/api/x'),
      route('DELETE', '/api/x'),
    ]);
    const m = r.match('OPTIONS', '/api/x');
    expect(m.kind).toBe('options');
    if (m.kind === 'options') {
      expect(m.allow).toEqual(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
    }
  });
});
