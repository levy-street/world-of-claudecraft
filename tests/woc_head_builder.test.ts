// @vitest-environment happy-dom
//
// The WOC face builder's PAINTER (src/ui/woc_head_builder.ts) over a real DOM:
// the keyboard model (one Tab stop per radio group, arrows roving and checking),
// focus riding a repaint through the shared focus_restore seam, the sliders'
// formatter readouts, the skin custom colour control, and the decorative
// body-type letter. The rules themselves are pinned in
// tests/woc_head_builder_model.test.ts; this file pins what the painter draws.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ModularAppearance } from '../src/render/characters/modular';
import { mountWocHeadBuilder, type WocHeadBuilder } from '../src/ui/woc_head_builder';
import { WOC_SKIN_TONES } from '../src/ui/woc_head_builder_model';

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
