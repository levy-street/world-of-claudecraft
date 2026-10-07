// @vitest-environment happy-dom
// The Death Recap stays reachable for the whole ghost run. Releasing spirit hides
// the corpse overlay and its Recap button, so a standalone #ghost-recap-btn takes
// over until the player is alive again (src/ui/hud/death).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createDeathPromptView,
  deathScreenEls,
  paintDeathScreens,
  updateDeathPromptView,
} from '../src/ui/hud/death';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const at = { x: 0, z: 0 };
const farCorpse = { x: 500, z: 0 };

describe('ghost Death Recap: the view core', () => {
  it('shows the ghost Recap for the whole spirit run, in and out of corpse reach', () => {
    const v = createDeathPromptView();
    updateDeathPromptView(v, true, true, false, false, at, farCorpse, false);
    expect(v.ghostPrompt, 'far from the corpse').toBe(false);
    expect(v.ghostRecap).toBe(true);
    updateDeathPromptView(v, true, true, false, false, at, { x: 1, z: 0 }, false);
    expect(v.ghostPrompt, 'in corpse reach').toBe(true);
    expect(v.ghostRecap).toBe(true);
  });

  it('keeps the ghost Recap for a battleground ghost waiting on the wave', () => {
    const v = createDeathPromptView();
    updateDeathPromptView(v, true, true, false, true, at, farCorpse, false);
    expect(v.ghostHint).toBe(false);
    expect(v.ghostRecap).toBe(true);
  });

  it('hides it on a fresh corpse (the overlay has its own Recap) and once alive', () => {
    const v = createDeathPromptView();
    updateDeathPromptView(v, true, false, false, false, at, null, false);
    expect(v.overlay).toBe(true);
    expect(v.ghostRecap).toBe(false);
    updateDeathPromptView(v, true, true, false, false, at, farCorpse, false);
    expect(v.ghostRecap).toBe(true);
    updateDeathPromptView(v, false, false, false, false, at, null, false);
    expect(v.ghostRecap).toBe(false);
  });
});

describe('ghost Death Recap: the painter', () => {
  function mount() {
    document.body.innerHTML = `
      <div id="death-overlay"></div>
      <button id="pvp-resurrect-btn"></button>
      <div id="ghost-hint"></div>
      <div id="ghost-prompt"></div>
      <button id="ghost-recap-btn" style="display: none"></button>`;
    const writes: [string, string][] = [];
    const w = {
      setDisplay(el: HTMLElement, display: string) {
        writes.push([el.id, display]);
        el.style.display = display;
      },
    };
    return { els: deathScreenEls(document), w, writes };
  }

  it('resolves every death-screen element from the static markup', () => {
    const { els } = mount();
    for (const [key, el] of Object.entries(els)) expect(el, key).toBeInstanceOf(HTMLElement);
    expect(els.ghostRecapBtn.id).toBe('ghost-recap-btn');
  });

  it('shows the ghost Recap button for a ghost far from its corpse, hides it when alive', () => {
    const { els, w, writes } = mount();
    const v = createDeathPromptView();
    updateDeathPromptView(v, true, true, false, false, at, farCorpse, false);
    paintDeathScreens(w, els, v);
    expect(writes).toContainEqual(['ghost-recap-btn', '']);
    expect(els.ghostRecapBtn.style.display).toBe('');
    expect(els.ghostPrompt.style.display).toBe('none');
    expect(els.overlay.style.display).toBe('none');

    updateDeathPromptView(v, false, false, false, false, at, null, false);
    paintDeathScreens(w, els, v);
    expect(els.ghostRecapBtn.style.display).toBe('none');
  });

  it('paints the corpse overlay surfaces exactly as before the extraction', () => {
    const { els, w } = mount();
    const v = createDeathPromptView();
    updateDeathPromptView(v, true, false, false, false, at, null, true);
    paintDeathScreens(w, els, v);
    expect(els.overlay.style.display).toBe('flex');
    expect(els.pvpResurrectBtn.style.display).toBe('');
    expect(els.ghostHint.style.display).toBe('none');
    expect(els.ghostPrompt.style.display).toBe('none');
    expect(els.ghostRecapBtn.style.display).toBe('none');

    updateDeathPromptView(v, true, true, false, false, at, { x: 1, z: 0 }, false);
    paintDeathScreens(w, els, v);
    expect(els.ghostHint.style.display).toBe('block');
    expect(els.ghostPrompt.style.display).toBe('flex');
  });
});

describe('ghost Death Recap: markup, wiring and layout', () => {
  it('ships the hidden, localized ghost Recap button in both entries, outside every nav root', () => {
    for (const entry of ['../index.html', '../play.html']) {
      const html = read(entry);
      expect(html, entry).toContain(
        '<button type="button" class="btn ui-btn" id="ghost-recap-btn" style="display: none" data-i18n="hud.core.deathRecapTitle">Death Recap</button>',
      );
      // Not inside #ghost-prompt: that pad-nav root only appears in corpse reach,
      // and a standing button there would take gamepad focus for the whole run.
      const prompt = html.indexOf('<div id="ghost-prompt"');
      const promptEnd = html.indexOf('</div>\n    </div>', prompt);
      const btn = html.indexOf('id="ghost-recap-btn"');
      expect(btn > promptEnd || btn < prompt, entry).toBe(true);
    }
  });

  it('opens the same Death Recap dialog as the overlay button, via touch-tap', () => {
    const hudTs = read('../src/ui/hud.ts');
    expect(hudTs).toContain(
      'bindTouchTap(this.deathEls.ghostRecapBtn, () => this.deathRecapDialog.toggle());',
    );
    expect(hudTs).toContain('paintDeathScreens(this.writerFacet, this.deathEls, death);');
    // The dialog still closes on revive, so it never outlives the ghost run.
    expect(hudTs).toMatch(
      /if \(!p\.dead\) \{\s*this\.closeResurrectionPrompt\(\);\s*if \(this\.deathRecapDialog\.isOpen\(\)\) this\.deathRecapDialog\.close\(\);/,
    );
  });

  it('centres the button with translate so the .ui-btn press transform cannot shove it', () => {
    const css = read('../src/styles/hud.css');
    const start = css.indexOf('#ghost-recap-btn {');
    expect(start).toBeGreaterThan(-1);
    const rule = css.slice(start, css.indexOf('}', start));
    expect(rule).toContain('position: absolute');
    expect(rule).toContain('translate: -50% 0');
    expect(rule).not.toContain('transform:');
    expect(read('../src/styles/hud.mobile.css')).toContain('body.mobile-touch #ghost-recap-btn {');
  });
});
