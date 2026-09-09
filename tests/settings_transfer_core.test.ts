// The pure envelope behind the options window's export/import codes
// (src/ui/settings_transfer_core.ts): round-trips, the key ALLOWLIST that
// keeps a pasted code from planting arbitrary localStorage keys, and the
// three distinct rejections (not a code, wrong kind, nothing usable).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildTransferCode,
  parseTransferCode,
  TRANSFER_CODE_MAX_CHARS,
  TRANSFER_MAX_ENTRIES,
  TRANSFER_VALUE_MAX_CHARS,
  transferKeyAllowed,
} from '../src/ui/settings_transfer_core';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

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
const FULL_ENTRIES = {
  ...SETTINGS_ENTRIES,
  'woc_keybinds:char:12': '{"jump":["KeyY",null]}',
  'woc_keybinds:offline:warrior:Bob': '{}',
  woc_gamepad: '{"a":"jump"}',
  'woc_gamepad_xhb:char:12': '{}',
  woc_gamepad_xhb_claimed: '1',
  'woc_aura_overlays:char:12': '{}',
  woc_emote_wheel_warrior_Bob: '["wave"]',
  woc_deed_watch_warrior_Bob: '[]',
  woc_reliquary_pins_warrior_Bob: '[]',
  'woc_spawn_intro_seen:char:12': '1',
  woc_player_frame_pos_hidden: '1',
  woc_layout_reset_epoch: '1',
  chatTimestamps: '1',
  clock24h: '1',
  minimapZoom: '2',
  woc_bag_filter: 'all',
  ev_music_on: '0',
  locale: 'de_DE',
  woc_perf_overlay: '{}',
  'wocc.charSort': 'level',
  'woc.tutorial.v1': '1',
  woc_gpu_notice_dismissed: '1',
  woc_keyboard_layout: 'tkl',
  woc_keyboard_legends: 'qwerty',
};

describe('settings_transfer_core', () => {
  it('round-trips a frames code, a settings code and a full code', () => {
    for (const [kind, entries] of [
      ['frames', FRAME_ENTRIES],
      ['settings', SETTINGS_ENTRIES],
      ['full', FULL_ENTRIES],
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
      expect(transferKeyAllowed('full', hostile)).toBe(false);
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
      'woc_meters_frame_heal',
      'woc_meters_frame_threat',
      'woc_meters_detached',
      'woc_target_auras_frame',
      'woc_warlock_doom_frame_pos',
      'woc_warlock_doom_frame_pos_hidden',
    ] as const;
    for (const key of frameKeys) {
      expect(transferKeyAllowed('frames', key), key).toBe(true);
    }
    // And the boundary holds: a non-frame settings-family key stays refused,
    // and so does the RETIRED pre-frames tabbed-meter key (its box rides the
    // damageMeter registry row's woc_hud_frame_meters key now, so admitting
    // the dead key would resurrect stale boxes from old layout codes).
    expect(transferKeyAllowed('frames', 'woc_keybinds')).toBe(false);
    expect(transferKeyAllowed('frames', 'woc_meters_frame')).toBe(false);
  });

  it('the full kind carries every preference family and still no identity, purchase or cache key', () => {
    for (const key of Object.keys(FULL_ENTRIES))
      expect(transferKeyAllowed('full', key), key).toBe(true);
    // The exact FULL_KEYS literals, pinned here so dropping one from the
    // allowlist (silently orphaning that preference on import) fails.
    for (const key of [
      'woc_gamepad',
      'woc_gamepad_xhb',
      'woc_gamepad_xhb_claimed',
      'woc_player_frame_pos_hidden',
      'woc_target_frame_pos_hidden',
      'woc_party_frame_pos_hidden',
      'woc_layout_reset_epoch',
      'chatTimestamps',
      'chatClock',
      'clock24h',
      'minimapZoom',
      'woc_bag_filter',
      'woc_bank_filter',
      'woc_crafting_tab',
      'woc_guild_hide_offline',
      'woc_party_collapsed',
      'woc_haptics_on',
      'ev_music_on',
      'woc_homepage_music_muted',
      'locale',
      'woc_native_auto_locale',
      'paladinDevotionAnchor',
      'procOverlayAnchor',
      'woc_perf_overlay',
      'wocc.charSort',
      'woc.tutorial.v1',
      'woc.ferrybellhint.v1',
      'woc_unsupported_browser_dismissed',
      'woc_gpu_notice_dismissed',
      'woc_gpu_notice_hybrid_dismissed',
      'woc_perf_nudge_dismissed',
      'woc_keyboard_layout',
      'woc_keyboard_legends',
    ]) {
      expect(transferKeyAllowed('full', key), key).toBe(true);
      expect(transferKeyAllowed('settings', key), key).toBe(false);
    }
    // The families the narrower kinds never carried: per-character keybinds
    // and controller binds are the ones players most often lose between devices.
    for (const key of ['woc_keybinds:char:12', 'woc_gamepad', 'woc_gamepad_xhb:char:12']) {
      expect(transferKeyAllowed('settings', key), key).toBe(false);
      expect(transferKeyAllowed('frames', key), key).toBe(false);
    }
    // Identity, session, wallet, purchase, attribution and cache keys stay out
    // even of the widest kind; `woc_` is never a prefix.
    for (const forbidden of [
      'woc_session',
      'woc_active_play',
      'woc_purchase_intents_warrior_Bob',
      'woc_first_touch_v1',
      'woc_site_visitor_id',
      'woc.wallet.standard.selectedWallet',
      'woc.wallet.mobile.v1.session.phantom',
      'woc_native_discord_verifier',
      'woc_seed',
      'woc_cached_stats',
      'woc_last_realm',
      'woc_entry_probe',
      'woc_hotbar_warrior_Bob',
      'woc_editor_maps',
      'claudecraft_admin_token',
      'woc_keybindsX',
      'woc_gamepad_xhbX',
    ]) {
      expect(transferKeyAllowed('full', forbidden), forbidden).toBe(false);
    }
    // A crafted full code smuggling a session is stripped on parse.
    const crafted = JSON.stringify({
      woc: 'woc-transfer',
      v: 1,
      kind: 'full',
      data: { ...FULL_ENTRIES, woc_session: 'stolen', woc_purchase_intents_warrior_Bob: '{}' },
    });
    expect(parseTransferCode('full', crafted)).toEqual({ ok: true, entries: FULL_ENTRIES });
  });

  it('kinds are strict supersets: a full code fills any box, a narrower code never fills a wider one', () => {
    const fullCode = buildTransferCode('full', FULL_ENTRIES);
    expect(parseTransferCode('frames', fullCode)).toEqual({ ok: true, entries: FRAME_ENTRIES });
    expect(parseTransferCode('settings', fullCode)).toEqual({
      ok: true,
      entries: SETTINGS_ENTRIES,
    });
    expect(parseTransferCode('full', buildTransferCode('settings', SETTINGS_ENTRIES))).toEqual({
      ok: false,
      reason: 'kind',
    });
    expect(parseTransferCode('full', buildTransferCode('frames', FRAME_ENTRIES))).toEqual({
      ok: false,
      reason: 'kind',
    });
    // An unknown kind is a mismatch, not a crash, and a prototype name is no kind.
    for (const kind of ['alien', 'constructor', 'toString', '__proto__']) {
      const alien = JSON.stringify({ woc: 'woc-transfer', v: 1, kind, data: FRAME_ENTRIES });
      expect(parseTransferCode('frames', alien), kind).toEqual({ ok: false, reason: 'kind' });
    }
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

  it('refuses a code that could fill the storage quota', () => {
    // One oversized value, too many prefixed keys, or an oversized paste are
    // all malformed: a real export is tens of kilobytes at most.
    const fat = JSON.stringify({
      woc: 'woc-transfer',
      v: 1,
      kind: 'frames',
      data: { woc_chat_geometry: 'x'.repeat(TRANSFER_VALUE_MAX_CHARS + 1) },
    });
    expect(parseTransferCode('frames', fat)).toEqual({ ok: false, reason: 'format' });
    // Entry count: exactly at the cap imports, one past it is refused.
    const atCap: Record<string, string> = {};
    for (let i = 0; i < TRANSFER_MAX_ENTRIES; i++) atCap[`woc_keybinds:char:${i}`] = '{}';
    expect(
      parseTransferCode(
        'full',
        JSON.stringify({ woc: 'woc-transfer', v: 1, kind: 'full', data: atCap }),
      ).ok,
    ).toBe(true);
    atCap[`woc_keybinds:char:${TRANSFER_MAX_ENTRIES}`] = '{}';
    expect(
      parseTransferCode(
        'full',
        JSON.stringify({ woc: 'woc-transfer', v: 1, kind: 'full', data: atCap }),
      ),
    ).toEqual({ ok: false, reason: 'format' });
    // Total size: the SAME valid, allowlisted code just under the cap parses
    // and just over it is refused, so the guard (not JSON.parse) is what the
    // pin exercises.
    // The padding is spread over several frame keys so each value stays under
    // its own cap and only the TOTAL bound decides.
    const padded = (total: number) => {
      const keys = [
        'woc_hud_frame_a',
        'woc_hud_frame_b',
        'woc_hud_frame_c',
        'woc_hud_frame_d',
        'woc_hud_frame_e',
      ];
      const data: Record<string, string> = {};
      for (const k of keys) data[k] = '';
      const shell = JSON.stringify({ woc: 'woc-transfer', v: 1, kind: 'frames', data });
      let room = total - shell.length;
      for (const k of keys) {
        const take = Math.min(room, TRANSFER_VALUE_MAX_CHARS);
        data[k] = 'x'.repeat(take);
        room -= take;
      }
      const code = JSON.stringify({ woc: 'woc-transfer', v: 1, kind: 'frames', data });
      expect(code.length).toBe(total);
      return code;
    };
    expect(parseTransferCode('frames', padded(TRANSFER_CODE_MAX_CHARS)).ok).toBe(true);
    expect(parseTransferCode('frames', padded(TRANSFER_CODE_MAX_CHARS + 1))).toEqual({
      ok: false,
      reason: 'format',
    });
    // A value right at the per-value cap still imports.
    const ok = JSON.stringify({
      woc: 'woc-transfer',
      v: 1,
      kind: 'frames',
      data: { woc_chat_geometry: 'x'.repeat(TRANSFER_VALUE_MAX_CHARS) },
    });
    expect(parseTransferCode('frames', ok).ok).toBe(true);
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

  it('refuses every woc* storage literal under src/ that is not an expected export (the durable sweep)', () => {
    // The allowlist admits prefixes, so a hand-written forbidden list rots: a
    // future woc_chat_relay_token would ride the woc_chat_ prefix with the
    // suite green. Enumerate every woc* string literal in the client tree and
    // require each one that the FULL tier admits to be on this explicit list.
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
    const EXPECTED_EXPORTABLE = new Set([
      'woc_settings',
      'woc_theme',
      'woc_keybinds',
      'woc_gamepad',
      'woc_gamepad_xhb',
      'woc_gamepad_xhb_claimed',
      'woc_mobile_chat_bottom',
      'woc_chat_geometry',
      'woc_chat_tabs',
      'woc_chat_active_tab',
      'woc_player_frame_pos',
      'woc_target_frame_pos',
      'woc_party_frame_pos',
      'woc_meters_frame_heal',
      'woc_meters_frame_threat',
      'woc_meters_detached',
      'woc_target_auras_frame',
      'woc_target_auras_filter',
      'woc_target_auras_visible',
      'woc_target_auras_visible_rows',
      'woc_target_auras_show_sources',
      'woc_target_auras_opacity',
      'woc_warlock_doom_frame_pos',
      'woc_warlock_doom_frame_pos_hidden',
      'woc_player_frame_pos_hidden',
      'woc_target_frame_pos_hidden',
      'woc_party_frame_pos_hidden',
      'woc_layout_reset_epoch',
      'woc_bag_filter',
      'woc_bank_filter',
      'woc_crafting_tab',
      'woc_guild_hide_offline',
      'woc_party_collapsed',
      'woc_haptics_on',
      'woc_homepage_music_muted',
      'woc_native_auto_locale',
      'woc_perf_overlay',
      'woc_unsupported_browser_dismissed',
      'woc_gpu_notice_dismissed',
      'woc_gpu_notice_hybrid_dismissed',
      'woc_perf_nudge_dismissed',
      'woc_keyboard_layout',
      'woc_keyboard_legends',
      'woc.tutorial.v1',
      'woc.ferrybellhint.v1',
      'wocc.charSort',
      // Prefix heads as they appear in source (template literal openings).
      'woc_hud_frame_',
      'woc_keybinds:',
      'woc_gamepad_xhb:',
      'woc_aura_overlays:',
      'woc_emote_wheel_',
      'woc_deed_watch_',
      'woc_reliquary_pins_',
      'woc_spawn_intro_seen:',
      'woc_target_auras_',
      'woc_chat_',
    ]);
    const literalRe = /['"\x60](woc[A-Za-z0-9_.:-]*)/g;
    const admitted = new Set<string>();
    const files = tsFilesUnder(fileURLToPath(new URL('../src', import.meta.url)));
    expect(files.length).toBeGreaterThan(500);
    for (const { file, full } of files) {
      if (file.includes('i18n.') || file.includes('.generated.')) continue;
      const code = readFileSync(full, 'utf8');
      for (const m of code.matchAll(literalRe)) {
        const literal = m[1];
        // The frame registry's own family (interface_unlock_core.ts mints one
        // woc_hud_frame_<id> per movable frame) is prefix-governed by design;
        // every other admitted literal must be listed above.
        if (literal.startsWith('woc_hud_frame_')) continue;
        if (transferKeyAllowed('full', literal) && !EXPECTED_EXPORTABLE.has(literal))
          admitted.add(`${literal} (${file})`);
      }
    }
    expect([...admitted].sort()).toEqual([]);
    // Positive control: a key the allowlist would admit through a prefix but
    // which is not expected is exactly what the sweep reports.
    expect(transferKeyAllowed('full', 'woc_chat_relay_token')).toBe(true);
    expect(EXPECTED_EXPORTABLE.has('woc_chat_relay_token')).toBe(false);
  });
});
