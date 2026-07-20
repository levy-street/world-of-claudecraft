// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { enterOfflineGame } from '../scripts/enter_offline_game.mjs';
import { perfTourEntryOptions } from '../scripts/perf_tour_entry_options.mjs';

interface FakePageState {
  mobilePreflightClicks: number;
  welcomeClicks: number;
  selectorWaits: Array<{ selector: string; options: object }>;
  functionWaits: object[];
}

function entryDom(): void {
  document.body.innerHTML = `
    <button id="btn-offline"></button>
    <div id="offline-select">
      <button class="mini-class" data-class="warrior"></button>
    </div>
    <input id="char-name">
    <button id="btn-start-offline"></button>
    <button id="mobile-preflight-continue"></button>
    <button id="ws-continue"></button>
    <div id="ui"></div>
  `;
}

function fakePage(bootSucceeds = true): { page: object; state: FakePageState } {
  const state: FakePageState = {
    mobilePreflightClicks: 0,
    welcomeClicks: 0,
    selectorWaits: [],
    functionWaits: [],
  };
  document.querySelector('#mobile-preflight-continue')?.addEventListener('click', () => {
    state.mobilePreflightClicks++;
  });
  document.querySelector('#ws-continue')?.addEventListener('click', () => {
    state.welcomeClicks++;
    if (bootSucceeds) {
      (window as unknown as { __game?: object }).__game = { sim: { player: { id: 1 } } };
    }
  });
  return {
    state,
    page: {
      waitForSelector: async (selector: string, options: object = {}) => {
        state.selectorWaits.push({ selector, options });
        return document.querySelector(selector);
      },
      evaluate: async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => fn(...args),
      waitForFunction: async (fn: () => unknown, options: object = {}) => {
        state.functionWaits.push(options);
        if (!fn()) throw new Error('game did not boot');
      },
      keyboard: {
        press: async () => {},
      },
    },
  };
}

describe('performance tour entry options', () => {
  it('uses a long mobile gate wait and the configured boot timeout only on mobile', () => {
    expect(perfTourEntryOptions({ label: 'mobile', isMobile: true }, 120_000)).toEqual({
      charClass: 'warrior',
      charName: 'MobilePerf',
      settleMs: 0,
      dismissMobilePreflight: true,
      mobilePreflightTimeoutMs: 30_000,
      gameBootTimeoutMs: 120_000,
    });
    expect(perfTourEntryOptions({ label: 'desktop', isMobile: false }, 90_000)).toEqual({
      charClass: 'warrior',
      charName: 'DesktopPerf',
      settleMs: 0,
      dismissMobilePreflight: false,
      mobilePreflightTimeoutMs: 30_000,
      gameBootTimeoutMs: 90_000,
    });
  });
});

describe('shared offline entry helper', () => {
  it('uses caller timeouts, clicks both gates, and reports a successful boot', async () => {
    entryDom();
    const { page, state } = fakePage();

    const gameBooted = await enterOfflineGame(page, {
      settleMs: 0,
      dismissMobilePreflight: true,
      mobilePreflightTimeoutMs: 30_000,
      gameBootTimeoutMs: 120_000,
    });

    expect(state.selectorWaits).toContainEqual({
      selector: '#mobile-preflight-continue',
      options: { visible: true, timeout: 30_000 },
    });
    expect(state.selectorWaits).toContainEqual({
      selector: '#ws-continue:not([disabled])',
      options: { visible: true, timeout: 5000 },
    });
    expect(state.functionWaits).toEqual([{ timeout: 120_000 }]);
    expect(state.mobilePreflightClicks).toBe(1);
    expect(state.welcomeClicks).toBe(1);
    expect(gameBooted).toBe(true);

    delete (window as unknown as { __game?: object }).__game;
  });

  it('skips the mobile gate on desktop and reports a failed boot once', async () => {
    entryDom();
    const { page, state } = fakePage(false);

    const gameBooted = await enterOfflineGame(page, {
      settleMs: 0,
      dismissMobilePreflight: false,
      gameBootTimeoutMs: 90_000,
    });

    expect(
      state.selectorWaits.some(({ selector }) => selector === '#mobile-preflight-continue'),
    ).toBe(false);
    expect(state.functionWaits).toEqual([{ timeout: 90_000 }]);
    expect(gameBooted).toBe(false);
  });
});
