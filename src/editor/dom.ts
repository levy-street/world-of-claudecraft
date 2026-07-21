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
}

export interface SliderHandle {
  root: HTMLElement;
  input: HTMLInputElement;
  set(value: number): void;
}

/** A labelled range slider whose label shows the live value. */
export function slider(label: string, opts: SliderOptions): SliderHandle {
  const row = el('label', 'ed-slider');
  const fmt = opts.format ?? ((v: number) => String(v));
  const span = el('span', 'ed-slider-label', `${label}: ${fmt(opts.value)}`);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step);
  input.value = String(opts.value);
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    span.textContent = `${label}: ${fmt(v)}`;
    opts.onInput(v);
  });
  if (opts.onChange) {
    input.addEventListener('change', () => opts.onChange?.(Number(input.value)));
  }
  row.append(span, input);
  return {
    root: row,
    input,
    set(value: number): void {
      input.value = String(value);
      span.textContent = `${label}: ${fmt(value)}`;
    },
  };
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
