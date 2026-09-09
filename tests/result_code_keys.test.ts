// The wire-union result-code key maps (src/ui/result_code_keys.ts): every
// code's key resolves to a real English line, each fallback is one of its own
// family's keys (so the safety arm can never be the throw it guards), and the
// roster map's cannotAfford line is the one that reads {price}.
import { describe, expect, it } from 'vitest';
import { en } from '../src/ui/i18n.resolved.generated';
import {
  CALENDAR_RESULT_FALLBACK_KEY,
  CALENDAR_RESULT_KEYS,
  GUILD_ROSTER_RESULT_FALLBACK_KEY,
  GUILD_ROSTER_RESULT_KEYS,
  HONOR_REASON_FALLBACK_KEY,
  HONOR_REASON_KEYS,
  MAIL_RESULT_ERROR_KEYS,
  MAIL_RESULT_FALLBACK_KEY,
  MOTD_RESULT_FALLBACK_KEY,
  MOTD_RESULT_KEYS,
} from '../src/ui/result_code_keys';

function resolveDotted(key: string): unknown {
  let node: unknown = en;
  for (const segment of key.split('.')) {
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, segment)) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

const FAMILIES = [
  { name: 'mail', keys: MAIL_RESULT_ERROR_KEYS, fallback: MAIL_RESULT_FALLBACK_KEY },
  { name: 'calendar', keys: CALENDAR_RESULT_KEYS, fallback: CALENDAR_RESULT_FALLBACK_KEY },
  { name: 'billboard', keys: MOTD_RESULT_KEYS, fallback: MOTD_RESULT_FALLBACK_KEY },
  { name: 'roster', keys: GUILD_ROSTER_RESULT_KEYS, fallback: GUILD_ROSTER_RESULT_FALLBACK_KEY },
  { name: 'honor', keys: HONOR_REASON_KEYS, fallback: HONOR_REASON_FALLBACK_KEY },
];

describe('result_code_keys', () => {
  it('every code resolves to a non-empty English line', () => {
    for (const family of FAMILIES) {
      for (const [code, key] of Object.entries(family.keys)) {
        const value = resolveDotted(key);
        expect(typeof value, `${family.name}.${code} -> ${key}`).toBe('string');
        expect((value as string).length, `${family.name}.${code}`).toBeGreaterThan(0);
      }
    }
  });

  it('every fallback is one of its own family lines', () => {
    for (const family of FAMILIES) {
      expect(Object.values(family.keys), family.name).toContain(family.fallback);
    }
  });

  it('pins the roster codes: five refusals, cannotAfford names the price, retry is the fallback', () => {
    expect(Object.keys(GUILD_ROSTER_RESULT_KEYS).sort()).toEqual(
      ['cannotAfford', 'maxed', 'notInGuild', 'notLeader', 'retry'].sort(),
    );
    expect(resolveDotted(GUILD_ROSTER_RESULT_KEYS.cannotAfford)).toContain('{price}');
    for (const code of ['maxed', 'notInGuild', 'notLeader', 'retry'] as const) {
      expect(resolveDotted(GUILD_ROSTER_RESULT_KEYS[code]), code).not.toContain('{');
    }
    expect(GUILD_ROSTER_RESULT_FALLBACK_KEY).toBe(GUILD_ROSTER_RESULT_KEYS.retry);
    // The guildless refusal is the calendar family's line, shared on purpose:
    // one "You are not in a guild." across every guild command.
    expect(GUILD_ROSTER_RESULT_KEYS.notInGuild).toBe(CALENDAR_RESULT_KEYS.notInGuild);
  });
});
