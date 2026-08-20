import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';
import { tsFilesUnder } from './helpers/ts_files_under';

// The COMPOSED portrait (the player's own face, src/render/characters/portrait.ts
// modularPortraitDataUrl) is captured off the frame that asks for it, so both of
// its consumers paint a fallback first and have to repaint once the capture
// lands. Neither can recognize its own update from (visualKey, skin): a composed
// key carries the look SIGNATURE and its visual key is `player_<cls>_modular`,
// which is why onPortraitUpdate hands the cache key to its listeners as a third
// argument. A source scan, because the wiring is one branch inside two
// coordinators that no unit test can construct without the whole HUD and a real
// WebGL rig; the capture behavior it rides on is covered behaviorally in
// portrait_live_capture.test.ts.

// Full-line // comments go first: every line pinned below is explained in
// prose right beside itself, so a raw read lets the prose (or a commented-out
// call) satisfy the pin over code that is no longer there.
const read = (path: string): string =>
  codeWithoutLineComments(readFileSync(new URL(path, import.meta.url), 'utf8'));
const hud = read('../src/ui/hud.ts');
const charWindow = read('../src/ui/char_window.ts');
const chip = read('../src/ui/portrait_chip.ts');
const main = read('../src/main.ts');
const charselectRefresh = read('../src/ui/charselect_composed_refresh.ts');

// Every module that FRAMES a composed subject needs a repaint hook of its own,
// pinned by a case below. The seam files IMPLEMENT the composed getters instead
// of framing a subject, so they carry no hook.
const COMPOSED_CONSUMERS = ['src/main.ts', 'src/ui/char_window.ts', 'src/ui/hud.ts'];
const COMPOSED_SEAM = ['src/ui/portrait_chip.ts', 'src/ui/unit_portrait_painter.ts'];

/** True for source that asks for a COMPOSED portrait: the painter call, or a
 *  chip built from a `look`. Both answer null on the first ask, which is what
 *  makes a repaint hook mandatory rather than optional. */
function asksForAComposedPortrait(code: string): boolean {
  if (code.includes('drawModularPlayer(')) return true;
  for (
    let at = code.indexOf('portraitChipHtml(');
    at > -1;
    at = code.indexOf('portraitChipHtml(', at + 1)
  ) {
    const call = code.slice(at, at + 600);
    const end = call.indexOf('})');
    if ((end === -1 ? call : call.slice(0, end)).includes('look:')) return true;
  }
  return false;
}

describe('a landed composed portrait reaches its consumers', () => {
  it('repaints the player frame, the one frame that is ever composed', () => {
    const handler = hud.slice(hud.indexOf('onPortraitUpdate((visualKey, skin, key) => {'));
    const composedAt = handler.indexOf('isComposedPortraitKey(key)');
    const mechAt = handler.indexOf("visualKey === 'player_mech'");
    expect(composedAt).toBeGreaterThan(-1);
    // Ahead of the (class, skin) matching that follows: no class name and no
    // skin index describes a composed body, so that matching would drop it.
    expect(composedAt).toBeLessThan(mechAt);
    expect(handler.slice(composedAt, mechAt)).toContain('this.drawPlayerFramePortrait();');
  });

  it('rebuilds the character sheet, whose composed title chip is HTML, not a src', () => {
    expect(charWindow).toContain('this.watchComposedPortrait();');
    const watch = charWindow.slice(charWindow.indexOf('private watchComposedPortrait(): void {'));
    expect(watch).toContain('onPortraitUpdate(');
    expect(watch.slice(0, 240)).toContain('if (isComposedPortraitKey(key)) this.renderIfOpen();');
  });

  it('rebuilds a character-select roster row, whose chip is composed HTML too', () => {
    // The roster row cannot hydrate either, and its capture routinely lands
    // AFTER the row was built, which is the regression this pins: the row used
    // to repaint only on the assets-ready event and kept the class crest for
    // the session when the capture was the thing it was waiting on.
    expect(main).toContain('trackComposedChipRow(row, chipHtml, () => hydratePortraits(row));');
    expect(charselectRefresh).toContain('if (!isComposedPortraitKey(key)) return;');
    // The registry outlives one roster load, so the rebuild drops the previous
    // load's rows where the list is cleared.
    expect(main).toContain('resetComposedRows();');
  });

  it('enumerates the consumers: a new composed subject fails until it is pinned', () => {
    const found = tsFilesUnder(fileURLToPath(new URL('../src/', import.meta.url)))
      .filter((f) =>
        asksForAComposedPortrait(codeWithoutLineComments(readFileSync(f.full, 'utf8'))),
      )
      .map((f) => `src/${f.file}`)
      .filter((f) => !COMPOSED_SEAM.includes(f));
    expect(found.sort()).toEqual([...COMPOSED_CONSUMERS].sort());
  });

  it('leaves composed chips to their builder: hydratePortraits must not swap their src', () => {
    // The reason the sheet rebuilds rather than hydrating: a look does not fit
    // in the chip's data attributes, so hydration would repaint the LEGACY
    // class portrait over the composed one.
    const hydrate = chip.slice(chip.indexOf('export function hydratePortraits('));
    expect(hydrate).toContain('if (chip.dataset.portraitComposed) return;');
  });
});
