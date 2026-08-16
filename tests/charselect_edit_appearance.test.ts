// The char-select paid-redesign affordance (src/ui/charselect_edit_appearance.ts):
// when the Edit Appearance button appears, and which endpoint a Save posts to.
//
// Both halves are pure decisions over a roster row, so they drive with plain
// objects and no DOM beyond the button string.

import { describe, expect, it, vi } from 'vitest';
import {
  editAppearanceButtonHtml,
  type RedesignEligibilityRow,
  RedesignSubmitRouter,
  redesignCreditsOnRow,
  redesignRouteFor,
  showsEditAppearance,
} from '../src/ui/charselect_edit_appearance';

const row = (overrides: Partial<RedesignEligibilityRow> = {}): RedesignEligibilityRow => ({
  name: 'Hero',
  ...overrides,
});

describe('redesign eligibility', () => {
  it('shows Edit Appearance from one credit and up', () => {
    expect(showsEditAppearance(row({ redesignCredits: 1 }))).toBe(true);
    expect(showsEditAppearance(row({ redesignCredits: 7 }))).toBe(true);
  });

  it('hides it with no credit, which is what an absent field means', () => {
    expect(showsEditAppearance(row())).toBe(false);
    expect(showsEditAppearance(row({ redesignCredits: 0 }))).toBe(false);
  });

  it('reads a hostile wire count defensively', () => {
    // The roster body is untrusted the same way persisted JSON is.
    expect(redesignCreditsOnRow(row({ redesignCredits: -3 }))).toBe(0);
    expect(redesignCreditsOnRow(row({ redesignCredits: Number.NaN }))).toBe(0);
    expect(redesignCreditsOnRow(row({ redesignCredits: 2.9 }))).toBe(2);
    expect(redesignCreditsOnRow(row({ redesignCredits: '5' as unknown as number }))).toBe(0);
  });

  it('prefers the FREE token over a paid credit when a character holds both', () => {
    // Charging for something the player already owns for free is the failure
    // this ordering exists to prevent. The credit is untouched by the token
    // route, so nothing is lost by spending the freebie first.
    const both = row({ redesignCredits: 3, appearanceRerollAvailable: true });
    expect(redesignRouteFor(both)).toBe('token');
    // ...and the paid button does NOT render, so the row never offers one
    // action under two names.
    expect(showsEditAppearance(both)).toBe(false);
    expect(editAppearanceButtonHtml(both)).toBe('');
  });

  it('routes to the credit endpoint when only credits apply, and to nothing when neither does', () => {
    expect(redesignRouteFor(row({ redesignCredits: 1 }))).toBe('credit');
    expect(redesignRouteFor(row({ appearanceRerollAvailable: true }))).toBe('token');
    expect(redesignRouteFor(row())).toBeNull();
  });

  it('renders a button only when eligible', () => {
    expect(editAppearanceButtonHtml(row())).toBe('');
    const html = editAppearanceButtonHtml(row({ redesignCredits: 2 }));
    expect(html).toContain('edit-appearance-btn');
    expect(html).toContain('aria-label=');
  });
});

describe('RedesignSubmitRouter', () => {
  const deps = () => ({
    saveWithFreeToken: vi.fn(async () => ({})),
    saveWithCredit: vi.fn(async () => ({})),
  });

  it('posts to the credit endpoint for a credit-only character', async () => {
    const d = deps();
    const router = new RedesignSubmitRouter(d);
    router.noteOpen(row({ redesignCredits: 1 }));
    await router.submit(5, { hair: 'x' }, true);
    expect(d.saveWithCredit).toHaveBeenCalledWith(5, { hair: 'x' }, true);
    expect(d.saveWithFreeToken).not.toHaveBeenCalled();
  });

  it('posts to the free-token endpoint for a legacy character', async () => {
    const d = deps();
    const router = new RedesignSubmitRouter(d);
    router.noteOpen(row({ appearanceRerollAvailable: true }));
    await router.submit(5, { hair: 'x' }, false);
    expect(d.saveWithFreeToken).toHaveBeenCalledWith(5, { hair: 'x' }, false);
    expect(d.saveWithCredit).not.toHaveBeenCalled();
  });

  it('saves to the route latched at OPEN, not the row as it looks at save time', async () => {
    // The race this exists to close: the editor is opened on a free-token
    // character, a roster refresh lands mid-edit and the row now reads
    // credit-only, and Save must STILL post the free endpoint the player was
    // offered rather than silently charging a credit.
    const d = deps();
    const router = new RedesignSubmitRouter(d);
    router.noteOpen(row({ appearanceRerollAvailable: true }));
    // ...roster refresh happens here; nothing re-notes the router...
    await router.submit(5, { hair: 'x' }, false);
    expect(d.saveWithFreeToken).toHaveBeenCalledTimes(1);
    expect(d.saveWithCredit).not.toHaveBeenCalled();
  });

  it('throws rather than guessing when nothing was latched', async () => {
    const d = deps();
    const router = new RedesignSubmitRouter(d);
    await expect(router.submit(5, {}, false)).rejects.toThrow(/never latched/);
    // Neither endpoint was called: guessing would either charge a credit nobody
    // agreed to or burn a one-shot freebie.
    expect(d.saveWithCredit).not.toHaveBeenCalled();
    expect(d.saveWithFreeToken).not.toHaveBeenCalled();
  });

  it('clears the latch on success, so a second save cannot reuse it', async () => {
    const d = deps();
    const router = new RedesignSubmitRouter(d);
    router.noteOpen(row({ redesignCredits: 2 }));
    await router.submit(5, {}, false);
    expect(router.pendingRoute).toBeNull();
    await expect(router.submit(5, {}, false)).rejects.toThrow(/never latched/);
    expect(d.saveWithCredit).toHaveBeenCalledTimes(1);
  });

  it('KEEPS the latch when the save fails, so a retry uses the same route', async () => {
    // charselect_redesign.ts leaves the editor open with its draft on a rejected
    // save; the retry must post the endpoint the player was offered.
    const d = deps();
    d.saveWithCredit.mockRejectedValueOnce(new Error('network'));
    const router = new RedesignSubmitRouter(d);
    router.noteOpen(row({ redesignCredits: 1 }));
    await expect(router.submit(5, {}, false)).rejects.toThrow('network');
    expect(router.pendingRoute).toBe('credit');
    await router.submit(5, {}, false);
    expect(d.saveWithCredit).toHaveBeenCalledTimes(2);
  });

  it('clear() drops the latch on cancel', () => {
    const router = new RedesignSubmitRouter(deps());
    router.noteOpen(row({ redesignCredits: 1 }));
    router.clear();
    expect(router.pendingRoute).toBeNull();
  });
});
