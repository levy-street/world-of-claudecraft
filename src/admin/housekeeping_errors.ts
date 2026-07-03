// Reverse-matcher for the housekeeping validation diagnostics. The server
// surfaces src/sim/game_config.ts validation lines ("mobs.wolf: invalid
// hpBase", "camps: unknown camp index 9", ...) as saved-document warnings and
// boot warnings; like localizeAdminError, this re-renders each recognized
// shape through t() so operators read localized prose. The leading path
// ("mobs.wolf") and any id/field tokens are identifiers and stay raw; an
// unrecognized line falls through to English on purpose (code-diagnostic
// fall-through, the same principle as ADMIN_ERROR_KEYS).

import { t } from './i18n';

// detail (after the first ": ") -> catalog key, for the fixed shapes.
const EXACT_DETAILS: Record<string, string> = {
  'not an object': 'hkDiag.notAnObject',
  'override is not an object': 'hkDiag.overrideNotAnObject',
  'minLevel > maxLevel': 'hkDiag.minAboveMax',
  'loot entry is not an object': 'hkDiag.lootEntryNotAnObject',
  'loot entry needs a chance in 0..1': 'hkDiag.lootEntryChance',
  'loot entry needs an itemId or copper': 'hkDiag.lootEntryEmpty',
  'invalid loot copper': 'hkDiag.invalidLootCopper',
  'invalid loot rollGroup': 'hkDiag.invalidLootRollGroup',
  'invalid retired': 'hkDiag.invalidRetired',
  'stats must be an object': 'hkDiag.statsNotAnObject',
  'invalid pos': 'hkDiag.invalidPos',
  'invalid center': 'hkDiag.invalidCenter',
  'override needs the anchoring mobId': 'hkDiag.campNeedsMobId',
  'vendorItems must be known item ids (max 40)': 'hkDiag.invalidVendorItems',
};

// Parameterized shapes, ordered specific-first. Each maps the captured tokens
// onto the key's placeholders.
const RULES: { re: RegExp; key: string; params: string[] }[] = [
  { re: /^unknown section (\S+)$/, key: 'hkDiag.unknownSection', params: ['value'] },
  { re: /^unknown (?:mob|quest|item|npc) (\S+)$/, key: 'hkDiag.unknownId', params: ['value'] },
  { re: /^unknown camp index (\S+)$/, key: 'hkDiag.unknownCampIndex', params: ['value'] },
  { re: /^unknown loot itemId (.+)$/, key: 'hkDiag.unknownLootItem', params: ['value'] },
  { re: /^unknown loot questId (.+)$/, key: 'hkDiag.unknownLootQuest', params: ['value'] },
  { re: /^unknown stat (\S+)$/, key: 'hkDiag.unknownStat', params: ['value'] },
  { re: /^invalid stat (\S+)$/, key: 'hkDiag.invalidStat', params: ['value'] },
  {
    re: /^loot must be an array of at most (\d+) entries$/,
    key: 'hkDiag.lootTooLong',
    params: ['value'],
  },
  {
    re: /^objectiveCounts must list (\d+) integers \((\d+)\.\.(\d+)\)$/,
    key: 'hkDiag.objectiveCounts',
    params: ['count', 'min', 'max'],
  },
  {
    re: /^must list (\d+) integers \((\d+)\.\.(\d+)\)$/,
    key: 'hkDiag.mustListIntegers',
    params: ['count', 'min', 'max'],
  },
  {
    re: /^expected mob (\S+) but the camp spawns (\S+) \(content changed; re-apply from the current list\)$/,
    key: 'hkDiag.campAnchorMismatch',
    params: ['expected', 'actual'],
  },
  // Generic field shape LAST so the specific "invalid loot copper" etc. win.
  { re: /^invalid (\S+)$/, key: 'hkDiag.invalidField', params: ['value'] },
];

function localizeDetail(detail: string): string | null {
  const exact = EXACT_DETAILS[detail];
  if (exact) return t(exact);
  for (const rule of RULES) {
    const match = rule.re.exec(detail);
    if (!match) continue;
    const params: Record<string, string> = {};
    rule.params.forEach((name, i) => {
      params[name] = match[i + 1];
    });
    return t(rule.key, params);
  }
  return null;
}

/**
 * Localize one game-config validation diagnostic. The "path: detail" prefix
 * (a section or section.id identifier) stays raw; the detail re-renders via
 * t(). Unrecognized lines return unchanged (English fall-through).
 */
export function localizeHkDiagnostic(line: string): string {
  const split = line.indexOf(': ');
  if (split === -1) return line;
  const path = line.slice(0, split);
  const detail = localizeDetail(line.slice(split + 2));
  return detail === null ? line : `${path}: ${detail}`;
}
