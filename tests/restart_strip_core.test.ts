// The restart strip's pure core (src/ui/restart_strip_core.ts): the one
// decision table for what the strip shows.

import { describe, expect, it } from 'vitest';
import { restartStripState } from '../src/ui/restart_strip_core';

const base = { pending: true, dirty: false, busy: false, phase: 'idle' as const };

describe('restartStripState', () => {
  it('is hidden when nothing is pending, whatever else is going on', () => {
    expect(restartStripState({ ...base, pending: false })).toBe('hidden');
    expect(restartStripState({ ...base, pending: false, phase: 'failed' })).toBe('hidden');
    expect(restartStripState({ ...base, pending: false, phase: 'restarting' })).toBe('hidden');
  });

  it('offers the restart once something is pending and the panel is settled', () => {
    expect(restartStripState(base)).toBe('ready');
  });

  it("yields to the host panel's own Apply: hidden while dirty or busy", () => {
    expect(restartStripState({ ...base, dirty: true })).toBe('hidden');
    expect(restartStripState({ ...base, busy: true })).toBe('hidden');
    // Even mid-request: a panel that went busy owns the moment.
    expect(restartStripState({ ...base, busy: true, phase: 'restarting' })).toBe('hidden');
  });

  it('follows the request phase: restarting, then failed re-offers with the reason', () => {
    expect(restartStripState({ ...base, phase: 'restarting' })).toBe('restarting');
    expect(restartStripState({ ...base, phase: 'failed' })).toBe('failed');
  });
});
