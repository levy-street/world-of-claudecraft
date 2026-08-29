// The pure envelope behind the options window's export/import codes
// (src/ui/settings_transfer_core.ts): round-trips, the key ALLOWLIST that
// keeps a pasted code from planting arbitrary localStorage keys, and the
// three distinct rejections (not a code, wrong kind, nothing usable).
import { describe, expect, it } from 'vitest';
import {
  buildTransferCode,
  parseTransferCode,
  transferKeyAllowed,
} from '../src/ui/settings_transfer_core';

const FRAME_ENTRIES = {
  woc_hud_frame_minimap: '{"left":10,"top":20}',
  woc_hud_frame_minimap_hidden: '1',
  woc_player_frame_pos: '{"left":100,"top":900}',
  woc_chat_geometry: '{"w":420}',
};
const SETTINGS_ENTRIES = {
  ...FRAME_ENTRIES,
  woc_settings: '{"uiScale":1.15}',
  woc_theme: '{"preset":"ember"}',
  woc_keybinds: '{}',
  woc_target_auras_opacity: '0.8',
};

describe('settings_transfer_core', () => {
  it('round-trips a frames code and a settings code', () => {
    for (const [kind, entries] of [
      ['frames', FRAME_ENTRIES],
      ['settings', SETTINGS_ENTRIES],
    ] as const) {
      const parsed = parseTransferCode(kind, buildTransferCode(kind, entries));
      expect(parsed).toEqual({ ok: true, entries });
    }
  });

  it('the allowlist is the write boundary: foreign keys never survive either side', () => {
    // A session token, a prototype-pollution probe, an unrelated cache: none
    // of these may ride an import into localStorage.
    for (const hostile of ['woc_session', '__proto__', 'constructor', 'totally_unrelated']) {
      expect(transferKeyAllowed('frames', hostile)).toBe(false);
      expect(transferKeyAllowed('settings', hostile)).toBe(false);
    }
    const code = buildTransferCode('frames', { ...FRAME_ENTRIES, woc_session: 'stolen' });
    expect(code).not.toContain('woc_session');
    // A hand-crafted code smuggling a foreign key is stripped on parse too.
    const crafted = JSON.stringify({
      woc: 'woc-transfer',
      v: 1,
      kind: 'frames',
      data: { ...FRAME_ENTRIES, woc_session: 'stolen' },
    });
    const parsed = parseTransferCode('frames', crafted);
    expect(parsed).toEqual({ ok: true, entries: FRAME_ENTRIES });
  });

  it('the frames kind accepts only frame-geometry families', () => {
    // woc_settings is a settings-kind key: a FRAMES import must not touch it.
    expect(transferKeyAllowed('frames', 'woc_settings')).toBe(false);
    expect(transferKeyAllowed('frames', 'woc_hud_frame_swingbar')).toBe(true);
    expect(transferKeyAllowed('frames', 'woc_warlock_doom_frame_pos')).toBe(true);
    expect(transferKeyAllowed('settings', 'woc_settings')).toBe(true);
  });

  it('admits every key on the FRAME_KEYS allowlist for the frames kind', () => {
    // The full literal list from src/ui/settings_transfer_core.ts, pinned as
    // literals HERE on purpose: each is a persisted surface a frames-layout
    // import may write, so dropping one from the source allowlist (silently
    // orphaning that surface on import) fails this test instead of passing.
    const frameKeys = [
      'woc_player_frame_pos',
      'woc_target_frame_pos',
      'woc_party_frame_pos',
      'woc_chat_geometry',
      'woc_meters_frame',
      'woc_meters_frame_heal',
      'woc_meters_frame_threat',
      'woc_meters_detached',
      'woc_target_auras_frame',
      'woc_warlock_doom_frame_pos',
    ] as const;
    for (const key of frameKeys) {
      expect(transferKeyAllowed('frames', key), key).toBe(true);
    }
    // And the boundary holds: a non-frame settings-family key stays refused.
    expect(transferKeyAllowed('frames', 'woc_keybinds')).toBe(false);
  });

  it('rejects garbage as format, the reverse kind as kind, and a hollow code as empty', () => {
    expect(parseTransferCode('frames', 'not json')).toEqual({ ok: false, reason: 'format' });
    expect(parseTransferCode('frames', '{"data":{}}')).toEqual({ ok: false, reason: 'format' });
    // A frames code cannot fill a settings import ...
    const framesCode = buildTransferCode('frames', FRAME_ENTRIES);
    expect(parseTransferCode('settings', framesCode)).toEqual({ ok: false, reason: 'kind' });
    // ... but a settings code carries the frame families, so the frames box
    // accepts the superset direction.
    const settingsCode = buildTransferCode('settings', SETTINGS_ENTRIES);
    expect(parseTransferCode('frames', settingsCode)).toEqual({ ok: true, entries: FRAME_ENTRIES });
    // A valid envelope with nothing this build accepts is empty, not a no-op
    // "success" that imported zero keys.
    const hollow = JSON.stringify({
      woc: 'woc-transfer',
      v: 1,
      kind: 'frames',
      data: { nope: '1' },
    });
    expect(parseTransferCode('frames', hollow)).toEqual({ ok: false, reason: 'empty' });
  });

  it('drops non-string values rather than writing objects into storage', () => {
    const crafted = JSON.stringify({
      woc: 'woc-transfer',
      v: 1,
      kind: 'frames',
      data: { woc_player_frame_pos: { left: 1 }, woc_chat_geometry: '{"w":1}' },
    });
    expect(parseTransferCode('frames', crafted)).toEqual({
      ok: true,
      entries: { woc_chat_geometry: '{"w":1}' },
    });
  });
});
