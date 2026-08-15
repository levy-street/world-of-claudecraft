// Real-browser regression for the landscape map + quest pairing. CSS text and
// arithmetic-only tests missed the original defect because the declaration was
// syntactically valid, but its custom property lived on a sibling and therefore
// made the computed quest width invalid.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup } from './_harness';

const EPSILON = 1;
const TOUCH_EPSILON = 0.5;

beforeEach(async () => {
  document.body.className = 'mobile-touch game-active mobile-map-quest-open';
});

afterEach(() => {
  cleanup();
  document.body.className = '';
  document.documentElement.style.removeProperty('--app-vw');
  document.documentElement.style.removeProperty('--app-vh');
  document.documentElement.style.removeProperty('--ui-scale');
});

function mountWindows(): {
  quest: HTMLElement;
  map: HTMLElement;
  canvas: HTMLCanvasElement;
  touchTargets: HTMLButtonElement[];
} {
  const ui = document.createElement('div');
  ui.id = 'ui';
  const quest = document.createElement('div');
  quest.id = 'quest-log-window';
  quest.className = 'window panel';
  quest.style.display = 'block';
  quest.style.height = '500px';
  const questTitle = document.createElement('div');
  questTitle.className = 'panel-title';
  const questClose = document.createElement('button');
  questClose.className = 'x-btn';
  questClose.dataset.close = '';
  questClose.textContent = 'Close';
  questTitle.append('Quests', questClose);
  const questColumns = document.createElement('div');
  questColumns.className = 'ql-cols';
  const questList = document.createElement('div');
  questList.className = 'ql-list';
  const questRow = document.createElement('button');
  questRow.className = 'ql-item';
  questRow.textContent = "A Cartographer's Request";
  questList.appendChild(questRow);
  const questDetail = document.createElement('div');
  questDetail.className = 'ql-detail';
  const questActions = document.createElement('div');
  questActions.className = 'ql-detail-actions';
  const abandonQuest = document.createElement('button');
  abandonQuest.className = 'btn';
  abandonQuest.textContent = 'Abandon';
  questActions.appendChild(abandonQuest);
  questDetail.appendChild(questActions);
  questColumns.append(questList, questDetail);
  quest.append(questTitle, questColumns);
  const map = document.createElement('div');
  map.id = 'map-window';
  map.className = 'window panel';
  map.style.display = 'block';
  const canvas = document.createElement('canvas');
  canvas.id = 'map-canvas';
  canvas.width = 560;
  canvas.height = 560;
  const mapClose = document.createElement('button');
  mapClose.id = 'map-close';
  mapClose.className = 'x-btn';
  mapClose.textContent = 'Close';
  const levelToggle = document.createElement('button');
  levelToggle.id = 'map-level-toggle';
  levelToggle.textContent = 'World map';
  const rail = document.createElement('div');
  rail.id = 'map-zoom';
  const zoomButtons = ['+', '-'].map((label) => {
    const button = document.createElement('button');
    button.className = 'map-zoom-btn';
    button.textContent = label;
    return button;
  });
  rail.append(...zoomButtons);
  map.append(mapClose, levelToggle, rail, canvas);
  ui.append(quest, map);
  document.body.appendChild(ui);
  return {
    quest,
    map,
    canvas,
    touchTargets: [questClose, questRow, abandonQuest, mapClose, levelToggle, ...zoomButtons],
  };
}

describe('mobile map and quest layout', () => {
  it.each([
    { width: 844, height: 390, uiScale: 0.85 },
    { width: 844, height: 390, uiScale: 1 },
    { width: 844, height: 390, uiScale: 1.4 },
    { width: 820, height: 390, uiScale: 1.4 },
  ])(
    'computes non-overlapping windows at $width x $height and UI scale $uiScale',
    async ({ width, height, uiScale }) => {
      await page.viewport(width, height);
      document.documentElement.style.setProperty('--app-vw', `${width}px`);
      document.documentElement.style.setProperty('--app-vh', `${height}px`);
      document.documentElement.style.setProperty('--ui-scale', String(uiScale));
      const { quest, map, canvas } = mountWindows();
      const questRect = quest.getBoundingClientRect();
      const mapRect = map.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();

      expect(getComputedStyle(document.body).getPropertyValue('--mobile-map-rail').trim()).toBe(
        '58px',
      );
      expect(questRect.width).toBeGreaterThanOrEqual(220 * uiScale - EPSILON);
      expect(questRect.width).toBeLessThanOrEqual(300 * uiScale + EPSILON);
      expect(canvasRect.width).toBeGreaterThanOrEqual(272 - EPSILON);
      expect(questRect.right + 8).toBeLessThanOrEqual(mapRect.left + EPSILON);
      expect(mapRect.right).toBeLessThanOrEqual(width + EPSILON);
    },
  );

  it.each([0.85, 1, 1.4])(
    'keeps the stacked 819x390 fallback usable and contained at UI scale %s',
    async (uiScale) => {
      const width = 819;
      const height = 390;
      await page.viewport(width, height);
      document.documentElement.style.setProperty('--app-vw', `${width}px`);
      document.documentElement.style.setProperty('--app-vh', `${height}px`);
      document.documentElement.style.setProperty('--ui-scale', String(uiScale));
      const { quest, map, canvas, touchTargets } = mountWindows();
      const questRect = quest.getBoundingClientRect();
      const mapRect = map.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const questHeightCap = Math.min(118, Math.max(88, height / uiScale - 150)) * uiScale;

      expect(Math.abs(questRect.height - questHeightCap)).toBeLessThanOrEqual(EPSILON);
      expect(
        Math.abs(questRect.left + questRect.width / 2 - (mapRect.left + mapRect.width / 2)),
      ).toBeLessThanOrEqual(EPSILON);
      expect(questRect.bottom + 8 * uiScale).toBeLessThanOrEqual(mapRect.top + EPSILON);

      for (const rect of [questRect, mapRect]) {
        expect(rect.left).toBeGreaterThanOrEqual(-EPSILON);
        expect(rect.top).toBeGreaterThanOrEqual(-EPSILON);
        expect(rect.right).toBeLessThanOrEqual(width + EPSILON);
        expect(rect.bottom).toBeLessThanOrEqual(height + EPSILON);
      }

      expect(Math.abs(canvasRect.width - canvasRect.height)).toBeLessThanOrEqual(EPSILON);
      expect(canvasRect.width).toBeGreaterThanOrEqual(160 - EPSILON);
      for (const button of touchTargets) {
        button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const rect = button.getBoundingClientRect();
        expect(rect.width).toBeGreaterThanOrEqual(40 - TOUCH_EPSILON);
        expect(rect.height).toBeGreaterThanOrEqual(40 - TOUCH_EPSILON);
        const owner = button.closest<HTMLElement>('.window');
        expect(owner).not.toBeNull();
        const ownerRect = owner?.getBoundingClientRect();
        expect(ownerRect).toBeDefined();
        if (ownerRect === undefined) continue;
        expect(rect.left).toBeGreaterThanOrEqual(ownerRect.left - EPSILON);
        expect(rect.top).toBeGreaterThanOrEqual(ownerRect.top - EPSILON);
        expect(rect.right).toBeLessThanOrEqual(ownerRect.right + EPSILON);
        expect(rect.bottom).toBeLessThanOrEqual(ownerRect.bottom + EPSILON);
      }
    },
  );
});
