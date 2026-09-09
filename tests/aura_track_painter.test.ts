// @vitest-environment happy-dom
//
// The one painter behind all six aura tracks
// (src/ui/hud/aura_tracks/aura_track_painter.ts).
//
// Two halves, because two different things can go wrong:
//   - a SOURCE guard, that the skeleton is built once and every refresh routes
//     through the elided writers (the same shape auras_painter.test.ts pins);
//   - an end-to-end pool proof over a real DOM, that a node which changes which
//     row it carries drops its cached label and artwork first. That is the
//     pooled-node staleness trap, and it shows up as one spell wearing another
//     spell's name for as long as the row lives.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AuraTrackPainter,
  type AuraTrackPainterDeps,
} from '../src/ui/hud/aura_tracks/aura_track_painter';
import {
  AURA_TRACK_ROW_CAP,
  type AuraTrackRow,
  type AuraTrackState,
} from '../src/ui/hud/aura_tracks/aura_track_view';
import type { PainterHostWriters } from '../src/ui/painter_host';

// Resolved off the working directory rather than `import.meta.url`: this file
// runs under happy-dom, where import.meta.url is not a file: URL and `new URL`
// throws before a single test registers. Vitest runs with the repo root as cwd.
const source = readFileSync(
  join(process.cwd(), 'src/ui/hud/aura_tracks/aura_track_painter.ts'),
  'utf8',
);

// ---------------------------------------------------------------------------
// Source guard
// ---------------------------------------------------------------------------
describe('aura track painter: the source contract', () => {
  it('writes innerHTML exactly once, to build the skeleton', () => {
    // A second one would be a per-frame subtree rebuild across six live frames.
    const writes = source.match(/\.innerHTML\b/g) ?? [];
    expect(writes).toHaveLength(1);
    expect(source).toMatch(/constructor\([\s\S]*?\.innerHTML\s*=/);
  });

  it('never reaches the DOM directly outside the constructor', () => {
    // Not even for the two build-time accessible-name attributes: a painter that
    // reaches the DOM directly ANYWHERE is a painter someone copies the direct
    // form out of.
    for (const token of ['.setAttribute(', '.removeAttribute(', '.classList', '.textContent']) {
      expect(source.includes(token), `${token} appears in the painter`).toBe(false);
    }
  });

  it('re-queries nothing per frame', () => {
    // Element refs resolve ONCE into the pooled records; a querySelector on the
    // update path is a subtree walk whose answer the painter already had.
    const queries = source.match(/\.querySelector(All)?\b/g) ?? [];
    expect(queries.length).toBeGreaterThan(0);
    const updateBody = updateMethodBody();
    expect(updateBody).not.toMatch(/\.querySelector/);
  });

  it('hoists its number-format options instead of minting them per row', () => {
    // numberFormatFor keys its cache on JSON.stringify(options), so a fresh
    // literal per row per frame would be an allocation plus a stringify on the
    // hot path, six frames over.
    expect(source).toMatch(/const NUMBER_OPTIONS = \[/);
    expect(source).toMatch(/const POINTS_OPTIONS = /);
    const updateBody = updateMethodBody();
    expect(updateBody).not.toMatch(/maximumFractionDigits:/);
  });
});

/** The text of `update()`, located by its signature and PROVEN found: an
 *  unguarded `source.slice(source.indexOf(...))` returns the file's last
 *  character when the signature has been renamed, and every negative pin over
 *  it passes on anything. The slice also stops at the method's close rather
 *  than the end of file, so the pins read the method and only the method. */
function updateMethodBody(): string {
  const start = source.indexOf('update(state: AuraTrackState): void {');
  expect(start, 'the update(state) signature moved; re-anchor this helper').toBeGreaterThan(-1);
  const end = source.indexOf('\n  }\n', start);
  expect(end, 'the update() method never closes').toBeGreaterThan(start);
  const body = source.slice(start, end);
  // Anti-vacuity: the body has to contain the one write every refresh makes.
  expect(body).toContain('w.setDisplay(this.root');
  return body;
}

// ---------------------------------------------------------------------------
// End-to-end over a real DOM
// ---------------------------------------------------------------------------
type Call = { m: string; el: HTMLElement; args: unknown[] };

/** A writers facet that APPLIES every write and records it, so the assertions
 *  can read either the resulting DOM or the call log. Deliberately not elided:
 *  this file is about what the painter asks for, and an eliding facet would hide
 *  a repeat write behind the cache instead of showing it. */
function recordingWriters(log: Call[]): PainterHostWriters {
  const facet: PainterHostWriters = {
    setText: (el, text) => {
      log.push({ m: 'setText', el, args: [text] });
      el.textContent = text;
    },
    setDisplay: (el, display) => {
      log.push({ m: 'setDisplay', el, args: [display] });
      el.style.display = display;
    },
    setTransform: (el, transform) => {
      log.push({ m: 'setTransform', el, args: [transform] });
    },
    setWidth: (el, width) => {
      log.push({ m: 'setWidth', el, args: [width] });
      el.style.width = width;
    },
    setStyleProp: (el, prop, value) => {
      log.push({ m: 'setStyleProp', el, args: [prop, value] });
      el.style.setProperty(prop, value);
    },
    toggleClass: (el, cls, on) => {
      log.push({ m: 'toggleClass', el, args: [cls, on] });
      el.classList.toggle(cls, on);
    },
    setAttr: (el, attr, value) => {
      log.push({ m: 'setAttr', el, args: [attr, value] });
      if (value === null) el.removeAttribute(attr);
      else el.setAttribute(attr, value);
    },
  };
  return facet;
}

const row = (over: Partial<AuraTrackRow> = {}): AuraTrackRow => ({
  key: 'k',
  entityId: 1,
  auraName: 'Aura',
  unitName: '',
  iconKey: 'icon',
  remaining: 12,
  fraction: 0.5,
  decimals: 0,
  stacks: 0,
  points: 0,
  mode: false,
  expiring: false,
  ...over,
});

const state = (rows: AuraTrackRow[], overflow = 0): AuraTrackState => ({
  rows,
  count: rows.length,
  overflow,
});

function harness(over: Partial<AuraTrackPainterDeps> = {}) {
  const log: Call[] = [];
  const root = document.createElement('div');
  document.body.append(root);
  const deps: AuraTrackPainterDeps = {
    root: () => root,
    writers: recordingWriters(log),
    iconBackground: (key) => `url(${key}.png)`,
    rowLabel: (aura, unit) => (unit ? `${aura} on ${unit}` : aura),
    frameLabel: () => 'Track',
    overflowLabel: (n) => `${n} more`,
    secondsSuffix: () => 's',
    modeLabel: () => 'ON',
    ...over,
  };
  const painter = new AuraTrackPainter(deps);
  const rows = () => [...root.querySelectorAll<HTMLElement>('.at-row')];
  return {
    painter,
    root,
    log,
    rows,
    text: (i: number, sel: string) => rows()[i].querySelector(sel)?.textContent,
  };
}

describe('aura track painter: the skeleton', () => {
  it('builds a full pool of rows plus an overflow line, all hidden', () => {
    const { root, rows } = harness();
    expect(rows()).toHaveLength(AURA_TRACK_ROW_CAP);
    expect(root.querySelectorAll('.at-overflow')).toHaveLength(1);
    for (const r of rows()) expect(r.style.display).toBe('none');
  });

  it('names the frame for a screen reader', () => {
    const { root } = harness();
    expect(root.getAttribute('role')).toBe('group');
    expect(root.getAttribute('aria-label')).toBe('Track');
  });
});

describe('aura track painter: what it paints', () => {
  it('hides the whole frame when the track is empty', () => {
    // An empty bordered box floating over the world is the thing players report
    // as a bug, and a track with nothing to say is genuinely absent.
    const { painter, root } = harness();
    painter.update(state([row()]));
    expect(root.style.display).toBe('flex');
    painter.update(state([]));
    expect(root.style.display).toBe('none');
  });

  it('shows one row per model and hides the rest of the pool', () => {
    const { painter, rows } = harness();
    painter.update(state([row({ key: 'a' }), row({ key: 'b' })]));
    expect(rows()[0].style.display).toBe('flex');
    expect(rows()[1].style.display).toBe('flex');
    expect(rows()[2].style.display).toBe('none');
  });

  it('prints a countdown with the suffix, gaining a decimal when asked', () => {
    const { painter, text } = harness();
    painter.update(state([row({ remaining: 12, decimals: 0 })]));
    expect(text(0, '.at-time')).toBe('12s');
    painter.update(state([row({ remaining: 3.4, decimals: 1 })]));
    expect(text(0, '.at-time')).toBe('3.4s');
  });

  it('composes a self row without a name and an ally row with one', () => {
    const { painter, text } = harness();
    painter.update(state([row({ key: 'self', auraName: 'Renew', unitName: '' })]));
    expect(text(0, '.at-label')).toBe('Renew');
    painter.update(state([row({ key: 'ally', auraName: 'Renew', unitName: 'Bob' })]));
    expect(text(0, '.at-label')).toBe('Renew on Bob');
  });

  it('fills the bar by the row fraction', () => {
    const { painter, rows } = harness();
    painter.update(state([row({ fraction: 0.333 })]));
    expect(rows()[0].querySelector<HTMLElement>('.at-fill')?.style.width).toBe('33.3%');
    painter.update(state([row({ fraction: 1 })]));
    expect(rows()[0].querySelector<HTMLElement>('.at-fill')?.style.width).toBe('100%');
  });

  it('never tints a row by spell school, so the track colour is the only one', () => {
    // The enemy-dot family tints by school and is right to: there, school IS the
    // question. Here the colour has to say WHICH TRACK a row is in, and a school
    // tint silently wins over it: every druid spell is nature, so a druid saw six
    // identical green bars and the whole point of splitting them was invisible.
    // Caught by looking at the first capture, not by a test, which is why this one
    // exists.
    const { painter, rows } = harness();
    painter.update(state([row({ fraction: 0.5 })]));
    expect(rows()[0].querySelector('.at-fill')?.hasAttribute('data-school')).toBe(false);
    expect(source).not.toContain('data-school');
  });

  it('shows stacks only when the core sent some', () => {
    const { painter, rows, text } = harness();
    painter.update(state([row({ stacks: 3 })]));
    expect(text(0, '.at-stacks')).toBe('3');
    expect(rows()[0].querySelector<HTMLElement>('.at-stacks')?.style.display).toBe('');
    painter.update(state([row({ stacks: 0 })]));
    expect(rows()[0].querySelector<HTMLElement>('.at-stacks')?.style.display).toBe('none');
  });

  it('prints the points and the class on a shield row, and neither on a timer', () => {
    const { painter, rows, text } = harness();
    painter.update(state([row({ key: 'shield', points: 1240 })]));
    expect(text(0, '.at-points')).toBe('1,240');
    expect(rows()[0].classList.contains('at-points-row')).toBe(true);
    painter.update(state([row({ key: 'timer', points: 0 })]));
    expect(rows()[0].classList.contains('at-points-row')).toBe(false);
    expect(rows()[0].querySelector<HTMLElement>('.at-points')?.style.display).toBe('none');
  });

  it('prints a steady chip and no number at all on a mode row', () => {
    // A countdown under stealth is a lie the player reads as "this is about to
    // leave me".
    const { painter, rows, text } = harness();
    painter.update(state([row({ key: 'mode', mode: true, remaining: 3540 })]));
    expect(text(0, '.at-time')).toBe('ON');
    expect(rows()[0].classList.contains('at-mode-row')).toBe(true);
  });

  it('marks the final seconds so the shared expiry cue can fire', () => {
    const { painter, rows } = harness();
    painter.update(state([row({ expiring: true })]));
    expect(rows()[0].classList.contains('at-expiring')).toBe(true);
    painter.update(state([row({ expiring: false })]));
    expect(rows()[0].classList.contains('at-expiring')).toBe(false);
  });

  it('shows the overflow line only when rows were dropped', () => {
    const { painter, root } = harness();
    const overflow = root.querySelector<HTMLElement>('.at-overflow');
    painter.update(state([row()], 3));
    expect(overflow?.textContent).toBe('3 more');
    expect(overflow?.style.display).toBe('');
    painter.update(state([row()], 0));
    expect(overflow?.style.display).toBe('none');
  });
});

describe('aura track painter: the pooled-node caches', () => {
  it('drops the cached label and artwork when a node changes which row it carries', () => {
    // The trap: the label and the background image are resolved once per row and
    // cached on the node. A node recycled onto a DIFFERENT row must forget both
    // first, or the new spell wears the old one's name until the row dies.
    const rowLabel = vi.fn((aura: string, unit: string) => (unit ? `${aura} on ${unit}` : aura));
    const { painter, rows } = harness({ rowLabel });
    painter.update(state([row({ key: 'a', auraName: 'Renew', iconKey: 'renew' })]));
    expect(rows()[0].querySelector('.at-label')?.textContent).toBe('Renew');
    expect(rows()[0].querySelector<HTMLElement>('.at-icon')?.style.backgroundImage).toContain(
      'renew.png',
    );

    painter.update(state([row({ key: 'b', auraName: 'Rejuvenation', iconKey: 'rejuv' })]));
    expect(rows()[0].querySelector('.at-label')?.textContent).toBe('Rejuvenation');
    expect(rows()[0].querySelector<HTMLElement>('.at-icon')?.style.backgroundImage).toContain(
      'rejuv.png',
    );
  });

  it('composes a steady row label once, not once per frame', () => {
    const rowLabel = vi.fn((aura: string) => aura);
    const { painter } = harness({ rowLabel });
    for (let i = 0; i < 5; i++) painter.update(state([row({ key: 'a', auraName: 'Renew' })]));
    expect(rowLabel).toHaveBeenCalledTimes(1);
  });

  it('resolves a steady row artwork once, not once per frame', () => {
    const iconBackground = vi.fn((key: string) => `url(${key}.png)`);
    const { painter } = harness({ iconBackground });
    for (let i = 0; i < 5; i++) painter.update(state([row({ key: 'a', iconKey: 'renew' })]));
    expect(iconBackground).toHaveBeenCalledTimes(1);
  });

  it('re-resolves a row that leaves and comes back, rather than trusting a stale slot', () => {
    // A slot that goes unused must forget its key, or the SAME row returning to
    // it would skip the refresh and keep whatever the node last showed.
    const rowLabel = vi.fn((aura: string) => aura);
    const { painter } = harness({ rowLabel });
    painter.update(state([row({ key: 'a', auraName: 'Renew' })]));
    painter.update(state([]));
    painter.update(state([row({ key: 'a', auraName: 'Renew' })]));
    expect(rowLabel).toHaveBeenCalledTimes(2);
  });

  it('re-localizes the frame name, the units and every cached row label', () => {
    // Caching a localized string owes exactly this. Nothing here is re-derived
    // on its own, so a language switch would otherwise leave the previous
    // language on screen for the life of every row.
    let lang = 'en';
    const { painter, root, text } = harness({
      frameLabel: () => (lang === 'en' ? 'Track' : 'Piste'),
      secondsSuffix: () => (lang === 'en' ? 's' : ' sec'),
      modeLabel: () => (lang === 'en' ? 'ON' : 'ACTIF'),
      rowLabel: (aura) => (lang === 'en' ? aura : `${aura} (fr)`),
    });
    painter.update(state([row({ key: 'a', auraName: 'Renew', remaining: 8, decimals: 0 })]));
    expect(text(0, '.at-label')).toBe('Renew');
    expect(text(0, '.at-time')).toBe('8s');

    lang = 'fr';
    painter.relocalize();
    painter.update(state([row({ key: 'a', auraName: 'Renew', remaining: 8, decimals: 0 })]));
    expect(root.getAttribute('aria-label')).toBe('Piste');
    expect(text(0, '.at-label')).toBe('Renew (fr)');
    expect(text(0, '.at-time')).toBe('8 sec');

    painter.update(state([row({ key: 'a', mode: true })]));
    expect(text(0, '.at-time')).toBe('ACTIF');
  });
});
