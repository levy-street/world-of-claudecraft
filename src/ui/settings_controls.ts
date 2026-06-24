// Generic, reusable settings-control builders shared by any options panel.
//
// These are DOM-thin and host-agnostic: each takes plain get/set callbacks plus
// already-localized label strings, so the module imports nothing app-specific
// (no i18n, audio, or GameSettings coupling) and is unit-testable under jsdom.
// Callers wire localization (t()), formatting (formatNumber), and side effects
// (audio click, persistence) through the callbacks. Visuals reuse the existing
// `.set-row`/`.set-*` CSS in index.html so panels stay consistent.

/** Build a labelled `.set-row` shell. Returns the row plus its name span so the
 *  caller (or the builders below) can append the control(s) into column 2+. */
export function settingRow(label: string): { row: HTMLDivElement; name: HTMLSpanElement } {
  const row = document.createElement('div');
  row.className = 'set-row';
  const name = document.createElement('span');
  name.className = 'set-name';
  name.textContent = label;
  row.appendChild(name);
  return { row, name };
}

/** A titled card/section container (role="group"), labelled for assistive tech. */
export function settingsCard(parent: HTMLElement, title: string, opts: { className?: string } = {}): HTMLDivElement {
  const card = document.createElement('div');
  card.className = `perf-card${opts.className ? ` ${opts.className}` : ''}`;
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', title);
  const head = document.createElement('div');
  head.className = 'perf-card-title';
  head.textContent = title;
  card.appendChild(head);
  parent.appendChild(card);
  return card;
}

/** A lighter subhead used inside a card (e.g. metric-group headers). */
export function subhead(parent: HTMLElement, title: string, className = 'perf-group-head'): HTMLDivElement {
  const h = document.createElement('div');
  h.className = className;
  h.textContent = title;
  parent.appendChild(h);
  return h;
}

export interface ToggleOpts {
  parent: HTMLElement;
  label: string;
  get: () => boolean;
  set: (v: boolean) => void;
  /** Localized "On"/"Off" labels for the button text. */
  onLabel: string;
  offLabel: string;
  /** Optional side effect (e.g. a click sound) fired on each activation. */
  onActivate?: () => void;
}

/** A labelled On/Off toggle button. Returns a `sync()` to refresh from `get()`. */
export function toggleControl(o: ToggleOpts): { row: HTMLDivElement; sync: () => void } {
  const { row } = settingRow(o.label);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'btn set-toggle';
  const sync = (): void => {
    const on = o.get();
    toggle.textContent = on ? o.onLabel : o.offLabel;
    toggle.classList.toggle('off', !on);
    toggle.setAttribute('aria-pressed', String(on));
    toggle.setAttribute('aria-label', o.label);
  };
  sync();
  toggle.addEventListener('click', () => {
    o.onActivate?.();
    o.set(!o.get());
    sync();
  });
  row.appendChild(toggle);
  o.parent.appendChild(row);
  return { row, sync };
}

export interface SliderOpts {
  parent: HTMLElement;
  label: string;
  get: () => number;
  set: (v: number) => void;
  min: number;
  max: number;
  step: number;
  /** Render the right-hand readout from the live value. */
  format: (v: number) => string;
}

/** A labelled range slider with a live readout. Returns `setValue()` so an
 *  external change (e.g. drag-to-move) can push a new value into the control
 *  without a full re-render. */
export function sliderControl(o: SliderOpts): { row: HTMLDivElement; setValue: (v: number) => void } {
  const { row } = settingRow(o.label);
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'set-slider';
  slider.min = String(o.min);
  slider.max = String(o.max);
  slider.step = String(o.step);
  slider.value = String(o.get());
  slider.setAttribute('aria-label', o.label);
  const val = document.createElement('span');
  val.className = 'set-val';
  const readout = (): void => { val.textContent = o.format(o.get()); };
  readout();
  slider.addEventListener('input', () => { o.set(Number(slider.value)); readout(); });
  row.append(slider, val);
  o.parent.appendChild(row);
  return {
    row,
    setValue: (v: number) => { slider.value = String(v); readout(); },
  };
}

export interface ColorOpts {
  parent: HTMLElement;
  label: string;
  get: () => string;
  set: (v: string) => void;
}

/** A labelled native color picker bound to a hex string. */
export function colorControl(o: ColorOpts): { row: HTMLDivElement } {
  const { row } = settingRow(o.label);
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.className = 'set-color';
  picker.value = o.get();
  picker.setAttribute('aria-label', o.label);
  picker.addEventListener('input', () => o.set(picker.value));
  row.appendChild(picker);
  o.parent.appendChild(row);
  return { row };
}
