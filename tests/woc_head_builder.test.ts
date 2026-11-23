// @vitest-environment happy-dom
//
// The WOC face builder's PAINTER (src/ui/woc_head_builder.ts) over a real DOM:
// the keyboard model (one Tab stop per radio group, arrows roving and checking),
// focus riding a repaint through the shared focus_restore seam, the sliders'
// formatter readouts, the skin custom colour control, the decorative
// body-type letter, and the Share page (Copy, Import, the footer button). The
// rules themselves are pinned in tests/woc_head_builder_model.test.ts; this
// file pins what the painter draws.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModularAppearance } from '../src/render/characters/modular';
import { mountWocHeadBuilder, type WocHeadBuilder } from '../src/ui/woc_head_builder';
import { faceCode, readFace, WOC_SKIN_TONES } from '../src/ui/woc_head_builder_model';

let host: HTMLElement;
let builder: WocHeadBuilder;
let emitted: ModularAppearance[];
let focuses: string[];

function mount(value: Partial<ModularAppearance> = { gender: 'male' }): void {
  builder = mountWocHeadBuilder(host, {
    value,
    onChange: (next) => emitted.push(next),
    onFocus: (f) => focuses.push(f),
  });
}

const last = (): ModularAppearance & Record<string, unknown> =>
  emitted.at(-1) as ModularAppearance & Record<string, unknown>;
const tab = (cat: string) => host.querySelector<HTMLButtonElement>(`.whb-cat[data-cat="${cat}"]`)!;
const radios = (root?: ParentNode) => [
  ...(root ?? host.querySelector('.whb-panel-body')!).querySelectorAll<HTMLButtonElement>(
    '[role="radio"]',
  ),
];
const byLabel = (text: string) =>
  radios().find((b) => b.querySelector('.whb-opt-label')?.textContent === text)!;
const key = (el: Element, k: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const slider = (target: string) =>
  host.querySelector<HTMLInputElement>(`input.whb-slider[data-focus-key="slider:${target}"]`)!;
const readoutOf = (input: HTMLInputElement) =>
  input.closest('.whb-section')!.querySelector('.whb-slider-value')!.textContent;
function drag(input: HTMLInputElement, v: number): void {
  input.value = String(v);
  input.dispatchEvent(new Event('input'));
}

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  host = document.getElementById('host')!;
  emitted = [];
  focuses = [];
});

afterEach(() => {
  builder?.destroy();
});

describe('menu', () => {
  it('draws the ten categories as a tablist, Facial Hair after Hairstyle', () => {
    mount();
    const cats = [...host.querySelectorAll<HTMLButtonElement>('.whb-cat')].map((b) => ({
      cat: b.dataset.cat,
      label: b.textContent,
    }));
    expect(cats.map((c) => c.cat)).toEqual([
      'bodyType',
      'skinTone',
      'face',
      'eyesBrows',
      'eyeColor',
      'hairstyle',
      'facialHair',
      'hairColor',
      'browColor',
      'piercings',
    ]);
    expect(cats.find((c) => c.cat === 'facialHair')?.label).toBe('Facial Hair');
    // the open tab is the one Tab stop
    expect(
      [...host.querySelectorAll<HTMLButtonElement>('.whb-cat')].filter((b) => b.tabIndex === 0),
    ).toEqual([tab('bodyType')]);
  });

  it('reports each category it opens, once per open (the mount prefetches its head files)', () => {
    const opened: string[] = [];
    builder = mountWocHeadBuilder(host, {
      value: { gender: 'male' },
      onChange: (next) => emitted.push(next),
      onOpen: (cat) => opened.push(cat),
    });
    expect(opened).toEqual([]);
    tab('hairstyle').click();
    tab('hairstyle').click(); // re-clicking the open tab opens nothing new
    key(tab('hairstyle'), 'ArrowDown'); // arrowing to the next tab opens it
    expect(opened).toEqual(['hairstyle', 'facialHair']);
  });
});

describe('radio groups', () => {
  it('give each group ONE Tab stop, on the checked radio', () => {
    mount();
    tab('facialHair').click();
    const group = host.querySelector('.whb-panel-body [role="radiogroup"]')!;
    expect(group.getAttribute('aria-label')).toBe('Facial Hair');
    const rs = radios(group);
    expect(rs.map((b) => b.querySelector('.whb-opt-label')?.textContent)).toEqual([
      'Clean Shaven',
      'Moustache',
      'Handlebar',
      'Goatee',
      'Chin Beard',
      'Boxed Beard',
      'Long Beard',
      'Mutton Chops',
      'Chinstrap',
    ]);
    const stops = rs.filter((b) => b.tabIndex === 0);
    expect(stops).toHaveLength(1);
    // Type A opens on its boxed beard
    expect(stops[0].getAttribute('aria-checked')).toBe('true');
    expect(stops[0].querySelector('.whb-opt-label')?.textContent).toBe('Boxed Beard');
  });

  it('arrows move focus AND the check, and the focus survives the repaint', () => {
    mount();
    tab('facialHair').click();
    const boxed = byLabel('Boxed Beard');
    boxed.focus();
    key(boxed, 'ArrowRight');
    expect(last().headBeard).toBe('long');
    const now = document.activeElement as HTMLElement;
    // a fresh node (the panel repainted) carrying the same identity
    expect(now).not.toBe(boxed);
    expect(now.dataset.focusKey).toBe('beard:long');
    expect(now.getAttribute('aria-checked')).toBe('true');
    expect(now.tabIndex).toBe(0);
    key(now, 'Home');
    expect(last().headBeard).toBe('none');
    expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('beard:none');
    key(document.activeElement!, 'ArrowLeft');
    // wraps to the last style
    expect(last().headBeard).toBe('chinstrap');
  });

  it('a click (Enter/Space on a button) picks and keeps focus on the pick', () => {
    mount({ gender: 'female' });
    tab('facialHair').click();
    const goatee = byLabel('Goatee');
    goatee.focus();
    goatee.click();
    expect(last().headBeard).toBe('goatee');
    expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('beard:goatee');
  });

  it('never reads a private focus attribute (the shared data-focus-key only)', () => {
    mount();
    for (const cat of ['bodyType', 'skinTone', 'face', 'browColor']) {
      tab(cat).click();
      expect(host.querySelector('[data-fk]')).toBeNull();
      expect(host.querySelectorAll('.whb-panel-body [data-focus-key]').length).toBeGreaterThan(0);
    }
  });

  it('keeps the brows Match Hair chip inside the colour radio group', () => {
    mount();
    tab('browColor').click();
    const group = host.querySelector('.whb-panel-body [role="radiogroup"]')!;
    const match = group.querySelector('.whb-match')!;
    expect(match.getAttribute('role')).toBe('radio');
    expect(match.getAttribute('aria-checked')).toBe('true');
    expect((match as HTMLElement).tabIndex).toBe(0);
    // Match Hair is the check, so no swatch holds a Tab stop
    expect(radios(group).filter((b) => b.tabIndex === 0)).toEqual([match]);
  });
});

describe('Body Type', () => {
  it('labels Type A and Type B; the letter tile is t() text hidden from assistive tech', () => {
    mount();
    const opts = [...host.querySelectorAll<HTMLButtonElement>('.whb-opts-body .whb-opt')];
    expect(opts.map((b) => b.querySelector('.whb-opt-label')?.textContent)).toEqual([
      'Type A',
      'Type B',
    ]);
    const glyphs = opts.map((b) => b.querySelector('.whb-opt-glyph')!);
    expect(glyphs.map((g) => g.textContent)).toEqual(['A', 'B']);
    for (const g of glyphs) expect(g.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws a Body Size slider, -5 to +5 around the normal height, read out through the formatter', () => {
    mount();
    const size = slider('bodyScale');
    expect([size.min, size.max, size.step]).toEqual(['0.95', '1.05', '0.01']);
    // it starts on the normal height: 0, the middle of the track
    expect(readoutOf(size)).toBe('0');
    expect(size.getAttribute('aria-valuetext')).toBe('0');
    expect(Number.parseFloat(size.style.getPropertyValue('--whb-fill'))).toBeCloseTo(50, 6);
    expect(host.querySelector(`label[for="${size.id}"]`)?.textContent).toBe('Body Size');
    // the scale under the track, for the eye only (the readout speaks the value)
    const scale = size.parentElement?.querySelector('.whb-slider-scale');
    expect([...(scale?.children ?? [])].map((t) => t.textContent)).toEqual(['-5', '0', '+5']);
    expect(scale?.getAttribute('aria-hidden')).toBe('true');
    drag(size, 0.95);
    expect(readoutOf(size)).toBe('-5');
    expect(size.getAttribute('aria-valuetext')).toBe('-5');
    expect(last().bodyScale).toBe(0.95);
    expect(size.style.getPropertyValue('--whb-fill')).toBe('0%');
    drag(size, 1.05);
    expect(readoutOf(size)).toBe('+5');
    expect(last().bodyScale).toBe(1.05);
    // a double-click puts it back to the normal height
    size.dispatchEvent(new Event('dblclick'));
    expect(last().bodyScale).toBe(1);
    expect(readoutOf(size)).toBe('0');
  });

  it('a body-type switch keeps the body size', () => {
    mount({ gender: 'male', bodyScale: 0.96 } as Partial<ModularAppearance>);
    byLabel('Type B').click();
    expect(last().gender).toBe('female');
    expect(last().bodyScale).toBe(0.96);
  });

  it('a deliberate Type A beard does not ride a switch to Type B either', () => {
    mount({ gender: 'male' });
    tab('facialHair').click();
    byLabel('Long Beard').click();
    expect(last().headBeard).toBe('long');
    tab('bodyType').click();
    byLabel('Type B').click();
    expect(last().headBeard).toBe('none');
  });

  it('a fresh Type A switched to Type B does not keep the Type A opening beard', () => {
    mount({ gender: 'male' });
    tab('facialHair').click();
    expect(byLabel('Boxed Beard').getAttribute('aria-checked')).toBe('true');
    tab('bodyType').click();
    byLabel('Type B').click();
    expect(last().headBeard).toBe('none');
    tab('facialHair').click();
    expect(byLabel('Clean Shaven').getAttribute('aria-checked')).toBe('true');
  });
});

describe('Face and Eyes and Brows sliders', () => {
  it('reads the chin as a WIDTH percentage under the variant rows', () => {
    mount();
    tab('face').click();
    const sections = [...host.querySelectorAll('.whb-panel-body > .whb-section')];
    expect(sections.map((s) => s.className.replace('whb-section ', ''))).toEqual([
      'whb-section-options',
      'whb-section-options',
      'whb-section-options',
      'whb-section-slider',
    ]);
    const chin = slider('chinWidth');
    expect([chin.min, chin.max, chin.step]).toEqual(['0', '1', '0.01']);
    // the authored softness 0.65 is a 35% wide chin
    expect(readoutOf(chin)).toBe('35%');
    expect(chin.getAttribute('aria-valuetext')).toBe('35%');
    drag(chin, 0.3);
    expect(readoutOf(chin)).toBe('30%');
    // stored as the softness it is: 1 - width
    expect((last().headShape as Record<string, number>).chinWidth).toBe(0.7);
    chin.dispatchEvent(new Event('dblclick'));
    expect((last().headShape as Record<string, number>).chinWidth).toBe(0.65);
  });

  it('reads the eye and brow controls as a signed step', () => {
    mount();
    tab('eyesBrows').click();
    const tilt = slider('eyeTilt');
    expect(readoutOf(tilt)).toBe('0');
    drag(tilt, 0.2);
    expect(readoutOf(tilt)).toBe('+20');
    drag(tilt, -0.35);
    expect(readoutOf(tilt)).toBe('-35');
    expect(tilt.getAttribute('aria-valuetext')).toBe('-35');
    expect(slider('chinWidth')).toBeNull();
  });
});

describe('Skin Tone', () => {
  it('draws sixteen named tones plus the Custom colour control', () => {
    mount();
    tab('skinTone').click();
    const sws = [...host.querySelectorAll<HTMLButtonElement>('.whb-swatches-skin .whb-sw')];
    expect(sws).toHaveLength(WOC_SKIN_TONES.length);
    expect(sws[0].getAttribute('aria-label')).toBe('Porcelain');
    expect(sws.at(-1)?.getAttribute('aria-label')).toBe('Ebony');
    // the default skin is a named tone, so Custom is not lit
    expect(sws.filter((b) => b.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    const custom = host.querySelector<HTMLInputElement>('.whb-custom-input')!;
    expect(custom.type).toBe('color');
    expect(custom.getAttribute('aria-label')).toBe('Pick a custom skin tone');
    expect(host.querySelector('.whb-custom')?.classList.contains('sel')).toBe(false);
  });

  it('a custom tone previews live, then lights Custom and unchecks every swatch', () => {
    mount();
    tab('skinTone').click();
    const custom = host.querySelector<HTMLInputElement>('.whb-custom-input')!;
    custom.value = '#8d5a3b';
    custom.dispatchEvent(new Event('input'));
    const live = last();
    expect([live.skinHue, live.skinSat, live.skinLight].every(Number.isFinite)).toBe(true);
    expect(live.skinLight).toBeCloseTo(0.3922, 3);
    custom.dispatchEvent(new Event('change'));
    expect(host.querySelector('.whb-custom')?.classList.contains('sel')).toBe(true);
    const sws = [...host.querySelectorAll<HTMLButtonElement>('.whb-swatches-skin .whb-sw')];
    expect(sws.some((b) => b.getAttribute('aria-checked') === 'true')).toBe(false);
    // nothing is checked, so the first tone holds the group's Tab stop
    expect(sws.filter((b) => b.tabIndex === 0)).toEqual([sws[0]]);
    expect(host.querySelector<HTMLInputElement>('.whb-custom-input')?.value).toBe('#8d5a3b');
  });

  it('a hair colour pick needs no separate beard colour', () => {
    mount();
    tab('hairColor').click();
    const red = [...host.querySelectorAll<HTMLButtonElement>('.whb-sw')].find(
      (b) => b.getAttribute('aria-label') === 'Red',
    )!;
    red.click();
    const out = last();
    expect(Object.keys(out).filter((k) => /^beard(Hue|Sat|Light)$/.test(k))).toEqual([]);
    // matching brows ride along, as the model pins
    expect(out.browHue).toBe(out.hairHue);
  });
});

describe('lifecycle and focus edges', () => {
  it('a colour picker left open after destroy() reaches nobody', () => {
    mount();
    tab('skinTone').click();
    const custom = host.querySelector<HTMLInputElement>('.whb-custom-input')!;
    const before = emitted.length;
    builder.destroy();
    expect(focuses.at(-1)).toBe('body');
    custom.value = '#224466';
    custom.dispatchEvent(new Event('input'));
    custom.dispatchEvent(new Event('change'));
    expect(emitted.length).toBe(before);
  });

  it('committing a custom colour repaints and hands focus back to the colour control', () => {
    mount();
    tab('eyeColor').click();
    const custom = host.querySelector<HTMLInputElement>('.whb-custom-input')!;
    custom.focus();
    custom.value = '#2a6f4f';
    custom.dispatchEvent(new Event('input'));
    custom.dispatchEvent(new Event('change'));
    const now = document.activeElement as HTMLInputElement;
    expect(now).not.toBe(custom);
    expect(now.dataset.focusKey).toBe('color-eye:custom');
    expect(now.value).toBe('#2a6f4f');
  });

  it('picking the brow swatch that equals the hair colour lands on Match Hair', () => {
    mount();
    tab('browColor').click();
    // break the match first, then pick the hair's own colour back
    const black = [...host.querySelectorAll<HTMLButtonElement>('.whb-sw')].find(
      (b) => b.getAttribute('aria-label') === 'Black',
    )!;
    black.click();
    expect(host.querySelector('.whb-match')?.getAttribute('aria-checked')).toBe('false');
    const brown = [...host.querySelectorAll<HTMLButtonElement>('.whb-sw')].find(
      (b) => b.getAttribute('aria-label') === 'Brown',
    )!;
    brown.focus();
    brown.click();
    const now = document.activeElement as HTMLElement;
    expect(now.classList.contains('whb-match')).toBe(true);
    expect(now.getAttribute('aria-checked')).toBe('true');
    expect(now.tabIndex).toBe(0);
  });

  it('re-picking the checked option emits nothing', () => {
    mount();
    tab('facialHair').click();
    const before = emitted.length;
    byLabel('Boxed Beard').click();
    expect(emitted.length).toBe(before);
  });

  it('a modified arrow (Alt+Arrow is history) is not a move', () => {
    mount();
    tab('facialHair').click();
    const boxed = byLabel('Boxed Beard');
    boxed.focus();
    const before = emitted.length;
    boxed.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }),
    );
    expect(emitted.length).toBe(before);
    expect(document.activeElement).toBe(boxed);
  });
});

describe('Reset and Random', () => {
  it('Reset keeps the body type and the body size', () => {
    mount({ gender: 'female', bodyScale: 0.96, headBeard: 'goatee' } as Partial<ModularAppearance>);
    const reset = [...host.querySelectorAll<HTMLButtonElement>('.whb-foot-btn')][1];
    reset.click();
    expect(last().gender).toBe('female');
    expect(last().bodyScale).toBe(0.96);
    expect(last().headBeard).toBe('none');
  });

  it('Random keeps the body type and the body size', () => {
    mount({ gender: 'male', bodyScale: 1.03 } as Partial<ModularAppearance>);
    const random = [...host.querySelectorAll<HTMLButtonElement>('.whb-foot-btn')][0];
    random.click();
    expect(last().gender).toBe('male');
    expect(last().bodyScale).toBe(1.03);
  });
});

describe('Share', () => {
  const footShare = () => host.querySelector<HTMLButtonElement>('.whb-foot-share')!;
  const box = () => host.querySelector<HTMLTextAreaElement>('.whb-panel-body .whb-share-code')!;
  const copyBtn = () => host.querySelector<HTMLButtonElement>('.whb-share-copy')!;
  const importBtn = () =>
    host.querySelector<HTMLButtonElement>('.whb-share-btn[data-focus-key="share:import"]')!;
  const status = () => host.querySelector<HTMLElement>('.whb-share-status')!;
  const paste = (text: string) => {
    box().value = text;
    box().dispatchEvent(new Event('input'));
  };
  // a face with every piece the code carries moved, on the other body type
  const theirs = readFace({
    gender: 'female',
    bodyScale: 0.97,
    skinHue: 21,
    skinSat: 0.42,
    skinLight: 0.38,
    hairHue: 6,
    hairSat: 0.7,
    hairLight: 0.38,
    headPiercing: 'septum',
    headShape: { eyeSpacing: -0.4, eyeSize: 0.25, eyeTilt: 0, browHeight: 0, chinWidth: 0.2 },
  });

  let clipboard: PropertyDescriptor | undefined;
  beforeEach(() => {
    clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  });
  afterEach(() => {
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
    else delete (navigator as { clipboard?: unknown }).clipboard;
  });
  const stubClipboard = (value: unknown) =>
    Object.defineProperty(navigator, 'clipboard', { value, configurable: true });

  /** The tab panel (a category's options) and the Share region beside it. */
  const panel = () => host.querySelector<HTMLElement>('.whb-panel:not(.whb-share-panel)')!;
  const sharePanel = () => host.querySelector<HTMLElement>('.whb-share-panel')!;
  const titleOf = (p: HTMLElement) => p.querySelector<HTMLElement>('.whb-panel-title')!;
  const selectedTabs = () =>
    [...host.querySelectorAll<HTMLButtonElement>('.whb-cat')].filter(
      (b) => b.getAttribute('aria-selected') === 'true',
    );
  const tabStopsOf = () =>
    [...host.querySelectorAll<HTMLButtonElement>('.whb-cat')].filter((b) => b.tabIndex === 0);

  it('puts a gold Share toggle in the footer, after Random and Reset, never in the menu', () => {
    mount();
    const foot = [...host.querySelectorAll<HTMLButtonElement>('.whb-foot-btn')];
    expect(foot).toHaveLength(3);
    expect(foot[2]).toBe(footShare());
    expect(footShare().textContent).toBe('Share');
    expect(footShare().getAttribute('aria-pressed')).toBe('false');
    expect(footShare().getAttribute('aria-controls')).toBe(sharePanel().id);
    // decorative glyph: the word names the button
    expect(footShare().querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(footShare().classList.contains('sel')).toBe(false);
    expect(host.querySelector('.whb-cat[data-cat="share"]')).toBeNull();
    // the Share region waits, hidden and empty, beside the tab panel
    expect(sharePanel().hidden).toBe(true);
    expect(sharePanel().querySelector('.whb-share-code')).toBeNull();
    expect(panel().hidden).toBe(false);
  });

  it('opens the Share page as its own region, its title naming it, and lands on Copy', () => {
    mount();
    tab('hairstyle').click();
    focuses.length = 0;
    footShare().click();
    expect(footShare().getAttribute('aria-pressed')).toBe('true');
    expect(footShare().classList.contains('sel')).toBe(true);
    // the region swaps in for the tab panel, whose role never changes
    expect(sharePanel().hidden).toBe(false);
    expect(panel().hidden).toBe(true);
    expect(panel().getAttribute('role')).toBe('tabpanel');
    expect(sharePanel().getAttribute('role')).toBe('region');
    expect(titleOf(sharePanel()).textContent).toBe('Share');
    expect(sharePanel().getAttribute('aria-labelledby')).toBe(titleOf(sharePanel()).id);
    expect(document.getElementById(titleOf(sharePanel()).id)).toBe(titleOf(sharePanel()));
    // the hidden tab panel holds no stale controls
    expect(panel().querySelector('[role="radio"]')).toBeNull();
    expect(selectedTabs()).toEqual([]);
    expect(host.querySelectorAll('.whb-cat.sel')).toHaveLength(0);
    // the tablist keeps one Tab stop, on the category the page goes back to
    expect(tabStopsOf()).toEqual([tab('hairstyle')]);
    // the camera turns to the face being shared, and focus lands on Copy
    expect(focuses).toEqual(['face']);
    expect(document.activeElement).toBe(copyBtn());
    // every Copy and Import outcome is announced
    expect(status().getAttribute('aria-live')).toBe('polite');
    // nothing about the look changed by opening it
    expect(emitted).toEqual([]);
  });

  it('pressed again goes back to the category the player was in; a tab leaves it too', () => {
    const opened: string[] = [];
    builder = mountWocHeadBuilder(host, {
      value: { gender: 'male' },
      onChange: (next) => emitted.push(next),
      onFocus: (f) => focuses.push(f),
      onOpen: (cat) => opened.push(cat),
    });
    tab('hairColor').click();
    footShare().click();
    // the Share page browses no head files: nothing to prefetch
    expect(opened).toEqual(['hairColor']);
    footShare().click();
    // coming back opens the category again (its prefetch asks for files once)
    expect(opened).toEqual(['hairColor', 'hairColor']);
    expect(footShare().getAttribute('aria-pressed')).toBe('false');
    expect(footShare().classList.contains('sel')).toBe(false);
    expect(panel().hidden).toBe(false);
    expect(sharePanel().hidden).toBe(true);
    expect(titleOf(panel()).textContent).toBe('Hair Color');
    expect(panel().getAttribute('role')).toBe('tabpanel');
    expect(panel().getAttribute('aria-labelledby')).toBe(tab('hairColor').id);
    expect(selectedTabs()).toEqual([tab('hairColor')]);
    expect(host.querySelector('.whb-share-code')).toBeNull();
    // and from the page, any tab takes the player straight to its category
    footShare().click();
    tab('piercings').click();
    expect(footShare().getAttribute('aria-pressed')).toBe('false');
    expect(selectedTabs()).toEqual([tab('piercings')]);
    expect(tabStopsOf()).toEqual([tab('piercings')]);
    expect(emitted).toEqual([]);
  });

  it("shows the face's code, labelled and described, and follows Random", () => {
    mount({ gender: 'male' });
    footShare().click();
    expect(box().value).toBe(faceCode(readFace(builder.value)));
    expect(box().getAttribute('aria-label')).toBe('Design code');
    const hint = document.getElementById(box().getAttribute('aria-describedby')!);
    expect(hint?.textContent).toMatch(/^Copy this code/);
    const before = box().value;
    [...host.querySelectorAll<HTMLButtonElement>('.whb-foot-btn')][0].click();
    expect(box().value).toBe(faceCode(readFace(last())));
    expect(box().value).not.toBe(before);
  });

  it('follows Reset to Default too', () => {
    mount({ ...theirs } as Partial<ModularAppearance>);
    footShare().click();
    const before = box().value;
    expect(before).toBe(faceCode(theirs));
    [...host.querySelectorAll<HTMLButtonElement>('.whb-foot-btn')][1].click();
    expect(box().value).toBe(faceCode(readFace(last())));
    expect(box().value).not.toBe(before);
  });

  it('Copy puts the code on the clipboard and says so', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    stubClipboard({ writeText });
    mount();
    footShare().click();
    copyBtn().click();
    await vi.waitFor(() => expect(status().textContent).toBe('Design code copied.'));
    expect(writeText).toHaveBeenCalledWith(box().value);
    expect(status().classList.contains('err')).toBe(false);
  });

  it('Copy copies what is in the box, trimmed, and the face on the stage when it is empty', () => {
    const writeText = vi.fn(async (_text: string) => {});
    stubClipboard({ writeText });
    mount({ gender: 'male' });
    footShare().click();
    paste('  WOC1; body=female  ');
    copyBtn().click();
    expect(writeText).toHaveBeenLastCalledWith('WOC1; body=female');
    // load another face, then empty the box: Copy takes the face loaded NOW,
    // never the one the page was first painted with
    paste(faceCode(theirs));
    importBtn().click();
    paste('   ');
    copyBtn().click();
    expect(writeText).toHaveBeenLastCalledWith(faceCode(theirs));
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it('Copy with no clipboard selects the code so one keystroke copies it', () => {
    stubClipboard(undefined);
    mount();
    footShare().click();
    copyBtn().click();
    expect(document.activeElement).toBe(box());
    expect(box().selectionStart).toBe(0);
    expect(box().selectionEnd).toBe(box().value.length);
    expect(status().textContent).toMatch(/^Automatic copy is blocked here/);
  });

  it('Copy falls back the same way when the clipboard refuses', async () => {
    const writeText = vi.fn(async () => Promise.reject(new Error('denied')));
    stubClipboard({ writeText });
    mount();
    footShare().click();
    copyBtn().click();
    expect(writeText).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(document.activeElement).toBe(box()));
    expect(box().selectionStart).toBe(0);
    expect(box().selectionEnd).toBe(box().value.length);
    expect(status().textContent).toMatch(/^Automatic copy is blocked here/);
  });

  it('clears the error colour on a good import, and the copy fallback is never an error', () => {
    stubClipboard(undefined);
    mount();
    footShare().click();
    paste('WOC1; body');
    importBtn().click();
    expect(status().classList.contains('err')).toBe(true);
    paste(faceCode(theirs));
    importBtn().click();
    expect(status().textContent).toBe('Design imported.');
    expect(status().classList.contains('err')).toBe(false);
    paste('nope');
    importBtn().click();
    expect(status().classList.contains('err')).toBe(true);
    copyBtn().click();
    expect(status().textContent).toMatch(/^Automatic copy is blocked here/);
    expect(status().classList.contains('err')).toBe(false);
  });

  it('names an empty box and a newer code for what they are', () => {
    mount();
    footShare().click();
    paste('   ');
    importBtn().click();
    expect(status().textContent).toBe('Paste a design code first.');
    paste('WOC2; body=male');
    importBtn().click();
    expect(status().textContent).toBe('That design code comes from a newer game version.');
    expect(emitted).toEqual([]);
  });

  it('an import onto the other body type says the face focus again; the same type does not', () => {
    mount({ gender: 'male' });
    footShare().click();
    focuses.length = 0;
    paste(faceCode(theirs)); // a Type B face
    importBtn().click();
    expect(readFace(last()).gender).toBe('female');
    expect(focuses).toEqual(['face']);
    focuses.length = 0;
    paste(faceCode({ ...theirs, headPiercing: 'none' }));
    importBtn().click();
    expect(readFace(last()).headPiercing).toBe('none');
    expect(focuses).toEqual([]);
  });

  it('Import loads a pasted face, keeps the body proportions, and leaves its status up', () => {
    const body = { shoulders: 0.4 } as unknown as ModularAppearance['body'];
    mount({ gender: 'male', body } as Partial<ModularAppearance>);
    const bodyBefore = builder.value.body;
    footShare().click();
    const shown = box();
    paste(`My ranger: \`${faceCode(theirs)}\``);
    importBtn().click();
    const got = readFace(last());
    expect(got.gender).toBe('female');
    expect(got.headPiercing).toBe('septum');
    expect(got.bodyScale).toBeCloseTo(0.97, 6);
    expect(got.headShape.chinWidth).toBeCloseTo(0.2, 6);
    expect(faceCode(got)).toBe(faceCode(theirs));
    // body proportions are not part of a face: the character keeps its own
    expect(last().body).toEqual(bodyBefore);
    // the page was not rebuilt under the status, and the box now holds the
    // clean code of what was loaded (the chat wrapping gone)
    expect(box()).toBe(shown);
    expect(box().value).toBe(faceCode(theirs));
    expect(status().textContent).toBe('Design imported.');
    expect(status().classList.contains('err')).toBe(false);
  });

  it('Import of something that is not a code says why and changes nothing', () => {
    mount();
    footShare().click();
    paste('a lovely face');
    importBtn().click();
    expect(emitted).toEqual([]);
    expect(status().textContent).toBe('That does not look like a design code.');
    expect(status().classList.contains('err')).toBe(true);
    paste('WOC1; body');
    importBtn().click();
    expect(emitted).toEqual([]);
    expect(status().textContent).toBe(
      'That design code is damaged. Copy the whole code and try again.',
    );
  });

  it('says so when an import had to skip something', () => {
    mount();
    footShare().click();
    paste(`${faceCode(theirs)}; sparkle=9`);
    importBtn().click();
    expect(readFace(last()).gender).toBe('female');
    expect(status().textContent).toBe(
      'Design imported. Values this version does not know were skipped.',
    );
  });

  it('keeps a pasted code through the host repainting the panel, again and again', () => {
    mount();
    footShare().click();
    paste('WOC1; body=female; headpiercing=septum');
    // the host pokes set() on a class switch: the page repaints, the paste stays,
    // through a second repaint that changes the face too
    builder.set({});
    builder.set({ gender: 'female' });
    expect(box().value).toBe('WOC1; body=female; headpiercing=septum');
    expect(footShare().getAttribute('aria-pressed')).toBe('true');
    // and it is still what Import reads
    importBtn().click();
    expect(readFace(last()).headPiercing).toBe('septum');
    // an untouched box follows the look the host hands in
    builder.set({ gender: 'male' });
    expect(box().value).toBe(faceCode(readFace(builder.value)));
    expect(readFace(builder.value).gender).toBe('male');
  });

  /** A clipboard whose write settles when the test says so. */
  function heldClipboard() {
    let settle: () => void = () => {};
    const writeText = vi.fn(() => new Promise<void>((r) => (settle = r)));
    stubClipboard({ writeText });
    return { writeText, settle: () => settle() };
  }
  /** The ticks a settled write takes to reach the status line. */
  const ticks = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  it('writes the copied line once the clipboard answers (the control for the next case)', async () => {
    const clip = heldClipboard();
    mount();
    footShare().click();
    copyBtn().click();
    expect(clip.writeText).toHaveBeenCalledTimes(1);
    expect(status().textContent).toBe('');
    clip.settle();
    await ticks();
    expect(status().textContent).toBe('Design code copied.');
  });

  it('wires nothing to a torn-down builder: a late clipboard answer writes no status', async () => {
    const clip = heldClipboard();
    mount();
    footShare().click();
    const line = status();
    copyBtn().click();
    expect(clip.writeText).toHaveBeenCalledTimes(1);
    builder.destroy();
    clip.settle();
    await ticks();
    expect(line.textContent).toBe('');
  });
});
