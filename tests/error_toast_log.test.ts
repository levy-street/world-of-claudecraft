import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ERROR_LOG_CHAN, ERROR_LOG_COLOR, shouldMirrorErrorToast } from '../src/ui/error_toast_log';

describe('error_toast_log: shouldMirrorErrorToast', () => {
  it('mirrors a normal error toast message', () => {
    expect(shouldMirrorErrorToast('You cannot do that yet.', undefined)).toBe(true);
    expect(shouldMirrorErrorToast('Out of range.', undefined)).toBe(true);
  });

  it('does not mirror an empty or whitespace-only toast', () => {
    expect(shouldMirrorErrorToast('', undefined)).toBe(false);
    expect(shouldMirrorErrorToast('   ', undefined)).toBe(false);
    expect(shouldMirrorErrorToast('\n\t', undefined)).toBe(false);
  });

  it('does not mirror the same text as the immediately preceding mirrored toast', () => {
    expect(shouldMirrorErrorToast('Out of range.', 'Out of range.')).toBe(false);
  });

  it('does mirror a different error even right after a repeat suppression', () => {
    expect(shouldMirrorErrorToast('Line of sight.', 'Out of range.')).toBe(true);
  });

  it('does mirror the same text again once a different one broke the streak', () => {
    expect(shouldMirrorErrorToast('Out of range.', 'Line of sight.')).toBe(true);
  });

  it('reuses the existing system chan (not a new channel)', () => {
    expect(ERROR_LOG_CHAN).toBe('system');
  });

  it('has a stable, non-empty log color', () => {
    expect(ERROR_LOG_COLOR).toMatch(/^#[0-9a-fA-F]{3,8}$/);
  });
});

// Source-level guard: pin that showError in hud.ts actually mirrors into the
// chat log via the existing log() (chan 'system', same as loot/level-up/death
// lines), guarded by shouldMirrorErrorToast, and that the on-screen toast's
// own timing (1600ms fade) is untouched by this change.
describe('hud.ts showError: mirrors into the chat log', () => {
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

  it('imports the pure error_toast_log helpers', () => {
    expect(hud).toContain("from './error_toast_log'");
  });

  it('calls log() with the mirrored text, guarded by shouldMirrorErrorToast', () => {
    const match = hud.match(/showError\(text: string\): void \{[\s\S]*?\n {2}\}/);
    expect(match, 'showError method not found').toBeTruthy();
    const body = match?.[0] ?? '';
    expect(body).toContain('shouldMirrorErrorToast(localized, this.lastMirroredErrorText)');
    expect(body).toContain('this.log(localized, ERROR_LOG_COLOR)');
  });

  it('tracks the last mirrored text so consecutive repeats are suppressed', () => {
    const match = hud.match(/showError\(text: string\): void \{[\s\S]*?\n {2}\}/);
    const body = match?.[0] ?? '';
    expect(body).toContain('this.lastMirroredErrorText = localized');
  });

  it('keeps the existing 1600ms toast fade timing unchanged', () => {
    const match = hud.match(/showError\(text: string\): void \{[\s\S]*?\n {2}\}/);
    const body = match?.[0] ?? '';
    expect(body).toContain('}, 1600);');
  });
});
