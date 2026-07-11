// Behavioral guard for the I2 regression: on the mobile back-stack shell
// (body.mobile-touch) the settings window renders NO category rail (spec section
// 9 wires only B/back there), but a paired gamepad still polls LB/RB every frame
// regardless of platform. Before the fix, LB/RB routed categoryPrev/categoryNext
// -> cycleCategory -> visibleCategoryIds() -> railEl().querySelectorAll(...) and
// threw an uncaught TypeError (null rail) in the RAF frame loop. The category
// verbs must now no-op when no rail is mounted.
import { afterEach, describe, expect, it } from 'vitest';
import { OptionsWindow, type OptionsWindowDeps } from '../src/ui/options_window';

// A fake #options-menu root with only the surface the category-cycle path reads:
// it is "open" (display:flex) and has NO rail (querySelector returns null).
function fakeRoot(): HTMLElement {
  return {
    style: { display: 'flex' },
    querySelector: () => null,
    querySelectorAll: () => [] as unknown as NodeListOf<Element>,
    contains: () => false,
  } as unknown as HTMLElement;
}

// Only root() is exercised by the category verbs under the mobile shell; the rest
// of the interface is never reached (the guard returns first), so a bare cast is
// enough. If the guard regresses and a rail-dependent path runs, the missing deps
// surface as their own error, still failing the not-throw assertion.
function fakeDeps(root: HTMLElement): OptionsWindowDeps {
  return { root: () => root } as unknown as OptionsWindowDeps;
}

describe('options_window: controller category cycling is inert on the mobile shell (I2)', () => {
  const realDoc = (globalThis as { document?: unknown }).document;
  afterEach(() => {
    (globalThis as { document?: unknown }).document = realDoc;
  });

  function underMobileTouch(): void {
    (globalThis as { document?: unknown }).document = {
      body: { classList: { contains: (c: string) => c === 'mobile-touch' } },
    };
  }

  it('LB/RB (categoryPrev/categoryNext) do not throw with no rail mounted', () => {
    underMobileTouch();
    const w = new OptionsWindow(fakeDeps(fakeRoot()));
    expect(() => w.handleMenuIntent('categoryNext')).not.toThrow();
    expect(() => w.handleMenuIntent('categoryPrev')).not.toThrow();
  });

  it('visibleCategoryIds() returns [] when the rail is absent (no null deref)', () => {
    const w = new OptionsWindow(fakeDeps(fakeRoot())) as unknown as {
      visibleCategoryIds(): string[];
    };
    expect(w.visibleCategoryIds()).toEqual([]);
  });

  it('Ctrl+Tab (onBodyKeydown) is inert with no rail mounted', () => {
    underMobileTouch();
    const w = new OptionsWindow(fakeDeps(fakeRoot())) as unknown as {
      onBodyKeydown(e: KeyboardEvent): void;
    };
    const e = { key: 'Tab', ctrlKey: true, shiftKey: false, preventDefault: () => {} };
    expect(() => w.onBodyKeydown(e as unknown as KeyboardEvent)).not.toThrow();
  });
});
