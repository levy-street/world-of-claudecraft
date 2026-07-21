import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hud } from '../src/ui/hud';

vi.mock('../src/render/characters', () => ({ CharacterPreview: class {} }));
vi.mock('../src/render/characters/assets', () => ({ preloadMechAssets: vi.fn() }));
vi.mock('../src/render/characters/portrait', () => ({
  onPortraitsReady: vi.fn(),
  playerPortraitDataUrl: vi.fn(),
  visualPortraitDataUrl: vi.fn(),
}));

afterEach(() => vi.unstubAllGlobals());

describe('Hud action-bar facade', () => {
  it('checks drag eligibility before normal-bar and configurable slot 0 drops', () => {
    const source = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    expect(source.match(/actionBarController\.isAssignableAction\(/g)).toHaveLength(4);
  });

  it('cancels a mobile drag before exposing a newly loaded form page', () => {
    const clearTimeout = vi.fn();
    vi.stubGlobal('window', { clearTimeout });
    vi.stubGlobal('document', {
      body: { classList: { remove: vi.fn() } },
      querySelectorAll: () => [],
    });
    const hud = Object.create(Hud.prototype) as unknown as {
      actionBarController: { syncActiveForm(): boolean };
      dragAction: unknown;
      mobileActionPage: number;
      mobileHotbarDrag: {
        pointerId: number;
        sourceIndex: number;
        startX: number;
        startY: number;
        active: boolean;
        timer: number;
        targetIndex: number | null;
      } | null;
      syncActiveHotbarForm(): void;
    };
    hud.actionBarController = { syncActiveForm: () => true };
    hud.dragAction = { action: { type: 'ability', id: 'strike' }, sourceIndex: 0 };
    hud.mobileActionPage = 0;
    hud.mobileHotbarDrag = {
      pointerId: 7,
      sourceIndex: 2,
      startX: 10,
      startY: 20,
      active: true,
      timer: 99,
      targetIndex: 4,
    };

    hud.syncActiveHotbarForm();

    expect(hud.dragAction).toBeNull();
    expect(hud.mobileHotbarDrag).toBeNull();
    expect(clearTimeout).toHaveBeenCalledWith(99);
  });
});
