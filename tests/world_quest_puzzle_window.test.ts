// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import type { WorldQuestProgress } from '../src/sim/types';
import type { FocusTrapHandle } from '../src/ui/focus_manager';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { WorldQuestPuzzleWindow } from '../src/ui/world_quest_puzzle_window';

describe('world quest puzzle window', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="ui"></main>';
    setLanguage('en');
  });

  afterEach(() => setLanguage('en'));

  it('keeps the shared visually-hidden utility clipped from sight', () => {
    const shellCss = readFileSync(join(process.cwd(), 'src/styles/shell.css'), 'utf8');
    const rule = shellCss.match(/\.visually-hidden:where\([^}]+\)\s*\{[^}]+\}/)?.[0];
    expect(rule).toContain('clip-path: inset(50%)');
    expect(rule).toContain('overflow: hidden');
    expect(rule).toContain('width: 1px');
    expect(rule).toContain('height: 1px');
  });

  it('keeps a visible tile focus ring in normal and forced-colors modes', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/components.css'), 'utf8');
    const focusRule = css.match(/\.wqp-tile:focus-visible\s*\{[^}]+\}/)?.[0];
    expect(focusRule).toContain('outline: 3px solid var(--color-border-focus)');
    expect(focusRule).toContain('outline-offset: 2px');
    expect(focusRule).not.toContain('outline: none');
    expect(css).toMatch(
      /@media \(forced-colors: active\) \{[\s\S]*?\.wqp-tile:focus-visible\s*\{[^}]*outline-color: Highlight;/,
    );
  });

  it('traps focus, describes the beam, preserves tile focus, and relocalizes', async () => {
    const quest = WORLD_QUESTS_BY_ID.wq_galecrest_wisps;
    if (quest.objective.type !== 'puzzle') throw new Error('Expected puzzle fixture');
    const progress: WorldQuestProgress = {
      questId: quest.id,
      count: 0,
      state: 'active',
      puzzleVariant: 0,
      puzzleRotations: quest.objective.puzzles[0].tiles.map((tile) => tile.initialRotation),
    };
    const worldQuestLog = new Map([[quest.id, progress]]);
    const rotateWorldQuestPuzzleTile = vi.fn();
    const swapWorldQuestMatch3Tiles = vi.fn();
    const resetWorldQuestMatch3 = vi.fn();
    const release = vi.fn();
    const focusFirst = vi.fn((selector?: string) => {
      document.querySelector<HTMLElement>(selector ?? 'button')?.focus();
    });
    const trap: FocusTrapHandle = { focusFirst, release, opener: () => null };
    const openFocusTrap = vi.fn(() => trap);
    const window = new WorldQuestPuzzleWindow({
      document,
      world: () => ({
        worldQuestLog,
        rotateWorldQuestPuzzleTile,
        swapWorldQuestMatch3Tiles,
        resetWorldQuestMatch3,
      }),
      closeOthers: vi.fn(),
      openFocusTrap,
      click: vi.fn(),
    });

    window.open(quest.id);
    const root = document.getElementById('world-quest-puzzle-window') as HTMLElement;
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.getAttribute('aria-labelledby')).toBe('world-quest-puzzle-title');
    expect(openFocusTrap).toHaveBeenCalledOnce();
    expect(focusFirst).toHaveBeenCalledWith(
      '[data-puzzle-tile]:not(:disabled), [data-match3-cell]:not(:disabled), [data-match3-reset]',
    );
    expect(document.activeElement).toBe(root.querySelector('[data-puzzle-tile="0"]'));

    const sourceTile = root.querySelector<HTMLElement>('[data-puzzle-tile="3"]');
    expect(sourceTile?.getAttribute('aria-label')).toContain('Connectors:');
    expect(sourceTile?.getAttribute('aria-label')).toContain('beam does not reach');
    expect(sourceTile?.getAttribute('aria-label')).toContain('Source: west');
    sourceTile?.focus();

    const nextRotations = [...(progress.puzzleRotations ?? [])];
    nextRotations[4] = 1;
    worldQuestLog.set(quest.id, {
      ...progress,
      puzzleRotations: nextRotations,
    });
    window.refreshIfChanged();
    expect((document.activeElement as HTMLElement).dataset.puzzleTile).toBe('3');

    root.querySelector<HTMLElement>('[data-puzzle-tile="4"]')?.click();
    expect(rotateWorldQuestPuzzleTile).toHaveBeenCalledWith(quest.id, 4);

    await ensureLocaleLoaded('es');
    setLanguage('es');
    window.relocalize();
    expect(document.getElementById('world-quest-puzzle-title')?.textContent).toBe(
      'Alineación del rayo ley',
    );

    window.close();
    expect(release).toHaveBeenCalledWith();
    expect(root.style.display).toBe('none');
  });

  it('renders the weekly match-three level and sends only a paired swap', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_palmreach_confections;
    if (quest.objective.type !== 'match3') throw new Error('Expected match-three fixture');
    const level = quest.objective.levels[0];
    const progress: WorldQuestProgress = {
      questId: quest.id,
      count: 0,
      state: 'active',
      puzzleVariant: 0,
      match3Board: [...level.board],
      match3Moves: 0,
      match3RefillIndex: 0,
    };
    const worldQuestLog = new Map([[quest.id, progress]]);
    const swapWorldQuestMatch3Tiles = vi.fn();
    const resetWorldQuestMatch3 = vi.fn();
    const window = new WorldQuestPuzzleWindow({
      document,
      world: () => ({
        worldQuestLog,
        rotateWorldQuestPuzzleTile: vi.fn(),
        swapWorldQuestMatch3Tiles,
        resetWorldQuestMatch3,
      }),
      closeOthers: vi.fn(),
      openFocusTrap: () => ({
        focusFirst: vi.fn(),
        release: vi.fn(),
        opener: () => null,
      }),
      click: vi.fn(),
    });

    window.open(quest.id);
    const root = document.getElementById('world-quest-puzzle-window') as HTMLElement;
    expect(root.querySelectorAll('[data-match3-cell]')).toHaveLength(36);
    expect(root.textContent).toContain('Weekly level 1');
    expect(root.querySelector('.wqm-grid')?.getAttribute('role')).toBe('group');
    expect(root.querySelector('.wqm-status')?.hasAttribute('aria-live')).toBe(false);
    const announcer = document.querySelector('[role="status"]');
    expect(announcer?.getAttribute('aria-live')).toBe('polite');
    expect(announcer?.textContent).toContain('Moves: 0/20');
    expect(root.querySelector('[data-match3-cell="0"]')?.getAttribute('role')).toBeNull();
    expect(root.querySelector('[data-match3-cell="0"]')?.getAttribute('aria-label')).toMatch(
      /^Row 1, column 1: .+/,
    );
    root.querySelector<HTMLElement>('[data-match3-cell="2"]')?.click();
    const selectedCell = root.querySelector('[data-match3-cell="2"]');
    expect(selectedCell?.getAttribute('aria-pressed')).toBe('true');
    expect(selectedCell?.querySelector('.visually-hidden')?.textContent).toBe('Selected');
    expect(root.querySelector('.sr-only')).toBeNull();
    expect(announcer?.classList.contains('visually-hidden')).toBe(true);
    root.querySelector<HTMLElement>('[data-match3-cell="3"]')?.click();
    expect(swapWorldQuestMatch3Tiles).toHaveBeenCalledWith(quest.id, 2, 3);
    worldQuestLog.set(quest.id, { ...progress, count: 3, match3Moves: 1 });
    window.refreshIfChanged();
    expect(document.querySelector('[role="status"]')).toBe(announcer);
    expect(announcer?.textContent).toContain('Moves: 1/20');
    root.querySelector<HTMLElement>('[data-match3-reset]')?.click();
    expect(resetWorldQuestMatch3).toHaveBeenCalledWith(quest.id);

    window.open('wq_galecrest_wisps');
    expect(document.querySelector('[role="status"]')).toBe(announcer);
    expect(announcer?.textContent).toBe('');
    window.close();
    expect(announcer?.textContent).toBe('');
  });

  it('moves focus to Restart when the focused candy becomes disabled', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_palmreach_confections;
    if (quest.objective.type !== 'match3') throw new Error('Expected match-three fixture');
    const level = quest.objective.levels[0];
    const progress: WorldQuestProgress = {
      questId: quest.id,
      count: 0,
      state: 'active',
      puzzleVariant: 0,
      match3Board: [...level.board],
      match3Moves: 0,
      match3RefillIndex: 0,
    };
    const worldQuestLog = new Map([[quest.id, progress]]);
    const focusFirst = vi.fn((selector?: string) => {
      document.querySelector<HTMLElement>(selector ?? 'button')?.focus();
    });
    const window = new WorldQuestPuzzleWindow({
      document,
      world: () => ({
        worldQuestLog,
        rotateWorldQuestPuzzleTile: vi.fn(),
        swapWorldQuestMatch3Tiles: vi.fn(),
        resetWorldQuestMatch3: vi.fn(),
      }),
      closeOthers: vi.fn(),
      openFocusTrap: () => ({
        focusFirst,
        release: vi.fn(),
        opener: () => null,
      }),
      click: vi.fn(),
    });

    window.open(quest.id);
    const root = document.getElementById('world-quest-puzzle-window') as HTMLElement;
    root.querySelector<HTMLElement>('[data-match3-cell="5"]')?.focus();
    worldQuestLog.set(quest.id, { ...progress, match3Moves: level.maxMoves });
    window.refreshIfChanged();

    expect(root.querySelectorAll('[data-match3-cell]:not(:disabled)')).toHaveLength(0);
    expect(document.activeElement).toBe(root.querySelector('[data-match3-reset]'));
    expect(root.querySelector('.wqm-out')?.getAttribute('role')).toBe('alert');

    window.close();
    window.open(quest.id);
    expect(document.activeElement).toBe(root.querySelector('[data-match3-reset]'));

    worldQuestLog.set(quest.id, { ...progress, match3Moves: 0 });
    window.refreshIfChanged();
    expect(document.activeElement).toBe(root.querySelector('[data-match3-reset]'));
  });
});
