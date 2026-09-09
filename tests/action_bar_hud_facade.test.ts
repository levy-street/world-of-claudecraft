import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hud } from '../src/ui/hud';
import { bindShiftClear } from '../src/ui/hud/action_bar/action_bar_clear';

/** Slice one function's body out of a source string, bounded at ITS OWN closing
 *  brace via a depth count rather than to end-of-file: a function appended
 *  after the target in a later change must not silently satisfy a pin meant
 *  for this one. */
function sliceFunctionBody(source: string, startIndex: number): string {
  const braceStart = source.indexOf('{', startIndex);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(startIndex, i + 1);
    }
  }
  throw new Error('sliceFunctionBody: unbalanced braces from the given start index');
}

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

    expect(configurableSlots).toContain('bindShiftClear(btn, clearSlot);');
    expect(configurableSlots).toContain(
      'this.hotbarActions = clearHotbarSlot(this.hotbarActions, slot - 1);',
    );
    expect(configurableSlots).toContain('this.saveSlotMap();');

    const actionBarBuild = source.slice(
      buildStart,
      source.indexOf('private buildCastBar()', buildStart),
    );
    // Only the attack slot (slot 0) still calls the two handlers directly; every
    // configurable slot routes through bindShiftClear instead (checked above).
    expect(actionBarBuild.match(/handleShiftClearContextMenu\(/g)).toHaveLength(1);
    expect(actionBarBuild.match(/handleShiftClearKeydown\(/g)).toHaveLength(1);
    expect(actionBarBuild).toContain('handleShiftClearContextMenu(e, clearAttackSlotAction);');
    expect(actionBarBuild).toContain('this.attackSlotAction = null;');
    expect(actionBarBuild).toContain('this.saveAttackSlotAction();');

    // bindShiftClear is the one place that knows a slot surface must offer BOTH
    // desktop clear affordances; pin that its body still registers the pair, so a
    // future surface cannot ship contextmenu without keydown (or vice versa).
    const clearSource = readFileSync(
      new URL('../src/ui/hud/action_bar/action_bar_clear.ts', import.meta.url),
      'utf8',
    );
    const bindStart = clearSource.indexOf('export function bindShiftClear');
    expect(bindStart).toBeGreaterThan(-1);
    // Bounded at bindShiftClear's OWN closing brace, not end-of-file: a
    // function appended after it in a later change must not be able to
    // satisfy this pair from outside the function under test.
    const bindBody = sliceFunctionBody(clearSource, bindStart);
    expect(bindBody).toContain("btn.addEventListener('contextmenu'");
    expect(bindBody).toContain("btn.addEventListener('keydown'");
  });

  it('bindShiftClear actually WIRES both handlers: shift+contextmenu and shift+Delete clear; a plain contextmenu does not', () => {
    const handlers: Record<string, (e: unknown) => void> = {};
    const btn = {
      addEventListener: (type: string, handler: (e: unknown) => void) => {
        handlers[type] = handler;
      },
    } as unknown as HTMLElement;
    let clears = 0;
    bindShiftClear(btn, () => {
      clears++;
    });

    handlers.contextmenu({ shiftKey: false, preventDefault: () => {} });
    expect(clears).toBe(0);

    handlers.contextmenu({ shiftKey: true, preventDefault: () => {} });
    expect(clears).toBe(1);

    handlers.keydown({
      shiftKey: true,
      key: 'Delete',
      preventDefault: () => {},
      stopPropagation: () => {},
    });
    expect(clears).toBe(2);

    handlers.keydown({
      shiftKey: false,
      key: 'Delete',
      preventDefault: () => {},
      stopPropagation: () => {},
    });
    expect(clears).toBe(2);
  });

  it('checks drag eligibility before every drop and the touch bar editor place', () => {
    // Four desktop drag/drop sites plus the bar editor's placeAbility, the touch
    // binding path: it takes the SAME eligibility gate the desktop drop takes,
    // so a passive or unknown ability cannot reach a slot through the overlay.
    const source = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    expect(source.match(/actionBarController\.isAssignableAction\(/g)).toHaveLength(5);
    expect(source).toContain(
      "if (!this.actionBarController.isAssignableAction({ type: 'ability', id: abilityId })) return;",
    );
  });

  it("cancels a focused slot's native Space activation without blocking the jump key", () => {
    // tests/browser/action_bar_space_jump.browser.test.ts pins the live
    // behavior; this source pin keeps buildActionBar from regressing back to
    // stopPropagation, which would swallow the keydown before Input's
    // window-level jump handler sees it.
    const source = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const buildStart = source.indexOf('private buildActionBar(): void');
    const keydownStart = source.indexOf("btn.addEventListener('keydown'", buildStart);
    const keydownEnd = source.indexOf('});', keydownStart);
    const keydownBlock = source.slice(keydownStart, keydownEnd);

    expect(keydownBlock).toContain('e.preventDefault();');
    expect(keydownBlock).not.toContain('e.stopPropagation();');
  });

  // WAS: 'cancels a mobile drag before exposing a newly loaded form page'. The
  // long-press rearrange that drag belonged to is retired, so there is no drag
  // to cancel here any more. What still matters at this seam is the OTHER half
  // that test covered: a form swap must drop the desktop drag AND re-clamp the
  // ring page, or the newly loaded bar is exposed through a stale page.
  interface FormSyncHud {
    actionBarController: { syncActiveForm(): boolean; syncProfile(): boolean };
    spellbookWindow: { refreshHotbarControls(): void };
    dragAction: unknown;
    mobileActionPage: number;
    currentMobileActionPage(): number;
    syncActiveHotbarForm(): void;
  }

  function formSyncHud(
    profileSwitched: boolean,
    formSwapped: boolean,
  ): FormSyncHud & {
    refreshes: number;
    formSyncs: number;
  } {
    const hud = Object.create(Hud.prototype) as unknown as FormSyncHud & {
      refreshes: number;
      formSyncs: number;
    };
    hud.refreshes = 0;
    hud.formSyncs = 0;
    hud.actionBarController = {
      syncActiveForm: () => {
        hud.formSyncs += 1;
        return formSwapped;
      },
      syncProfile: () => profileSwitched,
    };
    hud.spellbookWindow = {
      refreshHotbarControls: () => {
        hud.refreshes += 1;
      },
    };
    hud.dragAction = { action: { type: 'ability', id: 'strike' }, sourceIndex: 0 };
    hud.mobileActionPage = 4;
    hud.currentMobileActionPage = () => 1;
    return hud;
  }

  it('drops the desktop drag and re-clamps the ring page on a form swap', () => {
    const hud = formSyncHud(false, true);

    hud.syncActiveHotbarForm();

    expect(hud.dragAction).toBeNull();
    expect(hud.mobileActionPage).toBe(1);
    expect(hud.refreshes).toBe(0);
  });

  // A mid-session Interface Mode flip re-seeds the bars from the other
  // surface's keys: the same drag drop and page re-clamp as a form swap, plus
  // the spellbook's hotbar controls re-read the newly loaded bar.
  it('drops the drag, re-clamps the page, and refreshes the spellbook on a surface flip', () => {
    const hud = formSyncHud(true, false);

    hud.syncActiveHotbarForm();

    expect(hud.dragAction).toBeNull();
    expect(hud.mobileActionPage).toBe(1);
    expect(hud.refreshes).toBe(1);
    // The reload already loaded the resolved form; no second form sync runs.
    expect(hud.formSyncs).toBe(0);
  });

  it('leaves the drag and page alone when neither the surface nor the form changed', () => {
    const hud = formSyncHud(false, false);

    hud.syncActiveHotbarForm();

    expect(hud.dragAction).not.toBeNull();
    expect(hud.mobileActionPage).toBe(4);
    expect(hud.refreshes).toBe(0);
  });

  it('leaves no touch long-press rearrange path on the action bar', () => {
    const source = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    for (const token of [
      'mobileHotbarDrag',
      'bindMobileActionDrag',
      'bindMobileRingDrag',
      'mobile-hotbar-dragging',
    ]) {
      expect(source, `${token} must not survive the removal`).not.toContain(token);
    }
    // The desktop HTML5 path is untouched: both halves still there.
    expect(source).toContain("btn.addEventListener('dragstart', (e) => {");
    expect(source).toContain("btn.addEventListener('dragover', (e) => {");
  });
});
