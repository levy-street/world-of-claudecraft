// The HUD coordinator's colour vocabulary has ONE home (src/ui/hud_tones.ts),
// the third sanctioned colour-literal exception beside woc_log_tones.ts and
// profession_log_tones.ts (src/styles/CLAUDE.md): a chat line is an inline
// colour on a span the log owns, a canvas fill is a string, an inline style
// is text, so none can read a stylesheet token.
//
// Two guards. The values themselves are spelled out (a self-comparison would
// pass for any value, including a typo). Then the WHOLE point of the module:
// src/ui/hud.ts, found through the shared src/ui walker so the scan cannot
// quietly stop seeing it, spells NO hex colour literal at all, comments
// stripped (a doc comment quoting a value must neither satisfy nor red the
// scan). The Phase 18 sweep migrated 125 literals; this is what keeps the
// count at zero instead of letting the next arm spell one back.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BG_END_LOG_COLORS, CHROME_TONE, HUD_LOG, MAP_TONE } from '../src/ui/hud_tones';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { stripComments } from './helpers/strip_comments';
import { tsFilesUnder } from './helpers/ts_files_under';

// A hex colour token: '#' plus 3 to 8 hex digits, ending where the identifier
// would. The lookahead is what keeps a CSS id selector like '#deed-tracker'
// (four hex-looking letters, then a hyphen) or '#debuff-bar' out of the match.
const HEX_TOKEN = /#[0-9a-f]{3,8}(?![0-9a-z_-])/gi;

function hexTokens(src: string): string[] {
  return stripComments(src).match(HEX_TOKEN) ?? [];
}

describe('the HUD tone vocabulary is named once', () => {
  it('keeps the chat-log registers a retune has to change deliberately', () => {
    expect(HUD_LOG).toEqual({
      PLAIN: '#ccc',
      NOTICE: '#ffd100',
      GOOD: '#7fdc4f',
      BAD: '#ff7a6a',
      CONTEST: '#fa6',
      NEWS: '#c8f7c5',
      CALL: '#ffd24a',
      QUEUE: '#ffa040',
      SHORTFALL: '#ff8a5c',
      PROGRESS: '#dcd29f',
      MUTED: '#cfc6a8',
      BROADCAST: '#40d264',
      AURA: '#d8a0d8',
      FILTER: '#aaf',
      XP: '#a980d8',
      TIP: '#7fd4ff',
      ABILITY_HIT: '#ffe97a',
      MELEE_HIT: '#eee',
      DAMAGE_TAKEN: '#ff8877',
      BLOCK_DEALT: '#b8c4d9',
      BLOCK_TAKEN: '#7ec8e3',
      DEATH: '#aaa',
      DEATH_RECAP: '#ff4444',
      LOCK_YIELD: '#ffdd88',
      FLAG_TAKEN: '#ff9a3c',
      FLAG_RETURNED: '#9fdc7f',
      KILL_FEED_TEAM_A: '#ff8a7a',
      KILL_FEED_TEAM_B: '#7fb2ff',
      AUGMENT: '#ff3df0',
      ALLY_AUGMENT: '#c98bff',
      POWERUP_POP: '#32e0ff',
      TELEPORT: '#7fd7ff',
      CUE: '#9adcff',
      DELVE_COMPANION: '#c9a6e0',
      DELVE_LORE: '#cba6f0',
      HINT: '#c8b888',
    });
  });

  it('keeps the map canvas fills and the inline chrome colours', () => {
    expect(MAP_TONE).toEqual({
      STRIP_SEA: '#163058',
      PAPER: '#3c3a30',
      CLOCK_SUN: '#ffd45a',
      CLOCK_MOON: '#e2e8f6',
      CLOCK_HAND: '#fff',
      CLOCK_HAND_RING: '#000',
    });
    expect(CHROME_TONE).toEqual({
      MUSIC_OFF: '#cdbd8e',
      HEROIC_TAG: '#e5cc80',
      ARENA_META: '#b6ad8c',
      ROLE_FALLBACK: '#888',
    });
  });

  it('maps every battleground finish-line tone onto a named register (the record moved out of hud.ts)', () => {
    expect(BG_END_LOG_COLORS).toEqual({
      resultWin: HUD_LOG.GOOD,
      resultNotWin: HUD_LOG.BAD,
      cause: HUD_LOG.MUTED,
      bonus: HUD_LOG.NOTICE,
    });
    // Spelled out too, so a register retune shows up here as a deliberate change.
    expect(BG_END_LOG_COLORS.resultWin).toBe('#7fdc4f');
    expect(BG_END_LOG_COLORS.bonus).toBe('#ffd100');
  });

  it('every value is a lowercase hex colour the scan below would catch if re-spelled', () => {
    // The scan is case-insensitive, but the source of truth is lowercase so a
    // consumer comparing strings (a test, a snapshot) never trips on case.
    for (const value of [
      ...Object.values(HUD_LOG),
      ...Object.values(MAP_TONE),
      ...Object.values(CHROME_TONE),
    ]) {
      expect(value).toMatch(/^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/);
      expect(hexTokens(`const c = '${value}';`)).toEqual([value]);
    }
  });

  it('src/ui/hud.ts spells no hex colour literal (comments stripped)', () => {
    // The coordinator is found through the shared recursive walker over the
    // whole src/ui tree (directory scope, the profession_log_tones precedent):
    // a scan that suddenly sees no coordinator is a broken walk, not a clean
    // file, and the walk's own size floor says the tree is really there.
    const files = tsFilesUnder('src/ui');
    expect(files.length).toBeGreaterThan(200);
    const coordinator = files.filter((f) => f.file === 'hud.ts');
    expect(coordinator).toHaveLength(1);
    const src = readFileSync(coordinator[0].full, 'utf8');
    // Vacuity floor for the READ itself: the coordinator is a very large file.
    expect(src.length).toBeGreaterThan(100_000);
    expect(hexTokens(src), 'hud.ts must consume hud_tones / PROF_LOG_* by name').toEqual([]);
  });

  it('positive control: the scan sees a literal it is given, in either case and in every form', () => {
    expect(hexTokens("this.log(text, '#ffd100');")).toEqual(['#ffd100']);
    expect(hexTokens("ctx.fillStyle = '#FFD100';")).toEqual(['#FFD100']);
    expect(hexTokens("ctx.strokeStyle = '#000';")).toEqual(['#000']);
    expect(hexTokens('`<span style="color:#e5cc80">`')).toEqual(['#e5cc80']);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserts on source text that contains a template literally.
    expect(hexTokens("`--role:${roleColor ?? '#888'}`")).toEqual(['#888']);
    // Comments never count, in either direction.
    expect(hexTokens('// the #ffd100 house gold\nconst c = 1;')).toEqual([]);
    // Id selectors and issue numbers in comments are not colours.
    expect(hexTokens("$('#deed-tracker'); $('#debuff-bar'); $('#bags');")).toEqual([]);
  });

  it('scans only through the shared walkers', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });
});
