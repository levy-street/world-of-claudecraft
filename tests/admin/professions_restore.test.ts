import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  restoreItemBodyError,
  restoreSlotBodyError,
  RESTORE_ITEM_MAX_COUNT as SERVER_RESTORE_ITEM_MAX_COUNT,
} from '../../server/character_professions';
import { ADMIN_ERROR_KEYS, t } from '../../src/admin/i18n';
import { en } from '../../src/admin/i18n.en';
import {
  RESTORE_ITEM_MAX_COUNT,
  restoreItem,
  restoreItemSummary,
  restoreSlot,
} from '../../src/admin/professions_restore';

// Pure validation + endpoint/body shaping for the R35 GM restores, the
// moderation_actions.test.ts pattern: Node env, no DOM, pins the exact
// request each builder sends and every client-side refusal.

// Whitespace-flattened so a call the formatter wrapped over several lines reads
// as one (the tests/world_auth_scripts.test.ts technique); newlines are never
// significant inside these calls.
function readServerSource(rel: string): string {
  return (
    fs
      .readFileSync(path.join(fileURLToPath(new URL('../..', import.meta.url)), rel), 'utf8')
      // FULL-LINE comments are stripped BEFORE flattening (the
      // source-text-pin rule): a commented-out fail() must not inflate the
      // floor or demand a catalog key, and flattening would otherwise run a
      // line comment into the next statement. Deliberately full-line only:
      // trailing and block comments stay, because strings in this file
      // contain '//' and '/*' sequences (URLs, glob-shaped routes) that a
      // regex-level strip would corrupt.
      .replace(/^\s*\/\/[^\n]*$/gm, ' ')
      .replace(/\s+/g, ' ')
  );
}

// Every fail() prose a handler can put in front of an operator, resolved
// through the three shapes the source actually uses: an inline literal, a
// module-level named constant, and the `err instanceof Error ? err.message :
// <fallback>` ternary (the fallback is what renders when the thrown value is
// not an Error). A bare literal-only scan misses the last two entirely. The
// argument is parsed QUOTE-AWARE from the position after the status code: a
// lazy match to the first ')' would silently drop any prose containing a
// parenthesis, exactly the escape hatch this scan exists to close.
function failProses(rel: string): string[] {
  const flat = readServerSource(rel);
  const named = new Map<string, string>();
  for (const m of flat.matchAll(/const ([A-Z][A-Z0-9_]*) = '([^']*)'/g)) named.set(m[1], m[2]);
  const out: string[] = [];
  const QUOTED = /^'((?:[^'\\]|\\.)*)'/;
  const IDENT = /^([A-Z][A-Z0-9_]*)\s*,?\s*\)/;
  // The ternary fallback (`cond ? dynamic : 'literal'` or `: CONSTANT`); the
  // condition and consequent cannot span a statement boundary.
  const TERNARY = /^[^;{}]*?\?[^:;{}]*?:\s*(?:'((?:[^'\\]|\\.)*)'|([A-Z][A-Z0-9_]*))\s*,?\s*\)/;
  for (const m of flat.matchAll(/fail\(\s*(?:ctx\.)?res,\s*(\d+),\s*/g)) {
    // 401s are excluded: handleAuthFailure logs the operator out on a 401,
    // so that prose never renders inline through localizeAdminError.
    if (m[1] === '401') continue;
    const rest = flat.slice((m.index ?? 0) + m[0].length);
    const quoted = QUOTED.exec(rest);
    if (quoted) {
      out.push(quoted[1]);
      continue;
    }
    const ident = IDENT.exec(rest);
    if (ident) {
      const resolved = named.get(ident[1]);
      if (resolved !== undefined) out.push(resolved);
      continue;
    }
    const ternary = TERNARY.exec(rest);
    if (ternary) {
      const resolved = ternary[1] ?? named.get(ternary[2] ?? '');
      if (resolved !== undefined) out.push(resolved);
    }
  }
  return out;
}

describe('professions_restore builders', () => {
  it('requires a note for both restores', () => {
    expect(restoreItem(7, 'Merlin', 'copper_mining_pick', 1, '')).toEqual({
      errorKey: 'alert.noteRequired',
    });
    expect(restoreSlot(7, 'Merlin', 'mining', 'gatherers_cache', '')).toEqual({
      errorKey: 'alert.noteRequired',
    });
  });

  it('refuses an empty item id and an out-of-range count', () => {
    expect(restoreItem(7, 'Merlin', '   ', 1, 'lost')).toEqual({
      errorKey: 'alert.itemIdRequired',
    });
    expect(restoreItem(7, 'Merlin', 'copper_mining_pick', 0, 'lost')).toEqual({
      errorKey: 'alert.restoreCountRange',
    });
    expect(restoreItem(7, 'Merlin', 'copper_mining_pick', 21, 'lost')).toEqual({
      errorKey: 'alert.restoreCountRange',
    });
    expect(restoreItem(7, 'Merlin', 'copper_mining_pick', 1.5, 'lost')).toEqual({
      errorKey: 'alert.restoreCountRange',
    });
  });

  it('refuses a missing profession or effect selection', () => {
    expect(restoreSlot(7, 'Merlin', '', 'gatherers_cache', 'lost')).toEqual({
      errorKey: 'alert.restoreSlotSelection',
    });
    expect(restoreSlot(7, 'Merlin', 'mining', '', 'lost')).toEqual({
      errorKey: 'alert.restoreSlotSelection',
    });
  });

  it('builds the restore-item request with a trimmed id and the exact endpoint', () => {
    const built = restoreItem(7, 'Merlin', '  copper_mining_pick ', 3, 'lost to issue 2514');
    if (!('pending' in built)) throw new Error('expected pending');
    expect(built.pending.endpoint).toBe('/admin/api/moderation/characters/7/restore-item');
    expect(built.pending.body).toEqual({
      itemId: 'copper_mining_pick',
      count: 3,
      reason: 'lost to issue 2514',
    });
  });

  it('builds the restore-slot request with the exact endpoint and body', () => {
    const built = restoreSlot(7, 'Merlin', 'mining', 'gatherers_cache', 'row vanished');
    if (!('pending' in built)) throw new Error('expected pending');
    expect(built.pending.endpoint).toBe('/admin/api/moderation/characters/7/restore-slot');
    expect(built.pending.body).toEqual({
      professionId: 'mining',
      effectId: 'gatherers_cache',
      reason: 'row vanished',
    });
  });

  it('renders the item confirm row through the localized summary and the formatter', () => {
    const built = restoreItem(7, 'Merlin', 'copper_mining_pick', 3, 'lost');
    if (!('pending' in built)) throw new Error('expected pending');
    expect(built.pending.rows[1].value).toBe('copper_mining_pick x3');
    // The multiplier is catalog typography, and the count goes through the
    // admin number formatter: raw interpolation would print "x1234" here.
    const template = (en as Record<string, string>)['profInspect.restoreSummary'];
    expect(template).toContain('{id}');
    expect(template).toContain('{count}');
    expect(restoreItemSummary('wolf_fang', 1234)).toBe('wolf_fang x1,234');
  });

  it('parameterizes the count-range alert with the shared clamp, not a literal', () => {
    const template = (en as Record<string, string>)['alert.restoreCountRange'];
    expect(template).toContain('{max}');
    expect(template).not.toContain(String(RESTORE_ITEM_MAX_COUNT));
    expect(t('alert.restoreCountRange', { max: RESTORE_ITEM_MAX_COUNT })).toContain(
      String(RESTORE_ITEM_MAX_COUNT),
    );
  });

  it('refuses a whitespace-only note locally, matching the server cleanText refusal', () => {
    expect(restoreItem(7, 'Merlin', 'copper_mining_pick', 1, '   ')).toEqual({
      errorKey: 'alert.noteRequired',
    });
    expect(restoreSlot(7, 'Merlin', 'mining', 'gatherers_cache', '\t ')).toEqual({
      errorKey: 'alert.noteRequired',
    });
  });
});

describe('server prose coupling (the count clamp and the error reverse map)', () => {
  it('mirrors the server count clamp exactly', () => {
    // Three copies of the clamp exist (server validator, client mirror, the
    // matcher key below); this pin makes a move in one drag the others.
    expect(RESTORE_ITEM_MAX_COUNT).toBe(SERVER_RESTORE_ITEM_MAX_COUNT);
  });

  it('reverse-maps EVERY fail() prose in server/admin.ts to a real catalog key', () => {
    // The scan arm: a future handler error string cannot ship unmatched.
    // Remaining dynamic strings (bare err.message, template literals, joined
    // validator lists) are not resolvable statically and are covered by the
    // fixture-driven arm below.
    const literals = failProses('server/admin.ts');
    // Liveness floor, set just under the real post-widening count: a scan that
    // silently stops resolving the named-constant or ternary shapes (measured
    // drops of 14 and 30; the flattening arm contributes 2 proses today via a
    // constant DECLARATION wrapped across lines, below the floor's resolution)
    // (its whole point) collapses well below this and fails here, not silently.
    expect(literals.length).toBeGreaterThan(109);
    for (const prose of literals) {
      expect(
        ADMIN_ERROR_KEYS[prose.toLowerCase()],
        `unmatched admin error prose in server/admin.ts: ${prose}`,
      ).toBeTruthy();
    }
  });

  it('reverse-maps every body-error prose in server/character_professions.ts too', () => {
    // The restore validators render through the SAME reverse map, so their
    // literal refusals are in scope for the scan, not just the admin handlers.
    // Scoped to the *BodyError validator functions (not the whole module), so
    // a future non-error `return 'x'` elsewhere cannot demand a bogus key.
    const source = readServerSource('server/character_professions.ts');
    // The $ alternative matters: the last validator has no following export.
    const validators = [
      ...source.matchAll(/export function restore\w*BodyError[\s\S]*?(?=export |$)/g),
    ]
      .map((m) => m[0])
      .join(' ');
    const proses = [...new Set([...validators.matchAll(/return '([^']+)'/g)].map((m) => m[1]))];
    // Floor just under the real count (4 distinct proses today, the phase 18
    // pair-validity refusal included), the same doctrine as the admin scan
    // above: a scan that silently stops resolving one prose fails HERE.
    expect(proses.length).toBeGreaterThan(3);
    for (const prose of proses) {
      expect(
        ADMIN_ERROR_KEYS[prose.toLowerCase()],
        `unmatched body-error prose in server/character_professions.ts: ${prose}`,
      ).toBeTruthy();
    }
  });

  it('reverse-maps every R35 server error prose to a real catalog key', () => {
    // The REAL server-built strings where they are dynamic, so a clamp change
    // or a reword breaks THIS test instead of silently unmatching operators
    // (many en values equal the prose verbatim, so the MAP is the oracle,
    // not localizeAdminError's output).
    const proses = [
      restoreItemBodyError({ itemId: 'copper_mining_pick', count: 0 }),
      restoreSlotBodyError({ professionId: 'mining', effectId: 'nope' }),
      restoreItemBodyError({ itemId: 'not_a_real_item', count: 1 }),
      restoreSlotBodyError({ professionId: 'cooking', effectId: 'gatherers_cache' }),
      'character is not online on this realm',
      'the character owns no tool for that profession',
      'that profession already has a slotted effect',
      'that effect cannot be slotted on that profession',
      'character went offline before the restore landed',
      'item restore failed',
      'slot restore failed',
      'character not found',
    ];
    for (const prose of proses) {
      expect(prose, 'validator fixture must produce an error').not.toBeNull();
      const key = ADMIN_ERROR_KEYS[(prose as string).toLowerCase()];
      expect(key, `unmatched admin error prose: ${prose}`).toBeTruthy();
      expect(
        (en as Record<string, string>)[key],
        `reverse-map key missing from the catalog: ${key}`,
      ).toBeTruthy();
    }
  });

  it('pins the SPA sheet mirror to the server type in BOTH directions (tsc-level)', () => {
    // src/admin/types.ts hand-copies the server's CharacterProfessionsSheet
    // (the SPA bundle cannot import server code), the same cross-boundary
    // drift class the SERVER_KINDS pin closes for the bot: a renamed or
    // added server field must redden this file at tsc time, not leave the
    // modal reading undefined. Mutual assignability makes it bidirectional.
    type ServerSheet = import('../../server/character_professions').CharacterProfessionsSheet;
    type ClientSheet = import('../../src/admin/types').CharacterProfessionsSheet;
    type ServerFitsClient = ServerSheet extends ClientSheet ? true : never;
    type ClientFitsServer = ClientSheet extends ServerSheet ? true : never;
    const serverFitsClient: ServerFitsClient = true;
    const clientFitsServer: ClientFitsServer = true;
    // The runtime arm is deliberately trivial (the teeth are the two typed
    // consts above, which tsc rejects on any one-sided drift).
    expect(serverFitsClient && clientFitsServer).toBe(true);
  });
});

describe('restoreSlotBodyError refuses statically impossible pairs before any audit', () => {
  it('fishing takes no effect and parked effects refuse on every land profession', () => {
    // The module contract ("a fat-fingered request never leaves an audit row
    // for a grant that was never possible") only holds if the PURE pair
    // policy runs in the validator: the admin modal offers every profession
    // times every effect, so 6 of the 12 selectable pairs are statically
    // refused and used to reach the audit write first.
    expect(restoreSlotBodyError({ professionId: 'fishing', effectId: 'gatherers_cache' })).toBe(
      'that effect cannot be slotted on that profession',
    );
    expect(restoreSlotBodyError({ professionId: 'mining', effectId: 'quickening_charm' })).toBe(
      'that effect cannot be slotted on that profession',
    );
    // A valid pair still passes: the policy gate must not over-refuse.
    expect(
      restoreSlotBodyError({ professionId: 'mining', effectId: 'gatherers_cache' }),
    ).toBeNull();
  });
});
