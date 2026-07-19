// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('performance tour entry flow', () => {
  it('uses the shared offline entry helper that dismisses every device gate', () => {
    const source = readFileSync('scripts/perf_tour.mjs', 'utf8');

    expect(source).toContain("enterOfflineGame } from './enter_offline_game.mjs';");
    expect(source).toContain('await enterOfflineGame(page, {');
    expect(source).not.toContain("page.$eval('#btn-start-offline'");
  });

  it('waits for and clicks the Welcome Screen before requiring game boot', async () => {
    document.body.innerHTML = `
      <button id="btn-offline"></button>
      <div id="offline-select">
        <button class="mini-class" data-class="warrior"></button>
      </div>
      <input id="char-name">
      <button id="btn-start-offline"></button>
      <button id="ws-continue"></button>
      <div id="ui"></div>
    `;
    let welcomeClicks = 0;
    document.querySelector('#ws-continue')?.addEventListener('click', () => {
      welcomeClicks++;
      (window as unknown as { __game?: object }).__game = { sim: { player: { id: 1 } } };
    });

    const waits: Array<{ selector: string; options: object }> = [];
    const page = {
      waitForSelector: async (selector: string, options: object) => {
        waits.push({ selector, options });
        return document.querySelector(selector);
      },
      evaluate: async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => fn(...args),
      waitForFunction: async (fn: () => unknown) => {
        if (!fn()) throw new Error('game did not boot');
      },
      keyboard: {
        press: async () => {},
      },
    };
    // The automation helper is JavaScript by design and has no declaration file.
    // @ts-expect-error
    const { enterOfflineGame } = await import('../scripts/enter_offline_game.mjs');

    await enterOfflineGame(page, {
      settleMs: 0,
      dismissMobilePreflight: false,
    });

    expect(waits).toContainEqual({
      selector: '#ws-continue:not([disabled])',
      options: { visible: true, timeout: 5000 },
    });
    expect(waits.some(({ selector }) => selector === '#mobile-preflight-continue')).toBe(false);
    expect(welcomeClicks).toBe(1);
    expect((window as unknown as { __game?: object }).__game).toBeDefined();

    delete (window as unknown as { __game?: object }).__game;
  });
});
