// @vitest-environment happy-dom

// The launcher turntable's loading silhouette (src/ui/preview_loading_silhouette.ts):
// the 2D layer CharacterPreview shows over its stage until the 3D character draws.
// Pinned here: it costs no DOM before the first show, it is ONE reused node that
// moves between stage containers and marks none of them busy, its polite status
// region goes in empty and gets its text a frame boundary later (so the text is an
// update a screen reader announces), a repeat show writes nothing and asks for no
// frame (CharacterPreview calls it every frame), hide leaves no trace, every
// layer's url(#...) references are its own, both figures are closed and mirror
// symmetric, every class it mints is styled by its shell.css section, and its
// status text is a localized key (with the M16 non-Latin fills) that follows a
// language switch.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import {
  createPreviewLoadingSilhouette,
  PREVIEW_LOADING_SILHOUETTE_CLASS,
  type PreviewLoadingLayer,
} from '../src/ui/preview_loading_silhouette';

// The five non-Latin locales the M16 rule requires a wordy new English value to
// ship fills for in the same change.
const NON_LATIN = ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const;

// The rel arg must stay a VARIABLE under happy-dom (its web transform rewrites a
// literal new URL(..., import.meta.url) to an http URL readFileSync rejects).
const read = (rel: string): string =>
  readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MODULE_SOURCE = read('../src/ui/preview_loading_silhouette.ts');
const SHELL_CSS = read('../src/styles/shell.css');
const SECTION_BANNER = '/* ---------- character preview loading silhouette ---------- */';
/** The module's own shell.css section: its banner to the next ten-dash banner or the end. */
function silhouetteSection(): string {
  const start = SHELL_CSS.indexOf(SECTION_BANNER);
  expect(start, 'the section banner is missing from shell.css').toBeGreaterThanOrEqual(0);
  const rest = SHELL_CSS.slice(start + SECTION_BANNER.length);
  const next = rest.search(/\/\*\s*-{10,}\s*[^*]+?\s*-{10,}\s*\*\//);
  return next < 0 ? rest : rest.slice(0, next);
}
const stripCssComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

type Pt = readonly [number, number];
interface PathSeg {
  readonly cmd: 'C' | 'L';
  readonly from: Pt;
  /** The control points then the end point (C), or the end point alone (L). */
  readonly pts: readonly Pt[];
}

/** Parse the absolute M / C / L / Z path data this module emits into segments. */
function parsePath(d: string): { start: Pt; segs: PathSeg[]; closed: boolean } {
  const tokens = d.match(/[MCLZ]|-?\d+(?:\.\d+)?/g) ?? [];
  expect(tokens[0]).toBe('M');
  let i = 1;
  const pair = (): Pt => {
    const pt: Pt = [Number(tokens[i]), Number(tokens[i + 1])];
    i += 2;
    return pt;
  };
  const start = pair();
  let at = start;
  const segs: PathSeg[] = [];
  let closed = false;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'Z') {
      closed = true;
      break;
    }
    expect(cmd === 'C' || cmd === 'L', `unexpected path command ${cmd}`).toBe(true);
    const pts = cmd === 'C' ? [pair(), pair(), pair()] : [pair()];
    segs.push({ cmd: cmd as 'C' | 'L', from: at, pts });
    at = pts[pts.length - 1];
  }
  expect(i, 'nothing may follow the Z').toBe(tokens.length);
  return { start, segs, closed };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Every way `d` fails to be a closed outline that is mirror-symmetric about
 *  x = w / 2 the way the module builds one: its right half, then that half
 *  mirrored and walked back. Segment by segment, a mirrored C runs to the mirror
 *  of where its twin began, with the twin's control points mirrored AND swapped. */
function symmetryProblems(d: string, w: number): string[] {
  const problems: string[] = [];
  const { start, segs, closed } = parsePath(d);
  if (!closed) problems.push('not closed');
  if (round2(start[0]) !== round2(w / 2))
    problems.push(`starts off the centre line, x=${start[0]}`);
  const last = segs[segs.length - 1];
  if (!last || !samePt(last.pts[last.pts.length - 1], start)) {
    problems.push('the last segment does not land back on the start');
  }
  if (segs.length % 2 !== 0) problems.push(`odd segment count ${segs.length}`);
  const mirror = ([x, y]: Pt): Pt => [w - x, y];
  for (let k = 0; k < Math.floor(segs.length / 2); k++) {
    const a = segs[k];
    const b = segs[segs.length - 1 - k];
    const expected =
      a.cmd === 'C' ? [mirror(a.pts[1]), mirror(a.pts[0]), mirror(a.from)] : [mirror(a.from)];
    const same =
      b.cmd === a.cmd &&
      b.pts.length === expected.length &&
      b.pts.every((pt, j) => samePt(pt, expected[j]));
    if (!same) problems.push(`segment ${k} is not mirrored by segment ${segs.length - 1 - k}`);
  }
  return problems;
}
const samePt = (a: Pt, b: Pt): boolean =>
  round2(a[0]) === round2(b[0]) && round2(a[1]) === round2(b[1]);

const layersIn = (root: ParentNode): HTMLElement[] => [
  ...root.querySelectorAll<HTMLElement>(`.${PREVIEW_LOADING_SILHOUETTE_CLASS}`),
];

/** Every DOM write under `root` that `run` makes: child list, attributes and text. */
function mutationsDuring(root: Node, run: () => void): MutationRecord[] {
  const observer = new MutationObserver(() => {});
  observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  run();
  const records = observer.takeRecords();
  observer.disconnect();
  return records;
}

/** Let `n` animation frames pass. happy-dom runs frame callbacks as FIFO
 *  immediates, so a callback the layer requested before this call has run once
 *  the matching frame resolves. */
const frames = (n: number): Promise<void> =>
  new Promise((resolve) => {
    const step = (left: number): void => {
      if (left === 0) resolve();
      else requestAnimationFrame(() => step(left - 1));
    };
    step(n);
  });

/** The visually hidden status text: the one thing a screen reader reaches. */
const labelOf = (node: HTMLElement): Element | null => node.querySelector('.visually-hidden');

let stageA: HTMLElement;
let stageB: HTMLElement;

beforeEach(() => {
  setLanguage('en');
  document.body.innerHTML = '';
  stageA = document.createElement('div');
  stageA.className = 'char-preview-container';
  stageA.appendChild(document.createElement('canvas'));
  stageB = document.createElement('div');
  stageB.className = 'char-preview-container';
  document.body.append(stageA, stageB);
});

afterEach(() => {
  setLanguage('en');
});

describe('preview loading silhouette: lifecycle', () => {
  it('creates nothing and requests no frame before the first show', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    try {
      const before = document.body.innerHTML;
      const records = mutationsDuring(document.body, () => {
        createPreviewLoadingSilhouette();
      });
      expect(records).toHaveLength(0);
      expect(document.body.innerHTML).toBe(before);
      expect(layersIn(document)).toHaveLength(0);
      expect(raf).not.toHaveBeenCalled();
    } finally {
      raf.mockRestore();
    }
  });

  it('show appends one polite status layer with the shape, and sets no aria-busy', async () => {
    createPreviewLoadingSilhouette().show(stageA, 'body');
    const layers = layersIn(stageA);
    expect(layers).toHaveLength(1);
    const layer = layers[0];
    expect(layer.parentElement).toBe(stageA);
    // Appended after the canvas, so it paints over it.
    expect(stageA.lastElementChild).toBe(layer);
    expect(layer.getAttribute('role')).toBe('status');
    expect(layer.getAttribute('aria-live')).toBe('polite');
    expect(layer.getAttribute('aria-atomic')).toBe('true');
    expect(layer.dataset.shape).toBe('body');
    // No aria-busy anywhere: a busy stage would hold back this region and the
    // stage's other live regions (the roster's name plate).
    expect(document.querySelector('[aria-busy]')).toBeNull();
    // The ONLY thing a screen reader reaches: the visually hidden localized label,
    // which arrives once the region has rendered (the next test pins the timing).
    await frames(3);
    expect(labelOf(layer)?.textContent).toBe(t('auth.modelLoading'));
    expect(labelOf(layer)?.textContent).toBe('Loading character...');
    expect(layer.textContent).toBe(t('auth.modelLoading'));
    expect(document.querySelector('[aria-busy]')).toBeNull();
  });

  it('puts the status region in EMPTY and fills it after it has rendered, so the text is an update', async () => {
    // A live region that arrives already filled is often not announced; one that
    // exists and THEN changes is. So the insertion and the text are two separate
    // DOM moments, at least a frame boundary apart.
    // Records made inside a frame callback reach the observer's callback at the
    // next microtask, so they are collected there rather than with takeRecords().
    const delivered: MutationRecord[] = [];
    const observer = new MutationObserver((records) => {
      delivered.push(...records);
    });
    const drain = (): MutationRecord[] => {
      const out = [...delivered, ...observer.takeRecords()];
      delivered.length = 0;
      return out;
    };
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    try {
      createPreviewLoadingSilhouette().show(stageA, 'body');
      const node = layersIn(stageA)[0];
      const label = labelOf(node);
      const atInsert = drain();
      expect(atInsert.some((r) => r.type === 'childList' && [...r.addedNodes].includes(node))).toBe(
        true,
      );
      expect(atInsert.some((r) => r.target === label || r.target.parentNode === label)).toBe(false);
      expect(node.isConnected).toBe(true);
      expect(label?.textContent).toBe('');
      // One frame on it is still silent: the fill waits two frames, so a frame
      // boundary passes even when show() ran inside the turntable's frame callback.
      await frames(1);
      expect(label?.textContent).toBe('');
      expect(drain()).toHaveLength(0);
      await frames(2);
      expect(label?.textContent).toBe(t('auth.modelLoading'));
      const fill = drain();
      expect(fill.length).toBeGreaterThan(0);
      expect(fill.every((r) => r.target === label || r.target.parentNode === label)).toBe(true);
    } finally {
      observer.disconnect();
    }
  });

  it('a repeat show with the same stage and shape is a no-op: same node, no DOM writes', async () => {
    const layer = createPreviewLoadingSilhouette();
    layer.show(stageA, 'body');
    const node = layersIn(stageA)[0];
    // While the label fill is still pending...
    const pending = mutationsDuring(document.body, () => {
      layer.show(stageA, 'body');
      layer.show(stageA, 'body');
    });
    expect(pending).toHaveLength(0);
    // ...and once it has landed.
    await frames(3);
    const filled = mutationsDuring(document.body, () => {
      layer.show(stageA, 'body');
      layer.show(stageA, 'body');
    });
    expect(filled).toHaveLength(0);
    expect(layersIn(document)).toEqual([node]);
  });

  it('show into a second stage moves the node, and the move announces afresh', async () => {
    const layer = createPreviewLoadingSilhouette();
    layer.show(stageA, 'body');
    await frames(3);
    const node = layersIn(stageA)[0];
    expect(labelOf(node)?.textContent).toBe('Loading character...');
    layer.show(stageB, 'body');
    expect(layersIn(stageA)).toHaveLength(0);
    expect(layersIn(stageB)).toEqual([node]);
    // A move is a fresh insertion: it goes in silent and fills again.
    expect(labelOf(node)?.textContent).toBe('');
    await frames(3);
    expect(labelOf(node)?.textContent).toBe('Loading character...');
    // And back again, still the one node, and nothing ever marked busy.
    layer.show(stageA, 'body');
    expect(layersIn(document)).toEqual([node]);
    expect(node.parentElement).toBe(stageA);
    expect(document.querySelector('[aria-busy]')).toBeNull();
  });

  it('a shape change flips data-shape in place, and only that', () => {
    const layer = createPreviewLoadingSilhouette();
    layer.show(stageA, 'body');
    const node = layersIn(stageA)[0];
    const records = mutationsDuring(document.body, () => layer.show(stageA, 'bust'));
    expect(node.dataset.shape).toBe('bust');
    expect(records.map((r) => [r.type, r.attributeName])).toEqual([['attributes', 'data-shape']]);
    expect(layersIn(document)).toEqual([node]);
    layer.show(stageA, 'body');
    expect(node.dataset.shape).toBe('body');
  });

  it('a move and a shape change in one call land together', () => {
    const layer = createPreviewLoadingSilhouette();
    layer.show(stageA, 'body');
    const node = layersIn(stageA)[0];
    layer.show(stageB, 'bust');
    expect(layersIn(stageB)).toEqual([node]);
    expect(node.dataset.shape).toBe('bust');
    expect(document.querySelector('[aria-busy]')).toBeNull();
  });

  it('hide removes the node, a fill still pending never lands, and a later show reuses the node', async () => {
    const layer = createPreviewLoadingSilhouette();
    layer.show(stageA, 'bust');
    const node = layersIn(stageA)[0];
    layer.hide();
    expect(layersIn(document)).toHaveLength(0);
    // The fill scheduled for that attach went stale with the hide.
    await frames(3);
    expect(labelOf(node)?.textContent).toBe('');

    layer.show(stageA, 'bust');
    expect(layersIn(stageA)).toEqual([node]);
    expect(node.dataset.shape).toBe('bust');
    await frames(3);
    expect(labelOf(node)?.textContent).toBe('Loading character...');
    expect(document.querySelector('[aria-busy]')).toBeNull();
  });

  it('hide when hidden is a no-op (before any show, and twice in a row)', () => {
    const layer = createPreviewLoadingSilhouette();
    const neverShown = mutationsDuring(document.body, () => layer.hide());
    expect(neverShown).toHaveLength(0);

    layer.show(stageA, 'body');
    layer.hide();
    const twice = mutationsDuring(document.body, () => layer.hide());
    expect(twice).toHaveLength(0);
    expect(layersIn(document)).toHaveLength(0);
  });

  it('re-appends when someone else detached it, rather than trusting stale state', () => {
    const layer = createPreviewLoadingSilhouette();
    layer.show(stageA, 'body');
    const node = layersIn(stageA)[0];
    node.remove();
    layer.show(stageA, 'body');
    expect(layersIn(stageA)).toEqual([node]);
  });

  it('builds into the document it is given', async () => {
    const other = document.implementation.createHTMLDocument('other');
    const host = other.createElement('div');
    other.body.appendChild(host);
    createPreviewLoadingSilhouette(other).show(host, 'body');
    const node = layersIn(host)[0];
    expect(node.ownerDocument).toBe(other);
    expect(layersIn(document)).toHaveLength(0);
    // With or without a window of its own (one without fills at once), the label lands.
    await frames(3);
    expect(labelOf(node)?.textContent).toBe('Loading character...');
  });
});

describe('preview loading silhouette: the art', () => {
  it('carries both arts, decorative, each with its own clip and sheen wiring', () => {
    createPreviewLoadingSilhouette().show(stageA, 'body');
    const node = layersIn(stageA)[0];
    const arts = [...node.querySelectorAll<SVGSVGElement>('svg.pls-art')];
    expect(arts.map((svg) => svg.getAttribute('class'))).toEqual([
      'pls-art pls-art-body',
      'pls-art pls-art-bust',
    ]);
    for (const svg of arts) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('focusable')).toBe('false');
      expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMax meet');
      const clip = svg.querySelector('[id^="pls-clip-"]');
      const gradient = svg.querySelector('[id^="pls-sheen-"]');
      expect(clip?.localName).toBe('clipPath');
      expect(gradient?.localName).toBe('linearGradient');
      // The clip sits on the still group, the gradient on the moving rect.
      const group = svg.querySelector('g');
      expect(group?.getAttribute('clip-path')).toBe(`url(#${clip?.id})`);
      expect(group?.querySelector('rect.pls-sheen')?.getAttribute('fill')).toBe(
        `url(#${gradient?.id})`,
      );
      // The clip is the outline's own shape.
      const outline = svg.querySelector('path.pls-outline');
      expect(outline?.getAttribute('d')).toMatch(/^M[\d. CLZ]+Z$/);
      expect(clip?.querySelector('path')?.getAttribute('d')).toBe(outline?.getAttribute('d'));
    }
    expect(arts[0].getAttribute('viewBox')).toBe('0 0 100 240');
    expect(arts[1].getAttribute('viewBox')).toBe('0 0 200 170');
  });

  it('takes every color from CSS: the stops carry classes, never a color', () => {
    createPreviewLoadingSilhouette().show(stageA, 'body');
    const node = layersIn(stageA)[0];
    const stops = [...node.querySelectorAll('stop')];
    expect(stops.length).toBeGreaterThan(0);
    for (const stop of stops) {
      expect(stop.getAttribute('class')).toMatch(/^pls-stop-(edge|core)$/);
      expect(stop.hasAttribute('stop-color')).toBe(false);
      expect(stop.hasAttribute('stop-opacity')).toBe(false);
      expect(stop.hasAttribute('style')).toBe(false);
    }
    expect(node.outerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(node.querySelector('[fill]:not(rect)')).toBeNull();
    expect(node.querySelector('[stroke]')).toBeNull();
  });

  it('gives two layers distinct clipPath and gradient ids', () => {
    const first = createPreviewLoadingSilhouette();
    const second = createPreviewLoadingSilhouette();
    first.show(stageA, 'body');
    second.show(stageB, 'body');
    const ids = (stage: HTMLElement) =>
      [...stage.querySelectorAll('[id]')].map((el) => el.id).sort();
    const a = ids(stageA);
    const b = ids(stageB);
    expect(a.filter((id) => id.startsWith('pls-clip-'))).toHaveLength(2);
    expect(b.filter((id) => id.startsWith('pls-clip-'))).toHaveLength(2);
    expect(a.filter((id) => id.startsWith('pls-sheen-'))).toHaveLength(2);
    // No id is shared, within a layer or across the two.
    const all = [...a, ...b];
    expect(new Set(all).size).toBe(all.length);
    expect(document.querySelectorAll('[id]')).toHaveLength(all.length);
  });

  it('draws each figure closed and mirror-symmetric, segment by segment', () => {
    createPreviewLoadingSilhouette().show(stageA, 'body');
    const arts = [...layersIn(stageA)[0].querySelectorAll<SVGSVGElement>('svg.pls-art')];
    expect(arts).toHaveLength(2);
    for (const svg of arts) {
      const [, , w, h] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
      const d = svg.querySelector('path.pls-outline')?.getAttribute('d') ?? '';
      const shown = svg.getAttribute('class');
      expect(symmetryProblems(d, w), `${shown}`).toEqual([]);
      // Not degenerate: it fills its box, and never leaves it.
      const { start, segs } = parsePath(d);
      const all = [start, ...segs.flatMap((s) => s.pts)];
      const xs = all.map(([x]) => x);
      const ys = all.map(([, y]) => y);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs)).toBeLessThanOrEqual(w);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...ys)).toBeLessThanOrEqual(h);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(w * 0.6);
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(h * 0.9);
    }
  });

  it('the symmetry check has teeth (fixture-proven)', () => {
    // A 10-wide diamond-ish outline: a symmetric one passes; the same path with one
    // mirrored segment's control points left unswapped, or its mirror off by a
    // unit, fails. Comparing point SETS would pass the swapped one.
    const good = 'M5 0C7 1 9 3 9 5C9 7 7 9 5 10C3 9 1 7 1 5C1 3 3 1 5 0Z';
    const swapped = 'M5 0C7 1 9 3 9 5C9 7 7 9 5 10C1 7 3 9 1 5C1 3 3 1 5 0Z';
    const offCentre = 'M5 0C7 1 9 3 9 5C9 7 7 9 5 10C3 9 1 7 2 5C1 3 3 1 5 0Z';
    const open = 'M5 0C7 1 9 3 9 5C9 7 7 9 5 10C3 9 1 7 1 5C1 3 3 1 5 0';
    expect(symmetryProblems(good, 10)).toEqual([]);
    expect(symmetryProblems(swapped, 10)).not.toEqual([]);
    expect(symmetryProblems(offCentre, 10)).not.toEqual([]);
    expect(symmetryProblems(open, 10)).not.toEqual([]);
  });

  it('styles every class it mints in its own shell.css section, inside @layer shell', () => {
    // A rename on either side would fall back to SVG defaults (a black fill, black
    // stops at full opacity) and show both arts at once, so the pairing is pinned.
    createPreviewLoadingSilhouette().show(stageA, 'body');
    const node = layersIn(stageA)[0];
    const minted = new Set<string>();
    for (const el of [node, ...node.querySelectorAll('*')]) {
      for (const cls of (el.getAttribute('class') ?? '').split(/\s+/)) if (cls) minted.add(cls);
    }
    expect([...minted].sort()).toEqual(
      [
        PREVIEW_LOADING_SILHOUETTE_CLASS,
        'pls-art',
        'pls-art-body',
        'pls-art-bust',
        'pls-outline',
        'pls-sheen',
        'pls-stop-core',
        'pls-stop-edge',
        'visually-hidden',
      ].sort(),
    );
    const section = stripCssComments(silhouetteSection());
    const selectorStyled = (css: string, cls: string): boolean =>
      new RegExp(`\\.${cls}(?![\\w-])[^{}]*\\{`).test(css);
    for (const cls of minted) {
      // The shared utility is styled once, elsewhere in the same sheet.
      const css = cls === 'visually-hidden' ? stripCssComments(SHELL_CSS) : section;
      expect(selectorStyled(css, cls), `.${cls} has no rule`).toBe(true);
    }
    // data-shape picks the art, and the two keyframes the section names exist in it.
    expect(section).toContain('[data-shape="bust"]');
    for (const name of ['pls-fade-in', 'pls-sweep']) {
      expect(section).toContain(`@keyframes ${name} {`);
      expect(section).toMatch(new RegExp(`animation: ${name} `));
    }
    // The whole section is ONE @layer shell block (shell.css's unlayered tail is a
    // known leak this section must not grow; tests/css_layer_containment.test.ts
    // does not cover shell.css).
    const body = section.trim();
    expect(body.startsWith('@layer shell {')).toBe(true);
    expect(body.endsWith('}')).toBe(true);
    let depth = 0;
    let closedAt = -1;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === '{') depth++;
      else if (body[i] === '}' && --depth === 0) {
        closedAt = i;
        break;
      }
    }
    expect(closedAt, 'the @layer shell block closes before the section ends').toBe(body.length - 1);
  });
});

describe('preview loading silhouette: the per-frame contract', () => {
  it('a long run of identical frames writes nothing and requests no frame, shown or hidden', async () => {
    // CharacterPreview's loop calls show() (or hide()) once per frame.
    const layer = createPreviewLoadingSilhouette();
    layer.show(stageA, 'bust');
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    try {
      // While the attach's label fill is still pending...
      const pending = mutationsDuring(document.body, () => {
        for (let frame = 0; frame < 120; frame++) layer.show(stageA, 'bust');
      });
      expect(pending).toHaveLength(0);
      expect(raf).not.toHaveBeenCalled();
    } finally {
      raf.mockRestore();
    }
    await frames(3);
    const steady = vi.spyOn(window, 'requestAnimationFrame');
    try {
      // ...once it has landed...
      const shown = mutationsDuring(document.body, () => {
        for (let frame = 0; frame < 120; frame++) layer.show(stageA, 'bust');
      });
      expect(shown).toHaveLength(0);
      // ...and hidden.
      layer.hide();
      const hidden = mutationsDuring(document.body, () => {
        for (let frame = 0; frame < 120; frame++) layer.hide();
      });
      expect(hidden).toHaveLength(0);
      expect(steady).not.toHaveBeenCalled();
    } finally {
      steady.mockRestore();
    }
  });

  it('reads no layout, arms no timer, parses no HTML, and asks only for the label fill frames', () => {
    // CharacterPreview calls show/hide from its draw loop, and the bare file name
    // keeps this module out of the painter gate's filename sweep, so the contract a
    // per-frame caller relies on is scanned here.
    const code = MODULE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const banned of [
      /\b(?:offset|client|scroll)(?:Width|Height|Top|Left)\b/,
      /\bgetBoundingClientRect\b|\bgetClientRects\b|\bgetComputedStyle\b/,
      /\brequestIdleCallback\b|\bsetInterval\b|\bsetTimeout\b/,
      /\binnerHTML\b|\bouterHTML\b|\binsertAdjacentHTML\b/,
      /\bMath\.random\b|\bDate\.now\b|\bperformance\.now\b/,
    ]) {
      expect(code, `${banned}`).not.toMatch(banned);
    }
    // The only frame requests are the two-frame label fill after an attach (the
    // behavioral test above pins that a steady frame asks for none).
    expect(code.match(/\brequestAnimationFrame\b/g)).toHaveLength(2);
    expect(code).toMatch(
      /const scheduleFill = \(\): void => \{[\s\S]*?win\.requestAnimationFrame\([\s\S]*?win\.requestAnimationFrame\(/,
    );
  });
});

describe('preview loading silhouette: localization', () => {
  it('speaks the current language, with the five non-Latin fills in place', async () => {
    const english = t('auth.modelLoading');
    for (const lang of NON_LATIN) {
      await ensureLocaleLoaded(lang);
      setLanguage(lang);
      const layer: PreviewLoadingLayer = createPreviewLoadingSilhouette();
      layer.show(stageA, 'body');
      await frames(3);
      const text = labelOf(layersIn(stageA)[0])?.textContent ?? '';
      expect(text, `${lang} still shows the English label`).not.toBe(english);
      expect(text, `${lang} resolved nothing`).not.toBe('');
      layer.hide();
    }
  });

  it('re-resolves the label on a re-show, so a reused layer follows a language switch', async () => {
    const layer = createPreviewLoadingSilhouette();
    layer.show(stageA, 'body');
    await frames(3);
    layer.hide();
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    layer.show(stageA, 'body');
    await frames(3);
    const text = labelOf(layersIn(stageA)[0])?.textContent;
    expect(text).toBe(t('auth.modelLoading'));
    expect(text).not.toBe('Loading character...');
  });

  it('follows a language switch made while it shows, writing only the label', async () => {
    // The launcher has a language picker, and the draw loop's next show() is the
    // only call the layer gets while a load runs.
    const layer = createPreviewLoadingSilhouette();
    layer.show(stageA, 'body');
    await frames(3);
    const node = layersIn(stageA)[0];
    const label = labelOf(node);
    expect(label?.textContent).toBe('Loading character...');
    await ensureLocaleLoaded('ru_RU');
    setLanguage('ru_RU');
    const records = mutationsDuring(document.body, () => layer.show(stageA, 'body'));
    expect(label?.textContent).toBe(t('auth.modelLoading'));
    expect(label?.textContent).not.toBe('Loading character...');
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.target === label || r.target.parentNode === label)).toBe(true);
    // And the next frame is a no-op again.
    expect(mutationsDuring(document.body, () => layer.show(stageA, 'body'))).toHaveLength(0);
    expect(layersIn(document)).toEqual([node]);
  });
});
