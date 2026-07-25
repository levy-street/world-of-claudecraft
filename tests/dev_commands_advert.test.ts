import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from '../src/net/online';

// The /dev GUI used to be gated purely on import.meta.env.DEV, the CLIENT BUILD
// type. A hosted dev/PBE realm serves a production bundle, so the window was
// invisible exactly where testers needed it and characters had to be geared
// straight from the database. The realm now advertises its ALLOW_DEV_COMMANDS
// posture on /api/status and the client reads it.
//
// Security note pinned below: the advert only ever REVEALS a surface. Every
// dev_* command is re-gated server-side per message, so a forged advert opens an
// inert window and grants nothing.

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('dev command capability advert (client)', () => {
  it('reads dev_commands true off /api/status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, realm: 'Claudemoon', dev_commands: true }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new Api();

    await expect(api.devCommandsAdvert()).resolves.toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/status');
  });

  it('reads dev_commands false off /api/status', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ ok: true, realm: 'Claudemoon', dev_commands: false })),
    );
    await expect(new Api().devCommandsAdvert()).resolves.toBe(false);
  });

  // An older realm predates the field entirely. Absent must read as OFF, never as
  // "unknown so assume yes".
  it('treats a missing dev_commands field as off', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ ok: true, realm: 'Claudemoon' })),
    );
    await expect(new Api().devCommandsAdvert()).resolves.toBe(false);
  });

  // Strict equality, not truthiness: a realm answering a string must not light the
  // surface, mirroring the server's own `=== '1'` gate.
  it('requires a real boolean true, not a truthy value', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ ok: true, dev_commands: 'yes' })),
    );
    await expect(new Api().devCommandsAdvert()).resolves.toBe(false);
  });

  it('fails closed when the status request rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(new Api().devCommandsAdvert()).resolves.toBe(false);
  });
});

// Source-level contract pins. The wiring lives in main.ts (a 6k-line entry the
// suite cannot boot) and hud.ts, so these assert the seam rather than the paint.
describe('dev command advert wiring', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(repoRoot, 'src/main.ts'), 'utf8');
  const hud = fs.readFileSync(path.join(repoRoot, 'src/ui/hud.ts'), 'utf8');

  it('keeps the build-time flag as the offline/local-dev source', () => {
    // Unchanged on purpose: `npm run dev` and offline play must keep working with
    // no server to ask. The advert is strictly additive.
    expect(main).toContain('devCommandsEnabled: import.meta.env.DEV');
  });

  it('latches the realm advert onto the hud when online', () => {
    expect(main).toContain('api.devCommandsAdvert().then((enabled) => {');
    expect(main).toContain('hud.noteDevCommandsAdvertised();');
  });

  it('gates the "/dev gui" chat hook on the combined flag, not the build flag', () => {
    // The regression this file exists to prevent: re-pinning the chat hook to
    // import.meta.env.DEV would re-strand every hosted-realm tester.
    expect(main).toContain('if (hud.devCommandsAvailable && isDevGuiCommand(raw))');
    expect(main).not.toContain('if (import.meta.env.DEV && isDevGuiCommand(raw))');
  });

  it('feeds the window and the chat hook from ONE source of truth', () => {
    // Two independent gates could drift into a window that opens but whose commands
    // are refused, or a chat verb that works while the window claims unavailable.
    expect(hud).toContain('available: () => this.devCommandsAvailable');
    expect(hud).toContain(
      'return this.features.devCommandsEnabled === true || this.devCommandsAdvertised;',
    );
  });

  it('starts dark and only ever latches on', () => {
    expect(hud).toContain('private devCommandsAdvertised = false;');
    // One-way: no path sets it back to true from a false advert or vice versa,
    // so a mid-session status blip cannot toggle the surface.
    expect(hud).toContain(
      'noteDevCommandsAdvertised(): void {\n    this.devCommandsAdvertised = true;',
    );
  });
});
