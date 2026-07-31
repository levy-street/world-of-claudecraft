import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hud } from '../src/ui/hud';

vi.mock('../src/render/characters', () => ({ CharacterPreview: class {} }));
vi.mock('../src/render/characters/assets', () => ({ preloadMechAssets: vi.fn() }));
vi.mock('../src/render/characters/portrait', () => ({
  onPortraitsReady: vi.fn(),
  onPortraitUpdate: vi.fn(),
  playerPortraitDataUrl: vi.fn(),
  visualPortraitDataUrl: vi.fn(),
}));

afterEach(() => vi.unstubAllGlobals());

describe('Hud action-bar facade', () => {
  it('routes both configurable slot paths through the Shift-only clear gesture', () => {
    const source = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const buildStart = source.indexOf('private buildActionBar(): void');
    const configurableStart = source.indexOf('if (slot >= 1) {', buildStart);
    const attackSlotStart = source.indexOf('// Slot 0 (Attack).', configurableStart);
    const configurableSlots = source.slice(configurableStart, attackSlotStart);

    expect(configurableSlots.match(/btn\.addEventListener\('contextmenu'/g)).toHaveLength(1);
    expect(configurableSlots).toContain('handleShiftClearContextMenu(e, clearSlot)');
    expect(configurableSlots).toContain(
      'this.hotbarActions = clearHotbarSlot(this.hotbarActions, slot - 1);',
    );
    expect(configurableSlots).toContain('this.saveSlotMap();');

    const actionBarBuild = source.slice(
      buildStart,
      source.indexOf('private buildCastBar()', buildStart),
    );
    expect(actionBarBuild.match(/handleShiftClearContextMenu\(/g)).toHaveLength(2);
    expect(actionBarBuild.match(/handleShiftClearKeydown\(/g)).toHaveLength(2);
    expect(actionBarBuild).toContain('handleShiftClearContextMenu(e, clearAttackSlotAction);');
    expect(actionBarBuild).toContain('this.attackSlotAction = null;');
    expect(actionBarBuild).toContain('this.saveAttackSlotAction();');
  });

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
