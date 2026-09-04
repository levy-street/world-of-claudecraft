// The shared profession denial-line pattern (denial_line_core.ts, the
// Masterwrought phase 14 unification): ONE presentation shape for an action
// refused with a reason, which crafting's craftDenyMessage extends and
// farming's farm_event_feedback arm renders. These pins hold the owner
// itself; each family's per-reason tables keep their own suites
// (craft_denial_line_view.test.ts, crafting_deny_core.test.ts,
// farming_view.test.ts).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CraftDenyMessage } from '../src/ui/hud/professions/crafting_deny_core';
import {
  farmDenialLine,
  type ProfessionDenialLine,
} from '../src/ui/hud/professions/denial_line_core';
import { farmDeniedToast } from '../src/ui/hud/professions/farming_view';
import { stripComments } from './helpers/strip_comments';

describe('denial_line_core: the one refusal presentation shape', () => {
  it('spells the tool refusal tier so the consumer renders t(key, params) verbatim', () => {
    // highland_barley is tier 3 (pinned in farming_view.test.ts); the shared
    // plan carries the tier ALREADY FORMATTED, so no consumer re-formats.
    expect(farmDenialLine('tool', 'highland_barley')).toEqual({
      key: 'hudChrome.gathering.tierRequired.farming',
      params: { tier: '3' },
    });
  });

  it('delegates every other arm to the pure toast resolution, keys unchanged', () => {
    // The presentation unification preserved every key: a paramless toast
    // becomes a paramless line, byte-identical key (two representative arms;
    // the per-reason table itself is farming_view.test.ts business).
    for (const reason of ['bed_taken', 'no_seed'] as const) {
      expect(farmDenialLine(reason, undefined)).toEqual({
        key: farmDeniedToast(reason, undefined).key,
      });
    }
    // The degrade twin: an unresolvable crop keeps the flat tool line.
    expect(farmDenialLine('tool', 'not_a_crop')).toEqual({ key: 'hudChrome.farming.denied.tool' });
  });

  it('crafting extends the same shape (compile-time), so the families cannot drift', () => {
    // Assignability IS the pin: a CraftDenyMessage is a ProfessionDenialLine
    // plus stationType. If crafting_deny_core stops extending the shared
    // shape, this line stops compiling.
    const craft: CraftDenyMessage = { key: 'hudChrome.crafting.busy' };
    const shared: ProfessionDenialLine = craft;
    expect(shared.key).toBe('hudChrome.crafting.busy');
  });

  it('both families consume the owner (source pin, comments stripped)', () => {
    const feedback = stripComments(
      readFileSync('src/ui/hud/professions/farm_event_feedback.ts', 'utf8'),
    );
    expect(feedback).toContain("from './denial_line_core'");
    expect(feedback).toContain('farmDenialLine(');
    const crafting = stripComments(
      readFileSync('src/ui/hud/professions/crafting_deny_core.ts', 'utf8'),
    );
    expect(crafting).toContain("from './denial_line_core'");
    expect(crafting).toContain('extends ProfessionDenialLine');
  });
});
