import type { PluginScreenFlag } from './types';

// Pure helpers for the plugin store moderation page (pages/Plugins.svelte):
// review-request shaping + validation, screen-flag ordering for display, and the
// status / category to i18n-key mapping. Host-agnostic and side-effect-free (the
// moderation_actions.ts pattern) so tests/admin/plugin_review.test.ts exercises
// endpoint, body, and validation directly in plain Node; the page performs the
// apiPost after the operator confirms.

export type PluginReviewAction = 'approve' | 'reject';

export interface PluginReviewRequest {
  endpoint: string;
  body: { action: PluginReviewAction; note?: string };
}

export type BuiltReview = { request: PluginReviewRequest } | { errorKey: string };

// Mirrors MAX_NOTES_LENGTH in server/plugins.ts: a longer note comes back as
// invalid_review_note, so refuse it client-side with a clearer message.
export const REVIEW_NOTE_MAX_LENGTH = 1000;

// A rejection without a note gives the author nothing to fix, so the note is
// required client-side for 'reject'; an approval note stays optional. The note
// is trimmed and omitted from the body entirely when empty.
export function buildReviewRequest(
  versionId: number,
  action: PluginReviewAction,
  rawNote: string,
): BuiltReview {
  const note = rawNote.trim();
  if (action === 'reject' && note === '') return { errorKey: 'alert.pluginRejectNoteRequired' };
  if (note.length > REVIEW_NOTE_MAX_LENGTH) return { errorKey: 'alert.pluginReviewNoteTooLong' };
  return {
    request: {
      endpoint: `/admin/api/plugins/versions/${versionId}/review`,
      body: note === '' ? { action } : { action, note },
    },
  };
}

// Display order for the screen-flag chips: the scarier classes first, mirroring
// the rule order in server/plugin_screen.ts.
const FLAG_ORDER: readonly string[] = [
  'dynamic-code',
  'network',
  'browser-storage',
  'global-dom',
  'credential-text',
  'obfuscation',
];

const FLAG_LABEL_KEYS: Record<string, string> = {
  'dynamic-code': 'plugins.flag.dynamicCode',
  network: 'plugins.flag.network',
  'browser-storage': 'plugins.flag.browserStorage',
  'global-dom': 'plugins.flag.globalDom',
  'credential-text': 'plugins.flag.credentialText',
  obfuscation: 'plugins.flag.obfuscation',
};

export interface PluginFlagChip {
  code: string;
  line: number;
  // i18n key for the human label; null for a code this build does not know yet,
  // so the page renders the raw code and a new server rule still surfaces.
  labelKey: string | null;
}

// Orders flags scariest-first for the warning chips: known codes in FLAG_ORDER,
// then unknown codes in arrival order. Defensive against duplicates (the server
// emits at most one flag per code): the lowest line per code wins.
export function flagsSummary(screen: readonly PluginScreenFlag[]): PluginFlagChip[] {
  const lineByCode = new Map<string, number>();
  for (const flag of screen) {
    const existing = lineByCode.get(flag.code);
    if (existing === undefined || flag.line < existing) lineByCode.set(flag.code, flag.line);
  }
  const chips: PluginFlagChip[] = [];
  for (const code of FLAG_ORDER) {
    const line = lineByCode.get(code);
    if (line === undefined) continue;
    chips.push({ code, line, labelKey: FLAG_LABEL_KEYS[code] });
    lineByCode.delete(code);
  }
  for (const [code, line] of lineByCode) chips.push({ code, line, labelKey: null });
  return chips;
}

const STATUS_KEYS: Record<string, string> = {
  pending: 'plugins.status.pending',
  listed: 'plugins.status.listed',
  delisted: 'plugins.status.delisted',
};

export function pluginStatusKey(status: string): string {
  return STATUS_KEYS[status] ?? 'plugins.status.unknown';
}

export type PluginStatusVariant = 'warn' | 'success' | 'bad' | 'neutral';

export function pluginStatusVariant(status: string): PluginStatusVariant {
  if (status === 'listed') return 'success';
  if (status === 'delisted') return 'bad';
  if (status === 'pending') return 'warn';
  return 'neutral';
}

const CATEGORY_KEYS: Record<string, string> = {
  combat: 'plugins.category.combat',
  economy: 'plugins.category.economy',
  social: 'plugins.category.social',
  interface: 'plugins.category.interface',
  tools: 'plugins.category.tools',
};

// i18n key for a known category, null for one this build does not know
// (the page falls back to the raw id, the classLabel pattern).
export function pluginCategoryKey(category: string): string | null {
  return CATEGORY_KEYS[category] ?? null;
}
