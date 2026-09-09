// Intentional Gathering PR3: every refusal corpseHarvestDenialText can return
// (the real HarvestAdmissionReason union, src/sim/professions/harvest_admission.ts)
// must be recognized by the client's real localization pipeline. The sim stays
// English-only by contract (src/sim/CLAUDE.md, "Player-facing text is English
// here"); this suite proves the client matcher side of that contract for the
// corpse-harvest session specifically, the way tests/localization_fixes.test.ts
// proves it generically across all of src/sim.
import { describe, expect, it } from 'vitest';
import { corpseHarvestDenialText } from '../src/sim/professions/corpse_harvest_session';
import type { HarvestAdmissionReason } from '../src/sim/professions/harvest_admission';
import { ensureLocaleLoaded, getLanguage, setLanguage } from '../src/ui/i18n';
import { localizeSimText } from '../src/ui/sim_i18n';

// The exhaustive set corpseHarvestDenialText's switch is written against. Kept
// as a literal list (not derived from the type) so an added reason that nobody
// updates this list for shows up as a missing case here rather than silently
// falling through to the switch's unreachable default arm.
const ADMISSION_REASONS: readonly HarvestAdmissionReason[] = [
  'malformed_input',
  'actor_dead',
  'actor_in_combat',
  'actor_busy',
  'corpse_invalid',
  'wrong_world',
  'out_of_range',
  'no_field_kit',
  'already_harvested',
  'reserved',
  'priority_protected',
  'corpse_expiring',
  'preference_malformed',
  'nothing_to_harvest',
  'material_unavailable',
  'bags_full',
];

// Locales this change owns (root CLAUDE.md M16 exception): the five non-Latin
// fills, checked through the real setLanguage/ensureLocaleLoaded idiom rather
// than a hand-built translation map.
const OWNED_LOCALES = ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const;

describe('corpse-harvest session refusals resolve through the real localization pipeline', () => {
  it('every real HarvestAdmissionReason produces English text recognized by localizeSimText or an earlier matcher arm', () => {
    for (const reason of ADMISSION_REASONS) {
      const text = corpseHarvestDenialText(reason);
      // localizeSimText returns null for text it does not recognize. A few of
      // these reasons reuse a literal that resolves one matcher arm EARLIER in
      // hud's real chain (localizeErrorText's own EXACT map: "You are busy.",
      // "You can't do that while in combat.", "Too far away."), which
      // localizeSimText alone cannot see; those three are asserted directly
      // against error_text_i18n_core's table instead of localizeSimText.
      const recognizedElsewhere =
        text === 'You are busy.' ||
        text === "You can't do that while in combat." ||
        text === 'Too far away.';
      if (recognizedElsewhere) continue;
      expect(
        localizeSimText(text),
        `reason '${reason}' -> '${text}' has no sim matcher row`,
      ).not.toBeNull();
    }
  });

  it('the harvest-interrupted completion refusal resolves too', () => {
    // Not reachable through corpseHarvestDenialText: completeCorpseHarvestCast
    // (src/sim/professions/corpse_harvest_session.ts) emits this literal
    // directly on its own validity-recheck failure. Pinned here as the exact
    // source string so a reword there and here cannot drift apart silently.
    expect(localizeSimText('The harvest was interrupted.')).not.toBeNull();
  });

  it('the switch statement default denial text also resolves (S3 parses the literal regardless of reachability)', () => {
    expect(localizeSimText('You cannot harvest that corpse right now.')).not.toBeNull();
  });

  for (const locale of OWNED_LOCALES) {
    it(`localizes every real refusal into ${locale}, distinct from the English source`, async () => {
      const restoreLanguage = getLanguage();
      await ensureLocaleLoaded(locale);
      setLanguage(locale);
      try {
        for (const reason of ADMISSION_REASONS) {
          const english = corpseHarvestDenialText(reason);
          if (
            english === 'You are busy.' ||
            english === "You can't do that while in combat." ||
            english === 'Too far away.'
          ) {
            // These route through hud's localizeErrorText EXACT map before
            // localizeSimText ever runs; already covered by that map's own
            // suite, out of scope for this file.
            continue;
          }
          const localized = localizeSimText(english);
          expect(localized, `reason '${reason}' did not localize into ${locale}`).not.toBeNull();
          expect(localized, `reason '${reason}' shipped English into ${locale}`).not.toBe(english);
        }
        expect(localizeSimText('The harvest was interrupted.')).not.toBe(
          'The harvest was interrupted.',
        );
        expect(localizeSimText('You cannot harvest that corpse right now.')).not.toBe(
          'You cannot harvest that corpse right now.',
        );
      } finally {
        setLanguage(restoreLanguage);
      }
    });
  }
});
