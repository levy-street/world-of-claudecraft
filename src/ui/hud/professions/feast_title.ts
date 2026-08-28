// THE PLACED-FEAST TITLE, one rule for the two surfaces that paint it
// (masterwrought Phase 11k). A placed feast's entity carries the PLACER'S raw
// player name as its wire `name` (sim and server stay language-agnostic), and
// the localized "{name}'s <Feast>" title is composed HERE, client-side, off the
// entity's templateId. Two surfaces do that composing, and before this leaf
// existed they each carried their own copy of the one-template rule:
// src/ui/entity_display_name.ts (the target frame and tooltips) and
// src/render/entity_labels.ts (the floating world label). A feast tier added
// to one and not the other renders under two different names, which is the
// half-wiring the feast family's catalog derivation exists to make impossible.
//
// WHY THE KEYS ARE A LITERAL MAP rather than `hudChrome.farming.${id}Title`:
// a key built by template literal is invisible to every static consumer, and
// this packet has already paid for that twice (Phase 11i QA: five guide keys
// could not take the re-key remedy purely because their paths were built).
// Every key below is a LITERAL, so a grep finds it, a re-key is a local edit,
// and the release-fill worklist can see it. This is the FAQ_ANSWER_KEYS shape.
//
// EXHAUSTIVENESS IS PINNED, NOT ASSUMED: tests/entity_display_name.test.ts
// asserts this map covers exactly feastTemplateIds(), so authoring a feast def
// without a title key reds rather than falling through to the raw player name.
import { feastTemplateIds } from '../../../sim/professions/feast';
import { type TranslationKey, t } from '../../i18n';

const TITLE_KEY_BY_TEMPLATE_ID: Readonly<Record<string, TranslationKey>> = {
  farm_feast: 'hudChrome.farming.feastTitle',
  stonepot_feast: 'hudChrome.farming.stonepotFeastTitle',
  warspice_feast: 'hudChrome.farming.warspiceFeastTitle',
  sageleaf_feast: 'hudChrome.farming.sageleafFeastTitle',
};

/** The title key a placed feast's templateId composes through, or null when
 *  the templateId is not a feast at all. Exported for the exhaustiveness pin. */
export function feastTitleKeyFor(templateId: string | null | undefined): TranslationKey | null {
  if (typeof templateId !== 'string') return null;
  return TITLE_KEY_BY_TEMPLATE_ID[templateId] ?? null;
}

/** The composed localized title for a placed feast, or null for a non-feast.
 *  `placerName` is the entity's wire name, interpolated as a VALUE and never
 *  translated (the i18n invariant: the text is the key, the name is the
 *  value). */
export function feastTitleFor(
  templateId: string | null | undefined,
  placerName: string,
): string | null {
  const key = feastTitleKeyFor(templateId);
  return key === null ? null : t(key, { name: placerName });
}

/** Every feast templateId the catalog ships, for the exhaustiveness pin. Kept
 *  here so the test imports ONE module rather than reaching into the sim. */
export function feastTitleTemplateIds(): string[] {
  return feastTemplateIds();
}

/** Every templateId this map CLAIMS a title for, sorted. Exported for the
 *  reverse half of the exhaustiveness pin: without it the map could gain a key
 *  for a non-feast template (labelling, say, every farm bed as a feast) and the
 *  forward-direction check would stay green. */
export function feastTitleKeyedTemplateIds(): string[] {
  return Object.keys(TITLE_KEY_BY_TEMPLATE_ID).sort();
}
