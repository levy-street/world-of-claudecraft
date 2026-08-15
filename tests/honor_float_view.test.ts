import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { HonorReason } from '../src/sim/types';
import {
  HONOR_FLOAT_REASON_KEYS,
  honorFloatReasonKey,
  honorFloatText,
} from '../src/ui/honor_float_view';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';

// Every HonorReason the sim can emit (src/sim/types.ts). Pinned as a literal list
// so widening the union without deciding how it floats fails HERE rather than
// shipping a silently-plain float.
const ALL_REASONS: HonorReason[] = [
  'arena_win',
  'fiesta_kill',
  'fiesta_complete',
  'fiesta_win',
  'battleground_win',
  'battleground_first_win',
  'battleground_complete',
  'battleground_kill',
  'battleground_assist',
];

// The two the drip pays plus the once-a-day bonus (which lands in the same
// instant as the ordinary win award and must say which float is which), and the
// six that keep the plain float.
const NAMED: HonorReason[] = ['battleground_kill', 'battleground_assist', 'battleground_first_win'];
const PLAIN = ALL_REASONS.filter((r) => !NAMED.includes(r));

afterEach(() => setLanguage('en'));

describe('the Honor float names the battleground drip and nothing else', () => {
  it('a battleground kill floats the Kill variant', () => {
    expect(honorFloatText('battleground_kill', 5)).toBe('+5 Honor (Kill)');
  });

  it('a battleground assist floats the Assist variant', () => {
    expect(honorFloatText('battleground_assist', 2)).toBe('+2 Honor (Assist)');
  });

  it('the diminished drip floats its real amount, not the full award', () => {
    // HONOR_REPEAT_DR pays 5 / 2 / 1 / 0 for repeat kills on the same victim, so
    // the float must read the event amount rather than any constant.
    expect(honorFloatText('battleground_kill', 2)).toBe('+2 Honor (Kill)');
    expect(honorFloatText('battleground_kill', 1)).toBe('+1 Honor (Kill)');
  });

  it('every other reason keeps the plain float (the result banner already speaks)', () => {
    for (const reason of PLAIN) {
      expect(honorFloatReasonKey(reason), reason).toBeNull();
      expect(honorFloatText(reason, 120), reason).toBe('+120 Honor');
    }
  });

  it('the first win of the day floats the First Win variant', () => {
    // It pays beside `battleground_win`, which stays plain: two unlabelled
    // floats over the same character in the same instant is exactly the case
    // the reason label exists for.
    expect(honorFloatText('battleground_first_win', 120)).toBe('+120 Honor (First Win)');
    expect(honorFloatReasonKey('battleground_win')).toBeNull();
  });

  it('the named reasons are exactly the mapped ones', () => {
    expect(Object.keys(HONOR_FLOAT_REASON_KEYS).sort()).toEqual([...NAMED].sort());
    for (const reason of NAMED) expect(honorFloatReasonKey(reason), reason).not.toBeNull();
  });

  it('the amount goes through formatNumber, so a grouped locale groups it', () => {
    // Not a hand-built number: the plain and reason-naming arms both format.
    expect(honorFloatText('arena_win', 12345)).toBe('+12,345 Honor');
    expect(honorFloatText('battleground_kill', 12345)).toBe('+12,345 Honor (Kill)');
    setLanguage('de_DE');
    expect(honorFloatText('battleground_kill', 12345)).toContain('12.345');
    expect(honorFloatText('battleground_kill', 12345)).not.toContain('12,345');
  });

  it('the reason label is localized, not the English short form', async () => {
    // Non-en slices load lazily; setLanguage alone does not fetch them.
    await ensureLocaleLoaded('ru_RU');
    setLanguage('ru_RU');
    const ru = honorFloatText('battleground_kill', 5);
    expect(ru).not.toContain('Kill');
    expect(ru).toContain('5');
  });

  it('reuses none of the chat line fragments (those are mid-sentence copy)', () => {
    // "honorable kill" / "killing blow assisted" read as a stutter at float size;
    // the float owns its own short labels.
    for (const key of Object.values(HONOR_FLOAT_REASON_KEYS)) {
      expect(key.startsWith('hudChrome.warfare.floatReasons.'), key).toBe(true);
    }
  });
});

describe('the HUD honor case feeds the float from the pure core', () => {
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
  const handler = hud.slice(hud.indexOf("case 'honor':"), hud.indexOf("case 'levelup':"));

  it('spawns the FCT over the player OWN character with the core text', () => {
    expect(handler).toContain("fctSpawnShape({ type: 'honor' })");
    expect(handler).toContain('text: honorFloatText(ev.reason, ev.amount)');
    // The anchor is the player themselves, the xp-float precedent, never a target.
    expect(handler).toContain('target: sim.player');
  });

  it('no longer hardcodes the plain float key at the call site', () => {
    expect(handler).not.toContain("t('hudChrome.warfare.honorFloat'");
  });

  it('only the gaining player sees it: the personal-event gate guards the batch', () => {
    // Every honor event carries a pid (src/sim/pvp/honor.ts grantHonor), and
    // handleEvents drops another player's personal events before the switch.
    expect(hud).toContain('if (ev.pid !== undefined && ev.pid !== sim.playerId) continue;');
  });
});
