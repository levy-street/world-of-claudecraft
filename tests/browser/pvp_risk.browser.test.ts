import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import indexHtml from '../../index.html?raw';
import playHtml from '../../play.html?raw';
import '../../src/styles/index.css';
import { makeWriterFacet } from '../../src/ui/painter_host';
import { newUnitFrameBuffer } from '../../src/ui/unit_frame';
import { UnitFramePainter } from '../../src/ui/unit_frame_painter';
import { cleanup } from './_harness';

describe('PvP risk HUD', () => {
  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute('data-fx-level');
  });

  it.each([
    ['index desktop', indexHtml, 1280, 720, false],
    ['play phone landscape', playHtml, 844, 390, true],
    ['index phone portrait', indexHtml, 390, 844, true],
  ] as const)(
    'keeps both risk surfaces visible in %s at the lowest tier',
    async (_, html, width, height, mobile) => {
      await page.viewport(width, height);
      document.body.className = `game-active${mobile ? ' mobile-touch' : ''}`;
      document.documentElement.dataset.fxLevel = 'low';
      const source = new DOMParser()
        .parseFromString(html, 'text/html')
        .querySelector<HTMLTemplateElement>('#game-ui-template')!.content;
      const ui = document.createElement('div');
      ui.id = 'ui';
      ui.innerHTML = `<div id="bottom-bar"><div id="actionbar-row"><div id="actionbar-stack">${source.querySelector('#player-frame')!.outerHTML}</div></div></div>${source.querySelector('#minimap-wrap')!.outerHTML}<div id="nameplates" style="display:none"></div>`;
      document.body.appendChild(ui);
      const el = (id: string) => ui.querySelector<HTMLElement>(`#${id}`)!;
      const badge = el('pf-pvp');
      const minimap = el('minimap-disc');
      const name = el('pf-name');
      name.textContent = 'Verylongplayername';
      const painter = new UnitFramePainter(
        makeWriterFacet(
          new Map(),
          new WeakMap(),
          new WeakMap(),
          new WeakMap(),
          () => {},
          () => {},
        ),
        {
          frame: el('player-frame'),
          level: el('pf-level'),
          hpFill: el('pf-hp'),
          pvpRisk: { badge, minimap },
        },
      );
      const view = newUnitFrameBuffer().view;
      view.present = true;
      view.pvpRisk = true;
      painter.paint(view);
      const ring = getComputedStyle(minimap, '::after');
      expect(ring.borderTopColor).toBe('rgb(255, 107, 94)');
      expect(ring.animationName).toBe('minimap-pvp-risk');
      expect(ring.boxShadow).not.toBe('none');
      expect(getComputedStyle(badge).display).toBe('flex');
      expect(getComputedStyle(badge).color).toBe('rgb(255, 255, 255)');
      const rect = badge.getBoundingClientRect();
      const header = el('pf-name-header').getBoundingClientRect();
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.right).toBeLessThanOrEqual(header.right + 1);
      expect(rect.bottom).toBeLessThanOrEqual(header.bottom + 1);
      expect(name.getBoundingClientRect().right).toBeLessThanOrEqual(rect.left);
      view.pvpRisk = false;
      painter.paint(view);
      expect(getComputedStyle(badge).display).toBe('none');
      expect(getComputedStyle(minimap, '::after').animationName).toBe('none');
    },
  );
});
