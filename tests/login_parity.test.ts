// Both home (index.html) and the dedicated /play entry (play.html) load the same
// /src/main.ts, whose doAuth() unconditionally reads `#login-2fa-field` and
// `#login-2fa-code`. If either login form omits that markup, every login on that
// page throws (null deref) before a request is ever sent. These tests pin the
// 2FA login markup to parity so a missing-field regression is caught at build time.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const playHtml = readFileSync(new URL('../play.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const mainTs = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const hudTs = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// The ids doAuth() depends on at login time.
const REQUIRED_2FA_IDS = ['login-2fa-field', 'login-2fa-code'];

// The ids the renderer/HUD build reads unconditionally while constructing the
// world view (PerfOverlay from main.ts, the target-frame cast bar from hud.ts).
// If either entry's #game-ui-template omits one, entering the world throws a
// null deref ("Could not start the renderer") on that page only.
const REQUIRED_HUD_TEMPLATE_IDS = ['perf-overlay', 'tf-castbar'];

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
