// Widget toolkit: tiny DOM builder, an inline icon set, and the handful of
// controls every panel is made of (sections, drag-scrub number fields,
// sliders, selects, switches, segmented groups, swatch grids, toasts).
// No framework on purpose, the studio is one page and the widgets are few.

export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node[k.toLowerCase()] = v;
    else if (k in node && k !== 'style' && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

// ---------------------------------------------------------------------------
// Preferences (localStorage), declared first: section() reads them at
// module-init time.
// ---------------------------------------------------------------------------
const PREFS_KEY = 'fitstudio.prefs.v2';
let prefsCache = null;
export function loadPrefs() {
  if (!prefsCache) {
    try {
      prefsCache = JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {};
    } catch {
      prefsCache = {};
    }
  }
  return prefsCache;
}
let prefsTimer = 0;
export function savePrefs(patch) {
  Object.assign(loadPrefs(), patch);
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefsCache));
    } catch {}
  }, 400);
}

// ---------------------------------------------------------------------------
// Icons, 16x16 strokes, drawn to match at 1.5px weight.
// ---------------------------------------------------------------------------
const P = {
  move: 'M8 1v14M1 8h14M8 1 6 3M8 1l2 2M8 15l-2-2M8 15l2-2M1 8l2-2M1 8l2 2M15 8l-2-2M15 8l-2 2',
  rotate: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3',
  scale: 'M2 9v5h5M2.5 13.5 8 8M14 7V2H9M13.5 2.5 10 6',
  world:
    'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm-6.2 4h12.4M1.8 10.5h12.4M8 1.5c-1.8 1.6-2.8 4-2.8 6.5S6.2 13 8 14.5c1.8-1.5 2.8-4 2.8-6.5S9.8 3.1 8 1.5Z',
  cube: 'M8 1.5 14 5v6l-6 3.5L2 11V5l6-3.5ZM8 8l6-3M8 8 2 5m6 3v6.5',
  magnet: 'M5.5 2v5a2.5 2.5 0 0 0 5 0V2M5.5 2h-3v5A5.5 5.5 0 0 0 13.5 7V2h-3M2.5 5h3m5 0h3',
  undo: 'M2.5 6.5h7a4 4 0 0 1 0 8H6M2.5 6.5 6 3M2.5 6.5 6 10',
  redo: 'M13.5 6.5h-7a4 4 0 0 0 0 8H10M13.5 6.5 10 3m3.5 3.5L10 10',
  save: 'M3 2h8l3 3v9H3V2Zm3 0v4h5V2M5 14v-4h6v4',
  trash: 'M2.5 4h11M6 4V2h4v2m-6.5 0 .8 10h7.4l.8-10M6.5 7v4m3-4v4',
  copy: 'M6 6h8v8H6V6Zm4-4H2v8h2',
  paste: 'M6 2h4v2H6V2Zm-2 1H3v11h10V3h-1M6 8h4m-4 3h4',
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm3.5 8L14 14',
  x: 'M3 3l10 10M13 3 3 13',
  chevron: 'M6 3l5 5-5 5',
  camera: 'M2 5h3l1.5-2h3L11 5h3v8H2V5Zm6 1.5A2.7 2.7 0 1 0 8 12a2.7 2.7 0 0 0 0-5.5Z',
  grid: 'M2 2h12v12H2V2Zm0 4h12M2 10h12M6 2v12m4-12v12',
  wire: 'M2 13 8 3l6 10H2Zm3-5h6M8 3v10M5 8l3 5m3-5-3 5',
  ghost:
    'M8 2a5 5 0 0 1 5 5v7l-1.7-1.5L9.7 14 8 12.5 6.3 14l-1.6-1.5L3 14V7a5 5 0 0 1 5-5Zm-2 5h.01M10 7h.01',
  // x-ray: an eye, i.e. seeing THROUGH the body rather than hiding it
  xray: 'M1.3 8S4 3.8 8 3.8 14.7 8 14.7 8 12 12.2 8 12.2 1.3 8 1.3 8Zm6.7-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  spin: 'M8 3c3.9 0 6.5 1.3 6.5 3S11.9 9 8 9 1.5 7.7 1.5 6 4.1 3 8 3Zm5 5.5c.9.5 1.5 1.1 1.5 1.8 0 1.7-2.6 3-6.5 3s-6.5-1.3-6.5-3c0-.7.6-1.4 1.5-1.8M11 11.5l2-1.6.6 2.5',
  sun: 'M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM8 1v2m0 10v2M1 8h2m10 0h2M3 3l1.4 1.4m7.2 7.2L13 13m0-10-1.4 1.4M4.4 11.6 3 13',
  check: 'M2.5 8.5 6 12l7.5-8',
  warn: 'M8 2 1.5 13.5h13L8 2Zm0 4.5V10m0 1.8v.01',
  info: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM8 7v4m0-6.5v.01',
  dice: 'M2 2h12v12H2V2Zm3.2 3.2h.01M10.8 5.2h.01M8 8h.01M5.2 10.8h.01m5.6 0h.01',
  sliders: 'M2 4.5h8m3 0h1m-12 7h3m3 0h8M10 3v3M5 10v3',
  body: 'M8 1.5A1.8 1.8 0 1 0 8 5a1.8 1.8 0 0 0 0-3.5ZM3 6.5h10M8 6v4.5m0 0L5 14.5M8 10.5l3 4',
  hair: 'M3 14V7a5 5 0 0 1 10 0v7M3 9c2-.5 3-2 3.4-4M13 9c-2-.5-3-2-3.4-4M8 3v3',
  gem: 'M4.5 2h7L14 6l-6 8.5L2 6l2.5-4ZM2 6h12M6 2 5 6l3 8.5M10 2l1 4-3 8.5',
  // hair band: a cuff seen slightly from above, a wrapped ring, not a hoop
  ring: 'M8 2.6c3 0 5.4 1.2 5.4 2.6S11 7.8 8 7.8 2.6 6.6 2.6 5.2 5 2.6 8 2.6Zm-5.4 2.6v5.6c0 1.4 2.4 2.6 5.4 2.6s5.4-1.2 5.4-2.6V5.2',
  brush: 'M9.5 2.5 13.5 6.5 6 14H2v-4l7.5-7.5ZM8 4l4 4',
  eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Zm6.5-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  keyboard:
    'M1.5 4h13v8h-13V4Zm2 2h.01M6 6h.01M8.5 6h.01M11 6h.01M13 6h.01M3.5 8h.01M6 8h.01M8.5 8h.01M11 8h.01M13 8h.01M5 10h6',
  frame: 'M2 5V2h3m6 0h3v3m0 6v3h-3m-6 0H2v-3M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  play: 'M4 2.5v11l9-5.5-9-5.5Z',
  pause: 'M4 2.5h3v11H4v-11Zm5 0h3v11H9v-11Z',
  reset: 'M2.5 8a5.5 5.5 0 1 1 1.6 3.9M2.5 14.5v-3h3',
  swap: 'M4 5h9M10.5 2.5 13.5 5l-3 2.5m1.5 3.5H3m2.5-2.5L2.5 11l3 2.5',
  person: 'M8 2a2.6 2.6 0 1 0 0 5.2A2.6 2.6 0 0 0 8 2ZM2.8 14c.5-3 2.6-4.6 5.2-4.6s4.7 1.6 5.2 4.6',
  download: 'M8 2v8m0 0-3-3m3 3 3-3M2.5 13.5h11',
};

export function icon(name, size = 15) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', P[name] ?? P.info);
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

// ---------------------------------------------------------------------------
// Buttons / segmented
// ---------------------------------------------------------------------------
export function btn({ label, ic, tip, kind = '', onClick }) {
  const b = h('button', { class: `btn ${kind}`.trim(), 'data-tip': tip ?? null, onclick: onClick });
  if (ic) b.append(icon(ic));
  if (label) b.append(label);
  return b;
}

/** options: [{value, label?, ic?, tip?}], returns {root, set(v), get()} */
export function segmented(options, value, onChange, { mini = false } = {}) {
  const root = h('div', { class: `seg${mini ? ' mini' : ''}` });
  let cur = value;
  const buttons = options.map((o) => {
    const b = h('button', { 'data-tip': o.tip ?? null, onclick: () => set(o.value, true) });
    if (o.ic) b.append(icon(o.ic, mini ? 13 : 15));
    if (o.label) b.append(o.label);
    root.append(b);
    return { b, o };
  });
  function set(v, fire = false) {
    cur = v;
    for (const { b, o } of buttons) b.classList.toggle('on', o.value === v);
    if (fire) onChange?.(v);
  }
  set(value);
  return { root, set, get: () => cur };
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------
const sectionState = loadPrefs().sections ?? {};
export function section(id, title, { open = true, count = null, actions = null } = {}) {
  const isOpen = sectionState[id] ?? open;
  const body = h('div', { class: 'sec-body' });
  const countEl = h('span', { class: 'count' }, count ?? '');
  const head = h(
    'button',
    { class: 'sec-head' },
    h('span', { class: 'chev' }, icon('chevron', 11)),
    title,
    countEl,
  );
  const root = h('div', { class: `sec${isOpen ? ' open' : ''}` }, head, body);
  if (actions) head.insertBefore(actions, countEl);
  head.onclick = (e) => {
    if (actions && actions.contains(e.target)) return;
    const nowOpen = !root.classList.contains('open');
    root.classList.toggle('open', nowOpen);
    sectionState[id] = nowOpen;
    savePrefs({ sections: sectionState });
  };
  return { root, body, setCount: (n) => (countEl.textContent = n) };
}

// ---------------------------------------------------------------------------
// Drag-scrub number field
// ---------------------------------------------------------------------------
/** Drag horizontally to scrub, click to type. step = change per pixel.
 *  Returns {root, set(v), get()}; onInput fires on every change, onCommit once
 *  a gesture (drag or edit) ends, the undo hook. */
export function numField({
  axis = null,
  value = 0,
  step = 0.005,
  digits = 3,
  min = -Infinity,
  max = Infinity,
  onInput,
  onCommit,
}) {
  let cur = value;
  const input = h('input', { type: 'text', tabindex: -1 });
  const root = h('div', { class: 'num' });
  if (axis) root.append(h('span', { class: `axis ${axis.toLowerCase()}` }, axis.toUpperCase()));
  root.append(input);
  const fmt = () => {
    input.value = cur.toFixed(digits);
  };
  fmt();

  function apply(v, fire = true) {
    cur = Math.min(max, Math.max(min, v));
    fmt();
    if (fire) onInput?.(cur);
  }

  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    if (root.classList.contains('editing') || e.button !== 0) return;
    drag = { x: e.clientX, start: cur, moved: false };
    root.setPointerCapture(e.pointerId);
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 3) return;
    drag.moved = true;
    const fine = e.shiftKey ? 0.1 : 1;
    apply(drag.start + dx * step * fine);
  });
  root.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const wasDrag = drag.moved;
    const start = drag.start;
    drag = null;
    root.releasePointerCapture?.(e.pointerId);
    if (wasDrag) {
      if (start !== cur) onCommit?.(cur, start);
    } else beginEdit();
  });
  function beginEdit() {
    root.classList.add('editing');
    input.tabIndex = 0;
    input.focus();
    input.select();
  }
  function endEdit(commit) {
    if (!root.classList.contains('editing')) return;
    root.classList.remove('editing');
    input.tabIndex = -1;
    if (commit) {
      const v = Number(input.value);
      if (Number.isFinite(v) && v !== cur) {
        const old = cur;
        apply(v);
        onCommit?.(cur, old);
        return;
      }
    }
    fmt();
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      endEdit(true);
      input.blur();
    } else if (e.key === 'Escape') {
      endEdit(false);
      input.blur();
    }
    e.stopPropagation();
  });
  input.addEventListener('blur', () => endEdit(true));
  return { root, set: (v) => apply(v, false), get: () => cur };
}

// ---------------------------------------------------------------------------
// Slider row (label + range + editable value)
// ---------------------------------------------------------------------------
export function sliderRow({
  label,
  min = 0,
  max = 1,
  step = 0.01,
  value = 0,
  digits = 2,
  hue = false,
  onInput,
  onCommit,
  format,
}) {
  let cur = value;
  const range = h('input', { type: 'range', class: hue ? 'hue' : '', min, max, step, value });
  const out = h('output');
  const root = h('div', { class: 'sliderrow' }, h('label', { title: label }, label), range, out);
  const show = () => {
    out.textContent = format ? format(cur) : Number(cur).toFixed(digits);
  };
  show();
  let gestureStart = null;
  range.oninput = () => {
    if (gestureStart === null) gestureStart = cur;
    cur = Number(range.value);
    show();
    onInput?.(cur);
  };
  range.onchange = () => {
    if (gestureStart !== null && gestureStart !== cur) onCommit?.(cur, gestureStart);
    gestureStart = null;
  };
  out.onclick = () => {
    if (out.querySelector('input')) return; // already editing
    const input = h('input', { type: 'text', value: format ? String(cur) : cur.toFixed(digits) });
    out.replaceChildren(input);
    input.focus();
    input.select();
    const done = (commit) => {
      const v = Number(input.value);
      if (commit && Number.isFinite(v)) {
        const old = cur;
        cur = Math.min(max, Math.max(min, v));
        range.value = cur;
        onInput?.(cur);
        if (old !== cur) onCommit?.(cur, old);
      }
      out.replaceChildren();
      show();
    };
    input.onblur = () => done(true);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') input.blur();
      else if (e.key === 'Escape') {
        input.onblur = null;
        done(false);
      }
      e.stopPropagation();
    };
  };
  return {
    root,
    set: (v) => {
      cur = v;
      range.value = v;
      show();
    },
    get: () => cur,
  };
}

// ---------------------------------------------------------------------------
// Select / switch rows
// ---------------------------------------------------------------------------
export function selectRow({ label, options, value, onChange }) {
  const sel = h('select', { onchange: () => onChange?.(sel.value) });
  for (const o of options) {
    const opt = typeof o === 'string' ? { value: o, label: o } : o;
    sel.append(h('option', { value: opt.value }, opt.label));
  }
  if (value !== undefined) sel.value = value;
  const root = h('div', { class: 'row' }, h('label', {}, label), h('span', { class: 'grow' }, sel));
  sel.style.width = '100%';
  return { root, set: (v) => (sel.value = v), get: () => sel.value, el: sel };
}

export function switchRow({ label, value = false, onChange }) {
  const input = h('input', { type: 'checkbox', checked: value });
  const sw = h('label', { class: 'switch' }, input, h('i'));
  input.onchange = () => onChange?.(input.checked);
  const root = h('div', { class: 'row' }, h('label', {}, label), h('span', { class: 'grow' }), sw);
  return { root, set: (v) => (input.checked = v), get: () => input.checked };
}

// ---------------------------------------------------------------------------
// Swatch grid
// ---------------------------------------------------------------------------
/** items: [{key, css, label?, tip?}], returns {root, set(key)} */
export function swatchGrid(items, value, onChange) {
  const root = h('div', { class: 'swatches' });
  let cur = value;
  const cells = items.map((it) => {
    const c = h('button', {
      class: 'swatch',
      'data-tip': it.tip ?? it.key,
      style: `background:${it.css}`,
      onclick: () => {
        set(it.key);
        onChange?.(it.key);
      },
    });
    if (it.label) c.append(h('span', { class: 'label' }, it.label));
    root.append(c);
    return { c, it };
  });
  function set(k) {
    cur = k;
    for (const { c, it } of cells) c.classList.toggle('on', it.key === k);
  }
  set(value);
  return { root, set, get: () => cur };
}

// ---------------------------------------------------------------------------
// Toasts + status
// ---------------------------------------------------------------------------
const toastHost = () => document.getElementById('toasts');
export function toast(msg, kind = '') {
  const ic = kind === 'good' ? 'check' : kind === 'warn' ? 'warn' : kind === 'bad' ? 'x' : 'info';
  const t = h('div', { class: `toast ${kind}` }, icon(ic, 14), msg);
  toastHost().append(t);
  setTimeout(
    () => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 220);
    },
    kind === 'bad' ? 5200 : 2600,
  );
  while (toastHost().children.length > 4) toastHost().firstChild.remove();
}
