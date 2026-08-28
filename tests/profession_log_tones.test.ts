// The professions-family chat-log tones have ONE home
// (src/ui/hud/professions/profession_log_tones.ts), the woc_log_tones.ts
// precedent applied to this family by the Masterwrought phase 14 unification:
// a chat line is written as an inline colour on a span the log owns, so a
// stylesheet token cannot reach it, and naming the values once replaced the
// same hexes repeated across farm_event_feedback.ts's ten call sites plus
// craft_celebration_text_view.ts's local toast constant.
//
// The re-spell scan walks the WHOLE professions family directory (not a fixed
// file list like the $WOC pin): a new module joining the family joins the
// scan with it. src/ui/hud.ts still spells some of these values for its
// pre-existing log calls; that is separate debt outside this family's
// directory (its ratchet freezes it this phase), deliberately not scanned
// here for the same reason the $WOC pin stays $WOC-scoped.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PROF_LOG_DENY,
  PROF_LOG_GRANT,
  PROF_LOG_MISS,
  PROF_LOG_NEWS,
  PROF_LOG_TOAST,
} from '../src/ui/hud/professions/profession_log_tones';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { stripComments } from './helpers/strip_comments';
import { tsFilesUnder } from './helpers/ts_files_under';

const TONES = [PROF_LOG_GRANT, PROF_LOG_NEWS, PROF_LOG_MISS, PROF_LOG_TOAST, PROF_LOG_DENY];

describe('the professions log tones are named once', () => {
  it('keeps the five values a retune has to change deliberately', () => {
    // Spelled out rather than compared to themselves: a self-comparison would
    // pass for any value, including a typo.
    expect(PROF_LOG_GRANT).toBe('#7fdc4f');
    expect(PROF_LOG_NEWS).toBe('#c8f7c5');
    expect(PROF_LOG_MISS).toBe('#a8a8a8');
    expect(PROF_LOG_TOAST).toBe('#ffd100');
    expect(PROF_LOG_DENY).toBe('#ff6b6b');
  });

  it('no professions-family module re-spells a tone instead of importing it', () => {
    const files = tsFilesUnder('src/ui/hud/professions').filter(
      (f) => f.file !== 'profession_log_tones.ts',
    );
    // Vacuity floor: the family is a real directory of modules; a scan that
    // suddenly sees almost nothing is a broken walk, not a clean family.
    expect(files.length).toBeGreaterThan(20);
    for (const { file, full } of files) {
      const src = stripComments(readFileSync(full, 'utf8'));
      for (const tone of TONES) {
        expect(src, `${file} must import the tone, not spell ${tone}`).not.toContain(tone);
      }
    }
  });

  it('positive control: the scan sees a literal it is given', () => {
    expect(stripComments(`const c = '${PROF_LOG_GRANT}';`)).toContain(PROF_LOG_GRANT);
    expect(stripComments(`// ${PROF_LOG_GRANT}\nconst c = 1;`)).not.toContain(PROF_LOG_GRANT);
  });

  it('scans only through the shared walkers', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });
});
