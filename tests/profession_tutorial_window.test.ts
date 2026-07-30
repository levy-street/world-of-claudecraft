// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { TIER_SKILL_STEP } from '../src/sim/professions/wheel';
import { Hud } from '../src/ui/hud';
import { buildProfessionTutorialModel } from '../src/ui/profession_tutorial_view';
import { renderProfessionTutorial } from '../src/ui/profession_tutorial_window';

// The managed-window close path (Esc dispatcher: closeAll -> topmostOpenWindow ->
// closeManagedWindow) must route the tutorial modal through
// closeProfessionTutorial, releasing the focus trap and returning focus to the
// opener, the same contract every other managed window honors. Exercised via a
// bare Hud prototype (the hud_confirm_gates precedent) since closeManagedWindow
// is private.
interface CloseHarness {
  professionTutorialTrap: { release: ReturnType<typeof vi.fn>; focusFirst: () => void } | null;
  syncAnyWindowOpenState(): void;
  hideTooltip(): void;
  closeManagedWindow(el: HTMLElement): void;
}

describe('renderProfessionTutorial', () => {
  it('paints a labelled modal with the ordered explainer paragraphs and wires both dismiss controls', () => {
    document.body.innerHTML = '';
    const onClose = vi.fn();
    const el = renderProfessionTutorial(buildProfessionTutorialModel(), { onClose });

    expect(el.id).toBe('profession-tutorial');
    expect(el.className).toContain('window');
    // WCAG dialog chrome via markDialogRoot: role, modal, and one accessible
    // name (the visible title).
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-modal')).toBe('true');
    expect(el.getAttribute('aria-labelledby')).toBe('profession-tutorial-title');
    expect(el.querySelector('#profession-tutorial-title')?.textContent).toBeTruthy();

    // Three explainer paragraphs; the tier-cap paragraph interpolates the
    // first-tier threshold from the sim constant.
    const paras = el.querySelectorAll('.cd-body .cd-para');
    expect(paras).toHaveLength(3);
    expect(paras[0].textContent).toContain(String(TIER_SKILL_STEP));

    // Both the header x and the footer button dismiss.
    el.querySelector<HTMLButtonElement>('.cd-actions .cd-ok')?.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    el.querySelector<HTMLButtonElement>('.panel-title .x-btn')?.click();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('replaces a prior instance instead of stacking the one-shot', () => {
    document.body.innerHTML = '';
    renderProfessionTutorial(buildProfessionTutorialModel(), { onClose: vi.fn() });
    renderProfessionTutorial(buildProfessionTutorialModel(), { onClose: vi.fn() });
    expect(document.querySelectorAll('#profession-tutorial')).toHaveLength(1);
  });
});

// The Esc dispatcher reaches a managed window only through the
// topmostOpenWindow scan (closeAll -> topmostOpenWindow -> closeManagedWindow),
// which selects visible '.window.panel' elements by z-order. This pin drives
// the REAL openProfessionTutorial (painter, z floor, focus trap wiring) and
// asserts the scan finds the modal and the close case tears it down with the
// trap released, so the one-shot can never open unreachable by Esc.
interface EscReachHarness {
  professionTutorialTrap: { release: (restore?: boolean) => void; focusFirst: () => void } | null;
  windowZ: number;
  focusManager: { open: ReturnType<typeof vi.fn> };
  syncAnyWindowOpenState(): void;
  hideTooltip(): void;
  openProfessionTutorial(): void;
  topmostOpenWindow(): HTMLElement | null;
  closeManagedWindow(el: HTMLElement): void;
}

describe('tutorial Esc reachability (openProfessionTutorial -> topmostOpenWindow)', () => {
  it('the open modal is the topmost scan hit, and the close case releases the trap and removes it', () => {
    document.body.innerHTML = '';
    const release = vi.fn();
    const hud = Object.create(Hud.prototype) as unknown as EscReachHarness;
    hud.professionTutorialTrap = null;
    // The window z-band floor; bringWindowToFront increments from here before
    // the tutorial's own 96 floor wins.
    hud.windowZ = 50;
    hud.focusManager = { open: vi.fn(() => ({ release, focusFirst: vi.fn() })) };
    hud.syncAnyWindowOpenState = vi.fn();
    hud.hideTooltip = vi.fn();

    hud.openProfessionTutorial();
    const el = document.getElementById('profession-tutorial');
    expect(el).not.toBeNull();
    expect(hud.focusManager.open).toHaveBeenCalledTimes(1);

    // The Esc dispatcher's scan (visible '.window.panel' by z) must surface
    // the modal, or Esc would close some other window underneath it.
    const top = hud.topmostOpenWindow();
    expect(top).toBe(el);

    hud.closeManagedWindow(top as HTMLElement);
    // No-arg release: restoreFocus defaults true, focus returns to the opener.
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith();
    expect(hud.professionTutorialTrap).toBeNull();
    expect(document.getElementById('profession-tutorial')).toBeNull();
  });
});

describe('tutorial managed-window close (Esc path)', () => {
  it('releases the focus trap (returning focus) and removes the modal, not just hides it', () => {
    document.body.innerHTML = '';
    const el = document.createElement('div');
    el.id = 'profession-tutorial';
    el.className = 'window panel';
    document.body.appendChild(el);

    const release = vi.fn();
    const hud = Object.create(Hud.prototype) as unknown as CloseHarness;
    hud.professionTutorialTrap = { release, focusFirst: vi.fn() };
    hud.syncAnyWindowOpenState = vi.fn();
    hud.hideTooltip = vi.fn();

    hud.closeManagedWindow(el);

    // release() with no argument defaults restoreFocus=true, so focus returns to
    // the opener (the FocusManager contract); a bare display:none default arm
    // would leave the trap live and never return focus.
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith();
    expect(hud.professionTutorialTrap).toBeNull();
    expect(document.getElementById('profession-tutorial')).toBeNull();
  });
});
