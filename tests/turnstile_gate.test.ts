// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/net/online', () => ({ DESKTOP_APP: false }));

// Cloudflare's api.js used to load with every page from a <script> in the head; it now
// loads the first time the login form asks for the widget.

async function importGate() {
  vi.resetModules();
  vi.stubEnv('VITE_TURNSTILE_SITEKEY', 'site-key-under-test');
  return import('../src/game/turnstile_gate');
}

function scriptTags(url: string): number {
  return document.head.querySelectorAll(`script[src="${url}"]`).length;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  delete (window as unknown as { turnstile?: unknown }).turnstile;
});

describe('ensureTurnstile', () => {
  it('adds the api.js tag once, on the first ask, and renders once it is ready', async () => {
    vi.useFakeTimers();
    const gate = await importGate();
    document.body.innerHTML = '<div id="cf-turnstile-container"></div>';
    expect(scriptTags(gate.TURNSTILE_SCRIPT_URL)).toBe(0);

    gate.ensureTurnstile();
    expect(scriptTags(gate.TURNSTILE_SCRIPT_URL)).toBe(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(scriptTags(gate.TURNSTILE_SCRIPT_URL)).toBe(1);

    const render = vi.fn(() => 'widget-1');
    (window as unknown as { turnstile: unknown }).turnstile = {
      render,
      getResponse: () => 'token',
      reset: vi.fn(),
    };
    await vi.advanceTimersByTimeAsync(200);
    expect(render).toHaveBeenCalledTimes(1);
    expect(gate.turnstileToken()).toBe('token');
  });

  it('loads nothing when no site key is configured', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_TURNSTILE_SITEKEY', '');
    const gate = await import('../src/game/turnstile_gate');
    gate.ensureTurnstile();
    expect(scriptTags(gate.TURNSTILE_SCRIPT_URL)).toBe(0);
  });

  it('is no longer in the entry documents', () => {
    for (const entry of ['index.html', 'play.html']) {
      // A plain path: under happy-dom the global URL is the DOM's, which fs does not read.
      const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', entry), 'utf8');
      expect(html, entry).not.toContain('challenges.cloudflare.com/turnstile');
    }
  });
});
