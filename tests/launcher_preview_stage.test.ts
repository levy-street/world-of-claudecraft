import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  activePreviewPanel,
  CREATOR_PREVIEW_PANELS,
  creatorPanelsOnly,
  isCreatorPreviewContainer,
  PREVIEW_PANEL_CONTAINERS,
  previewContainerFor,
} from '../src/game/launcher_preview_stage';
import { stripComments } from './helpers/strip_comments';

// The launcher's 3D stage (src/game/launcher_preview_stage.ts). Two bugs it closes:
// - the stage waited on charactersReady(), the WHOLE character boot set (every creature and
//   item weapon on a desktop), so a first visit's creator stood empty for minutes;
// - built that late while the player sat on the ONLINE creator, it went into the
//   char-select container (only the char-select and offline panels were looked for), so it
//   never showed until the player changed panels.

/** A document holding the given panels, each shown or hidden. */
function docWith(panels: Record<string, boolean>): Pick<Document, 'querySelector'> {
  return {
    querySelector: ((id: string) => {
      if (!(id in panels)) return null;
      return { hasAttribute: (name: string) => name === 'hidden' && !panels[id] };
    }) as Document['querySelector'],
  };
}

describe('previewContainerFor', () => {
  it('maps every stage panel to its own container', () => {
    expect(previewContainerFor('#charselect-panel')).toBe('#online-preview-container');
    expect(previewContainerFor('#charcreate-panel')).toBe('#charcreate-preview-container');
    expect(previewContainerFor('#offline-select')).toBe('#offline-preview-container');
  });

  it('keeps the launcher fallback for any other panel', () => {
    expect(previewContainerFor('#login-panel')).toBe('#offline-preview-container');
  });

  it('names a container that exists in the markup for every panel it maps', () => {
    const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const play = readFileSync(new URL('../play.html', import.meta.url), 'utf8');
    for (const [panel, container] of Object.entries(PREVIEW_PANEL_CONTAINERS)) {
      const id = container.slice(1);
      expect(index, `${panel} -> ${container}`).toContain(`id="${id}"`);
      // play.html is online only: it carries every container but the offline creator's
      if (panel !== '#offline-select')
        expect(play, `${panel} -> ${container}`).toContain(`id="${id}"`);
    }
  });
});

describe('activePreviewPanel', () => {
  it('finds the ONLINE creator (the panel the late-built stage used to miss)', () => {
    const doc = docWith({
      '#charselect-panel': false,
      '#charcreate-panel': true,
      '#offline-select': false,
    });
    expect(activePreviewPanel(doc)).toBe('#charcreate-panel');
  });

  it('finds the char select and the offline creator', () => {
    expect(activePreviewPanel(docWith({ '#charselect-panel': true }))).toBe('#charselect-panel');
    expect(activePreviewPanel(docWith({ '#offline-select': true }))).toBe('#offline-select');
  });

  it('is null off every stage panel, and on a page missing one (play.html)', () => {
    expect(
      activePreviewPanel(
        docWith({
          '#charselect-panel': false,
          '#charcreate-panel': false,
          '#offline-select': false,
        }),
      ),
    ).toBeNull();
    expect(activePreviewPanel(docWith({}))).toBeNull();
  });
});

describe('the launcher wiring (src/main.ts)', () => {
  // code only: a pin that a commented-out line still satisfies pins nothing
  const main = stripComments(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'));

  it('builds the stage at once, never behind the character boot set', () => {
    // the start-screen wiring, from its head to the next top-level function
    const start = main.indexOf('function wireStartScreens(): void {');
    expect(start).toBeGreaterThan(-1);
    const end = main.indexOf('\nfunction ', start + 1);
    const wiring = main.slice(start, end > start ? end : undefined);
    const build = wiring.indexOf('characterPreview = createLauncherPreview();');
    expect(build).toBeGreaterThan(-1);
    // nothing waits on an asset set before (or around) the build: not the character boot
    // set, not the site-wide gate, and the build is a plain statement, not a callback
    expect(main).not.toMatch(/charactersReady\s*\(/);
    expect(wiring).not.toMatch(/assetsReady\s*\(\s*\)\s*\.then/);
    const before = wiring.slice(Math.max(0, build - 400), build);
    expect(before).not.toMatch(/\.then\s*\(|\bawait\b/);
  });

  it('puts a stage built on a panel into that panel, and moves it through one mapping', () => {
    expect(main).toMatch(
      /const stagePanel = activePreviewPanel\(\);\s*if \(stagePanel\) updatePreviewContainer\(stagePanel\);/,
    );
    const start = main.indexOf('function updatePreviewContainer(panelId: string): void {');
    expect(start).toBeGreaterThan(-1);
    expect(main.slice(start, start + 300)).toContain('$(previewContainerFor(panelId))');
  });

  it('gives the stage its loading layer and the phone touch stage', () => {
    const stage = readFileSync(
      new URL('../src/game/launcher_preview_stage.ts', import.meta.url),
      'utf8',
    );
    expect(stage).toContain("touchStage: () => doc.body.classList.contains('mobile-touch')");
    expect(stage).toContain('preview.setLoadingLayer(createPreviewLoadingSilhouette(doc));');
  });

  it('gives the stage the one-time pinch hint, narrowed to the creator panels', () => {
    const stage = stripComments(
      readFileSync(new URL('../src/game/launcher_preview_stage.ts', import.meta.url), 'utf8'),
    );
    expect(stage).toContain(
      'preview.setTouchHint(creatorPanelsOnly(createPreviewTouchHint(doc)));',
    );
  });
});

/** A stage container that answers `matches` for its own id only. */
function containerWithId(id: string): HTMLElement {
  return { matches: (sel: string) => sel === `#${id}` } as unknown as HTMLElement;
}

describe('the pinch hint is the creator panels only', () => {
  it('names the online and the offline creator, never the character select', () => {
    expect([...CREATOR_PREVIEW_PANELS].sort()).toEqual(['#charcreate-panel', '#offline-select']);
    expect(isCreatorPreviewContainer(containerWithId('charcreate-preview-container'))).toBe(true);
    expect(isCreatorPreviewContainer(containerWithId('offline-preview-container'))).toBe(true);
    // the character select stages a creation body while its roster is empty or loading
    expect(isCreatorPreviewContainer(containerWithId('online-preview-container'))).toBe(false);
  });

  it('shows the hint in a creator container and hides it in the character select', () => {
    const inner = { show: vi.fn(), hide: vi.fn(), interacted: vi.fn() };
    const hint = creatorPanelsOnly(inner);
    const creator = containerWithId('charcreate-preview-container');
    const select = containerWithId('online-preview-container');
    hint.show(creator);
    expect(inner.show).toHaveBeenLastCalledWith(creator);
    hint.show(select);
    expect(inner.show).toHaveBeenCalledTimes(1);
    expect(inner.hide).toHaveBeenCalledTimes(1);
    hint.hide();
    expect(inner.hide).toHaveBeenCalledTimes(2);
    // every gesture is passed on; the hint counts only one made while it is up
    hint.interacted();
    expect(inner.interacted).toHaveBeenCalledTimes(1);
  });

  it('matches a container once, not every frame', () => {
    const matches = vi.fn((sel: string) => sel === '#charcreate-preview-container');
    const creator = { matches } as unknown as HTMLElement;
    const hint = creatorPanelsOnly({ show: vi.fn(), hide: vi.fn(), interacted: vi.fn() });
    hint.show(creator);
    const calls = matches.mock.calls.length;
    for (let i = 0; i < 30; i++) hint.show(creator);
    expect(matches.mock.calls.length).toBe(calls);
  });
});
