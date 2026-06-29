import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { markDialogRoot } from '../src/ui/dialog_root';

// A minimal fake element that records setAttribute / removeAttribute calls, so the helper
// is pinned with no jsdom and no DOM globals at module scope (deterministic, host-agnostic).
function fakeEl() {
  const attrs: Record<string, string> = {};
  const calls: { method: 'set' | 'remove'; name: string; value?: string }[] = [];
  const el = {
    attrs,
    calls,
    setAttribute(name: string, value: string) {
      attrs[name] = value;
      calls.push({ method: 'set', name, value });
    },
    removeAttribute(name: string) {
      delete attrs[name];
      calls.push({ method: 'remove', name });
    },
  };
  return el;
}

const asEl = (el: ReturnType<typeof fakeEl>) => el as unknown as HTMLElement;

describe('markDialogRoot', () => {
  it('sets role=dialog, aria-modal=false by default, and tabindex=-1', () => {
    const el = fakeEl();
    markDialogRoot(asEl(el), { labelledBy: 'x-title' });
    expect(el.attrs.role).toBe('dialog');
    expect(el.attrs['aria-modal']).toBe('false');
    expect(el.attrs.tabindex).toBe('-1');
  });

  it('the labelledBy path sets aria-labelledby and clears aria-label', () => {
    const el = fakeEl();
    markDialogRoot(asEl(el), { labelledBy: 'arena-title' });
    expect(el.attrs['aria-labelledby']).toBe('arena-title');
    expect(el.attrs['aria-label']).toBeUndefined();
    // clears the opposite name so a re-named root never carries both (accname shadowing)
    expect(el.calls).toContainEqual({ method: 'remove', name: 'aria-label' });
  });

  it('the label path sets aria-label and clears aria-labelledby', () => {
    const el = fakeEl();
    markDialogRoot(asEl(el), { label: 'World Market' });
    expect(el.attrs['aria-label']).toBe('World Market');
    expect(el.attrs['aria-labelledby']).toBeUndefined();
    expect(el.calls).toContainEqual({ method: 'remove', name: 'aria-labelledby' });
  });

  it('modal:true sets aria-modal=true', () => {
    const el = fakeEl();
    markDialogRoot(asEl(el), { labelledBy: 'p', modal: true });
    expect(el.attrs['aria-modal']).toBe('true');
  });

  it('never sets both names (aria-labelledby shadows aria-label)', () => {
    const a = fakeEl();
    markDialogRoot(asEl(a), { labelledBy: 'a' });
    expect('aria-label' in a.attrs).toBe(false);
    const b = fakeEl();
    markDialogRoot(asEl(b), { label: 'b' });
    expect('aria-labelledby' in b.attrs).toBe(false);
  });
});

describe('dialog_root: no magic values', () => {
  it('carries no hex color or px literal', () => {
    const src = readFileSync(new URL('../src/ui/dialog_root.ts', import.meta.url), 'utf8');
    expect(src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(src, 'no px literal').not.toMatch(/\b\d+px\b/);
  });
});
