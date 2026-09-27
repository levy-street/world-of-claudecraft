// Real-browser regression for the character-select lockout disclosure (PR
// 4137 review round). Mounts a roster row exactly as main.ts composes it
// (the hint markup from charselectHintsHtml inside the premium `cs-wow`
// char-list, wired through wireCharselectRow) under the real style barrel,
// and proves the two things no Node test can:
//   (1) the summary is a real tap target: at least the 24px WCAG 2.2 SC 2.5.8
//       floor on desktop and the 40px touch floor under body.mobile-touch on
//       a landscape phone viewport, measured from rendered geometry;
//   (2) a real click on the summary toggles the native disclosure WITHOUT
//       selecting the row, and a click on the row's name still selects it
//       (the wiring returns early instead of stopping propagation, so the
//       click still reaches document-level listeners).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import '../../src/styles/index.css';
import { charselectHintsHtml, wireCharselectRow } from '../../src/ui/charselect_hints';
import { setLanguage } from '../../src/ui/i18n';
import { cleanup } from './_harness';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const EPSILON = 0.5;

function mountRow(): { row: HTMLLIElement; summary: HTMLElement; details: HTMLDetailsElement } {
  const panel = document.createElement('div');
  panel.id = 'charselect-panel';
  panel.className = 'panel charselect-screen cs-wow';
  const list = document.createElement('ul');
  list.id = 'char-list';
  const row = document.createElement('li');
  row.className = 'char-row';
  row.setAttribute('tabindex', '0');
  row.setAttribute('role', 'option');
  row.innerHTML = `<div class="char-id"><span class="char-name">Aldric</span><span class="char-sub">Level 1 Warrior</span>${charselectHintsHtml(
    {
      online: false,
      zoneId: 'mirefen_marsh',
      raidLockouts: {
        nythraxis_boss_arena: NOW + 2 * HOUR,
        'worldboss:thunzharr_waking_peak': NOW + HOUR,
      },
    },
    NOW,
  )}</div><span class="char-actions"><button class="btn enter-world-btn" type="button">Enter World</button></span>`;
  list.appendChild(row);
  panel.appendChild(list);
  document.body.appendChild(panel);
  const details = row.querySelector('details.char-lockout-hint') as HTMLDetailsElement;
  const summary = details.querySelector('summary') as HTMLElement;
  return { row, summary, details };
}

beforeEach(() => {
  setLanguage('en');
});

afterEach(async () => {
  cleanup();
  document.body.className = '';
  await page.viewport(1280, 800);
});

describe('character-select lockout disclosure (real browser)', () => {
  it('renders the summary at or above the 24px desktop floor', async () => {
    await page.viewport(1280, 800);
    const { summary } = mountRow();
    const h = summary.getBoundingClientRect().height;
    expect(h, `summary height ${h} < 24`).toBeGreaterThanOrEqual(24 - EPSILON);
  });

  it('renders the summary at or above the 40px touch floor on a landscape phone', async () => {
    await page.viewport(844, 390);
    document.body.className = 'mobile-touch';
    const { summary } = mountRow();
    const h = summary.getBoundingClientRect().height;
    expect(h, `summary height ${h} < 40`).toBeGreaterThanOrEqual(40 - EPSILON);
  });

  it('toggles the disclosure on click without selecting the row; the name still selects', () => {
    const { row, summary, details } = mountRow();
    const log: string[] = [];
    let documentClicks = 0;
    const onDocClick = () => {
      documentClicks += 1;
    };
    document.addEventListener('click', onDocClick);
    try {
      wireCharselectRow(row, {
        select: () => {
          log.push('select');
          row.classList.add('sel');
        },
        enter: () => log.push('enter'),
      });
      expect(details.open).toBe(false);
      summary.click();
      expect(details.open).toBe(true);
      expect(row.classList.contains('sel')).toBe(false);
      expect(log).toEqual([]);
      // The click still bubbled to the document (the dropdown closers live there).
      expect(documentClicks).toBe(1);
      summary.click();
      expect(details.open).toBe(false);
      (row.querySelector('.char-name') as HTMLElement).click();
      expect(row.classList.contains('sel')).toBe(true);
      expect(log).toEqual(['select']);
    } finally {
      document.removeEventListener('click', onDocClick);
    }
  });
});
