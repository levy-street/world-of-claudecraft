// Both home (index.html) and the dedicated /play entry (play.html) load the same
// /src/main.ts, whose wireStartScreens() runs unconditionally on boot and calls
// $('#cs-sort-btn').addEventListener(...). $ is document.querySelector cast to T,
// so a missing element returns null and .addEventListener throws, aborting the rest
// of the start-screen wiring on that page. The sort dropdown markup and CSS were
// originally added to index.html only; these tests pin the character-select sort
// controls to parity so a missing-markup regression is caught at build time
// (mirrors login_parity.test.ts for the 2FA login fields).
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

// The ids/classes wireStartScreens() and the sort menu depend on at boot/open time.
const REQUIRED_SORT_IDS = ['cs-sort-btn', 'cs-sort-menu', 'cs-sort-current'];
// The CSS rules that lay the sort switch out beside the realm switch.
const REQUIRED_SORT_CSS = ['.cs-controls', '.cs-sort-switch', '.cs-sort-menu'];

describe('character-select sort control parity', () => {
  it('wireStartScreens reads #cs-sort-btn (the dependency these tests guard)', () => {
    expect(mainTs).toContain("$('#cs-sort-btn').addEventListener");
  });

  for (const id of REQUIRED_SORT_IDS) {
    it(`index.html character select contains #${id}`, () => {
      expect(indexHtml).toContain(`id="${id}"`);
    });

    it(`play.html character select contains #${id} (mirrors index.html)`, () => {
      expect(playHtml).toContain(`id="${id}"`);
    });
  }

  for (const rule of REQUIRED_SORT_CSS) {
    it(`index.html styles ${rule}`, () => {
      expect(indexHtml).toContain(`${rule} {`);
    });

    it(`play.html styles ${rule} (mirrors index.html)`, () => {
      expect(playHtml).toContain(`${rule} {`);
    });
  }
});
