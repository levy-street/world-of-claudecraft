import { describe, expect, it } from 'vitest';
import { HeroicVendorOperationState } from '../src/ui/hud/vendor/heroic_vendor_pending_core';

describe('HeroicVendorOperationState', () => {
  it('treats a rejection as terminal so another request can begin', () => {
    const state = new HeroicVendorOperationState();

    expect(state.begin('forge', 'Forging...')).toBe(true);
    expect(state.begin('tune', 'Tuning...')).toBe(false);
    expect(state.reject('Your bags are full.')).toBe(true);
    expect(state).toMatchObject({ pending: null, status: 'Your bags are full.' });
    expect(state.begin('forge', 'Forging...')).toBe(true);
  });

  it('resolves the pending tab and preserves pending copy across tab inspection', () => {
    const state = new HeroicVendorOperationState();
    state.begin('tune', 'Tuning...');

    state.clearStatus();
    expect(state.status).toBe('Tuning...');
    expect(state.resolve('Legendary tuned.')).toBe(true);
    expect(state).toMatchObject({ pending: null, status: 'Legendary tuned.' });

    state.clearStatus();
    expect(state.status).toBeNull();
  });

  it('ignores unrelated terminal events and resets on a fresh window session', () => {
    const state = new HeroicVendorOperationState();
    expect(state.reject('Unrelated error')).toBe(false);
    expect(state.resolve('Unrelated success')).toBe(false);
    state.begin('gear', 'Buying...');
    state.reset();
    expect(state).toMatchObject({ pending: null, status: null });
  });
});
