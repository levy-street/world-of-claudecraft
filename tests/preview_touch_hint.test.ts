// @vitest-environment happy-dom

// The phone creator's one-time pinch hint (src/ui/preview_touch_hint.ts): the tab
// CharacterPreview offers beside its drawn model on a touch stage. Pinned here: it costs no
// DOM before the first show and none at all once retired, it is ONE reused node that follows
// the stage between containers, a repeat show writes nothing (the stage calls it every
// frame), the first gesture stores its flag and plays the exit before the node comes off, a
// stored flag keeps it from ever showing, storage that throws only costs the memory, it
// takes no touches and sits beside the model (its shell.css section), and its text is a
// localized key with the M16 non-Latin fills.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import {
  createPreviewTouchHint,
  PREVIEW_TOUCH_HINT_CLASS,
  type PreviewTouchHintStorage,
} from '../src/ui/preview_touch_hint';
import {
  PREVIEW_TOUCH_HINT_LEAVE_MS,
  PREVIEW_TOUCH_HINT_SEEN,
  PREVIEW_TOUCH_HINT_STORAGE_KEY,
} from '../src/ui/preview_touch_hint_core';

// The five non-Latin locales the M16 rule requires a wordy new English value to ship fills
// for in the same change.
const NON_LATIN = ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const;

// The rel arg must stay a VARIABLE under happy-dom (its web transform rewrites a literal
// new URL(..., import.meta.url) to an http URL readFileSync rejects).
const read = (rel: string): string =>
  readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SHELL_CSS = read('../src/styles/shell.css');
const SECTION_BANNER = '/* ---------- character preview touch hint ---------- */';
/** The hint's own shell.css section: its banner to the next ten-dash banner or the end. */
function hintSection(): string {
  const start = SHELL_CSS.indexOf(SECTION_BANNER);
  expect(start, 'the section banner is missing from shell.css').toBeGreaterThanOrEqual(0);
  const rest = SHELL_CSS.slice(start + SECTION_BANNER.length);
  const next = rest.search(/\/\*\s*-{10,}\s*[^*]+?\s*-{10,}\s*\*\//);
  return next < 0 ? rest : rest.slice(0, next);
}
const stripCssComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The root rule's declarations, property to value (exact names: `left` is not `border-left`). */
function rootDeclarations(): Map<string, string> {
  const css = stripCssComments(hintSection());
  const body = css.match(/\n {2}\.preview-touch-hint\s*\{([^}]*)\}/)?.[1] ?? '';
  const decls = new Map<string, string>();
  for (const part of body.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    decls.set(
      part.slice(0, at).trim(),
      part
        .slice(at + 1)
        .trim()
        .replace(/\s+/g, ' '),
    );
  }
  return decls;
}

/** Every selector in `css` whose rule sets `animation: none`. */
function selectorsWithAnimationNone(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(?:^|;)\s*animation:\s*none\s*;/.test(m[2])) continue;
    for (const sel of m[1].split(',')) out.push(sel.trim().replace(/\s+/g, ' '));
  }
  return out;
}

/** An in-memory Storage slice that counts its calls. */
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const store: PreviewTouchHintStorage & { reads: number; writes: number } = {
    reads: 0,
    writes: 0,
    getItem(key) {
      store.reads++;
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      store.writes++;
      map.set(key, value);
    },
  };
  return { store, map };
}

/** Storage that throws on every call (a blocked origin, some private windows). */
const throwingStorage: PreviewTouchHintStorage = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
};

const hintsIn = (root: ParentNode): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(`.${PREVIEW_TOUCH_HINT_CLASS}`));

/** The DOM mutations a call makes under `root`. */
function mutationsDuring(root: Node, fn: () => void): MutationRecord[] {
  const observer = new MutationObserver(() => {});
  observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
  fn();
  const records = observer.takeRecords();
  observer.disconnect();
  return records;
}

let stageA: HTMLElement;
let stageB: HTMLElement;

beforeEach(() => {
  setLanguage('en');
  document.body.innerHTML = '<div id="stage-a"></div><div id="stage-b"></div>';
  stageA = document.getElementById('stage-a') as HTMLElement;
  stageB = document.getElementById('stage-b') as HTMLElement;
});

afterEach(() => {
  vi.useRealTimers();
  setLanguage('en');
});

describe('preview touch hint: showing', () => {
  it('costs no DOM and reads no storage before the first show', () => {
    const { store } = memoryStorage();
    const records = mutationsDuring(document.body, () => {
      const hint = createPreviewTouchHint(document, store);
      // the stage's per-frame hide where it never offers the hint (a desktop, the select)
      for (let i = 0; i < 5; i++) hint.hide();
      // and a gesture there: nothing to retire, nothing to store
      hint.interacted();
    });
    expect(records).toHaveLength(0);
    expect(store.reads).toBe(0);
    expect(store.writes).toBe(0);
  });

  it('shows one tab in the stage, with its glyph and its localized label', () => {
    const { store } = memoryStorage();
    const hint = createPreviewTouchHint(document, store);
    hint.show(stageA);
    const nodes = hintsIn(stageA);
    expect(nodes).toHaveLength(1);
    const node = nodes[0];
    expect(node.getAttribute('role')).toBe('note');
    expect(node.dataset.state).toBe('shown');
    const glyph = node.querySelector('svg.pth-glyph');
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    expect(glyph?.querySelectorAll('.pth-tip')).toHaveLength(2);
    expect(glyph?.querySelectorAll('.pth-arrow')).toHaveLength(2);
    expect(node.querySelector('.pth-label')?.textContent).toBe('Pinch to zoom');
    expect(t('auth.previewPinchHint')).toBe('Pinch to zoom');
  });

  it('a repeat show writes nothing (the stage calls it every frame)', () => {
    const hint = createPreviewTouchHint(document, memoryStorage().store);
    hint.show(stageA);
    expect(mutationsDuring(document.body, () => hint.show(stageA))).toHaveLength(0);
  });

  it('is one node that follows the stage between containers, and hide leaves no trace', () => {
    const hint = createPreviewTouchHint(document, memoryStorage().store);
    hint.show(stageA);
    const node = hintsIn(stageA)[0];
    hint.show(stageB);
    expect(hintsIn(stageA)).toHaveLength(0);
    expect(hintsIn(stageB)).toEqual([node]);
    hint.hide();
    expect(hintsIn(document)).toHaveLength(0);
    // a hidden hint's hide does nothing
    expect(mutationsDuring(document.body, () => hint.hide())).toHaveLength(0);
    // and it comes back, the same node, the next time the stage offers it
    hint.show(stageA);
    expect(hintsIn(stageA)).toEqual([node]);
  });

  it('follows a language switch made while it shows, writing only the label', async () => {
    const hint = createPreviewTouchHint(document, memoryStorage().store);
    hint.show(stageA);
    const label = hintsIn(stageA)[0].querySelector('.pth-label');
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    const records = mutationsDuring(document.body, () => hint.show(stageA));
    expect(label?.textContent).toBe(t('auth.previewPinchHint'));
    expect(label?.textContent).not.toBe('Pinch to zoom');
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.target === label || r.target.parentNode === label)).toBe(true);
  });
});

describe('preview touch hint: once, until the first gesture', () => {
  it('the first gesture stores the flag, plays the exit, then takes the node off', () => {
    vi.useFakeTimers();
    const { store, map } = memoryStorage();
    const hint = createPreviewTouchHint(document, store);
    hint.show(stageA);
    const node = hintsIn(stageA)[0];
    hint.interacted();
    expect(map.get(PREVIEW_TOUCH_HINT_STORAGE_KEY)).toBe(PREVIEW_TOUCH_HINT_SEEN);
    // the exit plays where it is: still attached, marked leaving
    expect(node.dataset.state).toBe('leaving');
    expect(node.parentNode).toBe(stageA);
    // the stage keeps offering it meanwhile: nothing restarts or moves it
    expect(mutationsDuring(document.body, () => hint.show(stageA))).toHaveLength(0);
    vi.advanceTimersByTime(PREVIEW_TOUCH_HINT_LEAVE_MS);
    expect(hintsIn(document)).toHaveLength(0);
    // retired: the stage's next offers mint nothing
    expect(mutationsDuring(document.body, () => hint.show(stageA))).toHaveLength(0);
    expect(hintsIn(document)).toHaveLength(0);
  });

  it('stores the flag once, however many gestures follow', () => {
    vi.useFakeTimers();
    const { store } = memoryStorage();
    const hint = createPreviewTouchHint(document, store);
    hint.show(stageA);
    hint.interacted();
    hint.interacted();
    vi.advanceTimersByTime(PREVIEW_TOUCH_HINT_LEAVE_MS);
    hint.interacted();
    expect(store.writes).toBe(1);
  });

  it('the stage going mid-exit takes the node off at once, and it stays retired', () => {
    vi.useFakeTimers();
    const hint = createPreviewTouchHint(document, memoryStorage().store);
    hint.show(stageA);
    hint.interacted();
    hint.hide();
    expect(hintsIn(document)).toHaveLength(0);
    vi.advanceTimersByTime(PREVIEW_TOUCH_HINT_LEAVE_MS);
    hint.show(stageA);
    expect(hintsIn(document)).toHaveLength(0);
  });

  it('a gesture while the tab is off screen leaves it to show (the player never saw it)', () => {
    const { store, map } = memoryStorage();
    const hint = createPreviewTouchHint(document, store);
    // before it ever showed (a turn on the character select's stage)
    hint.interacted();
    expect(map.has(PREVIEW_TOUCH_HINT_STORAGE_KEY)).toBe(false);
    hint.show(stageA);
    expect(hintsIn(stageA)).toHaveLength(1);
    // and after it came off for a while (the player went back to the select)
    hint.hide();
    hint.interacted();
    expect(map.has(PREVIEW_TOUCH_HINT_STORAGE_KEY)).toBe(false);
    hint.show(stageA);
    expect(hintsIn(stageA)).toHaveLength(1);
    expect(hintsIn(stageA)[0].dataset.state).toBe('shown');
  });

  it('never shows on a device that already moved the model', () => {
    const { store } = memoryStorage({ [PREVIEW_TOUCH_HINT_STORAGE_KEY]: PREVIEW_TOUCH_HINT_SEEN });
    const hint = createPreviewTouchHint(document, store);
    const records = mutationsDuring(document.body, () => hint.show(stageA));
    expect(records).toHaveLength(0);
    expect(store.reads).toBe(1);
    // and a later gesture writes nothing
    hint.interacted();
    expect(store.writes).toBe(0);
  });

  it('a visit that ends with no gesture leaves it to show next time', () => {
    const { store, map } = memoryStorage();
    createPreviewTouchHint(document, store).show(stageA);
    expect(map.has(PREVIEW_TOUCH_HINT_STORAGE_KEY)).toBe(false);
    document.body.innerHTML = '<div id="stage-a"></div>';
    const next = document.getElementById('stage-a') as HTMLElement;
    createPreviewTouchHint(document, store).show(next);
    expect(hintsIn(next)).toHaveLength(1);
  });

  it('works without storage, and with storage that throws: it only forgets across visits', () => {
    vi.useFakeTimers();
    for (const storage of [null, throwingStorage]) {
      document.body.innerHTML = '<div id="stage-a"></div>';
      const stage = document.getElementById('stage-a') as HTMLElement;
      const hint = createPreviewTouchHint(document, storage);
      expect(() => hint.show(stage)).not.toThrow();
      expect(hintsIn(stage)).toHaveLength(1);
      expect(() => hint.interacted()).not.toThrow();
      vi.advanceTimersByTime(PREVIEW_TOUCH_HINT_LEAVE_MS);
      expect(hintsIn(stage)).toHaveLength(0);
      hint.show(stage);
      expect(hintsIn(stage)).toHaveLength(0);
    }
  });

  it('reads the page localStorage by default', () => {
    localStorage.setItem(PREVIEW_TOUCH_HINT_STORAGE_KEY, PREVIEW_TOUCH_HINT_SEEN);
    try {
      const hint = createPreviewTouchHint();
      hint.show(stageA);
      expect(hintsIn(document)).toHaveLength(0);
    } finally {
      localStorage.removeItem(PREVIEW_TOUCH_HINT_STORAGE_KEY);
    }
    const fresh = createPreviewTouchHint();
    fresh.show(stageA);
    expect(hintsIn(stageA)).toHaveLength(1);
    fresh.interacted();
    expect(localStorage.getItem(PREVIEW_TOUCH_HINT_STORAGE_KEY)).toBe(PREVIEW_TOUCH_HINT_SEEN);
    localStorage.removeItem(PREVIEW_TOUCH_HINT_STORAGE_KEY);
  });
});

describe('preview touch hint: its shell.css section', () => {
  it('styles every class it mints in its own section, inside @layer shell', () => {
    const section = hintSection();
    const css = stripCssComments(section);
    const hint = createPreviewTouchHint(document, memoryStorage().store);
    hint.show(stageA);
    const node = hintsIn(stageA)[0];
    const classes = new Set<string>();
    for (const el of [node, ...Array.from(node.querySelectorAll('*'))]) {
      for (const c of (el.getAttribute('class') ?? '').split(/\s+/)) if (c) classes.add(c);
    }
    expect(classes.size).toBeGreaterThanOrEqual(8);
    for (const c of classes) {
      // the whole class name, not a prefix of a longer one (.pth-tip inside .pth-tip-a)
      const named = new RegExp(`\\.${c}(?![\\w-])`);
      expect(css, `.${c} is unstyled`).toMatch(named);
    }
    // the whole section is ONE @layer shell block
    expect(css.trim().startsWith('@layer shell {')).toBe(true);
  });

  it('takes no touches, sits on the stage edge beside the model, and under the name plate', () => {
    const decls = rootDeclarations();
    expect(decls.get('pointer-events')).toBe('none');
    expect(decls.get('position')).toBe('absolute');
    expect(decls.get('left')).toBe('0');
    expect(decls.get('top')).toBe('50%');
    // over the canvas and the loading silhouette (1), under the name plate (3)
    expect(decls.get('z-index')).toBe('2');
    // a narrow tab, so the head-and-shoulders model in the middle stays clear
    const width = Number(decls.get('width')?.match(/^(\d+)px$/)?.[1]);
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThanOrEqual(72);
  });

  it('stops every animation under reduced motion (the OS setting and the in-game one)', () => {
    const css = stripCssComments(hintSection());
    const media = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n {2}\}/,
    )?.[1];
    expect(media, 'the reduced-motion block is missing').toBeTruthy();
    const animated = ['', ' .pth-ring', ' .pth-arrow', ' .pth-tip-a', ' .pth-tip-b'];
    for (const part of animated) {
      const sel = `.preview-touch-hint${part}`;
      expect(selectorsWithAnimationNone(media ?? ''), `${sel} (OS setting)`).toContain(sel);
      expect(selectorsWithAnimationNone(css), `${sel} (in-game setting)`).toContain(
        `body.reduce-motion ${sel}`,
      );
    }
  });

  it('rests the glyph in its spread pose, so a stopped or paused loop still reads as a pinch', () => {
    const css = stripCssComments(hintSection());
    const rule = (sel: string) =>
      css.match(new RegExp(`${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    expect(rule('.preview-touch-hint .pth-tip-a')).toMatch(/transform:\s*translate\(-6px, -6px\);/);
    expect(rule('.preview-touch-hint .pth-tip-b')).toMatch(/transform:\s*translate\(6px, 6px\);/);
    expect(rule('.preview-touch-hint .pth-arrow')).not.toMatch(/opacity:\s*0;/);
    // a paused loop holds its first keyframe: the spread one
    expect(css).toMatch(
      /@keyframes pth-tip-a\s*\{\s*0%,\s*22%\s*\{\s*transform: translate\(-6px, -6px\);/,
    );
    expect(css).toMatch(
      /@keyframes pth-tip-b\s*\{\s*0%,\s*22%\s*\{\s*transform: translate\(6px, 6px\);/,
    );
    expect(css).toMatch(/@keyframes pth-arrow\s*\{\s*0%,\s*22%\s*\{\s*opacity: 1;/);
  });

  it('paces the loop by --motion-scale and pauses it with the ambient-animation knob', () => {
    const css = stripCssComments(hintSection());
    const block = css.match(
      /\.preview-touch-hint \.pth-ring,\s*\.preview-touch-hint \.pth-arrow,\s*\.preview-touch-hint \.pth-tip-a,\s*\.preview-touch-hint \.pth-tip-b\s*\{([^}]*)\}/,
    )?.[1];
    expect(block, 'the shared loop rule is missing').toBeTruthy();
    expect(block).toMatch(/animation-duration:\s*calc\(2\.4s \* var\(--motion-scale, 1\)\);/);
    expect(block).toMatch(/animation-play-state:\s*var\(--fx-ambient-anim, running\);/);
  });

  it('uses tokens, never a raw color', () => {
    const css = stripCssComments(hintSection());
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(|\bhsla?\(/);
  });

  it('keeps Korean words whole in the narrow label (the browser breaks between syllables)', () => {
    // seen in a capture: "확대/축소" split as "확 / 대/축소" before this rule
    const css = stripCssComments(hintSection());
    expect(css).toMatch(
      /\.preview-touch-hint \.pth-label:lang\(ko\)\s*\{\s*word-break:\s*keep-all;\s*\}/,
    );
  });
});

describe('preview touch hint: localization', () => {
  it('speaks the current language, with the five non-Latin fills in place', async () => {
    const english = t('auth.previewPinchHint');
    for (const lang of NON_LATIN) {
      await ensureLocaleLoaded(lang);
      setLanguage(lang);
      document.body.innerHTML = '<div id="stage-a"></div>';
      const stage = document.getElementById('stage-a') as HTMLElement;
      createPreviewTouchHint(document, memoryStorage().store).show(stage);
      const text = hintsIn(stage)[0].querySelector('.pth-label')?.textContent ?? '';
      expect(text, `${lang} still shows the English label`).not.toBe(english);
      expect(text, `${lang} resolved nothing`).not.toBe('');
    }
  });
});
