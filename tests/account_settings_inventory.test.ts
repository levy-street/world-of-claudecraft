import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { isAccountSettingsKey } from '../src/account_settings_contract';
import { transferKeyAllowed } from '../src/ui/settings_transfer_core';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

// Export/import deliberately includes character spell layouts, local hardware
// diagnostics and dismissed installation hints. Automatic account sync does not.
const LOCAL_KEYS = new Set([
  'woc_gamepad_xhb',
  'woc_gamepad_xhb_claimed',
  'woc_ignored_chat_names',
  'woc_native_auto_locale',
  'woc_perf_overlay',
  'wocc.charSort',
  'woc.tutorial.v1',
  'woc.ferrybellhint.v1',
  'woc_unsupported_browser_dismissed',
  'woc_gpu_notice_dismissed',
  'woc_gpu_notice_hybrid_dismissed',
  'woc_perf_nudge_dismissed',
  // Credentials, installation state, crash diagnostics and developer/editor data.
  'claudecraft_admin_name',
  'claudecraft_admin_theme',
  'claudecraft_admin_token',
  'ps_passing_stone',
  'woc.modularAppearance',
  'woc.modularArmorSet',
  'woc.wallet.standard.selectedWallet',
  'woc.welcome.lastSeenReleaseId',
  'woc_active_play',
  'woc_cached_stats',
  'woc_device_mem_gb',
  'woc_discord_choice',
  'woc_discord_cta_dismissed',
  'woc_discord_onboard',
  'woc_editor_autosave',
  'woc_editor_draft',
  'woc_editor_drafts_index',
  'woc_editor_maps',
  'woc_editor_maps_index',
  'woc_editor_playtest',
  'woc_editor_server_links',
  'woc_entry_last_recovery',
  'woc_entry_probe',
  'woc_entry_tight_mode',
  'woc_exchange_wallet_card_dismissed',
  'woc_first_touch_v1',
  'woc_frame_cadence_auto',
  'woc_graphics_rebuild_probe',
  'woc_last_realm',
  'woc_meters_active_profile_v1',
  'woc_meters_profiles_v1',
  'woc_meters_settings_v1',
  'woc_native_discord_verifier',
  'woc_perf',
  'woc_perf_session_id',
  'woc_seed',
  'woc_session',
  'woc_site_visitor_id',
]);
const LOCAL_PREFIXES = [
  'woc_keybinds:',
  'woc_gamepad_xhb:',
  'woc_aura_overlays:',
  'woc_cooldown_manager:',
  'woc_emote_wheel_',
  'woc_deed_watch_',
  'woc_reliquary_pins_',
  'woc_spawn_intro_seen:',
  'woc_account_settings_pending:',
  'nav:',
];
function classified(key: string): boolean {
  // Prefix heads are literal openings of computed storage keys.
  return (
    isAccountSettingsKey(key) ||
    isAccountSettingsKey(`${key}inventory_probe`) ||
    LOCAL_KEYS.has(key) ||
    LOCAL_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

/** Static storage arguments, including a module's const key and template head. */
function storageLiterals(code: string): Set<string> {
  const source = ts.createSourceFile('storage.ts', code, ts.ScriptTarget.Latest, true);
  const constants = new Map<string, string>();
  const value = (node: ts.Node | undefined): string | undefined => {
    if (!node) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) return node.head.text;
    if (ts.isIdentifier(node)) return constants.get(node.text);
  };
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const literal = value(node.initializer);
      if (literal) constants.set(node.name.text, literal);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  const result = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['getItem', 'setItem', 'removeItem'].includes(node.expression.name.text)
    ) {
      const literal = value(node.arguments[0]);
      if (literal) result.add(literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

describe('account preference storage inventory', () => {
  it('classifies storage and exportable preference literals as synced or explicitly local', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
    const files = tsFilesUnder(fileURLToPath(new URL('../src', import.meta.url)));
    expect(files.length).toBeGreaterThan(500);
    const missing = new Set<string>();
    for (const { file, full } of files) {
      if (file.includes('i18n.') || file.includes('.generated.')) continue;
      const code = readFileSync(full, 'utf8');
      for (const key of storageLiterals(code)) {
        if (!classified(key)) missing.add(`${key} (${file})`);
      }
      for (const match of code.matchAll(/['"\x60]([A-Za-z][A-Za-z0-9_.:-]*)/g)) {
        const key = match[1];
        if (transferKeyAllowed('full', key) && !classified(key)) missing.add(`${key} (${file})`);
      }
    }
    expect([...missing].sort()).toEqual([]);
    expect(classified('woc_future_preference')).toBe(false);
    expect(classified('woc_gamepad_xhb:char:7')).toBe(true);
    expect(isAccountSettingsKey('woc_gamepad_xhb:char:7')).toBe(false);
  }, 30_000);
  it('detects a new local preference before the export allowlist classifies it', () => {
    const keys = storageLiterals(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: This is source code parsed by the scanner fixture.
      "const KEY = 'new_preference'; function nested() { localStorage.setItem(KEY, '1'); localStorage.removeItem(`new_family_${id}`); }",
    );
    expect([...keys]).toEqual(['new_preference', 'new_family_']);
    expect([...keys].filter((key) => !classified(key))).toEqual(['new_preference', 'new_family_']);
  });
});
