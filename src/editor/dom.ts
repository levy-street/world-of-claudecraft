// Tiny DOM builders shared by the editor panels. textContent-only (no innerHTML
// interpolation anywhere in the editor, so no escaping hazard).

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(
  label: string,
  onClick: () => void,
  cls?: string,
  title?: string,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (cls) b.className = cls;
  if (title) {
    b.title = title;
    b.setAttribute('aria-label', title);
  }
  b.addEventListener('click', onClick);
  return b;
}

// Inline 24x24 stroke icon (Feather-style), the editor's shared glyph convention.
// `path` is SVG path data; the icon inherits the button's text color via
// currentColor. Matches the tool-palette icons in toolbar.ts.
export function iconSvg(path: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}

// Like button(), but the visible label is an inline SVG icon instead of text.
export function iconButton(
  path: string,
  onClick: () => void,
  cls?: string,
  title?: string,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.appendChild(iconSvg(path));
  if (cls) b.className = cls;
  if (title) {
    b.title = title;
    b.setAttribute('aria-label', title);
  }
  b.addEventListener('click', onClick);
  return b;
}

export interface SliderOptions {
  min: number;
  max: number;
  step: number;
  value: number;
  /** Live while dragging. */
  onInput: (v: number) => void;
  /** Committed value (pointer released / keyboard blur); for undo entries. */
  onChange?: (v: number) => void;
  format?: (v: number) => string;
  /** Inverse of `format`: parse typed text back into a SLIDER-space value
   *  (returns null when the text is not a usable number). Defaults to reading
   *  the leading number, which fits every identity/unit-suffixed slider; only
   *  a non-linear slider (e.g. the log-mapped brush size) needs a custom one. */
  parse?: (text: string) => number | null;
}

export interface SliderHandle {
  root: HTMLElement;
  input: HTMLInputElement;
  set(value: number): void;
}

/** A labelled range slider whose value readout is ALSO a click-to-type input:
 *  drag the slider or click the number and type an exact value. */
export function slider(label: string, opts: SliderOptions): SliderHandle {
  const row = el('label', 'ed-slider');
  const fmt = opts.format ?? ((v: number) => String(v));
  const parse =
    opts.parse ??
    ((text: string): number | null => {
      const n = Number.parseFloat(text);
      return Number.isFinite(n) ? n : null;
    });
  const head = el('span', 'ed-slider-head');
  head.append(el('span', 'ed-slider-label', label));
  // The value readout is an editable field: click it to type an exact value.
  const value = document.createElement('input');
  value.type = 'text';
  value.className = 'ed-slider-num';
  value.inputMode = 'decimal';
  value.value = fmt(opts.value);
  value.setAttribute('aria-label', label);
  head.append(value);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step);
  input.value = String(opts.value);
  input.setAttribute('aria-label', label);

  // Snap a raw number to the slider's own range+step (the range input is the
  // authority, so route through it and read the snapped result back).
  const snap = (v: number): number => {
    const clamped = Math.min(opts.max, Math.max(opts.min, v));
    input.value = String(clamped);
    return Number(input.value);
  };

  input.addEventListener('input', () => {
    const v = Number(input.value);
    if (document.activeElement !== value) value.value = fmt(v);
    opts.onInput(v);
  });
  if (opts.onChange) {
    input.addEventListener('change', () => opts.onChange?.(Number(input.value)));
  }

  const commitTyped = (): void => {
    const parsed = parse(value.value);
    if (parsed === null) {
      value.value = fmt(Number(input.value)); // reject: restore the live value
      return;
    }
    const v = snap(parsed);
    value.value = fmt(v);
    opts.onInput(v);
    opts.onChange?.(v);
  };
  // The editor has global single-key tool shortcuts: keep typing out of them.
  value.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') {
      commitTyped();
      value.blur();
    } else if (ev.key === 'Escape') {
      value.value = fmt(Number(input.value));
      value.blur();
    }
  });
  value.addEventListener('blur', commitTyped);
  value.addEventListener('focus', () => value.select());

  row.append(head, input);
  return {
    root: row,
    input,
    set(v: number): void {
      input.value = String(v);
      value.value = fmt(v);
    },
  };
}

export interface SelectOption {
  value: string;
  label: string;
}

/** A labelled dropdown (native select). */
export function selectRow(
  label: string,
  options: SelectOption[],
  value: string,
  onChange: (v: string) => void,
): { root: HTMLElement; input: HTMLSelectElement } {
  const wrap = el('label', 'ed-field');
  wrap.appendChild(el('span', undefined, label));
  const input = document.createElement('select');
  input.setAttribute('aria-label', label);
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    input.appendChild(opt);
  }
  input.value = value;
  input.addEventListener('change', () => onChange(input.value));
  wrap.appendChild(input);
  return { root: wrap, input };
}

export function checkbox(
  label: string,
  checked: boolean,
  onChange: (on: boolean) => void,
): { root: HTMLElement; input: HTMLInputElement } {
  const wrap = el('label', 'ed-check');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  wrap.append(input, el('span', undefined, label));
  return { root: wrap, input };
}
