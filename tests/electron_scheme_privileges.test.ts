import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const main = readFileSync(join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');

// electron/main.cjs is the Electron entry and cannot run under vitest, so the
// app:// scheme registration is pinned as text (same rationale as the updater
// and gpu wiring pins). Every privilege here is load-bearing and fails soft
// when lost: standard gives the scheme real URL semantics (relative
// resolution, origins), secure marks it a secure context, supportFetchAPI
// lets the client fetch() its own assets, corsEnabled keeps cross-origin
// checks coherent, and codeCache enables the V8 compile cache for app://
// scripts (codeCache requires standard). A refactor that rebuilds the
// privileges object and silently drops one would not fail any runtime test,
// so the pin covers four dodge vectors: the object is pinned key by key with
// exact values, the key set is pinned exactly so a dangerous privilege
// (bypassCSP, allowServiceWorkers, stream) cannot ride in on the app entry,
// the entry list is pinned to the app entry alone so a second privileged
// scheme cannot ride in beside it, and the call position is pinned because
// Electron only honors registerSchemesAsPrivileged before app ready: the
// same text inside a handler or below whenReady would pass a position-blind
// scan while silently applying nothing.
describe('app:// scheme privileges pin (electron/main.cjs)', () => {
  it('registers privileged schemes exactly once, at top level, before app ready', () => {
    // The privileges scan anchors on the app entry, but only inside the first
    // call; this count keeps a second registration from dodging that scan.
    const occurrences = main.split('protocol.registerSchemesAsPrivileged(').length - 1;
    expect(occurrences, 'expected exactly one registerSchemesAsPrivileged call').toBe(1);
    expect(
      /^protocol\.registerSchemesAsPrivileged\(/m.test(main),
      'registerSchemesAsPrivileged must be a top-level statement (column 0)',
    ).toBe(true);
    const start = main.indexOf('protocol.registerSchemesAsPrivileged(');
    const ready = main.indexOf('app.whenReady()');
    expect(ready, 'app.whenReady() not found in main.cjs').toBeGreaterThan(-1);
    expect(start, 'registerSchemesAsPrivileged must appear before app.whenReady()').toBeLessThan(
      ready,
    );
  });

  it('carries standard, secure, supportFetchAPI, corsEnabled, and codeCache, and nothing else', () => {
    const start = main.indexOf('protocol.registerSchemesAsPrivileged(');
    expect(start, 'registerSchemesAsPrivileged call not found in main.cjs').toBeGreaterThan(-1);
    const end = main.indexOf(']);', start);
    expect(end, 'unterminated registerSchemesAsPrivileged call').toBeGreaterThan(start);
    // Strip block comments and line comments (whole-line and trailing) before
    // scanning, so a commented-out privilege reads as absent rather than
    // present in every comment form.
    const call = main
      .slice(start, end)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    // The app entry must be the ONLY entry: a second privileged scheme in the
    // same call would dodge a scan anchored to the app object.
    const entries = [...call.matchAll(/scheme: '/g)].length;
    expect(entries, 'the privileged scheme list must contain only the app entry').toBe(1);
    // Anchor the privileges object to the app entry itself, not merely the
    // same call, so another scheme's privileges cannot satisfy the pin on
    // app's behalf.
    const appEntry = /scheme: 'app',\s*privileges: \{([^}]*)\}/.exec(call);
    expect(appEntry, "no privileges object attached to scheme: 'app'").not.toBeNull();
    const body = appEntry?.[1] ?? '';
    const required = ['standard', 'secure', 'supportFetchAPI', 'corsEnabled', 'codeCache'];
    for (const privilege of required) {
      // Whole-line match, not substring: `codeCache: trueish` or
      // `codeCache: true && flag` must not satisfy the pin.
      const line = new RegExp(`(^|[\\s{])${privilege}: true,?\\s*$`, 'm');
      expect(line.test(body), `privilege ${privilege} must be explicitly true`).toBe(true);
    }
    // Exact key-set equality doubles as the deny-list: adding any privilege
    // beyond these five must be a deliberate edit here, in the same change.
    // The key scanner accepts quoted keys so `'bypassCSP': true` cannot slip
    // past it, and the expected set is written as its own literal so a single
    // edit cannot move both arms of the test at once.
    const keys = [...body.matchAll(/(['"]?)([A-Za-z_$][\w$]*)\1\s*:/g)]
      .map((match) => match[2])
      .sort();
    expect(keys, 'app scheme privileges must carry exactly the pinned keys').toEqual([
      'codeCache',
      'corsEnabled',
      'secure',
      'standard',
      'supportFetchAPI',
    ]);
  });
});
