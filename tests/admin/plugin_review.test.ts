import { describe, expect, it } from 'vitest';
import {
  buildReviewRequest,
  flagsSummary,
  pluginCategoryKey,
  pluginStatusKey,
  pluginStatusVariant,
  REVIEW_NOTE_MAX_LENGTH,
} from '../../src/admin/plugin_review';

// Pure request shaping + validation + display helpers for the plugin store
// moderation page. Runs in the default Node env (no DOM): pins the review
// endpoint/body, the reject-needs-a-note rule, the screen-flag display order,
// and the status/category i18n-key mapping.

describe('buildReviewRequest', () => {
  it('requires a non-empty note when rejecting so the author gets feedback', () => {
    expect(buildReviewRequest(7, 'reject', '')).toEqual({
      errorKey: 'alert.pluginRejectNoteRequired',
    });
    expect(buildReviewRequest(7, 'reject', '   \t ')).toEqual({
      errorKey: 'alert.pluginRejectNoteRequired',
    });
  });

  it('approves without a note and omits the note field entirely', () => {
    const built = buildReviewRequest(7, 'approve', '  ');
    if (!('request' in built)) throw new Error('expected request');
    expect(built.request.endpoint).toBe('/admin/api/plugins/versions/7/review');
    expect(built.request.body).toEqual({ action: 'approve' });
    expect('note' in built.request.body).toBe(false);
  });

  it('trims the note and sends it when present, for approve and reject', () => {
    const approve = buildReviewRequest(12, 'approve', '  looks clean  ');
    const reject = buildReviewRequest(12, 'reject', ' remove the fetch call ');
    if (!('request' in approve) || !('request' in reject)) throw new Error('expected request');
    expect(approve.request.body).toEqual({ action: 'approve', note: 'looks clean' });
    expect(reject.request.endpoint).toBe('/admin/api/plugins/versions/12/review');
    expect(reject.request.body).toEqual({ action: 'reject', note: 'remove the fetch call' });
  });

  it('refuses a note over the server cap client-side', () => {
    const long = 'x'.repeat(REVIEW_NOTE_MAX_LENGTH + 1);
    expect(buildReviewRequest(3, 'approve', long)).toEqual({
      errorKey: 'alert.pluginReviewNoteTooLong',
    });
    const atCap = buildReviewRequest(3, 'reject', 'x'.repeat(REVIEW_NOTE_MAX_LENGTH));
    expect('request' in atCap).toBe(true);
  });
});

describe('flagsSummary', () => {
  it('orders known codes scariest-first regardless of arrival order', () => {
    const chips = flagsSummary([
      { code: 'obfuscation', line: 40 },
      { code: 'network', line: 12 },
      { code: 'dynamic-code', line: 3 },
    ]);
    expect(chips.map((chip) => chip.code)).toEqual(['dynamic-code', 'network', 'obfuscation']);
    expect(chips.map((chip) => chip.labelKey)).toEqual([
      'plugins.flag.dynamicCode',
      'plugins.flag.network',
      'plugins.flag.obfuscation',
    ]);
    expect(chips[1].line).toBe(12);
  });

  it('maps every known screen code to a label key', () => {
    const chips = flagsSummary([
      { code: 'dynamic-code', line: 1 },
      { code: 'network', line: 2 },
      { code: 'browser-storage', line: 3 },
      { code: 'global-dom', line: 4 },
      { code: 'credential-text', line: 5 },
      { code: 'obfuscation', line: 6 },
    ]);
    expect(chips).toHaveLength(6);
    for (const chip of chips) expect(chip.labelKey).not.toBeNull();
  });

  it('keeps an unknown code visible after the known ones, with a null label key', () => {
    const chips = flagsSummary([
      { code: 'brand-new-rule', line: 9 },
      { code: 'network', line: 2 },
    ]);
    expect(chips.map((chip) => chip.code)).toEqual(['network', 'brand-new-rule']);
    expect(chips[1]).toEqual({ code: 'brand-new-rule', line: 9, labelKey: null });
  });

  it('dedupes a repeated code keeping the lowest line, and handles empty input', () => {
    const chips = flagsSummary([
      { code: 'network', line: 30 },
      { code: 'network', line: 4 },
    ]);
    expect(chips).toEqual([{ code: 'network', line: 4, labelKey: 'plugins.flag.network' }]);
    expect(flagsSummary([])).toEqual([]);
  });
});

describe('status and category mapping', () => {
  it('maps each status to its i18n key with an unknown fallback', () => {
    expect(pluginStatusKey('pending')).toBe('plugins.status.pending');
    expect(pluginStatusKey('listed')).toBe('plugins.status.listed');
    expect(pluginStatusKey('delisted')).toBe('plugins.status.delisted');
    expect(pluginStatusKey('archived')).toBe('plugins.status.unknown');
  });

  it('maps each status to a badge variant', () => {
    expect(pluginStatusVariant('pending')).toBe('warn');
    expect(pluginStatusVariant('listed')).toBe('success');
    expect(pluginStatusVariant('delisted')).toBe('bad');
    expect(pluginStatusVariant('archived')).toBe('neutral');
  });

  it('maps known categories to i18n keys and unknown ones to null', () => {
    expect(pluginCategoryKey('combat')).toBe('plugins.category.combat');
    expect(pluginCategoryKey('economy')).toBe('plugins.category.economy');
    expect(pluginCategoryKey('social')).toBe('plugins.category.social');
    expect(pluginCategoryKey('interface')).toBe('plugins.category.interface');
    expect(pluginCategoryKey('tools')).toBe('plugins.category.tools');
    expect(pluginCategoryKey('minigames')).toBeNull();
  });
});
