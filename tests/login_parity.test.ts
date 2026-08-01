// Both home (index.html) and the dedicated /play entry (play.html) load the same
// /src/main.ts, whose doAuth() unconditionally reads `#login-2fa-field` and
// `#login-2fa-code`. If either login form omits that markup, every login on that
// page throws (null deref) before a request is ever sent. These tests pin the
// 2FA login markup to parity so a missing-field regression is caught at build time.
//
// The same dual-entry trap hits world entry: Hud and main.ts bind a number of
// #game-ui-template ids with unguarded `$('#id').addEventListener` / field
// lookups. A missing id on one entry only produces the red
// "Could not start the renderer: ... Cannot read properties of null
// (reading 'addEventListener')" overlay after login. That is how #2495's
// continent map toggle crashed every /play world entry on release/v0.33.0
// (map-level-toggle landed in index.html only). Pin the known critical ids
// AND every unguarded Hud `$('#id').addEventListener` target so the next
// index-only markup addition fails CI before it ships.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const playHtml = readFileSync(new URL('../play.html', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const mainTs = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const hudTs = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);

// The ids doAuth() depends on at login time.
const REQUIRED_2FA_IDS = ['login-2fa-field', 'login-2fa-code'];

// The ids the renderer/HUD build reads unconditionally while constructing the
// world view (PerfOverlay from main.ts, the target-frame cast bar and the
// second action bar from hud.ts). If either entry's #game-ui-template omits one,
// entering the world throws a null deref ("Could not start the renderer") on
// that page only. buildActionBar resolves #actionbar2 for slots 12..22; a page
// without it crashed on appendChild (the /play entry shipped without the div).
// map-level-toggle: Hud constructor binds it without optional chaining (v0.33.0
// /play crash). tf-discord: field-initialized every frame for the target social
// line; missing on /play left the Discord badge dead for that entry.
const REQUIRED_HUD_TEMPLATE_IDS = [
  'perf-overlay',
  'tf-castbar',
  'actionbar2',
  'map-level-toggle',
  'tf-discord',
];

/** Unguarded `$('#id').addEventListener(...)` targets in Hud (no `?.`). */
function unguardedHudAddEventListenerIds(source: string): string[] {
  const ids = new Set<string>();
  // Match `$('#foo').addEventListener` but not `$('#foo')?.addEventListener`.
  const re = /\$\('#([A-Za-z0-9_-]+)'\)\.addEventListener\b/g;
  for (const match of source.matchAll(re)) {
    const id = match[1];
    if (id) ids.add(id);
  }
  return [...ids].sort();
}

describe('login form 2FA markup parity', () => {
  it('doAuth reads the 2FA field/code ids (the dependency these tests guard)', () => {
    expect(mainTs).toContain("$('#login-2fa-field')");
    expect(mainTs).toContain("$('#login-2fa-code')");
  });

  for (const id of REQUIRED_2FA_IDS) {
    it(`index.html login form contains #${id}`, () => {
      expect(indexHtml).toContain(`id="${id}"`);
    });

    it(`play.html login form contains #${id} (mirrors index.html)`, () => {
      expect(playHtml).toContain(`id="${id}"`);
    });
  }
});

describe('HUD template renderer-critical markup parity', () => {
  it('the client reads the renderer-critical ids (the dependency these tests guard)', () => {
    expect(mainTs).toContain("$('#perf-overlay')");
    expect(hudTs).toContain("$('#tf-castbar')");
    expect(hudTs).toContain("$('#actionbar2')");
    expect(hudTs).toContain("$('#map-level-toggle')");
    expect(hudTs).toContain("$('#tf-discord')");
  });

  for (const id of REQUIRED_HUD_TEMPLATE_IDS) {
    it(`index.html contains #${id}`, () => {
      expect(indexHtml).toContain(`id="${id}"`);
    });

    it(`play.html contains #${id} (mirrors index.html)`, () => {
      expect(playHtml).toContain(`id="${id}"`);
    });
  }
});

describe('Hud unguarded addEventListener targets exist on both entries', () => {
  const ids = unguardedHudAddEventListenerIds(hudTs);

  it('finds at least the known world-entry-critical listeners (non-vacuous)', () => {
    // If this ever drops to empty, the scanner stopped matching real Hud code
    // and this suite would stop guarding /play crashes. Keep a floor.
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain('map-level-toggle');
    expect(ids).toContain('target-frame');
    expect(ids).toContain('mm-char');
  });

  for (const id of ids) {
    it(`index.html contains unguarded listener target #${id}`, () => {
      expect(indexHtml).toContain(`id="${id}"`);
    });

    it(`play.html contains unguarded listener target #${id}`, () => {
      expect(playHtml).toContain(`id="${id}"`);
    });
  }
});
