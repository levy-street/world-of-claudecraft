import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hud } from '../src/ui/hud';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

vi.mock('../src/render/characters', () => ({ CharacterPreview: class {} }));
vi.mock('../src/render/characters/assets', () => ({ preloadMechAssets: vi.fn() }));
vi.mock('../src/render/characters/portrait', () => ({
  onPortraitsReady: vi.fn(),
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
    expect(configurableSlots).toContain(
      'handleShiftClearContextMenu(e, this.actionBarsLocked(), clearSlot)',
    );
    expect(configurableSlots).toContain('this.actionBarContextMenu.openForEvent(e, btn)');
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
    expect(actionBarBuild).toContain(
      'handleShiftClearContextMenu(e, this.actionBarsLocked(), clearAttackSlotAction)',
    );
    expect(actionBarBuild).toContain('this.attackSlotAction = null;');
    expect(actionBarBuild).toContain('this.saveAttackSlotAction();');
  });

  it('checks drag eligibility before normal-bar and configurable slot 0 drops', () => {
    const source = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    expect(source.match(/actionBarController\.isAssignableAction\(/g)).toHaveLength(4);
  });

  it('gates desktop and touch layout mutations on the live action-bar lock', () => {
    const source = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const buildStart = source.indexOf('private buildActionBar(): void');
    const buildEnd = source.indexOf('private buildCastBar()', buildStart);
    const actionBarBuild = source.slice(buildStart, buildEnd);
    expect(actionBarBuild).toContain('if (!this.canEditActionBars())');

    const mobileStart = source.indexOf('private bindMobileActionDrag(');
    const mobileEnd = source.indexOf('// Repaint the side-menu', mobileStart);
    const mobileDrag = source.slice(mobileStart, mobileEnd);
    expect(mobileDrag).toContain('if (!this.canEditActionBars()) return;');
  });

  it('blocks the Hud mutation facade while the bars are locked', () => {
    const addAbility = vi.fn(() => true);
    const removeAbility = vi.fn(() => true);
    const resetActiveBar = vi.fn();
    const refreshHotbarControls = vi.fn();
    const hud = Object.create(Hud.prototype) as unknown as {
      optionsHooks: { settings: { get(key: string): boolean } };
      actionBarController: {
        addAbility(id: string): boolean;
        removeAbility(id: string): boolean;
        resetActiveBar(): void;
      };
      spellbookWindow: { refreshHotbarControls(): void };
      addAbilityToHotbar(id: string): boolean;
      removeAbilityFromHotbar(id: string): boolean;
      resetActiveFormBarToDefault(): void;
    };
    hud.optionsHooks = { settings: { get: () => true } };
    hud.actionBarController = { addAbility, removeAbility, resetActiveBar };
    hud.spellbookWindow = { refreshHotbarControls };

    expect(hud.addAbilityToHotbar('charge')).toBe(false);
    expect(hud.removeAbilityFromHotbar('charge')).toBe(false);
    hud.resetActiveFormBarToDefault();

    expect(addAbility).not.toHaveBeenCalled();
    expect(removeAbility).not.toHaveBeenCalled();
    expect(resetActiveBar).not.toHaveBeenCalled();
    expect(refreshHotbarControls).not.toHaveBeenCalled();
  });

  it('keeps contextual and Options setting changes synchronized', () => {
    const source = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const contextMenu = source.slice(
      source.indexOf('private readonly actionBarContextMenu'),
      source.indexOf('// One-shot latch', source.indexOf('private readonly actionBarContextMenu')),
    );
    expect(contextMenu).toContain("hooks.onSettingChange('lockActionBars', locked)");
    expect(contextMenu).toContain('this.optionsWindow.refreshInterfaceControls()');

    const attackSetting = mainSource.slice(
      mainSource.indexOf("if (key === 'showAttackButton')"),
      mainSource.indexOf("if (key === 'groundReticle')"),
    );
    expect(attackSetting).toContain("if (settings.get('lockActionBars')) return;");
    expect(attackSetting).toContain('hud.setActionBarsLocked(locked)');
  });

  it('keeps casting independent from the action-bar edit lock', () => {
    const source = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const castStart = source.indexOf('  castSlot(barSlot: number): void {');
    const castEnd = source.indexOf('private cycleMobileActionPage()', castStart);
    expect(source.slice(castStart, castEnd)).not.toContain('actionBarsLocked');
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
