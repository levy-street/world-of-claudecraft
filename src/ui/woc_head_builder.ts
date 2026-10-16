// The WOC face builder's painter: a left category menu, the open category's
// options in a panel beside it, and a Randomize / Reset footer. Every decision
// (which options a head type offers, what a pick writes, reset and randomize,
// the slider specs and readouts, which camera focus a category wants) lives in
// the pure core, woc_head_builder_model.ts; this file only draws that model
// and forwards input back into it.
//
// Keyboard model: the category menu is a vertical tablist and every option
// list or swatch grid is a radio group, both with ONE Tab stop that the arrow
// keys (and Home/End) rove, the WAI-ARIA tabs and radio-group patterns
// (rovingTarget, src/ui/roving_index.ts). Moving through a radio group checks as it goes,
// so arrowing through hairstyles previews each on the turntable. A pick
// repaints the panel; the focused control's identity rides the rebuild
// through the shared focus_restore.ts seam (data-focus-key), never a
// hand-rolled activeElement read.
//
// It returns the same AppearanceCustomizer shape mountAppearanceCustomizer
// does, so character creation and the char-select Redesign editor swap one
// mount call for the other on a WOC body and keep their onChange wiring.

import { type ModularAppearance, normalizeAppearance } from '../render/characters/modular';
import type { AppearanceCustomizer } from './appearance_customizer';
import { captureFocusKey, findFocusKey, restoreFirstEnabled } from './focus_restore';
import type { TranslationKey } from './i18n';
import { t } from './i18n';
import { rovingTarget } from './roving_index';
import {
  browsMatchHair,
  categoryLabelKey,
  categorySections,
  focusForCategory,
  hexToHsl,
  hslToCss,
  INITIAL_MENU,
  matchBrowsToHair,
  openCategory,
  pickOption,
  randomizeFace,
  readFace,
  resetFace,
  rovingTabStop,
  setColor,
  setSlider,
  sliderFill,
  sliderReadout,
  stepCategory,
  targetColor,
  WOC_BUILDER_CATEGORIES,
  type WocBuilderCategory,
  type WocBuilderFocus,
  type WocBuilderMenuState,
  type WocBuilderSection,
  type WocFaceAppearance,
  type WocSliderSection,
} from './woc_head_builder_model';

export interface WocHeadBuilderOptions {
  value?: Partial<ModularAppearance> | null;
  onChange(next: ModularAppearance): void;
  /** The camera focus the open category wants ('face' for every face
   *  category, 'body' for the body pick and on teardown). */
  onFocus?(focus: WocBuilderFocus): void;
  /** A category just opened (the mount prefetches the head files it browses). */
  onOpen?(cat: WocBuilderCategory): void;
}

export interface WocHeadBuilder extends AppearanceCustomizer {
  /** The camera focus the open category wants right now. */
  readonly focus: WocBuilderFocus;
}

/** One painted radio: its button and what checking it does. */
interface Radio {
  readonly btn: HTMLButtonElement;
  readonly checked: boolean;
  readonly pick: () => void;
}

let mountSeq = 0;

const tk = (key: string): string => t(key as TranslationKey);

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Merge the builder's face state back into the full stored look. The
 *  normalizer's view wins where it knows a field; a field it does not know
 *  (yet) rides through from the builder rather than being dropped. */
function mergeFace(
  full: Partial<ModularAppearance> | null | undefined,
  face: WocFaceAppearance,
): ModularAppearance {
  const merged = { ...(full ?? {}), ...face } as Partial<ModularAppearance>;
  return { ...merged, ...normalizeAppearance(merged) } as ModularAppearance;
}

/** The focus-key group a key belongs to: everything before its first ':'
 *  (`hair:mohawk` is in `hair`, `slider:chinWidth` in `slider`). */
const keyGroup = (key: string): string => key.slice(0, Math.max(0, key.indexOf(':')));

/** A roving key only when unmodified: Alt+Arrow is history navigation and
 *  Ctrl/Cmd+Home/End belong to the page, never a move through the menu. */
const plainKey = (ev: KeyboardEvent): boolean => !ev.altKey && !ev.ctrlKey && !ev.metaKey;

/** The width the creator's CSS turns the category menu from a vertical column
 *  into a horizontal tab strip at (shell.css, the builder's narrow block). */
const NARROW_LAYOUT_QUERY = '(max-width: 860px)';

export function mountWocHeadBuilder(
  host: HTMLElement,
  opts: WocHeadBuilderOptions,
): WocHeadBuilder {
  const uid = `whb${++mountSeq}`;
  let value = mergeFace(opts.value, readFace(opts.value as Partial<WocFaceAppearance>));
  let menu: WocBuilderMenuState = INITIAL_MENU;
  const cleanups: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(
    node: HTMLElement,
    type: K,
    fn: (ev: HTMLElementEventMap[K]) => void,
  ): void => {
    node.addEventListener(type, fn as EventListener);
    cleanups.push(() => node.removeEventListener(type, fn as EventListener));
  };
  const face = (): WocFaceAppearance => readFace(value as Partial<WocFaceAppearance>);
  /** Set by destroy(): a native colour picker left open can still fire input
   *  events into a torn-down builder, and those must reach nobody. */
  let destroyed = false;
  /** Each painted radio group's Tab stop, keyed by its focus-key group, the
   *  degrade rung when a rebuild drops the exact control that had focus.
   *  Collected as the nodes are minted, cleared at the top of each paint. */
  const tabStops = new Map<string, HTMLButtonElement>();

  host.textContent = '';
  host.classList.add('whb');

  const shell = el('div', 'whb-shell');
  const nav = el('div', 'whb-menu');
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', t('auth.appearance'));
  // the menu is a column on the docked layout and a strip on the narrow one,
  // so the orientation assistive tech announces follows the layout
  const narrow = typeof matchMedia === 'function' ? matchMedia(NARROW_LAYOUT_QUERY) : null;
  const syncOrientation = () =>
    nav.setAttribute('aria-orientation', narrow?.matches ? 'horizontal' : 'vertical');
  syncOrientation();
  if (narrow) {
    narrow.addEventListener('change', syncOrientation);
    cleanups.push(() => narrow.removeEventListener('change', syncOrientation));
  }
  const navTitle = el('div', 'whb-title', t('auth.appearance'));
  const panel = el('div', 'whb-panel');
  panel.id = `${uid}-panel`;
  panel.setAttribute('role', 'tabpanel');
  const panelTitle = el('div', 'whb-panel-title');
  const panelBody = el('div', 'whb-panel-body');
  panel.append(panelTitle, panelBody);
  const menuWrap = el('div', 'whb-menu-wrap');
  menuWrap.append(navTitle, nav);
  shell.append(menuWrap, panel);

  const foot = el('div', 'whb-foot');
  const randomBtn = el('button', 'whb-foot-btn', t('auth.randomizeShort'));
  randomBtn.type = 'button';
  randomBtn.setAttribute('aria-label', t('auth.randomize'));
  randomBtn.title = t('auth.randomize');
  const resetBtn = el('button', 'whb-foot-btn', t('auth.wocBuilder.resetDefault'));
  resetBtn.type = 'button';
  foot.append(randomBtn, resetBtn);
  host.append(shell, foot);

  const catButtons = new Map<WocBuilderCategory, HTMLButtonElement>();
  for (const cat of WOC_BUILDER_CATEGORIES) {
    const btn = el('button', 'whb-cat');
    btn.type = 'button';
    btn.id = `${uid}-cat-${cat}`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', panel.id);
    btn.dataset.cat = cat;
    btn.append(el('span', 'whb-cat-label', tk(categoryLabelKey(cat))));
    on(btn, 'click', () => open(cat));
    on(btn, 'keydown', (ev) => {
      const next = plainKey(ev) ? stepCategory(cat, ev.key) : null;
      if (!next) return;
      ev.preventDefault();
      open(next, true);
    });
    catButtons.set(cat, btn);
    nav.appendChild(btn);
  }

  const emit = () => opts.onChange(value);
  const apply = (next: WocFaceAppearance, repaint = true) => {
    if (destroyed) return;
    value = mergeFace(value, next);
    if (repaint) paintPanel(true);
    emit();
  };

  function open(cat: WocBuilderCategory, focusTab = false): void {
    const was = menu.open;
    menu = openCategory(menu, cat);
    paintMenu();
    paintPanel(false);
    if (focusTab) catButtons.get(cat)?.focus();
    if (was !== cat) opts.onOpen?.(cat);
    if (was !== cat || focusTab) opts.onFocus?.(focusForCategory(cat));
    if (typeof panelBody.scrollTo === 'function') panelBody.scrollTo({ top: 0 });
  }

  function paintMenu(): void {
    for (const [cat, btn] of catButtons) {
      const sel = cat === menu.open;
      btn.classList.toggle('sel', sel);
      btn.setAttribute('aria-selected', sel ? 'true' : 'false');
      btn.tabIndex = sel ? 0 : -1;
      if (sel) panel.setAttribute('aria-labelledby', btn.id);
    }
  }

  /** Redraw the open category's panel. `keepFocus` hands focus back to the
   *  control that had it (a pick redraws the panel it happened in), degrading
   *  to its group's Tab stop when the rebuild no longer carries it. */
  function paintPanel(keepFocus: boolean): void {
    if (destroyed) return;
    const focusKey = keepFocus ? captureFocusKey(panelBody) : null;
    tabStops.clear();
    panelTitle.textContent = tk(categoryLabelKey(menu.open));
    panelBody.textContent = '';
    const f = face();
    for (const section of categorySections(menu.open, f)) {
      panelBody.appendChild(paintSection(section, f));
    }
    if (focusKey) {
      restoreFirstEnabled([findFocusKey(panelBody, focusKey), tabStops.get(keyGroup(focusKey))]);
    }
  }

  /** Wire one painted radio group: a single Tab stop (the checked radio, else
   *  the first) and the arrow keys moving focus AND the check through it. */
  function wireRadios(group: string, radios: readonly Radio[]): void {
    const stop = rovingTabStop(radios.map((r) => r.checked));
    radios.forEach((r, i) => {
      r.btn.setAttribute('role', 'radio');
      r.btn.setAttribute('aria-checked', r.checked ? 'true' : 'false');
      r.btn.tabIndex = i === stop ? 0 : -1;
      r.btn.addEventListener('click', r.pick);
      r.btn.addEventListener('keydown', (ev) => {
        const next = plainKey(ev) ? rovingTarget(ev.key, i, radios.length, 'both') : null;
        if (next === null) return;
        ev.preventDefault();
        // focus first, so the repaint the pick causes carries the NEW radio
        radios[next].btn.focus();
        radios[next].pick();
      });
    });
    const stopBtn = radios[stop]?.btn;
    if (stopBtn) tabStops.set(group, stopBtn);
  }

  function paintSection(s: WocBuilderSection, f: WocFaceAppearance): HTMLElement {
    const wrap = el('div', `whb-section whb-section-${s.kind}`);
    if (s.kind === 'options') {
      if (s.labelKey) wrap.appendChild(el('div', 'whb-section-label', tk(s.labelKey)));
      const list = el('div', s.target === 'bodyType' ? 'whb-opts whb-opts-body' : 'whb-opts');
      list.setAttribute('role', 'radiogroup');
      list.setAttribute('aria-label', tk(s.labelKey ?? categoryLabelKey(menu.open)));
      const radios: Radio[] = s.options.map((o) => {
        const b = el('button', o.selected ? 'whb-opt sel' : 'whb-opt');
        b.type = 'button';
        b.dataset.focusKey = `${s.target}:${o.id}`;
        if (o.glyphKey) {
          // decorative: the label beside it already names the body type
          const glyph = el('span', 'whb-opt-glyph', tk(o.glyphKey));
          glyph.setAttribute('aria-hidden', 'true');
          b.appendChild(glyph);
        }
        b.appendChild(el('span', 'whb-opt-label', tk(o.labelKey)));
        list.appendChild(b);
        return {
          btn: b,
          checked: o.selected,
          // re-picking the checked option changes nothing, so it emits nothing
          pick: () => {
            if (!o.selected) apply(pickOption(face(), s.target, o.id));
          },
        };
      });
      wireRadios(s.target, radios);
      wrap.appendChild(list);
      return wrap;
    }
    if (s.kind === 'swatches') {
      // One radio group per colour: the Match Hair chip (brows) and the
      // swatches. The custom control is a colour input, not a radio, so it
      // sits after the group and lights when no radio is checked. Colour keys
      // carry their own prefix: the hairstyle list is `hair:` too.
      const keys = `color-${s.target}`;
      const group = el('div', 'whb-swatch-group');
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', tk(categoryLabelKey(menu.open)));
      const radios: Radio[] = [];
      if (s.matchHair !== undefined) {
        const m = el('button', s.matchHair ? 'whb-match sel' : 'whb-match');
        m.type = 'button';
        m.dataset.focusKey = `${keys}:match`;
        const dot = el('span', 'whb-match-dot');
        dot.style.setProperty('--whb-sw', hslToCss(f.hairHue, f.hairSat, f.hairLight));
        m.append(dot, el('span', 'whb-opt-label', t('auth.wocBuilder.matchHair')));
        group.appendChild(m);
        radios.push({
          btn: m,
          checked: s.matchHair,
          pick: () => {
            const cur = face();
            if (!browsMatchHair(cur)) apply(matchBrowsToHair(cur));
          },
        });
      }
      // per-target class: the skin run is long enough to want its own grid
      const grid = el('div', `whb-swatches whb-swatches-${s.target}`);
      for (const w of s.swatches) {
        const b = el('button', w.selected ? 'whb-sw sel' : 'whb-sw');
        b.type = 'button';
        b.setAttribute('aria-label', tk(w.labelKey));
        b.title = tk(w.labelKey);
        b.dataset.focusKey = `${keys}:${w.id}`;
        b.style.setProperty('--whb-sw', hslToCss(w.hue, w.sat, w.light));
        grid.appendChild(b);
        radios.push({
          btn: b,
          checked: w.selected,
          // always applied: a live custom drag leaves the painted check stale
          pick: () => {
            const next = setColor(face(), s.target, w.hue, w.sat, w.light);
            // the brows' swatch equal to the hair colour IS Match Hair, so the
            // check (and the focus, across the repaint) lands on that chip
            if (s.matchHair !== undefined && browsMatchHair(next)) radios[0]?.btn.focus();
            apply(next);
          },
        });
      }
      group.appendChild(grid);
      wireRadios(keys, radios);
      wrap.appendChild(group);

      const cur = targetColor(f, s.target);
      const row = el('label', s.custom ? 'whb-custom sel' : 'whb-custom');
      const input = el('input', 'whb-custom-input');
      input.type = 'color';
      input.value = hslToCss(cur.hue, cur.sat, cur.light);
      input.dataset.focusKey = `${keys}:custom`;
      input.setAttribute('aria-label', tk(s.customLabelKey));
      row.append(input, el('span', 'whb-opt-label', t('auth.customColor')));
      input.addEventListener('input', () => {
        const hsl = hexToHsl(input.value);
        if (!hsl) return;
        // live preview without redrawing the panel under the open picker
        apply(setColor(face(), s.target, hsl.hue, hsl.sat, hsl.light), false);
      });
      input.addEventListener('change', () => paintPanel(true));
      wrap.appendChild(row);
      return wrap;
    }
    return paintSlider(wrap, s);
  }

  function paintSlider(wrap: HTMLElement, s: WocSliderSection): HTMLElement {
    const id = `${uid}-sl-${s.target}`;
    const head = el('div', 'whb-slider-head');
    const label = el('label', 'whb-section-label', tk(s.labelKey));
    label.htmlFor = id;
    const readout = el('span', 'whb-slider-value');
    readout.setAttribute('aria-hidden', 'true');
    head.append(label, readout);
    const input = el('input', 'whb-slider');
    input.type = 'range';
    input.id = id;
    input.min = String(s.min);
    input.max = String(s.max);
    input.step = String(s.step);
    input.value = String(s.value);
    input.dataset.focusKey = `slider:${s.target}`;
    const show = (v: number) => {
      const text = sliderReadout(s.readout, v);
      readout.textContent = text;
      // a screen reader hears the same readout, not the raw 0.65
      input.setAttribute('aria-valuetext', text);
      input.style.setProperty('--whb-fill', `${sliderFill(s, v)}%`);
    };
    show(s.value);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      show(v);
      apply(setSlider(face(), s.target, v), false);
    });
    input.addEventListener('dblclick', () => {
      input.value = String(s.def);
      input.dispatchEvent(new Event('input'));
    });
    wrap.append(head, input);
    if (s.ticks) {
      // the scale under the track (the readout above already speaks the value)
      const scale = el('div', 'whb-slider-scale');
      scale.setAttribute('aria-hidden', 'true');
      for (const tick of s.ticks)
        scale.append(el('span', 'whb-slider-tick', sliderReadout(s.readout, tick)));
      wrap.append(scale);
    }
    return wrap;
  }

  on(randomBtn, 'click', () => apply(randomizeFace(face(), Math.random)));
  on(resetBtn, 'click', () => apply(resetFace(face())));

  paintMenu();
  paintPanel(false);

  return {
    get value() {
      return value;
    },
    get focus() {
      return focusForCategory(menu.open);
    },
    set(next: Partial<ModularAppearance>) {
      const merged = { ...value, ...next } as Partial<ModularAppearance>;
      value = mergeFace(merged, readFace(merged as Partial<WocFaceAppearance>));
      paintPanel(true);
    },
    destroy() {
      destroyed = true;
      for (const c of cleanups) c();
      cleanups.length = 0;
      host.textContent = '';
      host.classList.remove('whb');
      opts.onFocus?.('body');
    },
  };
}
