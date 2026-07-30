// The character-select delete control.
//
// It used to be a full-size red .btn-danger sitting BEFORE Enter World, i.e. the
// loudest, left-most, most call-to-action-looking control in the row: players reached
// for it by reflex and only the type-your-name confirm modal saved them. A delete that
// can never be undone must not out-shout the button you actually came to press.
//
// So it is now a quiet icon-only affordance at the END of the row, after the primary
// action (which also puts it last in the tab order): a muted bin glyph that only takes
// on its danger tint on hover / focus. Nothing about the safety net changed, the
// confirm modal still demands the character's name; this only stops the control from
// baiting the reflex click in the first place.
//
// Still fully reachable and named: the accessible name is the same t('character.delete')
// key the old label rendered, and the tap target keeps the 40x40 mobile floor (CSS).

import { t } from './i18n';
import { svgIcon } from './ui_icons';

/** Markup for the delete-character control in one character row. `online` disables it
 *  (the character is in the world) and explains why, exactly as the old button did. */
export function deleteCharButtonHtml(online: boolean): string {
  const label = t('character.delete');
  const disabled = online
    ? ` disabled title="${escapeAttr(t('character.inWorldHint'))}"`
    : ` title="${escapeAttr(label)}"`;
  return `<button type="button" class="char-delete-btn delete-char-btn"${disabled} aria-label="${escapeAttr(label)}">${svgIcon('trash')}</button>`;
}

// Attribute-safe escaping for the localized strings spliced above (the same job esc()
// does for element text; kept local so this module has no DOM dependency).
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
