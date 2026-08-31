// Regression cover for the live incident: opening the merged PvP window on the
// Thornhollow Fields tab while the Double Honor Weekend chip is active went
// blank (no title, no tab strip, no body) for every non-English player, because
// ArenaWindow.renderThornhollowFields (src/ui/arena_window.ts) builds
// `el.innerHTML` from one concatenated expression, and t() intentionally
// hard-fails a registry-`pending` key on a release build (src/ui/i18n.ts). The
// three Double Honor Weekend keys (hudChrome.bg.doubleHonorLine plus the
// calendar chip's title/note) shipped pending in every locale but the five
// non-Latin ones the M16 gate enforces, so the uncaught throw aborted the
// assignment mid-evaluation and left the window's freshly-opened root with no
// content at all: a blank panel indistinguishable from a solid background.
//
// tests/i18n_t_behavior.test.ts's release-tier "pending set is empty" check
// already catches ANY future instance of this class of bug; this test pins
// the specific incident (every supported locale can actually render the
// Double Honor copy under release semantics) so a future edit to just these
// three keys fails here even outside a release-tier gate run.
import { afterEach, describe, expect, it } from 'vitest';
import { DOUBLE_HONOR_MULTIPLIER } from '../src/sim/pvp';
import { ensureLocaleLoaded, setLanguage, supportedLanguages, t } from '../src/ui/i18n';

afterEach(() => {
  delete process.env.I18N_RELEASE;
  setLanguage('en');
});

const NON_ENGLISH = supportedLanguages.filter((lang) => lang !== 'en' && lang !== 'en_CA');

describe('Double Honor Weekend copy renders on a release build in every locale', () => {
  it.each(NON_ENGLISH)('%s: the queue chip and calendar entry never throw', async (lang) => {
    process.env.I18N_RELEASE = '1';
    await ensureLocaleLoaded(lang);
    setLanguage(lang);

    let chip = '';
    let title = '';
    let note = '';
    expect(() => {
      chip = t('hudChrome.bg.doubleHonorLine', { mult: DOUBLE_HONOR_MULTIPLIER });
      title = t('hudChrome.calendar.events.doubleHonor.title');
      note = t('hudChrome.calendar.events.doubleHonor.note');
    }, `${lang} must render the Double Honor Weekend copy, not blank the window`).not.toThrow();

    // A same-as-English paste (the "transplant, not translate" trap the
    // fill contract warns about) would clear the pending row and stop the
    // throw above without actually localizing anything; catch that too.
    expect(title, `${lang} doubleHonor.title must be localized, not the English source`).not.toBe(
      'Double Honor Weekend',
    );
    expect(chip.length, `${lang} doubleHonorLine must resolve to non-empty text`).toBeGreaterThan(
      0,
    );
    expect(note.length, `${lang} doubleHonor.note must resolve to non-empty text`).toBeGreaterThan(
      0,
    );
  });
});
